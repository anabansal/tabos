import { useLiveQuery } from 'dexie-react-hooks';
import {
  AppWindow,
  Archive,
  ArchiveRestore,
  Camera,
  CircleDot,
  Copy,
  Group,
  MemoryStick,
  Moon,
  MoreHorizontal,
  Shield,
  Trash2,
  Undo2,
  ArrowRight,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../shared/db';
import { rpc } from '../../shared/messages';
import type { CleanPreview, Workspace } from '../../shared/types';
import { EmptyState, Favicon, Menu, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { ago, bytes, plural } from '../../ui/format';
import { navigate, useNow } from '../../ui/hooks';
import { isLive, useData } from '../data';

export function Overview() {
  const { records, workspaces, windows, openClean } = useData();
  const now = useNow();
  const stats = useMemo(() => {
    const s = { open: 0, sleeping: 0, archived: 0, closed: 0, dups: 0 };
    for (const r of records) s[r.status]++;
    return s;
  }, [records]);
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  useEffect(() => {
    rpc('clean.preview', {}).then(setPreview).catch(() => setPreview(null));
  }, [records.length]);
  const dupExtras = preview?.duplicates.reduce((n, g) => n + g.recordIds.length - 1, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <div className="sub">
            {plural(stats.open + stats.sleeping, 'tab')} across {plural(windows.length, 'window')} · {plural(workspaces.length, 'workspace')}
          </div>
        </div>
      </div>

      <nav className="status-strip" aria-label="Tab states">
        <a href="#/tabs?status=open">
          <CircleDot style={{ color: 'var(--st-open)' }} /> <strong>{stats.open}</strong> awake
        </a>
        <a href="#/tabs?status=sleeping">
          <Moon style={{ color: 'var(--st-sleeping)' }} /> <strong>{stats.sleeping}</strong> sleeping
        </a>
        <a href="#/tabs?status=archived">
          <Archive style={{ color: 'var(--st-archived)' }} /> <strong>{stats.archived}</strong> archived
        </a>
        <a href="#/duplicates">
          <Copy /> <strong>{dupExtras}</strong> {dupExtras === 1 ? 'duplicate' : 'duplicates'}
        </a>
        <a href="#/windows">
          <AppWindow /> <strong>{windows.length}</strong> {windows.length === 1 ? 'window' : 'windows'}
        </a>
      </nav>

      <div className="overview-grid">
        <div className="col" style={{ gap: 18 }}>
          <section className="col">
            <div className="row">
              <h2>Workspaces</h2>
              <div className="spacer" />
              <a href="#/organize" className="row" style={{ gap: 4 }}>
                Organize with AI <ArrowRight style={{ width: 14, height: 14 }} />
              </a>
            </div>
            {workspaces.length ? (
              <div className="ws-grid">
                {workspaces.map((w) => (
                  <WorkspaceCard key={w.id} ws={w} now={now} />
                ))}
              </div>
            ) : (
              <div className="card">
                <EmptyState icon={Group} title="No workspaces yet">
                  Create one from the sidebar, name a Chrome tab group, or let <a href="#/organize">Organize</a> propose workspaces from your open tabs.
                </EmptyState>
              </div>
            )}
          </section>
          <RecentActivity />
        </div>

        <div className="col" style={{ gap: 18 }}>
          <section className="card">
            <div className="card-pad col" style={{ gap: 10 }}>
              <h3>Suggestions</h3>
              {!preview ? (
                <span className="faint">Checking…</span>
              ) : preview.sleep.length + preview.archive.length + dupExtras === 0 ? (
                <span className="muted">Nothing to clean up right now.</span>
              ) : (
                <>
                  {preview.sleep.length > 0 && <Suggestion icon={Moon} text={`${plural(preview.sleep.length, 'inactive tab')} can sleep`} onClick={openClean} />}
                  {preview.archive.length > 0 && <Suggestion icon={Archive} text={`${plural(preview.archive.length, 'tab')} suggested for archive`} onClick={openClean} />}
                  {dupExtras > 0 && <Suggestion icon={Copy} text={`${plural(dupExtras, 'duplicate tab')}`} onClick={() => navigate('/duplicates')} />}
                </>
              )}
              {preview && preview.protectedCount > 0 && (
                <span className="faint row" style={{ gap: 6, fontSize: 12 }}>
                  <Shield style={{ width: 13, height: 13 }} /> {plural(preview.protectedCount, 'tab')} protected from automation
                </span>
              )}
            </div>
          </section>
          <MemoryCard sleeping={stats.sleeping} />
        </div>
      </div>
    </>
  );
}

function Suggestion({ icon: Icon, text, onClick }: { icon: typeof Moon; text: string; onClick: () => void }) {
  return (
    <button className="btn" style={{ justifyContent: 'flex-start', height: 34 }} onClick={onClick}>
      <Icon /> <span className="grow" style={{ textAlign: 'left' }}>{text}</span> <ArrowRight />
    </button>
  );
}

function WorkspaceCard({ ws, now }: { ws: Workspace; now: number }) {
  const { records } = useData();
  const fb = useFeedback();
  const members = records.filter((r) => r.workspaceId === ws.id);
  const live = members.filter(isLive);
  const counts = { open: 0, sleeping: 0, archived: 0 };
  for (const r of members) if (r.status !== 'closed') counts[r.status]++;
  const favDomains = [...new Map(live.map((r) => [r.domain, r])).values()].slice(0, 6);
  const lastActive = Math.max(ws.lastActiveAt, ...live.map((r) => r.lastActiveAt));

  const actions = {
    switch: () => fb.run(() => rpc('workspaces.switch', { id: ws.id }), () => `Switched to ${ws.name}`),
    group: () => fb.run(() => rpc('workspaces.group', { id: ws.id }), (r) => `Grouped ${plural(r.count, 'tab')} in Chrome`),
    sleep: () => fb.run(() => rpc('tabs.sleep', { recordIds: live.map((r) => r.id) }), (r) => `Put ${plural(r.count, 'tab')} to sleep`),
    archive: async () => {
      if (await fb.confirm({ title: `Archive all ${plural(live.length, 'open tab')} in ${ws.name}?`, body: 'They close and stay saved in the workspace. Restore them any time.', tabs: live, confirmLabel: 'Archive' }))
        await fb.run(() => rpc('tabs.archive', { recordIds: live.map((r) => r.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
    },
    restore: () => fb.run(() => rpc('workspaces.restore', { id: ws.id }), (r) => `Restored ${plural(r.count, 'tab')} in a new window`),
    snapshot: () => fb.run(async () => {
      const s = await rpc('snapshots.create', { scope: { kind: 'workspace', workspaceId: ws.id } });
      return { count: s.tabCount, skipped: [], activityId: null };
    }, (r) => `Saved a snapshot of ${plural(r.count, 'tab')}`),
    remove: async () => {
      if (await fb.confirm({ title: `Delete workspace “${ws.name}”?`, body: 'Its tabs stay open (or archived) and become unassigned. You can undo this.', confirmLabel: 'Delete workspace', danger: true }))
        await fb.run(() => rpc('workspaces.delete', { id: ws.id }), () => `Deleted ${ws.name}`);
    },
  };

  return (
    <div className="card ws-card">
      <div className="row">
        <WsDot color={ws.color} size={10} />
        <span className="name ellipsis" onClick={() => navigate(`/workspace/${ws.id}`)}>
          {ws.name}
        </span>
        {ws.isProtected && <Shield style={{ width: 13, height: 13, color: 'var(--accent)' }} aria-label="Protected" />}
        <div className="spacer" />
        <Menu
          trigger={(t) => (
            <button className="btn ghost icon sm" aria-label={`${ws.name} actions`} onClick={t}>
              <MoreHorizontal />
            </button>
          )}
          items={[
            { label: 'Group in Chrome', icon: Group, onClick: actions.group, disabled: !live.length },
            { label: 'Sleep all tabs', icon: Moon, onClick: actions.sleep, disabled: !live.length },
            { label: 'Archive all tabs', icon: Archive, onClick: actions.archive, disabled: !live.length },
            { label: `Restore ${counts.archived} archived`, icon: ArchiveRestore, onClick: actions.restore, disabled: !counts.archived },
            { label: 'Save snapshot', icon: Camera, onClick: actions.snapshot, disabled: !members.length },
            { divider: true, label: '' },
            { label: 'Delete workspace', icon: Trash2, onClick: actions.remove, danger: true },
          ]}
        />
      </div>
      <div className="summary">{ws.summary || <span className="faint">No description</span>}</div>
      <div className="counts">
        <span title="Awake">
          <CircleDot style={{ color: 'var(--st-open)' }} />
          {counts.open}
        </span>
        <span title="Sleeping">
          <Moon style={{ color: 'var(--st-sleeping)' }} />
          {counts.sleeping}
        </span>
        <span title="Archived">
          <Archive style={{ color: 'var(--st-archived)' }} />
          {counts.archived}
        </span>
        <span className="spacer" />
        <span className="faint">{ago(lastActive, now)}</span>
      </div>
      <div className="row">
        <div className="favs">
          {favDomains.map((r) => (
            <Favicon key={r.domain} url={r.url} />
          ))}
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={actions.switch}>
          {live.length ? 'Switch' : counts.archived ? 'Open' : 'Switch'}
        </button>
      </div>
    </div>
  );
}

function RecentActivity() {
  const entries = useLiveQuery(() => db.activity.orderBy('at').reverse().limit(8).toArray(), []);
  const fb = useFeedback();
  const now = useNow();
  return (
    <section className="col">
      <div className="row">
        <h2>Recent activity</h2>
        <div className="spacer" />
        <a href="#/activity">View all</a>
      </div>
      <div className="card panel-list">
        {!entries ? (
          <div className="item faint">Loading…</div>
        ) : !entries.length ? (
          <div className="item faint">Nothing yet. Actions you take, and anything TabOS does automatically, show up here with an Undo.</div>
        ) : (
          entries.map((e) => (
            <div className="item" key={e.id}>
              <span className="grow ellipsis">{e.label}</span>
              <span className="faint nowrap">{ago(e.at, now)}</span>
              {e.undo && !e.undoneAt && (
                <button className="btn sm" onClick={() => fb.run(() => rpc('activity.undo', { id: e.id }), (r) => r.message ?? 'Undone')}>
                  <Undo2 /> Undo
                </button>
              )}
              {e.undoneAt && <span className="pill">Undone</span>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** System memory as measured by the OS. Chrome doesn't expose per-tab memory to extensions. */
export function MemoryCard({ sleeping }: { sleeping: number }) {
  const [info, setInfo] = useState<{ capacity: number; available: number } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      chrome.system.memory
        .getInfo()
        .then((i) => alive && setInfo({ capacity: i.capacity, available: i.availableCapacity }))
        .catch(() => alive && setErr(true));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  let last: { delta: number; at: number } | null = null;
  try {
    last = JSON.parse(localStorage.getItem('tabos:lastCleanDelta') ?? 'null');
  } catch {
    last = null;
  }
  return (
    <section className="card card-pad col" style={{ gap: 10 }}>
      <div className="row">
        <MemoryStick style={{ width: 16, height: 16, color: 'var(--text-2)' }} />
        <h3>System memory</h3>
      </div>
      {err ? (
        <span className="faint">Memory information is unavailable.</span>
      ) : !info ? (
        <div className="skeleton" style={{ height: 8 }} />
      ) : (
        <>
          <div className="mem-bar" aria-label="Memory in use">
            <div style={{ width: `${((info.capacity - info.available) / info.capacity) * 100}%` }} />
          </div>
          <div className="row tnum" style={{ fontSize: 12 }}>
            <span>{bytes(info.capacity - info.available)} used</span>
            <span className="spacer" />
            <span className="muted">{bytes(info.available)} free of {bytes(info.capacity)}</span>
          </div>
        </>
      )}
      {last && (
        <div style={{ fontSize: 12 }}>
          Last clean: free memory changed by <strong className="tnum">{last.delta >= 0 ? '+' : ''}{bytes(last.delta)}</strong> <span className="faint">({ago(last.at)} ago)</span>
        </div>
      )}
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>
        {plural(sleeping, 'tab')} sleeping. Chrome doesn't report per-tab memory to extensions, so TabOS shows only what the OS measures, not estimated savings. Other apps affect these numbers too.
      </p>
    </section>
  );
}
