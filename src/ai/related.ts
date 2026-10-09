// Related-tab discovery: pages about the same thing, deliberately favouring other sites.

import type { TabRecord } from '../shared/types';
import { matchesAny } from '../shared/url';
import { embedCached, type EmbeddingProvider } from './providers';
import { CATEGORY_BY_ID, classify } from './taxonomy';
import { recordText, stem, words } from './text';
import { cosine } from './vectors';

const GENERIC = new Set(['home', 'page', 'free', 'online', 'official', 'site', 'new', 'best', 'guide', 'how', 'introduction', 'blog', 'docs', 'search']);

function keywordSet(r: TabRecord): Set<string> {
  const text = [r.title, r.meta?.description ?? '', r.meta?.keywords ?? ''].join(' ');
  return new Set(words(text).filter((w) => w.length > 2 && !GENERIC.has(w)).map(stem));
}

export interface RelatedHit {
  record: TabRecord;
  score: number;
  reasons: string[];
}

export async function findRelated(
  target: TabRecord,
  pool: TabRecord[],
  provider: EmbeddingProvider,
  opts: { limit?: number; exclusions?: string[]; signal?: AbortSignal } = {},
): Promise<RelatedHit[]> {
  const candidates = pool.filter(
    (r) => r.id !== target.id && r.normalizedUrl !== target.normalizedUrl && !(opts.exclusions && !provider.local && matchesAny(r.url, opts.exclusions)),
  );
  if (!candidates.length) return [];
  const all = [target, ...candidates];
  const texts = all.map((r) => recordText(r));
  const vecs = await embedCached(
    provider,
    all.map((r, i) => ({ text: texts[i], url: r.url, domain: r.domain })),
    { signal: opts.signal },
  );
  const tCat = classify(texts[0], target.url);
  const tKw = keywordSet(target);
  const hits: RelatedHit[] = [];
  candidates.forEach((r, i) => {
    const reasons: string[] = [];
    let s = cosine(vecs[0], vecs[i + 1]);
    const kw = keywordSet(r);
    const shared = [...tKw].filter((k) => kw.has(k));
    if (shared.length) {
      const j = shared.length / (tKw.size + kw.size - shared.length || 1);
      s += 0.6 * j;
      reasons.push(`shared: ${shared.slice(0, 3).join(', ')}`);
    }
    const c = classify(texts[i + 1], r.url);
    if (tCat && c?.id === tCat.id) {
      s += 0.05;
      reasons.push(CATEGORY_BY_ID.get(c.id)!.name);
    }
    if (r.domain === target.domain) {
      s *= 0.75;
      reasons.push('same site');
    } else reasons.push(r.domain);
    if (s >= provider.thresholds.related) hits.push({ record: r, score: s, reasons });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8);
}
