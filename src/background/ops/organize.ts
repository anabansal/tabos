// Apply an AI organization proposal the user reviewed and accepted.

import { db } from '../../shared/db';
import type { OrganizeApplyRequest } from '../../shared/types';
import { type Outcome } from '../activity';
import { noteError } from '../context';
import { createWorkspaceRecord, findWorkspaceByName, groupWorkspaceInChrome, placeTabForWorkspace } from '../groups';
import { isLive, recordsByIds } from '../records';

export async function applyOrganization(req: OrganizeApplyRequest): Promise<Outcome> {
  const now = Date.now();
  const changes: Array<{ recordId: string; prevWorkspaceId: string | null }> = [];
  const createdWorkspaceIds: string[] = [];
  const renamedWorkspaces: Array<{ id: string; name: string; summary: string }> = [];
  const touched = new Set<string>();
  const assigned = new Set<string>();

  for (const g of req.groups) {
    const ids = g.recordIds.filter((id) => !assigned.has(id));
    if (!ids.length || !g.name.trim()) continue;
    let ws = g.existingWorkspaceId ? await db.workspaces.get(g.existingWorkspaceId) : undefined;
    ws ??= await findWorkspaceByName(g.name);
    if (!ws) {
      ws = await createWorkspaceRecord({ name: g.name, color: g.color, summary: g.summary, source: 'ai' });
      createdWorkspaceIds.push(ws.id);
    } else if (g.summary && !ws.summary) {
      renamedWorkspaces.push({ id: ws.id, name: ws.name, summary: ws.summary });
      await db.workspaces.update(ws.id, { summary: g.summary, updatedAt: now });
    }
    touched.add(ws.id);
    const recs = await recordsByIds(ids);
    for (const r of recs) {
      assigned.add(r.id);
      if (r.workspaceId === ws.id) continue;
      changes.push({ recordId: r.id, prevWorkspaceId: r.workspaceId });
      await db.tabs.update(r.id, { workspaceId: ws.id, autoAssigned: false, updatedAt: now });
      if (!req.createChromeGroups && isLive(r) && r.windowId != null) {
        await placeTabForWorkspace(r.chromeTabId!, r.windowId, r.groupId, ws.id);
      }
    }
  }
  if (req.createChromeGroups) {
    for (const wsId of touched) {
      try {
        await groupWorkspaceInChrome(wsId);
      } catch (err) {
        noteError('organize grouping', err);
      }
    }
  }
  return {
    count: changes.length,
    skipped: [],
    undo: changes.length || createdWorkspaceIds.length ? { type: 'assign', changes, createdWorkspaceIds, renamedWorkspaces } : null,
  };
}
