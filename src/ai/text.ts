// Text normalization shared by lexical search, the local embedding model and clustering.

export const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren as at be because been before being below between both but by
  can cannot could did do does doing don down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is isn it its itself just let me more most my myself no nor not now of off on once only or other
  ought our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these
  they this those through to too under until up very was we were what when where which while who whom why will with would you
  your yours yourself yourselves via vs etc using use used get got new one two per like
  www com org net io co html htm php aspx index http https amp utm ref`
    .split(/\s+/)
    .filter(Boolean),
);

/** Very small suffix stripper; consistent rather than linguistically perfect. */
export function stem(token: string): string {
  let t = token;
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 5 && t.endsWith('sses')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('es') && /(sh|ch|x|z|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) t = t.slice(0, -1);
  if (t.length > 6 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 5 && t.endsWith('ed') && !t.endsWith('eed')) t = t.slice(0, -2);
  return t;
}

const SPLIT_RE = /[^\p{L}\p{N}]+/u;

/** Lower-cased word tokens with stopwords removed (not stemmed). */
export function words(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(SPLIT_RE)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d{5,}$/.test(w));
}

export function tokenize(text: string): string[] {
  return words(text).map(stem);
}

/** Split camelCase / snake / kebab identifiers found in URLs. */
function splitIdentifiers(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-+.~]/g, ' ')
    .replace(/%20/g, ' ');
}

const TLDS = new Set(['com', 'org', 'net', 'io', 'co', 'ai', 'dev', 'app', 'edu', 'gov', 'in', 'uk', 'us', 'de', 'fr', 'jp', 'me', 'so', 'sh', 'xyz', 'info', 'ac']);

/** Words from host (minus www/TLD) and path segments. Query strings are ignored except for search terms. */
export function urlWords(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const hostParts = u.hostname
    .toLowerCase()
    .split('.')
    .filter((p) => p !== 'www' && !TLDS.has(p));
  const path = decodeSafe(u.pathname)
    .split('/')
    .filter((seg) => seg && seg.length < 80 && !/^[0-9a-f-]{16,}$/i.test(seg))
    .map(splitIdentifiers)
    .join(' ');
  const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('search_query') || '';
  return words(`${hostParts.join(' ')} ${path} ${q}`);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface Textual {
  title: string;
  url: string;
  domain: string;
  meta?: { description?: string; keywords?: string; siteName?: string } | null;
}

/** The text that represents a tab for embeddings and LLM prompts (no page body content, ever). */
export function recordText(r: Textual): string {
  const parts = [r.title, r.domain, urlWords(r.url).join(' ')];
  if (r.meta?.siteName) parts.push(r.meta.siteName);
  if (r.meta?.description) parts.push(r.meta.description.slice(0, 300));
  if (r.meta?.keywords) parts.push(r.meta.keywords.slice(0, 150));
  return parts.filter(Boolean).join(' · ');
}

export function charTrigrams(word: string): string[] {
  const w = `^${word}$`;
  const out: string[] = [];
  for (let i = 0; i + 3 <= w.length; i++) out.push(w.slice(i, i + 3));
  return out;
}

/** Jaccard similarity of character trigrams; cheap typo tolerance. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = new Set(charTrigrams(a));
  const tb = new Set(charTrigrams(b));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter || 1);
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/** 32-bit FNV-1a. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function textHash(s: string): string {
  // Two independent hashes → 64 bits, plenty for a local cache key.
  return hash32(s).toString(36) + hash32('#' + s + s.length).toString(36);
}
