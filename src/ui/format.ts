import type { GroupColor } from '../shared/types';

export const GROUP_HEX: Record<GroupColor, string> = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#e2a400',
  green: '#188038',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#007b83',
  orange: '#e8710a',
};

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(d / 365)}y`;
}

export function agoLong(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const short = ago(ts, now);
  if (short === 'now') return 'just now';
  const unit: Record<string, string> = { m: 'minute', h: 'hour', d: 'day', mo: 'month', y: 'year' };
  const m = short.match(/^(\d+)(m|h|d|mo|y)$/);
  if (!m) return short;
  const n = Number(m[1]);
  return `${n} ${unit[m[2]]}${n === 1 ? '' : 's'} ago`;
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function bytes(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (abs >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export const plural = (n: number, w: string, p = w + 's') => `${n} ${n === 1 ? w : p}`;

export const STATUS_LABEL = { open: 'Open', sleeping: 'Sleeping', archived: 'Archived', closed: 'Closed' } as const;
