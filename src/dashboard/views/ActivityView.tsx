import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, Undo2 } from 'lucide-react';
import { useMemo } from 'react';
import { db } from '../../shared/db';
import { rpc } from '../../shared/messages';
import { EmptyState, LoadingRows } from '../../ui/components';
import { useFeedback } from '../../ui/feedback';
import { dateTime, dayLabel } from '../../ui/format';

/** Undo history: every action TabOS took, manual or automatic. */
export function ActivityView() {
  const entries = useLiveQuery(() => db.activity.orderBy('at').reverse().limit(200).toArray(), []);
  const fb = useFeedback();
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof entries>>();
    for (const e of entries ?? []) {
      const k = dayLabel(e.at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [entries]);
  if (!entries) return <LoadingRows />;
  if (!entries.length)
    return (
      <div className="card">
        <EmptyState icon={Activity} title="No activity yet">
          Everything TabOS does (when you act and when it acts on a schedule) is listed here with an Undo.
        </EmptyState>
      </div>
    );
  return (
    <>
      {groups.map(([day, list]) => (
        <section key={day} className="col" style={{ gap: 6 }}>
          <h3 className="muted">{day}</h3>
          <div className="card panel-list">
            {list.map((e) => (
              <div className="item" key={e.id}>
                <span className="grow ellipsis">{e.label}</span>
                <span className="faint nowrap tnum">{dateTime(e.at)}</span>
                {e.undoneAt ? (
                  <span className="pill">Undone</span>
                ) : e.undo ? (
                  <button className="btn sm" onClick={() => fb.run(() => rpc('activity.undo', { id: e.id }), (r) => r.message ?? 'Undone')}>
                    <Undo2 /> Undo
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
