import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Moon,
  Network,
  Shield,
  ShieldOff,
  Sparkles,
  Sun,
  Trash2,
  X,
  AppWindow,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { rpc } from '../shared/messages';
import type { TabRecord, Workspace } from '../shared/types';
import { displayUrl } from '../shared/url';
import { EmptyState, Favicon, Menu, StatusPill, WorkspaceSelect } from './components';
import { useFeedback } from './feedback';
import { ago, plural } from './format';

export type SortKey = 'recent' | 'oldest' | 'title' | 'domain' | 'created' | 'window';

const isLive = (r: TabRecord) => r.status === 'open' || r.status === 'sleeping';

export function sortRecords(list: TabRecord[], key: SortKey): TabRecord[] {
  const out = [...list];
  switch (key) {
    case 'recent':
      return out.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    case 'oldest':
      return out.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title));
    case 'domain':
      return out.sort((a, b) => a.domain.localeCompare(b.domain) || b.lastActiveAt - a.lastActiveAt);
    case 'created':
      return out.sort((a, b) => b.createdAt - a.createdAt);
    case 'window':
      return out.sort((a, b) => (a.windowId ?? Infinity) - (b.windowId ?? Infinity) || a.index - b.index);
  }
}

export function windowLabels(windows: chrome.windows.Window[]): Map<number, string> {
  return new Map(windows.map((w, i) => [w.id!, `Window ${i + 1}${w.focused ? ' (current)' : ''}`]));
}

interface Props {
  records: TabRecord[];
  workspaces: Workspace[];
  windows?: chrome.windows.Window[];
  emptyTitle?: string;
  emptyBody?: ReactNode;
  sort?: SortKey;
  reasons?: Map<string, string[]>;
  onRelated?: (r: TabRecord) => void;
  showWindow?: boolean;
}

export function TabTable({ records, workspaces, windows = [], emptyTitle = 'No tabs here', emptyBody, sort, reasons, onRelated, showWindow }: Props) {
  const fb = useFeedback();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(200);
  const winLabels = useMemo(() => windowLabels(windows), [windows]);
  const sorted = useMemo(() => (sort ? sortRecords(records, sort) : records), [records, sort]);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const wsMap = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

  // Drop selections that disappeared from the list.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => byId.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [byId]);

  const sel = [...selected].map((id) => byId.get(id)!).filter(Boolean);
  const selLive = sel.filter(isLive);
  const selSaved = sel.filter((r) => !isLive(r));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = sorted.slice(0, limit);
  const allSelected = allShown.length > 0 && allShown.every((r) => selected.has(r.id));

  const open = (r: TabRecord) => fb.run(() => rpc('tabs.focus', { recordId: r.id }), (x) => (x.count && !isLive(r) ? `Reopened “${r.title.slice(0, 40)}”` : ''));

  const bulk = {
    assign: (wsId: string | null) =>
      fb.run(() => rpc('tabs.assign', { recordIds: sel.map((r) => r.id), workspaceId: wsId }), (r) => `Moved ${plural(r.count, 'tab')}${wsId ? ` to ${wsMap.get(wsId)?.name}` : ' out of workspaces'}`),
    sleep: () => fb.run(() => rpc('tabs.sleep', { recordIds: selLive.map((r) => r.id) }), (r) => `Put ${plural(r.count, 'tab')} to sleep`),
    wake: () => fb.run(() => rpc('tabs.wake', { recordIds: selLive.map((r) => r.id) }), (r) => `Woke ${plural(r.count, 'tab')}`),
    archive: async () => {
      if (selLive.length > 3 && !(await fb.confirm({ title: `Archive ${plural(selLive.length, 'tab')}?`, body: 'They will close and stay saved under Archived, ready to restore.', tabs: selLive, confirmLabel: 'Archive' })))
        return;
      await fb.run(() => rpc('tabs.archive', { recordIds: sel.map((r) => r.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
      setSelected(new Set());
    },
    restore: async () => {
      if (selSaved.length > 10 && !(await fb.confirm({ title: `Reopen ${plural(selSaved.length, 'tab')}?`, body: 'Restored tabs open asleep (except the first) if lazy restore is on.', tabs: selSaved, confirmLabel: 'Reopen' })))
        return;
      await fb.run(() => rpc('tabs.open', { recordIds: selSaved.map((r) => r.id), focus: true }), (r) => `Reopened ${plural(r.count, 'tab')}`);
      setSelected(new Set());
    },
    protect: (value: boolean) => fb.run(() => rpc('tabs.protect', { recordIds: sel.map((r) => r.id), value }), (r) => `${value ? 'Protected' : 'Unprotected'} ${plural(r.count, 'tab')}`),
    move: (target: string) =>
      fb.run(() => rpc('tabs.move', { recordIds: selLive.map((r) => r.id), windowId: target === 'new' ? 'new' : Number(target) }), (r) => `Moved ${plural(r.count, 'tab')}`),
    close: async () => {
      if (!(await fb.confirm({ title: `Close ${plural(selLive.length, 'tab')}?`, body: 'They will appear under Recently closed for a while. You can undo this.', tabs: selLive, confirmLabel: 'Close tabs', danger: true })))
        return;
      await fb.run(() => rpc('tabs.close', { recordIds: selLive.map((r) => r.id) }), (r) => `Closed ${plural(r.count, 'tab')}`);
      setSelected(new Set());
    },
    remove: async () => {
      if (!(await fb.confirm({ title: `Delete ${plural(selSaved.length, 'saved tab')} permanently?`, body: 'This removes them from TabOS history. You can undo right after.', tabs: selSaved, confirmLabel: 'Delete', danger: true })))
        return;
      await fb.run(() => rpc('tabs.delete', { recordIds: selSaved.map((r) => r.id) }), (r) => `Deleted ${plural(r.count, 'saved tab')}`);
      setSelected(new Set());
    },
  };

  if (!records.length) return <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>;

  return (
    <div>
      <div className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', minHeight: 36 }}>
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            aria-label="Select all"
            onChange={() => setSelected(allSelected ? new Set() : new Set(allShown.map((r) => r.id)))}
          />
          <span className="faint">{selected.size ? `${selected.size} selected` : plural(records.length, 'tab')}</span>
        </label>
      </div>
      <div className="tab-list" role="list">
        {allShown.map((r) => (
          <TabRow
            key={r.id}
            r={r}
            selected={selected.has(r.id)}
            onToggle={() => toggle(r.id)}
            onOpen={() => open(r)}
            workspaces={workspaces}
            windowLabel={showWindow && r.windowId != null && isLive(r) ? winLabels.get(r.windowId) : undefined}
            windows={windows}
            reasons={reasons?.get(r.id)}
            onRelated={onRelated}
          />
        ))}
      </div>
      {sorted.length > limit && (
        <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
          <button className="btn" onClick={() => setLimit((l) => l + 300)}>
            Show {Math.min(300, sorted.length - limit)} more
          </button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <strong className="tnum" style={{ marginRight: 6 }}>{selected.size}</strong>
          <WorkspaceSelect className="select" value={null} workspaces={workspaces} noneLabel="Move to workspace…" onChange={(id) => id && bulk.assign(id)} />
          {selLive.length > 0 && (
            <>
              <button className="btn" onClick={bulk.sleep} title="Discard from memory, keep the tab">
                <Moon /> Sleep
              </button>
              <button className="btn" onClick={bulk.archive}>
                <Archive /> Archive
              </button>
            </>
          )}
          {selSaved.length > 0 && (
            <button className="btn" onClick={bulk.restore}>
              <ArchiveRestore /> Reopen
            </button>
          )}
          <Menu
            align="right"
            trigger={(t) => (
              <button className="btn icon" aria-label="More bulk actions" onClick={t}>
                <MoreHorizontal />
              </button>
            )}
            items={[
              { label: 'Wake', icon: Sun, onClick: bulk.wake, disabled: !selLive.length },
              ...windows.map((w) => ({ label: `Move to ${winLabels.get(w.id!)}`, icon: AppWindow, onClick: () => bulk.move(String(w.id)), disabled: !selLive.length })),
              { label: 'Move to new window', icon: Network, onClick: () => bulk.move('new'), disabled: !selLive.length },
              { divider: true, label: '' },
              { label: 'Protect', icon: Shield, onClick: () => bulk.protect(true) },
              { label: 'Unprotect', icon: ShieldOff, onClick: () => bulk.protect(false) },
              { label: 'Remove from workspace', icon: X, onClick: () => bulk.assign(null) },
              { divider: true, label: '' },
              { label: `Close ${selLive.length} open`, icon: X, onClick: bulk.close, danger: true, disabled: !selLive.length },
              { label: `Delete ${selSaved.length} saved`, icon: Trash2, onClick: bulk.remove, danger: true, disabled: !selSaved.length },
            ]}
          />
          <button className="btn icon" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X />
          </button>
        </div>
      )}
    </div>
  );
}

function TabRow({
  r,
  selected,
  onToggle,
  onOpen,
  workspaces,
  windowLabel,
  windows,
  reasons,
  onRelated,
}: {
  r: TabRecord;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  workspaces: Workspace[];
  windowLabel?: string;
  windows: chrome.windows.Window[];
  reasons?: string[];
  onRelated?: (r: TabRecord) => void;
}) {
  const fb = useFeedback();
  const live = isLive(r);
  const when = r.status === 'archived' ? r.archivedAt : r.status === 'closed' ? r.closedAt : r.lastActiveAt;
  const act = {
    sleep: () => fb.run(() => rpc('tabs.sleep', { recordIds: [r.id] }), () => 'Tab is asleep'),
    wake: () => fb.run(() => rpc('tabs.wake', { recordIds: [r.id] }), () => 'Tab is awake'),
    archive: () => fb.run(() => rpc('tabs.archive', { recordIds: [r.id] }), () => 'Archived'),
    restore: () => fb.run(() => rpc('tabs.open', { recordIds: [r.id], focus: false, lazy: false }), () => 'Reopened in the background'),
    protect: () => fb.run(() => rpc('tabs.protect', { recordIds: [r.id], value: !r.isProtected }), () => (r.isProtected ? 'Unprotected' : 'Protected from sleep and archive')),
    assign: (id: string | null) => fb.run(() => rpc('tabs.assign', { recordIds: [r.id], workspaceId: id }), () => 'Moved'),
    close: () => fb.run(() => rpc('tabs.close', { recordIds: [r.id] }), () => 'Closed'),
    remove: async () => {
      if (await fb.confirm({ title: 'Delete this saved tab permanently?', tabs: [r], confirmLabel: 'Delete', danger: true }))
        await fb.run(() => rpc('tabs.delete', { recordIds: [r.id] }), () => 'Deleted');
    },
    move: (w: number | 'new') => fb.run(() => rpc('tabs.move', { recordIds: [r.id], windowId: w }), () => 'Moved'),
    copy: async () => {
      await navigator.clipboard.writeText(r.url);
      fb.toast('Link copied');
    },
  };
  return (
    <div className={`tab-row ${selected ? 'selected' : ''}`} role="listitem">
      <input type="checkbox" className="check" checked={selected} onChange={onToggle} aria-label={`Select ${r.title}`} style={{ accentColor: 'var(--accent)' }} />
      <Favicon url={r.url} />
      <div className="col" style={{ gap: 1 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className="title ellipsis" onClick={onOpen} title={r.title} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
            {r.title || displayUrl(r.url)}
          </span>
          {r.isProtected && <Shield aria-label="Protected" style={{ width: 13, height: 13, color: 'var(--accent)', flex: 'none' }} />}
          {r.pinned && <span className="pill">Pinned</span>}
          {r.audible && <span className="pill accent">Playing</span>}
        </div>
        <div className="sub">
          <span className="ellipsis">{displayUrl(r.url)}</span>
          {windowLabel && <span className="nowrap">· {windowLabel}</span>}
        </div>
        {reasons && reasons.length > 0 && (
          <div className="reasons">
            {reasons.map((x) => (
              <span key={x} className="reason">
                {x}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="meta">
        <div className="actions">
          {live && r.status === 'open' && (
            <button className="btn ghost icon sm" title="Sleep" aria-label="Sleep" onClick={act.sleep}>
              <Moon />
            </button>
          )}
          {live && r.status === 'sleeping' && (
            <button className="btn ghost icon sm" title="Wake" aria-label="Wake" onClick={act.wake}>
              <Sun />
            </button>
          )}
          {live ? (
            <button className="btn ghost icon sm" title="Archive" aria-label="Archive" onClick={act.archive}>
              <Archive />
            </button>
          ) : (
            <button className="btn ghost icon sm" title="Reopen" aria-label="Reopen" onClick={act.restore}>
              <ArchiveRestore />
            </button>
          )}
          <Menu
            trigger={(t) => (
              <button className="btn ghost icon sm" aria-label="More" onClick={t}>
                <MoreHorizontal />
              </button>
            )}
            items={[
              { label: live ? 'Go to tab' : 'Reopen and focus', icon: ExternalLink, onClick: onOpen },
              ...(onRelated ? [{ label: 'Find related tabs', icon: Sparkles, onClick: () => onRelated(r) }] : []),
              { label: r.isProtected ? 'Unprotect' : 'Protect from sleep and archive', icon: r.isProtected ? ShieldOff : Shield, onClick: act.protect },
              { label: 'Copy link', icon: Copy, onClick: act.copy },
              ...(live && windows.length
                ? [
                    { divider: true, label: '' },
                    ...windows.filter((w) => w.id !== r.windowId).slice(0, 6).map((w, i) => ({ label: `Move to window ${windows.indexOf(w) + 1 || i + 1}`, icon: AppWindow, onClick: () => act.move(w.id!) })),
                    { label: 'Move to new window', icon: Network, onClick: () => act.move('new') },
                  ]
                : []),
              { divider: true, label: '' },
              live ? { label: 'Close tab', icon: X, onClick: act.close, danger: true } : { label: 'Delete permanently', icon: Trash2, onClick: act.remove, danger: true },
            ]}
          />
        </div>
        <WorkspaceSelect className="select ws-select" value={r.workspaceId} workspaces={workspaces} noneLabel="—" onChange={act.assign} />
        <StatusPill status={r.status} />
        <span className="when" title={when ? new Date(when).toLocaleString() : ''}>
          {ago(when)}
        </span>
      </div>
    </div>
  );
}
