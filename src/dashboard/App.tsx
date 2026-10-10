import { AlertTriangle, Archive, Clock, Layers, Plus, Search, Settings as SettingsIcon, Sparkles, Wand2, Inbox } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { rpc, type WorkerStatus } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { Banner, LoadingRows, WsDot } from '../ui/components';
import { useFeedback } from '../ui/feedback';
import { navigate, useChromeWindows, useHashRoute, useRecords, useSettings, useTheme, useWorkspaces } from '../ui/hooks';
import { DRAG_TYPE, useGroupActions } from '../ui/TabList';
import { DataProvider, isLive, type DashboardData } from './data';
import { RelatedDrawer } from './RelatedDrawer';
import { ArchiveView } from './views/ArchiveView';
import { GroupTabsView } from './views/GroupTabsView';
import { GroupView } from './views/GroupView';
import { HistoryView } from './views/HistoryView';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';
import { TabsHome } from './views/TabsHome';
import { TidyView } from './views/TidyView';

/** Old routes from earlier versions and links in notifications keep working. */
const ALIASES: Record<string, string> = {
  overview: '',
  tabs: '',
  welcome: '',
  windows: '',
  workspace: 'group',
  clean: 'tidy',
  duplicates: 'tidy',
  organize: 'group-tabs',
  recovery: 'history',
  activity: 'history',
};

export function App() {
  const route = useHashRoute();
  const records = useRecords();
  const workspaces = useWorkspaces();
  const [settings, saveSettings] = useSettings();
  const windows = useChromeWindows();
  const fb = useFeedback();
  const ga = useGroupActions();
  const [related, setRelated] = useState<TabRecord | null>(null);
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [query, setQuery] = useState('');
  const [dropOn, setDropOn] = useState<string | null>(null);
  useTheme(settings);

  useEffect(() => {
    rpc('system.status', {})
      .then(setStatus)
      .catch((e) => setStatus({ startedAt: 0, lastReconcileAt: null, lastError: String(e.message ?? e), db: { ok: false, error: 'TabOS background is not responding' } }));
  }, []);

  const raw = route.path[0] ?? '';
  const view = raw in ALIASES ? ALIASES[raw] : raw;
  const firstRun = raw === 'welcome';
  // Leaving a page clears the filter, so a stale query never hides tabs.
  useEffect(() => setQuery(view === 'search' ? (route.params.get('q') ?? '') : ''), [view, route.params]);
  useEffect(() => {
    if (raw === 'activity') navigate('/history?tab=undo');
    if (raw === 'windows') navigate('/?by=window');
  }, [raw]);

  const counts = useMemo(() => {
    const c = { live: 0, archived: 0, other: 0, byWs: new Map<string, number>() };
    for (const r of records ?? []) {
      if (r.status === 'archived') c.archived++;
      if (!isLive(r)) continue;
      c.live++;
      if (!r.workspaceId) c.other++;
      else c.byWs.set(r.workspaceId, (c.byWs.get(r.workspaceId) ?? 0) + 1);
    }
    return c;
  }, [records]);

  const wsMap = useMemo(() => new Map((workspaces ?? []).map((w) => [w.id, w])), [workspaces]);
  const data: DashboardData | null =
    records && workspaces && settings ? { records, workspaces, wsMap, settings, saveSettings, windows, query, openRelated: setRelated } : null;

  const dropProps = (groupId: string | null, name?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setDropOn(groupId ?? 'none');
    },
    onDragLeave: () => setDropOn(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]') as string[];
      if (ids.length) void ga.moveTo(ids, groupId, name);
    },
  });

  const newGroup = async () => {
    const name = await fb.prompt({ title: 'New group', placeholder: 'Name, e.g. Trip to Japan', confirmLabel: 'Create' });
    if (!name) return;
    try {
      const ws = await rpc('workspaces.create', { name });
      navigate(`/group/${ws.id}`);
    } catch (err) {
      fb.error(err);
    }
  };

  const groupId = view === 'group' ? route.path[1] : null;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icons/icon-48.png" alt="" />
          TabOS
        </div>
        <nav className="nav" aria-label="Main">
          <a href="#/" className={view === '' ? 'active' : ''}>
            <Layers /> Tabs <span className="count">{counts.live}</span>
          </a>
          <a href="#/archive" className={view === 'archive' ? 'active' : ''}>
            <Archive /> Archive {counts.archived > 0 && <span className="count">{counts.archived}</span>}
          </a>
          <a href="#/history" className={view === 'history' ? 'active' : ''}>
            <Clock /> History
          </a>
        </nav>
        <div>
          <div className="nav-head">
            <span className="section-title">Groups</span>
            <button className="btn ghost icon sm" aria-label="New group" title="New group" onClick={newGroup}>
              <Plus />
            </button>
          </div>
          <nav className="nav" aria-label="Groups">
            {(workspaces ?? []).map((w) => (
              <a key={w.id} href={`#/group/${w.id}`} className={`${groupId === w.id ? 'active' : ''} ${dropOn === w.id ? 'drop-target' : ''}`} {...dropProps(w.id, w.name)}>
                <WsDot color={w.color} />
                <span className="ellipsis">{w.name}</span>
                <span className="count">{counts.byWs.get(w.id) ?? 0}</span>
              </a>
            ))}
            <a href="#/?group=none" className={`${dropOn === 'none' ? 'drop-target' : ''}`} {...dropProps(null)}>
              <Inbox /> Other tabs <span className="count">{counts.other}</span>
            </a>
            {!workspaces?.length && (
              <span className="faint small" style={{ padding: '4px 10px' }}>
                Drag tabs here, or use Group Tabs.
              </span>
            )}
          </nav>
        </div>
        <nav className="nav">
          <a href="#/settings" className={view === 'settings' ? 'active' : ''}>
            <SettingsIcon /> Settings
          </a>
        </nav>
        <div className="sidebar-foot">
          <span className="kbd">Alt</span> <span className="kbd">Shift</span> <span className="kbd">K</span> opens TabOS anywhere
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <form
            className="search-field"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) navigate(`/search?q=${encodeURIComponent(query)}`);
            }}
          >
            <Search />
            <input
              className="input"
              placeholder="Search tabs. Press Enter to ask in your own words"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              aria-label="Search tabs"
            />
          </form>
          <div className="spacer" />
          <button className="btn" onClick={() => navigate('/group-tabs')}>
            <Wand2 /> Group Tabs
          </button>
          <button className="btn primary" onClick={() => navigate('/tidy')}>
            <Sparkles /> Tidy Up
          </button>
        </div>

        <div className="page">
          {status && !status.db.ok && (
            <Banner kind="error" icon={AlertTriangle}>
              <strong>TabOS can't save right now.</strong> {status.db.error}. Reload the extension from chrome://extensions; if it keeps happening, check free disk space.
            </Banner>
          )}
          {!data ? (
            <div className="card">
              <LoadingRows />
            </div>
          ) : (
            <DataProvider value={data}>
              {view === '' && <TabsHome firstRun={firstRun} by={route.params.get('by') === 'window' ? 'window' : 'group'} onlyOther={route.params.get('group') === 'none'} />}
              {view === 'group' && <GroupView id={route.path[1]} />}
              {view === 'archive' && <ArchiveView />}
              {view === 'history' && <HistoryView tab={route.params.get('tab') ?? 'closed'} />}
              {view === 'tidy' && <TidyView />}
              {view === 'group-tabs' && <GroupTabsView />}
              {view === 'search' && <SearchView query={route.params.get('q') ?? ''} />}
              {view === 'settings' && <SettingsView />}
              {related && <RelatedDrawer record={related} onClose={() => setRelated(null)} />}
            </DataProvider>
          )}
        </div>
      </main>
    </div>
  );
}
