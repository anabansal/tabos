import { db } from '../../shared/db';
import { type Outcome } from '../activity';
import { recordsByIds } from '../records';
import { closeRecords } from './tabs';

/**
 * Consolidate duplicate groups: the kept tab inherits a workspace from its duplicates when it has
 * none, then the extra copies are closed (recorded as closed duplicates, undoable).
 */
export async function closeDuplicates(groups: Array<{ keepRecordId: string; closeRecordIds: string[] }>): Promise<Outcome> {
  const toClose: string[] = [];
  for (const g of groups) {
    const keeper = await db.tabs.get(g.keepRecordId);
    if (!keeper) continue;
    const extras = (await recordsByIds(g.closeRecordIds)).filter((r) => r.id !== keeper.id && r.normalizedUrl === keeper.normalizedUrl);
    if (!keeper.workspaceId) {
      const withWs = extras.find((r) => r.workspaceId);
      if (withWs) await db.tabs.update(keeper.id, { workspaceId: withWs.workspaceId });
    }
    toClose.push(...extras.map((r) => r.id));
  }
  return closeRecords(toClose, 'duplicate');
}
