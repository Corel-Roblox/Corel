// Domain components shared across pages: people, projects, bug/task status.
import * as React from 'react';
import { AlertOctagon, ArrowDown, ArrowUp, CircleCheck, CircleDashed, CircleDot, Circle, Equal, Minus, Timer, XCircle, Gamepad2 } from 'lucide-react';
import { Avatar, Badge, Select, Tooltip, type Option } from './ui';
import { displayName, useWorkspace } from '@/store/workspace';
import { useIsOnline, usePresence } from '@/store/presence';
import { cn, timeAgo } from '@/lib/format';
import type { BugStatus, Project, Severity, TaskPriority, TaskStatus } from '@/lib/types';

export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="230 190 564 644" width={size} height={size * (644 / 564)} className={className} aria-hidden>
      <path d="M512 214 770 363 512 512 254 363Z" fill="#4ADE80" />
      <path d="M254 363 512 512 512 810 254 661Z" fill="#22C55E" />
      <path d="M512 512 770 363 770 661 512 810Z" fill="#15803D" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <Logo size={16} />
      <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Corel</span>
    </span>
  );
}

export function UserAvatar({ userId, size = 22, presence = false, className }: { userId: string | null | undefined; size?: number; presence?: boolean; className?: string }) {
  const profile = useWorkspace((s) => (userId ? s.profiles[userId] : undefined));
  const online = useIsOnline(userId);
  if (!userId) return <span className="grid shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-fg-subtle" style={{ width: size, height: size }} aria-label="Unassigned" />;
  return <Avatar name={displayName(profile)} url={profile?.avatar_url} id={userId} size={size} online={presence ? online : undefined} className={className} />;
}

export function UserName({ userId, className }: { userId: string | null | undefined; className?: string }) {
  const profile = useWorkspace((s) => (userId ? s.profiles[userId] : undefined));
  return <span className={cn('truncate', className)}>{userId ? displayName(profile, 'Former member') : 'Unassigned'}</span>;
}

export function UserChip({ userId, size = 18 }: { userId: string | null | undefined; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <UserAvatar userId={userId} size={size} />
      <UserName userId={userId} className="text-[12.5px]" />
    </span>
  );
}

/** Avatars of teammates currently present, optionally filtered (e.g. viewing a project). */
export function PresenceStack({ filter, max = 4, size = 22 }: { filter?: (p: { route: string; project_id?: string | null; editing?: string | null }) => boolean; max?: number; size?: number }) {
  const online = usePresence((s) => s.online);
  const profiles = useWorkspace((s) => s.profiles);
  const people = Object.values(online).filter((p) => (filter ? filter(p) : true));
  if (!people.length) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {people.slice(0, max).map((p) => (
        <Tooltip key={p.user_id} content={`${displayName(profiles[p.user_id])} · online`}>
          <span className="rounded-full ring-2 ring-bg">
            <Avatar name={displayName(profiles[p.user_id])} url={profiles[p.user_id]?.avatar_url} id={p.user_id} size={size} />
          </span>
        </Tooltip>
      ))}
      {people.length > max && <span className="grid place-items-center rounded-full bg-active text-[10px] font-medium text-fg-muted ring-2 ring-bg" style={{ width: size, height: size }}>+{people.length - max}</span>}
    </div>
  );
}

export function LastActive({ userId }: { userId: string }) {
  const online = useIsOnline(userId);
  const profile = useWorkspace((s) => s.profiles[userId]);
  if (online) return <span className="inline-flex items-center gap-1.5 text-[12px] text-success"><span className="live-dot size-1.5 rounded-full bg-success" />Online</span>;
  return <span className="text-[12px] text-fg-subtle">Last active {timeAgo(profile?.last_seen_at)}</span>;
}

// ------------------------------------------------------------------ bugs

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
export const BUG_STATUSES: BugStatus[] = ['reported', 'confirmed', 'in_progress', 'fixed', 'closed'];

const sevMeta: Record<Severity, { label: string; tone: 'danger' | 'warning' | 'info' | 'neutral'; icon: React.ReactNode }> = {
  critical: { label: 'Critical', tone: 'danger', icon: <AlertOctagon className="size-3" /> },
  high: { label: 'High', tone: 'warning', icon: <ArrowUp className="size-3" /> },
  medium: { label: 'Medium', tone: 'info', icon: <Equal className="size-3" /> },
  low: { label: 'Low', tone: 'neutral', icon: <ArrowDown className="size-3" /> },
};
export const severityLabel = (s: Severity) => sevMeta[s].label;
export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = sevMeta[severity];
  return (
    <Badge tone={m.tone}>
      {m.icon}
      {m.label}
    </Badge>
  );
}

const statusMeta: Record<BugStatus, { label: string; icon: React.ReactNode; color: string }> = {
  reported: { label: 'Reported', icon: <CircleDashed className="size-3.5" />, color: 'text-fg-muted' },
  confirmed: { label: 'Confirmed', icon: <CircleDot className="size-3.5" />, color: 'text-info' },
  in_progress: { label: 'In progress', icon: <Timer className="size-3.5" />, color: 'text-warning' },
  fixed: { label: 'Fixed', icon: <CircleCheck className="size-3.5" />, color: 'text-success' },
  closed: { label: 'Closed', icon: <XCircle className="size-3.5" />, color: 'text-fg-subtle' },
};
export const bugStatusLabel = (s: BugStatus) => statusMeta[s].label;
export function BugStatusIcon({ status }: { status: BugStatus }) {
  return <span className={cn('inline-flex', statusMeta[status].color)} aria-label={statusMeta[status].label}>{statusMeta[status].icon}</span>;
}
export function BugStatusLabel({ status }: { status: BugStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px]', statusMeta[status].color)}>
      {statusMeta[status].icon}
      <span className="text-fg">{statusMeta[status].label}</span>
    </span>
  );
}
export const bugStatusOptions: Option<BugStatus>[] = BUG_STATUSES.map((s) => ({ value: s, label: statusMeta[s].label, icon: <span className={statusMeta[s].color}>{statusMeta[s].icon}</span> }));
export const severityOptions: Option<Severity>[] = SEVERITIES.map((s) => ({ value: s, label: sevMeta[s].label, icon: <span className={cn({ danger: 'text-danger', warning: 'text-warning', info: 'text-info', neutral: 'text-fg-muted' }[sevMeta[s].tone])}>{sevMeta[s].icon}</span> }));
export const isOpenBug = (s: BugStatus) => s !== 'fixed' && s !== 'closed';

// ------------------------------------------------------------------ tasks

export const TASK_STATUSES: { value: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'todo', label: 'To do', icon: <Circle className="size-3.5 text-fg-muted" /> },
  { value: 'in_progress', label: 'In progress', icon: <Timer className="size-3.5 text-warning" /> },
  { value: 'done', label: 'Done', icon: <CircleCheck className="size-3.5 text-success" /> },
];
export const PRIORITIES: { value: TaskPriority; label: string; icon: React.ReactNode }[] = [
  { value: 'urgent', label: 'Urgent', icon: <AlertOctagon className="size-3.5 text-danger" /> },
  { value: 'high', label: 'High', icon: <ArrowUp className="size-3.5 text-warning" /> },
  { value: 'medium', label: 'Medium', icon: <Equal className="size-3.5 text-info" /> },
  { value: 'low', label: 'Low', icon: <ArrowDown className="size-3.5 text-fg-muted" /> },
  { value: 'none', label: 'No priority', icon: <Minus className="size-3.5 text-fg-subtle" /> },
];

// ------------------------------------------------------------------ pickers

export function ProjectThumb({ project, size = 28 }: { project: Pick<Project, 'name' | 'thumbnail_url' | 'id'> | undefined; size?: number }) {
  const [broken, setBroken] = React.useState(false);
  if (project?.thumbnail_url && !broken) return <img src={project.thumbnail_url} alt="" onError={() => setBroken(true)} className="shrink-0 rounded-md object-cover ring-1 ring-line" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-md border border-line bg-raised text-fg-subtle" style={{ width: size, height: size }} aria-hidden>
      <Gamepad2 style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export function ProjectSelect({ value, onChange, allowAll, noneLabel, label = 'Project', size, includeArchived, filter }: { value: string; onChange: (v: string) => void; allowAll?: string; noneLabel?: string; label?: string; size?: 'sm' | 'md'; includeArchived?: boolean; filter?: (p: Project) => boolean }) {
  const projects = useWorkspace((s) => s.projects);
  const opts: Option[] = [
    ...(allowAll ? [{ value: 'all', label: allowAll }] : []),
    ...(noneLabel ? [{ value: 'none', label: noneLabel }] : []),
    ...projects.filter((p) => (includeArchived || !p.archived) && (!filter || filter(p))).map((p) => ({ value: p.id, label: p.name, icon: <ProjectThumb project={p} size={16} /> })),
  ];
  return <Select label={label} value={value} onChange={onChange} options={opts} size={size} placeholder="Choose a project" />;
}

export function MemberSelect({ value, onChange, label = 'Assignee', size, allowNone = true, allowAll }: { value: string | null; onChange: (v: string | null) => void; label?: string; size?: 'sm' | 'md'; allowNone?: boolean; allowAll?: string }) {
  const members = useWorkspace((s) => s.members);
  const profiles = useWorkspace((s) => s.profiles);
  const opts: Option[] = [
    ...(allowAll ? [{ value: 'all', label: allowAll }] : []),
    ...(allowNone ? [{ value: 'none', label: 'Unassigned', icon: <span className="size-4 rounded-full border border-dashed border-line-strong" /> }] : []),
    ...members
      .filter((m) => m.role !== 'viewer' || m.user_id === value)
      .map((m) => ({ value: m.user_id, label: displayName(profiles[m.user_id]), icon: <Avatar name={displayName(profiles[m.user_id])} url={profiles[m.user_id]?.avatar_url} id={m.user_id} size={16} /> })),
  ];
  return <Select label={label} value={value ?? (allowAll ? 'all' : 'none')} onChange={(v) => onChange(v === 'none' ? null : v)} options={opts} size={size} />;
}
