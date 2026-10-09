import type { DuplicateGroup, TabRecord } from '../shared/types';

const isLive = (r: TabRecord) => r.status === 'open' || r.status === 'sleeping';

/** Pick the copy worth keeping: the visible one, then pinned, protected, awake, most recently used. */
export function pickKeeper(records: TabRecord[]): TabRecord {
  return [...records].sort((a, b) => {
    const rank = (r: TabRecord) =>
      (r.active ? 16 : 0) + (r.pinned ? 8 : 0) + (r.isProtected ? 4 : 0) + (r.status === 'open' ? 2 : 0) + (r.workspaceId ? 1 : 0);
    return rank(b) - rank(a) || b.lastActiveAt - a.lastActiveAt;
  })[0];
}

/** Groups of live tabs that point at the same normalized URL. */
export function findDuplicateGroups(records: TabRecord[]): DuplicateGroup[] {
  const byUrl = new Map<string, TabRecord[]>();
  for (const r of records) {
    if (!isLive(r) || !r.normalizedUrl) continue;
    const list = byUrl.get(r.normalizedUrl);
    if (list) list.push(r);
    else byUrl.set(r.normalizedUrl, [r]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [normalizedUrl, list] of byUrl) {
    if (list.length < 2) continue;
    const keeper = pickKeeper(list);
    groups.push({ normalizedUrl, keepRecordId: keeper.id, recordIds: list.map((r) => r.id) });
  }
  return groups.sort((a, b) => b.recordIds.length - a.recordIds.length);
}

export function duplicateExtras(groups: DuplicateGroup[]): string[] {
  return groups.flatMap((g) => g.recordIds.filter((id) => id !== g.keepRecordId));
}
