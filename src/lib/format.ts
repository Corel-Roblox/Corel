import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import clsx, { type ClassValue } from 'clsx';

export const cn = (...v: ClassValue[]) => clsx(v);

export function timeAgo(d: string | number | Date | null | undefined): string {
  if (!d) return 'never';
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  if (diff < 45_000) return 'just now';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** Compact age: "now", "5m", "3h", "2d", "4w". */
export function ago(d: string | number | Date | null | undefined): string {
  if (!d) return '—';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 86400 / 7)}w`;
}

export function shortDate(d: string | number | Date, use24h = false): string {
  const date = new Date(d);
  const t = format(date, use24h ? 'HH:mm' : 'h:mm a');
  if (isToday(date)) return `Today ${t}`;
  if (isYesterday(date)) return `Yesterday ${t}`;
  return format(date, `MMM d, ${use24h ? 'HH:mm' : 'h:mm a'}`);
}

export function longDate(d: string | number | Date, use24h = false): string {
  return format(new Date(d), use24h ? "EEEE, MMMM d 'at' HH:mm" : "EEEE, MMMM d 'at' h:mm a");
}

/** "2d 4h", "3h 05m", "4m 09s", "now". */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** Formats a number; null/undefined means "not available", shown as an em dash. */
export function num(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return opts.compact && Math.abs(v) >= 10_000 ? compact.format(v) : full.format(Math.round(v * 100) / 100);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Stable colour for avatars without a picture. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** datetime-local input value for a timestamp, in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';
