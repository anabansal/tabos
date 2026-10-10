import { Archive, ArchiveRestore } from 'lucide-react';
import { useMemo } from 'react';
import { indexDoc, quickSearch } from '../../core/search';
import { rpc } from '../../shared/messages';
import type { TabRecord, Workspace } from '../../shared/types';
import { EmptyState, WsDot } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { plural } from '../../ui/format';
import { TabList, sortRecent } from '../../ui/TabList';
import { useData } from '../data';

export function ArchiveView() {
  const { records, workspaces, query, openRelated } = useData();
  const fb = useFeedback();
  const archived = useMemo(() => {
    const list = records.filter((r) => r.status === 'archived');
    return query.trim() ? quickSearch(list.map(indexDoc), query, 2000).map((h) => h.doc) : sortRecent(list);
  }, [records, query]);
  const sections = useMemo(() => {
    const map = new Map<string | null, TabRecord[]>();
    for (const r of archived) map.set(r.workspaceId, [...(map.get(r.workspaceId) ?? []), r]);
    const out: Array<{ group: Workspace | null; tabs: TabRecord[] }> = [];
    for (const w of workspaces) if (map.get(w.id)?.length) out.push({ group: w, tabs: map.get(w.id)! });
    if (map.get(null)?.length) out.push({ group: null, tabs: map.get(null)! });
    return out;
  }, [archived, workspaces]);

  const reopen = async (tabs: TabRecord[]) => {
    if (tabs.length > 10 && !(await fb.confirm({ title: `Reopen ${plural(tabs.length, 'tab')}?`, body: 'They open in a new window. Only the first loads right away; the rest load when you click them.', confirmLabel: 'Reopen' })))
      return;
    await fb.run(() => rpc('tabs.open', { recordIds: tabs.map((t) => t.id), target: tabs.length > 1 ? 'new-window' : 'auto', focus: true }), (r) => `Reopened ${plural(r.count, 'tab')}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Archive</h1>
          <div className="subtitle">Tabs you closed but kept. Reopen them any time. Nothing here is deleted unless you delete it.</div>
        </div>
      </div>
      {!archived.length ? (
        <div className="card">
          <EmptyState icon={Archive} title={query ? `Nothing archived matches “${query}”` : 'Nothing archived yet'}>
            Archive a tab to close it without losing it. Hover a tab and press the box icon, or let Tidy Up suggest some.
          </EmptyState>
        </div>
      ) : (
        sections.map((s) => (
          <section key={s.group?.id ?? 'other'} className="tab-section">
            <div className="section-head">
              {s.group && <WsDot color={s.group.color} />}
              <span className="name" style={{ cursor: 'default' }}>
                {s.group?.name ?? 'Not in a group'}
              </span>
              <span className="count">{s.tabs.length}</span>
              <div className="spacer" />
              <div className="actions" style={{ opacity: 1 }}>
                <button className="btn sm" onClick={() => reopen(s.tabs)}>
                  <ArchiveRestore /> Reopen all
                </button>
              </div>
            </div>
            <div className="card">
              <TabList records={s.tabs} groups={workspaces} onSimilar={openRelated} />
            </div>
          </section>
        ))
      )}
    </>
  );
}
