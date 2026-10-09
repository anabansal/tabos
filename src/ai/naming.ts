// Offline naming for groups of tabs: taxonomy category, dominant site, or distinctive keywords.

import { CATEGORIES } from './taxonomy';
import { STOPWORDS, titleCase, words } from './text';

export interface NamingInput {
  suggestedName: string;
  titles: string[];
  domains: string[];
  keywords: string[];
}

const GENERIC = new Set([
  ...STOPWORDS,
  'home', 'page', 'login', 'sign', 'search', 'results', 'google', 'untitled', 'dashboard', 'welcome', 'official', 'site', 'free',
  'online', 'best', 'top', 'new', 'how', 'what', 'why', 'guide', 'introduction', 'overview', 'part', 'chapter', 'pdf', 'html',
]);

/** Distinctive words of a group relative to the whole corpus (tf × idf over titles). */
export function distinctiveKeywords(groupTitles: string[], corpusDf: Map<string, number>, corpusSize: number, limit = 6): string[] {
  const tf = new Map<string, number>();
  for (const t of groupTitles) {
    for (const w of new Set(words(t))) {
      if (GENERIC.has(w) || w.length < 3 || /^\d+$/.test(w)) continue;
      tf.set(w, (tf.get(w) ?? 0) + 1);
    }
  }
  return [...tf.entries()]
    .filter(([, n]) => n >= Math.min(2, groupTitles.length))
    .map(([w, n]) => [w, (n / groupTitles.length) * Math.log(1 + corpusSize / (1 + (corpusDf.get(w) ?? 0)))] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

export function titleDf(titles: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of titles) for (const w of new Set(words(t))) df.set(w, (df.get(w) ?? 0) + 1);
  return df;
}

const SITE_NAMES: Record<string, string> = {
  'github.com': 'GitHub',
  'youtube.com': 'YouTube',
  'stackoverflow.com': 'Stack Overflow',
  'arxiv.org': 'arXiv',
  'reddit.com': 'Reddit',
  'x.com': 'X',
  'twitter.com': 'Twitter',
  'docs.google.com': 'Google Docs',
  'linkedin.com': 'LinkedIn',
  'amazon.com': 'Amazon',
  'medium.com': 'Medium',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'wikipedia.org': 'Wikipedia',
  'en.wikipedia.org': 'Wikipedia',
};

export function siteName(domain: string): string {
  if (SITE_NAMES[domain]) return SITE_NAMES[domain];
  const base = domain.split('.').slice(-2, -1)[0] ?? domain;
  return titleCase(base.replace(/[-_]/g, ' '));
}

export function localNames(g: NamingInput): { name: string; summary: string } {
  const sites = g.domains.slice(0, 3).join(', ');
  const kw = g.keywords.slice(0, 4);
  const isCategory = CATEGORIES.some((c) => c.name === g.suggestedName);
  let name = g.suggestedName;
  if (!name) {
    if (kw.length >= 2) name = titleCase(`${kw[0]} ${kw[1]}`);
    else if (kw.length === 1) name = titleCase(kw[0]);
    else if (g.domains[0]) name = siteName(g.domains[0]);
    else name = 'Reading List';
  }
  const n = g.titles.length;
  const about = kw.length ? `about ${kw.slice(0, 3).join(', ')}` : '';
  const summary = isCategory
    ? `${n} ${n === 1 ? 'tab' : 'tabs'} ${about}${sites ? ` · mostly ${sites}` : ''}`.trim()
    : `${n} related ${n === 1 ? 'tab' : 'tabs'}${about ? ' ' + about : ''}${sites ? ` from ${sites}` : ''}`;
  return { name: name.slice(0, 40), summary: summary.slice(0, 200) };
}
