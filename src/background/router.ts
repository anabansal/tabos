import { checkDatabase, db } from '../shared/db';
import { type OpResult, type RpcRequest, type RpcResponse, type RpcType, emptyResult } from '../shared/messages';
import { finish, logActivity, plural, type Outcome } from './activity';
import { DASHBOARD_URL, getTab, liveTabs, status } from './context';
import { maybeCollectMeta } from './metadata';
import { executeClean, previewClean } from './ops/clean';
import { clearClosedHistory, exportData, importData } from './ops/data';
import { closeDuplicates } from './ops/duplicates';
import { applyOrganization } from './ops/organize';
import { createSnapshot, deleteSnapshot, renameSnapshot, restoreSnapshot } from './ops/snapshots';
import {
  archiveRecords,
  assignRecords,
  closeRecords,
  currentRecord,
  deleteRecords,
  focusRecord,
  mergeWindows,
  moveRecords,
  openRecords,
  protectRecords,
  sleepOthers,
  sleepRecords,
  wakeRecords,
} from './ops/tabs';
import { applyUndo } from './ops/undo';
import {
  createWorkspace,
  deleteWorkspace,
  groupWorkspace,
  importTabGroups,
  reorderWorkspaces,
  restoreWorkspace,
  switchWorkspace,
  ungroup,
  updateWorkspace,
} from './ops/workspaces';
import { isLive, recordsByIds } from './records';
import { safeReconcile } from './tracker';

const toResult = (o: Outcome, message?: string): OpResult => ({ count: o.count, skipped: o.skipped, activityId: null, message });

export async function openDashboard(hash?: string): Promise<OpResult> {
  const url = DASHBOARD_URL + (hash ? '#' + hash.replace(/^#/, '') : '');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => (t.url ?? '').startsWith(DASHBOARD_URL) && !t.incognito);
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, hash ? { active: true, url } : { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
  return emptyResult();
}

type Handlers = { [K in RpcType]: (req: RpcRequest<K>) => Promise<RpcResponse<K>> };

const wsName = async (id: string | null) => (id ? ((await db.workspaces.get(id))?.name ?? 'workspace') : null);

export const handlers: Handlers = {
  'tabs.focus': async ({ recordId }) => toResult(await focusRecord(recordId)),
  'tabs.open': async (req) =>
    finish('restore', (n) => `Restored ${plural(n, 'tab')}`, await openRecords(req.recordIds, { target: req.target, lazy: req.lazy, focus: req.focus })),
  'tabs.sleep': async ({ recordIds }) => finish('sleep', (n) => `Put ${plural(n, 'tab')} to sleep`, await sleepRecords(recordIds)),
  'tabs.wake': async ({ recordIds }) => finish('wake', (n) => `Woke ${plural(n, 'tab')}`, await wakeRecords(recordIds)),
  'tabs.archive': async ({ recordIds }) => finish('archive', (n) => `Archived ${plural(n, 'tab')}`, await archiveRecords(recordIds)),
  'tabs.close': async ({ recordIds }) => finish('close', (n) => `Closed ${plural(n, 'tab')}`, await closeRecords(recordIds)),
  'tabs.delete': async ({ recordIds }) => finish('delete', (n) => `Deleted ${plural(n, 'saved tab')}`, await deleteRecords(recordIds)),
  'tabs.assign': async ({ recordIds, workspaceId }) => {
    const name = await wsName(workspaceId);
    return finish(
      'assign',
      (n) => (name ? `Moved ${plural(n, 'tab')} to ${name}` : `Removed ${plural(n, 'tab')} from their workspace`),
      await assignRecords(recordIds, workspaceId),
    );
  },
  'tabs.protect': async ({ recordIds, value }) =>
    finish('protect', (n) => `${value ? 'Protected' : 'Unprotected'} ${plural(n, 'tab')}`, await protectRecords(recordIds, value)),
  'tabs.current': async () => currentRecord(),
  'tabs.sleepOthers': async ({ windowId }) => finish('sleep', (n) => `Put ${plural(n, 'other tab')} to sleep`, await sleepOthers(windowId)),
  'tabs.move': async ({ recordIds, windowId }) => toResult(await moveRecords(recordIds, windowId)),
  'windows.merge': async ({ targetWindowId }) => toResult(await mergeWindows(targetWindowId)),
  'windows.focus': async ({ windowId }) => {
    await chrome.windows.update(windowId, { focused: true });
    return emptyResult();
  },

  'workspaces.create': async (req) => {
    const ws = await createWorkspace(req);
    await logActivity('workspace', `Created workspace ${ws.name}`, 1, null);
    return ws;
  },
  'workspaces.update': async ({ id, patch }) => updateWorkspace(id, patch),
  'workspaces.delete': async ({ id }) => {
    const name = await wsName(id);
    return finish('workspace', () => `Deleted workspace ${name}`, await deleteWorkspace(id));
  },
  'workspaces.switch': async ({ id }) => toResult(await switchWorkspace(id)),
  'workspaces.group': async ({ id }) => toResult(await groupWorkspace(id)),
  'workspaces.ungroup': async ({ id }) => toResult(await ungroup(id)),
  'workspaces.restore': async ({ id, lazy }) => {
    const name = await wsName(id);
    return finish('restore', (n) => `Restored ${plural(n, 'tab')} in ${name}`, await restoreWorkspace(id, lazy));
  },
  'workspaces.reorder': async ({ ids }) => toResult(await reorderWorkspaces(ids)),
  'workspaces.importGroups': async () => toResult(await importTabGroups()),

  'duplicates.close': async ({ groups }) => finish('duplicates', (n) => `Closed ${plural(n, 'duplicate tab')}`, await closeDuplicates(groups)),
  'clean.preview': async (req) => previewClean(req),
  'clean.execute': async (req) => executeClean(req),

  'snapshots.create': async ({ name, scope }) => {
    const snap = await createSnapshot(scope, name, 'manual');
    if (!snap) throw new Error('Nothing to save');
    await logActivity('snapshot', `Saved snapshot ${snap.name}`, snap.tabCount, null);
    return snap;
  },
  'snapshots.restore': async ({ id, target, lazy }) => {
    const snap = await db.snapshots.get(id);
    return finish('snapshot', (n) => `Restored ${plural(n, 'tab')} from ${snap?.name ?? 'snapshot'}`, await restoreSnapshot(id, target, lazy));
  },
  'snapshots.rename': async ({ id, name }) => toResult(await renameSnapshot(id, name)),
  'snapshots.delete': async ({ id }) => {
    const snap = await db.snapshots.get(id);
    return finish('snapshot', () => `Deleted snapshot ${snap?.name ?? ''}`, await deleteSnapshot(id));
  },
  'sessions.restore': async ({ sessionId }) => {
    if (!chrome.sessions) throw new Error('Recently closed access is not enabled. Grant it in Settings → Permissions.');
    await chrome.sessions.restore(sessionId);
    return emptyResult();
  },

  'activity.undo': async ({ id }) => {
    const entry = await db.activity.get(id);
    if (!entry) throw new Error('That action is no longer in the history');
    if (!entry.undo) throw new Error('This action cannot be undone');
    if (entry.undoneAt) throw new Error('Already undone');
    const out = await applyUndo(entry.undo);
    await db.activity.update(id, { undoneAt: Date.now() });
    return toResult(out, `Undid: ${entry.label}`);
  },
  'activity.list': async ({ limit }) => db.activity.orderBy('at').reverse().limit(limit ?? 50).toArray(),

  'organize.apply': async (req) => {
    const groups = req.groups.filter((g) => g.recordIds.length).length;
    return finish('organize', (n) => `Organized ${plural(n, 'tab')} into ${plural(groups, 'workspace')}`, await applyOrganization(req));
  },

  'data.export': async () => exportData(),
  'data.import': async ({ bundle }) => {
    const out = await importData(bundle);
    await logActivity('import', `Imported ${plural(out.count, 'item')}`, out.count, null);
    return toResult(out);
  },
  'data.clearClosed': async () => finish('delete', (n) => `Cleared ${plural(n, 'closed tab')} from history`, await clearClosedHistory()),

  'system.reconcile': async () => {
    const r = await safeReconcile({ sameSession: true, markMissing: true });
    return { ...emptyResult(), count: r ? r.matched + r.created : 0, message: r ? `${r.created} new, ${r.missing} missing` : 'Reconcile failed' };
  },
  'system.status': async () => ({ ...status, db: await checkDatabase() }),
  'meta.collect': async ({ recordIds }) => {
    const recs = recordIds?.length
      ? await recordsByIds(recordIds)
      : (await db.tabs.where('status').equals('open').toArray()).filter(isLive);
    const tabs = new Map((await liveTabs()).map((t) => [t.id!, t]));
    let count = 0;
    for (const r of recs) {
      const tab = r.chromeTabId != null ? (tabs.get(r.chromeTabId) ?? (await getTab(r.chromeTabId))) : null;
      if (tab && (await maybeCollectMeta(r, tab, true))) count++;
    }
    return { ...emptyResult(), count };
  },
  'dashboard.open': async ({ hash }) => openDashboard(hash),
};

/** Read-only requests don't need to wait behind queued mutations. */
export const UNQUEUED: ReadonlySet<RpcType> = new Set<RpcType>(['system.status', 'activity.list', 'data.export', 'tabs.current', 'dashboard.open']);
