// Mirrors Chrome's tabs into TabRecords. Every handler runs inside the serial queue.

import { planReconcile, findReviveCandidate } from '../core/reconcile';
import { db } from '../shared/db';
import type { RestoreHint, TabRecord } from '../shared/types';
import { isTrackableUrl, normalizeUrl } from '../shared/url';
import { OWN_ORIGIN, getSettings, liveTabs, noteError, status } from './context';
import { onGroupChanged, placeTabForWorkspace, resyncGroups } from './groups';
import { bindPatch, livePatch, recordByTabId, recordFromTab, tabUrl } from './records';
import { session } from './session';
import { maybeCollectMeta } from './metadata';

const REVIVE_WINDOW_MS = 14 * 86_400_000;

const trackable = (tab: chrome.tabs.Tab) => !tab.incognito && tab.id != null && isTrackableUrl(tabUrl(tab), OWN_ORIGIN);

/** Which workspace a brand-new tab should join. */
async function inferWorkspace(tab: chrome.tabs.Tab): Promise<string | null> {
  const fromGroup = await session.workspaceForGroup(tab.groupId ?? -1);
  if (fromGroup) return fromGroup;
  const settings = await getSettings();
  if (!settings.workspaces.autoAssignNewTabs) return null;
  if (tab.openerTabId != null) {
    const opener = await recordByTabId(tab.openerTabId);
    if (opener) return opener.workspaceId;
  }
  const fromWindow = await session.getWindowWorkspace(tab.windowId);
  if (fromWindow && (await db.workspaces.get(fromWindow))) return fromWindow;
  // The tab the user was on in this window when the new tab appeared (Ctrl+T, external link).
  const siblings = await db.tabs.where('windowId').equals(tab.windowId).toArray();
  const prev = siblings
    .filter((r) => r.chromeTabId !== tab.id && (r.status === 'open' || r.status === 'sleeping'))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  return prev?.workspaceId ?? null;
}

async function protectLiveTab(tabId: number, isProtected: boolean): Promise<void> {
  if (!isProtected) return;
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch {
    /* tab gone */
  }
}

/** Create a record for a tab we haven't seen, or re-attach an old record for the same page. */
async function adoptTab(tab: chrome.tabs.Tab): Promise<TabRecord | null> {
  const url = tabUrl(tab);
  const now = Date.now();
  const sameUrl = await db.tabs.where('normalizedUrl').equals(normalizeUrl(url)).toArray();
  const revive = findReviveCandidate(sameUrl, url, now);
  if (revive) {
    const patch = { ...bindPatch(tab, now), ...(livePatch({ ...revive, ...bindPatch(tab, now) } as TabRecord, tab, now) ?? {}) };
    await db.tabs.update(revive.id, patch);
    await protectLiveTab(tab.id!, revive.isProtected);
    return { ...revive, ...patch };
  }
  const rec = recordFromTab(tab, now, await inferWorkspace(tab));
  await db.tabs.add(rec);
  if (rec.workspaceId && tab.groupId === -1) await placeTabForWorkspace(tab.id!, tab.windowId, -1, rec.workspaceId);
  return rec;
}

export async function handleCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.incognito || tab.id == null) return;
  const existing = await recordByTabId(tab.id);
  if (existing) {
    const patch = livePatch(existing, tab, Date.now());
    if (patch) await db.tabs.update(existing.id, patch);
    return;
  }
  if (trackable(tab)) await adoptTab(tab);
}

export async function handleUpdated(tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): Promise<void> {
  if (tab.incognito) return;
  const now = Date.now();
  let rec = await recordByTabId(tabId);
  if (!rec) {
    if (trackable(tab)) await adoptTab(tab);
    return;
  }
  if (change.url !== undefined && !isTrackableUrl(change.url, OWN_ORIGIN)) {
    // Navigated to a new-tab page or a TabOS page: the record's page is gone from this tab.
    await db.tabs.update(rec.id, { status: 'closed', closeReason: 'user', closedAt: now, chromeTabId: null, active: false, updatedAt: now });
    return;
  }
  // A just-created tab whose real URL only now became known may be a restored page (Ctrl+Shift+T).
  if (change.url && rec.activations === 0 && now - rec.createdAt < 30_000) {
    const sameUrl = (await db.tabs.where('normalizedUrl').equals(normalizeUrl(change.url)).toArray()).filter((r) => r.id !== rec!.id);
    const revive = findReviveCandidate(sameUrl, change.url, now);
    if (revive) {
      await db.tabs.delete(rec.id);
      const patch = { ...bindPatch(tab, now), ...(livePatch({ ...revive, ...bindPatch(tab, now) } as TabRecord, tab, now) ?? {}) };
      await db.tabs.update(revive.id, patch);
      return;
    }
  }
  const patch = livePatch(rec, tab, now, false);
  if (patch) {
    await db.tabs.update(rec.id, patch);
    rec = { ...rec, ...patch };
  }
  if (change.groupId !== undefined && change.groupId >= 0) {
    const wsId = await session.workspaceForGroup(change.groupId);
    if (wsId && wsId !== rec.workspaceId) await db.tabs.update(rec.id, { workspaceId: wsId, updatedAt: now });
  }
  if (change.status === 'complete') void maybeCollectMeta(rec, tab);
}

export async function handleActivated(info: chrome.tabs.OnActivatedInfo): Promise<void> {
  const now = Date.now();
  const inWindow = await db.tabs.where('windowId').equals(info.windowId).toArray();
  await Promise.all(
    inWindow.filter((r) => r.active && r.chromeTabId !== info.tabId).map((r) => db.tabs.update(r.id, { active: false })),
  );
  const rec = await recordByTabId(info.tabId);
  if (!rec) return;
  await db.tabs.update(rec.id, {
    active: true,
    lastActiveAt: now,
    activations: rec.activations + 1,
    status: 'open',
    sleptAt: null,
    windowId: info.windowId,
    updatedAt: now,
  });
  if (rec.workspaceId) await db.workspaces.update(rec.workspaceId, { lastActiveAt: now });
}

export async function handleRemoved(tabId: number, info: chrome.tabs.OnRemovedInfo): Promise<void> {
  const rec = await recordByTabId(tabId);
  if (!rec) return; // archived/closed through TabOS (already detached) or never tracked
  const now = Date.now();
  const cache = await session.getGroupCache();
  const group = rec.groupId >= 0 ? cache[rec.groupId] : undefined;
  const hint: RestoreHint = {
    windowId: info.windowId,
    index: rec.index,
    pinned: rec.pinned,
    groupTitle: group?.title || undefined,
    groupColor: group?.color,
  };
  await db.tabs.update(rec.id, {
    status: 'closed',
    closeReason: info.isWindowClosing ? 'window-closed' : 'user',
    closedAt: now,
    chromeTabId: null,
    active: false,
    restoreHint: hint,
    updatedAt: now,
  });
}

export async function handleReplaced(addedTabId: number, removedTabId: number): Promise<void> {
  const rec = await recordByTabId(removedTabId);
  const tab = await chrome.tabs.get(addedTabId).catch(() => null);
  if (!rec) {
    if (tab && trackable(tab)) await adoptTab(tab);
    return;
  }
  const now = Date.now();
  await db.tabs.update(rec.id, { chromeTabId: addedTabId, updatedAt: now });
  if (tab) {
    const patch = livePatch({ ...rec, chromeTabId: addedTabId }, tab, now);
    if (patch) await db.tabs.update(rec.id, patch);
  }
}

export async function handleMoved(tabId: number, windowId: number, index: number): Promise<void> {
  const rec = await recordByTabId(tabId);
  if (rec && (rec.windowId !== windowId || rec.index !== index)) await db.tabs.update(rec.id, { windowId, index });
}

export async function handleGroupEvent(group: chrome.tabGroups.TabGroup): Promise<void> {
  await onGroupChanged(group);
}

export interface ReconcileSummary {
  matched: number;
  created: number;
  missing: number;
  revived: number;
}

/**
 * Bring the database in line with Chrome's actual tabs. Idempotent; safe to run on every worker start.
 * @param sameSession tab ids from storage are still valid (worker restart, not a browser restart)
 * @param markMissing mark records whose tab is gone as closed
 */
export async function reconcile(opts: { sameSession: boolean; markMissing: boolean }): Promise<ReconcileSummary> {
  const now = Date.now();
  const tabs = (await liveTabs()).filter(trackable);
  const records = await db.tabs.toArray();
  const plan = planReconcile(
    records,
    tabs.map((t) => ({ id: t.id!, windowId: t.windowId, index: t.index, url: tabUrl(t) })),
    { now, sameSession: opts.sameSession, markMissing: opts.markMissing, reviveWindowMs: REVIVE_WINDOW_MS },
  );
  const tabById = new Map(tabs.map((t) => [t.id!, t]));
  const recById = new Map(records.map((r) => [r.id, r]));

  await db.transaction('rw', db.tabs, async () => {
    // Clear ids first so a stale id from the previous session can never collide with a live tab.
    for (const id of plan.detach) await db.tabs.update(id, { chromeTabId: null, active: false });
    for (const m of plan.matched) {
      const rec = recById.get(m.recordId)!;
      const tab = tabById.get(m.tabId)!;
      const base = m.how === 'id' ? rec : ({ ...rec, ...bindPatch(tab, now) } as TabRecord);
      const patch = { ...(m.how === 'id' ? {} : bindPatch(tab, now)), ...(livePatch(base, tab, now) ?? {}) };
      if (Object.keys(patch).length) await db.tabs.update(rec.id, patch);
    }
    for (const id of plan.missing) {
      await db.tabs.update(id, { status: 'closed', closeReason: 'missing', closedAt: now, chromeTabId: null, active: false, updatedAt: now });
    }
  });
  for (const tabId of plan.create) {
    const tab = tabById.get(tabId);
    if (tab) await db.tabs.add(recordFromTab(tab, now, null));
  }
  for (const m of plan.matched) {
    const rec = recById.get(m.recordId);
    if (rec?.isProtected) await protectLiveTab(m.tabId, true);
  }
  await resyncGroups();
  status.lastReconcileAt = now;
  return {
    matched: plan.matched.length,
    created: plan.create.length,
    missing: plan.missing.length,
    revived: plan.matched.filter((m) => m.how === 'revived').length,
  };
}

export async function safeReconcile(opts: { sameSession: boolean; markMissing: boolean }): Promise<ReconcileSummary | null> {
  try {
    return await reconcile(opts);
  } catch (err) {
    noteError('reconcile', err);
    return null;
  }
}
