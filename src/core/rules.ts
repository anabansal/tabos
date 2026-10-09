// Protection and lifecycle rules. Pure functions: no Chrome API access.

import type { Settings } from '../shared/settings';
import type { TabRecord } from '../shared/types';
import { domainMatches, getDomain, isDiscardableUrl, matchesAny } from '../shared/url';

export interface LiveTabState {
  url: string;
  active: boolean;
  audible?: boolean;
  pinned: boolean;
  discarded: boolean;
  autoDiscardable?: boolean;
  status?: string;
  lastAccessed?: number;
}

export type RuleSettings = Pick<Settings, 'sleep' | 'protectedDomains' | 'exclusions'>;

export interface ProtectionInput {
  tab: LiveTabState;
  record: Pick<TabRecord, 'isProtected' | 'lastActiveAt' | 'createdAt'> | null;
  workspaceProtected: boolean;
}

export type ProtectionReason =
  | 'active'
  | 'audible'
  | 'pinned'
  | 'protected-tab'
  | 'protected-domain'
  | 'protected-workspace'
  | 'excluded'
  | 'opted-out';

export const PROTECTION_LABELS: Record<ProtectionReason, string> = {
  active: 'Currently visible',
  audible: 'Playing audio',
  pinned: 'Pinned',
  'protected-tab': 'Protected tab',
  'protected-domain': 'Protected site',
  'protected-workspace': 'Protected workspace',
  excluded: 'Excluded by rule',
  'opted-out': 'Marked not discardable',
};

/** Reasons a tab must not be touched by automatic sleeping or archiving. Empty array = unprotected. */
export function protectionReasons(input: ProtectionInput, settings: RuleSettings): ProtectionReason[] {
  const { tab, record } = input;
  const reasons: ProtectionReason[] = [];
  if (tab.active) reasons.push('active');
  if (tab.audible) reasons.push('audible');
  if (tab.pinned && settings.sleep.protectPinned) reasons.push('pinned');
  if (record?.isProtected) reasons.push('protected-tab');
  if (input.workspaceProtected) reasons.push('protected-workspace');
  const domain = getDomain(tab.url);
  if (domain && settings.protectedDomains.some((d) => domainMatches(domain, d))) reasons.push('protected-domain');
  if (settings.exclusions.length && matchesAny(tab.url, settings.exclusions)) reasons.push('excluded');
  if (tab.autoDiscardable === false) reasons.push('opted-out');
  return reasons;
}

/** Most recent moment the user interacted with the tab, from TabOS records and Chrome's lastAccessed. */
export function lastActivity(tab: Pick<LiveTabState, 'lastAccessed'>, record: Pick<TabRecord, 'lastActiveAt' | 'createdAt'> | null): number {
  if (!record) return tab.lastAccessed ?? Date.now();
  return Math.max(record.lastActiveAt, tab.lastAccessed ?? 0);
}

export type SleepDecision =
  | { sleep: true; inactiveMs: number }
  | { sleep: false; why: 'protected'; reasons: ProtectionReason[] }
  | { sleep: false; why: 'already-sleeping' | 'not-discardable' | 'loading' | 'recent' };

export function sleepDecision(input: ProtectionInput, settings: RuleSettings, now: number, thresholdMinutes = settings.sleep.afterMinutes): SleepDecision {
  const { tab } = input;
  if (tab.discarded) return { sleep: false, why: 'already-sleeping' };
  if (!isDiscardableUrl(tab.url)) return { sleep: false, why: 'not-discardable' };
  const reasons = protectionReasons(input, settings);
  if (reasons.length) return { sleep: false, why: 'protected', reasons };
  if (tab.status === 'loading') return { sleep: false, why: 'loading' };
  const inactiveMs = now - lastActivity(tab, input.record);
  if (inactiveMs < thresholdMinutes * 60_000) return { sleep: false, why: 'recent' };
  return { sleep: true, inactiveMs };
}

/**
 * Manual sleep (tabs the user picked). Automation-only rules (pinned, exclusions, other extensions'
 * opt-outs) don't apply, but visible, audible and protected tabs are still never discarded.
 */
export function manualSleepBlocked(input: ProtectionInput, settings: RuleSettings): string | null {
  if (input.tab.discarded) return 'Already sleeping';
  if (!isDiscardableUrl(input.tab.url)) return 'Browser pages cannot sleep';
  const hard = protectionReasons(input, settings).filter((r) => r !== 'pinned' && r !== 'excluded' && r !== 'opted-out');
  return hard.length ? PROTECTION_LABELS[hard[0]] : null;
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} days`;
}
