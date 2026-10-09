import { Filter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { indexDoc, quickSearch } from '../../core/search';
import type { TabRecord, TabStatus } from '../../shared/types';
import { TabTable, windowLabels, type SortKey } from '../../ui/TabTable';
import { navigate, useDebounced } from '../../ui/hooks';
import { useData } from '../data';

type StatusFilter = 'live' | TabStatus | 'all';

const STATUS_CHIPS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'live', label: 'Open' },
  { id: 'sleeping', label: 'Sleeping' },
  { id: 'archived', label: 'Archived' },
  { id: 'closed', label: 'Closed' },
];

export function matchStatus(r: TabRecord, f: StatusFilter): boolean {
  if (f === 'all') return true;
  if (f === 'live') return r.status === 'open' || r.status === 'sleeping';
  return r.status === f;
}

export function TabsView({ params }: { params: URLSearchParams }) {
  const { records, workspaces, windows, openRelated } = useData();
  const status = (params.get('status') as StatusFilter) || 'live';
  const ws = params.get('ws') ?? '';
  const win = params.get('window') ?? '';
  const [text, setText] = useState('');
  const [sort, setSort] = useState<SortKey>(status === 'archived' || status === 'closed' ? 'recent' : 'recent');
  const q = useDebounced(text, 120);
  const labels = useMemo(() => windowLabels(windows), [windows]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    navigate(`/tabs${p.toString() ? '?' + p.toString() : ''}`);
  };

  const counts = useMemo(() => {
    const scoped = records.filter((r) => (ws === 'none' ? !r.workspaceId : ws ? r.workspaceId === ws : true));
    return Object.fromEntries(STATUS_CHIPS.map((c) => [c.id, scoped.filter((r) => matchStatus(r, c.id)).length]));
  }, [records, ws]);

  const filtered = useMemo(() => {
    let list = records.filter(
      (r) =>
        matchStatus(r, status) &&
        (ws === 'none' ? !r.workspaceId : ws ? r.workspaceId === ws : true) &&
        (win ? String(r.windowId) === win && (r.status === 'open' || r.status === 'sleeping') : true),
    );
    if (q.trim()) {
      const hits = quickSearch(list.map(indexDoc), q, 2000);
      list = hits.map((h) => h.doc);
    }
    return list;
  }, [records, status, ws, win, q]);

  const title =
    status === 'archived' ? 'Archived tabs' : status === 'closed' ? 'Recently closed' : ws === 'none' ? 'Unassigned tabs' : status === 'sleeping' ? 'Sleeping tabs' : status === 'open' ? 'Awake tabs' : 'Tabs';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <div className="sub">
            {status === 'archived'
              ? 'Closed by TabOS but saved with their workspace and position. Reopen any time; they are never deleted automatically.'
              : status === 'closed'
                ? 'Tabs you closed. Kept for the retention period in Settings.'
                : 'Every tab in every window, including sleeping ones.'}
          </div>
        </div>
      </div>
      <div className="filters">
        {STATUS_CHIPS.map((c) => (
          <button key={c.id} className={`chip ${status === c.id ? 'active' : ''}`} onClick={() => setParam('status', c.id === 'live' ? '' : c.id)}>
            {c.label} <span className="count">{counts[c.id]}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <div className="search-field" style={{ width: 260 }}>
          <Filter />
          <input className="input" placeholder="Filter by title or URL" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter" />
        </div>
        <select className="select" value={ws} onChange={(e) => setParam('ws', e.target.value)} aria-label="Workspace filter">
          <option value="">All workspaces</option>
          <option value="none">Unassigned</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select className="select" value={win} onChange={(e) => setParam('window', e.target.value)} aria-label="Window filter">
          <option value="">All windows</option>
          {windows.map((w) => (
            <option key={w.id} value={w.id}>
              {labels.get(w.id!)}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="recent">Recently used</option>
          <option value="oldest">Least recently used</option>
          <option value="title">Title</option>
          <option value="domain">Site</option>
          <option value="created">Newest</option>
          <option value="window">Window order</option>
        </select>
      </div>
      <div className="card">
        <TabTable
          records={filtered}
          workspaces={workspaces}
          windows={windows}
          sort={q.trim() ? undefined : sort}
          showWindow={windows.length > 1}
          onRelated={openRelated}
          emptyTitle={q ? 'No matches' : status === 'archived' ? 'Nothing archived' : status === 'closed' ? 'No recently closed tabs' : 'No tabs'}
          emptyBody={
            status === 'archived' ? 'Archive tabs you want to keep but not keep open. Use the Clean button for suggestions.' : q ? 'Try a different word, or use Search for natural-language queries.' : undefined
          }
        />
      </div>
    </>
  );
}
