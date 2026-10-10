import { ArchiveRestore, Eye, MoreHorizontal, Save, Shield, ShieldOff, Trash2, Ungroup, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { indexDoc, quickSearch } from '../../core/search';
import { rpc } from '../../shared/messages';
import type { GroupColor } from '../../shared/types';
import { ColorSwatches, EmptyState, Menu, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { navigate } from '../../ui/hooks';
import { TabList, sortRecent } from '../../ui/TabList';
import { isLive, useData } from '../data';

export function GroupView({ id }: { id: string | undefined }) {
  const { records, workspaces, wsMap, windows, query, openRelated } = useData();
  const fb = useFeedback();
  const ws = id ? wsMap.get(id) : undefined;
  const [name, setName] = useState(ws?.name ?? '');
  const [note, setNote] = useState(ws?.summary ?? '');
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    setName(ws?.name ?? '');
    setNote(ws?.summary ?? '');
  }, [ws?.id, ws?.name, ws?.summary]);

  const members = useMemo(() => records.filter((r) => r.workspaceId === id && r.status !== 'closed'), [records, id]);
  const filtered = useMemo(() => (query.trim() ? quickSearch(members.map(indexDoc), query, 2000).map((h) => h.doc) : members), [members, query]);
  if (!ws) {
    return (
      <div className="card">
        <EmptyState icon={FolderOpen} title="This group no longer exists">
          <a href="#/">Back to Tabs</a>
        </EmptyState>
      </div>
    );
  }
  const open = filtered.filter(isLive);
  const archived = sortRecent(filtered.filter((r) => r.status === 'archived'));
  const update = (patch: { name?: string; summary?: string; color?: GroupColor; isProtected?: boolean }) =>
    rpc('workspaces.update', { id: ws.id, patch }).catch((e) => {
      fb.error(e);
      setName(ws.name);
    });

  return (
    <>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <button className="btn ghost icon" style={{ marginTop: 3 }} aria-label="Change color" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
            <WsDot color={ws.color} size={14} />
          </button>
          <div className="col grow" style={{ gap: 4 }}>
            <input
              className="title-input"
              aria-label="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== ws.name && update({ name })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <input
              className="input"
              aria-label="Note"
              placeholder="Add a note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== ws.summary && update({ summary: note })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              style={{ background: 'transparent', paddingLeft: 0, color: 'var(--text-2)' }}
            />
          </div>
          <button className="btn primary" onClick={() => fb.run(() => rpc('workspaces.switch', { id: ws.id }), () => `Showing ${ws.name}`)}>
            <Eye /> Show in Chrome
          </button>
          <Menu
            trigger={(t) => (
              <button className="btn icon" aria-label="Group options" onClick={t}>
                <MoreHorizontal />
              </button>
            )}
            items={[
              {
                label: ws.isProtected ? 'Allow sleeping and archiving' : 'Keep these tabs open (protect)',
                icon: ws.isProtected ? ShieldOff : Shield,
                onClick: () => update({ isProtected: !ws.isProtected }),
              },
              {
                label: 'Save as session',
                icon: Save,
                onClick: () =>
                  fb.run(async () => {
                    const s = await rpc('snapshots.create', { scope: { kind: 'workspace', workspaceId: ws.id } });
                    return { count: s.tabCount, skipped: [], activityId: null };
                  }, (r) => `Saved ${plural(r.count, 'tab')} to History`),
              },
              { label: 'Ungroup in Chrome', icon: Ungroup, onClick: () => fb.run(() => rpc('workspaces.ungroup', { id: ws.id }), () => 'Ungrouped') },
              { divider: true, label: '' },
              {
                label: 'Delete group',
                icon: Trash2,
                danger: true,
                onClick: async () => {
                  if (await fb.confirm({ title: `Delete “${ws.name}”?`, body: 'Its tabs stay where they are; only the group goes away. You can undo.', confirmLabel: 'Delete group', danger: true })) {
                    await fb.run(() => rpc('workspaces.delete', { id: ws.id }), () => `Deleted ${ws.name}`);
                    navigate('/');
                  }
                },
              },
            ]}
          />
        </div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', paddingLeft: 42 }}>
          {picking && (
            <ColorSwatches
              value={ws.color}
              onChange={(color) => {
                void update({ color });
                setPicking(false);
              }}
            />
          )}
          {ws.isProtected && (
            <span className="pill accent">
              <Shield style={{ width: 11, height: 11 }} /> Protected
            </span>
          )}
        </div>
      </div>

      <section className="tab-section">
        {archived.length > 0 && (
          <div className="section-head">
            <span className="name" style={{ cursor: 'default' }}>
              Open
            </span>
            <span className="count">{open.length}</span>
          </div>
        )}
        <div className="card">
          <TabList
            records={open}
            groups={workspaces}
            windows={windows}
            showWindow={windows.length > 1}
            onSimilar={openRelated}
            empty={{ title: 'No open tabs in this group', body: 'Drag tabs onto the group in the sidebar, or use “Move to group” on any tab.' }}
          />
        </div>
      </section>

      {archived.length > 0 && (
        <section className="tab-section">
          <div className="section-head">
            <span className="name" style={{ cursor: 'default' }}>
              Archived
            </span>
            <span className="count">{archived.length}</span>
            <div className="spacer" />
            <button className="btn sm" onClick={() => fb.run(() => rpc('workspaces.restore', { id: ws.id }), (r) => `Reopened ${plural(r.count, 'tab')} in a new window`)}>
              <ArchiveRestore /> Reopen all
            </button>
          </div>
          <div className="card">
            <TabList records={archived} groups={workspaces} onSimilar={openRelated} />
          </div>
        </section>
      )}
    </>
  );
}
