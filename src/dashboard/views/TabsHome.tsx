import { Archive, ArrowRight, ChevronDown, Combine, Eye, Layers, Moon, MoreHorizontal, Pencil, Save, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { rpc } from '../../shared/messages';
import type { TabRecord, Workspace } from '../../shared/types';
import { EmptyState, Menu, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { navigate } from '../../ui/hooks';
import { TabList } from '../../ui/TabList';
import { isLive, useData } from '../data';

const COLLAPSE_KEY = 'tabos:collapsed';

function useCollapsed(): [Set<string>, (id: string) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setSet((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n]));
      } catch {
        /* storage blocked: collapse still works for this session */
      }
      return n;
    });
  return [set, toggle];
}

export function TabsHome({ firstRun, by, onlyOther }: { firstRun: boolean; by: 'group' | 'window'; onlyOther: boolean }) {
  const { records, workspaces, windows, openRelated } = useData();
  const live = useMemo(() => records.filter(isLive).sort((a, b) => (a.windowId ?? 0) - (b.windowId ?? 0) || a.index - b.index), [records]);
  const sleeping = live.filter((r) => r.status === 'sleeping').length;
  const [tidyCount, setTidyCount] = useState<number | null>(null);
  useEffect(() => {
    rpc('clean.preview', {})
      .then((p) => setTidyCount(p.sleep.length + p.archive.length + p.duplicates.reduce((n, g) => n + g.recordIds.length - 1, 0)))
      .catch(() => setTidyCount(null));
  }, [live.length]);

  const summary = [
    plural(live.length, 'tab'),
    windows.length > 1 ? plural(windows.length, 'window') : '',
    sleeping ? `${sleeping} asleep to save memory` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  if (onlyOther) {
    const other = live.filter((r) => !r.workspaceId);
    return (
      <>
        <div className="page-intro">
          <p className="lede">{plural(other.length, 'tab')} not in a group. Drag them onto a group in the sidebar, or use Group Tabs.</p>
        </div>
        <div className="list-card">
          <TabList records={other} groups={workspaces} windows={windows} onSimilar={openRelated} empty={{ title: 'Every tab is in a group', icon: Layers }} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-intro">
        <p className="lede">{summary}</p>
        <div className="segmented" role="group" aria-label="Arrange by">
          <button aria-pressed={by === 'group'} onClick={() => navigate('/')}>
            Groups
          </button>
          <button aria-pressed={by === 'window'} onClick={() => navigate('/?by=window')}>
            Windows
          </button>
        </div>
      </div>

      <Suggestion firstRun={firstRun} hasGroups={workspaces.length > 0} liveCount={live.length} tidyCount={tidyCount} />

      {!live.length ? (
        <div className="list-card">
          <EmptyState icon={Layers} title="No open tabs">
            Tabs you open in any Chrome window appear here.
          </EmptyState>
        </div>
      ) : by === 'window' ? (
        <ByWindow tabs={live} />
      ) : (
        <ByGroup tabs={live} />
      )}
    </>
  );
}

function Suggestion({ firstRun, hasGroups, liveCount, tidyCount }: { firstRun: boolean; hasGroups: boolean; liveCount: number; tidyCount: number | null }) {
  if (firstRun || (!hasGroups && liveCount >= 6)) {
    return (
      <div className="banner">
        <Wand2 />
        <div className="grow">
          <div style={{ fontWeight: 550 }}>{firstRun ? 'Welcome to TabOS' : 'Sort your tabs in one click'}</div>
          <div className="desc">
            {firstRun ? 'TabOS already sees every tab in every window, and lets idle tabs sleep to save memory. Nothing closes without asking you. ' : ''}
            Group Tabs suggests groups you can review before anything changes.
          </div>
        </div>
        <button className="btn primary" onClick={() => navigate('/group-tabs')}>
          Group Tabs
        </button>
      </div>
    );
  }
  if (tidyCount && tidyCount >= 5) {
    return (
      <div className="banner">
        <Sparkles />
        <div className="grow">{plural(tidyCount, 'tab')} could be tidied up to free memory.</div>
        <button className="btn" onClick={() => navigate('/tidy')}>
          Review <ArrowRight />
        </button>
      </div>
    );
  }
  return null;
}

function Section({ id, head, actions, count, collapsed, onToggle, children }: { id: string; head: ReactNode; actions?: ReactNode; count: number; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="list-section" aria-labelledby={`sec-${id}`}>
      <div className={`group-head ${collapsed ? 'collapsed' : ''}`}>
        <button className="toggle-btn" id={`sec-${id}`} aria-expanded={!collapsed} onClick={onToggle}>
          <ChevronDown className="chev" />
          {head}
          <span className="count">{count}</span>
        </button>
        <div className="spacer" />
        {actions}
      </div>
      {!collapsed && <div className="section-body">{children}</div>}
    </section>
  );
}

function ByGroup({ tabs }: { tabs: TabRecord[] }) {
  const { workspaces, windows, openRelated } = useData();
  const [collapsed, toggle] = useCollapsed();
  const sections = useMemo(() => {
    const map = new Map<string | null, TabRecord[]>();
    for (const r of tabs) map.set(r.workspaceId, [...(map.get(r.workspaceId) ?? []), r]);
    const out: Array<{ group: Workspace | null; tabs: TabRecord[] }> = [];
    for (const w of workspaces) if (map.get(w.id)?.length) out.push({ group: w, tabs: map.get(w.id)! });
    if (map.get(null)?.length) out.push({ group: null, tabs: map.get(null)! });
    return out;
  }, [tabs, workspaces]);
  return (
    <div className="list-card">
      {sections.map((s) => {
        const id = s.group?.id ?? 'other';
        return (
          <Section
            key={id}
            id={id}
            count={s.tabs.length}
            collapsed={collapsed.has(id)}
            onToggle={() => toggle(id)}
            head={
              <>
                {s.group && <WsDot color={s.group.color} />}
                <span className="ellipsis">{s.group?.name ?? 'Other Tabs'}</span>
              </>
            }
            actions={s.group && <GroupActions group={s.group} tabs={s.tabs} />}
          >
            <TabList records={s.tabs} groups={workspaces} windows={windows} showWindow={windows.length > 1} onSimilar={openRelated} />
          </Section>
        );
      })}
    </div>
  );
}

export function GroupActions({ group, tabs }: { group: Workspace; tabs: TabRecord[] }) {
  const fb = useFeedback();
  return (
    <div className="actions">
      <button className="btn quiet sm" onClick={() => fb.run(() => rpc('workspaces.switch', { id: group.id }), () => `Showing ${group.name}`)}>
        <Eye /> Show
      </button>
      <Menu
        trigger={(t) => (
          <button className="btn quiet icon sm" aria-label={`${group.name} options`} onClick={t}>
            <MoreHorizontal />
          </button>
        )}
        items={[
          { label: 'Open group page', icon: ArrowRight, onClick: () => navigate(`/group/${group.id}`) },
          {
            label: 'Rename…',
            icon: Pencil,
            onClick: async () => {
              const name = await fb.prompt({ title: 'Rename group', initial: group.name, confirmLabel: 'Rename' });
              if (name && name !== group.name) await fb.run(() => rpc('workspaces.update', { id: group.id, patch: { name } }).then(() => ({ count: 1, skipped: [], activityId: null })), () => 'Renamed');
            },
          },
          { label: 'Sleep all', icon: Moon, onClick: () => fb.run(() => rpc('tabs.sleep', { recordIds: tabs.map((t) => t.id) }), (r) => `${plural(r.count, 'tab')} asleep`) },
          {
            label: 'Archive all',
            icon: Archive,
            onClick: () => fb.run(() => rpc('tabs.archive', { recordIds: tabs.map((t) => t.id) }), (r) => `Archived ${plural(r.count, 'tab')}`),
          },
          { divider: true, label: '' },
          {
            label: 'Delete group',
            icon: Trash2,
            danger: true,
            onClick: () => fb.run(() => rpc('workspaces.delete', { id: group.id }), () => `Deleted ${group.name}. Tabs stay open`),
          },
        ]}
      />
    </div>
  );
}

function ByWindow({ tabs }: { tabs: TabRecord[] }) {
  const { workspaces, windows, openRelated } = useData();
  const fb = useFeedback();
  const [collapsed, toggle] = useCollapsed();
  return (
    <div className="list-card">
      {windows.map((w, i) => {
        const list = tabs.filter((t) => t.windowId === w.id);
        if (!list.length) return null;
        const label = `Window ${i + 1}`;
        const id = `win-${w.id}`;
        return (
          <Section
            key={id}
            id={id}
            count={list.length}
            collapsed={collapsed.has(id)}
            onToggle={() => toggle(id)}
            head={
              <>
                <span>{label}</span>
                {w.focused && <span className="pill">This window</span>}
              </>
            }
            actions={
              <div className="actions">
                <button className="btn quiet sm" onClick={() => fb.run(() => rpc('windows.focus', { windowId: w.id! }))}>
                  <Eye /> Show
                </button>
                <Menu
                  trigger={(t) => (
                    <button className="btn quiet icon sm" aria-label={`${label} options`} onClick={t}>
                      <MoreHorizontal />
                    </button>
                  )}
                  items={[
                    ...(windows.length > 1
                      ? [
                          {
                            label: 'Merge all windows here',
                            icon: Combine,
                            onClick: async () => {
                              // The one window action that can't be undone, so it asks first.
                              if (await fb.confirm({ title: `Merge all windows into ${label}?`, body: 'Every tab moves into this window. Groups move together.', confirmLabel: 'Merge' }))
                                await fb.run(() => rpc('windows.merge', { targetWindowId: w.id! }), (r) => `Moved ${plural(r.count, 'tab')}`);
                            },
                          },
                        ]
                      : []),
                    { label: 'Sleep idle tabs', icon: Moon, onClick: () => fb.run(() => rpc('tabs.sleepOthers', { windowId: w.id! }), (r) => `${plural(r.count, 'tab')} asleep`) },
                    {
                      label: 'Save as session',
                      icon: Save,
                      onClick: () =>
                        fb.run(async () => {
                          const s = await rpc('snapshots.create', { scope: { kind: 'window', windowId: w.id! } });
                          return { count: s.tabCount, skipped: [], activityId: null };
                        }, (r) => `Saved ${plural(r.count, 'tab')} to History`),
                    },
                    { label: 'Archive window', icon: Archive, onClick: () => fb.run(() => rpc('tabs.archive', { recordIds: list.map((t) => t.id) }), (r) => `Archived ${plural(r.count, 'tab')}`) },
                  ]}
                />
              </div>
            }
          >
            <TabList records={list} groups={workspaces} windows={windows} showGroup onSimilar={openRelated} />
          </Section>
        );
      })}
    </div>
  );
}
