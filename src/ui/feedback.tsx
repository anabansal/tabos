// Toasts (with Undo) and confirmation dialogs, shared by popup and dashboard.

import { AlertTriangle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc, type OpResult } from '../shared/messages';
import type { TabRecord } from '../shared/types';
import { Favicon } from './components';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  activityId?: string | null;
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  tabs?: Array<Pick<TabRecord, 'id' | 'title' | 'url'>>;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
}

interface FeedbackApi {
  /** Ask for one line of text (e.g. a new group name). Resolves null when cancelled. */
  prompt(opts: PromptOptions): Promise<string | null>;
  toast(message: string, opts?: { activityId?: string | null; kind?: 'info' | 'error' }): void;
  error(err: unknown): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** Run an RPC-backed action: shows result toast (with Undo when available) or the error. */
  run(task: () => Promise<OpResult | void>, success?: (r: OpResult) => string): Promise<OpResult | void>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('FeedbackProvider missing');
  return v;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function skippedSummary(r: OpResult): string {
  if (!r.skipped?.length) return '';
  const reasons = new Map<string, number>();
  for (const s of r.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  return ` · skipped ${r.skipped.length} (${top[0].toLowerCase()}${reasons.size > 1 ? ', …' : ''})`;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [ask, setAsk] = useState<(PromptOptions & { resolve: (v: string | null) => void }) | null>(null);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => setAsk({ ...opts, resolve })), []);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<FeedbackApi['toast']>(
    (message, opts) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, message, kind: opts?.kind ?? 'info', activityId: opts?.activityId }]);
      setTimeout(() => dismiss(id), opts?.activityId ? 9000 : opts?.kind === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  const error = useCallback((err: unknown) => toast(errorMessage(err), { kind: 'error' }), [toast]);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);
  const run = useCallback<FeedbackApi['run']>(
    async (task, success) => {
      try {
        const r = await task();
        if (r && success) {
          const msg = r.count === 0 && r.skipped.length ? `Nothing changed${skippedSummary(r)}` : success(r) + skippedSummary(r);
          toast(msg, { activityId: r.activityId });
        }
        return r;
      } catch (err) {
        error(err);
      }
    },
    [toast, error],
  );

  const undo = async (t: Toast) => {
    dismiss(t.id);
    try {
      const r = await rpc('activity.undo', { id: t.activityId! });
      toast(r.message ?? 'Undone');
    } catch (err) {
      error(err);
    }
  };

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ toast, error, confirm, run, prompt }}>
      {children}
      {dialog && <ConfirmDialog opts={dialog} onClose={close} />}
      {ask && (
        <PromptDialog
          opts={ask}
          onClose={(v) => {
            ask.resolve(v);
            setAsk(null);
          }}
        />
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            <span>{t.message}</span>
            {t.activityId && (
              <button className="btn sm" onClick={() => undo(t)}>
                Undo
              </button>
            )}
            <button className="btn sm icon" aria-label="Dismiss" onClick={() => dismiss(t.id)} style={{ border: 0 }}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (v: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shown = opts.tabs?.slice(0, 60) ?? [];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-head row">
          {opts.danger && <AlertTriangle style={{ color: 'var(--danger)', width: 18, height: 18 }} />}
          <h2 id="confirm-title">{opts.title}</h2>
        </div>
        <div className="dialog-body">
          {opts.body && <div className="muted">{opts.body}</div>}
          {shown.length > 0 && (
            <div className="mini-list">
              {shown.map((t) => (
                <div className="item" key={t.id}>
                  <Favicon url={t.url} />
                  <span className="ellipsis">{t.title || t.url}</span>
                </div>
              ))}
              {(opts.tabs?.length ?? 0) > shown.length && <div className="item faint">+ {opts.tabs!.length - shown.length} more</div>}
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button ref={confirmRef} className={`btn ${opts.danger ? 'danger solid' : 'primary'}`} onClick={() => onClose(true)}>
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({ opts, onClose }: { opts: PromptOptions; onClose: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        onSubmit={(e) => {
          e.preventDefault();
          onClose(value.trim() || null);
        }}
      >
        <div className="dialog-head">
          <h2 id="prompt-title">{opts.title}</h2>
        </div>
        <div className="dialog-body">
          <input className="input" style={{ width: '100%', height: 34 }} autoFocus placeholder={opts.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
