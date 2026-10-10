import { AlertTriangle, Archive, Clock, Inbox, Keyboard, Layers, Plus, Search, Settings as SettingsIcon, Sparkles, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, type WorkerStatus } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { Banner, LoadingRows, WsDot } from '../ui/components';
import { useFeedback } from '../ui/feedback';
import { navigate, useChromeWindows, useHashRoute, useRecords, useSettings, useTheme, useWorkspaces } from '../ui/hooks';
import { DRAG_TYPE, useGroupActions } from '../ui/TabList';
import { DataProvider, isLive, type DashboardData } from './data';
import { RelatedDrawer } from './RelatedDrawer';
import { SearchPanel } from './SearchPanel';
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

const TITLES: Record<string, string> = {
  '': 'Tabs',
  archive: 'Archive',
  history: 'History',
  'group-tabs': 'Group Tabs',
  tidy: 'Tidy Up',
  search: 'Search',
  settings: 'Settings',
};

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  useEffect(() => {
    if (raw === 'activity') navigate('/history?tab=undo');
    if (raw === 'windows') navigate('/?by=window');
  }, [raw]);

  // Keyboard: Ctrl/⌘ K or "/" opens search; "?" shows shortcuts.
  const onKey = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setSearchOpen((o) => !o);
    } else if (!typing && e.key === '/') {
      e.preventDefault();
      setSearchOpen(true);
    } else if (!typing && e.key === '?') {
      e.preventDefault();
      setShortcutsOpen(true);
    }
  }, []);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

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
    records && workspaces && settings ? { records, workspaces, wsMap, settings, saveSettings, windows, query: '', openRelated: setRelated } : null;

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
  const currentGroup = groupId ? wsMap.get(groupId) : undefined;
  const onlyOther = view === '' && route.params.get('group') === 'none';
  const title = currentGroup?.name ?? (onlyOther ? 'Other Tabs' : (TITLES[view] ?? 'TabOS'));
  useEffect(() => {
    document.title = `${title} · TabOS`;
  }, [title]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icons/icon-48.png" alt="" />
          TabOS
        </div>
        <nav className="nav" aria-label="Main">
          <a href="#/" className={view === '' && !onlyOther ? 'active' : ''}>
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
            <span className="label">Groups</span>
            <button className="btn quiet icon sm" aria-label="New group" title="New group" onClick={newGroup}>
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
            <a href="#/?group=none" className={`${onlyOther ? 'active' : ''} ${dropOn === 'none' ? 'drop-target' : ''}`} {...dropProps(null)}>
              <Inbox /> Other Tabs <span className="count">{counts.other}</span>
            </a>
          </nav>
          {!workspaces?.length && <div className="nav-hint">Use Group Tabs, or drag tabs onto “+”.</div>}
        </div>
        <nav className="nav">
          <a href="#/settings" className={view === 'settings' ? 'active' : ''}>
            <SettingsIcon /> Settings
          </a>
        </nav>
        <div className="sidebar-foot">
          <button onClick={() => setShortcutsOpen(true)}>
            <Keyboard style={{ width: 13, height: 13 }} /> Keyboard shortcuts
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          {currentGroup && <WsDot color={currentGroup.color} />}
          <h1>{title}</h1>
          <div className="spacer" />
          <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search tabs">
            <Search />
            <span>Search</span>
            <span className="kbds">
              <span className="kbd">{MOD}</span>
              <span className="kbd">K</span>
            </span>
          </button>
          {view !== 'group-tabs' && (
            <button className="btn actions-hide-sm" onClick={() => navigate('/group-tabs')}>
              <Wand2 /> Group Tabs
            </button>
          )}
          {view !== 'tidy' && (
            <button className="btn primary" onClick={() => navigate('/tidy')}>
              <Sparkles /> Tidy Up
            </button>
          )}
        </header>

        <div className="content">
          <div className="page">
            {status && !status.db.ok && (
              <Banner kind="error" icon={AlertTriangle}>
                <span>
                  <strong>TabOS can’t save right now.</strong> {status.db.error}. Reload the extension from chrome://extensions; if it keeps happening, check free disk space.
                </span>
              </Banner>
            )}
            {!data ? (
              <div className="list-card">
                <LoadingRows />
              </div>
            ) : (
              <DataProvider value={data}>
                {view === '' && <TabsHome firstRun={firstRun} by={route.params.get('by') === 'window' ? 'window' : 'group'} onlyOther={onlyOther} />}
                {view === 'group' && <GroupView id={route.path[1]} />}
                {view === 'archive' && <ArchiveView />}
                {view === 'history' && <HistoryView tab={route.params.get('tab') ?? 'closed'} />}
                {view === 'tidy' && <TidyView />}
                {view === 'group-tabs' && <GroupTabsView />}
                {view === 'search' && <SearchView query={route.params.get('q') ?? ''} />}
                {view === 'settings' && <SettingsView />}
                {related && <RelatedDrawer record={related} onClose={() => setRelated(null)} />}
                {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} />}
              </DataProvider>
            )}
          </div>
        </div>
      </main>
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const rows: Array<[string[], string]> = [
    [[MOD, 'K'], 'Search'],
    [['/'], 'Search'],
    [['Tab'], 'Ask in your own words (in search)'],
    [['↑', '↓', '↵'], 'Move through results and open'],
    [['Esc'], 'Close'],
    [['Alt', 'Shift', 'K'], 'Open the TabOS popup from any page'],
    [['Alt', 'Shift', 'D'], 'Open this window from any page'],
    [['?'], 'Show these shortcuts'],
  ];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="kb-title" style={{ width: 'min(420px, 100%)' }}>
        <div className="dialog-head">
          <h2 id="kb-title">Keyboard shortcuts</h2>
        </div>
        <div className="dialog-body">
          {rows.map(([keys, label]) => (
            <div key={label + keys.join()} className="row" style={{ height: 32 }}>
              <span className="grow" style={{ color: 'var(--text)' }}>
                {label}
              </span>
              {keys.map((k) => (
                <span key={k} className="kbd">
                  {k}
                </span>
              ))}
            </div>
          ))}
          <div className="small faint" style={{ marginTop: 8 }}>
            Change the browser-wide shortcuts at chrome://extensions/shortcuts.
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
