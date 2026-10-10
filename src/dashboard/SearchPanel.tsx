// Spotlight-style search: instant matches as you type, and "Ask" for natural-language search,
// all keyboard driven. Opens with Ctrl/⌘ K or "/" from anywhere in the dashboard.

import { Archive, ArrowRight, Clock, CornerDownLeft, Layers, Search, Settings, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { resolveProviders } from '../ai/providers';
import { describeQuery } from '../ai/queryParser';
import { semanticSearch, type SemanticHit } from '../ai/semanticSearch';
import { indexDoc, quickSearch } from '../core/search';
import { rpc } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { Favicon, WsDot } from '../ui/components';
import { errorMessage, useFeedback } from '../ui/feedback';
import { ago, STATUS_LABEL } from '../ui/format';
import { navigate } from '../ui/hooks';
import { useData } from './data';

type Item =
  | { kind: 'tab'; id: string; record: TabRecord; reasons?: string[] }
  | { kind: 'group'; id: string; name: string; color: Parameters<typeof WsDot>[0]['color']; count: number }
  | { kind: 'go'; id: string; label: string; icon: typeof Layers; hash: string }
  | { kind: 'ask'; id: string };

const PAGES: Array<{ label: string; icon: typeof Layers; hash: string; keywords: string }> = [
  { label: 'Tabs', icon: Layers, hash: '/', keywords: 'tabs home all open' },
  { label: 'Group Tabs', icon: Wand2, hash: '/group-tabs', keywords: 'group organize sort ai' },
  { label: 'Tidy Up', icon: Sparkles, hash: '/tidy', keywords: 'tidy clean memory sleep duplicates' },
  { label: 'Archive', icon: Archive, hash: '/archive', keywords: 'archive archived saved' },
  { label: 'History', icon: Clock, hash: '/history', keywords: 'history closed sessions undo restore' },
  { label: 'Settings', icon: Settings, hash: '/settings', keywords: 'settings preferences options' },
];

export function SearchPanel({ initial = '', onClose }: { initial?: string; onClose: () => void }) {
  const { records, workspaces, settings } = useData();
  const fb = useFeedback();
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState<{ query: string; hits: SemanticHit[] | null; chips: string[]; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => records.map(indexDoc), [records]);

  useEffect(() => inputRef.current?.focus(), []);

  const sections = useMemo((): Array<{ title: string; items: Item[] }> => {
    if (ask) {
      return [{ title: ask.hits ? (ask.hits.length ? 'Best matches' : '') : '', items: (ask.hits ?? []).map((h) => ({ kind: 'tab' as const, id: h.doc.id, record: h.doc as TabRecord, reasons: h.reasons })) }];
    }
    const query = q.trim();
    if (!query) {
      const recent = records.filter((r) => r.status === 'open' || r.status === 'sleeping').sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 6);
      return [
        { title: 'Recent', items: recent.map((r) => ({ kind: 'tab' as const, id: r.id, record: r })) },
        { title: 'Go to', items: PAGES.slice(1).map((p) => ({ kind: 'go' as const, id: p.hash, label: p.label, icon: p.icon, hash: p.hash })) },
      ];
    }
    const lower = query.toLowerCase();
    const tabs = quickSearch(index, query, 8).map((h) => ({ kind: 'tab' as const, id: h.doc.id, record: h.doc as TabRecord }));
    const live = records.filter((r) => r.status === 'open' || r.status === 'sleeping');
    const groups = workspaces
      .filter((w) => w.name.toLowerCase().includes(lower))
      .slice(0, 4)
      .map((w) => ({ kind: 'group' as const, id: w.id, name: w.name, color: w.color, count: live.filter((r) => r.workspaceId === w.id).length }));
    const pages = PAGES.filter((p) => p.label.toLowerCase().includes(lower) || p.keywords.includes(lower)).map((p) => ({
      kind: 'go' as const,
      id: p.hash,
      label: p.label,
      icon: p.icon,
      hash: p.hash,
    }));
    return [
      { title: '', items: [{ kind: 'ask' as const, id: 'ask' }] },
      { title: 'Tabs', items: tabs },
      { title: 'Groups', items: groups },
      { title: 'Go to', items: pages },
    ].filter((s) => s.items.length);
  }, [q, ask, index, records, workspaces]);

  const flat = sections.flatMap((s) => s.items);
  useEffect(() => setActive(q.trim() && !ask && flat.length > 1 ? 1 : 0), [q, ask]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runAsk = async () => {
    const query = q.trim();
    if (!query) return;
    setAsk({ query, hits: null, chips: [] });
    try {
      const providers = resolveProviders(settings.ai);
      const res = await semanticSearch(query, records, { provider: providers.embedding, exclusions: settings.exclusions, limit: 20 });
      setAsk({ query, hits: res.hits, chips: describeQuery(res.parsed) });
    } catch (err) {
      setAsk({ query, hits: [], chips: [], error: errorMessage(err) });
    }
    setActive(0);
  };

  const choose = async (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'ask') return runAsk();
    if (item.kind === 'go') {
      navigate(item.hash);
      return onClose();
    }
    if (item.kind === 'group') {
      navigate(`/group/${item.id}`);
      return onClose();
    }
    onClose();
    await fb.run(() => rpc('tabs.focus', { recordId: item.record.id }));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void choose(flat[active]);
    } else if (e.key === 'Tab' && q.trim() && !ask) {
      e.preventDefault();
      void runAsk();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (ask) setAsk(null);
      else onClose();
    }
  };

  let n = -1;
  const row = (item: Item, content: ReactNode, trailing?: ReactNode) => {
    n++;
    const idx = n;
    return (
      <div
        key={`${item.kind}:${item.id}`}
        role="option"
        aria-selected={idx === active}
        data-active={idx === active}
        className={`result-row ${idx === active ? 'active' : ''}`}
        onMouseMove={() => idx !== active && setActive(idx)}
        onClick={() => void choose(item)}
      >
        {content}
        <div className="meta">{trailing}</div>
      </div>
    );
  };

  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          {ask ? <Sparkles /> : <Search />}
          <input
            ref={inputRef}
            value={ask ? ask.query : q}
            placeholder="Search tabs, groups and pages, or describe what you’re looking for"
            aria-label="Search"
            onChange={(e) => {
              setAsk(null);
              setQ(e.target.value);
            }}
            onKeyDown={onKey}
          />
          {ask && ask.chips.map((c) => <span key={c} className="pill">{c}</span>)}
        </div>
        <div className="palette-body" ref={listRef} role="listbox">
          {ask && !ask.hits && (
            <div className="col" style={{ gap: 6, padding: 8 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton-row">
                  <div className="skeleton" style={{ width: 16, height: 16 }} />
                  <div className="skeleton" style={{ height: 10, width: `${70 - i * 10}%` }} />
                  <div className="skeleton" style={{ height: 10 }} />
                </div>
              ))}
            </div>
          )}
          {ask?.error && <div className="empty">{ask.error}</div>}
          {ask?.hits && !ask.hits.length && !ask.error && (
            <div className="empty">
              <h3>Nothing matched</h3>
              <div>Try fewer words, or mention when you saw it, like “yesterday” or “last week”.</div>
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title || 'top'}>
              {s.title && <div className="palette-group label">{s.title}</div>}
              {s.items.map((item) => {
                if (item.kind === 'ask') {
                  return row(
                    item,
                    <>
                      <Sparkles style={{ width: 16, height: 16, color: 'var(--text-2)' }} />
                      <span className="ellipsis">
                        Ask: <span className="muted">“{q.trim()}”</span>
                      </span>
                    </>,
                    <span className="kbd">Tab</span>,
                  );
                }
                if (item.kind === 'go') {
                  const Icon = item.icon;
                  return row(item, <><Icon style={{ width: 16, height: 16, color: 'var(--text-2)' }} /><span>{item.label}</span></>, <ArrowRight style={{ width: 14, height: 14 }} />);
                }
                if (item.kind === 'group') {
                  return row(item, <><WsDot color={item.color} /><span>{item.name}</span></>, <span className="tnum">{item.count}</span>);
                }
                const r = item.record;
                return row(
                  item,
                  <>
                    <Favicon url={r.url} />
                    <div style={{ minWidth: 0 }}>
                      <div className="ellipsis">{r.title}</div>
                      <div className="row small faint" style={{ gap: 6 }}>
                        <span className="ellipsis">{r.domain}</span>
                        {item.reasons?.slice(0, 2).map((x) => (
                          <span key={x} className="reason">
                            {x}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>,
                  <>
                    {r.status !== 'open' && <span>{STATUS_LABEL[r.status]}</span>}
                    <span className="tnum">{ago(r.closedAt ?? r.archivedAt ?? r.lastActiveAt)}</span>
                  </>,
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> to move
          </span>
          <span>
            <span className="kbd">
              <CornerDownLeft style={{ width: 11, height: 11 }} />
            </span>{' '}
            to open
          </span>
          {!ask && (
            <span>
              <span className="kbd">Tab</span> to ask in your own words
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            <span className="kbd">Esc</span> {ask ? 'back' : 'close'}
          </span>
        </div>
      </div>
    </div>
  );
}
