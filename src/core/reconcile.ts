// Matching stored tab records to the tabs Chrome currently has open.
//
// Chrome tab ids are only stable within one browser session. After a restart (or when the
// extension was disabled for a while) the same pages come back with new ids, so we rebuild the
// mapping by id + URL, then by URL, then by reviving records whose window closed recently.

import type { TabRecord } from '../shared/types';
import { normalizeUrl } from '../shared/url';

export interface ReconcileTab {
  id: number;
  windowId: number;
  index: number;
  url: string;
}

export interface ReconcileOptions {
  now: number;
  /** True when the service worker restarted inside the same browser session: tab ids are still valid. */
  sameSession: boolean;
  /** Whether live records without a tab should be marked closed now (false right after browser startup). */
  markMissing: boolean;
  /** Closed-with-window records younger than this can be revived by URL. */
  reviveWindowMs: number;
}

export type MatchKind = 'id' | 'url' | 'revived';

export interface ReconcilePlan {
  matched: Array<{ recordId: string; tabId: number; how: MatchKind }>;
  /** Tabs that need a brand-new record. */
  create: number[];
  /** Live records whose tab is gone; mark closed. */
  missing: string[];
  /** Live records with no match yet whose tab id must be cleared (ids from an old session). */
  detach: string[];
}

const isLive = (r: TabRecord) => r.status === 'open' || r.status === 'sleeping';

export function planReconcile(records: TabRecord[], tabs: ReconcileTab[], opts: ReconcileOptions): ReconcilePlan {
  const plan: ReconcilePlan = { matched: [], create: [], missing: [], detach: [] };
  const used = new Set<string>();
  const sortedTabs = [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  const live = records.filter(isLive);
  const pending: ReconcileTab[] = [];

  // 1. Same tab id (and, across sessions, the same URL).
  const byTabId = new Map<number, TabRecord>();
  for (const r of live) if (r.chromeTabId != null) byTabId.set(r.chromeTabId, r);
  for (const tab of sortedTabs) {
    const r = byTabId.get(tab.id);
    if (r && !used.has(r.id) && (opts.sameSession || sameUrl(r.url, tab.url))) {
      used.add(r.id);
      plan.matched.push({ recordId: r.id, tabId: tab.id, how: 'id' });
    } else pending.push(tab);
  }

  // 2. Same URL among unmatched live records, preferring a similar position in the strip.
  const liveByUrl = groupBy(live.filter((r) => !used.has(r.id)), (r) => normalizeUrl(r.url));
  const stillPending: ReconcileTab[] = [];
  for (const tab of pending) {
    const candidates = (liveByUrl.get(normalizeUrl(tab.url)) ?? []).filter((r) => !used.has(r.id));
    if (!candidates.length) {
      stillPending.push(tab);
      continue;
    }
    const best = candidates.sort(
      (a, b) =>
        Number(b.url === tab.url) - Number(a.url === tab.url) ||
        Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index) ||
        b.lastActiveAt - a.lastActiveAt,
    )[0];
    used.add(best.id);
    plan.matched.push({ recordId: best.id, tabId: tab.id, how: 'url' });
  }

  // 3. Revive records closed together with their window (browser shutdown, closed window restored).
  const revivable = records.filter(
    (r) =>
      r.status === 'closed' &&
      (r.closeReason === 'window-closed' || r.closeReason === 'missing') &&
      r.closedAt != null &&
      opts.now - r.closedAt <= opts.reviveWindowMs,
  );
  const revByUrl = groupBy(revivable, (r) => normalizeUrl(r.url));
  for (const tab of stillPending) {
    const candidates = (revByUrl.get(normalizeUrl(tab.url)) ?? []).filter((r) => !used.has(r.id));
    if (!candidates.length) {
      plan.create.push(tab.id);
      continue;
    }
    const best = candidates.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0];
    used.add(best.id);
    plan.matched.push({ recordId: best.id, tabId: tab.id, how: 'revived' });
  }

  // 4. Live records that found no tab.
  for (const r of live) {
    if (used.has(r.id)) continue;
    if (opts.markMissing) plan.missing.push(r.id);
    else if (!opts.sameSession && r.chromeTabId != null) plan.detach.push(r.id);
  }
  return plan;
}

export function sameUrl(a: string, b: string): boolean {
  return a === b || normalizeUrl(a) === normalizeUrl(b);
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/**
 * When a single tab appears (late session restore, Ctrl+Shift+T), find an older record for the same
 * page that should be re-attached instead of creating a fresh one.
 */
export function findReviveCandidate(records: TabRecord[], url: string, now: number): TabRecord | null {
  const n = normalizeUrl(url);
  const candidates = records.filter((r) => {
    if (normalizeUrl(r.url) !== n) return false;
    if (isLive(r)) return r.chromeTabId == null; // detached after a restart
    if (r.status !== 'closed' || r.closedAt == null) return false;
    const age = now - r.closedAt;
    if (r.closeReason === 'window-closed' || r.closeReason === 'missing') return age <= 14 * 86_400_000;
    if (r.closeReason === 'user') return age <= 10 * 60_000;
    return false;
  });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || (b.closedAt ?? b.lastActiveAt) - (a.closedAt ?? a.lastActiveAt))[0];
}
