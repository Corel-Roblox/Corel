import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon, Bug, CheckSquare, Code2, FolderKanban, MessageSquare, Rocket, UserPlus } from 'lucide-react';
import { EmptyState, Select } from './ui';
import { ProjectSelect, UserAvatar } from './common';
import { displayName, useWorkspace } from '@/store/workspace';
import { timeAgo } from '@/lib/format';
import type { Activity } from '@/lib/types';

/** Re-renders every `ms` so relative times and countdowns stay current. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  bug: <Bug />,
  task: <CheckSquare />,
  script: <Code2 />,
  project: <FolderKanban />,
  member: <UserPlus />,
  update: <Rocket />,
};

export const ACTIVITY_TYPES = [
  { value: 'all', label: 'All events' },
  { value: 'bug', label: 'Bugs' },
  { value: 'task', label: 'Tasks' },
  { value: 'script', label: 'Scripts' },
  { value: 'update', label: 'Publishing' },
  { value: 'project', label: 'Projects' },
  { value: 'member', label: 'Members' },
  { value: 'comment', label: 'Comments' },
];

export function activityLink(a: Activity): string | null {
  switch (a.entity_type) {
    case 'bug':
      return `/bugs/${a.entity_id}`;
    case 'task':
      return a.project_id ? `/projects/${a.project_id}/tasks?task=${a.entity_id}` : null;
    case 'script':
      return `/scripts/${a.entity_id}`;
    case 'project':
      return `/projects/${a.entity_id}`;
    case 'update':
      return a.project_id ? `/projects/${a.project_id}/publish` : '/publish';
    case 'member':
      return '/team';
    default:
      return null;
  }
}

export function ActivityRow({ a, showProject = true }: { a: Activity; showProject?: boolean }) {
  const actor = useWorkspace((s) => (a.actor_id ? s.profiles[a.actor_id] : undefined));
  const project = useWorkspace((s) => s.projects.find((p) => p.id === a.project_id));
  const link = activityLink(a);
  const body = (
    <>
      <span className="relative mt-0.5 shrink-0">
        <UserAvatar userId={a.actor_id} size={22} />
        <span className="absolute -bottom-1 -right-1 grid size-3.5 place-items-center rounded-full bg-overlay text-fg-muted ring-2 ring-panel [&>svg]:size-2">{a.verb === 'commented' ? <MessageSquare /> : TYPE_ICON[a.entity_type] ?? <ActivityIcon />}</span>
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <span className="font-medium text-fg">{displayName(actor, 'Someone')}</span> <span className="text-fg-muted">{a.summary}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
          {timeAgo(a.created_at)}
          {showProject && project && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{project.name}</span>
            </>
          )}
        </span>
      </span>
    </>
  );
  return link ? (
    <Link to={link} className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-hover">
      {body}
    </Link>
  ) : (
    <div className="flex items-start gap-2.5 px-2 py-2">{body}</div>
  );
}

export function ActivityFeed({ projectId, limit, filters = true, compact }: { projectId?: string; limit?: number; filters?: boolean; compact?: boolean }) {
  const all = useWorkspace((s) => s.activity);
  const [project, setProject] = useState(projectId ?? 'all');
  const [type, setType] = useState('all');
  const list = useMemo(
    () =>
      all
        .filter((a) => (project === 'all' ? true : a.project_id === project))
        .filter((a) => (type === 'all' ? true : type === 'comment' ? a.verb === 'commented' : a.entity_type === type && a.verb !== 'commented'))
        .slice(0, limit ?? 300),
    [all, project, type, limit],
  );
  return (
    <div className="flex flex-col">
      {filters && (
        <div className="mb-2 flex gap-2">
          {!projectId && <div className="w-[200px]"><ProjectSelect value={project} onChange={setProject} allowAll="All projects" size="sm" label="Filter by project" includeArchived /></div>}
          <div className="w-[160px]"><Select label="Filter by event type" size="sm" value={type} onChange={setType} options={ACTIVITY_TYPES} /></div>
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState compact={compact} icon={<ActivityIcon />} title="No activity yet" body="Bugs, tasks, script edits, scheduled updates and new members appear here live." />
      ) : (
        <div className="flex flex-col">
          {list.map((a) => (
            <ActivityRow key={a.id} a={a} showProject={!projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
