// Fast lexical search used for search-as-you-type (popup, omnibox, dashboard filter).
// Matches title, domain, URL words and page metadata with prefix + typo tolerance.

import { STOPWORDS, stem, trigramSimilarity, urlWords, words } from '../ai/text';
import type { TabRecord, TabStatus } from '../shared/types';

export interface SearchDoc {
  id: string;
  title: string;
  url: string;
  domain: string;
  status: TabStatus | 'history' | 'session';
  lastActiveAt: number;
  meta?: TabRecord['meta'];
}

export interface IndexedDoc<T extends SearchDoc = SearchDoc> {
  doc: T;
  fields: Array<{ tokens: string[]; weight: number }>;
  titleLower: string;
  urlLower: string;
}

export function indexDoc<T extends SearchDoc>(doc: T): IndexedDoc<T> {
  const metaText = [doc.meta?.description, doc.meta?.keywords, doc.meta?.siteName].filter(Boolean).join(' ');
  return {
    doc,
    fields: [
      { tokens: words(doc.title), weight: 3 },
      { tokens: words(doc.domain.replace(/\./g, ' ')), weight: 2 },
      { tokens: urlWords(doc.url), weight: 1 },
      { tokens: words(metaText), weight: 0.8 },
    ],
    titleLower: doc.title.toLowerCase(),
    urlLower: doc.url.toLowerCase(),
  };
}

/** Score of one query token against one doc token: exact > stem > prefix > substring > fuzzy. */
export function tokenMatch(q: string, t: string, isLast: boolean): number {
  if (q === t) return 1;
  if (stem(q) === stem(t)) return 0.9;
  if (t.startsWith(q) && q.length >= (isLast ? 1 : 2)) return 0.55 + 0.35 * (q.length / t.length);
  if (q.length >= 3 && t.includes(q)) return 0.45;
  if (q.length >= 4 && Math.abs(q.length - t.length) <= 3) {
    const sim = trigramSimilarity(q, t);
    if (sim >= 0.45) return 0.5 * sim;
  }
  return 0;
}

export interface LexicalHit<T extends SearchDoc = SearchDoc> {
  doc: T;
  score: number;
  matched: string[];
}

export interface LexicalOptions {
  /** Corpus-level token document frequency (for IDF weighting). Computed if omitted. */
  df?: Map<string, number>;
  requireAll?: boolean;
  limit?: number;
}

export function documentFrequencies(index: IndexedDoc[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of index) {
    const seen = new Set<string>();
    for (const f of d.fields) for (const t of f.tokens) seen.add(t);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

/** Score docs for already-tokenized query terms. Returns hits sorted by score (unnormalized). */
export function lexicalScore<T extends SearchDoc>(index: IndexedDoc<T>[], queryTokens: string[], opts: LexicalOptions = {}): LexicalHit<T>[] {
  if (!queryTokens.length) return [];
  const n = index.length || 1;
  const df = opts.df ?? documentFrequencies(index);
  const idf = (q: string) => Math.log(1 + n / (1 + (df.get(q) ?? df.get(stem(q)) ?? 0)));
  const weights = queryTokens.map((q) => Math.max(0.3, idf(q)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const phrase = queryTokens.join(' ');
  const hits: LexicalHit<T>[] = [];

  for (const d of index) {
    let score = 0;
    let matchedCount = 0;
    const matched: string[] = [];
    queryTokens.forEach((q, qi) => {
      let best = 0;
      for (const f of d.fields) {
        for (const t of f.tokens) {
          const m = tokenMatch(q, t, qi === queryTokens.length - 1) * f.weight;
          if (m > best) best = m;
        }
      }
      if (!best && q.length >= 3 && d.urlLower.includes(q)) best = 0.4;
      if (best > 0) {
        matchedCount++;
        matched.push(q);
        score += (best / 3) * weights[qi];
      }
    });
    if (!matchedCount) continue;
    if (opts.requireAll && matchedCount < queryTokens.length) continue;
    const coverage = matchedCount / queryTokens.length;
    score = (score / totalWeight) * (0.4 + 0.6 * coverage * coverage);
    if (queryTokens.length > 1 && d.titleLower.includes(phrase)) score *= 1.25;
    hits.push({ doc: d.doc, score, matched });
  }
  hits.sort((a, b) => b.score - a.score || b.doc.lastActiveAt - a.doc.lastActiveAt);
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}

const STATUS_BOOST: Record<SearchDoc['status'], number> = {
  open: 1.08,
  sleeping: 1.06,
  archived: 1.0,
  closed: 0.94,
  session: 0.92,
  history: 0.88,
};

/** Search-as-you-type over a set of docs. */
export function quickSearch<T extends SearchDoc>(index: IndexedDoc<T>[], query: string, limit = 50, now = Date.now()): LexicalHit<T>[] {
  const raw = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  // Drop stopwords unless that would leave nothing (the last token may still be mid-typing).
  const content = raw.filter((t, i) => !STOPWORDS.has(t) || i === raw.length - 1);
  const tokens = content.length ? content : raw;
  if (!tokens.length) return [];
  const hits = lexicalScore(index, tokens, { requireAll: tokens.length <= 3 });
  for (const h of hits) {
    const ageDays = Math.max(0, (now - h.doc.lastActiveAt) / 86_400_000);
    h.score *= STATUS_BOOST[h.doc.status] * (1 + 0.15 / (1 + ageDays));
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
