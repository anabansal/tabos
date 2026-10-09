import { db, newId } from '../shared/db';
import type { ActivityEntry, ActivityKind, UndoPayload } from '../shared/types';
import type { OpResult } from '../shared/messages';

/** What an internal operation did, before it is logged. */
export interface Outcome {
  count: number;
  skipped: Array<{ recordId: string; reason: string }>;
  undo: UndoPayload | null;
}

export const emptyOutcome = (): Outcome => ({ count: 0, skipped: [], undo: null });

const MAX_ENTRIES = 300;

export async function logActivity(kind: ActivityKind, label: string, count: number, undo: UndoPayload | null): Promise<ActivityEntry> {
  const entry: ActivityEntry = { id: newId(), at: Date.now(), kind, label, count, undo, undoneAt: null };
  await db.activity.add(entry);
  const total = await db.activity.count();
  if (total > MAX_ENTRIES) {
    const old = await db.activity.orderBy('at').limit(total - MAX_ENTRIES).primaryKeys();
    await db.activity.bulkDelete(old);
  }
  return entry;
}

/** Log an outcome (if it did anything) and convert it to an RPC result. */
export async function finish(kind: ActivityKind, label: (n: number) => string, outcome: Outcome): Promise<OpResult> {
  let activityId: string | null = null;
  if (outcome.count > 0) {
    const entry = await logActivity(kind, label(outcome.count), outcome.count, outcome.undo);
    activityId = entry.id;
  }
  return { count: outcome.count, skipped: outcome.skipped, activityId };
}

export const plural = (n: number, word: string, pluralWord = word + 's') => `${n} ${n === 1 ? word : pluralWord}`;
