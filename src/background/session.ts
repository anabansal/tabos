// Browser-session scoped state (chrome.storage.session is cleared when the browser restarts or
// the extension reloads, which is exactly the lifetime of Chrome tab and group ids).

import type { GroupColor } from '../shared/types';

export interface CachedGroup {
  title: string;
  color: GroupColor;
  windowId: number;
  collapsed: boolean;
}

interface SessionShape {
  marker: number;
  /** chrome group id → workspace id */
  groupLinks: Record<string, string>;
  groupCache: Record<string, CachedGroup>;
  /** window id → workspace id, for empty windows opened by "switch workspace" */
  windowWorkspace: Record<string, string>;
}

const DEFAULTS: SessionShape = { marker: 0, groupLinks: {}, groupCache: {}, windowWorkspace: {} };

async function read<K extends keyof SessionShape>(key: K): Promise<SessionShape[K]> {
  try {
    const got = await chrome.storage.session.get(key);
    return (got[key] as SessionShape[K]) ?? structuredClone(DEFAULTS[key]);
  } catch {
    return structuredClone(DEFAULTS[key]);
  }
}

async function write<K extends keyof SessionShape>(key: K, value: SessionShape[K]): Promise<void> {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (err) {
    console.warn('[TabOS] session storage write failed', err);
  }
}

export const session = {
  getMarker: () => read('marker'),
  setMarker: (v: number) => write('marker', v),

  getGroupLinks: () => read('groupLinks'),
  setGroupLinks: (v: Record<string, string>) => write('groupLinks', v),
  async linkGroup(groupId: number, workspaceId: string) {
    const links = await read('groupLinks');
    links[groupId] = workspaceId;
    await write('groupLinks', links);
  },
  async unlinkGroup(groupId: number) {
    const links = await read('groupLinks');
    delete links[groupId];
    await write('groupLinks', links);
  },
  async workspaceForGroup(groupId: number): Promise<string | null> {
    if (groupId < 0) return null;
    return (await read('groupLinks'))[groupId] ?? null;
  },
  async groupsForWorkspace(workspaceId: string): Promise<number[]> {
    const links = await read('groupLinks');
    return Object.entries(links)
      .filter(([, ws]) => ws === workspaceId)
      .map(([g]) => Number(g));
  },

  getGroupCache: () => read('groupCache'),
  setGroupCache: (v: Record<string, CachedGroup>) => write('groupCache', v),
  async cacheGroup(g: chrome.tabGroups.TabGroup) {
    const cache = await read('groupCache');
    cache[g.id] = { title: g.title ?? '', color: g.color as GroupColor, windowId: g.windowId, collapsed: g.collapsed };
    await write('groupCache', cache);
  },
  async uncacheGroup(groupId: number) {
    const cache = await read('groupCache');
    delete cache[groupId];
    await write('groupCache', cache);
  },

  async getWindowWorkspace(windowId: number): Promise<string | null> {
    return (await read('windowWorkspace'))[windowId] ?? null;
  },
  async setWindowWorkspace(windowId: number, workspaceId: string | null) {
    const map = await read('windowWorkspace');
    if (workspaceId) map[windowId] = workspaceId;
    else delete map[windowId];
    await write('windowWorkspace', map);
  },
};
