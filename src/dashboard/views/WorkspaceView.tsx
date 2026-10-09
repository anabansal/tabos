import { Archive, ArchiveRestore, Camera, Group, Moon, MoreHorizontal, Shield, Trash2, Ungroup, ArrowRightLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '../../shared/messages';
import type { GroupColor } from '../../shared/types';
import { ColorSwatches, EmptyState, Menu, Toggle, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { navigate } from '../../ui/hooks';
import { TabTable } from '../../ui/TabTable';
import { isLive, useData } from '../data';

export function WorkspaceView({ id }: { id: string | undefined }) {
  const { records, workspaces, wsMap, windows, openRelated } = useData();
  const fb = useFeedback();
  const ws = id ? wsMap.get(id) : undefined;
  const [name, setName] = useState(ws?.name ?? '');
  const [summary, setSummary] = useState(ws?.summary ?? '');
  const [showSaved, setShowSaved] = useState(true);
  useEffect(() => {
    setName(ws?.name ?? '');
    setSummary(ws?.summary ?? '');
  }, [ws?.id, ws?.name, ws?.summary]);

  const members = useMemo(() => records.filter((r) => r.workspaceId === id && r.status !== 'closed'), [records, id]);
  if (!ws) {
    return (
      <div className="card">
        <EmptyState title="Workspace not found">
          It may have been deleted. <a href="#/">Back to overview</a>
        </EmptyState>
      </div>
    );
  }
  const live = members.filter(isLive);
  const archived = members.filter((r) => r.status === 'archived');
  const shown = showSaved ? members : live;

  const update = (patch: { name?: string; summary?: string; color?: GroupColor; isProtected?: boolean }) =>
    rpc('workspaces.update', { id: ws.id, patch }).catch((e) => {
      fb.error(e);
      setName(ws.name);
    });

  const actions = {
    switch: () => fb.run(() => rpc('workspaces.switch', { id: ws.id }), () => `Switched to ${ws.name}`),
    group: () => fb.run(() => rpc('workspaces.group', { id: ws.id }), (r) => `Grouped ${plural(r.count, 'tab')} in Chrome`),
    ungroup: () => fb.run(() => rpc('workspaces.ungroup', { id: ws.id }), (r) => `Ungrouped ${plural(r.count, 'tab')}`),
    sleep: () => fb.run(() => rpc('tabs.sleep', { recordIds: live.map((r) => r.id) }), (r) => `Put ${plural(r.count, 'tab')} to sleep`),
    archive: async () => {
      if (await fb.confirm({ title: `Archive ${plural(live.length, 'open tab')}?`, body: `They close and stay saved in ${ws.name}.`, tabs: live, confirmLabel: 'Archive' }))
        await fb.run(() => rpc('tabs.archive', { recordIds: live.map((r) => r.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
    },
    restore: async () => {
      if (archived.length > 10 && !(await fb.confirm({ title: `Restore ${plural(archived.length, 'tab')}?`, body: 'They open in a new window, asleep except the first (if lazy restore is on).', tabs: archived, confirmLabel: 'Restore' })))
        return;
      await fb.run(() => rpc('workspaces.restore', { id: ws.id }), (r) => `Restored ${plural(r.count, 'tab')}`);
    },
    snapshot: () =>
      fb.run(async () => {
        const s = await rpc('snapshots.create', { scope: { kind: 'workspace', workspaceId: ws.id } });
        return { count: s.tabCount, skipped: [], activityId: null };
      }, (r) => `Saved snapshot with ${plural(r.count, 'tab')}`),
    remove: async () => {
      if (await fb.confirm({ title: `Delete workspace “${ws.name}”?`, body: `Its ${plural(members.length, 'tab')} stay where they are and become unassigned. Linked Chrome tab groups are ungrouped. You can undo this.`, confirmLabel: 'Delete workspace', danger: true })) {
        await fb.run(() => rpc('workspaces.delete', { id: ws.id }), () => `Deleted ${ws.name}`);
        navigate('/');
      }
    },
  };

  return (
    <>
      <div className="card">
        <div className="card-pad col" style={{ gap: 10 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ marginTop: 13 }}>
              <WsDot color={ws.color} size={12} />
            </span>
            <div className="col grow" style={{ gap: 4 }}>
              <input
                className="input"
                aria-label="Workspace name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== ws.name && update({ name })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                style={{ fontSize: 19, fontWeight: 650, height: 36, border: '1px solid transparent', paddingLeft: 6, marginLeft: -6, background: 'transparent' }}
              />
              <input
                className="input"
                aria-label="Summary"
                placeholder="Add a short description"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onBlur={() => summary !== ws.summary && update({ summary })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                style={{ border: '1px solid transparent', paddingLeft: 6, marginLeft: -6, background: 'transparent', color: 'var(--text-2)' }}
              />
            </div>
            <button className="btn primary" onClick={actions.switch}>
              <ArrowRightLeft /> Switch
            </button>
            <Menu
              trigger={(t) => (
                <button className="btn icon" aria-label="Workspace actions" onClick={t}>
                  <MoreHorizontal />
                </button>
              )}
              items={[
                { label: 'Group in Chrome', icon: Group, onClick: actions.group, disabled: !live.length },
                { label: 'Ungroup in Chrome', icon: Ungroup, onClick: actions.ungroup },
                { label: 'Sleep all', icon: Moon, onClick: actions.sleep, disabled: !live.length },
                { label: 'Archive all open', icon: Archive, onClick: actions.archive, disabled: !live.length },
                { label: `Restore ${archived.length} archived`, icon: ArchiveRestore, onClick: actions.restore, disabled: !archived.length },
                { label: 'Save snapshot', icon: Camera, onClick: actions.snapshot, disabled: !members.length },
                { divider: true, label: '' },
                { label: 'Delete workspace', icon: Trash2, onClick: actions.remove, danger: true },
              ]}
            />
          </div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <ColorSwatches value={ws.color} onChange={(color) => update({ color })} />
            <label className="row" style={{ gap: 8 }}>
              <Toggle checked={ws.isProtected} onChange={(v) => update({ isProtected: v })} label="Protect workspace" />
              <Shield style={{ width: 14, height: 14 }} /> Never auto-sleep or archive these tabs
            </label>
            <div className="spacer" />
            <span className="muted tnum">
              {plural(live.length, 'open tab')} · {archived.length} archived
            </span>
          </div>
        </div>
      </div>
      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={showSaved} onChange={(e) => setShowSaved(e.target.checked)} /> Show archived tabs
        </label>
      </div>
      <div className="card">
        <TabTable
          records={shown}
          workspaces={workspaces}
          windows={windows}
          sort="recent"
          showWindow={windows.length > 1}
          onRelated={openRelated}
          emptyTitle="This workspace is empty"
          emptyBody="Move tabs here from any list with the workspace menu, name a Chrome tab group the same, or use Organize."
        />
      </div>
    </>
  );
}
