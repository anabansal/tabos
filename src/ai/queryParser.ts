// Turns "that paper about semantic entropy I opened last week" into
//   terms: [semantic, entropy] · kind: paper · time: last week

import type { TabStatus } from '../shared/types';

export interface TimeRange {
  from: number;
  to: number;
  label: string;
}

export interface KindHint {
  id: 'paper' | 'video' | 'repo' | 'docs' | 'social' | 'shopping' | 'course' | 'article' | 'job';
  label: string;
  categories: string[];
  domains: string[];
  keywords: string[];
}

export interface ParsedQuery {
  raw: string;
  terms: string[];
  timeRange: TimeRange | null;
  statuses: TabStatus[] | null;
  kind: KindHint | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const KINDS: Array<KindHint & { triggers: RegExp }> = [
  {
    id: 'paper',
    label: 'paper',
    triggers: /\b(papers?|pdfs?|preprints?|publications?|journal articles?|research papers?)\b/g,
    categories: ['ai-research', 'research'],
    domains: ['arxiv.org', 'openreview.net', 'semanticscholar.org', 'scholar.google.com', 'aclanthology.org', 'researchgate.net', 'nature.com', 'sciencedirect.com', 'dl.acm.org', 'ieeexplore.ieee.org', 'biorxiv.org', 'ssrn.com', 'proceedings.neurips.cc', 'proceedings.mlr.press'],
    keywords: ['paper', 'pdf', 'arxiv', 'abstract', 'preprint'],
  },
  {
    id: 'video',
    label: 'video',
    triggers: /\b(videos?|youtube|clips?|talks?|lectures? video|watched|livestreams?|trailers?)\b/g,
    categories: ['media'],
    domains: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv'],
    keywords: ['video', 'youtube', 'watch'],
  },
  {
    id: 'repo',
    label: 'repository',
    triggers: /\b(repos?|repositor(y|ies)|github|gitlab|codebase|library|libraries|packages?)\b/g,
    categories: ['coding'],
    domains: ['github.com', 'gitlab.com', 'bitbucket.org', 'npmjs.com', 'pypi.org', 'crates.io'],
    keywords: ['github', 'repository'],
  },
  {
    id: 'docs',
    label: 'documentation',
    triggers: /\b(docs|documentation|api reference|reference docs?|manual)\b/g,
    categories: ['coding'],
    domains: ['developer.mozilla.org', 'readthedocs.io', 'docs.python.org', 'learn.microsoft.com', 'devdocs.io'],
    keywords: ['docs', 'documentation', 'reference', 'api'],
  },
  {
    id: 'social',
    label: 'post',
    triggers: /\b(tweets?|threads?|reddit posts?|subreddit|linkedin posts?)\b/g,
    categories: ['social'],
    domains: ['x.com', 'twitter.com', 'reddit.com', 'linkedin.com', 'threads.net', 'bsky.app'],
    keywords: ['tweet', 'thread', 'post'],
  },
  {
    id: 'shopping',
    label: 'product',
    triggers: /\b(products?|buy|bought|shopping|listing|for sale)\b/g,
    categories: ['shopping'],
    domains: ['amazon.com', 'amazon.in', 'flipkart.com', 'ebay.com', 'etsy.com'],
    keywords: ['price', 'buy', 'cart'],
  },
  {
    id: 'course',
    label: 'course material',
    triggers: /\b(courses?|lecture notes|assignments?|homework|syllabus|class notes)\b/g,
    categories: ['college'],
    domains: ['coursera.org', 'edx.org', 'instructure.com', 'gradescope.com', 'piazza.com'],
    keywords: ['course', 'lecture', 'assignment'],
  },
  {
    id: 'job',
    label: 'job posting',
    triggers: /\b(jobs?|job posts?|job postings?|openings?|internships?|roles?)\b/g,
    categories: ['jobs'],
    domains: ['linkedin.com', 'indeed.com', 'wellfound.com', 'lever.co', 'greenhouse.io'],
    keywords: ['job', 'hiring', 'apply'],
  },
  {
    id: 'article',
    label: 'article',
    triggers: /\b(articles?|blog posts?|blogs?|essays?|newsletters?|write-?ups?)\b/g,
    categories: ['news'],
    domains: ['medium.com', 'substack.com'],
    keywords: ['blog', 'article'],
  },
];

const FILLER = new Set(
  `that the a an about on of in into which i me my mine opened open saw seen read visited was were looking looked at some
  something tab tabs page pages site website websites link links one thing stuff find show where with from for regarding called
  named there had did do remember think maybe like kind sort just was is it this those these when what who how around before
  after ago during while been having have has get got go went over back again also any all whatever somewhere talking explaining
  explained describing described discussing discussed by to`
    .split(/\s+/)
    .filter(Boolean),
);

const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  few: 3, 'a few': 3, couple: 2, 'a couple': 2, 'a couple of': 2, 'couple of': 2, several: 4,
};
const UNIT_MS: Record<string, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return d.getTime() - dow * DAY;
}
function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function parseCount(s: string): number {
  const t = s.trim();
  return /^\d+$/.test(t) ? Number(t) : (NUM_WORDS[t] ?? 1);
}

interface TimeRule {
  re: RegExp;
  range: (m: RegExpMatchArray, now: number) => TimeRange;
}

const COUNT = String.raw`(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|a few|few|a couple(?: of)?|couple(?: of)?|several)`;
const UNIT = String.raw`(hour|day|week|month|year)s?`;

const TIME_RULES: TimeRule[] = [
  { re: /\bday before yesterday\b/, range: (_m, now) => ({ from: startOfDay(now) - 2 * DAY, to: startOfDay(now) - DAY, label: 'the day before yesterday' }) },
  { re: /\blast night\b/, range: (_m, now) => ({ from: startOfDay(now) - 6 * HOUR, to: startOfDay(now) + 6 * HOUR, label: 'last night' }) },
  { re: /\byesterday\b/, range: (_m, now) => ({ from: startOfDay(now) - DAY, to: startOfDay(now), label: 'yesterday' }) },
  { re: /\b(earlier )?today\b|\bthis (morning|afternoon|evening)\b|\btonight\b/, range: (_m, now) => ({ from: startOfDay(now), to: now, label: 'today' }) },
  { re: /\blast weekend\b/, range: (_m, now) => ({ from: startOfWeek(now) - 2 * DAY, to: startOfWeek(now), label: 'last weekend' }) },
  { re: /\bthis weekend\b/, range: (_m, now) => ({ from: startOfWeek(now) + 5 * DAY, to: now, label: 'this weekend' }) },
  { re: /\bthis week\b/, range: (_m, now) => ({ from: startOfWeek(now), to: now, label: 'this week' }) },
  { re: /\blast week\b/, range: (_m, now) => ({ from: startOfWeek(now) - 7 * DAY, to: startOfWeek(now), label: 'last week' }) },
  { re: /\bthis month\b/, range: (_m, now) => ({ from: startOfMonth(now), to: now, label: 'this month' }) },
  {
    re: /\blast month\b/,
    range: (_m, now) => {
      const d = new Date(startOfMonth(now));
      return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: d.getTime(), label: 'last month' };
    },
  },
  {
    re: new RegExp(String.raw`\b(?:in the |over the )?(?:past|last) ${COUNT} ${UNIT}\b`),
    range: (m, now) => {
      const n = parseCount(m[1]);
      return { from: now - n * UNIT_MS[m[2]], to: now, label: `the past ${n} ${m[2]}${n === 1 ? '' : 's'}` };
    },
  },
  {
    re: new RegExp(String.raw`\b${COUNT} ${UNIT} ago\b`),
    range: (m, now) => {
      const n = parseCount(m[1]);
      const unit = UNIT_MS[m[2]];
      const center = now - n * unit;
      const slack = Math.max(unit * 0.6, n * unit * 0.35);
      return { from: center - slack, to: Math.min(now, center + slack), label: `about ${n} ${m[2]}${n === 1 ? '' : 's'} ago` };
    },
  },
  { re: /\bthe other day\b/, range: (_m, now) => ({ from: now - 6 * DAY, to: now - DAY, label: 'the other day' }) },
  { re: /\b(recently|lately|just now)\b/, range: (_m, now) => ({ from: now - 4 * DAY, to: now, label: 'recently' }) },
  {
    re: /\b(?:on |last |this past )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    range: (m, now) => {
      const target = WEEKDAYS.indexOf(m[1]);
      const today = new Date(now).getDay();
      let back = (today - target + 7) % 7;
      if (back === 0 && /\blast\b/.test(m[0])) back = 7;
      const from = startOfDay(now) - back * DAY;
      return { from, to: Math.min(now, from + DAY), label: m[1][0].toUpperCase() + m[1].slice(1) };
    },
  },
];

const STATUS_RULES: Array<{ re: RegExp; statuses: TabStatus[] }> = [
  { re: /\b(i closed|that i closed|closed tabs?|was closed|i shut)\b/, statuses: ['closed'] },
  { re: /\b(archived|in the archive)\b/, statuses: ['archived'] },
  { re: /\b(sleeping|asleep|snoozed)\b/, statuses: ['sleeping'] },
  { re: /\b(still open|currently open|open right now|open tabs?)\b/, statuses: ['open', 'sleeping'] },
];

export function parseQuery(raw: string, now = Date.now()): ParsedQuery {
  let q = ` ${raw.toLowerCase().replace(/[“”"']/g, ' ').replace(/\s+/g, ' ')} `;
  let timeRange: TimeRange | null = null;
  for (const rule of TIME_RULES) {
    const m = q.match(rule.re);
    if (m) {
      timeRange = rule.range(m, now);
      q = q.replace(m[0], ' ');
      break;
    }
  }
  let statuses: TabStatus[] | null = null;
  for (const rule of STATUS_RULES) {
    const m = q.match(rule.re);
    if (m) {
      statuses = rule.statuses;
      q = q.replace(m[0], ' ');
      break;
    }
  }
  let kind: KindHint | null = null;
  for (const k of KINDS) {
    k.triggers.lastIndex = 0;
    if (k.triggers.test(q)) {
      const { triggers, ...hint } = k;
      kind = hint;
      triggers.lastIndex = 0;
      q = q.replace(triggers, ' ');
      break;
    }
  }
  const terms = q
    .split(/[^\p{L}\p{N}+#.-]+/u)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length > 1 && !FILLER.has(t));
  return { raw, terms, timeRange, statuses, kind };
}

export function describeQuery(p: ParsedQuery): string[] {
  const chips: string[] = [];
  if (p.kind) chips.push(p.kind.label);
  if (p.timeRange) chips.push(p.timeRange.label);
  if (p.statuses) chips.push(p.statuses.join(' / '));
  return chips;
}
