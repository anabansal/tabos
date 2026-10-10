// Auto-organize (opt-in setting): sorts new tabs into workspaces on its own, then builds the
// matching Chrome tab groups. Every run is logged with Undo; creating a workspace also notifies.

import { planAutoSort } from '../../ai/autoSort';
import { db } from '../../shared/db';
import type { Workspace } from '../../shared/types';
import { logActivity, plural } from '../activity';
import { getSettings, noteError } from '../context';
import { createWorkspaceRecord, findWorkspaceByName, groupWorkspaceInChrome } from '../groups';
import { notifyAutoSort } from '../notify';
import { queue } from '../queue';
import { isLive, liveRecords } from '../records';
import { scheduleBadge } from '../badge';

const MIN_NEW_GROUP = 3;

export async function autoSortTick(): Promise<number> {
  const settings = await getSettings();
  if (!settings.workspaces.autoOrganize) return 0;
  const live = (await liveRecords()).filter(isLive);
  const candidates = live.filter((r) => (!r.workspaceId || r.autoAssigned) && r.sortCheckedUrl !== r.normalizedUrl);
  if (!candidates.length) return 0;
  const workspaces = await db.workspaces.toArray();
  const members = workspaces.length
    ? (await db.tabs.where('workspaceId').anyOf(workspaces.map((w) => w.id)).toArray()).filter((r) => r.status !== 'closed')
    : [];
  const plan = planAutoSort({ candidates, workspaces, members, exclusions: settings.exclusions, minNewGroup: MIN_NEW_GROUP });

  const now = Date.now();
  const created: Workspace[] = [];
  const assignments = [...plan.assign];
  for (const c of plan.create) {
    const ws =
      (await findWorkspaceByName(c.name)) ??
      (await createWorkspaceRecord({ name: c.name, color: c.color, source: 'ai' }));
    if (!workspaces.some((w) => w.id === ws.id)) created.push(ws);
    for (const id of c.recordIds) assignments.push({ recordId: id, workspaceId: ws.id, reason: 'new topic' });
  }

  const changes: Array<{ recordId: string; prevWorkspaceId: string | null }> = [];
  const touched = new Set<string>();
  await db.transaction('rw', db.tabs, async () => {
    for (const id of plan.checked) {
      const r = candidates.find((x) => x.id === id);
      if (r) await db.tabs.update(id, { sortCheckedUrl: r.normalizedUrl });
    }
    for (const a of assignments) {
      const r = await db.tabs.get(a.recordId);
      // The user may have sorted it by hand meanwhile.
      if (!r || (r.workspaceId && !r.autoAssigned) || r.workspaceId === a.workspaceId) continue;
      await db.tabs.update(r.id, { workspaceId: a.workspaceId, autoAssigned: true, updatedAt: now });
      changes.push({ recordId: r.id, prevWorkspaceId: r.workspaceId });
      touched.add(a.workspaceId);
    }
  });
  if (!changes.length) return 0;

  if (settings.workspaces.syncTabGroups) {
    for (const wsId of touched) {
      try {
        await groupWorkspaceInChrome(wsId);
      } catch (err) {
        noteError('auto-organize grouping', err);
      }
    }
  }
  const names = [...touched].map((id) => workspaces.find((w) => w.id === id)?.name ?? created.find((w) => w.id === id)?.name ?? 'group');
  const entry = await logActivity(
    'organize',
    `Auto-sorted ${plural(changes.length, 'tab')} into ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`,
    changes.length,
    { type: 'assign', changes, createdWorkspaceIds: created.map((w) => w.id) },
  );
  if (created.length) await notifyAutoSort(entry.id, created.map((w) => w.name), changes.length);
  return changes.length;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: page loads come in bursts (session restore, opening many links). */
export function scheduleAutoSort(delayMs = 2500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void queue.run(autoSortTick, 'auto-organize').finally(scheduleBadge);
  }, delayMs);
}
