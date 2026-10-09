// URL helpers. Everything here is pure so it can be unit tested in Node.

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref_src',
  'ref_url',
  'spm',
  '_hsenc',
  '_hsmi',
  'yclid',
  'si',
]);

const UNTRACKED_URLS = new Set([
  '',
  'about:blank',
  'chrome://newtab/',
  'chrome://new-tab-page/',
  'chrome://new-tab-page-third-party/',
  'edge://newtab/',
  'brave://newtab/',
]);

const RESTORABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'chrome:', 'chrome-extension:', 'edge:', 'brave:', 'ftp:', 'about:']);

export function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Whether a tab with this URL should get a record. Blank/new-tab pages and our own pages are skipped. */
export function isTrackableUrl(url: string | undefined, ownOrigin?: string): boolean {
  if (!url || UNTRACKED_URLS.has(url)) return false;
  if (ownOrigin && url.startsWith(ownOrigin)) return false;
  const u = parseUrl(url);
  if (!u) return false;
  if (u.protocol === 'javascript:') return false;
  return true;
}

/** Pages Chrome can discard and reload safely. */
export function isDiscardableUrl(url: string): boolean {
  const u = parseUrl(url);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:');
}

/** URLs that chrome.tabs.create can reopen. javascript:, data: and blob: URLs are never reopened. */
export function isRestorableUrl(url: string): boolean {
  const u = parseUrl(url);
  return !!u && RESTORABLE_PROTOCOLS.has(u.protocol);
}

export function getDomain(url: string): string {
  const u = parseUrl(url);
  if (!u) return '';
  if (u.protocol === 'file:') return 'local file';
  if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'brave:') return u.protocol.replace(':', '');
  if (u.protocol === 'chrome-extension:') return 'extension';
  return u.hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * Canonical form used for duplicate detection: lower-cased host without www, no fragment
 * (unless it is a hash-route like #/ or #!), no trailing slash, tracking params removed, params sorted.
 */
export function normalizeUrl(url: string): string {
  const u = parseUrl(url);
  if (!u) return url.trim();
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.href;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params: Array<[string, string]> = [];
  u.searchParams.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) return;
    // YouTube timestamps don't make a different video.
    if ((host === 'youtube.com' || host === 'm.youtube.com') && k === 't') return;
    params.push([key, value]);
  });
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let path = u.pathname.replace(/\/+$/, '');
  if (path === '') path = '';
  const query = params.length ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  const hash = u.hash.startsWith('#/') || u.hash.startsWith('#!') ? u.hash : '';
  const port = u.port ? `:${u.port}` : '';
  return `${host}${port}${path}${query}${hash}`;
}

/** Strip protocol and www for compact display. */
export function displayUrl(url: string): string {
  const u = parseUrl(url);
  if (!u) return url;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  return `${u.hostname.replace(/^www\./, '')}${rest}`;
}

/** True when `domain` equals `rule` or is a subdomain of it. */
export function domainMatches(domain: string, rule: string): boolean {
  const d = domain.toLowerCase();
  const r = rule.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
  return d === r || d.endsWith('.' + r);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Exclusion pattern matching.
 *  - "example.com"          → that domain and subdomains
 *  - "*.example.com"        → same as above
 *  - "example.com/admin*"   → glob against host+path+query (protocol and www stripped)
 *  - "https://docs.*"       → glob against the full URL (when it contains "://")
 */
export function matchesPattern(url: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const u = parseUrl(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!p.includes('/') && !p.slice(2).includes('*')) return domainMatches(host, p);
  if (p.includes('://')) {
    const re = new RegExp('^' + p.split('*').map(escapeRegex).join('.*') + '$');
    return re.test(url.toLowerCase());
  }
  const target = `${host}${u.pathname}${u.search}`.toLowerCase();
  const re = new RegExp('^' + p.replace(/^www\./, '').split('*').map(escapeRegex).join('.*') + (p.includes('/') ? '' : '(/.*)?') + '$');
  return re.test(target) || re.test(target.replace(/\/$/, ''));
}

export function matchesAny(url: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(url, p));
}

/** Chrome's built-in favicon cache (needs the "favicon" permission). Works for archived tabs too. */
export function faviconFor(pageUrl: string, size = 32): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return '';
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}
