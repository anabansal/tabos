import { Archive, Check, ChevronRight, Copy, Moon, Sparkles, AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { rpc, type CleanResult } from '../../shared/messages';
import type { CleanCandidate, CleanPreview, TabRecord } from '../../shared/types';
import { Banner, EmptyState, Favicon, LoadingRows, Toggle } from '../../ui/components';
import { errorMessage, useFeedback } from '../../ui/feedback';
import { bytes, plural } from '../../ui/format';
import { navigate } from '../../ui/hooks';
import { useData } from '../data';

type Kind = 'sleep' | 'archive' | 'close';

export function TidyView() {
  const { records, settings } = useData();
  const fb = useFeedback();
  const [sleepAfter, setSleepAfter] = useState(settings.sleep.afterMinutes);
  const [archiveAfter, setArchiveAfter] = useState(settings.archive.suggestAfterDays);
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<Kind, Set<string>>>({ sleep: new Set(), archive: new Set(), close: new Set() });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<(CleanResult & { delta: number | null }) | null>(null);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = await rpc('clean.preview', { sleepAfterMinutes: sleepAfter, archiveAfterDays: archiveAfter });
      setPreview(p);
      const archive = new Set(p.archive.map((c) => c.recordId));
      setSel({
        archive,
        sleep: new Set(p.sleep.map((c) => c.recordId).filter((id) => !archive.has(id))),
        close: new Set(p.duplicates.flatMap((g) => g.recordIds.filter((id) => id !== g.keepRecordId))),
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [sleepAfter, archiveAfter]);
  useEffect(() => {
    void load();
  }, [load]);

  const dupCandidates: CleanCandidate[] = useMemo(
    () => (preview?.duplicates ?? []).flatMap((g) => g.recordIds.filter((id) => id !== g.keepRecordId).map((id) => ({ recordId: id, reasons: ['Another copy stays open'], score: 1 }))),
    [preview],
  );
  const total = sel.sleep.size + sel.archive.size + sel.close.size;

  const run = async () => {
    setRunning(true);
    try {
      const r = await rpc('clean.execute', { sleep: [...sel.sleep], archive: [...sel.archive], close: [...sel.close] });
      let delta: number | null = null;
      if (r.memoryBefore) {
        await new Promise((res) => setTimeout(res, 3000));
        const after = await chrome.system.memory.getInfo().catch(() => null);
        if (after) delta = after.availableCapacity - r.memoryBefore.availableBytes;
      }
      setResult({ ...r, delta });
    } catch (err) {
      fb.error(err);
    } finally {
      setRunning(false);
    }
  };

  if (result) {
    return (
      <>
        <Header />
        <div className="card card-pad col" style={{ gap: 14, alignItems: 'center', textAlign: 'center', padding: '36px 24px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--ok-soft)', display: 'grid', placeItems: 'center' }}>
            <Check style={{ width: 26, height: 26, color: 'var(--st-open)' }} />
          </div>
          <h2>All tidy</h2>
          <div className="muted">
            {[result.slept && `${plural(result.slept, 'tab')} asleep`, result.archived && `${result.archived} archived`, result.closed && `${plural(result.closed, 'duplicate')} closed`]
              .filter(Boolean)
              .join(' · ') || 'Nothing needed changing'}
          </div>
          {result.delta != null && (
            <div className="faint small" style={{ maxWidth: 420 }}>
              Free memory changed by <strong className="tnum">{result.delta >= 0 ? '+' : ''}{bytes(result.delta)}</strong>, as measured by your computer. Other apps affect this too, and Chrome may free memory gradually.
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            {result.activityId && (
              <button className="btn" onClick={() => fb.run(() => rpc('activity.undo', { id: result.activityId! }), (x) => x.message ?? 'Undone').then(() => setResult(null)).then(load)}>
                Undo
              </button>
            )}
            <button className="btn primary" onClick={() => navigate('/')}>
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      {error && (
        <Banner kind="error" icon={AlertTriangle}>
          Couldn't check your tabs: {error}.{' '}
          <button className="btn sm" onClick={load}>
            Try again
          </button>
        </Banner>
      )}
      {!preview && !error ? (
        <div className="card">
          <LoadingRows rows={3} />
        </div>
      ) : preview && preview.sleep.length + preview.archive.length + dupCandidates.length === 0 ? (
        <div className="card">
          <EmptyState icon={Sparkles} title="Already tidy">
            No tab has been idle for {sleepAfter < 60 ? `${sleepAfter} minutes` : `${sleepAfter / 60} hours`}, nothing looks forgotten, and there are no duplicates.
            <div style={{ marginTop: 12 }}>
              <select className="select" value={sleepAfter} onChange={(e) => setSleepAfter(Number(e.target.value))} aria-label="Idle for">
                {[5, 15, 30, 60, 120].map((m) => (
                  <option key={m} value={m}>
                    Look at tabs idle for {m < 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            </div>
          </EmptyState>
        </div>
      ) : preview ? (
        <>
          <div className="grouped">
            <Option
              icon={Moon}
              color="var(--st-sleeping)"
              title={`Put ${plural(preview.sleep.length, 'idle tab')} to sleep`}
              emptyTitle="No idle tabs right now"
              desc={`Not used in ${sleepAfter < 60 ? `${sleepAfter} minutes` : `${sleepAfter / 60} hours`}. They stay where they are and reload when you click them.`}
              candidates={preview.sleep}
              selected={sel.sleep}
              setSelected={(s) => setSel((x) => ({ ...x, sleep: s }))}
              byId={byId}
              control={
                <select className="select" value={sleepAfter} onChange={(e) => setSleepAfter(Number(e.target.value))} aria-label="Idle for">
                  {[...new Set([5, 15, 30, 60, 120, settings.sleep.afterMinutes])].sort((a, b) => a - b).map((m) => (
                    <option key={m} value={m}>
                      Idle for {m < 60 ? `${m} min` : `${m / 60} h`}
                    </option>
                  ))}
                </select>
              }
            />
            <Option
              icon={Archive}
              color="var(--st-archived)"
              title={`Archive ${plural(preview.archive.length, 'tab')} you seem done with`}
              emptyTitle="Nothing looks forgotten"
              desc="They close and wait in Archive, still in their group."
              candidates={preview.archive}
              selected={sel.archive}
              setSelected={(s) => setSel((x) => ({ ...x, archive: s }))}
              byId={byId}
              control={
                <select className="select" value={archiveAfter} onChange={(e) => setArchiveAfter(Number(e.target.value))} aria-label="Unused for">
                  {[...new Set([1, 3, 7, 14, 30, settings.archive.suggestAfterDays])].sort((a, b) => a - b).map((d) => (
                    <option key={d} value={d}>
                      Unused for {plural(d, 'day')}
                    </option>
                  ))}
                </select>
              }
            />
            <Option
              icon={Copy}
              color="var(--text-2)"
              title={`Close ${plural(dupCandidates.length, 'duplicate')}`}
              emptyTitle="No duplicate tabs"
              desc="Pages you have open more than once. The copy you used last stays open."
              candidates={dupCandidates}
              selected={sel.close}
              setSelected={(s) => setSel((x) => ({ ...x, close: s }))}
              byId={byId}
            />
          </div>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <MemoryLine />
            <button className="btn primary lg" disabled={!total || running} onClick={run}>
              {running ? <div className="spinner" style={{ borderTopColor: '#fff' }} /> : <Sparkles />}
              {running ? 'Tidying…' : total ? `Tidy Up ${plural(total, 'Tab')}` : 'Nothing selected'}
            </button>
          </div>
          {preview.protectedCount > 0 && <span className="faint small">{plural(preview.protectedCount, 'tab')} you protected (or that are playing audio) are left alone.</span>}
        </>
      ) : null}
    </>
  );
}

function Header() {
  return (
    <div className="page-head">
      <div>
        <h1>Tidy Up</h1>
        <div className="subtitle">Free up memory and clear clutter. Nothing is lost, and you can undo it all.</div>
      </div>
    </div>
  );
}

function Option({
  icon: Icon,
  color,
  title,
  emptyTitle,
  desc,
  candidates,
  selected,
  setSelected,
  byId,
  control,
}: {
  icon: typeof Moon;
  color: string;
  title: string;
  emptyTitle: string;
  desc: string;
  candidates: CleanCandidate[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  byId: Map<string, TabRecord>;
  control?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const on = selected.size > 0;
  const empty = candidates.length === 0;
  return (
    <>
      <div className="item" style={{ opacity: empty ? 0.55 : 1 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--fill)', flex: 'none' }}>
          <Icon style={{ width: 16, height: 16, color }} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{empty ? emptyTitle : title}</div>
          <div className="desc">{desc}</div>
        </div>
        {!empty && (
          <button className="btn plain sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Review'} <ChevronRight style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.25s var(--ease)' }} />
          </button>
        )}
        <Toggle checked={on} disabled={empty} onChange={(v) => setSelected(v ? new Set(candidates.map((c) => c.recordId)) : new Set())} label={title} />
      </div>
      {open && !empty && (
        <div className="item" style={{ display: 'block', padding: '4px 16px 12px 58px' }}>
          {control && <div style={{ margin: '4px 0 8px' }}>{control}</div>}
          <div className="col" style={{ gap: 2 }}>
            {candidates.map((c) => {
              const r = byId.get(c.recordId);
              if (!r) return null;
              return (
                <label key={c.recordId} className="row" style={{ padding: '5px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    className="box"
                    checked={selected.has(c.recordId)}
                    onChange={() => {
                      const n = new Set(selected);
                      if (n.has(c.recordId)) n.delete(c.recordId);
                      else n.add(c.recordId);
                      setSelected(n);
                    }}
                  />
                  <Favicon url={r.url} size={14} />
                  <span className="ellipsis grow">{r.title}</span>
                  <span className="faint small nowrap">{c.reasons[0]}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function MemoryLine() {
  const [info, setInfo] = useState<{ capacity: number; available: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => chrome.system.memory.getInfo().then((i) => alive && setInfo({ capacity: i.capacity, available: i.availableCapacity })).catch(() => {});
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!info) return <span />;
  const used = info.capacity - info.available;
  return (
    <div className="col" style={{ gap: 6, minWidth: 240 }}>
      <div className="row small muted tnum">
        Memory in use <span className="spacer" /> {bytes(used)} of {bytes(info.capacity)}
      </div>
      <div className="mem-bar" aria-hidden>
        <div style={{ transform: `scaleX(${used / info.capacity})` }} />
      </div>
    </div>
  );
}
