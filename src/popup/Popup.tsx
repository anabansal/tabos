import { Archive, Brush, LayoutDashboard, MoreHorizontal, Moon, Plus, Search, Shield, ShieldOff, Sparkles, CornerDownLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { indexDoc, quickSearch } from '../core/search';
import { rpc } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { displayUrl } from '../shared/url';
import { Favicon, Menu, StatusPill, WorkspaceSelect, WsDot } from '../ui/components';
import { useFeedback } from '../ui/feedback';
import { plural } from '../ui/format';
import { useRecords, useSettings, useTheme, useWorkspaces } from '../ui/hooks';

const isLive = (r: TabRecord) => r.status === 'open' || r.status === 'sleeping';

async function openDashboard(hash?: string) {
  await rpc('dashboard.open', { hash });
  window.close();
}

export function Popup() {
  const records = useRecords();
  const workspaces = useWorkspaces();
  const [settings] = useSettings();
  useTheme(settings);
  const fb = useFeedback();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [current, setCurrent] = useState<TabRecord | null>(null);
  const [sleepable, setSleepable] = useState<number | null>(null);
  const [newWs, setNewWs] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    rpc('tabs.current', {}).then(setCurrent).catch(() => setCurrent(null));
    rpc('clean.preview', {})
      .then((p) => setSleepable(p.sleep.length + p.archive.length + p.duplicates.reduce((n, g) => n + g.recordIds.length - 1, 0)))
      .catch(() => setSleepable(null));
  }, []);
  // Keep the current-tab card in sync with live updates.
  const cur = current ? (records?.find((r) => r.id === current.id) ?? current) : null;

  const index = useMemo(() => (records ?? []).map(indexDoc), [records]);
  const hits = useMemo(() => (q.trim() ? quickSearch(index, q, 8) : []), [index, q]);
  useEffect(() => setActive(0), [q]);

  const counts = useMemo(() => {
    const c = { open: 0, sleeping: 0, byWs: new Map<string, number>() };
    for (const r of records ?? []) {
      if (r.status === 'open') c.open++;
      if (r.status === 'sleeping') c.sleeping++;
      if (isLive(r) && r.workspaceId) c.byWs.set(r.workspaceId, (c.byWs.get(r.workspaceId) ?? 0) + 1);
    }
    return c;
  }, [records]);

  const openHit = async (r: TabRecord) => {
    try {
      await rpc('tabs.focus', { recordId: r.id });
      window.close();
    } catch (err) {
      fb.error(err);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const total = hits.length + 1; // last row = natural-language search
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + total) % total);
    } else if (e.key === 'Enter' && q.trim()) {
      e.preventDefault();
      if (active < hits.length) void openHit(hits[active].doc);
      else void openDashboard(`/search?q=${encodeURIComponent(q)}`);
    } else if (e.key === 'Escape' && q) {
      e.preventDefault();
      setQ('');
    }
  };

  const ws = workspaces ?? [];
  return (
    <div className="popup-root">
      <header className="popup-head">
        <img src="/icons/icon-32.png" alt="" width={18} height={18} />
        <strong>TabOS</strong>
        <span className="faint tnum">
          {counts.open} open · {counts.sleeping} asleep
        </span>
        <div className="spacer" />
        <button className="btn ghost icon sm" title="Open dashboard" aria-label="Open dashboard" onClick={() => openDashboard()}>
          <LayoutDashboard />
        </button>
      </header>

      <div className="search-field" style={{ margin: '0 12px' }}>
        <Search />
        <input ref={inputRef} className="input" autoFocus placeholder="Search all tabs" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Search tabs" />
      </div>

      {q.trim() ? (
        <div className="popup-results" role="listbox">
          {hits.map((h, i) => (
            <div key={h.doc.id} role="option" aria-selected={i === active} className={`result-row ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => openHit(h.doc)}>
              <Favicon url={h.doc.url} />
              <div className="col" style={{ gap: 0 }}>
                <span className="ellipsis">{h.doc.title}</span>
                <span className="faint ellipsis" style={{ fontSize: 11.5 }}>
                  {displayUrl(h.doc.url)}
                </span>
              </div>
              {h.doc.status !== 'open' && <StatusPill status={h.doc.status} />}
            </div>
          ))}
          <div
            role="option"
            aria-selected={active === hits.length}
            className={`result-row ${active === hits.length ? 'active' : ''}`}
            onMouseEnter={() => setActive(hits.length)}
            onClick={() => openDashboard(`/search?q=${encodeURIComponent(q)}`)}
          >
            <Sparkles style={{ width: 16, height: 16, color: 'var(--accent)' }} />
            <span className="ellipsis">
              {hits.length ? 'Search in plain language' : 'No exact matches. Search in plain language'}
            </span>
            <CornerDownLeft style={{ width: 14, height: 14, color: 'var(--text-3)' }} />
          </div>
        </div>
      ) : (
        <>
          {cur && isLive(cur) && (
            <section className="popup-current">
              <div className="row">
                <Favicon url={cur.url} />
                <span className="ellipsis grow" style={{ fontWeight: 550 }} title={cur.title}>
                  {cur.title}
                </span>
                {cur.isProtected && <Shield style={{ width: 13, height: 13, color: 'var(--accent)' }} aria-label="Protected" />}
              </div>
              <div className="row">
                <WorkspaceSelect
                  className="select grow"
                  value={cur.workspaceId}
                  workspaces={ws}
                  noneLabel="No workspace"
                  onChange={(id) => fb.run(() => rpc('tabs.assign', { recordIds: [cur.id], workspaceId: id }), () => (id ? 'Moved' : 'Removed from workspace'))}
                />
                <button className="btn" onClick={() => fb.run(() => rpc('tabs.archive', { recordIds: [cur.id] }), () => 'Archived')}>
                  <Archive /> Archive
                </button>
                <Menu
                  trigger={(t) => (
                    <button className="btn icon" aria-label="More" onClick={t}>
                      <MoreHorizontal />
                    </button>
                  )}
                  items={[
                    {
                      label: cur.isProtected ? 'Unprotect this tab' : 'Protect this tab',
                      icon: cur.isProtected ? ShieldOff : Shield,
                      onClick: () => fb.run(() => rpc('tabs.protect', { recordIds: [cur.id], value: !cur.isProtected }), () => (cur.isProtected ? 'Unprotected' : 'Protected')),
                    },
                    { label: 'Sleep other tabs in this window', icon: Moon, onClick: () => fb.run(() => rpc('tabs.sleepOthers', {}), (r) => `Put ${plural(r.count, 'tab')} to sleep`) },
                  ]}
                />
              </div>
            </section>
          )}

          <section className="popup-section">
            <div className="row" style={{ padding: '0 12px 4px' }}>
              <span className="section-title">Workspaces</span>
              <div className="spacer" />
              <button className="btn ghost icon sm" aria-label="New workspace" title="New workspace" onClick={() => setNewWs('')}>
                <Plus />
              </button>
            </div>
            {newWs !== null && (
              <form
                style={{ padding: '0 12px 6px' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newWs.trim()) return setNewWs(null);
                  try {
                    await rpc('workspaces.create', { name: newWs, recordIds: cur && isLive(cur) && !cur.workspaceId ? [cur.id] : [] });
                    setNewWs(null);
                  } catch (err) {
                    fb.error(err);
                  }
                }}
              >
                <input className="input" style={{ width: '100%' }} autoFocus placeholder="Name, then Enter" value={newWs} onChange={(e) => setNewWs(e.target.value)} onBlur={() => !newWs.trim() && setNewWs(null)} />
              </form>
            )}
            <div className="popup-ws">
              {ws.map((w) => (
                <button key={w.id} className="popup-ws-row" onClick={() => fb.run(() => rpc('workspaces.switch', { id: w.id }), () => `Switched to ${w.name}`).then(() => window.close())}>
                  <WsDot color={w.color} />
                  <span className="ellipsis grow">{w.name}</span>
                  <span className="faint tnum">{counts.byWs.get(w.id) ?? 0}</span>
                </button>
              ))}
              {!ws.length && newWs === null && <div className="faint" style={{ padding: '4px 12px 8px' }}>No workspaces yet. Name a Chrome tab group, add one here, or let Organize suggest some.</div>}
            </div>
          </section>

          <footer className="popup-foot">
            <button className="btn primary grow" onClick={() => openDashboard('/clean')}>
              <Brush /> {sleepable ? `Clean up ${plural(sleepable, 'tab')}` : 'Clean up'}
            </button>
            <button className="btn" onClick={() => openDashboard('/organize')}>
              <Sparkles /> Organize
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
