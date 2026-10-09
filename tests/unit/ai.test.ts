import { describe, expect, it } from 'vitest';
import { agglomerative } from '../../src/ai/cluster';
import { buildProposal } from '../../src/ai/organize';
import { localEmbeddingProvider, localLanguageProvider, parseNaming, resolveProviders } from '../../src/ai/providers';
import { parseQuery } from '../../src/ai/queryParser';
import { findRelated } from '../../src/ai/related';
import { semanticSearch } from '../../src/ai/semanticSearch';
import { suggestArchival } from '../../src/ai/smartArchive';
import { classify, domainCategory } from '../../src/ai/taxonomy';
import { recordText } from '../../src/ai/text';
import { cosine, localEmbed } from '../../src/ai/vectors';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { rec, sampleSession } from './fixtures';

const DAY = 86_400_000;
// Wednesday 2026-10-14 15:00 local time
const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime();

describe('taxonomy', () => {
  it('prefers the most specific domain rule', () => {
    expect(domainCategory('https://www.amazon.com/dp/1')).toBe('shopping');
    expect(domainCategory('https://aws.amazon.com/lambda')).toBe('coding');
    expect(domainCategory('https://www.amazon.co.uk/x')).toBe('shopping');
    expect(domainCategory('https://cs.stanford.edu/x')).toBe('college');
    expect(domainCategory('https://www.linkedin.com/jobs/view/1')).toBe('jobs');
    expect(domainCategory('https://www.linkedin.com/in/someone')).toBe('social');
  });
  it('classifies AI papers on general research sites as AI Research', () => {
    const r = rec('https://arxiv.org/abs/1', 'Detecting hallucinations in large language models using semantic entropy');
    expect(classify(recordText(r), r.url)?.name).toBe('AI Research');
    const phys = rec('https://arxiv.org/abs/2', 'Topological phases in twisted bilayer graphene');
    expect(classify(recordText(phys), phys.url)?.name).toBe('Research Papers');
  });
  it('uses keywords when the site is unknown', () => {
    const r = rec('https://someblog.example/post', 'How we raised our seed round: pitch deck and investor notes for founders');
    expect(classify(recordText(r), r.url)?.name).toBe('Startups');
  });
});

describe('local embeddings', () => {
  it('puts same-topic pages closer than unrelated ones', () => {
    const a = localEmbed({ text: 'Semantic entropy for hallucination detection in LLMs', url: 'https://arxiv.org/abs/1', domain: 'arxiv.org' });
    const b = localEmbed({ text: 'Detecting hallucinations in large language models using semantic entropy', url: 'https://nature.com/x', domain: 'nature.com' });
    const c = localEmbed({ text: 'Buy Sony headphones best price', url: 'https://amazon.com/x', domain: 'amazon.com' });
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c) + 0.2);
  });
  it('clusters similar vectors together', () => {
    const v = (t: string) => localEmbed({ text: t });
    const clusters = agglomerative([v('react hooks useeffect'), v('react hooks usestate tutorial'), v('pasta recipe tomato'), v('tomato pasta sauce recipe')], 0.2);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => [...c].sort()).sort()).toEqual([[0, 1], [2, 3]]);
  });
});

describe('organize proposal', () => {
  it('groups a mixed session into meaningful workspaces without touching anything', async () => {
    const records = sampleSession(NOW);
    const proposal = await buildProposal({
      records,
      workspaceMembers: [],
      workspaces: [],
      embedding: localEmbeddingProvider,
      language: localLanguageProvider,
      exclusions: [],
      minGroupSize: 2,
    });
    const names = proposal.groups.map((g) => g.name);
    for (const expected of ['AI Research', 'Coding', 'Shopping', 'College', 'Startups']) expect(names).toContain(expected);
    const byName = Object.fromEntries(proposal.groups.map((g) => [g.name, g]));
    expect(byName['AI Research'].recordIds).toContain('semantic-entropy');
    expect(byName['AI Research'].recordIds).toContain('nature-entropy');
    // Every record appears at most once.
    const all = proposal.groups.flatMap((g) => g.recordIds).concat(proposal.unassigned);
    expect(new Set(all).size).toBe(all.length);
    for (const g of proposal.groups) expect(g.summary.length).toBeGreaterThan(0);
  });

  it('proposes existing workspaces for matching tabs and respects exclusions', async () => {
    const ws = { id: 'w1', name: 'Coding', color: 'blue' as const, summary: '', source: 'manual' as const, isProtected: false, order: 0, createdAt: 0, updatedAt: 0, lastActiveAt: 0 };
    const members = [rec('https://github.com/a/b', 'a/b: repo', { workspaceId: 'w1' })];
    const records = sampleSession(NOW);
    const proposal = await buildProposal({
      records,
      workspaceMembers: members,
      workspaces: [ws],
      embedding: localEmbeddingProvider,
      language: localLanguageProvider,
      exclusions: ['amazon.com'],
      minGroupSize: 2,
    });
    const coding = proposal.groups.find((g) => g.existingWorkspaceId === 'w1');
    expect(coding?.name).toBe('Coding');
    expect(coding!.recordIds.length).toBeGreaterThanOrEqual(3);
    const amazon = records.find((r) => r.domain === 'amazon.com')!;
    expect(proposal.groups.flatMap((g) => g.recordIds)).not.toContain(amazon.id);
    expect(proposal.warnings.join(' ')).toContain('excluded');
  });
});

describe('natural-language queries', () => {
  it('parses kind, time and topic', () => {
    const p = parseQuery('that paper about semantic entropy I opened last week', NOW);
    expect(p.terms).toEqual(['semantic', 'entropy']);
    expect(p.kind?.id).toBe('paper');
    expect(p.timeRange?.label).toBe('last week');
    // Monday 2026-10-05 00:00 → Monday 2026-10-12 00:00
    expect(new Date(p.timeRange!.from).getDate()).toBe(5);
    expect(new Date(p.timeRange!.to).getDate()).toBe(12);
  });
  it('understands relative phrases and statuses', () => {
    expect(parseQuery('react docs from yesterday', NOW).timeRange?.label).toBe('yesterday');
    expect(parseQuery('3 days ago headphones', NOW).terms).toEqual(['headphones']);
    expect(parseQuery('the video I watched a couple of weeks ago', NOW).kind?.id).toBe('video');
    expect(parseQuery('archived startup tabs', NOW).statuses).toEqual(['archived']);
    expect(parseQuery('github repo I closed', NOW).statuses).toEqual(['closed']);
    expect(parseQuery('on monday', NOW).timeRange?.label).toBe('Monday');
  });
  it('finds the semantic entropy paper from a vague description', async () => {
    const records = sampleSession(NOW);
    const res = await semanticSearch('that paper about semantic entropy I opened last week', records, { now: NOW });
    expect(['semantic-entropy', 'nature-entropy']).toContain(res.hits[0].doc.id);
    expect(res.hits.slice(0, 2).map((h) => h.doc.id).sort()).toEqual(['nature-entropy', 'semantic-entropy']);
    expect(res.hits[0].reasons.length).toBeGreaterThan(0);
  });
  it('ranks by kind and time when there is no topic', async () => {
    const records = sampleSession(NOW);
    const res = await semanticSearch('videos', records, { now: NOW });
    expect(res.hits[0].doc.domain).toBe('youtube.com');
  });
});

describe('related tabs', () => {
  it('finds same-topic pages on other sites', async () => {
    const records = sampleSession(NOW);
    const target = records.find((r) => r.id === 'semantic-entropy')!;
    const related = await findRelated(target, records, localEmbeddingProvider);
    expect(related[0].record.id).toBe('nature-entropy');
    expect(related.every((h) => h.record.id !== target.id)).toBe(true);
  });
});

describe('smart archival', () => {
  it('suggests stale and duplicate tabs but not protected or current-workspace ones', () => {
    const now = NOW;
    const tabFor = (r: ReturnType<typeof rec>) => [r.chromeTabId!, { url: r.url, active: false, audible: false, pinned: r.pinned, discarded: false, lastAccessed: r.lastActiveAt }] as const;
    const stale = rec('https://old.com/a', 'Old', { lastActiveAt: now - 10 * DAY });
    const dupA = rec('https://dup.com/x', 'Dup', { lastActiveAt: now - 0.1 * DAY });
    const dupB = rec('https://dup.com/x', 'Dup', { lastActiveAt: now - 2 * DAY });
    const prot = rec('https://old2.com', 'Protected', { lastActiveAt: now - 30 * DAY, isProtected: true });
    const fresh = rec('https://fresh.com', 'Fresh', { lastActiveAt: now - 60_000 });
    const records = [stale, dupA, dupB, prot, fresh];
    const out = suggestArchival({
      records,
      tabsById: new Map(records.map(tabFor)),
      workspaces: [],
      settings: DEFAULT_SETTINGS,
      now,
      afterDays: 3,
    });
    const ids = out.map((c) => c.recordId);
    expect(ids).toContain(stale.id);
    expect(ids).toContain(dupB.id);
    expect(ids).not.toContain(dupA.id);
    expect(ids).not.toContain(prot.id);
    expect(ids).not.toContain(fresh.id);
    expect(out.find((c) => c.recordId === dupB.id)!.reasons.join(' ')).toContain('Duplicate');
  });
});

describe('providers', () => {
  it('falls back to built-in providers without consent or keys', () => {
    const ai = { ...DEFAULT_SETTINGS.ai, embeddingProvider: 'openai' as const, languageProvider: 'anthropic' as const, openai: { ...DEFAULT_SETTINGS.ai.openai, apiKey: 'k' }, anthropic: { apiKey: 'k', model: 'claude-opus-5-5' } };
    const r = resolveProviders(ai);
    expect(r.embedding.id).toBe('local');
    expect(r.language.id).toBe('local');
    expect(r.warnings.length).toBe(2);
    const consented = resolveProviders({ ...ai, externalConsent: true });
    expect(consented.embedding.id).toBe('openai');
    expect(consented.language.id).toBe('anthropic');
  });
  it('treats local Ollama as on-device', () => {
    const r = resolveProviders({ ...DEFAULT_SETTINGS.ai, embeddingProvider: 'ollama', languageProvider: 'ollama' });
    expect(r.embedding.id).toBe('ollama');
    expect(r.warnings).toEqual([]);
  });
  it('parses model naming replies defensively', () => {
    const groups = [{ key: 'a', suggestedName: '', titles: [], domains: [], keywords: [] }];
    expect(parseNaming('Sure! [{"key":"a","name":"\\"ML Papers\\"","summary":"Reading"}]', groups)).toEqual([{ key: 'a', name: 'ML Papers', summary: 'Reading' }]);
    expect(parseNaming('[{"key":"zzz","name":"x"}]', groups)).toEqual([]);
    expect(() => parseNaming('no json here', groups)).toThrow();
  });
});
