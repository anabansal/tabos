import { Archive, ArrowRight, Combine, Eye, Moon, MoreHorizontal, Pencil, Save, Sparkles, Trash2, Wand2, Layers } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { indexDoc, quickSearch } from '../../core/search';
import { rpc } from '../../shared/messages';
import type { TabRecord, Workspace } from '../../shared/types';
import { Banner, EmptyState, Menu, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { navigate } from '../../ui/hooks';
import { TabList } from '../../ui/TabList';
import { isLive, useData } from '../data';

function useFiltered(records: TabRecord[], query: string): TabRecord[] {
  return useMemo(() => {
    if (!query.trim()) return [...records].sort((a, b) => a.windowId! - b.windowId! || a.index - b.index);
    return quickSearch(records.map(indexDoc), query, 2000).map((h) => h.doc);
  }, [records, query]);
}

export function TabsHome({ firstRun, by, onlyOther }: { firstRun: boolean; by: 'group' | 'window'; onlyOther: boolean }) {
  const { records, workspaces, windows, query, openRelated } = useData();
  const live = useMemo(() => records.filter(isLive), [records]);
  const shown = useFiltered(live, query);
  const sleeping = live.filter((r) => r.status === 'sleeping').length;
  const [tidyCount, setTidyCount] = useState<number | null>(null);
  useEffect(() => {
    rpc('clean.preview', {})
      .then((p) => setTidyCount(p.sleep.length + p.archive.length + p.duplicates.reduce((n, g) => n + g.recordIds.length - 1, 0)))
      .catch(() => setTidyCount(null));
  }, [live.length]);

  const setBy = (b: 'group' | 'window') => navigate(b === 'window' ? '/?by=window' : '/');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{onlyOther ? 'Other tabs' : 'Tabs'}</h1>
          <div className="subtitle">
            {plural(live.length, 'open tab')}
            {windows.length > 1 ? ` in ${plural(windows.length, 'window')}` : ''}
            {sleeping > 0 ? ` · ${sleeping} sleeping to save memory` : ''}
          </div>
        </div>
        <div className="spacer" />
        {!onlyOther && (
          <div className="segmented" role="group" aria-label="Show tabs by">
            <button aria-pressed={by === 'group'} onClick={() => setBy('group')}>
              Groups
            </button>
            <button aria-pressed={by === 'window'} onClick={() => setBy('window')}>
              Windows
            </button>
          </div>
        )}
      </div>

      <Suggestion firstRun={firstRun} hasGroups={workspaces.length > 0} liveCount={live.length} tidyCount={tidyCount} />

      {!live.length ? (
        <div className="card">
          <EmptyState icon={Layers} title="No open tabs">
            Tabs you open in any Chrome window show up here.
          </EmptyState>
        </div>
      ) : !shown.length ? (
        <div className="card">
          <EmptyState title={`Nothing matches “${query}”`}>Press Enter to search in your own words, including archived and closed tabs.</EmptyState>
        </div>
      ) : onlyOther ? (
        <div className="card">
          <TabList records={shown.filter((r) => !r.workspaceId)} groups={workspaces} windows={windows} onSimilar={openRelated} empty={{ title: 'Every tab is in a group' }} />
        </div>
      ) : by === 'window' ? (
        <ByWindow tabs={shown} />
      ) : (
        <ByGroup tabs={shown} />
      )}
    </>
  );
}

function Suggestion({ firstRun, hasGroups, liveCount, tidyCount }: { firstRun: boolean; hasGroups: boolean; liveCount: number; tidyCount: number | null }) {
  if (firstRun || (!hasGroups && liveCount >= 6)) {
    return (
      <Banner kind="info" icon={Sparkles}>
        <div className="row" style={{ alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="grow">
            <strong>{firstRun ? 'Welcome to TabOS.' : 'Put your tabs in order.'}</strong>{' '}
            {firstRun
              ? 'It already sees every tab in every window, and tabs you leave alone fall asleep to save memory. Nothing is closed without asking you. '
              : ''}
            Let TabOS sort your tabs into groups in one click.
          </div>
          <button className="btn primary" onClick={() => navigate('/group-tabs')}>
            <Wand2 /> Group Tabs
          </button>
        </div>
      </Banner>
    );
  }
  if (tidyCount && tidyCount >= 5) {
    return (
      <Banner kind="info" icon={Sparkles}>
        <div className="row" style={{ alignItems: 'center', gap: 14 }}>
          <div className="grow">{plural(tidyCount, 'tab')} could be tidied up to free memory and clutter.</div>
          <button className="btn" onClick={() => navigate('/tidy')}>
            Review <ArrowRight />
          </button>
        </div>
      </Banner>
    );
  }
  return null;
}

function ByGroup({ tabs }: { tabs: TabRecord[] }) {
  const { workspaces, windows, openRelated } = useData();
  const sections = useMemo(() => {
    const map = new Map<string | null, TabRecord[]>();
    for (const r of tabs) {
      const k = r.workspaceId;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    const ordered: Array<{ group: Workspace | null; tabs: TabRecord[] }> = [];
    for (const w of workspaces) if (map.get(w.id)?.length) ordered.push({ group: w, tabs: map.get(w.id)! });
    if (map.get(null)?.length) ordered.push({ group: null, tabs: map.get(null)! });
    return ordered;
  }, [tabs, workspaces]);
  return (
    <>
      {sections.map((s) => (
        <section key={s.group?.id ?? 'other'} className="tab-section">
          <div className="section-head">
            {s.group ? <WsDot color={s.group.color} /> : null}
            <span className="name" onClick={() => navigate(s.group ? `/group/${s.group.id}` : '/?group=none')}>
              {s.group?.name ?? 'Other tabs'}
            </span>
            <span className="count">{s.tabs.length}</span>
            <div className="spacer" />
            {s.group && <GroupActions group={s.group} tabs={s.tabs} />}
          </div>
          <div className="card">
            <TabList records={s.tabs} groups={workspaces} windows={windows} showWindow={windows.length > 1} onSimilar={openRelated} />
          </div>
        </section>
      ))}
    </>
  );
}

export function GroupActions({ group, tabs }: { group: Workspace; tabs: TabRecord[] }) {
  const fb = useFeedback();
  return (
    <div className="actions">
      <button className="btn sm" onClick={() => fb.run(() => rpc('workspaces.switch', { id: group.id }), () => `Showing ${group.name}`)}>
        <Eye /> Show
      </button>
      <Menu
        trigger={(t) => (
          <button className="btn ghost icon sm" aria-label={`${group.name} options`} onClick={t}>
            <MoreHorizontal />
          </button>
        )}
        items={[
          {
            label: 'Rename…',
            icon: Pencil,
            onClick: async () => {
              const name = await fb.prompt({ title: 'Rename group', initial: group.name, confirmLabel: 'Rename' });
              if (name && name !== group.name) await fb.run(() => rpc('workspaces.update', { id: group.id, patch: { name } }).then(() => ({ count: 1, skipped: [], activityId: null })), () => 'Renamed');
            },
          },
          { label: 'Sleep all', icon: Moon, onClick: () => fb.run(() => rpc('tabs.sleep', { recordIds: tabs.map((t) => t.id) }), (r) => `${plural(r.count, 'tab')} sleeping`) },
          {
            label: 'Archive all',
            icon: Archive,
            onClick: async () => {
              if (await fb.confirm({ title: `Archive the ${plural(tabs.length, 'tab')} in ${group.name}?`, body: 'They close and wait in Archive, still in this group.', tabs, confirmLabel: 'Archive' }))
                await fb.run(() => rpc('tabs.archive', { recordIds: tabs.map((t) => t.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
            },
          },
          { divider: true, label: '' },
          {
            label: 'Delete group',
            icon: Trash2,
            danger: true,
            onClick: async () => {
              if (await fb.confirm({ title: `Delete “${group.name}”?`, body: 'The tabs stay open; only the group goes away. You can undo.', confirmLabel: 'Delete group', danger: true }))
                await fb.run(() => rpc('workspaces.delete', { id: group.id }), () => `Deleted ${group.name}`);
            },
          },
        ]}
      />
    </div>
  );
}

function ByWindow({ tabs }: { tabs: TabRecord[] }) {
  const { workspaces, windows, openRelated } = useData();
  const fb = useFeedback();
  return (
    <>
      {windows.map((w, i) => {
        const list = tabs.filter((t) => t.windowId === w.id);
        if (!list.length) return null;
        const label = `Window ${i + 1}`;
        return (
          <section key={w.id} className="tab-section">
            <div className="section-head">
              <span className="name" onClick={() => fb.run(() => rpc('windows.focus', { windowId: w.id! }))}>
                {label}
              </span>
              {w.focused && <span className="pill accent">This window</span>}
              <span className="count">{list.length}</span>
              <div className="spacer" />
              <div className="actions">
                {windows.length > 1 && (
                  <button
                    className="btn sm"
                    onClick={async () => {
                      if (await fb.confirm({ title: `Move every tab into ${label}?`, body: 'All your windows become one. Groups move together.', confirmLabel: 'Merge windows' }))
                        await fb.run(() => rpc('windows.merge', { targetWindowId: w.id! }), (r) => `Moved ${plural(r.count, 'tab')}`);
                    }}
                  >
                    <Combine /> Merge here
                  </button>
                )}
                <Menu
                  trigger={(t) => (
                    <button className="btn ghost icon sm" aria-label={`${label} options`} onClick={t}>
                      <MoreHorizontal />
                    </button>
                  )}
                  items={[
                    { label: 'Go to window', icon: Eye, onClick: () => fb.run(() => rpc('windows.focus', { windowId: w.id! })) },
                    { label: 'Sleep idle tabs', icon: Moon, onClick: () => fb.run(() => rpc('tabs.sleepOthers', { windowId: w.id! }), (r) => `${plural(r.count, 'tab')} sleeping`) },
                    {
                      label: 'Save as session',
                      icon: Save,
                      onClick: () =>
                        fb.run(async () => {
                          const s = await rpc('snapshots.create', { scope: { kind: 'window', windowId: w.id! } });
                          return { count: s.tabCount, skipped: [], activityId: null };
                        }, (r) => `Saved ${plural(r.count, 'tab')} to History`),
                    },
                    {
                      label: 'Archive window',
                      icon: Archive,
                      onClick: async () => {
                        if (await fb.confirm({ title: `Archive all ${plural(list.length, 'tab')} in ${label}?`, body: 'The window closes and its tabs wait in Archive.', tabs: list, confirmLabel: 'Archive' }))
                          await fb.run(() => rpc('tabs.archive', { recordIds: list.map((t) => t.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
                      },
                    },
                  ]}
                />
              </div>
            </div>
            <div className="card">
              <TabList records={list} groups={workspaces} windows={windows} showGroup onSimilar={openRelated} />
            </div>
          </section>
        );
      })}
    </>
  );
}
