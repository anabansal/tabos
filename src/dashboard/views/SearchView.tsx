import { Search as SearchIcon, Sparkles, AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveProviders } from '../../ai/providers';
import { describeQuery } from '../../ai/queryParser';
import { semanticSearch, type SemanticDoc, type SemanticResult } from '../../ai/semanticSearch';
import { rpc } from '../../shared/messages';
import type { TabRecord } from '../../shared/types';
import { displayUrl } from '../../shared/url';
import { Banner, EmptyState, Favicon, LoadingRows, StatusPill, WsDot } from '../../ui/components';
import { errorMessage, useFeedback } from '../../ui/feedback';
import { ago } from '../../ui/format';
import { navigate, usePermission } from '../../ui/hooks';
import { useData } from '../data';

type Doc = SemanticDoc & { record?: TabRecord };

const EXAMPLES = ['that paper about semantic entropy I opened last week', 'react docs from yesterday', 'headphones I was comparing', 'videos I archived', 'github repo I closed'];

export function SearchView({ query }: { query: string }) {
  const { records, settings, wsMap } = useData();
  const fb = useFeedback();
  const [includeHistory, setIncludeHistory] = useState(false);
  const [historyGranted] = usePermission({ permissions: ['history'] });
  const [result, setResult] = useState<SemanticResult<Doc> | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const providers = useMemo(() => resolveProviders(settings.ai), [settings.ai]);
  const abort = useRef<AbortController | null>(null);


  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    setProgress(null);
    (async () => {
      const docs: Doc[] = records.map((r) => ({ ...r, record: r }));
      if (includeHistory && historyGranted) {
        const hist = await chrome.history.search({ text: '', maxResults: 1000, startTime: Date.now() - 60 * 86_400_000 }).catch(() => []);
        const known = new Set(records.map((r) => r.normalizedUrl));
        for (const h of hist) {
          if (!h.url || known.has(h.url)) continue;
          docs.push({ id: `h:${h.id}`, title: h.title || h.url, url: h.url, domain: new URL(h.url).hostname.replace(/^www\./, ''), status: 'history', lastActiveAt: h.lastVisitTime ?? 0 });
        }
      }
      const res = await semanticSearch(query, docs, {
        provider: providers.embedding,
        exclusions: settings.exclusions,
        signal: ctrl.signal,
        onProgress: (d, n) => n > 50 && setProgress([d, n]),
      });
      if (!ctrl.signal.aborted) {
        setResult(res);
        setActive(0);
      }
    })()
      .catch((err) => !ctrl.signal.aborted && setError(errorMessage(err)))
      .finally(() => !ctrl.signal.aborted && setBusy(false));
    return () => ctrl.abort();
    // Re-run when the query or source set changes, not on every record update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, includeHistory, historyGranted, providers.embedding]);

  const open = (d: Doc) => {
    if (d.status === 'history') void chrome.tabs.create({ url: d.url });
    else void fb.run(() => rpc('tabs.focus', { recordId: d.id }));
  };
  const hits = result?.hits ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Search</h1>
          <div className="subtitle">Results for your search across open, archived and recently closed tabs. Try describing it: what it was about, what kind of page, and when.</div>
        </div>
      </div>
      <div className="filters">
        <span className="faint row" style={{ gap: 6 }}>
          <Sparkles style={{ width: 14, height: 14 }} /> {providers.embedding.label}
        </span>
        {historyGranted && (
          <label className="check">
            <input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} /> Include browsing history
          </label>
        )}
        {result &&
          describeQuery(result.parsed).map((c) => (
            <span key={c} className="pill accent">
              {c}
            </span>
          ))}
        {result && result.parsed.terms.length > 0 && <span className="faint">about “{result.parsed.terms.join(' ')}”</span>}
      </div>
      {providers.warnings.map((w) => (
        <Banner key={w} kind="warn" icon={AlertTriangle}>
          {w}
        </Banner>
      ))}
      {error && (
        <Banner kind="error" icon={AlertTriangle}>
          Search failed: {error}
        </Banner>
      )}
      {!query.trim() ? (
        <div className="card card-pad col">
          <h3>Try</h3>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {EXAMPLES.map((x) => (
              <button key={x} className="chip" onClick={() => navigate(`/search?q=${encodeURIComponent(x)}`)}>
                {x}
              </button>
            ))}
          </div>
        </div>
      ) : busy ? (
        <div className="card">
          {progress && (
            <div className="card-pad col" style={{ gap: 6 }}>
              <span className="muted">
                Indexing tabs with {providers.embedding.label}: {progress[0]} / {progress[1]}
              </span>
              <div className="progress">
                <div style={{ transform: `scaleX(${progress[0] / progress[1]})` }} />
              </div>
            </div>
          )}
          <LoadingRows rows={5} />
        </div>
      ) : !hits.length ? (
        <div className="card">
          <EmptyState icon={SearchIcon} title="No matches">
            Try fewer words, a different time (“yesterday”, “last month”), or turn on history.
          </EmptyState>
        </div>
      ) : (
        <div className="card" role="listbox" aria-label="Results">
          {hits.map((h, i) => {
            const ws = h.doc.record?.workspaceId ? wsMap.get(h.doc.record.workspaceId) : undefined;
            return (
              <div key={h.doc.id} role="option" aria-selected={i === active} className={`result-row ${i === active ? 'active' : ''}`} onClick={() => open(h.doc)} onMouseEnter={() => setActive(i)}>
                <Favicon url={h.doc.url} />
                <div className="col" style={{ gap: 2 }}>
                  <span className="ellipsis" style={{ fontWeight: 500 }}>
                    {h.doc.title}
                  </span>
                  <span className="faint ellipsis" style={{ fontSize: 12 }}>
                    {displayUrl(h.doc.url)}
                  </span>
                  {h.reasons.length > 0 && (
                    <div className="reasons">
                      {h.reasons.map((r) => (
                        <span key={r} className="reason">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="meta">
                  {ws && (
                    <span className="pill">
                      <WsDot color={ws.color} size={7} /> {ws.name}
                    </span>
                  )}
                  {h.doc.status === 'history' ? <span className="pill">History</span> : <StatusPill status={h.doc.status as TabRecord['status']} />}
                  <span className="when">{ago(h.doc.lastActiveAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
