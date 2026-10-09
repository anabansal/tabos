// Two-way sync between Chrome tab groups and TabOS workspaces.
// A titled tab group is linked to the workspace with the same name (created if needed). Links are
// session-scoped because Chrome group ids change across restarts; they are rebuilt by title.

import { db, newId } from '../shared/db';
import { GROUP_COLORS, type GroupColor, type Workspace } from '../shared/types';
import { getSettings, noteError } from './context';
import { isLive } from './records';
import { session } from './session';

export async function findWorkspaceByName(name: string): Promise<Workspace | undefined> {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const all = await db.workspaces.toArray();
  return all.find((w) => w.name.trim().toLowerCase() === n);
}

export async function uniqueWorkspaceName(name: string, exceptId?: string): Promise<string> {
  const base = name.trim().slice(0, 60) || 'Untitled';
  const taken = new Set(
    (await db.workspaces.toArray()).filter((w) => w.id !== exceptId).map((w) => w.name.trim().toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export async function nextColor(): Promise<GroupColor> {
  const used = (await db.workspaces.toArray()).map((w) => w.color);
  return GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length];
}

export async function createWorkspaceRecord(input: {
  name: string;
  color?: GroupColor;
  summary?: string;
  source: Workspace['source'];
  id?: string;
}): Promise<Workspace> {
  const now = Date.now();
  const count = await db.workspaces.count();
  const ws: Workspace = {
    id: input.id ?? newId(),
    name: await uniqueWorkspaceName(input.name),
    color: input.color ?? (await nextColor()),
    summary: input.summary ?? '',
    source: input.source,
    isProtected: false,
    order: count,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
  await db.workspaces.add(ws);
  return ws;
}

async function assignGroupTabs(groupId: number, workspaceId: string): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ groupId });
  } catch {
    return;
  }
  const ids = tabs.map((t) => t.id).filter((id): id is number => id != null);
  if (!ids.length) return;
  const recs = await db.tabs.where('chromeTabId').anyOf(ids).toArray();
  const now = Date.now();
  await Promise.all(
    recs.filter((r) => r.workspaceId !== workspaceId).map((r) => db.tabs.update(r.id, { workspaceId, updatedAt: now })),
  );
}

/** Handle a group being created or changed in Chrome. */
export async function onGroupChanged(group: chrome.tabGroups.TabGroup): Promise<void> {
  const prev = (await session.getGroupCache())[group.id];
  await session.cacheGroup(group);
  const settings = await getSettings();
  if (!settings.workspaces.syncTabGroups) return;
  const title = (group.title ?? '').trim();
  const linkedId = await session.workspaceForGroup(group.id);
  if (linkedId) {
    const ws = await db.workspaces.get(linkedId);
    if (!ws) {
      await session.unlinkGroup(group.id);
      return;
    }
    const patch: Partial<Workspace> = {};
    if (title && title !== ws.name && prev && prev.title.trim() === ws.name) {
      const clash = await findWorkspaceByName(title);
      if (!clash || clash.id === ws.id) patch.name = title;
    }
    if (prev && prev.color !== group.color && group.color !== ws.color) patch.color = group.color as GroupColor;
    if (Object.keys(patch).length) await db.workspaces.update(ws.id, { ...patch, updatedAt: Date.now() });
    return;
  }
  if (!title) return; // untitled groups aren't workspaces until named
  const ws =
    (await findWorkspaceByName(title)) ??
    (await createWorkspaceRecord({ name: title, color: group.color as GroupColor, source: 'tab-group' }));
  await session.linkGroup(group.id, ws.id);
  await assignGroupTabs(group.id, ws.id);
}

export async function onGroupRemoved(group: chrome.tabGroups.TabGroup): Promise<void> {
  await session.uncacheGroup(group.id);
  await session.unlinkGroup(group.id);
}

/**
 * Rebuild group cache and links after startup (group ids are new) or a long sleep.
 * @param force link titled groups even when automatic tab-group sync is turned off (manual import)
 */
export async function resyncGroups(force = false): Promise<void> {
  let groups: chrome.tabGroups.TabGroup[] = [];
  try {
    groups = await chrome.tabGroups.query({});
  } catch (err) {
    noteError('tabGroups.query', err);
    return;
  }
  const cache: Record<string, { title: string; color: GroupColor; windowId: number; collapsed: boolean }> = {};
  for (const g of groups) cache[g.id] = { title: g.title ?? '', color: g.color as GroupColor, windowId: g.windowId, collapsed: g.collapsed };
  await session.setGroupCache(cache);

  const oldLinks = await session.getGroupLinks();
  const links: Record<string, string> = {};
  const workspaces = await db.workspaces.toArray();
  const settings = await getSettings();
  for (const g of groups) {
    const existing = oldLinks[g.id];
    if (existing && workspaces.some((w) => w.id === existing)) {
      links[g.id] = existing;
      continue;
    }
    if (!settings.workspaces.syncTabGroups && !force) continue;
    const title = (g.title ?? '').trim();
    if (!title) continue;
    let ws = workspaces.find((w) => w.name.trim().toLowerCase() === title.toLowerCase());
    if (!ws) {
      ws = await createWorkspaceRecord({ name: title, color: g.color as GroupColor, source: 'tab-group' });
      workspaces.push(ws);
    }
    links[g.id] = ws.id;
  }
  await session.setGroupLinks(links);
  for (const [gid, wsId] of Object.entries(links)) await assignGroupTabs(Number(gid), wsId);
}

/** Put a workspace's open tabs into one Chrome tab group per window. */
export async function groupWorkspaceInChrome(workspaceId: string, onlyWindowId?: number): Promise<number> {
  const ws = await db.workspaces.get(workspaceId);
  if (!ws) throw new Error('Workspace not found');
  const recs = (await db.tabs.where('workspaceId').equals(workspaceId).toArray()).filter(isLive);
  const byWindow = new Map<number, number[]>();
  for (const r of recs) {
    if (r.pinned || r.windowId == null || r.chromeTabId == null) continue;
    if (onlyWindowId != null && r.windowId !== onlyWindowId) continue;
    const list = byWindow.get(r.windowId) ?? [];
    list.push(r.chromeTabId);
    byWindow.set(r.windowId, list);
  }
  const cache = await session.getGroupCache();
  const linked = await session.groupsForWorkspace(workspaceId);
  let grouped = 0;
  for (const [windowId, tabIds] of byWindow) {
    try {
      const existing = linked.find((g) => cache[g]?.windowId === windowId);
      let groupId: number;
      if (existing != null) {
        groupId = await chrome.tabs.group({ groupId: existing, tabIds: tabIds as [number, ...number[]] });
      } else {
        groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId } });
        await session.linkGroup(groupId, workspaceId);
      }
      const g = await chrome.tabGroups.update(groupId, { title: ws.name, color: ws.color });
      if (g) await session.cacheGroup(g);
      grouped += tabIds.length;
    } catch (err) {
      noteError('group workspace', err);
    }
  }
  return grouped;
}

/** Remove a workspace's tabs from its linked Chrome groups and drop the links. */
export async function ungroupWorkspace(workspaceId: string): Promise<number> {
  const groups = await session.groupsForWorkspace(workspaceId);
  let count = 0;
  for (const groupId of groups) {
    try {
      const tabs = await chrome.tabs.query({ groupId });
      const ids = tabs.map((t) => t.id).filter((id): id is number => id != null);
      if (ids.length) await chrome.tabs.ungroup(ids as [number, ...number[]]);
      count += ids.length;
    } catch {
      /* group already gone */
    }
    await session.unlinkGroup(groupId);
  }
  return count;
}

/** Keep a single tab's group membership consistent with its (new) workspace. */
export async function placeTabForWorkspace(tabId: number, windowId: number, currentGroupId: number, workspaceId: string | null): Promise<void> {
  const settings = await getSettings();
  if (!settings.workspaces.syncTabGroups) return;
  const linkedWs = await session.workspaceForGroup(currentGroupId);
  if (currentGroupId >= 0 && linkedWs && linkedWs !== workspaceId) {
    try {
      await chrome.tabs.ungroup(tabId);
    } catch {
      /* ignore */
    }
  }
  if (!workspaceId) return;
  const cache = await session.getGroupCache();
  const target = (await session.groupsForWorkspace(workspaceId)).find((g) => cache[g]?.windowId === windowId);
  if (target != null && target !== currentGroupId) {
    try {
      await chrome.tabs.group({ groupId: target, tabIds: tabId });
    } catch {
      /* pinned tabs can't be grouped */
    }
  }
}

/** Propagate a workspace rename/recolor to its Chrome groups. */
export async function syncWorkspaceToGroups(ws: Workspace): Promise<void> {
  for (const groupId of await session.groupsForWorkspace(ws.id)) {
    try {
      const g = await chrome.tabGroups.update(groupId, { title: ws.name, color: ws.color });
      if (g) await session.cacheGroup(g);
    } catch {
      await session.unlinkGroup(groupId);
    }
  }
}
