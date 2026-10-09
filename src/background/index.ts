// TabOS service worker entry. Listeners are registered synchronously at top level (an MV3
// requirement so events that wake the worker are delivered), and all work is serialized.

import { quickSearch, indexDoc } from '../core/search';
import { db } from '../shared/db';
import { isEnvelope, type RpcReply } from '../shared/messages';
import { scheduleBadge, updateBadge } from './badge';
import { getSettings, noteError, status, watchSettings } from './context';
import { onGroupRemoved } from './groups';
import { activityIdFromNotification, clearNotification } from './notify';
import { autoArchiveTick, autoSleepTick, pruneTick } from './ops/clean';
import { autoSnapshotTick } from './ops/snapshots';
import { focusRecord } from './ops/tabs';
import { applyUndo } from './ops/undo';
import { queue } from './queue';
import { UNQUEUED, handlers, openDashboard } from './router';
import { session } from './session';
import {
  handleActivated,
  handleCreated,
  handleGroupEvent,
  handleMoved,
  handleRemoved,
  handleReplaced,
  handleUpdated,
  safeReconcile,
} from './tracker';

const ALARMS = {
  tick: 'tabos-tick',
  reconcile: 'tabos-reconcile',
  reconcileLate: 'tabos-reconcile-late',
  hourly: 'tabos-hourly',
  snapshot: 'tabos-snapshot',
} as const;

function enqueue<A extends unknown[]>(label: string, fn: (...args: A) => Promise<unknown>) {
  return (...args: A) => {
    void queue.run(() => fn(...args), label).catch((err) => noteError(label, err)).finally(scheduleBadge);
  };
}

// ---------- Chrome events ----------

const RELEVANT_UPDATE_KEYS = new Set(['url', 'title', 'favIconUrl', 'discarded', 'audible', 'mutedInfo', 'pinned', 'groupId', 'status']);

chrome.tabs.onCreated.addListener(enqueue('tabs.onCreated', handleCreated));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!Object.keys(change).some((k) => RELEVANT_UPDATE_KEYS.has(k))) return;
  enqueue('tabs.onUpdated', handleUpdated)(tabId, change, tab);
});
chrome.tabs.onActivated.addListener(enqueue('tabs.onActivated', handleActivated));
chrome.tabs.onRemoved.addListener(enqueue('tabs.onRemoved', handleRemoved));
chrome.tabs.onReplaced.addListener(enqueue('tabs.onReplaced', handleReplaced));
chrome.tabs.onMoved.addListener(enqueue('tabs.onMoved', (tabId: number, info: chrome.tabs.OnMovedInfo) => handleMoved(tabId, info.windowId, info.toIndex)));
chrome.tabs.onAttached.addListener(
  enqueue('tabs.onAttached', (tabId: number, info: chrome.tabs.OnAttachedInfo) => handleMoved(tabId, info.newWindowId, info.newPosition)),
);
chrome.tabGroups.onCreated.addListener(enqueue('tabGroups.onCreated', handleGroupEvent));
chrome.tabGroups.onUpdated.addListener(enqueue('tabGroups.onUpdated', handleGroupEvent));
chrome.tabGroups.onRemoved.addListener(enqueue('tabGroups.onRemoved', onGroupRemoved));
chrome.windows.onRemoved.addListener(enqueue('windows.onRemoved', (windowId: number) => session.setWindowWorkspace(windowId, null)));

// ---------- Messages from extension pages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isEnvelope(msg)) return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Forbidden' } satisfies RpcReply<never>);
    return false;
  }
  const handler = handlers[msg.type] as ((req: unknown) => Promise<unknown>) | undefined;
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown request ${msg.type}` });
    return false;
  }
  const run = () => handler(msg.req ?? {});
  const p = UNQUEUED.has(msg.type) ? run() : queue.run(run, msg.type);
  p.then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  ).finally(scheduleBadge);
  return true; // async response
});

// ---------- Alarms ----------

async function ensureAlarms(): Promise<void> {
  const settings = await getSettings();
  const wanted: Record<string, number> = {
    [ALARMS.tick]: 1,
    [ALARMS.reconcile]: 5,
    [ALARMS.hourly]: 60,
    [ALARMS.snapshot]: settings.snapshots.intervalMinutes,
  };
  for (const [name, period] of Object.entries(wanted)) {
    const existing = await chrome.alarms.get(name);
    if (!existing || existing.periodInMinutes !== period) {
      await chrome.alarms.create(name, { periodInMinutes: period, delayInMinutes: Math.min(period, 1) });
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  switch (alarm.name) {
    case ALARMS.tick:
      void queue.run(autoSleepTick, 'auto-sleep').finally(scheduleBadge);
      break;
    case ALARMS.reconcile:
    case ALARMS.reconcileLate:
      void queue.run(() => safeReconcile({ sameSession: true, markMissing: true }), 'reconcile').finally(scheduleBadge);
      break;
    case ALARMS.hourly:
      void queue.run(async () => {
        await autoArchiveTick();
        const last = (await db.kv.get('lastPruneAt'))?.value as number | undefined;
        if (!last || Date.now() - last > 86_400_000) {
          await pruneTick();
          await db.kv.put({ key: 'lastPruneAt', value: Date.now() });
        }
      }, 'hourly');
      break;
    case ALARMS.snapshot:
      void queue.run(autoSnapshotTick, 'auto-snapshot');
      break;
  }
});

watchSettings((s, prev) => {
  void ensureAlarms();
  if (!prev || prev.ui.badge !== s.ui.badge) void updateBadge();
});

// ---------- Notifications (auto-archive undo) ----------

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  const activityId = activityIdFromNotification(notificationId);
  if (!activityId) return;
  void clearNotification(notificationId);
  if (buttonIndex === 0) {
    void queue.run(async () => {
      const entry = await db.activity.get(activityId);
      if (!entry?.undo || entry.undoneAt) return;
      await applyUndo(entry.undo);
      await db.activity.update(activityId, { undoneAt: Date.now() });
    }, 'notification undo').finally(scheduleBadge);
  } else {
    void openDashboard('/activity');
  }
});
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!activityIdFromNotification(notificationId)) return;
  void clearNotification(notificationId);
  void openDashboard('/activity');
});

// ---------- Commands & omnibox ----------

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-dashboard') void openDashboard();
  if (command === 'open-search') void openDashboard('/search');
});

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

chrome.omnibox.setDefaultSuggestion({ description: 'Search TabOS: open, sleeping, archived and recently closed tabs' });
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void (async () => {
    const recs = await db.tabs.toArray();
    const hits = quickSearch(recs.map(indexDoc), text, 6);
    suggest(
      hits.map((h) => ({
        content: `tabos:${h.doc.id}`,
        description: `${escapeXml(h.doc.title.slice(0, 90))} <dim>· ${escapeXml(h.doc.status)} · ${escapeXml(h.doc.domain)}</dim>`,
      })),
    );
  })();
});
chrome.omnibox.onInputEntered.addListener((text) => {
  if (text.startsWith('tabos:')) {
    void queue.run(() => focusRecord(text.slice(6)), 'omnibox open').finally(scheduleBadge);
  } else {
    void openDashboard(`/search?q=${encodeURIComponent(text)}`);
  }
});

// ---------- Lifecycle ----------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openDashboard('/welcome');
});
chrome.runtime.onStartup.addListener(() => {
  // initialize() below already handles browser startup; this listener ensures the worker wakes.
});

async function initialize(): Promise<void> {
  status.startedAt = Date.now();
  try {
    await db.open();
  } catch (err) {
    noteError('database', err);
    return;
  }
  const marker = await session.getMarker();
  const sameSession = marker > 0;
  // Right after a browser restart, session restore may still be adding tabs: don't declare
  // records missing yet, re-check shortly via the late reconcile alarm.
  await safeReconcile({ sameSession, markMissing: sameSession });
  if (!sameSession) {
    await session.setMarker(Date.now());
    await chrome.alarms.create(ALARMS.reconcileLate, { delayInMinutes: 0.5 });
  }
  await ensureAlarms();
  await updateBadge();
}

void queue.run(initialize, 'initialize');
