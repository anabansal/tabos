import Dexie, { type Table } from 'dexie';
import type { ActivityEntry, Snapshot, TabRecord, Workspace } from './types';

export interface EmbeddingRow {
  /** `${providerKey}:${textHash}` */
  key: string;
  vector: number[];
  usedAt: number;
}

export interface KVRow {
  key: string;
  value: unknown;
}

export class TabOSDatabase extends Dexie {
  tabs!: Table<TabRecord, string>;
  workspaces!: Table<Workspace, string>;
  snapshots!: Table<Snapshot, string>;
  activity!: Table<ActivityEntry, string>;
  embeddings!: Table<EmbeddingRow, string>;
  kv!: Table<KVRow, string>;

  constructor(name = 'tabos') {
    super(name);
    this.version(1).stores({
      tabs: 'id, chromeTabId, windowId, status, workspaceId, normalizedUrl, domain, lastActiveAt, closedAt, archivedAt',
      workspaces: 'id, name, order',
      snapshots: 'id, createdAt, kind',
      activity: 'id, at',
      embeddings: 'key, usedAt',
      kv: 'key',
    });
  }
}

export const db = new TabOSDatabase();

export const LIVE_STATUSES = ['open', 'sleeping'] as const;

export function newId(): string {
  return crypto.randomUUID();
}

/** Thrown when IndexedDB itself is unusable (quota, corruption, private mode policies). */
export class StorageError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

export async function checkDatabase(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.open();
    await db.kv.get('__ping__');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
