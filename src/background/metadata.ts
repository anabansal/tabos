// Optional, opt-in collection of <meta> description/keywords to improve related-tab discovery and
// semantic search. Never reads page body text, never runs on AI chat apps, mail, banking or
// excluded sites, and the results stay in the local database.

import { db } from '../shared/db';
import type { PageMeta, TabRecord } from '../shared/types';
import { domainMatches, getDomain, matchesAny, normalizeUrl } from '../shared/url';
import { getSettings } from './context';

/** Sites TabOS never injects into, even with permission: private conversations, mail, finance, auth. */
export const NEVER_READ_DOMAINS = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'bard.google.com',
  'aistudio.google.com',
  'copilot.microsoft.com',
  'perplexity.ai',
  'poe.com',
  'character.ai',
  'chat.deepseek.com',
  'chat.mistral.ai',
  'grok.com',
  'meta.ai',
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'web.whatsapp.com',
  'messenger.com',
  'accounts.google.com',
  'login.microsoftonline.com',
  'paypal.com',
];

export const META_PERMISSIONS: chrome.permissions.Permissions = {
  permissions: ['scripting'],
  origins: ['http://*/*', 'https://*/*'],
};

export async function metaPermissionGranted(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(META_PERMISSIONS);
  } catch {
    return false;
  }
}

const REFRESH_MS = 7 * 86_400_000;
const inFlight = new Set<number>();

function extractMeta(): { href: string; description: string; keywords: string; siteName: string } {
  const pick = (sel: string) => (document.querySelector(sel)?.getAttribute('content') ?? '').trim();
  return {
    href: location.href,
    description: (pick('meta[name="description"]') || pick('meta[property="og:description"]') || pick('meta[name="twitter:description"]')).slice(0, 400),
    keywords: pick('meta[name="keywords"]').slice(0, 200),
    siteName: pick('meta[property="og:site_name"]').slice(0, 80),
  };
}

export function metaAllowed(url: string, exclusions: string[]): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  const domain = getDomain(url);
  if (NEVER_READ_DOMAINS.some((d) => domainMatches(domain, d))) return false;
  if (/(^|\.)(bank|banking)[a-z0-9-]*\./.test(domain)) return false;
  return !matchesAny(url, exclusions);
}

export async function maybeCollectMeta(rec: TabRecord, tab: chrome.tabs.Tab, force = false): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.privacy.collectPageMeta || tab.id == null || tab.discarded) return false;
  if (!force && rec.meta && Date.now() - rec.meta.collectedAt < REFRESH_MS) return false;
  if (!metaAllowed(rec.url, settings.exclusions) || inFlight.has(tab.id)) return false;
  if (!chrome.scripting || !(await metaPermissionGranted())) return false;
  inFlight.add(tab.id);
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractMeta });
    const out = res?.result;
    if (!out) return false;
    const current = await db.tabs.get(rec.id);
    if (!current || normalizeUrl(current.url) !== normalizeUrl(out.href)) return false;
    const meta: PageMeta = {
      description: out.description || undefined,
      keywords: out.keywords || undefined,
      siteName: out.siteName || undefined,
      collectedAt: Date.now(),
    };
    await db.tabs.update(rec.id, { meta });
    return true;
  } catch {
    return false; // restricted page, tab navigated, etc.
  } finally {
    inFlight.delete(tab.id);
  }
}
