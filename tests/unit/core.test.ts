import { describe, expect, it } from 'vitest';
import { duplicateExtras, findDuplicateGroups } from '../../src/core/duplicates';
import { findReviveCandidate, planReconcile } from '../../src/core/reconcile';
import { lastActivity, manualSleepBlocked, protectionReasons, sleepDecision } from '../../src/core/rules';
import { indexDoc, quickSearch } from '../../src/core/search';
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings } from '../../src/shared/settings';
import { domainMatches, getDomain, isRestorableUrl, isTrackableUrl, matchesPattern, normalizeUrl } from '../../src/shared/url';
import { rec } from './fixtures';

const S = DEFAULT_SETTINGS;
const MIN = 60_000;

describe('url', () => {
  it('normalizes for duplicate detection', () => {
    expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#section')).toBe('example.com/a?a=1&b=2');
    expect(normalizeUrl('https://example.com/app#/route')).toBe('example.com/app#/route');
    expect(normalizeUrl('https://www.youtube.com/watch?v=abc&t=42s')).toBe(normalizeUrl('https://youtube.com/watch?v=abc'));
    expect(normalizeUrl('https://example.com/a?fbclid=1')).toBe(normalizeUrl('http://example.com/a/'));
  });
  it('classifies trackable and restorable URLs', () => {
    expect(isTrackableUrl('chrome://newtab/')).toBe(false);
    expect(isTrackableUrl('about:blank')).toBe(false);
    expect(isTrackableUrl('chrome-extension://abc/dashboard.html', 'chrome-extension://abc/')).toBe(false);
    expect(isTrackableUrl('https://a.com')).toBe(true);
    expect(isRestorableUrl('javascript:alert(1)')).toBe(false);
    expect(isRestorableUrl('data:text/html,hi')).toBe(false);
    expect(isRestorableUrl('not a url')).toBe(false);
    expect(isRestorableUrl('chrome://settings')).toBe(true);
  });
  it('matches domains and exclusion patterns', () => {
    expect(getDomain('https://www.github.com/x')).toBe('github.com');
    expect(domainMatches('mail.google.com', 'google.com')).toBe(true);
    expect(domainMatches('notgoogle.com', 'google.com')).toBe(false);
    expect(matchesPattern('https://docs.example.com/x', 'example.com')).toBe(true);
    expect(matchesPattern('https://example.com/admin/users', 'example.com/admin*')).toBe(true);
    expect(matchesPattern('https://example.com/blog', 'example.com/admin*')).toBe(false);
    expect(matchesPattern('https://bank.example.com/', '*.example.com')).toBe(true);
    expect(matchesPattern('https://docs.rs/x', 'https://docs.*')).toBe(true);
  });
});

describe('settings', () => {
  it('merges stored settings over defaults and drops unknown keys', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { sleep: { afterMinutes: 10, bogus: 1 }, junk: true, protectedDomains: ['A.com', 5] });
    expect(merged.sleep.afterMinutes).toBe(10);
    expect(merged.sleep.enabled).toBe(true);
    expect((merged as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect(sanitizeSettings(merged).protectedDomains).toEqual(['a.com']);
  });
  it('clamps out-of-range numbers', () => {
    const s = sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, { sleep: { afterMinutes: -5 }, archive: { afterDays: 9999 } }));
    expect(s.sleep.afterMinutes).toBe(1);
    expect(s.archive.afterDays).toBe(365);
  });
});

describe('protection rules', () => {
  const tab = { url: 'https://example.com', active: false, audible: false, pinned: false, discarded: false, status: 'complete', lastAccessed: 0 };
  const now = Date.now();
  it('never sleeps active, audible, protected, or protected-domain tabs', () => {
    const old = rec('https://example.com', 'x', { lastActiveAt: now - 600 * MIN });
    expect(sleepDecision({ tab: { ...tab, active: true }, record: old, workspaceProtected: false }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab: { ...tab, audible: true }, record: old, workspaceProtected: false }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab, record: { ...old, isProtected: true }, workspaceProtected: false }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab, record: old, workspaceProtected: true }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab: { ...tab, url: 'https://meet.google.com/abc' }, record: old, workspaceProtected: false }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab: { ...tab, pinned: true }, record: old, workspaceProtected: false }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab: { ...tab, url: 'chrome://settings' }, record: old, workspaceProtected: false }, S, now).sleep).toBe(false);
    expect(sleepDecision({ tab, record: old, workspaceProtected: false }, S, now).sleep).toBe(true);
  });
  it('respects the inactivity threshold using the newest activity signal', () => {
    const recent = rec('https://example.com', 'x', { lastActiveAt: now - 5 * MIN });
    expect(sleepDecision({ tab, record: recent, workspaceProtected: false }, S, now).sleep).toBe(false);
    const stale = rec('https://example.com', 'x', { lastActiveAt: now - 500 * MIN });
    expect(lastActivity({ lastAccessed: now - MIN }, stale)).toBe(now - MIN);
    expect(sleepDecision({ tab: { ...tab, lastAccessed: now - MIN }, record: stale, workspaceProtected: false }, S, now).sleep).toBe(false);
  });
  it('lets the user manually sleep pinned tabs but not protected or audible ones', () => {
    const r = rec('https://example.com', 'x');
    expect(manualSleepBlocked({ tab: { ...tab, pinned: true }, record: r, workspaceProtected: false }, S)).toBeNull();
    expect(manualSleepBlocked({ tab: { ...tab, audible: true }, record: r, workspaceProtected: false }, S)).toBe('Playing audio');
    expect(manualSleepBlocked({ tab, record: { ...r, isProtected: true }, workspaceProtected: false }, S)).toBe('Protected tab');
    expect(protectionReasons({ tab: { ...tab, url: 'https://x.com/a' }, record: r, workspaceProtected: false }, { ...S, exclusions: ['x.com'] })).toContain('excluded');
  });
});

describe('duplicates', () => {
  it('groups live tabs by normalized URL and keeps the best copy', () => {
    const a = rec('https://a.com/p?utm_source=z', 'A', { lastActiveAt: 1 });
    const b = rec('https://www.a.com/p', 'A', { lastActiveAt: 5, pinned: true });
    const c = rec('https://a.com/p', 'A', { status: 'archived', chromeTabId: null });
    const d = rec('https://b.com', 'B');
    const groups = findDuplicateGroups([a, b, c, d]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keepRecordId).toBe(b.id);
    expect(duplicateExtras(groups)).toEqual([a.id]);
  });
});

describe('reconcile (browser restarts)', () => {
  const now = Date.now();
  it('matches by id within the same session even if the URL changed', () => {
    const r = rec('https://a.com', 'A', { chromeTabId: 7 });
    const plan = planReconcile([r], [{ id: 7, windowId: 1, index: 0, url: 'https://a.com/next' }], { now, sameSession: true, markMissing: true, reviveWindowMs: 1e9 });
    expect(plan.matched).toEqual([{ recordId: r.id, tabId: 7, how: 'id' }]);
  });
  it('rebinds records to new tab ids by URL after a restart and keeps workspaces', () => {
    const r1 = rec('https://a.com', 'A', { chromeTabId: 1, index: 0, workspaceId: 'ws1' });
    const r2 = rec('https://b.com', 'B', { chromeTabId: 2, index: 1 });
    // After restart: ids are new, and a stale id (2) now belongs to a different page.
    const tabs = [
      { id: 2, windowId: 9, index: 0, url: 'https://a.com' },
      { id: 50, windowId: 9, index: 1, url: 'https://b.com' },
      { id: 51, windowId: 9, index: 2, url: 'https://c.com' },
    ];
    const plan = planReconcile([r1, r2], tabs, { now, sameSession: false, markMissing: false, reviveWindowMs: 1e9 });
    expect(plan.matched).toContainEqual({ recordId: r1.id, tabId: 2, how: 'url' });
    expect(plan.matched).toContainEqual({ recordId: r2.id, tabId: 50, how: 'url' });
    expect(plan.create).toEqual([51]);
    expect(plan.missing).toEqual([]);
  });
  it('revives records closed with their window, and only marks missing when told to', () => {
    const closed = rec('https://a.com', 'A', { status: 'closed', closeReason: 'window-closed', closedAt: now - 1000, chromeTabId: null, workspaceId: 'ws' });
    const gone = rec('https://gone.com', 'G', { chromeTabId: 3 });
    const tabs = [{ id: 10, windowId: 1, index: 0, url: 'https://a.com' }];
    const early = planReconcile([closed, gone], tabs, { now, sameSession: false, markMissing: false, reviveWindowMs: 1e9 });
    expect(early.matched).toEqual([{ recordId: closed.id, tabId: 10, how: 'revived' }]);
    expect(early.missing).toEqual([]);
    expect(early.detach).toEqual([gone.id]);
    const late = planReconcile([closed, gone], tabs, { now, sameSession: true, markMissing: true, reviveWindowMs: 1e9 });
    expect(late.missing).toEqual([gone.id]);
  });
  it('does not revive user-closed tabs after 10 minutes, or archived tabs ever', () => {
    const userClosed = rec('https://a.com', 'A', { status: 'closed', closeReason: 'user', closedAt: now - 20 * MIN, chromeTabId: null });
    const archived = rec('https://a.com', 'A', { status: 'archived', chromeTabId: null });
    expect(findReviveCandidate([userClosed, archived], 'https://a.com', now)).toBeNull();
    const fresh = { ...userClosed, closedAt: now - MIN };
    expect(findReviveCandidate([fresh], 'https://a.com', now)?.id).toBe(fresh.id);
  });
});

describe('quick search', () => {
  const docs = [
    rec('https://github.com/vitejs/vite', 'vitejs/vite: Next generation frontend tooling'),
    rec('https://react.dev/learn', 'Quick Start – React'),
    rec('https://example.com/recipes', 'Best pasta recipes', { status: 'archived', chromeTabId: null }),
  ].map(indexDoc);
  it('finds by prefix while typing, by domain, and tolerates typos', () => {
    expect(quickSearch(docs, 'vit')[0].doc.title).toContain('vite');
    expect(quickSearch(docs, 'react')[0].doc.title).toContain('React');
    expect(quickSearch(docs, 'github')[0].doc.domain).toBe('github.com');
    expect(quickSearch(docs, 'recipies')[0]?.doc.title).toContain('pasta');
    expect(quickSearch(docs, 'zzzz')).toHaveLength(0);
  });
});
