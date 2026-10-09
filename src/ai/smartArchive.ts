// Smart archival suggestions: combine inactivity, duplication and workspace context into a score.
// Suggestions are only ever applied after the user reviews them in the Clean panel.

import { findDuplicateGroups } from '../core/duplicates';
import { formatDuration, lastActivity, protectionReasons, type LiveTabState, type RuleSettings } from '../core/rules';
import type { CleanCandidate, TabRecord, Workspace } from '../shared/types';

const DAY = 86_400_000;

export interface SmartArchiveInput {
  records: TabRecord[];
  tabsById: Map<number, LiveTabState>;
  workspaces: Workspace[];
  settings: RuleSettings;
  now: number;
  /** Inactivity (days) at which a tab starts to qualify on its own. */
  afterDays: number;
}

export function suggestArchival(input: SmartArchiveInput): CleanCandidate[] {
  const { records, tabsById, workspaces, settings, now, afterDays } = input;
  const live = records.filter((r) => (r.status === 'open' || r.status === 'sleeping') && r.chromeTabId != null);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const dupGroups = findDuplicateGroups(live);
  const dupOf = new Map<string, string>();
  for (const g of dupGroups) for (const id of g.recordIds) if (id !== g.keepRecordId) dupOf.set(id, g.keepRecordId);

  // Most recent activity per workspace, from its live tabs.
  const wsActivity = new Map<string, number>();
  for (const r of live) {
    if (!r.workspaceId) continue;
    wsActivity.set(r.workspaceId, Math.max(wsActivity.get(r.workspaceId) ?? 0, r.lastActiveAt));
  }

  const out: CleanCandidate[] = [];
  const threshold = Math.max(0.01, afterDays) * DAY;
  for (const rec of live) {
    const tab = tabsById.get(rec.chromeTabId!);
    if (!tab) continue;
    const ws = rec.workspaceId ? wsById.get(rec.workspaceId) : undefined;
    if (protectionReasons({ tab, record: rec, workspaceProtected: !!ws?.isProtected }, settings).length) continue;

    const idle = now - lastActivity(tab, rec);
    const reasons: string[] = [];
    let score = 0;
    if (idle >= threshold) {
      score += 0.5 + Math.min(0.3, ((idle - threshold) / (threshold * 4)) * 0.3);
      reasons.push(`Not viewed for ${formatDuration(idle)}`);
    } else if (idle >= threshold / 2) {
      score += 0.2;
    }
    if (dupOf.has(rec.id)) {
      score += 0.45;
      reasons.push('Duplicate of another open tab');
    }
    if (ws) {
      const wsIdle = now - (wsActivity.get(ws.id) ?? ws.lastActiveAt);
      if (wsIdle >= threshold) {
        score += 0.15;
        reasons.push(`Workspace “${ws.name}” idle for ${formatDuration(wsIdle)}`);
      } else if (wsIdle < 60 * 60_000) {
        score -= 0.25; // you're working in this workspace right now
      }
    } else if (idle >= threshold) {
      score += 0.05;
    }
    if (rec.status === 'sleeping' && rec.sleptAt && now - rec.sleptAt > DAY) {
      score += 0.1;
      reasons.push(`Asleep for ${formatDuration(now - rec.sleptAt)}`);
    }
    if (rec.activations >= 15) score -= 0.1; // a tab you keep coming back to
    if (score >= 0.5 && reasons.length) out.push({ recordId: rec.id, reasons, score: Math.min(1, score) });
  }
  return out.sort((a, b) => b.score - a.score);
}
