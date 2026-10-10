// The one tab list used everywhere. Calm by default (favicon, title, site, time), with actions
// revealed on hover, a checkbox that replaces the favicon, and drag-to-group.

import {
  AppWindow,
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  ExternalLink,
  FolderPlus,
  Moon,
  MoreHorizontal,
  Shield,
  ShieldOff,
  Sparkles,
  Sun,
  Trash2,
  X,
  FolderMinus,
  Volume2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { rpc } from '../shared/messages';
import type { TabRecord, Workspace } from '../shared/types';
import { displayUrl } from '../shared/url';
import { EmptyState, Favicon, Menu, type MenuItem } from './components';
import { useFeedback } from './feedback';
import { GROUP_HEX, ago, plural } from './format';

export const DRAG_TYPE = 'application/x-tabos-records';
const isLive = (r: TabRecord) => r.status === 'open' || r.status === 'sleeping';

export function sortRecent(list: TabRecord[]): TabRecord[] {
  return [...list].sort((a, b) => (b.closedAt ?? b.archivedAt ?? b.lastActiveAt) - (a.closedAt ?? a.archivedAt ?? a.lastActiveAt));
}

/** Shared "move to group" actions, including creating a new group on the spot. */
export function useGroupActions() {
  const fb = useFeedback();
  const moveTo = (ids: string[], groupId: string | null, groupName?: string) =>
    fb.run(() => rpc('tabs.assign', { recordIds: ids, workspaceId: groupId }), (r) =>
      groupId ? `Moved ${plural(r.count, 'tab')} to ${groupName ?? 'group'}` : `Removed ${plural(r.count, 'tab')} from the group`,
    );
  const newGroup = async (ids: string[]) => {
    const name = await fb.prompt({ title: 'New group', placeholder: 'Name, e.g. Trip to Japan', confirmLabel: 'Create' });
    if (!name) return;
    try {
      const ws = await rpc('workspaces.create', { name, recordIds: ids });
      fb.toast(`Created ${ws.name}`);
    } catch (err) {
      fb.error(err);
    }
  };
  const menuItems = (ids: string[], groups: Workspace[], current: string | null): MenuItem[] => [
    { label: 'Move to group', heading: true },
    ...groups.map((g) => ({
      label: g.name,
      icon: g.id === current ? Check : undefined,
      disabled: g.id === current,
      onClick: () => moveTo(ids, g.id, g.name),
    })),
    { label: 'New group…', icon: FolderPlus, onClick: () => newGroup(ids) },
    ...(current ? [{ label: 'Remove from group', icon: FolderMinus, onClick: () => moveTo(ids, null) }] : []),
  ];
  return { moveTo, newGroup, menuItems };
}

interface Props {
  records: TabRecord[];
  groups: Workspace[];
  windows?: chrome.windows.Window[];
  showGroup?: boolean;
  showWindow?: boolean;
  reasons?: Map<string, string[]>;
  onSimilar?: (r: TabRecord) => void;
  empty?: { title: string; body?: ReactNode; icon?: typeof Archive };
  limit?: number;
}

export function TabList({ records, groups, windows = [], showGroup, showWindow, reasons, onSimilar, empty, limit: initialLimit = 250 }: Props) {
  const fb = useFeedback();
  const ga = useGroupActions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(initialLimit);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const winLabel = useMemo(() => new Map(windows.map((w, i) => [w.id!, `Window ${i + 1}`])), [windows]);

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
  const clear = () => setSelected(new Set());

  const bulk = {
    archive: async () => {
      if (selLive.length > 5 && !(await fb.confirm({ title: `Archive ${plural(selLive.length, 'tab')}?`, body: 'They close and wait in Archive until you need them.', tabs: selLive, confirmLabel: 'Archive' }))) return;
      await fb.run(() => rpc('tabs.archive', { recordIds: selLive.map((r) => r.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
      clear();
    },
    reopen: async () => {
      await fb.run(() => rpc('tabs.open', { recordIds: selSaved.map((r) => r.id), focus: true }), (r) => `Reopened ${plural(r.count, 'tab')}`);
      clear();
    },
    close: async () => {
      if (!(await fb.confirm({ title: `Close ${plural(selLive.length, 'tab')}?`, body: 'You can find them in History, or undo right away.', tabs: selLive, confirmLabel: 'Close', danger: true }))) return;
      await fb.run(() => rpc('tabs.close', { recordIds: selLive.map((r) => r.id) }), (r) => `Closed ${plural(r.count, 'tab')}`);
      clear();
    },
    remove: async () => {
      if (!(await fb.confirm({ title: `Delete ${plural(selSaved.length, 'tab')} for good?`, body: 'They will be removed from TabOS. You can undo right after.', tabs: selSaved, confirmLabel: 'Delete', danger: true }))) return;
      await fb.run(() => rpc('tabs.delete', { recordIds: selSaved.map((r) => r.id) }), (r) => `Deleted ${plural(r.count, 'tab')}`);
      clear();
    },
  };

  if (!records.length) {
    return empty ? (
      <EmptyState icon={empty.icon} title={empty.title}>
        {empty.body}
      </EmptyState>
    ) : null;
  }

  const shown = records.slice(0, limit);
  return (
    <>
      <div className={`tab-list ${selected.size ? 'selecting' : ''}`} role="list">
        {shown.map((r) => (
          <Row
            key={r.id}
            r={r}
            selected={selected.has(r.id)}
            selectedIds={selected}
            onToggle={() => toggle(r.id)}
            groups={groups}
            group={showGroup && r.workspaceId ? groupById.get(r.workspaceId) : undefined}
            windowLabel={showWindow && r.windowId != null && isLive(r) ? winLabel.get(r.windowId) : undefined}
            reasons={reasons?.get(r.id)}
            onSimilar={onSimilar}
          />
        ))}
      </div>
      {records.length > limit && (
        <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
          <button className="btn quiet" onClick={() => setLimit((l) => l + 300)}>
            Show {Math.min(300, records.length - limit)} more
          </button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected tabs">
          <strong className="tnum" style={{ marginRight: 8 }}>
            {selected.size} selected
          </strong>
          <Menu
            align="left"
            trigger={(t) => (
              <button className="btn" onClick={t}>
                <FolderPlus /> Move to group
              </button>
            )}
            items={ga.menuItems([...selected], groups, null)}
          />
          {selLive.length > 0 && (
            <button className="btn" onClick={bulk.archive}>
              <Archive /> Archive
            </button>
          )}
          {selSaved.length > 0 && (
            <button className="btn" onClick={bulk.reopen}>
              <ArchiveRestore /> Reopen
            </button>
          )}
          <Menu
            trigger={(t) => (
              <button className="btn icon" aria-label="More actions" onClick={t}>
                <MoreHorizontal />
              </button>
            )}
            items={[
              { label: 'Sleep now', icon: Moon, disabled: !selLive.length, onClick: () => fb.run(() => rpc('tabs.sleep', { recordIds: selLive.map((r) => r.id) }), (r) => `${plural(r.count, 'tab')} sleeping`) },
              { label: 'Wake up', icon: Sun, disabled: !selLive.length, onClick: () => fb.run(() => rpc('tabs.wake', { recordIds: selLive.map((r) => r.id) }), (r) => `Woke ${plural(r.count, 'tab')}`) },
              { label: 'Keep open (protect)', icon: Shield, onClick: () => fb.run(() => rpc('tabs.protect', { recordIds: [...selected], value: true }), (r) => `Protected ${plural(r.count, 'tab')}`) },
              { label: 'Stop protecting', icon: ShieldOff, onClick: () => fb.run(() => rpc('tabs.protect', { recordIds: [...selected], value: false }), () => 'Done') },
              { label: 'Move to new window', icon: AppWindow, disabled: !selLive.length, onClick: () => fb.run(() => rpc('tabs.move', { recordIds: selLive.map((r) => r.id), windowId: 'new' }), (r) => `Moved ${plural(r.count, 'tab')}`) },
              { divider: true, label: '' },
              selLive.length
                ? { label: `Close ${plural(selLive.length, 'tab')}`, icon: X, danger: true, onClick: bulk.close }
                : { label: `Delete ${plural(selSaved.length, 'tab')}`, icon: Trash2, danger: true, onClick: bulk.remove },
            ]}
          />
          <button className="btn quiet" onClick={clear}>
            Done
          </button>
        </div>
      )}
    </>
  );
}

function Row({
  r,
  selected,
  selectedIds,
  onToggle,
  groups,
  group,
  windowLabel,
  reasons,
  onSimilar,
}: {
  r: TabRecord;
  selected: boolean;
  selectedIds: Set<string>;
  onToggle: () => void;
  groups: Workspace[];
  group?: Workspace;
  windowLabel?: string;
  reasons?: string[];
  onSimilar?: (r: TabRecord) => void;
}) {
  const fb = useFeedback();
  const ga = useGroupActions();
  const [dragging, setDragging] = useState(false);
  const live = isLive(r);
  const when = r.status === 'archived' ? r.archivedAt : r.status === 'closed' ? r.closedAt : r.lastActiveAt;
  const open = () =>
    fb.run(() => rpc('tabs.focus', { recordId: r.id }), (x) => (x.count && !live ? `Reopened “${r.title.slice(0, 40)}”` : ''));

  const items: MenuItem[] = [
    { label: live ? 'Go to tab' : 'Reopen', icon: live ? ExternalLink : ArchiveRestore, onClick: open },
    { divider: true, label: '' },
    ...ga.menuItems([r.id], groups, r.workspaceId),
    { divider: true, label: '' },
    ...(live
      ? [
          r.status === 'sleeping'
            ? { label: 'Wake up', icon: Sun, onClick: () => fb.run(() => rpc('tabs.wake', { recordIds: [r.id] }), () => 'Awake') }
            : { label: 'Sleep now', icon: Moon, onClick: () => fb.run(() => rpc('tabs.sleep', { recordIds: [r.id] }), () => 'Sleeping to save memory') },
          {
            label: r.isProtected ? 'Stop protecting' : 'Keep open (protect)',
            icon: r.isProtected ? ShieldOff : Shield,
            onClick: () => fb.run(() => rpc('tabs.protect', { recordIds: [r.id], value: !r.isProtected }), () => (r.isProtected ? 'No longer protected' : 'This tab will never sleep or be archived')),
          },
          { label: 'Move to new window', icon: AppWindow, onClick: () => fb.run(() => rpc('tabs.move', { recordIds: [r.id], windowId: 'new' }), () => 'Moved') },
        ]
      : []),
    ...(onSimilar ? [{ label: 'Find similar tabs', icon: Sparkles, onClick: () => onSimilar(r) }] : []),
    {
      label: 'Copy link',
      icon: Copy,
      onClick: async () => {
        await navigator.clipboard.writeText(r.url);
        fb.toast('Link copied');
      },
    },
    { divider: true, label: '' },
    live
      ? { label: 'Close tab', icon: X, danger: true, onClick: () => fb.run(() => rpc('tabs.close', { recordIds: [r.id] }), () => 'Closed') }
      : {
          label: 'Delete for good',
          icon: Trash2,
          danger: true,
          onClick: async () => {
            if (await fb.confirm({ title: 'Delete this tab for good?', tabs: [r], confirmLabel: 'Delete', danger: true }))
              await fb.run(() => rpc('tabs.delete', { recordIds: [r.id] }), () => 'Deleted');
          },
        },
  ];

  return (
    <div
      className={`tab-row ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      role="listitem"
      draggable
      onDragStart={(e) => {
        const ids = selected ? [...selectedIds] : [r.id];
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="lead">
        <Favicon url={r.url} />
        <input type="checkbox" className="box" checked={selected} onChange={onToggle} aria-label={`Select ${r.title}`} />
      </div>
      <div className="tab-main">
        <span className="title" onClick={open} title={r.title} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open()}>
          {r.title || displayUrl(r.url)}
        </span>
        <span className="meta">
          {r.domain || displayUrl(r.url)}
          {windowLabel && <> · {windowLabel}</>}
          {group && (
            <>
              {' · '}
              <span className="ws-dot" style={{ background: GROUP_HEX[group.color] }} />
              {group.name}
            </>
          )}
        </span>
        {reasons && reasons.length > 0 && (
          <span className="reasons">
            {reasons.map((x) => (
              <span key={x} className="reason">
                {x}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="trail">
        <div className="state">
          {r.audible && <Volume2 aria-label="Playing audio" />}
          {r.isProtected && <Shield aria-label="Protected" />}
          {r.status === 'sleeping' && <Moon aria-label="Sleeping to save memory" />}
          <span className="when" title={when ? new Date(when).toLocaleString() : ''}>
            {ago(when)}
          </span>
        </div>
        <div className="actions">
          {live ? (
            <button className="btn quiet icon sm" title="Archive: close it but keep it" aria-label="Archive" onClick={() => fb.run(() => rpc('tabs.archive', { recordIds: [r.id] }), () => 'Archived')}>
              <Archive />
            </button>
          ) : (
            <button className="btn sm" onClick={() => fb.run(() => rpc('tabs.open', { recordIds: [r.id], focus: false, lazy: false }), () => 'Reopened in the background')}>
              Reopen
            </button>
          )}
          <Menu
            trigger={(t) => (
              <button className="btn quiet icon sm" aria-label="More" onClick={t}>
                <MoreHorizontal />
              </button>
            )}
            items={items}
          />
        </div>
      </div>
    </div>
  );
}
