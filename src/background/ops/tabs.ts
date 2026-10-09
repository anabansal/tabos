// Tab-level operations. Each assumes it runs inside the serial queue and returns an Outcome that
// the router logs to the activity feed (with an undo payload when the action is reversible).

import { manualSleepBlocked } from '../../core/rules';
import { db } from '../../shared/db';
import type { OpenTarget } from '../../shared/messages';
import type { RestoreHint, TabPlacement, TabRecord, UndoPayload } from '../../shared/types';
import { isDiscardableUrl, isRestorableUrl } from '../../shared/url';
import { type Outcome, emptyOutcome } from '../activity';
import { DASHBOARD_URL, getSettings, getTab, noteError, sleep, targetWindowId, windowExists } from '../context';
import { groupWorkspaceInChrome, placeTabForWorkspace } from '../groups';
import { bindPatch, isLive, recordsByIds } from '../records';
import { session } from '../session';

type Skipped = Outcome['skipped'];

async function workspaceProtection(): Promise<Map<string, boolean>> {
  const all = await db.workspaces.toArray();
  return new Map(all.map((w) => [w.id, w.isProtected]));
}

async function setAutoDiscardable(tabId: number, value: boolean): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: value });
  } catch {
    /* tab gone */
  }
}

// ---------- focus / open ----------

export async function focusTab(tabId: number, windowId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}

export async function focusRecord(recordId: string): Promise<Outcome> {
  const rec = await db.tabs.get(recordId);
  if (!rec) throw new Error('That tab is no longer in TabOS.');
  if (isLive(rec)) {
    const tab = await getTab(rec.chromeTabId!);
    if (tab) {
      await focusTab(tab.id!, tab.windowId);
      return { count: 1, skipped: [], undo: null };
    }
    // Stale binding (tab vanished without an event). Treat as closed and reopen it.
    await db.tabs.update(rec.id, { status: 'closed', closeReason: 'missing', closedAt: Date.now(), chromeTabId: null, active: false });
  }
  return openRecords([recordId], { focus: true, lazy: false });
}

export interface OpenOptions {
  target?: OpenTarget;
  lazy?: boolean;
  focus?: boolean;
  /** After opening, put the workspace's tabs into Chrome tab groups. */
  groupWorkspace?: string;
}

/**
 * Open tabs that are not live (archived or closed). With `lazy`, all but the focused tab are
 * discarded as soon as their navigation commits so a big restore doesn't load every page at once.
 */
export async function openRecords(ids: string[], opts: OpenOptions = {}): Promise<Outcome & { tabIds: number[] }> {
  const now = Date.now();
  const settings = await getSettings();
  const lazy = opts.lazy ?? settings.restore.lazy;
  const focus = opts.focus ?? true;
  const target = opts.target ?? 'auto';
  const recs = await recordsByIds(ids);
  const skipped: Skipped = [];
  const toOpen: TabRecord[] = [];
  for (const r of recs) {
    if (isLive(r)) skipped.push({ recordId: r.id, reason: 'Already open' });
    else if (!isRestorableUrl(r.url)) skipped.push({ recordId: r.id, reason: 'This URL cannot be reopened' });
    else toOpen.push(r);
  }
  if (!toOpen.length) {
    const live = recs.find(isLive);
    if (focus && live && recs.length === 1) return { ...(await focusRecord(live.id)), tabIds: [] };
    return { count: 0, skipped, undo: null, tabIds: [] };
  }
  toOpen.sort(
    (a, b) =>
      (a.restoreHint?.windowId ?? 0) - (b.restoreHint?.windowId ?? 0) || (a.restoreHint?.index ?? 0) - (b.restoreHint?.index ?? 0),
  );

  const windowAlive = new Map<number, boolean>();
  let fallbackWindow: number | null = null;
  let newWindowId: number | null = null;
  const created: Array<{ rec: TabRecord; tab: chrome.tabs.Tab }> = [];

  for (const rec of toOpen) {
    const hint = rec.restoreHint;
    try {
      let tab: chrome.tabs.Tab | undefined;
      let windowId: number;
      if (target === 'new-window') {
        if (newWindowId == null) {
          const win = await chrome.windows.create({ url: rec.url, focused: focus });
          newWindowId = win!.id!;
          tab = win!.tabs?.[0];
          if (tab?.id != null && hint?.pinned) tab = (await chrome.tabs.update(tab.id, { pinned: true })) ?? tab;
        }
        windowId = newWindowId;
      } else if (target === 'current') {
        windowId = fallbackWindow ??= await targetWindowId();
      } else {
        const hinted = hint?.windowId;
        let alive = false;
        if (hinted != null) {
          if (!windowAlive.has(hinted)) windowAlive.set(hinted, await windowExists(hinted));
          alive = windowAlive.get(hinted)!;
        }
        windowId = alive ? hinted! : (fallbackWindow ??= await targetWindowId());
      }
      if (!tab) {
        tab = await chrome.tabs.create({
          windowId,
          url: rec.url,
          active: false,
          pinned: !!hint?.pinned,
          index: target === 'auto' && windowId === hint?.windowId ? hint?.index : undefined,
        });
      }
      await db.tabs.update(rec.id, { ...bindPatch(tab, now), lastActiveAt: now });
      created.push({ rec, tab });
    } catch (err) {
      skipped.push({ recordId: rec.id, reason: err instanceof Error ? err.message : 'Could not open tab' });
    }
  }

  for (const { rec, tab } of created) {
    if (tab.id == null) continue;
    if (rec.isProtected) await setAutoDiscardable(tab.id, false);
    if (rec.workspaceId) await placeTabForWorkspace(tab.id, tab.windowId, -1, rec.workspaceId);
    else if (rec.restoreHint?.groupTitle) await addToGroupByTitle(tab, rec.restoreHint);
  }
  if (opts.groupWorkspace) {
    try {
      await groupWorkspaceInChrome(opts.groupWorkspace, newWindowId ?? undefined);
    } catch (err) {
      noteError('regroup workspace', err);
    }
  }
  const first = created[0]?.tab;
  if (focus && first?.id != null) {
    try {
      await focusTab(first.id, first.windowId);
    } catch {
      /* ignore */
    }
  }
  const tabIds = created.map((c) => c.tab.id!).filter((id) => id != null);
  if (lazy) discardWhenCommitted(tabIds.filter((id) => !(focus && id === first?.id)));
  const undo: UndoPayload | null = created.length
    ? { type: 'reclose', items: created.map((c) => ({ recordId: c.rec.id, prevStatus: c.rec.status === 'closed' ? 'closed' : 'archived' })) }
    : null;
  return { count: created.length, skipped, undo, tabIds };
}

async function addToGroupByTitle(tab: chrome.tabs.Tab, hint: RestoreHint): Promise<void> {
  try {
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: hint.groupTitle });
    if (groups[0]) await chrome.tabs.group({ groupId: groups[0].id, tabIds: tab.id! });
  } catch {
    /* ignore */
  }
}

/** Discard freshly-created background tabs once their navigation has committed (URL known). */
export function discardWhenCommitted(tabIds: number[]): void {
  if (!tabIds.length) return;
  void (async () => {
    for (const id of tabIds) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const t = await getTab(id);
        if (!t || t.active || t.discarded) break;
        if (t.url && !t.pendingUrl && isDiscardableUrl(t.url)) {
          try {
            await chrome.tabs.discard(id);
          } catch {
            /* tab became active or uses a protected page */
          }
          break;
        }
        if (t.url && !isDiscardableUrl(t.url) && !t.pendingUrl) break;
        await sleep(250);
      }
    }
  })();
}

// ---------- sleep / wake ----------

export async function sleepRecords(ids: string[]): Promise<Outcome> {
  const settings = await getSettings();
  const wsProtected = await workspaceProtection();
  const recs = await recordsByIds(ids);
  const skipped: Skipped = [];
  const slept: string[] = [];
  for (const rec of recs) {
    if (!isLive(rec)) {
      skipped.push({ recordId: rec.id, reason: 'Not open' });
      continue;
    }
    const tab = await getTab(rec.chromeTabId!);
    if (!tab) {
      skipped.push({ recordId: rec.id, reason: 'Tab no longer exists' });
      continue;
    }
    const blocked = manualSleepBlocked(
      { tab: { ...tab, url: tab.url ?? rec.url }, record: rec, workspaceProtected: !!(rec.workspaceId && wsProtected.get(rec.workspaceId)) },
      settings,
    );
    if (blocked) {
      skipped.push({ recordId: rec.id, reason: blocked });
      continue;
    }
    if (await discardTab(rec, tab.id!)) slept.push(rec.id);
    else skipped.push({ recordId: rec.id, reason: 'Chrome declined to discard this tab' });
  }
  return { count: slept.length, skipped, undo: slept.length ? { type: 'wake', recordIds: slept } : null };
}

/** Discard one tab and mirror the result into its record. */
export async function discardTab(rec: TabRecord, tabId: number): Promise<boolean> {
  try {
    const d = await chrome.tabs.discard(tabId);
    if (!d) return false;
    const now = Date.now();
    await db.tabs.update(rec.id, { status: 'sleeping', sleptAt: now, chromeTabId: d.id ?? tabId, updatedAt: now });
    return true;
  } catch {
    return false;
  }
}

export async function wakeRecords(ids: string[]): Promise<Outcome> {
  const recs = await recordsByIds(ids);
  const skipped: Skipped = [];
  let count = 0;
  for (const rec of recs) {
    if (!isLive(rec)) {
      skipped.push({ recordId: rec.id, reason: 'Not open' });
      continue;
    }
    const tab = await getTab(rec.chromeTabId!);
    if (!tab?.discarded) {
      skipped.push({ recordId: rec.id, reason: 'Already awake' });
      continue;
    }
    try {
      await chrome.tabs.reload(tab.id!);
      await db.tabs.update(rec.id, { status: 'open', sleptAt: null, updatedAt: Date.now() });
      count++;
    } catch {
      skipped.push({ recordId: rec.id, reason: 'Could not reload' });
    }
  }
  return { count, skipped, undo: null };
}

// ---------- archive / close ----------

/** Never close the last tab of the last window (that would quit Chrome). */
async function keepBrowserOpen(closing: Set<number>): Promise<void> {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const remaining = new Map<number, number>();
  for (const t of tabs) {
    if (t.incognito) continue;
    remaining.set(t.windowId, (remaining.get(t.windowId) ?? 0) + (closing.has(t.id!) ? 0 : 1));
  }
  if (!remaining.size || [...remaining.values()].some((n) => n > 0)) return;
  let windowId = [...remaining.keys()][0];
  try {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (w.id != null && remaining.has(w.id)) windowId = w.id;
  } catch {
    /* use first */
  }
  await chrome.tabs.create({ windowId, url: `${DASHBOARD_URL}#/tabs?status=archived`, active: true });
}

type DetachMode = { kind: 'archive'; reason: string } | { kind: 'close'; reason: 'tabos' | 'duplicate' };

async function detachAndRemove(ids: string[], mode: DetachMode): Promise<Outcome> {
  const now = Date.now();
  const recs = await recordsByIds(ids);
  const cache = await session.getGroupCache();
  const skipped: Skipped = [];
  const targets: Array<{ rec: TabRecord; tab: chrome.tabs.Tab | null }> = [];
  const offline: TabRecord[] = [];
  for (const rec of recs) {
    if (isLive(rec)) {
      if (rec.isProtected) {
        skipped.push({ recordId: rec.id, reason: 'Protected tab (unprotect it first)' });
        continue;
      }
      targets.push({ rec, tab: await getTab(rec.chromeTabId!) });
    } else if (mode.kind === 'archive' && rec.status === 'closed') offline.push(rec);
    else skipped.push({ recordId: rec.id, reason: rec.status === 'archived' ? 'Already archived' : 'Not open' });
  }
  const tabIds = targets.map((t) => t.tab?.id).filter((id): id is number => id != null);
  if (tabIds.length) await keepBrowserOpen(new Set(tabIds));

  const placements: TabPlacement[] = [];
  await db.transaction('rw', db.tabs, async () => {
    for (const { rec, tab } of targets) {
      const group = tab && tab.groupId >= 0 ? cache[tab.groupId] : undefined;
      const hint: RestoreHint = {
        windowId: tab?.windowId ?? rec.windowId ?? undefined,
        index: tab?.index ?? rec.index,
        pinned: tab?.pinned ?? rec.pinned,
        groupTitle: group?.title || undefined,
        groupColor: group?.color,
      };
      placements.push({ recordId: rec.id, hint });
      const statusPatch: Partial<TabRecord> =
        mode.kind === 'archive'
          ? { status: 'archived', archivedAt: now, archiveReason: mode.reason, closedAt: null, closeReason: null }
          : { status: 'closed', closedAt: now, closeReason: mode.reason };
      await db.tabs.update(rec.id, {
        ...statusPatch,
        title: tab?.title || rec.title,
        chromeTabId: null,
        active: false,
        groupId: -1,
        restoreHint: hint,
        updatedAt: now,
      });
    }
    for (const rec of offline) {
      await db.tabs.update(rec.id, { status: 'archived', archivedAt: now, archiveReason: mode.reason, updatedAt: now });
    }
  });

  if (tabIds.length) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch (err) {
      noteError('tabs.remove', err);
    }
  }
  // Anything that refused to close (e.g. a beforeunload prompt) goes back to being live.
  const survivors = new Set<string>();
  for (const { rec, tab } of targets) {
    if (!tab?.id) continue;
    const still = await getTab(tab.id);
    if (still) {
      survivors.add(rec.id);
      await db.tabs.update(rec.id, { ...bindPatch(still, now), restoreHint: null });
      skipped.push({ recordId: rec.id, reason: 'The page refused to close' });
    }
  }
  const reopen = placements.filter((p) => !survivors.has(p.recordId));
  const parts: UndoPayload[] = [];
  if (reopen.length) parts.push({ type: 'reopen', placements: reopen });
  if (offline.length) parts.push({ type: 'reclose', items: offline.map((r) => ({ recordId: r.id, prevStatus: 'closed' as const })) });
  const count = reopen.length + offline.length;
  return { count, skipped, undo: parts.length === 0 ? null : parts.length === 1 ? parts[0] : { type: 'composite', parts } };
}

export function archiveRecords(ids: string[], reason = 'manual'): Promise<Outcome> {
  return detachAndRemove(ids, { kind: 'archive', reason });
}

export function closeRecords(ids: string[], reason: 'tabos' | 'duplicate' = 'tabos'): Promise<Outcome> {
  return detachAndRemove(ids, { kind: 'close', reason });
}

/** Permanently remove archived/closed records. Only ever called on explicit user request. */
export async function deleteRecords(ids: string[]): Promise<Outcome> {
  const recs = await recordsByIds(ids);
  const deletable = recs.filter((r) => !isLive(r));
  const skipped = recs.filter(isLive).map((r) => ({ recordId: r.id, reason: 'Open tabs must be closed or archived first' }));
  if (!deletable.length) return { ...emptyOutcome(), skipped };
  await db.tabs.bulkDelete(deletable.map((r) => r.id));
  return { count: deletable.length, skipped, undo: { type: 'records-restore', records: deletable } };
}

// ---------- assign / protect ----------

export async function assignRecords(ids: string[], workspaceId: string | null): Promise<Outcome> {
  if (workspaceId && !(await db.workspaces.get(workspaceId))) throw new Error('Workspace not found');
  const recs = await recordsByIds(ids);
  const now = Date.now();
  const changes: Array<{ recordId: string; prevWorkspaceId: string | null }> = [];
  for (const rec of recs) {
    if (rec.workspaceId === workspaceId) continue;
    changes.push({ recordId: rec.id, prevWorkspaceId: rec.workspaceId });
    await db.tabs.update(rec.id, { workspaceId, updatedAt: now });
    if (isLive(rec) && rec.windowId != null) await placeTabForWorkspace(rec.chromeTabId!, rec.windowId, rec.groupId, workspaceId);
  }
  return {
    count: changes.length,
    skipped: [],
    undo: changes.length ? { type: 'assign', changes, createdWorkspaceIds: [] } : null,
  };
}

export async function protectRecords(ids: string[], value: boolean): Promise<Outcome> {
  const recs = await recordsByIds(ids);
  const changes: Array<{ recordId: string; prev: boolean }> = [];
  for (const rec of recs) {
    if (rec.isProtected === value) continue;
    changes.push({ recordId: rec.id, prev: rec.isProtected });
    await db.tabs.update(rec.id, { isProtected: value, updatedAt: Date.now() });
    // Also opt the tab out of Chrome's own Memory Saver while protected.
    if (isLive(rec)) await setAutoDiscardable(rec.chromeTabId!, !value);
  }
  return { count: changes.length, skipped: [], undo: changes.length ? { type: 'protect', changes } : null };
}

export async function sleepOthers(windowId?: number): Promise<Outcome> {
  const win = windowId ?? (await targetWindowId());
  const recs = (await db.tabs.where('windowId').equals(win).toArray()).filter((r) => isLive(r) && !r.active && r.status === 'open');
  return sleepRecords(recs.map((r) => r.id));
}

export async function currentRecord(): Promise<TabRecord | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id == null) return null;
  const list = await db.tabs.where('chromeTabId').equals(tab.id).toArray();
  return list[0] ?? null;
}

// ---------- windows ----------

/** Move live tabs into another window (or a new one). Tabs keep their records, workspaces and state. */
export async function moveRecords(ids: string[], windowId: number | 'new'): Promise<Outcome> {
  const recs = (await recordsByIds(ids)).filter(isLive);
  const skipped: Skipped = [];
  if (!recs.length) return { count: 0, skipped, undo: null };
  let target: number;
  let moved = 0;
  let rest = recs;
  if (windowId === 'new') {
    const first = recs[0];
    const win = await chrome.windows.create({ tabId: first.chromeTabId!, focused: true });
    target = win!.id!;
    moved = 1;
    rest = recs.slice(1);
  } else {
    if (!(await windowExists(windowId))) throw new Error('That window is no longer open');
    target = windowId;
  }
  for (const r of rest) {
    if (r.windowId === target) continue;
    try {
      if (r.pinned) await chrome.tabs.update(r.chromeTabId!, { pinned: false }).catch(() => undefined);
      await chrome.tabs.move(r.chromeTabId!, { windowId: target, index: -1 });
      if (r.pinned) await chrome.tabs.update(r.chromeTabId!, { pinned: true }).catch(() => undefined);
      moved++;
    } catch (err) {
      skipped.push({ recordId: r.id, reason: err instanceof Error ? err.message : 'Could not move' });
    }
  }
  for (const r of recs) {
    const tab = await getTab(r.chromeTabId!);
    if (!tab) continue;
    // Chrome can briefly report the previous window right after a move; we know where it went.
    const windowId = skipped.some((x) => x.recordId === r.id) ? tab.windowId : target;
    await db.tabs.update(r.id, { windowId, index: tab.index, groupId: tab.groupId ?? -1 });
    if (r.workspaceId) await placeTabForWorkspace(tab.id!, windowId, tab.groupId ?? -1, r.workspaceId);
  }
  return { count: moved, skipped, undo: null };
}

/** Merge every normal window into one (the focused window by default). Groups are rebuilt by workspace. */
export async function mergeWindows(targetWindowIdOpt?: number): Promise<Outcome> {
  const target = targetWindowIdOpt ?? (await targetWindowId());
  const wins = (await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })).filter((w) => !w.incognito && w.id !== target);
  let count = 0;
  const skipped: Skipped = [];
  for (const w of wins) {
    // Move whole tab groups first so they stay intact, then loose tabs.
    const groupIds = new Set((w.tabs ?? []).map((t) => t.groupId).filter((g) => g >= 0));
    for (const g of groupIds) {
      try {
        await chrome.tabGroups.move(g, { windowId: target, index: -1 });
        count += (w.tabs ?? []).filter((t) => t.groupId === g).length;
      } catch {
        /* fall back to moving tabs individually below */
      }
    }
    const loose = (await chrome.tabs.query({ windowId: w.id })).filter((t) => t.groupId < 0 || groupIds.has(t.groupId));
    for (const t of loose) {
      try {
        const wasPinned = t.pinned;
        if (wasPinned) await chrome.tabs.update(t.id!, { pinned: false });
        await chrome.tabs.move(t.id!, { windowId: target, index: -1 });
        if (wasPinned) await chrome.tabs.update(t.id!, { pinned: true });
        count++;
      } catch (err) {
        skipped.push({ recordId: String(t.id), reason: err instanceof Error ? err.message : 'Could not move' });
      }
    }
  }
  const moved = await db.tabs.where('status').anyOf(['open', 'sleeping']).toArray();
  for (const r of moved) {
    if (r.chromeTabId == null) continue;
    const tab = await getTab(r.chromeTabId);
    if (tab && (tab.windowId !== r.windowId || tab.index !== r.index)) {
      await db.tabs.update(r.id, { windowId: tab.windowId, index: tab.index, groupId: tab.groupId ?? -1 });
    }
  }
  await chrome.windows.update(target, { focused: true }).catch(() => undefined);
  return { count, skipped, undo: null };
}
