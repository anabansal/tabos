import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../shared/db';
import { loadSettings, onSettingsChanged, saveSettings, type Settings, type SettingsPatch } from '../shared/settings';
import type { TabRecord, Workspace } from '../shared/types';

export function useSettings(): [Settings | null, (patch: SettingsPatch) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => alive && setSettings(s));
    const off = onSettingsChanged((s) => setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const save = useCallback(async (patch: SettingsPatch) => {
    const next = await saveSettings(patch);
    setSettings(next);
  }, []);
  return [settings, save];
}

/** All tab records, live-updating as the service worker writes. */
export function useRecords(): TabRecord[] | undefined {
  return useLiveQuery(() => db.tabs.toArray(), []);
}

export function useWorkspaces(): Workspace[] | undefined {
  return useLiveQuery(() => db.workspaces.orderBy('order').toArray(), []);
}

export function useWorkspaceMap(workspaces: Workspace[] | undefined): Map<string, Workspace> {
  return useMemo(() => new Map((workspaces ?? []).map((w) => [w.id, w])), [workspaces]);
}

export interface Route {
  path: string[];
  params: URLSearchParams;
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { path: (p || '').split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(q ?? '') };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  location.hash = hash.startsWith('#') ? hash : `#${hash}`;
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Apply the theme setting to <html>. */
export function useTheme(settings: Settings | null): void {
  useEffect(() => {
    const theme = settings?.ui.theme ?? 'system';
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [settings?.ui.theme]);
}

/** Chrome windows, refreshed whenever windows change. */
export function useChromeWindows(): chrome.windows.Window[] {
  const [wins, setWins] = useState<chrome.windows.Window[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      chrome.windows
        .getAll({ windowTypes: ['normal'] })
        .then((w) => alive && setWins(w.filter((x) => !x.incognito)))
        .catch(() => undefined);
    void load();
    chrome.windows.onCreated.addListener(load);
    chrome.windows.onRemoved.addListener(load);
    chrome.windows.onFocusChanged.addListener(load);
    return () => {
      alive = false;
      chrome.windows.onCreated.removeListener(load);
      chrome.windows.onRemoved.removeListener(load);
      chrome.windows.onFocusChanged.removeListener(load);
    };
  }, []);
  return wins;
}

export function usePermission(perms: chrome.permissions.Permissions): [boolean | null, () => Promise<boolean>, () => Promise<void>] {
  const key = JSON.stringify(perms);
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => chrome.permissions.contains(perms).then((g) => alive && setGranted(g)).catch(() => alive && setGranted(false));
    void check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      alive = false;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const request = useCallback(async () => {
    const ok = await chrome.permissions.request(perms);
    setGranted(ok);
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const revoke = useCallback(async () => {
    await chrome.permissions.remove(perms);
    setGranted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [granted, request, revoke];
}
