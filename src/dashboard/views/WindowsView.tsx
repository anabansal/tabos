import { AppWindow, Archive, Camera, Combine, Eye, Moon, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { rpc } from '../../shared/messages';
import { EmptyState, Favicon, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { navigate } from '../../ui/hooks';
import { isLive, useData } from '../data';

export function WindowsView() {
  const { records, windows, wsMap } = useData();
  const fb = useFeedback();
  const byWindow = useMemo(() => {
    const m = new Map<number, typeof records>();
    for (const r of records) {
      if (!isLive(r) || r.windowId == null) continue;
      const list = m.get(r.windowId) ?? [];
      list.push(r);
      m.set(r.windowId, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.index - b.index);
    return m;
  }, [records]);
  const total = [...byWindow.values()].reduce((n, l) => n + l.length, 0);

  const merge = async (targetId: number, label: string) => {
    if (await fb.confirm({ title: `Merge all windows into ${label}?`, body: `${plural(total, 'tab')} from ${plural(windows.length, 'window')} will move into one window. Tab groups move intact.`, confirmLabel: 'Merge windows' }))
      await fb.run(() => rpc('windows.merge', { targetWindowId: targetId }), (r) => `Moved ${plural(r.count, 'tab')}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Windows</h1>
          <div className="sub">
            {plural(total, 'tab')} across {plural(windows.length, 'window')}. Incognito windows are never tracked.
          </div>
        </div>
      </div>
      {!windows.length ? (
        <div className="card">
          <EmptyState icon={AppWindow} title="No browser windows" />
        </div>
      ) : (
        <div className="ws-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {windows.map((w, i) => {
            const tabs = byWindow.get(w.id!) ?? [];
            const label = `Window ${i + 1}`;
            const sleeping = tabs.filter((t) => t.status === 'sleeping').length;
            const wsCounts = new Map<string, number>();
            for (const t of tabs) if (t.workspaceId) wsCounts.set(t.workspaceId, (wsCounts.get(t.workspaceId) ?? 0) + 1);
            return (
              <div className="card ws-card" key={w.id}>
                <div className="row">
                  <span className="name">{label}</span>
                  {w.focused && <span className="pill accent">Current</span>}
                  {w.state === 'minimized' && <span className="pill">Minimized</span>}
                  <div className="spacer" />
                  <span className="faint tnum">
                    {plural(tabs.length, 'tab')} · {sleeping} asleep
                  </span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {[...wsCounts.entries()].slice(0, 4).map(([id, n]) => (
                    <span key={id} className="pill">
                      <WsDot color={wsMap.get(id)?.color} size={7} /> {wsMap.get(id)?.name ?? 'Workspace'} {n}
                    </span>
                  ))}
                </div>
                <div className="favs" style={{ flexWrap: 'wrap', gap: 5, minHeight: 18 }}>
                  {tabs.slice(0, 40).map((t) => (
                    <span key={t.id} title={t.title} style={{ opacity: t.status === 'sleeping' ? 0.45 : 1 }}>
                      <Favicon url={t.url} />
                    </span>
                  ))}
                  {tabs.length > 40 && <span className="faint">+{tabs.length - 40}</span>}
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <button className="btn sm" onClick={() => fb.run(() => rpc('windows.focus', { windowId: w.id! }))}>
                    <Eye /> Focus
                  </button>
                  <button className="btn sm" onClick={() => navigate(`/tabs?window=${w.id}`)}>
                    Tabs <ArrowRight />
                  </button>
                  <button className="btn sm" title="Sleep every inactive tab in this window" onClick={() => fb.run(() => rpc('tabs.sleepOthers', { windowId: w.id! }), (r) => `Put ${plural(r.count, 'tab')} to sleep`)}>
                    <Moon /> Sleep inactive
                  </button>
                  <button
                    className="btn sm"
                    onClick={() =>
                      fb.run(async () => {
                        const s = await rpc('snapshots.create', { scope: { kind: 'window', windowId: w.id! } });
                        return { count: s.tabCount, skipped: [], activityId: null };
                      }, (r) => `Saved snapshot of ${plural(r.count, 'tab')}`)
                    }
                  >
                    <Camera /> Snapshot
                  </button>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      if (await fb.confirm({ title: `Archive all ${plural(tabs.length, 'tab')} in ${label}?`, body: 'The window closes; every tab is saved under Archived with its position. Protected tabs stay.', tabs, confirmLabel: 'Archive window' }))
                        await fb.run(() => rpc('tabs.archive', { recordIds: tabs.map((t) => t.id) }), (r) => `Archived ${plural(r.count, 'tab')}`);
                    }}
                  >
                    <Archive /> Archive
                  </button>
                  {windows.length > 1 && (
                    <button className="btn sm" onClick={() => merge(w.id!, label)}>
                      <Combine /> Merge here
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
