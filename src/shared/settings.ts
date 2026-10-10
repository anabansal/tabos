// User settings live in chrome.storage.local so every extension context can read them
// and react to changes via chrome.storage.onChanged.

export type EmbeddingProviderId = 'local' | 'ollama' | 'openai';
export type LanguageProviderId = 'local' | 'ollama' | 'openai' | 'anthropic';

export interface AISettings {
  embeddingProvider: EmbeddingProviderId;
  languageProvider: LanguageProviderId;
  /** Explicit consent to send tab titles and URLs to a configured provider. Required for every non-built-in provider. */
  externalConsent: boolean;
  ollama: { baseUrl: string; embedModel: string; chatModel: string };
  openai: { baseUrl: string; apiKey: string; embedModel: string; chatModel: string };
  anthropic: { apiKey: string; model: string };
  minGroupSize: number;
}

export interface Settings {
  version: 1;
  sleep: {
    enabled: boolean;
    afterMinutes: number;
    protectPinned: boolean;
  };
  archive: {
    /** 'auto' archives inactive tabs on a schedule and posts an undoable notification. */
    mode: 'off' | 'auto';
    afterDays: number;
    maxPerRun: number;
    /** Inactivity at which the Clean panel starts suggesting a tab for archival. */
    suggestAfterDays: number;
  };
  /** Domains whose tabs are never slept or archived automatically (subdomains included). */
  protectedDomains: string[];
  /** URL patterns ignored by automation, AI organization and AI providers. */
  exclusions: string[];
  workspaces: {
    /** New tabs join the workspace of the tab they were opened from (or the focused tab). */
    autoAssignNewTabs: boolean;
    /** Keep Chrome tab groups and workspaces in sync (titled groups become workspaces). */
    syncTabGroups: boolean;
    /** Sort new tabs into matching workspaces (and create topic workspaces) without asking. */
    autoOrganize: boolean;
    collapseOthersOnSwitch: boolean;
    sleepOthersOnSwitch: boolean;
  };
  restore: {
    /** Open restored tabs as sleeping (except the first) so big restores don't spike memory. */
    lazy: boolean;
  };
  snapshots: {
    autoEnabled: boolean;
    intervalMinutes: number;
    keep: number;
  };
  history: {
    /** How long to keep metadata of tabs the user closed. 0 = forever. Archived tabs are never pruned. */
    closedRetentionDays: number;
  };
  ui: {
    badge: 'open' | 'none';
    theme: 'system' | 'light' | 'dark';
  };
  privacy: {
    /** Read <meta> description/keywords of loaded pages (needs optional permissions). */
    collectPageMeta: boolean;
  };
  ai: AISettings;
}

export const DEFAULT_PROTECTED_DOMAINS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'mail.google.com',
  'calendar.google.com',
  'outlook.office.com',
  'outlook.live.com',
  'web.whatsapp.com',
  'app.slack.com',
  'discord.com',
  'music.youtube.com',
  'open.spotify.com',
];

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  sleep: { enabled: true, afterMinutes: 45, protectPinned: true },
  archive: { mode: 'off', afterDays: 7, maxPerRun: 25, suggestAfterDays: 3 },
  protectedDomains: DEFAULT_PROTECTED_DOMAINS,
  exclusions: [],
  workspaces: {
    autoAssignNewTabs: true,
    syncTabGroups: true,
    autoOrganize: false,
    collapseOthersOnSwitch: true,
    sleepOthersOnSwitch: false,
  },
  restore: { lazy: true },
  snapshots: { autoEnabled: true, intervalMinutes: 30, keep: 12 },
  history: { closedRetentionDays: 60 },
  ui: { badge: 'open', theme: 'system' },
  privacy: { collectPageMeta: false },
  ai: {
    embeddingProvider: 'local',
    languageProvider: 'local',
    externalConsent: false,
    ollama: { baseUrl: 'http://localhost:11434', embedModel: 'nomic-embed-text', chatModel: 'llama3.2' },
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', embedModel: 'text-embedding-3-small', chatModel: 'gpt-4o-mini' },
    anthropic: { apiKey: '', model: 'claude-opus-5-5' },
    minGroupSize: 2,
  },
};

const STORAGE_KEY = 'settings';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends Array<infer U> ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge `patch` into `base`, ignoring keys that don't exist in base (drops stale settings after updates). */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, baseVal] of Object.entries(base)) {
    if (!(key in patch)) continue;
    const pv = patch[key];
    if (isPlainObject(baseVal)) out[key] = mergeSettings(baseVal, pv);
    else if (Array.isArray(baseVal)) out[key] = Array.isArray(pv) ? pv.filter((x) => typeof x === 'string') : baseVal;
    else if (typeof pv === typeof baseVal) out[key] = pv;
  }
  return out as T;
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

export function sanitizeSettings(s: Settings): Settings {
  const cleanList = (list: string[]) =>
    Array.from(new Set(list.map((x) => x.trim().toLowerCase()).filter(Boolean))).slice(0, 500);
  return {
    ...s,
    version: 1,
    sleep: { ...s.sleep, afterMinutes: clamp(Math.round(s.sleep.afterMinutes), 1, 60 * 24 * 7) },
    archive: {
      ...s.archive,
      afterDays: clamp(s.archive.afterDays, 1, 365),
      maxPerRun: clamp(Math.round(s.archive.maxPerRun), 1, 500),
      suggestAfterDays: clamp(s.archive.suggestAfterDays, 0.25, 365),
    },
    protectedDomains: cleanList(s.protectedDomains),
    exclusions: cleanList(s.exclusions),
    snapshots: {
      ...s.snapshots,
      intervalMinutes: clamp(Math.round(s.snapshots.intervalMinutes), 5, 24 * 60),
      keep: clamp(Math.round(s.snapshots.keep), 1, 100),
    },
    history: { closedRetentionDays: clamp(Math.round(s.history.closedRetentionDays), 0, 3650) },
    ai: {
      ...s.ai,
      minGroupSize: clamp(Math.round(s.ai.minGroupSize), 2, 10),
      ollama: { ...s.ai.ollama, baseUrl: s.ai.ollama.baseUrl.trim().replace(/\/+$/, '') },
      openai: { ...s.ai.openai, baseUrl: s.ai.openai.baseUrl.trim().replace(/\/+$/, ''), apiKey: s.ai.openai.apiKey.trim() },
      anthropic: { ...s.ai.anthropic, apiKey: s.ai.anthropic.apiKey.trim() },
    },
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, stored[STORAGE_KEY]));
  } catch (err) {
    console.warn('[TabOS] settings unavailable, using defaults', err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const current = await loadSettings();
  const next = sanitizeSettings(mergeSettings(current, patch));
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      cb(sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, changes[STORAGE_KEY].newValue)));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** True when the configured providers would send data off the device (Ollama on localhost counts as local). */
export function usesExternalProvider(ai: AISettings): boolean {
  const remote = (id: string) => {
    if (id === 'local') return false;
    if (id === 'ollama') return !isLoopback(ai.ollama.baseUrl);
    return true;
  };
  return remote(ai.embeddingProvider) || remote(ai.languageProvider);
}

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}
