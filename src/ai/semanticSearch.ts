// Natural-language search across open, sleeping, archived, closed (and optionally history) tabs.
// Combines lexical matching, embedding similarity, the kind of page asked for, and time.

import { indexDoc, lexicalScore, type SearchDoc } from '../core/search';
import { domainMatches, matchesAny } from '../shared/url';
import { embedCached, localEmbeddingProvider, type EmbeddingProvider } from './providers';
import { parseQuery, type ParsedQuery } from './queryParser';
import { domainCategory } from './taxonomy';
import { recordText, words } from './text';
import { cosine } from './vectors';

const DAY = 86_400_000;

export interface SemanticDoc extends SearchDoc {
  createdAt?: number;
  archivedAt?: number | null;
  closedAt?: number | null;
}

export interface SemanticHit<T extends SemanticDoc = SemanticDoc> {
  doc: T;
  score: number;
  reasons: string[];
}

export interface SemanticResult<T extends SemanticDoc = SemanticDoc> {
  parsed: ParsedQuery;
  hits: SemanticHit<T>[];
  provider: string;
}

function relativeDay(ts: number, now: number): string {
  const days = Math.floor((now - ts) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function timestamps(d: SemanticDoc): number[] {
  return [d.lastActiveAt, d.createdAt, d.archivedAt, d.closedAt].filter((t): t is number => typeof t === 'number' && t > 0);
}

export async function semanticSearch<T extends SemanticDoc>(
  query: string,
  docs: T[],
  opts: { provider?: EmbeddingProvider; exclusions?: string[]; now?: number; limit?: number; signal?: AbortSignal; onProgress?: (d: number, n: number) => void } = {},
): Promise<SemanticResult<T>> {
  const now = opts.now ?? Date.now();
  const provider = opts.provider ?? localEmbeddingProvider;
  const parsed = parseQuery(query, now);
  if (!parsed.terms.length && !parsed.kind && !parsed.timeRange && !parsed.statuses) return { parsed, hits: [], provider: provider.label };

  let pool = parsed.statuses ? docs.filter((d) => (parsed.statuses as string[]).includes(d.status)) : docs;
  if (parsed.statuses && !pool.length) pool = docs; // don't return nothing just because of a status word

  // Lexical
  const index = pool.map((d) => indexDoc(d));
  const lexHits = parsed.terms.length ? lexicalScore(index, parsed.terms) : [];
  const maxLex = Math.max(0.5, ...lexHits.map((h) => h.score));
  const lex = new Map(lexHits.map((h) => [h.doc.id, { s: h.score / maxLex, matched: h.matched }]));

  // Semantic: excluded tabs are never sent to a remote provider.
  const sem = new Map<string, number>();
  if (parsed.terms.length) {
    const remote = !provider.local;
    const eligible = remote && opts.exclusions?.length ? pool.filter((d) => !matchesAny(d.url, opts.exclusions!)) : pool;
    const qText = [parsed.terms.join(' '), parsed.kind?.label ?? ''].join(' ').trim();
    const vecs = await embedCached(
      provider,
      [{ text: qText }, ...eligible.map((d) => ({ text: recordText(d), url: d.url, domain: d.domain }))],
      { signal: opts.signal, onProgress: opts.onProgress },
    );
    const qv = vecs[0];
    const { searchLow: lo, searchHigh: hi } = provider.thresholds;
    eligible.forEach((d, i) => sem.set(d.id, Math.max(0, Math.min(1, (cosine(qv, vecs[i + 1]) - lo) / (hi - lo)))));
  }

  const hits: SemanticHit<T>[] = [];
  for (const d of pool) {
    const reasons: string[] = [];
    const l = lex.get(d.id);
    const e = sem.get(d.id) ?? 0;
    let kindScore = 0;
    if (parsed.kind) {
      const cat = domainCategory(d.url);
      if (parsed.kind.domains.some((dom) => domainMatches(d.domain, dom))) kindScore = 1;
      else if (cat && parsed.kind.categories.includes(cat)) kindScore = 0.85;
      else {
        const w = new Set(words(`${d.title} ${d.url}`));
        if (parsed.kind.keywords.some((k) => w.has(k))) kindScore = 0.5;
      }
      if (kindScore >= 0.85) reasons.push(`${parsed.kind.label} on ${d.domain}`);
    }
    let base: number;
    if (parsed.terms.length) {
      if (!l && e < 0.35) continue;
      base = 0.5 * (l?.s ?? 0) + 0.4 * e + 0.1 * kindScore;
      if (parsed.kind && kindScore === 0) base *= 0.6;
      if (l?.matched.length) reasons.unshift(`matches “${l.matched.join(' ')}”`);
      else if (e >= 0.45) reasons.unshift('similar topic');
    } else {
      if (parsed.kind && kindScore === 0) continue;
      const ageDays = (now - d.lastActiveAt) / DAY;
      base = 0.6 * (parsed.kind ? kindScore : 1) + 0.4 / (1 + ageDays / 7);
    }
    let timeFactor = 1;
    if (parsed.timeRange) {
      const { from, to } = parsed.timeRange;
      const ts = timestamps(d);
      const inside = ts.find((t) => t >= from && t <= to);
      if (inside != null) {
        reasons.push(`active ${relativeDay(inside, now)}`);
      } else {
        const dist = Math.min(...ts.map((t) => (t < from ? from - t : t - to)));
        timeFactor = 0.3 + 0.7 * Math.exp(-dist / Math.max(DAY, to - from));
        if (!parsed.terms.length && timeFactor < 0.6) continue;
      }
    } else {
      timeFactor = 1 + 0.08 / (1 + (now - d.lastActiveAt) / (7 * DAY));
    }
    const score = base * timeFactor;
    if (score < 0.12) continue;
    hits.push({ doc: d, score, reasons });
  }
  hits.sort((a, b) => b.score - a.score || b.doc.lastActiveAt - a.doc.lastActiveAt);
  return { parsed, hits: hits.slice(0, opts.limit ?? 40), provider: provider.label };
}
