import { db } from '../../shared/db';
import type { GroupColor, Workspace } from '../../shared/types';
import { type Outcome } from '../activity';
import { getSettings, noteError } from '../context';
import {
  createWorkspaceRecord,
  findWorkspaceByName,
  groupWorkspaceInChrome,
  resyncGroups,
  syncWorkspaceToGroups,
  ungroupWorkspace,
  uniqueWorkspaceName,
} from '../groups';
import { isLive } from '../records';
import { session } from '../session';
import { assignRecords, focusTab, openRecords, sleepRecords } from './tabs';

export async function createWorkspace(input: { name: string; color?: GroupColor; recordIds?: string[] }): Promise<Workspace> {
  if (!input.name.trim()) throw new Error('Give the group a name');
  const ws = await createWorkspaceRecord({ name: input.name, color: input.color, source: 'manual' });
  if (input.recordIds?.length) await assignRecords(input.recordIds, ws.id);
  return ws;
}

export async function updateWorkspace(
  id: string,
  patch: Partial<Pick<Workspace, 'name' | 'color' | 'summary' | 'isProtected'>>,
): Promise<Workspace> {
  const ws = await db.workspaces.get(id);
  if (!ws) throw new Error('That group no longer exists');
  const next: Workspace = { ...ws, updatedAt: Date.now() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('Give the group a name');
    const clash = await findWorkspaceByName(name);
    if (clash && clash.id !== id) throw new Error(`There is already a group called “${clash.name}”`);
    next.name = name.slice(0, 60);
  }
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.summary !== undefined) next.summary = patch.summary.slice(0, 400);
  if (patch.isProtected !== undefined) next.isProtected = patch.isProtected;
  await db.workspaces.put(next);
  if (next.name !== ws.name || next.color !== ws.color) await syncWorkspaceToGroups(next);
  return next;
}

export async function deleteWorkspace(id: string): Promise<Outcome> {
  const ws = await db.workspaces.get(id);
  if (!ws) throw new Error('That group no longer exists');
  const recs = await db.tabs.where('workspaceId').equals(id).toArray();
  const hadChromeGroups = (await session.groupsForWorkspace(id)).length > 0;
  // Ungroup first so tab-group sync can't resurrect the workspace from its group title.
  await ungroupWorkspace(id);
  const now = Date.now();
  await db.transaction('rw', db.tabs, db.workspaces, async () => {
    for (const r of recs) await db.tabs.update(r.id, { workspaceId: null, updatedAt: now });
    await db.workspaces.delete(id);
  });
  return {
    count: 1,
    skipped: [],
    undo: { type: 'workspace-restore', workspace: ws, recordIds: recs.map((r) => r.id), hadChromeGroups },
  };
}

/**
 * Switch to a workspace: focus its most recent tab (waking it), or reopen its archived tabs in a
 * new window. Optionally collapse other workspaces' groups and put their tabs to sleep.
 */
export async function switchWorkspace(id: string): Promise<Outcome> {
  const ws = await db.workspaces.get(id);
  if (!ws) throw new Error('That group no longer exists');
  const settings = await getSettings();
  const now = Date.now();
  const members = await db.tabs.where('workspaceId').equals(id).toArray();
  const live = members.filter(isLive).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  let count = 0;
  if (live.length) {
    const target = live[0];
    try {
      await focusTab(target.chromeTabId!, target.windowId!);
      count = 1;
    } catch (err) {
      noteError('switch focus', err);
    }
  } else {
    const archived = members.filter((r) => r.status === 'archived');
    if (archived.length) {
      const out = await openRecords(
        archived.map((r) => r.id),
        { target: 'new-window', focus: true, groupWorkspace: settings.workspaces.syncTabGroups ? id : undefined },
      );
      count = out.count;
      const first = out.tabIds[0];
      if (first != null) {
        const tab = await chrome.tabs.get(first).catch(() => null);
        if (tab) await session.setWindowWorkspace(tab.windowId, id);
      }
    } else {
      const win = await chrome.windows.create({ focused: true });
      if (win?.id != null) await session.setWindowWorkspace(win.id, id);
    }
  }

  if (settings.workspaces.collapseOthersOnSwitch) {
    const links = await session.getGroupLinks();
    for (const [groupId, wsId] of Object.entries(links)) {
      try {
        await chrome.tabGroups.update(Number(groupId), { collapsed: wsId !== id });
      } catch {
        /* group gone or contains the active tab */
      }
    }
  }
  if (settings.workspaces.sleepOthersOnSwitch) {
    const others = (await db.tabs.where('status').equals('open').toArray()).filter(
      (r) => isLive(r) && r.workspaceId && r.workspaceId !== id && !r.active,
    );
    await sleepRecords(others.map((r) => r.id));
  }
  await db.workspaces.update(id, { lastActiveAt: now });
  return { count, skipped: [], undo: null };
}

/** Reopen every archived tab of a workspace in a new window, grouped. */
export async function restoreWorkspace(id: string, lazy?: boolean): Promise<Outcome> {
  const settings = await getSettings();
  const archived = (await db.tabs.where('workspaceId').equals(id).toArray()).filter((r) => r.status === 'archived');
  if (!archived.length) return { count: 0, skipped: [], undo: null };
  const out = await openRecords(
    archived.map((r) => r.id),
    { target: 'new-window', lazy, focus: true, groupWorkspace: settings.workspaces.syncTabGroups ? id : undefined },
  );
  return { count: out.count, skipped: out.skipped, undo: out.undo };
}

export async function reorderWorkspaces(ids: string[]): Promise<Outcome> {
  await db.transaction('rw', db.workspaces, async () => {
    for (let i = 0; i < ids.length; i++) await db.workspaces.update(ids[i], { order: i });
  });
  return { count: ids.length, skipped: [], undo: null };
}

export async function groupWorkspace(id: string): Promise<Outcome> {
  const n = await groupWorkspaceInChrome(id);
  return { count: n, skipped: [], undo: null };
}

export async function ungroup(id: string): Promise<Outcome> {
  const n = await ungroupWorkspace(id);
  return { count: n, skipped: [], undo: null };
}

/** Create workspaces from existing titled Chrome tab groups (works even when automatic sync is off). */
export async function importTabGroups(): Promise<Outcome> {
  const before = await db.workspaces.count();
  await resyncGroups(true);
  const after = await db.workspaces.count();
  return { count: after - before, skipped: [], undo: null };
}

export { uniqueWorkspaceName };
