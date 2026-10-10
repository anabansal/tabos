import { Globe, Inbox, Moon, Archive, CircleDot, History } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GroupColor, TabStatus, Workspace } from '../shared/types';
import { faviconFor } from '../shared/url';
import { GROUP_HEX, STATUS_LABEL } from './format';
import { GROUP_COLORS } from '../shared/types';

export function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = url ? faviconFor(url, size * 2) : '';
  if (!src || failed) return <Globe className="favicon" style={{ width: size, height: size, color: 'var(--text-3)' }} />;
  return <img className="favicon" src={src} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

const STATUS_ICON: Record<TabStatus, typeof Moon> = { open: CircleDot, sleeping: Moon, archived: Archive, closed: History };

export function StatusPill({ status }: { status: TabStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`pill ${status}`}>
      <Icon style={{ width: 11, height: 11 }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WsDot({ color, size = 10 }: { color: GroupColor | undefined; size?: number }) {
  return <span className="ws-dot" style={{ background: color ? GROUP_HEX[color] : 'var(--border-strong)', width: size, height: size }} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children }: { icon?: typeof Inbox; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon />
      <h3>{title}</h3>
      {children && <div style={{ maxWidth: 420 }}>{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" role="status">
      <div className="spinner" />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="col" style={{ padding: 12, gap: 10 }} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 30, opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function ColorSwatches({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {GROUP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`swatch ${c === value ? 'active' : ''}`}
          style={{ background: GROUP_HEX[c] }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function WorkspaceSelect({
  value,
  workspaces,
  onChange,
  className = 'select',
  noneLabel = 'No workspace',
}: {
  value: string | null;
  workspaces: Workspace[];
  onChange: (id: string | null) => void;
  className?: string;
  noneLabel?: string;
}) {
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Workspace">
      <option value="">{noneLabel}</option>
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

export interface MenuItem {
  label: string;
  /** Renders a small section label instead of a button. */
  heading?: boolean;
  icon?: typeof Inbox;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

/** Small dropdown menu. Rendered position: fixed so cards and scroll containers never clip it. */
export function Menu({ trigger, items, align = 'right' }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = ref.current!.getBoundingClientRect();
    const estHeight = items.length * 31 + 10;
    const top = r.bottom + 4 + estHeight > window.innerHeight ? Math.max(8, r.top - 4 - estHeight) : r.bottom + 4;
    setPos(align === 'right' ? { top, right: Math.max(8, window.innerWidth - r.right) } : { top, left: r.left });
  };
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      {trigger(toggle)}
      {pos && (
        <div ref={menuRef} className="menu" role="menu" style={pos}>
          {items.map((it, i) =>
            it.divider ? (
              <hr key={i} />
            ) : it.heading ? (
              <div key={i} className="menu-label">
                {it.label}
              </div>
            ) : (
              <button
                key={i}
                role="menuitem"
                className={it.danger ? 'danger' : ''}
                disabled={it.disabled}
                onClick={() => {
                  setPos(null);
                  it.onClick?.();
                }}
              >
                {it.icon && <it.icon />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Banner({ kind, icon: Icon, children }: { kind: 'info' | 'warn' | 'error'; icon: typeof Inbox; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`}>
      <Icon />
      <div className="grow">{children}</div>
    </div>
  );
}
