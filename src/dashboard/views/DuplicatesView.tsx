import { Copy, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { findDuplicateGroups } from '../../core/duplicates';
import { rpc } from '../../shared/messages';
import { displayUrl } from '../../shared/url';
import { EmptyState, Favicon, StatusPill, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { ago, plural } from '../../ui/format';
import { windowLabels } from '../../ui/TabTable';
import { useData } from '../data';

export function DuplicatesView() {
  const { records, wsMap, windows } = useData();
  const fb = useFeedback();
  const groups = useMemo(() => findDuplicateGroups(records), [records]);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const labels = useMemo(() => windowLabels(windows), [windows]);
  // Which copy to keep, per group (defaults to TabOS's pick).
  const [keep, setKeep] = useState<Record<string, string>>({});
  useEffect(() => {
    setKeep((k) => {
      const next: Record<string, string> = {};
      for (const g of groups) next[g.normalizedUrl] = k[g.normalizedUrl] && g.recordIds.includes(k[g.normalizedUrl]) ? k[g.normalizedUrl] : g.keepRecordId;
      return next;
    });
  }, [groups]);

  const plan = groups.map((g) => {
    const keepId = keep[g.normalizedUrl] ?? g.keepRecordId;
    return { keepRecordId: keepId, closeRecordIds: g.recordIds.filter((id) => id !== keepId) };
  });
  const extras = plan.reduce((n, p) => n + p.closeRecordIds.length, 0);

  const closeAll = async () => {
    const tabs = plan.flatMap((p) => p.closeRecordIds.map((id) => byId.get(id)!)).filter(Boolean);
    if (await fb.confirm({ title: `Close ${plural(extras, 'duplicate tab')}?`, body: 'One copy of each page stays open. Closed copies go to Recently closed, and you can undo.', tabs, confirmLabel: 'Close duplicates' }))
      await fb.run(() => rpc('duplicates.close', { groups: plan }), (r) => `Closed ${plural(r.count, 'duplicate')}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Duplicates</h1>
          <div className="sub">Open tabs pointing at the same page (ignoring tracking parameters and #anchors).</div>
        </div>
        <div className="spacer" />
        {extras > 0 && (
          <button className="btn primary" onClick={closeAll}>
            Close {plural(extras, 'duplicate')}
          </button>
        )}
      </div>
      {!groups.length ? (
        <div className="card">
          <EmptyState icon={Check} title="No duplicates">
            Every open tab points at a different page.
          </EmptyState>
        </div>
      ) : (
        groups.map((g, gi) => {
          const p = plan[gi];
          const first = byId.get(g.recordIds[0]);
          return (
            <section key={g.normalizedUrl} className="card">
              <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                <Copy style={{ width: 15, height: 15, color: 'var(--text-3)' }} />
                <span className="ellipsis grow" style={{ fontWeight: 600 }}>
                  {first?.title}
                </span>
                <span className="faint">{plural(g.recordIds.length, 'copy', 'copies')}</span>
                <button className="btn sm" onClick={() => fb.run(() => rpc('duplicates.close', { groups: [p] }), (r) => `Closed ${plural(r.count, 'copy', 'copies')}`)}>
                  Close {p.closeRecordIds.length} extra
                </button>
              </div>
              <div role="radiogroup" aria-label="Copy to keep">
                {g.recordIds.map((id) => {
                  const r = byId.get(id);
                  if (!r) return null;
                  const ws = r.workspaceId ? wsMap.get(r.workspaceId) : undefined;
                  return (
                    <label key={id} className="tab-row" style={{ gridTemplateColumns: '22px 18px minmax(0,1fr) auto', cursor: 'pointer' }}>
                      <input type="radio" name={g.normalizedUrl} checked={p.keepRecordId === id} onChange={() => setKeep((k) => ({ ...k, [g.normalizedUrl]: id }))} style={{ accentColor: 'var(--accent)' }} />
                      <Favicon url={r.url} />
                      <div className="col" style={{ gap: 1 }}>
                        <span className="ellipsis">{displayUrl(r.url)}</span>
                        <span className="sub">
                          {r.windowId != null ? labels.get(r.windowId) : ''}
                          {ws && (
                            <>
                              {' · '}
                              <WsDot color={ws.color} size={7} /> {ws.name}
                            </>
                          )}
                          {r.active ? ' · visible' : ''}
                        </span>
                      </div>
                      <div className="meta">
                        {p.keepRecordId === id ? <span className="pill open">Keep</span> : <span className="pill">Close</span>}
                        <StatusPill status={r.status} />
                        <span className="when">{ago(r.lastActiveAt)}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
