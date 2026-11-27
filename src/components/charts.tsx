// Analytics data hooks and charts. All numbers come from stored snapshots of public
// Roblox data or from metrics the team imported; nothing is estimated or invented.
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { getSupabase } from '@/lib/supabase';
import { num } from '@/lib/format';
import { useWorkspace } from '@/store/workspace';
import type { MetricRow, Snapshot } from '@/lib/types';

export const SERIES_COLORS = ['var(--accent)', '#60a5fa', '#f5b83d', '#f472b6', '#a78bfa', '#2dd4bf'];
export const SERIES_DASH = ['0', '6 3', '2 3', '8 3 2 3', '0', '4 4'];

export function useSnapshots(projectIds: string[], fromMs: number) {
  const teamId = useWorkspace((s) => s.teamId);
  const [rows, setRows] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = projectIds.join(',');
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !projectIds.length) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setRows(null);
    setError(null);
    supabase
      .from('analytics_snapshots')
      .select('*')
      .in('project_id', projectIds)
      .gte('captured_at', new Date(fromMs).toISOString())
      .order('captured_at')
      .limit(10000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        setRows((data as Snapshot[]) || []);
      });
    const ch = supabase
      .channel(`db:snapshots:${teamId}:${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'analytics_snapshots', filter: `team_id=eq.${teamId}` }, (p) => {
        const s = p.new as Snapshot;
        if (projectIds.includes(s.project_id)) setRows((r) => [...(r ?? []), s]);
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [key, fromMs, teamId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, error };
}

export function useMetrics(projectIds: string[], fromMs: number, reloadKey = 0) {
  const [rows, setRows] = useState<MetricRow[] | null>(null);
  const key = projectIds.join(',');
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !projectIds.length) {
      setRows([]);
      return;
    }
    setRows(null);
    supabase
      .from('analytics_metrics')
      .select('*')
      .in('project_id', projectIds)
      .gte('day', format(fromMs, 'yyyy-MM-dd'))
      .order('day')
      .limit(10000)
      .then(({ data }) => setRows((data as MetricRow[]) || []));
  }, [key, fromMs, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/** Per-day series from snapshots: peak players, visits gained, favorites, rating. */
export function dailySeries(rows: Snapshot[]) {
  const byDay = new Map<string, Snapshot[]>();
  for (const r of rows) {
    const d = format(new Date(r.captured_at), 'yyyy-MM-dd');
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const days = [...byDay.keys()].sort();
  let prevVisits: number | null = null;
  return days.map((d) => {
    const list = byDay.get(d)!;
    const visits = Math.max(...list.map((r) => r.visits ?? -1));
    const gained = prevVisits !== null && visits >= 0 ? Math.max(0, visits - prevVisits) : null;
    if (visits >= 0) prevVisits = visits;
    const last = list[list.length - 1];
    const up = last.up_votes ?? 0;
    const down = last.down_votes ?? 0;
    return {
      day: d,
      peak: Math.max(...list.map((r) => r.playing ?? 0)),
      avg: Math.round(list.reduce((s, r) => s + (r.playing ?? 0), 0) / list.length),
      visits: visits >= 0 ? visits : null,
      gained,
      favorites: last.favorites,
      rating: up + down > 0 ? (up / (up + down)) * 100 : null,
    };
  });
}

const tickTime = (rangeDays: number) => (v: number) => format(new Date(v), rangeDays <= 1 ? 'HH:mm' : 'MMM d');

function ChartTooltip({ active, payload, label, fmt, labelFmt }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number | string; fmt?: (v: number) => string; labelFmt?: (l: number | string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-strong bg-overlay px-2.5 py-2 text-[12px] shadow-pop">
      <p className="mb-1 text-fg-subtle">{labelFmt ? labelFmt(label!) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-fg-muted">{p.name}</span>
          <span className="tabular ml-auto font-medium text-fg">{fmt ? fmt(p.value) : num(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Concurrent players over time for one or more projects. */
export function PlayersChart({ rows, projects, rangeDays, height = 240 }: { rows: Snapshot[]; projects: { id: string; name: string }[]; rangeDays: number; height?: number }) {
  const data = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    for (const r of rows) {
      const t = Math.floor(new Date(r.captured_at).getTime() / 900_000) * 900_000;
      const e = map.get(t) ?? { t };
      if (r.playing !== null) e[r.project_id] = r.playing;
      map.set(t, e);
    }
    return [...map.values()].sort((a, b) => a.t - b.t);
  }, [rows]);
  const single = projects.length === 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {single ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="playersFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickTime(rangeDays)} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => num(v, { compact: true })} width={48} allowDecimals={false} />
          <RTooltip content={<ChartTooltip labelFmt={(l) => format(new Date(Number(l)), 'MMM d, HH:mm')} />} />
          <Area type="monotone" dataKey={projects[0].id} name="Players" stroke="var(--accent)" strokeWidth={2} fill="url(#playersFill)" connectNulls isAnimationActive={false} />
        </AreaChart>
      ) : (
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickTime(rangeDays)} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => num(v, { compact: true })} width={48} allowDecimals={false} />
          <RTooltip content={<ChartTooltip labelFmt={(l) => format(new Date(Number(l)), 'MMM d, HH:mm')} />} />
          {projects.map((p, i) => (
            <Line key={p.id} type="monotone" dataKey={p.id} name={p.name} stroke={SERIES_COLORS[i % 6]} strokeDasharray={SERIES_DASH[i % 6]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

export function DailyBarChart({ data, dataKey, name, height = 200, fmt }: { data: Record<string, unknown>[]; dataKey: string; name: string; height?: number; fmt?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d + 'T00:00:00'), 'MMM d')} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => (fmt ? fmt(v) : num(v, { compact: true }))} width={48} />
        <RTooltip content={<ChartTooltip fmt={fmt} labelFmt={(l) => format(new Date(String(l) + 'T00:00:00'), 'EEE, MMM d')} />} />
        <Bar dataKey={dataKey} name={name} fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyLineChart({ data, lines, height = 200, fmt }: { data: Record<string, unknown>[]; lines: { key: string; name: string }[]; height?: number; fmt?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d + 'T00:00:00'), 'MMM d')} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => (fmt ? fmt(v) : num(v, { compact: true }))} width={48} domain={['auto', 'auto']} />
        <RTooltip content={<ChartTooltip fmt={fmt} labelFmt={(l) => format(new Date(String(l) + 'T00:00:00'), 'EEE, MMM d')} />} />
        {lines.map((l, i) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={SERIES_COLORS[i % 6]} strokeDasharray={SERIES_DASH[i % 6]} strokeWidth={2} dot={data.length < 20} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ values, height = 32, width = 120 }: { values: number[]; height?: number; width?: number }) {
  if (values.length < 2) return <span className="text-[11.5px] text-fg-subtle">Not enough data yet</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / (max - min || 1)) * (height - 4) - 2}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
