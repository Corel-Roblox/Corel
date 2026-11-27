// Analytics. Two honest data sources:
//  1. Snapshots of the public numbers Roblox shows for an experience (visits, players
//     online, favorites, votes), captured every 15 minutes while Corel is open.
//  2. Metrics the team imports from Creator Hub exports (revenue, DAU, session time,
//     retention), because Roblox has no public API for those.
// Missing data is shown as "Not available" with the reason, never as zero.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, Camera, Clock, Download, ExternalLink, FlaskConical, Heart, Info, Lock, Repeat, ThumbsUp, TrendingUp, Upload, Users, Wallet, Eye, X } from 'lucide-react';
import { subDays, format } from 'date-fns';
import { Page } from '@/components/layout/Shell';
import { Badge, Button, Card, Dialog, EmptyState, ErrorBanner, Field, Input, Menu, MenuCheckItem, MenuContent, MenuTrigger, Notice, PageHeader, Segmented, Select, Skeleton, Stat, Textarea, Tooltip } from '@/components/ui';
import { ProjectSelect, ProjectThumb } from '@/components/common';
import { DailyBarChart, DailyLineChart, PlayersChart, SERIES_COLORS, dailySeries, useMetrics, useSnapshots } from '@/components/charts';
import { useMe, useWorkspace } from '@/store/workspace';
import { collectSnapshots } from '@/lib/background';
import { invoke, isDesktop, openExternal } from '@/lib/tauri';
import { num, pct, timeAgo } from '@/lib/format';
import { hasPerm, projectPerm } from '@/lib/perms';
import { sb } from '@/lib/supabase';
import type { GameStats, MetricRow, Snapshot } from '@/lib/types';
import { isDemo } from '@/dev/demo';

type Range = '1' | '7' | '30' | '90' | 'custom';

export const IMPORT_METRICS = [
  { key: 'revenue_robux', label: 'Revenue', unit: 'Robux', icon: <Wallet /> },
  { key: 'dau', label: 'Daily active users', unit: 'players', icon: <Users /> },
  { key: 'avg_session_minutes', label: 'Average session time', unit: 'minutes', icon: <Clock /> },
  { key: 'd1_retention', label: 'Day 1 retention', unit: '%', icon: <Repeat /> },
  { key: 'd7_retention', label: 'Day 7 retention', unit: '%', icon: <Repeat /> },
  { key: 'new_users', label: 'New users', unit: 'players', icon: <TrendingUp /> },
  { key: 'paying_users', label: 'Paying users', unit: 'players', icon: <Wallet /> },
];

function useRange(range: Range, custom: { from: string; to: string }) {
  return useMemo(() => {
    if (range === 'custom' && custom.from) return { from: new Date(custom.from + 'T00:00:00').getTime(), to: custom.to ? new Date(custom.to + 'T23:59:59').getTime() : Date.now(), days: Math.max(1, Math.round(((custom.to ? new Date(custom.to).getTime() : Date.now()) - new Date(custom.from).getTime()) / 86400_000)) };
    const days = Number(range === 'custom' ? 30 : range);
    return { from: Date.now() - days * 86400_000, to: Date.now(), days };
  }, [range, custom.from, custom.to]);
}

export function AnalyticsPage() {
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const me = useMe();
  const [projectId, setProjectId] = useState(projects.find((p) => p.universe_id)?.id ?? projects[0]?.id ?? '');
  const [compare, setCompare] = useState<string[]>([]);
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [range, setRange] = useState<Range>('7');
  const [custom, setCustom] = useState({ from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') });
  const r = useRange(range, custom);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
    if (!compare.length) setCompare(projects.filter((p) => p.universe_id).slice(0, 3).map((p) => p.id));
  }, [projects.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasPerm(me, 'view_analytics')) {
    return <Page><PageHeader title="Analytics" /><EmptyState icon={<Lock />} title="You don’t have access to analytics" body="Ask a team admin to give you the View analytics permission." /></Page>;
  }

  const capture = async () => {
    setCapturing(true);
    const res = await collectSnapshots();
    setCapturing(false);
    if (res.error) toast.error(res.error);
    else toast.success(res.captured ? `Captured ${res.captured} snapshot${res.captured > 1 ? 's' : ''}` : 'Already captured in this 15-minute window');
  };

  return (
    <Page wide>
      <PageHeader
        title="Analytics"
        description="Performance of your experiences over time, from Roblox’s public numbers and your Creator Hub exports."
        actions={
          <>
            {isDesktop && <Tooltip content="Snapshots are captured every 15 minutes while Corel is open."><Button icon={<Camera className="size-3.5" />} loading={capturing} onClick={capture}>Capture now</Button></Tooltip>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'single', label: 'Experience' }, { value: 'compare', label: 'Compare' }]} />
        {mode === 'single' ? (
          <div className="w-[240px]"><ProjectSelect value={projectId} onChange={setProjectId} /></div>
        ) : (
          <Menu>
            <MenuTrigger asChild><Button icon={<BarChart3 className="size-3.5" />}>{compare.length} experiences</Button></MenuTrigger>
            <MenuContent align="start" className="w-[260px]">
              {projects.map((p) => (
                <MenuCheckItem key={p.id} checked={compare.includes(p.id)} onChange={(v) => setCompare(v ? [...compare, p.id].slice(0, 6) : compare.filter((x) => x !== p.id))}>
                  <ProjectThumb project={p} size={16} />
                  <span className="truncate">{p.name}</span>
                </MenuCheckItem>
              ))}
            </MenuContent>
          </Menu>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Segmented label="Date range" value={range} onChange={setRange} options={[{ value: '1', label: '24h' }, { value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }, { value: 'custom', label: 'Custom' }]} />
          {range === 'custom' && (
            <>
              <Input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-7 w-[140px]" aria-label="From" />
              <span className="text-fg-subtle">–</span>
              <Input type="date" value={custom.to} min={custom.from} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-7 w-[140px]" aria-label="To" />
            </>
          )}
        </div>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={<BarChart3 />} title="No projects yet" body="Create a project with a Roblox experience to start tracking its performance." />
      ) : mode === 'single' ? (
        projectId && <ProjectAnalytics projectId={projectId} from={r.from} to={r.to} days={r.days} />
      ) : (
        <CompareView ids={compare} from={r.from} to={r.to} days={r.days} />
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ single project

export function ProjectAnalytics({ projectId, from, to, days = 7, compact }: { projectId: string; from?: number; to?: number; days?: number; compact?: boolean }) {
  const project = useWorkspace((s) => s.projects.find((p) => p.id === projectId));
  const me = useMe();
  const prole = useWorkspace((s) => s.projectMembers.find((m) => m.project_id === projectId && m.user_id === me?.user_id)?.role);
  const start = useMemo(() => from ?? Date.now() - days * 86400_000, [from, days]);
  const { rows: raw, error } = useSnapshots([projectId], start);
  const [reload, setReload] = useState(0);
  const metrics = useMetrics(compact ? [] : [projectId], start, reload);
  const [live, setLive] = useState<GameStats | null | 'error'>(null);
  const [demo, setDemo] = useState(isDemo());
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setDemo(isDemo());
    if (!project?.universe_id || !isDesktop) return;
    setLive(null);
    invoke<GameStats[]>('roblox_game_stats', { universeIds: [project.universe_id] }).then((s) => setLive(s[0] ?? 'error')).catch(() => setLive('error'));
  }, [project?.universe_id]);

  const rows = useMemo(() => {
    const list = demo ? demoSnapshots(projectId, start) : raw ?? [];
    return to ? list.filter((r) => new Date(r.captured_at).getTime() <= to) : list;
  }, [raw, demo, projectId, start, to]);
  const daily = useMemo(() => dailySeries(rows), [rows]);

  if (!project) return null;
  if (!projectPerm(me, prole, 'view_analytics')) return <Notice tone="warning" icon={<Lock />}>You don’t have permission to view analytics for this project.</Notice>;
  if (!project.universe_id) {
    return (
      <Card title={compact ? 'Game performance' : undefined}>
        <EmptyState compact icon={<BarChart3 />} title="No Roblox experience linked" body="Add the universe ID in the project’s Settings to start tracking visits, players and favorites." />
      </Card>
    );
  }

  const latest = rows[rows.length - 1];
  const first = rows[0];
  const loading = raw === null && !demo;
  const peak = rows.length ? Math.max(...rows.map((r) => r.playing ?? 0)) : null;
  const avgPlayers = rows.length ? rows.reduce((s, r) => s + (r.playing ?? 0), 0) / rows.length : null;
  const visitsGained = latest?.visits != null && first?.visits != null && rows.length > 1 ? latest.visits - first.visits : null;
  const favGained = latest?.favorites != null && first?.favorites != null && rows.length > 1 ? latest.favorites - first.favorites : null;
  const liveStats = live && live !== 'error' && !demo ? live : null;
  const rating = (s: { up: number | null | undefined; down: number | null | undefined }) => (s.up != null && s.down != null && s.up + s.down > 0 ? (s.up / (s.up + s.down)) * 100 : null);
  const currentRating = liveStats ? rating({ up: liveStats.upVotes, down: liveStats.downVotes }) : latest ? rating({ up: latest.up_votes, down: latest.down_votes }) : null;

  const kpis = (
    <div className={`grid gap-3 ${compact ? 'grid-cols-4' : 'grid-cols-3 xl:grid-cols-6'}`}>
      <Stat label="Total visits" icon={<Eye />} value={loading ? <Skeleton className="h-7 w-20" /> : num(liveStats?.visits ?? latest?.visits ?? null, { compact: true })} hint={visitsGained != null ? `+${num(visitsGained, { compact: true })} in range` : 'Needs 2+ snapshots for growth'} />
      <Stat label="Playing now" icon={<Users />} value={loading ? <Skeleton className="h-7 w-14" /> : num(liveStats?.playing ?? latest?.playing ?? null)} hint={peak != null ? `Peak ${num(peak)} in range` : undefined} />
      <Stat label="Favorites" icon={<Heart />} value={loading ? <Skeleton className="h-7 w-16" /> : num(liveStats?.favorites ?? latest?.favorites ?? null, { compact: true })} hint={favGained != null ? `${favGained >= 0 ? '+' : ''}${num(favGained)} in range` : undefined} />
      <Stat label="Rating" icon={<ThumbsUp />} value={loading ? <Skeleton className="h-7 w-14" /> : pct(currentRating, 0)} hint={liveStats ? `${num(liveStats.upVotes, { compact: true })} likes · ${num(liveStats.downVotes, { compact: true })} dislikes` : undefined} />
      {!compact && <Stat label="Average players" icon={<TrendingUp />} value={loading ? <Skeleton className="h-7 w-14" /> : num(avgPlayers != null ? Math.round(avgPlayers) : null)} hint={rows.length ? `${rows.length} snapshots` : 'No snapshots yet'} />}
      {!compact && <Stat label="Last captured" icon={<Camera />} value={<span className="text-[15px]">{latest ? timeAgo(latest.captured_at) : '—'}</span>} hint={live === 'error' ? 'Live numbers unavailable' : liveStats ? 'Live numbers from Roblox' : undefined} />}
    </div>
  );

  if (compact) {
    return (
      <Card title="Game performance" description="Public numbers from Roblox" action={demo ? <Badge tone="warning">Demo data</Badge> : undefined}>
        {kpis}
        {rows.length > 1 && <div className="mt-4"><PlayersChart rows={rows} projects={[{ id: projectId, name: 'Players' }]} rangeDays={days} height={160} /></div>}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={`Couldn’t load snapshots: ${error}`} />}
      {demo && (
        <Notice tone="warning" icon={<FlaskConical />} action={<Button size="xs" variant="ghost" icon={<X className="size-3" />} onClick={() => setDemo(false)}>Hide demo</Button>}>
          <b className="text-fg">Demo data.</b> These charts use generated sample numbers to show what Corel will display. They are not {project.name}’s real statistics.
        </Notice>
      )}
      {kpis}
      {rows.length < 2 && !loading && !demo ? (
        <Card>
          <EmptyState
            icon={<Camera />}
            title={rows.length === 1 ? 'One snapshot so far' : 'No history yet'}
            body="Corel records the public numbers for this experience every 15 minutes while any teammate has the app open. Charts appear after the second snapshot."
            action={<Button icon={<FlaskConical className="size-3.5" />} onClick={() => setDemo(true)}>Preview with demo data</Button>}
          />
        </Card>
      ) : (
        <>
          <Card title="Players online" description="Concurrent players, every 15 minutes" action={demo && <Badge tone="warning">Demo</Badge>}>
            {loading ? <Skeleton className="h-[240px] w-full" /> : <PlayersChart rows={rows} projects={[{ id: projectId, name: 'Players' }]} rangeDays={days} />}
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Card title="Visits per day" description="Growth of the public visit counter" action={demo && <Badge tone="warning">Demo</Badge>}>
              {daily.filter((d) => d.gained != null).length ? <DailyBarChart data={daily} dataKey="gained" name="Visits" /> : <p className="py-10 text-center text-[12.5px] text-fg-subtle">Needs snapshots on at least two days.</p>}
            </Card>
            <Card title="Favorites and rating" action={demo && <Badge tone="warning">Demo</Badge>}>
              <DailyLineChart data={daily} lines={[{ key: 'favorites', name: 'Favorites' }]} height={95} />
              <DailyLineChart data={daily} lines={[{ key: 'rating', name: 'Rating %' }]} height={95} fmt={(v) => `${v.toFixed(0)}%`} />
            </Card>
          </div>
          <Card title="Peak vs average players per day" action={demo && <Badge tone="warning">Demo</Badge>}>
            <DailyLineChart data={daily} lines={[{ key: 'peak', name: 'Peak' }, { key: 'avg', name: 'Average' }]} />
          </Card>
        </>
      )}
      <ImportedMetrics projectId={projectId} rows={metrics} onImport={() => setImportOpen(true)} canImport={projectPerm(me, prole, 'edit_content')} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} projectId={projectId} onDone={() => setReload((x) => x + 1)} />
    </div>
  );
}

function ImportedMetrics({ projectId, rows, onImport, canImport }: { projectId: string; rows: MetricRow[] | null; onImport: () => void; canImport: boolean }) {
  const project = useWorkspace((s) => s.projects.find((p) => p.id === projectId));
  return (
    <Card
      title="Revenue, engagement and retention"
      description="From Creator Hub exports you import"
      action={
        <>
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => openExternal(`https://create.roblox.com/dashboard/creations/experiences/${project?.universe_id}/analytics/overview`)}>Creator Hub</Button>
          {canImport && <Button size="sm" icon={<Upload className="size-3.5" />} onClick={onImport}>Import CSV</Button>}
        </>
      }
    >
      <Notice tone="neutral" icon={<Info />}>
        Roblox doesn’t offer these numbers through a public API, so Corel can’t fetch them automatically. Download a CSV from your experience’s Analytics page in Creator Hub and import it here; everyone on the team then sees the same charts.
      </Notice>
      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {IMPORT_METRICS.map((m) => {
          const series = (rows ?? []).filter((r) => r.metric === m.key);
          const last = series[series.length - 1];
          const total = m.key === 'revenue_robux' || m.key === 'new_users' ? series.reduce((s, r) => s + r.value, 0) : null;
          return (
            <div key={m.key} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between text-[12px] text-fg-muted"><span>{m.label}</span><span className="text-fg-subtle [&>svg]:size-3.5">{m.icon}</span></div>
              {rows === null ? <Skeleton className="mt-2 h-6 w-16" /> : series.length ? (
                <>
                  <p className="tabular mt-1 text-[20px] font-semibold">{num(total ?? last.value, { compact: true })}<span className="ml-1 text-[11.5px] font-normal text-fg-subtle">{m.unit === '%' ? '%' : m.unit}</span></p>
                  <p className="text-[11.5px] text-fg-subtle">{total != null ? `Total over ${series.length} days` : `Latest: ${format(new Date(last.day + 'T00:00:00'), 'MMM d')}`}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[14px] font-medium text-fg-subtle">Not available</p>
                  <p className="text-[11.5px] text-fg-subtle">No imported data in this range</p>
                </>
              )}
            </div>
          );
        })}
      </div>
      {(rows ?? []).some((r) => r.metric === 'revenue_robux') && (
        <div className="mt-4"><DailyBarChart data={(rows ?? []).filter((r) => r.metric === 'revenue_robux').map((r) => ({ day: r.day, value: r.value }))} dataKey="value" name="Robux" /></div>
      )}
      {(rows ?? []).some((r) => r.metric === 'dau') && (
        <div className="mt-4"><DailyLineChart data={(rows ?? []).filter((r) => r.metric === 'dau').map((r) => ({ day: r.day, dau: r.value }))} lines={[{ key: 'dau', name: 'DAU' }]} /></div>
      )}
    </Card>
  );
}

/** Parses "date,value" CSVs (any header; first date-like and first numeric column). */
export function parseMetricCsv(text: string): { day: string; value: number }[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: { day: string; value: number }[] = [];
  for (const line of lines) {
    const cells = line.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim());
    const dateCell = cells.find((c) => !Number.isNaN(Date.parse(c)) && /\d{4}|\d{1,2}[/-]\d{1,2}/.test(c));
    const numCell = cells.filter((c) => c !== dateCell).map((c) => Number(c.replace(/[%\s]/g, '').replace(/,(?=\d{3}\b)/g, ''))).find((n) => Number.isFinite(n));
    if (!dateCell || numCell === undefined) continue;
    const d = new Date(dateCell);
    out.push({ day: format(d, 'yyyy-MM-dd'), value: numCell });
  }
  return out;
}

function ImportDialog({ open, onClose, projectId, onDone }: { open: boolean; onClose: () => void; projectId: string; onDone: () => void }) {
  const [metric, setMetric] = useState('revenue_robux');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseMetricCsv(text), [text]);
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await sb().from('analytics_metrics').upsert(parsed.map((r) => ({ project_id: projectId, metric, day: r.day, value: r.value, source: 'import' })), { onConflict: 'project_id,metric,day' });
      if (error) throw new Error(error.message);
      toast.success(`Imported ${parsed.length} days`);
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Import metrics" description="Paste or load a CSV with a date column and a value column (one row per day). Existing days are replaced." width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!parsed.length} onClick={submit}>Import {parsed.length || ''} rows</Button></>}>
      <div className="space-y-4">
        <Field label="Metric"><Select label="Metric" value={metric} onChange={setMetric} options={IMPORT_METRICS.map((m) => ({ value: m.key, label: `${m.label} (${m.unit})` }))} /></Field>
        <Field label="CSV" hint={parsed.length ? `${parsed.length} rows recognised, ${parsed[0].day} to ${parsed[parsed.length - 1].day}` : 'Example: 2026-11-01,1520'}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-mono text-[12px]" placeholder={'Date,Value\n2026-11-01,1520\n2026-11-02,1734'} />
        </Field>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-fg-muted hover:text-fg">
          <Download className="size-3.5" /> Load a .csv file
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        </label>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ compare

function CompareView({ ids, from, to, days }: { ids: string[]; from: number; to: number; days: number }) {
  const projects = useWorkspace((s) => s.projects.filter((p) => ids.includes(p.id)));
  const { rows, error } = useSnapshots(ids, from);
  const list = (rows ?? []).filter((r) => new Date(r.captured_at).getTime() <= to);
  if (!ids.length) return <EmptyState icon={<BarChart3 />} title="Pick experiences to compare" />;
  const byProject = (id: string) => list.filter((r) => r.project_id === id);
  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      <Card title="Players online" description="Solid, dashed and dotted lines tell experiences apart">
        {rows === null ? <Skeleton className="h-[260px]" /> : list.length < 2 ? <EmptyState compact icon={<Camera />} title="Not enough snapshots yet" body="Snapshots are captured every 15 minutes while Corel is open." /> : <PlayersChart rows={list} projects={projects.map((p) => ({ id: p.id, name: p.name }))} rangeDays={days} height={260} />}
      </Card>
      <Card title="Side by side" padded={false}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-fg-subtle">
              <th className="px-4 py-2 font-medium">Experience</th>
              <th className="px-4 py-2 text-right font-medium">Visits</th>
              <th className="px-4 py-2 text-right font-medium">Visits gained</th>
              <th className="px-4 py-2 text-right font-medium">Playing</th>
              <th className="px-4 py-2 text-right font-medium">Peak</th>
              <th className="px-4 py-2 text-right font-medium">Favorites</th>
              <th className="px-4 py-2 text-right font-medium">Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {projects.map((p, i) => {
              const r = byProject(p.id);
              const l: Snapshot | undefined = r[r.length - 1];
              const f = r[0];
              const ratio = l && l.up_votes != null && l.down_votes != null && l.up_votes + l.down_votes > 0 ? (l.up_votes / (l.up_votes + l.down_votes)) * 100 : null;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2"><span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded" style={{ background: SERIES_COLORS[i % 6] }} /><ProjectThumb project={p} size={18} />{p.name}</span></td>
                  <td className="tabular px-4 py-2 text-right">{num(l?.visits, { compact: true })}</td>
                  <td className="tabular px-4 py-2 text-right">{r.length > 1 && l?.visits != null && f?.visits != null ? `+${num(l.visits - f.visits, { compact: true })}` : '—'}</td>
                  <td className="tabular px-4 py-2 text-right">{num(l?.playing)}</td>
                  <td className="tabular px-4 py-2 text-right">{r.length ? num(Math.max(...r.map((x) => x.playing ?? 0))) : '—'}</td>
                  <td className="tabular px-4 py-2 text-right">{num(l?.favorites, { compact: true })}</td>
                  <td className="tabular px-4 py-2 text-right">{pct(ratio, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2 text-[11.5px] text-fg-subtle">“—” means no data was captured for that experience in this range (or Roblox doesn’t show it publicly), not zero.</p>
      </Card>
    </div>
  );
}

/** Deterministic sample data, only ever shown under a "Demo data" label. */
export function demoSnapshots(projectId: string, from: number): Snapshot[] {
  let seed = [...projectId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const out: Snapshot[] = [];
  let visits = 1_250_000;
  let fav = 18_400;
  for (let t = Math.max(from, Date.now() - 30 * 86400_000); t < Date.now(); t += 3600_000) {
    const h = new Date(t).getHours();
    const daily = 0.55 + 0.45 * Math.sin(((h - 9) / 24) * Math.PI * 2);
    const playing = Math.round(380 * daily + rand() * 60);
    visits += Math.round(playing * 0.9);
    fav += rand() > 0.6 ? Math.round(rand() * 8) : 0;
    out.push({ id: t, team_id: '', project_id: projectId, bucket: t, captured_at: new Date(t).toISOString(), visits, playing, favorites: fav, up_votes: 9200 + Math.round((t - from) / 3e6), down_votes: 1100 });
  }
  return out;
}

