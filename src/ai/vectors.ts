// The built-in, fully offline "embedding": a feature-hashed vector of words, word bigrams, character
// trigrams (typo tolerance), the site, and topic-concept features from the taxonomy (so pages on
// unrelated sites about the same topic still end up close together). Deterministic and instant.

import { charTrigrams, hash32, stem, urlWords, words } from './text';
import { scoreCategories } from './taxonomy';

export const LOCAL_DIM = 1024;

function add(vec: Float32Array, feature: string, weight: number): void {
  const h = hash32(feature);
  const idx = h % LOCAL_DIM;
  vec[idx] += (h & 0x80000000 ? -1 : 1) * weight;
}

export interface LocalEmbedInput {
  text: string;
  url?: string;
  domain?: string;
}

export function localEmbed(input: LocalEmbedInput): number[] {
  const vec = new Float32Array(LOCAL_DIM);
  const toks = words(input.text);
  const stems = toks.map(stem);
  const seen = new Map<string, number>();
  for (const s of stems) seen.set(s, (seen.get(s) ?? 0) + 1);
  for (const [s, n] of seen) {
    add(vec, 'w:' + s, 1 + Math.log(n));
    if (s.length >= 4) {
      const tris = charTrigrams(s);
      for (const t of tris) add(vec, 'c:' + t, 0.35 / Math.sqrt(tris.length));
    }
  }
  for (let i = 0; i + 1 < stems.length; i++) add(vec, `b:${stems[i]}_${stems[i + 1]}`, 0.6);
  if (input.url) for (const w of urlWords(input.url)) add(vec, 'u:' + stem(w), 0.3);
  if (input.domain) add(vec, 'd:' + input.domain, 0.9);
  const cats = scoreCategories(input.text, input.url ?? '');
  for (const c of cats.slice(0, 3)) if (c.score >= 0.4) add(vec, 'cat:' + c.id, 1.6 * Math.min(1, c.score / 1.2));
  return normalize(Array.from(vec));
}

export function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (!n) return v;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function centroid(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i];
  return normalize(out);
}
