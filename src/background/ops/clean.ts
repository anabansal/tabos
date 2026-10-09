// "Clean" preview/execute plus the scheduled automation (auto-sleep, auto-archive, pruning).

import { suggestArchival } from '../../ai/smartArchive';
import { findDuplicateGroups } from '../../core/duplicates';
import { lastActivity, protectionReasons, sleepDecision, formatDuration, type LiveTabState } from '../../core/rules';
import { db } from '../../shared/db';
import type { CleanResult } from '../../shared/messages';
import type { CleanCandidate, CleanPreview, MemoryReading, UndoPayload } from '../../shared/types';
import { finish, logActivity, plural, type Outcome } from '../activity';
import { getSettings, liveTabs } from '../context';
import { isLive, liveRecords } from '../records';
import { archiveRecords, closeRecords, discardTab, sleepRecords } from './tabs';
import { notifyAutoArchive } from '../notify';

export async function readMemory(): Promise<MemoryReading | null> {
  try {
    const info = await chrome.system.memory.getInfo();
    return { capacityBytes: info.capacity, availableBytes: info.availableCapacity, at: Date.now() };
  } catch {
    return null;
  }
}

async function liveState() {
  const [tabs, records, workspaces, settings] = await Promise.all([liveTabs(), liveRecords(), db.workspaces.toArray(), getSettings()]);
  const tabsById = new Map<number, LiveTabState & { id: number }>();
  for (const t of tabs) tabsById.set(t.id!, { ...t, id: t.id!, url: t.url || t.pendingUrl || '' });
  const wsProtected = new Map(workspaces.map((w) => [w.id, w.isProtected]));
  return { tabsById, records: records.filter(isLive), workspaces, settings, wsProtected };
}

export async function previewClean(opts: { sleepAfterMinutes?: number; archiveAfterDays?: number }): Promise<CleanPreview> {
  const now = Date.now();
  const { tabsById, records, workspaces, settings, wsProtected } = await liveState();
  const sleep: CleanCandidate[] = [];
  let protectedCount = 0;
  const threshold = opts.sleepAfterMinutes ?? settings.sleep.afterMinutes;
  for (const rec of records) {
    const tab = tabsById.get(rec.chromeTabId!);
    if (!tab) continue;
    const workspaceProtected = !!(rec.workspaceId && wsProtected.get(rec.workspaceId));
    const d = sleepDecision({ tab, record: rec, workspaceProtected }, settings, now, threshold);
    if (d.sleep) sleep.push({ recordId: rec.id, reasons: [`Inactive for ${formatDuration(d.inactiveMs)}`], score: d.inactiveMs });
    else if (d.why === 'protected' && !tab.active) protectedCount++;
  }
  sleep.sort((a, b) => b.score - a.score);
  const archive = suggestArchival({
    records,
    tabsById,
    workspaces,
    settings,
    now,
    afterDays: opts.archiveAfterDays ?? settings.archive.suggestAfterDays,
  });
  return { generatedAt: now, sleep, archive, duplicates: findDuplicateGroups(records), protectedCount };
}

export async function executeClean(req: { sleep: string[]; archive: string[]; close: string[] }): Promise<CleanResult> {
  const memoryBefore = await readMemory();
  const archiveSet = new Set(req.archive);
  const close = req.close.filter((id) => !archiveSet.has(id));
  const closeSet = new Set(close);
  const sleep = req.sleep.filter((id) => !archiveSet.has(id) && !closeSet.has(id));

  const outcomes: Outcome[] = [];
  const slept = sleep.length ? await sleepRecords(sleep) : null;
  const archived = req.archive.length ? await archiveRecords(req.archive, 'clean') : null;
  const closed = close.length ? await closeRecords(close, 'duplicate') : null;
  for (const o of [slept, archived, closed]) if (o) outcomes.push(o);
  const parts = outcomes.map((o) => o.undo).filter((u): u is UndoPayload => !!u);
  const count = outcomes.reduce((n, o) => n + o.count, 0);
  const labelParts = [
    slept?.count ? `slept ${slept.count}` : '',
    archived?.count ? `archived ${archived.count}` : '',
    closed?.count ? `closed ${plural(closed.count, 'duplicate')}` : '',
  ].filter(Boolean);
  const result = await finish('clean', () => `Clean: ${labelParts.join(', ')}`, {
    count,
    skipped: outcomes.flatMap((o) => o.skipped),
    undo: parts.length ? { type: 'composite', parts } : null,
  });
  return {
    ...result,
    slept: slept?.count ?? 0,
    archived: archived?.count ?? 0,
    closed: closed?.count ?? 0,
    memoryBefore,
  };
}

/** Scheduled: discard tabs that have been inactive longer than the configured threshold. */
export async function autoSleepTick(): Promise<number> {
  const settings = await getSettings();
  if (!settings.sleep.enabled) return 0;
  const now = Date.now();
  const { tabsById, records, wsProtected } = await liveState();
  const slept: string[] = [];
  for (const rec of records) {
    const tab = tabsById.get(rec.chromeTabId!);
    if (!tab) continue;
    const d = sleepDecision({ tab, record: rec, workspaceProtected: !!(rec.workspaceId && wsProtected.get(rec.workspaceId)) }, settings, now);
    if (d.sleep && (await discardTab(rec, tab.id))) slept.push(rec.id);
  }
  if (slept.length) {
    await logActivity('sleep', `Auto-slept ${plural(slept.length, 'inactive tab')}`, slept.length, { type: 'wake', recordIds: slept });
  }
  return slept.length;
}

/** Scheduled (opt-in): archive tabs inactive longer than archive.afterDays, then notify with Undo. */
export async function autoArchiveTick(): Promise<number> {
  const settings = await getSettings();
  if (settings.archive.mode !== 'auto') return 0;
  const now = Date.now();
  const { tabsById, records, wsProtected } = await liveState();
  const limit = settings.archive.afterDays * 86_400_000;
  const candidates = records
    .map((rec) => ({ rec, tab: tabsById.get(rec.chromeTabId!) }))
    .filter(({ rec, tab }) => {
      if (!tab) return false;
      const ws = !!(rec.workspaceId && wsProtected.get(rec.workspaceId));
      if (protectionReasons({ tab, record: rec, workspaceProtected: ws }, settings).length) return false;
      if (tab.pinned) return false; // even when pinned tabs aren't protected from sleep
      return now - lastActivity(tab, rec) >= limit;
    })
    .sort((a, b) => lastActivity(a.tab!, a.rec) - lastActivity(b.tab!, b.rec))
    .slice(0, settings.archive.maxPerRun);
  if (!candidates.length) return 0;
  const outcome = await archiveRecords(
    candidates.map((c) => c.rec.id),
    'auto',
  );
  if (!outcome.count) return 0;
  const result = await finish('auto-archive', (n) => `Auto-archived ${plural(n, 'tab')} inactive for ${settings.archive.afterDays}+ days`, outcome);
  if (result.activityId) await notifyAutoArchive(result.activityId, outcome.count);
  return outcome.count;
}

/** Daily housekeeping. Archived tabs and manual snapshots are never pruned. */
export async function pruneTick(): Promise<void> {
  const settings = await getSettings();
  const now = Date.now();
  if (settings.history.closedRetentionDays > 0) {
    const cutoff = now - settings.history.closedRetentionDays * 86_400_000;
    await db.tabs
      .where('closedAt')
      .below(cutoff)
      .and((r) => r.status === 'closed')
      .delete();
  }
  await db.embeddings
    .where('usedAt')
    .below(now - 30 * 86_400_000)
    .delete();
}
