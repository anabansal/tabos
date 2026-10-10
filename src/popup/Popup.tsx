import { Archive, ChevronDown, CornerDownLeft, Maximize2, Search, Sparkles, Wand2, Inbox } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { indexDoc, quickSearch } from '../core/search';
import { rpc } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { displayUrl } from '../shared/url';
import { Favicon, Menu, StatusPill, WsDot } from '../ui/components';
import { useFeedback } from '../ui/feedback';
import { plural } from '../ui/format';
import { useRecords, useSettings, useTheme, useWorkspaces } from '../ui/hooks';
import { useGroupActions } from '../ui/TabList';

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
  const ga = useGroupActions();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tidy, setTidy] = useState<number | null>(null);

  useEffect(() => {
    rpc('tabs.current', {}).then((r) => setCurrentId(r?.id ?? null)).catch(() => setCurrentId(null));
    rpc('clean.preview', {})
      .then((p) => setTidy(p.sleep.length + p.archive.length + p.duplicates.reduce((n, g) => n + g.recordIds.length - 1, 0)))
      .catch(() => setTidy(null));
  }, []);
  const cur = currentId ? records?.find((r) => r.id === currentId) : undefined;
  const groups = workspaces ?? [];
  const curGroup = cur?.workspaceId ? groups.find((g) => g.id === cur.workspaceId) : undefined;

  const index = useMemo(() => (records ?? []).map(indexDoc), [records]);
  const hits = useMemo(() => (q.trim() ? quickSearch(index, q, 8) : []), [index, q]);
  useEffect(() => setActive(0), [q]);
  const counts = useMemo(() => {
    const c = { live: 0, other: 0, byWs: new Map<string, number>() };
    for (const r of records ?? []) {
      if (!isLive(r)) continue;
      c.live++;
      if (r.workspaceId) c.byWs.set(r.workspaceId, (c.byWs.get(r.workspaceId) ?? 0) + 1);
      else c.other++;
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
    const total = hits.length + 1;
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

  return (
    <div className="popup-root">
      <header className="popup-head">
        <img src="/icons/icon-32.png" alt="" width={18} height={18} />
        <strong>TabOS</strong>
        <span className="faint tnum">{plural(counts.live, 'tab')}</span>
        <div className="spacer" />
        <button className="btn ghost icon sm" title="Open TabOS" aria-label="Open TabOS" onClick={() => openDashboard()}>
          <Maximize2 />
        </button>
      </header>

      <div className="search-field">
        <Search />
        <input className="input" autoFocus placeholder="Search tabs" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Search tabs" />
      </div>

      {q.trim() ? (
        <div className="popup-scroll" role="listbox">
          {hits.map((h, i) => (
            <div key={h.doc.id} role="option" aria-selected={i === active} className={`result-row ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => openHit(h.doc)}>
              <Favicon url={h.doc.url} />
              <div style={{ minWidth: 0 }}>
                <div className="ellipsis">{h.doc.title}</div>
                <div className="faint ellipsis small">{h.doc.domain || displayUrl(h.doc.url)}</div>
              </div>
              {h.doc.status !== 'open' && h.doc.status !== 'sleeping' && <StatusPill status={h.doc.status} />}
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
            <span className="ellipsis">{hits.length ? 'Search in your own words' : 'No exact match. Search in your own words'}</span>
            <CornerDownLeft style={{ width: 14, height: 14, color: 'var(--text-3)' }} />
          </div>
        </div>
      ) : (
        <>
          {cur && isLive(cur) && (
            <section className="popup-current" aria-label="This tab">
              <Favicon url={cur.url} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 500 }} title={cur.title}>
                  {cur.title}
                </div>
                <Menu
                  align="left"
                  trigger={(t) => (
                    <button className="group-chip" onClick={t} aria-label="Change group">
                      {curGroup ? <WsDot color={curGroup.color} size={7} /> : null}
                      {curGroup ? curGroup.name : 'Add to a group'}
                      <ChevronDown style={{ width: 11, height: 11 }} />
                    </button>
                  )}
                  items={ga.menuItems([cur.id], groups, cur.workspaceId)}
                />
              </div>
              <button className="btn quiet icon" title="Archive: close it but keep it" aria-label="Archive this tab" onClick={() => fb.run(() => rpc('tabs.archive', { recordIds: [cur.id] }), () => 'Archived')}>
                <Archive />
              </button>
            </section>
          )}

          <section className="popup-scroll">
            <div className="popup-label">Groups</div>
            <div className="grouped popup-inset">
              {groups.map((g) => (
                <button key={g.id} className="item popup-row" onClick={() => fb.run(() => rpc('workspaces.switch', { id: g.id }), () => `Showing ${g.name}`).then(() => window.close())}>
                  <WsDot color={g.color} />
                  <span className="ellipsis grow">{g.name}</span>
                  <span className="faint tnum">{counts.byWs.get(g.id) ?? 0}</span>
                </button>
              ))}
              <button className="item popup-row" onClick={() => openDashboard('/?group=none')}>
                <Inbox style={{ width: 14, height: 14, color: 'var(--text-3)' }} />
                <span className="ellipsis grow">Other Tabs</span>
                <span className="faint tnum">{counts.other}</span>
              </button>
            </div>
            {!groups.length && <div className="faint small" style={{ padding: '6px 10px 0' }}>No groups yet. Group Tabs sorts your tabs in one click.</div>}
          </section>

          <footer className="popup-foot">
            <button className="btn primary grow" onClick={() => openDashboard('/tidy')}>
              <Sparkles /> {tidy ? `Tidy Up ${plural(tidy, 'Tab')}` : 'Tidy Up'}
            </button>
            <button className="btn" onClick={() => openDashboard('/group-tabs')}>
              <Wand2 /> Group Tabs
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
