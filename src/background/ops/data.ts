import { db } from '../../shared/db';
import type { ExportBundle } from '../../shared/messages';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, sanitizeSettings, saveSettings } from '../../shared/settings';
import type { Snapshot, TabRecord, Workspace } from '../../shared/types';
import { getDomain, normalizeUrl } from '../../shared/url';
import { type Outcome } from '../activity';

export async function exportData(): Promise<ExportBundle> {
  const [settings, tabs, workspaces, snapshots] = await Promise.all([
    loadSettings(),
    db.tabs.toArray(),
    db.workspaces.toArray(),
    db.snapshots.toArray(),
  ]);
  // API keys never leave the device in exports.
  const safeSettings = {
    ...settings,
    ai: { ...settings.ai, openai: { ...settings.ai.openai, apiKey: '' }, anthropic: { ...settings.ai.anthropic, apiKey: '' } },
  };
  return { format: 'tabos-export', version: 1, exportedAt: Date.now(), settings: safeSettings, tabs, workspaces, snapshots };
}

function validRecord(r: unknown): r is TabRecord {
  const x = r as TabRecord;
  return !!x && typeof x.id === 'string' && typeof x.url === 'string' && typeof x.title === 'string';
}

/**
 * Merge an export into this profile. Imported tabs that were open elsewhere become archived
 * records here (their tabs don't exist in this browser). Existing data is never overwritten.
 */
export async function importData(bundle: ExportBundle): Promise<Outcome> {
  if (!bundle || bundle.format !== 'tabos-export') throw new Error('Not a TabOS export file');
  const now = Date.now();
  const existingTabs = new Set(await db.tabs.toCollection().primaryKeys());
  const existingWs = await db.workspaces.toArray();
  const wsIdMap = new Map<string, string>();
  const newWorkspaces: Workspace[] = [];
  for (const w of bundle.workspaces ?? []) {
    if (!w?.id || !w.name) continue;
    const same = existingWs.find((e) => e.id === w.id || e.name.toLowerCase() === w.name.toLowerCase());
    if (same) wsIdMap.set(w.id, same.id);
    else {
      wsIdMap.set(w.id, w.id);
      newWorkspaces.push({ ...w, order: existingWs.length + newWorkspaces.length });
    }
  }
  const newTabs: TabRecord[] = [];
  for (const r of bundle.tabs ?? []) {
    if (!validRecord(r) || existingTabs.has(r.id)) continue;
    const wasLive = r.status === 'open' || r.status === 'sleeping';
    newTabs.push({
      ...r,
      chromeTabId: null,
      active: false,
      groupId: -1,
      windowId: null,
      normalizedUrl: normalizeUrl(r.url),
      domain: getDomain(r.url),
      workspaceId: r.workspaceId ? (wsIdMap.get(r.workspaceId) ?? null) : null,
      status: wasLive ? 'archived' : r.status,
      archivedAt: wasLive ? now : r.archivedAt,
      archiveReason: wasLive ? 'import' : r.archiveReason,
      restoreHint: r.restoreHint ? { ...r.restoreHint, windowId: undefined } : null,
    });
  }
  const existingSnaps = new Set(await db.snapshots.toCollection().primaryKeys());
  const newSnaps: Snapshot[] = (bundle.snapshots ?? []).filter((s) => s?.id && !existingSnaps.has(s.id) && Array.isArray(s.windows));
  await db.transaction('rw', db.tabs, db.workspaces, db.snapshots, async () => {
    await db.workspaces.bulkAdd(newWorkspaces);
    await db.tabs.bulkAdd(newTabs);
    await db.snapshots.bulkAdd(newSnaps);
  });
  if (bundle.settings) {
    const current = await loadSettings();
    const incoming = sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, bundle.settings));
    // Keep this device's API keys and consent; take the rest.
    await saveSettings({ ...incoming, ai: { ...incoming.ai, externalConsent: current.ai.externalConsent, openai: { ...incoming.ai.openai, apiKey: current.ai.openai.apiKey }, anthropic: { ...incoming.ai.anthropic, apiKey: current.ai.anthropic.apiKey } } });
  }
  return { count: newTabs.length + newWorkspaces.length + newSnaps.length, skipped: [], undo: null };
}

export async function clearClosedHistory(): Promise<Outcome> {
  const closed = await db.tabs.where('status').equals('closed').toArray();
  await db.tabs.bulkDelete(closed.map((r) => r.id));
  return { count: closed.length, skipped: [], undo: closed.length ? { type: 'records-restore', records: closed } : null };
}
