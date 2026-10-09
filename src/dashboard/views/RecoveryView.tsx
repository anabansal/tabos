import { useLiveQuery } from 'dexie-react-hooks';
import { AppWindow, ArchiveRestore, Camera, ChevronDown, ChevronRight, Clock, History, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../shared/db';
import { rpc } from '../../shared/messages';
import type { Snapshot } from '../../shared/types';
import { displayUrl } from '../../shared/url';
import { Banner, EmptyState, Favicon, LoadingRows, Menu, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { ago, dateTime, dayLabel, plural } from '../../ui/format';
import { navigate, useDebounced, usePermission } from '../../ui/hooks';
import { TabTable } from '../../ui/TabTable';
import { ActivityView } from './ActivityView';
import { useData } from '../data';

const TABS = [
  { id: 'closed', label: 'Recently closed' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'activity', label: 'Undo history' },
  { id: 'chrome', label: 'Chrome history' },
];

export function RecoveryView({ tab }: { tab: string }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recovery</h1>
          <div className="sub">Bring back closed tabs and whole sessions, or undo anything TabOS did.</div>
        </div>
      </div>
      <div className="tabs-nav" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => navigate(`/recovery?tab=${t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'closed' && <ClosedTab />}
      {tab === 'snapshots' && <SnapshotsTab />}
      {tab === 'activity' && <ActivityView />}
      {tab === 'chrome' && (
        <>
          <ChromeSessionsTab />
          <HistoryTab />
        </>
      )}
    </>
  );
}

function ClosedTab() {
  const { records, workspaces, settings, openRelated } = useData();
  const fb = useFeedback();
  const closed = useMemo(() => records.filter((r) => r.status === 'closed').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)), [records]);
  const clear = async () => {
    if (await fb.confirm({ title: 'Clear recently closed history?', body: `Removes ${plural(closed.length, 'closed tab')} from TabOS. Archived tabs and snapshots are not affected. You can undo right after.`, confirmLabel: 'Clear', danger: true }))
      await fb.run(() => rpc('data.clearClosed', {}), (r) => `Cleared ${plural(r.count, 'tab')}`);
  };
  return (
    <>
      <div className="row muted">
        <span>
          Tabs you closed in Chrome, kept for {settings.history.closedRetentionDays ? plural(settings.history.closedRetentionDays, 'day') : 'ever'} (change in Settings). Tabs closed with their window reconnect automatically if Chrome restores them.
        </span>
        <div className="spacer" />
        {closed.length > 0 && (
          <button className="btn sm danger" onClick={clear}>
            <Trash2 /> Clear
          </button>
        )}
      </div>
      <div className="card">
        <TabTable records={closed} workspaces={workspaces} onRelated={openRelated} emptyTitle="Nothing closed recently" emptyBody="When you close tabs, they show up here so you can bring them back." />
      </div>
    </>
  );
}

function SnapshotsTab() {
  const snaps = useLiveQuery(() => db.snapshots.orderBy('createdAt').reverse().toArray(), []);
  const fb = useFeedback();
  const [name, setName] = useState('');
  const save = (scope: 'all' | 'window') =>
    fb.run(async () => {
      const s = await rpc('snapshots.create', { name: name.trim() || undefined, scope: scope === 'all' ? { kind: 'all' } : { kind: 'window' } });
      setName('');
      return { count: s.tabCount, skipped: [], activityId: null };
    }, (r) => `Saved ${plural(r.count, 'tab')}`);
  return (
    <>
      <div className="card card-pad row" style={{ flexWrap: 'wrap' }}>
        <Camera style={{ width: 16, height: 16, color: 'var(--text-2)' }} />
        <input className="input grow" style={{ minWidth: 200 }} placeholder="Snapshot name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Snapshot name" />
        <button className="btn" onClick={() => save('window')}>
          Save this window
        </button>
        <button className="btn primary" onClick={() => save('all')}>
          Save all windows
        </button>
      </div>
      {!snaps ? (
        <div className="card">
          <LoadingRows rows={4} />
        </div>
      ) : !snaps.length ? (
        <div className="card">
          <EmptyState icon={Camera} title="No snapshots yet">
            Snapshots capture every window, tab group and workspace so you can restore a whole session later. TabOS also saves automatic snapshots periodically (Settings → Snapshots).
          </EmptyState>
        </div>
      ) : (
        <div className="card panel-list">
          {snaps.map((s) => (
            <SnapshotRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </>
  );
}

function SnapshotRow({ s }: { s: Snapshot }) {
  const fb = useFeedback();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const restore = async (target: 'new-window' | 'current') => {
    if (s.tabCount > 15 && !(await fb.confirm({ title: `Restore ${plural(s.tabCount, 'tab')}?`, body: `Opens ${plural(s.windows.length, 'window')}. Tabs open asleep except the first when lazy restore is on.`, confirmLabel: 'Restore' }))) return;
    await fb.run(() => rpc('snapshots.restore', { id: s.id, target }), (r) => `Restored ${plural(r.count, 'tab')}`);
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="item" style={{ borderBottom: 0 }}>
        <button className="btn ghost icon sm" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </button>
        <div className="col grow" style={{ gap: 1 }}>
          {editing ? (
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (name.trim() && name !== s.name) void fb.run(() => rpc('snapshots.rename', { id: s.id, name }));
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Snapshot name"
            />
          ) : (
            <span className="ellipsis" style={{ fontWeight: 550 }}>
              {s.name}
            </span>
          )}
          <span className="faint" style={{ fontSize: 12 }}>
            {dateTime(s.createdAt)} · {plural(s.tabCount, 'tab')} · {plural(s.windows.length, 'window')}
            {s.workspaces.length > 0 && ` · ${s.workspaces.map((w) => w.name).slice(0, 3).join(', ')}`}
          </span>
        </div>
        <span className={`pill ${s.kind === 'auto' ? '' : 'accent'}`}>{s.kind === 'auto' ? 'Automatic' : s.kind === 'workspace' ? 'Workspace' : 'Saved'}</span>
        <button className="btn sm" onClick={() => restore('new-window')}>
          <ArchiveRestore /> Restore
        </button>
        <Menu
          trigger={(t) => (
            <button className="btn ghost icon sm" aria-label="Snapshot actions" onClick={t}>
              <Pencil />
            </button>
          )}
          items={[
            { label: 'Restore into current window', icon: AppWindow, onClick: () => restore('current') },
            { label: 'Rename', icon: Pencil, onClick: () => setEditing(true) },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => fb.run(() => rpc('snapshots.delete', { id: s.id }), () => 'Snapshot deleted') },
          ]}
        />
      </div>
      {open && (
        <div style={{ padding: '0 14px 12px 50px' }} className="col">
          {s.windows.map((w, i) => (
            <div key={i} className="col" style={{ gap: 4 }}>
              <span className="section-title">Window {i + 1}</span>
              {w.tabs.slice(0, 50).map((t, j) => {
                const g = w.groups.find((x) => x.key === t.groupKey);
                return (
                  <div key={j} className="row" style={{ fontSize: 12.5 }}>
                    <Favicon url={t.url} size={14} />
                    <span className="ellipsis grow">{t.title || displayUrl(t.url)}</span>
                    {g && (
                      <span className="pill">
                        <WsDot color={g.color} size={7} /> {g.title || 'Group'}
                      </span>
                    )}
                  </div>
                );
              })}
              {w.tabs.length > 50 && <span className="faint">+ {w.tabs.length - 50} more</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionGate({ perm, title, why, children }: { perm: chrome.runtime.ManifestPermission; title: string; why: string; children: React.ReactNode }) {
  const [granted, request] = usePermission({ permissions: [perm] });
  if (granted === null) return <LoadingRows rows={3} />;
  if (!granted)
    return (
      <div className="card">
        <EmptyState icon={KeyRound} title={title}>
          <p style={{ margin: '0 0 12px' }}>{why}</p>
          <button className="btn primary" onClick={() => void request()}>
            Allow access
          </button>
        </EmptyState>
      </div>
    );
  return <>{children}</>;
}

function ChromeSessionsTab() {
  return (
    <PermissionGate
      perm="sessions"
      title="See Chrome's recently closed tabs and windows"
      why="Chrome keeps its own list of recently closed tabs and windows, and restoring from it brings back each tab's back/forward history. TabOS only reads this list when this page is open; nothing leaves your device."
    >
      <ChromeSessions />
    </PermissionGate>
  );
}

function ChromeSessions() {
  const fb = useFeedback();
  const [items, setItems] = useState<chrome.sessions.Session[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => chrome.sessions.getRecentlyClosed({ maxResults: 25 }).then((s) => alive && setItems(s)).catch(() => alive && setItems([]));
    void load();
    chrome.sessions.onChanged.addListener(load);
    return () => {
      alive = false;
      chrome.sessions.onChanged.removeListener(load);
    };
  }, []);
  if (!items) return <LoadingRows rows={4} />;
  if (!items.length)
    return (
      <div className="card">
        <EmptyState icon={History} title="Chrome has no recently closed tabs" />
      </div>
    );
  const restore = (id?: string) => id && fb.run(() => rpc('sessions.restore', { sessionId: id }), () => 'Restored');
  return (
    <div className="card panel-list">
      {items.map((s, i) =>
        s.tab ? (
          <div className="item" key={i}>
            <Favicon url={s.tab.url ?? ''} />
            <div className="col grow" style={{ gap: 0 }}>
              <span className="ellipsis">{s.tab.title || s.tab.url}</span>
              <span className="faint ellipsis" style={{ fontSize: 12 }}>
                {displayUrl(s.tab.url ?? '')}
              </span>
            </div>
            <span className="faint nowrap">{ago(s.lastModified * 1000)}</span>
            <button className="btn sm" onClick={() => restore(s.tab!.sessionId)}>
              Restore
            </button>
          </div>
        ) : s.window ? (
          <div className="item" key={i}>
            <AppWindow style={{ width: 16, height: 16, color: 'var(--text-2)' }} />
            <div className="col grow" style={{ gap: 0 }}>
              <span>Window with {plural(s.window.tabs?.length ?? 0, 'tab')}</span>
              <span className="faint ellipsis" style={{ fontSize: 12 }}>
                {(s.window.tabs ?? []).slice(0, 4).map((t) => t.title).join(' · ')}
              </span>
            </div>
            <span className="faint nowrap">{ago(s.lastModified * 1000)}</span>
            <button className="btn sm" onClick={() => restore(s.window!.sessionId)}>
              Restore window
            </button>
          </div>
        ) : null,
      )}
    </div>
  );
}

function HistoryTab() {
  return (
    <PermissionGate
      perm="history"
      title="Search your browsing history"
      why="Lets TabOS search Chrome history here and in Search (optional). History is read on demand, stays on this device and is never stored by TabOS."
    >
      <HistorySearch />
    </PermissionGate>
  );
}

function HistorySearch() {
  const [text, setText] = useState('');
  const q = useDebounced(text, 200);
  const [items, setItems] = useState<chrome.history.HistoryItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    chrome.history
      .search({ text: q, maxResults: 100, startTime: Date.now() - 90 * 86_400_000 })
      .then((h) => alive && setItems(h))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [q]);
  const grouped = useMemo(() => {
    const m = new Map<string, chrome.history.HistoryItem[]>();
    for (const h of items ?? []) {
      const k = dayLabel(h.lastVisitTime ?? 0);
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()];
  }, [items]);
  return (
    <>
      <div className="search-field" style={{ maxWidth: 420 }}>
        <Clock />
        <input className="input" placeholder="Search the last 90 days" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search history" />
      </div>
      {!items ? (
        <LoadingRows />
      ) : !items.length ? (
        <div className="card">
          <EmptyState icon={History} title="No history matches" />
        </div>
      ) : (
        grouped.map(([day, list]) => (
          <section key={day} className="col" style={{ gap: 6 }}>
            <h3 className="muted">{day}</h3>
            <div className="card panel-list">
              {list.map((h) => (
                <div className="item" key={h.id}>
                  <Favicon url={h.url ?? ''} />
                  <div className="col grow" style={{ gap: 0 }}>
                    <a href={h.url} target="_blank" rel="noreferrer" className="ellipsis">
                      {h.title || h.url}
                    </a>
                    <span className="faint ellipsis" style={{ fontSize: 12 }}>
                      {displayUrl(h.url ?? '')}
                    </span>
                  </div>
                  <span className="faint nowrap">{ago(h.lastVisitTime)}</span>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
      <Banner kind="info" icon={KeyRound}>
        You can remove this permission any time in Settings → Permissions.
      </Banner>
    </>
  );
}
