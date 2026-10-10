import { db } from '../../shared/db';
import type { UndoPayload } from '../../shared/types';
import { type Outcome } from '../activity';
import { getTab } from '../context';
import { groupWorkspaceInChrome, placeTabForWorkspace, ungroupWorkspace } from '../groups';
import { isLive, recordsByIds } from '../records';
import { archiveRecords, closeRecords, openRecords, wakeRecords } from './tabs';

/** Apply the inverse of a logged action. */
export async function applyUndo(payload: UndoPayload): Promise<Outcome> {
  switch (payload.type) {
    case 'reopen': {
      // Reopen in the original windows/positions where possible; skip any that are already open again.
      const ids = payload.placements.map((p) => p.recordId);
      const recs = await recordsByIds(ids);
      const now = Date.now();
      for (const p of payload.placements) {
        const r = recs.find((x) => x.id === p.recordId);
        if (r && !isLive(r) && p.hint) await db.tabs.update(r.id, { restoreHint: p.hint, updatedAt: now });
      }
      const out = await openRecords(
        recs.filter((r) => !isLive(r)).map((r) => r.id),
        // Undoing a small archive should feel instant: only big batches come back asleep.
        { target: 'auto', focus: false, lazy: recs.length > 3 ? undefined : false },
      );
      return { count: out.count, skipped: out.skipped, undo: null };
    }
    case 'wake':
      return wakeRecords(payload.recordIds);
    case 'reclose': {
      const recs = await recordsByIds(payload.items.map((i) => i.recordId));
      const toArchive: string[] = [];
      const toClose: string[] = [];
      const now = Date.now();
      for (const item of payload.items) {
        const r = recs.find((x) => x.id === item.recordId);
        if (!r) continue;
        if (isLive(r)) (item.prevStatus === 'archived' ? toArchive : toClose).push(r.id);
        else if (r.status !== item.prevStatus) {
          await db.tabs.update(r.id, {
            status: item.prevStatus,
            ...(item.prevStatus === 'closed' ? { closedAt: r.closedAt ?? now, closeReason: r.closeReason ?? 'tabos' } : {}),
            updatedAt: now,
          });
        }
      }
      const a = toArchive.length ? await archiveRecords(toArchive, 'undo') : null;
      const c = toClose.length ? await closeRecords(toClose, 'tabos') : null;
      return { count: (a?.count ?? 0) + (c?.count ?? 0), skipped: [...(a?.skipped ?? []), ...(c?.skipped ?? [])], undo: null };
    }
    case 'assign': {
      const now = Date.now();
      const recs = await recordsByIds(payload.changes.map((c) => c.recordId));
      for (const id of payload.createdWorkspaceIds) await ungroupWorkspace(id);
      for (const change of payload.changes) {
        const r = recs.find((x) => x.id === change.recordId);
        if (!r) continue;
        await db.tabs.update(r.id, { workspaceId: change.prevWorkspaceId, updatedAt: now });
        if (isLive(r) && r.windowId != null) {
          const tab = await getTab(r.chromeTabId!);
          if (tab) await placeTabForWorkspace(tab.id!, tab.windowId, tab.groupId, change.prevWorkspaceId);
        }
      }
      for (const w of payload.renamedWorkspaces ?? []) await db.workspaces.update(w.id, { name: w.name, summary: w.summary });
      if (payload.createdWorkspaceIds.length) {
        const stillUsed = new Set(
          (await db.tabs.where('workspaceId').anyOf(payload.createdWorkspaceIds).toArray()).map((r) => r.workspaceId),
        );
        await db.workspaces.bulkDelete(payload.createdWorkspaceIds.filter((id) => !stillUsed.has(id)));
      }
      return { count: payload.changes.length, skipped: [], undo: null };
    }
    case 'workspace-restore': {
      const exists = await db.workspaces.get(payload.workspace.id);
      if (!exists) await db.workspaces.add({ ...payload.workspace, updatedAt: Date.now() });
      const recs = await recordsByIds(payload.recordIds);
      for (const r of recs) if (!r.workspaceId) await db.tabs.update(r.id, { workspaceId: payload.workspace.id });
      if (payload.hadChromeGroups) await groupWorkspaceInChrome(payload.workspace.id);
      return { count: 1, skipped: [], undo: null };
    }
    case 'records-restore': {
      // Restored as non-live records; their old tab ids are meaningless now.
      await db.tabs.bulkPut(payload.records.map((r) => ({ ...r, chromeTabId: null, active: false })));
      return { count: payload.records.length, skipped: [], undo: null };
    }
    case 'snapshot-restore':
      await db.snapshots.put(payload.snapshot);
      return { count: 1, skipped: [], undo: null };
    case 'protect': {
      for (const c of payload.changes) {
        const r = await db.tabs.get(c.recordId);
        if (!r) continue;
        await db.tabs.update(r.id, { isProtected: c.prev });
        if (isLive(r)) await chrome.tabs.update(r.chromeTabId!, { autoDiscardable: !c.prev }).catch(() => undefined);
      }
      return { count: payload.changes.length, skipped: [], undo: null };
    }
    case 'composite': {
      let count = 0;
      const skipped: Outcome['skipped'] = [];
      // Undo in reverse order of application.
      for (const part of [...payload.parts].reverse()) {
        const out = await applyUndo(part);
        count += out.count;
        skipped.push(...out.skipped);
      }
      return { count, skipped, undo: null };
    }
  }
}
