// Typed request/response contract between extension pages and the service worker.
// Every state mutation goes through here so the worker can serialize it with Chrome events.

import type {
  ActivityEntry,
  CleanPreview,
  GroupColor,
  MemoryReading,
  OrganizeApplyRequest,
  Snapshot,
  TabRecord,
  Workspace,
} from './types';
import type { Settings } from './settings';

export interface OpResult {
  count: number;
  skipped: Array<{ recordId: string; reason: string }>;
  activityId: string | null;
  message?: string;
}

export interface CleanResult extends OpResult {
  slept: number;
  archived: number;
  closed: number;
  memoryBefore: MemoryReading | null;
}

export type SnapshotScope = { kind: 'all' } | { kind: 'window'; windowId?: number } | { kind: 'workspace'; workspaceId: string };

export type OpenTarget = 'auto' | 'current' | 'new-window';

export interface ExportBundle {
  format: 'tabos-export';
  version: 1;
  exportedAt: number;
  settings: Settings;
  tabs: TabRecord[];
  workspaces: Workspace[];
  snapshots: Snapshot[];
}

export interface WorkerStatus {
  startedAt: number;
  lastReconcileAt: number | null;
  lastError: string | null;
  db: { ok: true } | { ok: false; error: string };
}

export interface RpcMap {
  'tabs.focus': { req: { recordId: string }; res: OpResult };
  'tabs.open': { req: { recordIds: string[]; target?: OpenTarget; lazy?: boolean; focus?: boolean }; res: OpResult };
  'tabs.sleep': { req: { recordIds: string[] }; res: OpResult };
  'tabs.wake': { req: { recordIds: string[] }; res: OpResult };
  'tabs.archive': { req: { recordIds: string[] }; res: OpResult };
  'tabs.close': { req: { recordIds: string[] }; res: OpResult };
  'tabs.delete': { req: { recordIds: string[] }; res: OpResult };
  'tabs.assign': { req: { recordIds: string[]; workspaceId: string | null }; res: OpResult };
  'tabs.protect': { req: { recordIds: string[]; value: boolean }; res: OpResult };
  'tabs.current': { req: Record<string, never>; res: TabRecord | null };
  'tabs.sleepOthers': { req: { windowId?: number }; res: OpResult };
  'tabs.move': { req: { recordIds: string[]; windowId: number | 'new' }; res: OpResult };
  'windows.merge': { req: { targetWindowId?: number }; res: OpResult };
  'windows.focus': { req: { windowId: number }; res: OpResult };
  'workspaces.create': { req: { name: string; color?: GroupColor; recordIds?: string[] }; res: Workspace };
  'workspaces.update': { req: { id: string; patch: Partial<Pick<Workspace, 'name' | 'color' | 'summary' | 'isProtected'>> }; res: Workspace };
  'workspaces.delete': { req: { id: string }; res: OpResult };
  'workspaces.switch': { req: { id: string }; res: OpResult };
  'workspaces.group': { req: { id: string }; res: OpResult };
  'workspaces.ungroup': { req: { id: string }; res: OpResult };
  'workspaces.restore': { req: { id: string; lazy?: boolean }; res: OpResult };
  'workspaces.reorder': { req: { ids: string[] }; res: OpResult };
  'workspaces.importGroups': { req: Record<string, never>; res: OpResult };
  'duplicates.close': { req: { groups: Array<{ keepRecordId: string; closeRecordIds: string[] }> }; res: OpResult };
  'clean.preview': { req: { sleepAfterMinutes?: number; archiveAfterDays?: number }; res: CleanPreview };
  'clean.execute': { req: { sleep: string[]; archive: string[]; close: string[] }; res: CleanResult };
  'snapshots.create': { req: { name?: string; scope: SnapshotScope }; res: Snapshot };
  'snapshots.restore': { req: { id: string; target: 'new-window' | 'current'; lazy?: boolean }; res: OpResult };
  'snapshots.rename': { req: { id: string; name: string }; res: OpResult };
  'snapshots.delete': { req: { id: string }; res: OpResult };
  'sessions.restore': { req: { sessionId: string }; res: OpResult };
  'activity.undo': { req: { id: string }; res: OpResult };
  'activity.list': { req: { limit?: number }; res: ActivityEntry[] };
  'organize.apply': { req: OrganizeApplyRequest; res: OpResult };
  'data.export': { req: Record<string, never>; res: ExportBundle };
  'data.import': { req: { bundle: ExportBundle }; res: OpResult };
  'data.clearClosed': { req: Record<string, never>; res: OpResult };
  'system.reconcile': { req: Record<string, never>; res: OpResult };
  'system.status': { req: Record<string, never>; res: WorkerStatus };
  'meta.collect': { req: { recordIds?: string[] }; res: OpResult };
  'dashboard.open': { req: { hash?: string }; res: OpResult };
}

export type RpcType = keyof RpcMap;
export type RpcRequest<K extends RpcType> = RpcMap[K]['req'];
export type RpcResponse<K extends RpcType> = RpcMap[K]['res'];

export interface RpcEnvelope<K extends RpcType = RpcType> {
  __tabos: 1;
  type: K;
  req: RpcRequest<K>;
}

export type RpcReply<T> = { ok: true; data: T } | { ok: false; error: string };

export function isEnvelope(msg: unknown): msg is RpcEnvelope {
  return typeof msg === 'object' && msg !== null && (msg as RpcEnvelope).__tabos === 1 && typeof (msg as RpcEnvelope).type === 'string';
}

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Call the service worker. Retries once if the worker was asleep and the first message raced its startup. */
export async function rpc<K extends RpcType>(type: K, req: RpcRequest<K>): Promise<RpcResponse<K>> {
  const envelope: RpcEnvelope<K> = { __tabos: 1, type, req };
  let reply: RpcReply<RpcResponse<K>> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      reply = (await chrome.runtime.sendMessage(envelope)) as RpcReply<RpcResponse<K>> | undefined;
      if (reply) break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 2 || !/Receiving end does not exist|message port closed/i.test(msg)) throw new RpcError(msg);
    }
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
  if (!reply) throw new RpcError('TabOS background did not respond. Try reloading the extension.');
  if (!reply.ok) throw new RpcError(reply.error);
  return reply.data;
}

export const emptyResult = (message?: string): OpResult => ({ count: 0, skipped: [], activityId: null, message });
