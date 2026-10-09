import { textHash } from '../../ai/text';
import { db, newId } from '../../shared/db';
import type { SnapshotScope } from '../../shared/messages';
import type { GroupColor, Snapshot, SnapshotTab, SnapshotWindow, TabRecord, UndoPayload, Workspace } from '../../shared/types';
import { isRestorableUrl, isTrackableUrl } from '../../shared/url';
import { type Outcome } from '../activity';
import { OWN_ORIGIN, getSettings, noteError, targetWindowId } from '../context';
import { createWorkspaceRecord } from '../groups';
import { bindPatch, isLive, recordFromTab } from '../records';
import { discardWhenCommitted, focusTab } from './tabs';

function stamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fingerprintOf(windows: SnapshotWindow[]): string {
  return textHash(windows.map((w) => w.tabs.map((t) => t.url).join('\n')).join('\n--\n'));
}

export async function createSnapshot(scope: SnapshotScope, name?: string, kind: Snapshot['kind'] = 'manual'): Promise<Snapshot | null> {
  const now = Date.now();
  const records = await db.tabs.toArray();
  const byTabId = new Map<number, TabRecord>();
  for (const r of records) if (isLive(r)) byTabId.set(r.chromeTabId!, r);
  const workspaces = new Map((await db.workspaces.toArray()).map((w) => [w.id, w]));
  let windows: SnapshotWindow[] = [];
  let snapKind = kind;
  let defaultName = `Session · ${stamp(now)}`;

  if (scope.kind === 'workspace') {
    const ws = workspaces.get(scope.workspaceId);
    if (!ws) throw new Error('Workspace not found');
    snapKind = 'workspace';
    defaultName = `${ws.name} · ${stamp(now)}`;
    const members = records
      .filter((r) => r.workspaceId === ws.id && (isLive(r) || r.status === 'archived'))
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || (a.windowId ?? 0) - (b.windowId ?? 0) || a.index - b.index);
    windows = [
      {
        tabs: members.map((r) => ({
          url: r.url,
          title: r.title,
          favIconUrl: r.favIconUrl,
          pinned: r.pinned,
          groupKey: r.pinned ? null : 'ws',
          recordId: r.id,
          workspaceId: ws.id,
        })),
        groups: [{ key: 'ws', title: ws.name, color: ws.color, collapsed: false }],
      },
    ];
  } else {
    let wins = (await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })).filter((w) => !w.incognito);
    if (scope.kind === 'window') {
      const wid = scope.windowId ?? (await targetWindowId());
      wins = wins.filter((w) => w.id === wid);
    }
    const groups = await chrome.tabGroups.query({}).catch(() => [] as chrome.tabGroups.TabGroup[]);
    windows = wins.map((w) => {
      const tabs: SnapshotTab[] = (w.tabs ?? [])
        .filter((t) => isTrackableUrl(t.url || t.pendingUrl, OWN_ORIGIN))
        .map((t) => {
          const rec = t.id != null ? byTabId.get(t.id) : undefined;
          return {
            url: t.url || t.pendingUrl || '',
            title: t.title || rec?.title || '',
            favIconUrl: rec?.favIconUrl ?? '',
            pinned: t.pinned,
            groupKey: t.groupId >= 0 ? String(t.groupId) : null,
            recordId: rec?.id ?? null,
            workspaceId: rec?.workspaceId ?? null,
          };
        });
      const used = new Set(tabs.map((t) => t.groupKey).filter(Boolean));
      return {
        tabs,
        groups: groups
          .filter((g) => g.windowId === w.id && used.has(String(g.id)))
          .map((g) => ({ key: String(g.id), title: g.title ?? '', color: g.color as GroupColor, collapsed: g.collapsed })),
      };
    });
  }
  windows = windows.filter((w) => w.tabs.length);
  const tabCount = windows.reduce((n, w) => n + w.tabs.length, 0);
  if (!tabCount) {
    if (kind === 'auto') return null;
    throw new Error('There are no tabs to save.');
  }
  const fingerprint = fingerprintOf(windows);
  if (kind === 'auto') {
    const lastAuto = await db.snapshots.where('kind').equals('auto').reverse().sortBy('createdAt');
    if (lastAuto[0]?.fingerprint === fingerprint) return null;
  }
  const wsIds = new Set(windows.flatMap((w) => w.tabs.map((t) => t.workspaceId).filter((x): x is string => !!x)));
  const snapshot: Snapshot = {
    id: newId(),
    name: (name?.trim() || (kind === 'auto' ? `Auto · ${stamp(now)}` : defaultName)).slice(0, 80),
    kind: snapKind,
    createdAt: now,
    windows,
    workspaces: [...wsIds]
      .map((id) => workspaces.get(id))
      .filter((w): w is Workspace => !!w)
      .map((w) => ({ id: w.id, name: w.name, color: w.color, summary: w.summary })),
    tabCount,
    fingerprint,
  };
  await db.snapshots.add(snapshot);
  if (kind === 'auto') await pruneAutoSnapshots();
  return snapshot;
}

async function pruneAutoSnapshots(): Promise<void> {
  const settings = await getSettings();
  const autos = await db.snapshots.where('kind').equals('auto').sortBy('createdAt');
  const excess = autos.length - settings.snapshots.keep;
  if (excess > 0) await db.snapshots.bulkDelete(autos.slice(0, excess).map((s) => s.id));
}

/** Make sure every workspace a snapshot refers to exists (recreating deleted ones). Returns id remapping. */
async function ensureSnapshotWorkspaces(snap: Snapshot): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const all = await db.workspaces.toArray();
  for (const w of snap.workspaces) {
    const byId = all.find((x) => x.id === w.id);
    if (byId) {
      map.set(w.id, byId.id);
      continue;
    }
    const byName = all.find((x) => x.name.toLowerCase() === w.name.toLowerCase());
    if (byName) {
      map.set(w.id, byName.id);
      continue;
    }
    const created = await createWorkspaceRecord({ id: w.id, name: w.name, color: w.color, summary: w.summary, source: 'manual' });
    all.push(created);
    map.set(w.id, created.id);
  }
  return map;
}

export async function restoreSnapshot(id: string, target: 'new-window' | 'current', lazyOpt?: boolean): Promise<Outcome> {
  const snap = await db.snapshots.get(id);
  if (!snap) throw new Error('Snapshot not found');
  const settings = await getSettings();
  const lazy = lazyOpt ?? settings.restore.lazy;
  const now = Date.now();
  const wsMap = await ensureSnapshotWorkspaces(snap);
  const reclose: Array<{ recordId: string; prevStatus: 'archived' | 'closed' }> = [];
  const allTabIds: number[] = [];
  const skipped: Outcome['skipped'] = [];
  let firstTab: chrome.tabs.Tab | null = null;

  for (const [wi, win] of snap.windows.entries()) {
    let windowId: number | null = target === 'current' && wi === 0 ? await targetWindowId() : null;
    const created: Array<{ tab: chrome.tabs.Tab; spec: SnapshotTab }> = [];
    for (const spec of win.tabs) {
      if (!isRestorableUrl(spec.url)) {
        skipped.push({ recordId: spec.recordId ?? spec.url, reason: 'This URL cannot be reopened' });
        continue;
      }
      try {
        let tab: chrome.tabs.Tab;
        if (windowId == null) {
          const w = await chrome.windows.create({ url: spec.url, focused: wi === 0 });
          windowId = w!.id!;
          tab = w!.tabs![0];
          if (spec.pinned) tab = (await chrome.tabs.update(tab.id!, { pinned: true })) ?? tab;
        } else {
          tab = await chrome.tabs.create({ windowId, url: spec.url, active: false, pinned: spec.pinned });
        }
        created.push({ tab, spec });
        allTabIds.push(tab.id!);
        firstTab ??= tab;

        const wsId = spec.workspaceId ? (wsMap.get(spec.workspaceId) ?? null) : null;
        const existing = spec.recordId ? await db.tabs.get(spec.recordId) : undefined;
        if (existing && !isLive(existing)) {
          reclose.push({ recordId: existing.id, prevStatus: existing.status === 'archived' ? 'archived' : 'closed' });
          await db.tabs.update(existing.id, { ...bindPatch(tab, now), workspaceId: wsId ?? existing.workspaceId, lastActiveAt: now });
        } else {
          const rec = recordFromTab(tab, now, wsId);
          rec.url = spec.url;
          rec.title = spec.title || rec.title;
          await db.tabs.add(rec);
          reclose.push({ recordId: rec.id, prevStatus: 'closed' });
        }
      } catch (err) {
        skipped.push({ recordId: spec.recordId ?? spec.url, reason: err instanceof Error ? err.message : 'Could not open' });
      }
    }
    for (const g of win.groups) {
      const tabIds = created.filter((c) => c.spec.groupKey === g.key && !c.spec.pinned).map((c) => c.tab.id!);
      if (!tabIds.length || windowId == null) continue;
      try {
        const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { title: g.title, color: g.color, collapsed: g.collapsed });
      } catch (err) {
        noteError('snapshot regroup', err);
      }
    }
  }
  const ft = firstTab as chrome.tabs.Tab | null;
  if (ft?.id != null) {
    try {
      await focusTab(ft.id, ft.windowId);
    } catch {
      /* ignore */
    }
  }
  const focusedId = (firstTab as chrome.tabs.Tab | null)?.id;
  if (lazy) discardWhenCommitted(allTabIds.filter((tid) => tid !== focusedId));
  const undo: UndoPayload | null = reclose.length ? { type: 'reclose', items: reclose } : null;
  return { count: allTabIds.length, skipped, undo };
}

export async function renameSnapshot(id: string, name: string): Promise<Outcome> {
  const n = name.trim();
  if (!n) throw new Error('Name is required');
  await db.snapshots.update(id, { name: n.slice(0, 80) });
  return { count: 1, skipped: [], undo: null };
}

export async function deleteSnapshot(id: string): Promise<Outcome> {
  const snap = await db.snapshots.get(id);
  if (!snap) throw new Error('Snapshot not found');
  await db.snapshots.delete(id);
  return { count: 1, skipped: [], undo: { type: 'snapshot-restore', snapshot: snap } };
}

export async function autoSnapshotTick(): Promise<void> {
  const settings = await getSettings();
  if (!settings.snapshots.autoEnabled) return;
  try {
    await createSnapshot({ kind: 'all' }, undefined, 'auto');
  } catch (err) {
    noteError('auto snapshot', err);
  }
}
