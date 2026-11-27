import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertOctagon, Bug, CircleCheck, CircleDashed, Plus } from 'lucide-react';
import { Page } from '@/components/layout/Shell';
import { Button, Card, PageHeader, Stat, Kbd } from '@/components/ui';
import { BugDetailSheet, BugTable } from '@/components/bugs';
import { UserAvatar, UserName, isOpenBug, SEVERITIES, severityLabel } from '@/components/common';
import { useUI } from '@/store/ui';
import { useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';
import { cn } from '@/lib/format';

const SEV_COLOR = { critical: 'bg-danger', high: 'bg-warning', medium: 'bg-info', low: 'bg-fg-subtle' } as const;

export function BugsPage() {
  const { bugId } = useParams();
  const navigate = useNavigate();
  const bugs = useWorkspace((s) => s.bugs);
  const members = useWorkspace((s) => s.members);
  const uid = useSession((s) => s.user?.id);
  const openCreate = useUI((s) => s.openCreate);
  const [filter, setFilter] = useState<{ assignee?: string; status?: string }>({});

  const stats = useMemo(() => {
    const open = bugs.filter((b) => isOpenBug(b.status));
    const weekAgo = Date.now() - 7 * 86400_000;
    return {
      total: bugs.length,
      open: open.length,
      critical: open.filter((b) => b.severity === 'critical').length,
      fixedWeek: bugs.filter((b) => b.fixed_at && new Date(b.fixed_at).getTime() > weekAgo).length,
      mine: open.filter((b) => b.assignee_id === uid).length,
      bySeverity: SEVERITIES.map((s) => ({ s, n: open.filter((b) => b.severity === s).length })),
      byDev: [...members.map((m) => m.user_id), null]
        .map((id) => ({ id, open: open.filter((b) => b.assignee_id === id).length, fixed: bugs.filter((b) => b.assignee_id === id && b.fixed_at && new Date(b.fixed_at).getTime() > weekAgo).length }))
        .filter((d) => d.open || d.fixed)
        .sort((a, b) => b.open - a.open),
      recentFixed: bugs.filter((b) => b.fixed_at).sort((a, b) => (b.fixed_at ?? '').localeCompare(a.fixed_at ?? '')).slice(0, 5),
    };
  }, [bugs, members, uid]);
  const maxDev = Math.max(1, ...stats.byDev.map((d) => d.open));

  return (
    <Page wide>
      <PageHeader
        title="Bugs"
        description="Report, assign and fix bugs together. Changes appear for everyone instantly."
        actions={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate('bug')}>Report bug <Kbd>C</Kbd></Button>}
      />
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total bugs" value={stats.total} icon={<Bug />} onClick={() => setFilter({ status: 'all', assignee: undefined })} />
        <Stat label="Unresolved" value={stats.open} icon={<CircleDashed />} hint={stats.mine ? `${stats.mine} assigned to you` : 'None assigned to you'} onClick={() => setFilter({ status: 'open' })} />
        <Stat label="Critical open" value={stats.critical} icon={<AlertOctagon />} tone={stats.critical ? 'danger' : undefined} onClick={() => setFilter({ status: 'open' })} />
        <Stat label="Fixed in the last 7 days" value={stats.fixedWeek} icon={<CircleCheck />} tone={stats.fixedWeek ? 'success' : undefined} onClick={() => setFilter({ status: 'fixed' })} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Card title="Open by severity">
          {stats.open === 0 ? (
            <p className="text-[12.5px] text-fg-subtle">No unresolved bugs.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-active">
                {stats.bySeverity.map(({ s, n }) => n > 0 && <div key={s} className={SEV_COLOR[s]} style={{ width: `${(n / stats.open) * 100}%` }} title={`${severityLabel(s)}: ${n}`} />)}
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {stats.bySeverity.map(({ s, n }) => (
                  <li key={s} className="flex items-center gap-2 text-[12.5px]"><span className={cn('size-2 rounded-sm', SEV_COLOR[s])} /><span className="flex-1 text-fg-muted">{severityLabel(s)}</span><span className="tabular font-medium">{n}</span></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title="Assigned to each developer" description="Open bugs · fixed this week" padded={false}>
          <div className="max-h-[164px] overflow-y-auto px-2 py-2">
            {stats.byDev.length === 0 ? <p className="px-2 py-1 text-[12.5px] text-fg-subtle">Nothing assigned yet.</p> : stats.byDev.map((d) => (
              <button key={d.id ?? 'none'} onClick={() => setFilter({ assignee: d.id ?? (null as unknown as string), status: 'open' })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                <UserAvatar userId={d.id} size={20} presence={!!d.id} />
                <UserName userId={d.id} className="w-[110px] text-[12.5px]" />
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-active"><span className="block h-full rounded-full bg-accent" style={{ width: `${(d.open / maxDev) * 100}%` }} /></span>
                <span className="tabular w-6 text-right text-[12.5px] font-medium">{d.open}</span>
                <span className="tabular w-8 text-right text-[11.5px] text-success">{d.fixed ? `+${d.fixed}` : ''}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card title="Recently fixed" padded={false}>
          <div className="px-2 py-2">
            {stats.recentFixed.length === 0 ? <p className="px-2 py-1 text-[12.5px] text-fg-subtle">Nothing fixed yet.</p> : stats.recentFixed.map((b) => (
              <button key={b.id} onClick={() => navigate(`/bugs/${b.id}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                <CircleCheck className="size-3.5 shrink-0 text-success" />
                <span className="font-mono text-[11px] text-fg-subtle">BUG-{b.number}</span>
                <span className="flex-1 truncate text-[12.5px]">{b.title}</span>
                <UserAvatar userId={b.assignee_id} size={18} />
              </button>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-5">
        <BugTable initialFilter={filter} />
      </div>
      <BugDetailSheet bugId={bugId} onClose={() => navigate('/bugs')} />
    </Page>
  );
}
