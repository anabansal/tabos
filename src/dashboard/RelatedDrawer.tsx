import { Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { findRelated, type RelatedHit } from '../ai/related';
import { resolveProviders } from '../ai/providers';
import { rpc } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { displayUrl } from '../shared/url';
import { EmptyState, Favicon, LoadingRows, StatusPill } from '../ui/components';
import { errorMessage, useFeedback } from '../ui/feedback';
import { useData } from './data';

export function RelatedDrawer({ record, onClose }: { record: TabRecord; onClose: () => void }) {
  const { records, settings } = useData();
  const fb = useFeedback();
  const [hits, setHits] = useState<RelatedHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = useMemo(() => resolveProviders(settings.ai).embedding, [settings.ai]);

  useEffect(() => {
    const ctrl = new AbortController();
    setHits(null);
    setError(null);
    findRelated(record, records, provider, { limit: 12, exclusions: settings.exclusions, signal: ctrl.signal })
      .then((h) => !ctrl.signal.aborted && setHits(h))
      .catch((e) => !ctrl.signal.aborted && setError(errorMessage(e)));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, provider]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="drawer" aria-label="Related tabs">
      <div className="drawer-head">
        <Sparkles style={{ width: 16, height: 16, color: 'var(--accent)', marginTop: 2 }} />
        <div className="col grow" style={{ gap: 2 }}>
          <h2>Related tabs</h2>
          <span className="muted ellipsis" title={record.title}>
            to “{record.title}”
          </span>
        </div>
        <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="drawer-body">
        {error ? (
          <EmptyState title="Couldn't find related tabs">{error}</EmptyState>
        ) : !hits ? (
          <LoadingRows rows={5} />
        ) : !hits.length ? (
          <EmptyState icon={Sparkles} title="Nothing closely related">
            No other open, archived or closed tab looks like this one.
          </EmptyState>
        ) : (
          hits.map((h) => (
            <div key={h.record.id} className="result-row" onClick={() => fb.run(() => rpc('tabs.focus', { recordId: h.record.id }))}>
              <Favicon url={h.record.url} />
              <div className="col" style={{ gap: 2 }}>
                <span className="ellipsis" style={{ fontWeight: 500 }}>
                  {h.record.title}
                </span>
                <span className="faint ellipsis" style={{ fontSize: 12 }}>
                  {displayUrl(h.record.url)}
                </span>
                <div className="reasons">
                  {h.reasons.map((r) => (
                    <span key={r} className="reason">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <StatusPill status={h.record.status} />
            </div>
          ))
        )}
      </div>
      <div className="faint" style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
        Matched by {provider.label} using titles, addresses{settings.privacy.collectPageMeta ? ' and page descriptions' : ''}.
      </div>
    </aside>
  );
}
