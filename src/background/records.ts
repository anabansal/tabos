import { db, newId } from '../shared/db';
import type { TabRecord } from '../shared/types';
import { displayUrl, getDomain, normalizeUrl } from '../shared/url';

export function tabUrl(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || '';
}

function cleanFavicon(url: string | undefined): string {
  if (!url) return '';
  if (url.length > 2048) return '';
  return /^https?:/.test(url) ? url : '';
}

export function recordFromTab(tab: chrome.tabs.Tab, now: number, workspaceId: string | null): TabRecord {
  const url = tabUrl(tab);
  const lastAccessed = typeof tab.lastAccessed === 'number' && tab.lastAccessed > 0 ? Math.min(tab.lastAccessed, now) : now;
  return {
    id: newId(),
    chromeTabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    index: tab.index,
    url,
    normalizedUrl: normalizeUrl(url),
    title: tab.title || displayUrl(url),
    favIconUrl: cleanFavicon(tab.favIconUrl),
    domain: getDomain(url),
    status: tab.discarded ? 'sleeping' : 'open',
    workspaceId,
    pinned: tab.pinned,
    audible: !!tab.audible,
    muted: !!tab.mutedInfo?.muted,
    active: tab.active,
    groupId: tab.groupId ?? -1,
    isProtected: false,
    createdAt: now,
    lastActiveAt: tab.active ? now : lastAccessed,
    updatedAt: now,
    activations: 0,
    sleptAt: tab.discarded ? now : null,
    archivedAt: null,
    archiveReason: null,
    closedAt: null,
    closeReason: null,
    restoreHint: null,
    meta: null,
  };
}

/**
 * Fields of a record that mirror the live tab. Returns null when nothing changed.
 * @param positional also copy windowId/index. Tab objects delivered with onUpdated can carry a
 *   stale window right after a move, so event handlers leave position to onMoved/onAttached.
 */
export function livePatch(rec: TabRecord, tab: chrome.tabs.Tab, now: number, positional = true): Partial<TabRecord> | null {
  const patch: Partial<TabRecord> = {};
  const url = tabUrl(tab);
  if (url && url !== rec.url) {
    patch.url = url;
    patch.normalizedUrl = normalizeUrl(url);
    patch.domain = getDomain(url);
    if (rec.meta) patch.meta = null; // metadata belonged to the previous page
    if (tab.active) patch.lastActiveAt = now;
  }
  if (tab.title && tab.title !== rec.title) patch.title = tab.title;
  const fav = cleanFavicon(tab.favIconUrl);
  if (fav && fav !== rec.favIconUrl) patch.favIconUrl = fav;
  const status = tab.discarded ? 'sleeping' : 'open';
  if (status !== rec.status) {
    patch.status = status;
    patch.sleptAt = tab.discarded ? now : null;
  }
  if (tab.pinned !== rec.pinned) patch.pinned = tab.pinned;
  if (!!tab.audible !== rec.audible) patch.audible = !!tab.audible;
  if (!!tab.mutedInfo?.muted !== rec.muted) patch.muted = !!tab.mutedInfo?.muted;
  if (tab.active !== rec.active) patch.active = tab.active;
  const groupId = tab.groupId ?? -1;
  if (groupId !== rec.groupId) patch.groupId = groupId;
  if (positional && tab.windowId !== rec.windowId) patch.windowId = tab.windowId;
  if (positional && tab.index !== rec.index) patch.index = tab.index;
  if (tab.id != null && tab.id !== rec.chromeTabId) patch.chromeTabId = tab.id;
  if (!Object.keys(patch).length) return null;
  patch.updatedAt = now;
  return patch;
}

/** Attach an archived/closed/detached record to a live tab. */
export function bindPatch(tab: chrome.tabs.Tab, now: number): Partial<TabRecord> {
  return {
    chromeTabId: tab.id ?? null,
    windowId: tab.windowId,
    index: tab.index,
    status: tab.discarded ? 'sleeping' : 'open',
    active: tab.active,
    groupId: tab.groupId ?? -1,
    pinned: tab.pinned,
    archivedAt: null,
    archiveReason: null,
    closedAt: null,
    closeReason: null,
    updatedAt: now,
  };
}

export async function recordByTabId(tabId: number): Promise<TabRecord | undefined> {
  const list = await db.tabs.where('chromeTabId').equals(tabId).toArray();
  if (list.length <= 1) return list[0];
  // Should never happen, but if two records claim one tab keep the live one with the newest activity.
  list.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  for (const extra of list.slice(1)) await db.tabs.update(extra.id, { chromeTabId: null });
  return list[0];
}

export async function liveRecords(): Promise<TabRecord[]> {
  return db.tabs.where('status').anyOf(['open', 'sleeping']).toArray();
}

export async function recordsByIds(ids: string[]): Promise<TabRecord[]> {
  const got = await db.tabs.bulkGet(ids);
  return got.filter((r): r is TabRecord => !!r);
}

export const isLive = (r: TabRecord) => (r.status === 'open' || r.status === 'sleeping') && r.chromeTabId != null;
