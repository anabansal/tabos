import { useLiveQuery } from 'dexie-react-hooks';
import { AppWindow, ArchiveRestore, ChevronRight, Clock, MoreHorizontal, Pencil, Save, Trash2, Undo2, History as HistoryIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { indexDoc, quickSearch } from '../../core/search';
import { db } from '../../shared/db';
import { rpc } from '../../shared/messages';
import type { Snapshot } from '../../shared/types';
import { displayUrl } from '../../shared/url';
import { EmptyState, Favicon, LoadingRows, Menu, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { ago, dateTime, dayLabel, plural } from '../../ui/format';
import { navigate, usePermission } from '../../ui/hooks';
import { TabList, sortRecent } from '../../ui/TabList';
import { useData } from '../data';

const TABS = [
  { id: 'closed', label: 'Recently Closed' },
  { id: 'sessions', label: 'Saved Sessions' },
  { id: 'undo', label: 'Undo' },
];

export function HistoryView({ tab }: { tab: string }) {
  const current = tab === 'snapshots' ? 'sessions' : TABS.some((t) => t.id === tab) ? tab : 'closed';
  return (
    <>
      <div className="page-intro">
          <p className="lede">Get back tabs you closed, whole sessions, or undo anything TabOS did.</p>
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="History section">
          {TABS.map((t) => (
            <button key={t.id} aria-pressed={current === t.id} onClick={() => navigate(`/history?tab=${t.id}`)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {current === 'closed' && <Closed />}
      {current === 'sessions' && <Sessions />}
      {current === 'undo' && <UndoHistory />}
    </>
  );
}

function Closed() {
  const { records, workspaces, settings, query, openRelated } = useData();
  const fb = useFeedback();
  const closed = useMemo(() => {
    const list = records.filter((r) => r.status === 'closed');
    return query.trim() ? quickSearch(list.map(indexDoc), query, 2000).map((h) => h.doc) : sortRecent(list);
  }, [records, query]);
  const clear = async () => {
    if (await fb.confirm({ title: 'Clear recently closed tabs?', body: 'Archived tabs and saved sessions are not affected. You can undo right after.', confirmLabel: 'Clear', danger: true }))
      await fb.run(() => rpc('data.clearClosed', {}), (r) => `Cleared ${plural(r.count, 'tab')}`);
  };
  return (
    <>
      <div className="list-card">
        <TabList
          records={closed}
          groups={workspaces}
          onSimilar={openRelated}
          empty={{ icon: Clock, title: 'Nothing closed recently', body: 'Tabs you close show up here so you can bring them back.' }}
        />
      </div>
      <div className="row faint small">
        <span>Kept for {settings.history.closedRetentionDays ? plural(settings.history.closedRetentionDays, 'day') : 'ever'}.</span>
        <div className="spacer" />
        {closed.length > 0 && (
          <button className="btn sm ghost" onClick={clear}>
            Clear list
          </button>
        )}
      </div>
      <ChromeRecentlyClosed />
    </>
  );
}

/** Chrome's own recently-closed list (restores back/forward history too). Optional permission. */
function ChromeRecentlyClosed() {
  const [granted, request] = usePermission({ permissions: ['sessions'] });
  const fb = useFeedback();
  const [items, setItems] = useState<chrome.sessions.Session[] | null>(null);
  useEffect(() => {
    if (!granted) return;
    let alive = true;
    const load = () => chrome.sessions.getRecentlyClosed({ maxResults: 25 }).then((s) => alive && setItems(s)).catch(() => alive && setItems([]));
    void load();
    chrome.sessions.onChanged.addListener(load);
    return () => {
      alive = false;
      chrome.sessions.onChanged.removeListener(load);
    };
  }, [granted]);
  if (granted === null) return null;
  if (!granted) {
    return (
      <div className="grouped">
        <div className="item">
          <HistoryIcon style={{ width: 18, height: 18, color: 'var(--text-2)' }} />
          <div className="grow">
            <div>Also show Chrome's recently closed windows</div>
            <div className="desc">Restores each tab with its back and forward history. Read only when you open this page; stays on this device.</div>
          </div>
          <button className="btn sm" onClick={() => void request()}>
            Allow
          </button>
        </div>
      </div>
    );
  }
  if (!items?.length) return null;
  const restore = (id?: string) => id && fb.run(() => rpc('sessions.restore', { sessionId: id }), () => 'Restored');
  return (
    <section className="tab-section">
      <div className="section-head">
        <span className="name" style={{ cursor: 'default' }}>
          From Chrome
        </span>
      </div>
      <div className="grouped">
        {items.map((s, i) => (
          <div className="item" key={i}>
            {s.tab ? <Favicon url={s.tab.url ?? ''} /> : <AppWindow style={{ width: 16, height: 16, color: 'var(--text-2)' }} />}
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">{s.tab ? s.tab.title || s.tab.url : `Window with ${plural(s.window?.tabs?.length ?? 0, 'tab')}`}</div>
              <div className="desc ellipsis">{s.tab ? displayUrl(s.tab.url ?? '') : (s.window?.tabs ?? []).slice(0, 3).map((t) => t.title).join(' · ')}</div>
            </div>
            <span className="faint small nowrap">{ago(s.lastModified * 1000)}</span>
            <button className="btn sm" onClick={() => restore(s.tab?.sessionId ?? s.window?.sessionId)}>
              Restore
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sessions() {
  const snaps = useLiveQuery(() => db.snapshots.orderBy('createdAt').reverse().toArray(), []);
  const fb = useFeedback();
  const save = () =>
    fb.run(async () => {
      const s = await rpc('snapshots.create', { scope: { kind: 'all' } });
      return { count: s.tabCount, skipped: [], activityId: null };
    }, (r) => `Saved ${plural(r.count, 'tab')}`);
  const saved = (snaps ?? []).filter((s) => s.kind !== 'auto');
  const auto = (snaps ?? []).filter((s) => s.kind === 'auto');
  return (
    <>
      <div className="row">
        <span className="muted">A session is every window and tab, saved so you can bring it all back later.</span>
        <div className="spacer" />
        <button className="btn primary" onClick={save}>
          <Save /> Save Current Session
        </button>
      </div>
      {!snaps ? (
        <div className="list-card">
          <LoadingRows rows={3} />
        </div>
      ) : (
        <>
          <section className="tab-section">
            <div className="section-head">
              <span className="name" style={{ cursor: 'default' }}>
                Saved by you
              </span>
            </div>
            {saved.length ? (
              <div className="grouped">
                {saved.map((s) => (
                  <SessionRow key={s.id} s={s} />
                ))}
              </div>
            ) : (
              <div className="list-card">
                <EmptyState icon={Save} title="No saved sessions">
                  Save your current windows before a big change, then bring them back with one click.
                </EmptyState>
              </div>
            )}
          </section>
          {auto.length > 0 && (
            <section className="tab-section">
              <div className="section-head">
                <span className="name" style={{ cursor: 'default' }}>
                  Saved automatically
                </span>
                <span className="faint small">for crash recovery</span>
              </div>
              <div className="grouped">
                {auto.map((s) => (
                  <SessionRow key={s.id} s={s} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function SessionRow({ s }: { s: Snapshot }) {
  const fb = useFeedback();
  const [open, setOpen] = useState(false);
  const restore = async (target: 'new-window' | 'current') => {
    if (s.tabCount > 15 && !(await fb.confirm({ title: `Restore ${plural(s.tabCount, 'tab')}?`, body: `Opens ${plural(s.windows.length, 'window')}. Only the first tab loads right away.`, confirmLabel: 'Restore' }))) return;
    await fb.run(() => rpc('snapshots.restore', { id: s.id, target }), (r) => `Restored ${plural(r.count, 'tab')}`);
  };
  return (
    <>
      <div className="item">
        <button className="btn ghost icon sm" aria-label={open ? 'Hide tabs' : 'Show tabs'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronRight style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.25s var(--ease)' }} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 500 }}>
            {s.name}
          </div>
          <div className="desc">
            {dateTime(s.createdAt)} · {plural(s.tabCount, 'tab')}
            {s.windows.length > 1 ? ` · ${plural(s.windows.length, 'window')}` : ''}
          </div>
        </div>
        <button className="btn sm" onClick={() => restore('new-window')}>
          <ArchiveRestore /> Restore
        </button>
        <Menu
          trigger={(t) => (
            <button className="btn ghost icon sm" aria-label="Session options" onClick={t}>
              <MoreHorizontal />
            </button>
          )}
          items={[
            { label: 'Restore into this window', icon: AppWindow, onClick: () => restore('current') },
            {
              label: 'Rename…',
              icon: Pencil,
              onClick: async () => {
                const name = await fb.prompt({ title: 'Rename session', initial: s.name, confirmLabel: 'Rename' });
                if (name) await fb.run(() => rpc('snapshots.rename', { id: s.id, name }));
              },
            },
            { divider: true, label: '' },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => fb.run(() => rpc('snapshots.delete', { id: s.id }), () => 'Session deleted') },
          ]}
        />
      </div>
      {open && (
        <div className="item" style={{ display: 'block', paddingLeft: 56 }}>
          {s.windows.map((w, i) => (
            <div key={i} className="col" style={{ gap: 5, marginBottom: 10 }}>
              {s.windows.length > 1 && <span className="label">Window {i + 1}</span>}
              {w.tabs.slice(0, 40).map((t, j) => {
                const g = w.groups.find((x) => x.key === t.groupKey);
                return (
                  <div key={j} className="row small">
                    <Favicon url={t.url} size={14} />
                    <span className="ellipsis grow">{t.title || displayUrl(t.url)}</span>
                    {g && (
                      <span className="row faint" style={{ gap: 5 }}>
                        <WsDot color={g.color} size={7} /> {g.title || 'Group'}
                      </span>
                    )}
                  </div>
                );
              })}
              {w.tabs.length > 40 && <span className="faint small">+ {w.tabs.length - 40} more</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function UndoHistory() {
  const entries = useLiveQuery(() => db.activity.orderBy('at').reverse().limit(200).toArray(), []);
  const fb = useFeedback();
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof entries>>();
    for (const e of entries ?? []) m.set(dayLabel(e.at), [...(m.get(dayLabel(e.at)) ?? []), e]);
    return [...m.entries()];
  }, [entries]);
  if (!entries) return <LoadingRows />;
  if (!entries.length)
    return (
      <div className="list-card">
        <EmptyState icon={Undo2} title="Nothing to undo">
          Everything TabOS does, whether you asked or it happened automatically, appears here with an Undo button.
        </EmptyState>
      </div>
    );
  return (
    <>
      {groups.map(([day, list]) => (
        <section key={day} className="tab-section">
          <div className="section-head">
            <span className="name" style={{ cursor: 'default' }}>
              {day}
            </span>
          </div>
          <div className="grouped">
            {list.map((e) => (
              <div className="item" key={e.id}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{e.label}</div>
                  <div className="desc">{new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                {e.undoneAt ? (
                  <span className="faint small">Undone</span>
                ) : e.undo ? (
                  <button className="btn sm" onClick={() => fb.run(() => rpc('activity.undo', { id: e.id }), (r) => r.message ?? 'Undone')}>
                    <Undo2 /> Undo
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
