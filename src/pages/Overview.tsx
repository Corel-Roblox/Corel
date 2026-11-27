import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bug, CheckCircle2, CheckSquare, Code2, Eye, EyeOff, FolderKanban, GripVertical, LayoutGrid, Plus, Rocket, Settings2, UserPlus, Users } from 'lucide-react';
import { Page } from '@/components/layout/Shell';
import { Button, Card, Dialog, EmptyState, IconButton, Stat, Switch } from '@/components/ui';
import { BugStatusIcon, PresenceStack, ProjectThumb, SeverityBadge, UserAvatar, isOpenBug, PRIORITIES } from '@/components/common';
import { ActivityFeed, useNow } from '@/components/activity';
import { Sparkline } from '@/components/charts';
import { usePrefs, WIDGETS, type WidgetId } from '@/store/prefs';
import { useUI } from '@/store/ui';
import { useMe, useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';
import { usePresence } from '@/store/presence';
import { getSupabase } from '@/lib/supabase';
import { ago, cn, countdown, longDate, num } from '@/lib/format';
import { hasPerm } from '@/lib/perms';
import type { Snapshot } from '@/lib/types';
import { isDemo } from '@/dev/demo';
import { demoSnapshots } from './Analytics';

export function OverviewPage() {
  const profile = useSession((s) => s.profile);
  const order = usePrefs((s) => s.widgetOrder);
  const hidden = usePrefs((s) => s.hiddenWidgets);
  const setPrefs = usePrefs((s) => s.set);
  const [customize, setCustomize] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const visible = [...order, ...WIDGETS.map((w) => w.id).filter((id) => !order.includes(id))].filter((id) => !hidden.includes(id));

  const move = (from: WidgetId, to: WidgetId) => {
    if (from === to) return;
    const list = visible.filter((x) => x !== from);
    list.splice(list.indexOf(to), 0, from);
    setPrefs({ widgetOrder: [...list, ...order.filter((x) => !list.includes(x))] });
  };

  return (
    <Page wide>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{greeting}{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">Here’s what’s happening across your workspace.</p>
        </div>
        <div className="flex items-center gap-2">
          <QuickActions />
          <IconButton label="Customize dashboard" variant="outline" size="md" onClick={() => setCustomize(true)}><Settings2 className="size-4" /></IconButton>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-3">
        {visible.map((id) => (
          <div
            key={id}
            draggable
            onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragging && dragging !== id) { e.preventDefault(); } }}
            onDrop={() => { if (dragging) move(dragging, id); setDragging(null); }}
            onDragEnd={() => setDragging(null)}
            className={cn('group/w relative flex min-w-0 flex-col [&>section]:flex-1', SPAN[id], dragging === id && 'opacity-40')}
          >
            <span className="pointer-events-none absolute -left-1 top-3 z-10 text-fg-subtle opacity-0 transition-opacity group-hover/w:opacity-60" aria-hidden><GripVertical className="size-3.5" /></span>
            <Widget id={id} />
          </div>
        ))}
        {visible.length === 0 && <div className="col-span-12"><EmptyState icon={<LayoutGrid />} title="All widgets are hidden" action={<Button onClick={() => setCustomize(true)}>Customize</Button>} /></div>}
      </div>
      <Dialog open={customize} onOpenChange={setCustomize} title="Customize dashboard" description="Show, hide and reorder widgets. You can also drag widgets on the dashboard." width={440}
        footer={<><Button variant="ghost" onClick={() => setPrefs({ widgetOrder: WIDGETS.map((w) => w.id), hiddenWidgets: [] })}>Reset</Button><Button variant="primary" onClick={() => setCustomize(false)}>Done</Button></>}>
        <ul className="space-y-1">
          {[...order, ...WIDGETS.map((w) => w.id).filter((id) => !order.includes(id))].map((id, i, arr) => {
            const w = WIDGETS.find((x) => x.id === id)!;
            const on = !hidden.includes(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
                {on ? <Eye className="size-3.5 text-fg-muted" /> : <EyeOff className="size-3.5 text-fg-subtle" />}
                <span className={cn('flex-1 text-[13px]', !on && 'text-fg-subtle')}>{w.label}</span>
                <Button size="xs" variant="ghost" disabled={i === 0} aria-label={`Move ${w.label} up`} onClick={() => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setPrefs({ widgetOrder: a }); }}>↑</Button>
                <Button size="xs" variant="ghost" disabled={i === arr.length - 1} aria-label={`Move ${w.label} down`} onClick={() => { const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setPrefs({ widgetOrder: a }); }}>↓</Button>
                <Switch checked={on} label={`Show ${w.label}`} onChange={(v) => setPrefs({ hiddenWidgets: v ? hidden.filter((x) => x !== id) : [...hidden, id] })} />
              </li>
            );
          })}
        </ul>
      </Dialog>
    </Page>
  );
}

const SPAN: Record<WidgetId, string> = {
  stats: 'col-span-12',
  upcoming: 'col-span-12 xl:col-span-5',
  activity: 'col-span-12 xl:col-span-7',
  bugs: 'col-span-12 xl:col-span-6',
  performance: 'col-span-12 xl:col-span-6',
  scripts: 'col-span-12 md:col-span-6 xl:col-span-6',
  tasks: 'col-span-12 md:col-span-6 xl:col-span-6',
  projects: 'col-span-12 xl:col-span-6',
};

function Widget({ id }: { id: WidgetId }) {
  switch (id) {
    case 'stats':
      return <StatsWidget />;
    case 'upcoming':
      return <UpcomingWidget />;
    case 'activity':
      return <Card title="Recent activity" description="Live from your team" padded={false} action={<Link to="/team/activity" className="text-[12px] text-fg-muted hover:text-fg">View all</Link>}><div className="max-h-[236px] overflow-y-auto p-2"><ActivityFeed limit={25} filters={false} compact /></div></Card>;
    case 'bugs':
      return <RecentBugsWidget />;
    case 'performance':
      return <PerformanceWidget />;
    case 'scripts':
      return <ScriptsWidget />;
    case 'tasks':
      return <MyTasksWidget />;
    case 'projects':
      return <ProjectsWidget />;
  }
}

function QuickActions() {
  const openCreate = useUI((s) => s.openCreate);
  const navigate = useNavigate();
  const me = useMe();
  return (
    <div className="flex gap-1.5">
      <Button size="sm" icon={<Bug className="size-3.5" />} onClick={() => openCreate('bug')}>Report bug</Button>
      <Button size="sm" icon={<Rocket className="size-3.5" />} onClick={() => navigate('/publish')}>Schedule update</Button>
      <Button size="sm" icon={<Code2 className="size-3.5" />} disabled={!hasPerm(me, 'manage_scripts')} onClick={() => openCreate('script')}>New script</Button>
      {hasPerm(me, 'manage_projects') && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => openCreate('project')}>New project</Button>}
      {hasPerm(me, 'manage_members') && <Button size="sm" variant="primary" icon={<UserPlus className="size-3.5" />} onClick={() => openCreate('invite')}>Invite</Button>}
    </div>
  );
}

function StatsWidget() {
  const navigate = useNavigate();
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const members = useWorkspace((s) => s.members);
  const bugs = useWorkspace((s) => s.bugs);
  const tasks = useWorkspace((s) => s.tasks);
  const online = usePresence((s) => Object.keys(s.online).length);
  const open = bugs.filter((b) => isOpenBug(b.status));
  const monthAgo = Date.now() - 30 * 86400_000;
  const completed = tasks.filter((t) => t.completed_at && new Date(t.completed_at).getTime() > monthAgo).length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Projects" value={projects.length} icon={<FolderKanban />} hint={`${projects.filter((p) => p.universe_id).length} linked to Roblox`} onClick={() => navigate('/projects')} />
      <Stat label="Active members" value={<span>{online}<span className="text-[15px] font-normal text-fg-subtle"> / {members.length}</span></span>} icon={<Users />} hint={<PresenceStack size={18} max={6} />} onClick={() => navigate('/team')} />
      <Stat label="Open bugs" value={open.length} icon={<Bug />} tone={open.some((b) => b.severity === 'critical') ? 'danger' : undefined} hint={`${open.filter((b) => b.severity === 'critical').length} critical · ${open.filter((b) => !b.assignee_id).length} unassigned`} onClick={() => navigate('/bugs')} />
      <Stat label="Tasks completed" value={completed} icon={<CheckCircle2 />} hint="Last 30 days" tone={completed ? 'success' : undefined} />
    </div>
  );
}

function UpcomingWidget() {
  const publish = useWorkspace((s) => s.publish.filter((u) => ['preparing', 'scheduled', 'restoring'].includes(u.status)).sort((a, b) => a.update_at.localeCompare(b.update_at)));
  const projects = useWorkspace((s) => s.projects);
  const now = useNow(1000);
  return (
    <Card title="Upcoming updates" padded={false} action={<Link to="/publish" className="text-[12px] text-fg-muted hover:text-fg">Publish</Link>}>
      {publish.length === 0 ? <EmptyState compact icon={<Rocket />} title="Nothing scheduled" body="Schedule an icon update with a countdown from Publish." /> : (
        <ul className="divide-y divide-line">
          {publish.slice(0, 5).map((u) => {
            const p = projects.find((x) => x.id === u.project_id);
            const live = [...u.steps].reverse().find((s) => s.apply === 'live');
            return (
              <li key={u.id}>
                <Link to={`/projects/${u.project_id}/publish`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
                  <ProjectThumb project={p} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{u.announcement_title || p?.name}</p>
                    <p className="truncate text-[11.5px] text-fg-subtle">{longDate(u.update_at)}{live && ` · ${live.label} live`}</p>
                  </div>
                  <span className="tabular text-[15px] font-semibold text-accent-text">{countdown(new Date(u.update_at).getTime() - now)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentBugsWidget() {
  const bugs = useWorkspace((s) => s.bugs.slice(0, 6));
  return (
    <Card title="Recent bug reports" padded={false} action={<Link to="/bugs" className="text-[12px] text-fg-muted hover:text-fg">All bugs</Link>}>
      {bugs.length === 0 ? <EmptyState compact icon={<Bug />} title="No bugs reported" /> : (
        <ul className="divide-y divide-line">
          {bugs.map((b) => (
            <li key={b.id}>
              <Link to={`/bugs/${b.id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-hover">
                <BugStatusIcon status={b.status} />
                <span className="flex-1 truncate text-[13px]">{b.title}</span>
                <SeverityBadge severity={b.severity} />
                <span className="w-[40px] text-right text-[11.5px] text-fg-subtle">{ago(b.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PerformanceWidget() {
  const projects = useWorkspace((s) => s.projects.filter((p) => p.universe_id && !p.archived));
  const me = useMe();
  const [rows, setRows] = useState<Snapshot[] | null>(null);
  const ids = projects.map((p) => p.id).join(',');
  useEffect(() => {
    const supabase = getSupabase();
    if (isDemo()) {
      setRows(projects.flatMap((p) => demoSnapshots(p.id, Date.now() - 2 * 86400_000)));
      return;
    }
    if (!supabase || !projects.length || !hasPerm(me, 'view_analytics')) {
      setRows([]);
      return;
    }
    supabase.from('analytics_snapshots').select('*').in('project_id', projects.map((p) => p.id)).gte('captured_at', new Date(Date.now() - 2 * 86400_000).toISOString()).order('captured_at').limit(5000).then(({ data }) => setRows((data as Snapshot[]) || []));
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const byProject = useMemo(() => projects.map((p) => ({ p, list: (rows ?? []).filter((r) => r.project_id === p.id) })), [rows, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Game performance" description="Players online, last 48 hours" padded={false} action={<Link to="/analytics" className="text-[12px] text-fg-muted hover:text-fg">Analytics</Link>}>
      {!hasPerm(me, 'view_analytics') ? <p className="p-4 text-[12.5px] text-fg-subtle">You don’t have access to analytics.</p> : projects.length === 0 ? <EmptyState compact icon={<LayoutGrid />} title="No linked experiences" body="Link a Roblox experience to a project to track its numbers." /> : (
        <ul className="divide-y divide-line">
          {byProject.slice(0, 6).map(({ p, list }) => {
            const last = list[list.length - 1];
            return (
              <li key={p.id}>
                <Link to="/analytics" className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
                  <ProjectThumb project={p} size={28} />
                  <span className="w-[160px] truncate text-[13px]">{p.name}</span>
                  <span className="flex-1"><Sparkline values={list.map((r) => r.playing ?? 0)} width={160} height={26} /></span>
                  <span className="w-[80px] text-right"><span className="tabular block text-[13px] font-medium">{num(last?.playing)}</span><span className="text-[11px] text-fg-subtle">playing</span></span>
                  <span className="w-[80px] text-right"><span className="tabular block text-[13px] font-medium">{num(last?.visits, { compact: true })}</span><span className="text-[11px] text-fg-subtle">visits</span></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ScriptsWidget() {
  const scripts = useWorkspace((s) => [...s.scripts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6));
  return (
    <Card title="Recently edited scripts" padded={false} action={<Link to="/scripts" className="text-[12px] text-fg-muted hover:text-fg">Library</Link>}>
      {scripts.length === 0 ? <EmptyState compact icon={<Code2 />} title="No scripts yet" /> : (
        <ul className="divide-y divide-line">
          {scripts.map((s) => (
            <li key={s.id}>
              <Link to={`/scripts/${s.id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-hover">
                <Code2 className="size-3.5 text-fg-subtle" />
                <span className="flex-1 truncate text-[13px]">{s.name}</span>
                <UserAvatar userId={s.updated_by} size={18} />
                <span className="w-[64px] whitespace-nowrap text-right text-[11.5px] text-fg-subtle">v{s.version} · {ago(s.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MyTasksWidget() {
  const uid = useSession((s) => s.user?.id);
  const tasks = useWorkspace((s) => s.tasks.filter((t) => t.assignee_id === uid && t.status !== 'done'));
  const projects = useWorkspace((s) => s.projects);
  const rank = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
  const list = [...tasks].sort((a, b) => rank[a.priority] - rank[b.priority] || (a.due_date ?? '9').localeCompare(b.due_date ?? '9')).slice(0, 7);
  return (
    <Card title="My tasks" description={`${tasks.length} open`} padded={false}>
      {list.length === 0 ? <EmptyState compact icon={<CheckSquare />} title="No tasks assigned to you" /> : (
        <ul className="divide-y divide-line">
          {list.map((t) => (
            <li key={t.id}>
              <Link to={`/projects/${t.project_id}/tasks?task=${t.id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-hover">
                {PRIORITIES.find((p) => p.value === t.priority)?.icon}
                <span className="flex-1 truncate text-[13px]">{t.title}</span>
                <span className="max-w-[120px] truncate text-[11.5px] text-fg-subtle">{projects.find((p) => p.id === t.project_id)?.name}</span>
                {t.due_date && <span className={cn('text-[11.5px]', new Date(t.due_date + 'T23:59:59') < new Date() ? 'text-danger' : 'text-fg-subtle')}>{new Date(t.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProjectsWidget() {
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived).slice(0, 6));
  const bugs = useWorkspace((s) => s.bugs);
  const tasks = useWorkspace((s) => s.tasks);
  return (
    <Card title="Projects" padded={false} action={<Link to="/projects" className="text-[12px] text-fg-muted hover:text-fg">All projects</Link>}>
      {projects.length === 0 ? <EmptyState compact icon={<FolderKanban />} title="No projects yet" /> : (
        <ul className="divide-y divide-line">
          {projects.map((p) => {
            const t = tasks.filter((x) => x.project_id === p.id);
            const done = t.filter((x) => x.status === 'done').length;
            return (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
                  <ProjectThumb project={p} size={28} />
                  <span className="flex-1 truncate text-[13px] font-medium">{p.name}</span>
                  <span className="text-[11.5px] text-fg-muted">{bugs.filter((b) => b.project_id === p.id && isOpenBug(b.status)).length} bugs</span>
                  <span className="flex w-[110px] items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-active"><span className="block h-full rounded-full bg-accent" style={{ width: `${t.length ? (done / t.length) * 100 : 0}%` }} /></span>
                    <span className="tabular text-[11px] text-fg-subtle">{done}/{t.length}</span>
                  </span>
                  <PresenceStack filter={(x) => x.project_id === p.id} size={18} max={2} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

