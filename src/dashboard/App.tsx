import { AppWindow, History, Inbox, LayoutGrid, Layers, Plus, Search, Settings as SettingsIcon, Wand2, Brush, AlertTriangle, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { findDuplicateGroups } from '../core/duplicates';
import { rpc, type WorkerStatus } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { Banner, LoadingRows, WsDot } from '../ui/components';
import { useFeedback } from '../ui/feedback';
import { navigate, useChromeWindows, useHashRoute, useRecords, useSettings, useTheme, useWorkspaces } from '../ui/hooks';
import { DataProvider, isLive, type DashboardData } from './data';
import { RelatedDrawer } from './RelatedDrawer';
import { CleanView } from './views/CleanView';
import { DuplicatesView } from './views/DuplicatesView';
import { OrganizeView } from './views/OrganizeView';
import { Overview } from './views/Overview';
import { RecoveryView } from './views/RecoveryView';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';
import { TabsView } from './views/TabsView';
import { WindowsView } from './views/WindowsView';
import { WorkspaceView } from './views/WorkspaceView';

export function App() {
  const route = useHashRoute();
  const records = useRecords();
  const workspaces = useWorkspaces();
  const [settings, saveSettings] = useSettings();
  const windows = useChromeWindows();
  const fb = useFeedback();
  const [related, setRelated] = useState<TabRecord | null>(null);
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [newWs, setNewWs] = useState<string | null>(null);
  useTheme(settings);

  useEffect(() => {
    rpc('system.status', {}).then(setStatus).catch((e) => setStatus({ startedAt: 0, lastReconcileAt: null, lastError: String(e.message ?? e), db: { ok: false, error: 'Background unavailable' } }));
  }, []);

  const wsMap = useMemo(() => new Map((workspaces ?? []).map((w) => [w.id, w])), [workspaces]);
  const counts = useMemo(() => {
    const c = { live: 0, open: 0, sleeping: 0, archived: 0, closed: 0, unassigned: 0, dups: 0, byWs: new Map<string, number>() };
    for (const r of records ?? []) {
      c[r.status]++;
      if (isLive(r)) {
        c.live++;
        if (!r.workspaceId) c.unassigned++;
        else c.byWs.set(r.workspaceId, (c.byWs.get(r.workspaceId) ?? 0) + 1);
      }
    }
    c.dups = findDuplicateGroups(records ?? []).reduce((n, g) => n + g.recordIds.length - 1, 0);
    return c;
  }, [records]);

  const ready = records && workspaces && settings;
  const data: DashboardData | null = ready
    ? { records, workspaces, wsMap, settings, saveSettings, windows, openRelated: setRelated, openClean: () => navigate('/clean') }
    : null;

  const view = route.path[0] ?? '';
  const isActive = (p: string, param: [string, string]) => view === p && route.params.get(param[0]) === param[1];

  const createWs = async (e: FormEvent) => {
    e.preventDefault();
    const name = newWs?.trim();
    if (!name) return setNewWs(null);
    try {
      const ws = await rpc('workspaces.create', { name });
      setNewWs(null);
      navigate(`/workspace/${ws.id}`);
    } catch (err) {
      fb.error(err);
    }
  };

  const [q, setQ] = useState('');
  useEffect(() => {
    setQ(view === 'search' ? (route.params.get('q') ?? '') : '');
  }, [view, route.params]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icons/icon-48.png" alt="" />
          TabOS
        </div>
        <nav className="nav" aria-label="Main">
          <a href="#/" className={view === '' || view === 'welcome' ? 'active' : ''}>
            <LayoutGrid /> Home
          </a>
          <a href="#/tabs" className={view === 'tabs' && !route.params.get('ws') ? 'active' : ''}>
            <Layers /> Tabs <span className="count">{counts.live}</span>
          </a>
          <a href="#/windows" className={view === 'windows' ? 'active' : ''}>
            <AppWindow /> Windows <span className="count">{windows.length}</span>
          </a>
          <a href="#/recovery" className={view === 'recovery' ? 'active' : ''}>
            <History /> Recovery
          </a>
          <a href="#/settings" className={view === 'settings' ? 'active' : ''}>
            <SettingsIcon /> Settings
          </a>
        </nav>
        <div>
          <div className="nav-head">
            <span className="section-title">Workspaces</span>
            <button className="btn ghost icon sm" aria-label="New workspace" title="New workspace" onClick={() => setNewWs('')}>
              <Plus />
            </button>
          </div>
          <nav className="nav" aria-label="Workspaces">
            {newWs !== null && (
              <form onSubmit={createWs} style={{ padding: '2px 0 4px' }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="Workspace name"
                  value={newWs}
                  onChange={(e) => setNewWs(e.target.value)}
                  onBlur={() => !newWs?.trim() && setNewWs(null)}
                  onKeyDown={(e) => e.key === 'Escape' && setNewWs(null)}
                  style={{ width: '100%' }}
                />
              </form>
            )}
            {(workspaces ?? []).map((w) => (
              <a key={w.id} href={`#/workspace/${w.id}`} className={view === 'workspace' && route.path[1] === w.id ? 'active' : ''}>
                <WsDot color={w.color} />
                <span className="ellipsis">{w.name}</span>
                <span className="count">{counts.byWs.get(w.id) ?? 0}</span>
              </a>
            ))}
            <a href="#/tabs?ws=none" className={isActive('tabs', ['ws', 'none']) ? 'active' : ''}>
              <Inbox /> Unassigned <span className="count">{counts.unassigned}</span>
            </a>
          </nav>
        </div>
        <div className="sidebar-foot">
          <span>
            <span className="kbd">Alt</span> <span className="kbd">Shift</span> <span className="kbd">K</span> popup
          </span>
          <span>
            Type <span className="kbd">tab</span> + <span className="kbd">Space</span> in the address bar
          </span>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          {view !== 'search' && (<form
            className="search-field"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/search?q=${encodeURIComponent(q)}`);
            }}
          >
            <Search />
            <input className="input" placeholder="Search tabs, e.g. “paper about semantic entropy last week”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </form>)}
          <div className="spacer" />
          <button className="btn" onClick={() => navigate('/organize')}>
            <Wand2 /> Organize
          </button>
          <button className="btn primary" onClick={() => navigate('/clean')}>
            <Brush /> Clean
          </button>
        </div>

        <div className="page">
          {status && !status.db.ok && (
            <Banner kind="error" icon={AlertTriangle}>
              <strong>Storage problem:</strong> {status.db.error}. TabOS can't save changes until this is fixed. Try reloading the extension; if it persists, check that Chrome has disk space.
            </Banner>
          )}
          {view === 'welcome' && <Welcome />}
          {!data ? (
            <div className="card">
              <LoadingRows />
            </div>
          ) : (
            <DataProvider value={data}>
              {(view === '' || view === 'welcome') && <Overview />}
              {view === 'tabs' && <TabsView params={route.params} />}
              {view === 'workspace' && <WorkspaceView id={route.path[1]} />}
              {view === 'windows' && <WindowsView />}
              {view === 'duplicates' && <DuplicatesView />}
              {view === 'recovery' && <RecoveryView tab={route.params.get('tab') ?? 'closed'} />}
              {view === 'search' && <SearchView query={route.params.get('q') ?? ''} />}
              {view === 'organize' && <OrganizeView />}
              {view === 'clean' && <CleanView />}
              {view === 'activity' && <RecoveryView tab="activity" />}
              {view === 'settings' && <SettingsView />}
              {related && <RelatedDrawer record={related} onClose={() => setRelated(null)} />}
            </DataProvider>
          )}
        </div>
      </main>
    </div>
  );
}

function Welcome() {
  return (
    <Banner kind="info" icon={Info}>
      <strong>Welcome to TabOS.</strong> It already sees every tab in every window, and tabs you haven't used for 45 minutes go to sleep to save memory. Nothing is closed without asking you, and everything stays on this device. Start with <a href="#/organize">Organize</a> to sort your tabs into workspaces.
    </Banner>
  );
}
