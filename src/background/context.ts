// Worker-wide helpers: cached settings, own origin, status, safe Chrome API calls.

import { loadSettings, onSettingsChanged, type Settings } from '../shared/settings';
import type { WorkerStatus } from '../shared/messages';

let cachedSettings: Settings | null = null;
const settingsListeners: Array<(s: Settings, prev: Settings | null) => void> = [];

export async function getSettings(): Promise<Settings> {
  if (!cachedSettings) cachedSettings = await loadSettings();
  return cachedSettings;
}

export function watchSettings(cb: (s: Settings, prev: Settings | null) => void): void {
  settingsListeners.push(cb);
}

onSettingsChanged((s) => {
  const prev = cachedSettings;
  cachedSettings = s;
  for (const cb of settingsListeners) cb(s, prev);
});

export const OWN_ORIGIN = chrome.runtime.getURL('');
export const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');

export const status: Omit<WorkerStatus, 'db'> = {
  startedAt: Date.now(),
  lastReconcileAt: null,
  lastError: null,
};

export function noteError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  status.lastError = `${context}: ${msg}`;
  console.warn(`[TabOS] ${context}`, err);
}

/** chrome.tabs.get that returns null for tabs that no longer exist. */
export async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

export async function windowExists(windowId: number | null | undefined): Promise<boolean> {
  if (windowId == null || windowId < 0) return false;
  try {
    const w = await chrome.windows.get(windowId);
    return w.type === 'normal' && !w.incognito;
  } catch {
    return false;
  }
}

/** The window new tabs should go to: last focused normal window, or a fresh one. */
export async function targetWindowId(): Promise<number> {
  try {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (w.id != null && !w.incognito) return w.id;
  } catch {
    /* no windows */
  }
  const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const normal = all.find((w) => !w.incognito && w.id != null);
  if (normal?.id != null) return normal.id;
  const created = await chrome.windows.create({ focused: true });
  return created!.id!;
}

export async function liveTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => !t.incognito && t.id != null && t.id !== chrome.tabs.TAB_ID_NONE);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
