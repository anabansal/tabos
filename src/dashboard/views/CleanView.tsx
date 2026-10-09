import { Archive, Brush, Check, Copy, Moon, RefreshCw, Shield } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, type CleanResult } from '../../shared/messages';
import type { CleanCandidate, CleanPreview, TabRecord } from '../../shared/types';
import { displayUrl } from '../../shared/url';
import { Banner, EmptyState, Favicon, LoadingRows, WsDot } from '../../ui/components';
import { useFeedback, errorMessage } from '../../ui/feedback';
import { bytes, plural } from '../../ui/format';
import { useData } from '../data';

const SLEEP_OPTIONS = [5, 15, 30, 60, 120, 240];
const ARCHIVE_OPTIONS = [1, 3, 7, 14, 30];

export function CleanView() {
  const { records, wsMap, settings } = useData();
  const fb = useFeedback();
  const [sleepAfter, setSleepAfter] = useState(settings.sleep.afterMinutes);
  const [archiveAfter, setArchiveAfter] = useState(settings.archive.suggestAfterDays);
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ sleep: Set<string>; archive: Set<string>; close: Set<string> }>({ sleep: new Set(), archive: new Set(), close: new Set() });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<(CleanResult & { delta: number | null }) | null>(null);
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  const load = useCallback(async () => {
    setError(null);
    setPreview(null);
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

  const toggle = (k: 'sleep' | 'archive' | 'close', id: string) =>
    setSel((s) => {
      const n = new Set(s[k]);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return { ...s, [k]: n };
    });
  const setAll = (k: 'sleep' | 'archive' | 'close', ids: string[], on: boolean) => setSel((s) => ({ ...s, [k]: on ? new Set(ids) : new Set<string>() }));

  const total = sel.sleep.size + sel.archive.size + sel.close.size;
  const execute = async () => {
    setRunning(true);
    try {
      const r = await rpc('clean.execute', { sleep: [...sel.sleep], archive: [...sel.archive], close: [...sel.close] });
      // Measure free memory a few seconds later. This is the OS's number, so other apps affect it too.
      let delta: number | null = null;
      if (r.memoryBefore) {
        await new Promise((res) => setTimeout(res, 3000));
        const after = await chrome.system.memory.getInfo().catch(() => null);
        if (after) {
          delta = after.availableCapacity - r.memoryBefore.availableBytes;
          try {
            localStorage.setItem('tabos:lastCleanDelta', JSON.stringify({ delta, at: Date.now() }));
          } catch {
            /* ignore */
          }
        }
      }
      setResult({ ...r, delta });
      if (r.activityId) fb.toast(`Cleaned ${plural(r.count, 'tab')}`, { activityId: r.activityId });
    } catch (err) {
      fb.error(err);
    } finally {
      setRunning(false);
    }
  };

  if (result) {
    return (
      <>
        <div className="page-head">
          <h1>Clean</h1>
        </div>
        <div className="card card-pad col" style={{ gap: 12, maxWidth: 640 }}>
          <div className="row">
            <Check style={{ width: 18, height: 18, color: 'var(--st-open)' }} />
            <h2>Done</h2>
          </div>
          <div className="muted">
            Slept {result.slept}, archived {result.archived}, closed {plural(result.closed, 'duplicate')}.
            {result.skipped.length > 0 && ` Skipped ${result.skipped.length} (${[...new Set(result.skipped.map((s) => s.reason.toLowerCase()))].slice(0, 2).join(', ')}).`}
          </div>
          {result.delta != null && (
            <div>
              Free system memory changed by <strong className="tnum">{result.delta >= 0 ? '+' : ''}{bytes(result.delta)}</strong> about 3 seconds later.{' '}
              <span className="faint">Measured by the OS; other apps affect it, and Chrome may release memory gradually.</span>
            </div>
          )}
          <div className="row">
            {result.activityId && (
              <button className="btn" onClick={() => fb.run(() => rpc('activity.undo', { id: result.activityId! }), (x) => x.message ?? 'Undone').then(() => setResult(null))}>
                Undo all
              </button>
            )}
            <button className="btn primary" onClick={() => { setResult(null); void load(); }}>
              Check again
            </button>
          </div>
        </div>
      </>
    );
  }

  const dupIds = preview?.duplicates.flatMap((g) => g.recordIds.filter((id) => id !== g.keepRecordId)) ?? [];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clean</h1>
          <div className="sub">Review exactly what will happen. Nothing changes until you press the button, and everything can be undone.</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={load} aria-label="Refresh preview">
          <RefreshCw /> Refresh
        </button>
      </div>
      {error && (
        <Banner kind="error" icon={Brush}>
          Couldn't build the preview: {error}. <button className="btn sm" onClick={load}>Try again</button>
        </Banner>
      )}
      {!preview && !error && (
        <div className="card">
          <LoadingRows rows={5} />
        </div>
      )}
      {preview && preview.sleep.length + preview.archive.length + dupIds.length === 0 && (
        <div className="card">
          <EmptyState icon={Check} title="All clean">
            No tab has been idle for {sleepAfter < 60 ? `${sleepAfter} minutes` : `${sleepAfter / 60} hours`}, nothing looks stale, and there are no duplicates. Try a shorter time below if you want to free more memory.
          </EmptyState>
        </div>
      )}
      {preview && (
        <>
          {preview.protectedCount > 0 && (
            <Banner kind="info" icon={Shield}>
              {plural(preview.protectedCount, 'tab')} {preview.protectedCount === 1 ? 'is' : 'are'} protected (playing audio, pinned, protected site or workspace) and never included.
            </Banner>
          )}
          <Section
            icon={Moon}
            title="Put to sleep"
            note="Frees memory. Tabs stay in place and reload when you click them."
            control={
              <label className="row muted" style={{ gap: 6 }}>
                Inactive for
                <select className="select" value={sleepAfter} onChange={(e) => setSleepAfter(Number(e.target.value))}>
                  {[...new Set([...SLEEP_OPTIONS, settings.sleep.afterMinutes])].sort((a, b) => a - b).map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} h`}
                    </option>
                  ))}
                </select>
              </label>
            }
            candidates={preview.sleep}
            selected={sel.sleep}
            byId={byId}
            wsMap={wsMap}
            onToggle={(id) => toggle('sleep', id)}
            onAll={(on) => setAll('sleep', preview.sleep.map((c) => c.recordId), on)}
            empty="No inactive tabs at this threshold."
          />
          <Section
            icon={Archive}
            title="Archive"
            note="Closes the tab and saves it with its workspace. Suggested from inactivity, duplicates and workspace activity."
            control={
              <label className="row muted" style={{ gap: 6 }}>
                Unused for
                <select className="select" value={archiveAfter} onChange={(e) => setArchiveAfter(Number(e.target.value))}>
                  {[...new Set([...ARCHIVE_OPTIONS, settings.archive.suggestAfterDays])].sort((a, b) => a - b).map((d) => (
                    <option key={d} value={d}>
                      {plural(d, 'day')}
                    </option>
                  ))}
                </select>
              </label>
            }
            candidates={preview.archive}
            selected={sel.archive}
            byId={byId}
            wsMap={wsMap}
            onToggle={(id) => toggle('archive', id)}
            onAll={(on) => setAll('archive', preview.archive.map((c) => c.recordId), on)}
            empty="Nothing looks stale enough to archive."
          />
          <Section
            icon={Copy}
            title="Close duplicates"
            note="Keeps the copy you used most recently (or the visible/pinned one)."
            candidates={dupIds.map((id) => ({ recordId: id, reasons: ['Another copy stays open'], score: 1 }))}
            selected={sel.close}
            byId={byId}
            wsMap={wsMap}
            onToggle={(id) => toggle('close', id)}
            onAll={(on) => setAll('close', dupIds, on)}
            empty="No duplicate tabs."
          />
          <div className="clean-foot">
            <span className="muted tnum">
              Sleep {sel.sleep.size} · Archive {sel.archive.size} · Close {sel.close.size}
            </span>
            <div className="spacer" />
            <button className="btn primary" disabled={!total || running} onClick={execute}>
              {running ? <div className="spinner" /> : <Brush />} {running ? 'Cleaning…' : total ? `Clean ${plural(total, 'tab')}` : 'Nothing selected'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Section({
  icon: Icon,
  title,
  note,
  control,
  candidates,
  selected,
  byId,
  wsMap,
  onToggle,
  onAll,
  empty,
}: {
  icon: typeof Moon;
  title: string;
  note: string;
  control?: React.ReactNode;
  candidates: CleanCandidate[];
  selected: Set<string>;
  byId: Map<string, TabRecord>;
  wsMap: Map<string, { name: string; color: import('../../shared/types').GroupColor }>;
  onToggle: (id: string) => void;
  onAll: (on: boolean) => void;
  empty: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? candidates : candidates.slice(0, 12);
  const all = candidates.length > 0 && candidates.every((c) => selected.has(c.recordId));
  return (
    <section className="card clean-section">
      <div className="head">
        <Icon style={{ width: 16, height: 16, color: 'var(--text-2)' }} />
        <div className="col grow" style={{ gap: 0 }}>
          <h3>
            {title} <span className="faint tnum">{candidates.length ? `${selected.size} of ${candidates.length}` : ''}</span>
          </h3>
          <span className="faint" style={{ fontSize: 12 }}>
            {note}
          </span>
        </div>
        {control}
        {candidates.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => onAll(e.target.checked)} /> All
          </label>
        )}
      </div>
      {!candidates.length ? (
        <div className="row faint" style={{ padding: '10px 14px', fontSize: 12.5 }}>
          <Check style={{ width: 14, height: 14 }} /> {empty}
        </div>
      ) : (
        <div className="tab-list">
          {shown.map((c) => {
            const r = byId.get(c.recordId);
            if (!r) return null;
            const ws = r.workspaceId ? wsMap.get(r.workspaceId) : undefined;
            return (
              <label key={c.recordId} className={`tab-row ${selected.has(c.recordId) ? '' : ''}`} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(c.recordId)} onChange={() => onToggle(c.recordId)} style={{ accentColor: 'var(--accent)' }} />
                <Favicon url={r.url} />
                <div className="col" style={{ gap: 1 }}>
                  <span className="ellipsis" style={{ fontWeight: 500 }}>
                    {r.title}
                  </span>
                  <span className="sub ellipsis">{displayUrl(r.url)}</span>
                </div>
                <div className="meta">
                  {ws && (
                    <span className="pill">
                      <WsDot color={ws.color} size={7} /> {ws.name}
                    </span>
                  )}
                  {c.reasons.map((x) => (
                    <span key={x} className="reason">
                      {x}
                    </span>
                  ))}
                </div>
              </label>
            );
          })}
          {candidates.length > 12 && (
            <button className="btn ghost" style={{ margin: 8, alignSelf: 'center' }} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show fewer' : `Show all ${candidates.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
