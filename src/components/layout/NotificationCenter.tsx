import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, Bug, CheckCheck, CheckSquare, Code2, FolderKanban, Mail, Rocket, Settings, Trash2, X } from 'lucide-react';
import { Button, EmptyState, IconButton, Segmented, Sheet } from '@/components/ui';
import { UserAvatar } from '@/components/common';
import { useNotifications } from '@/store/notifications';
import { useUI } from '@/store/ui';
import { cn, timeAgo } from '@/lib/format';
import type { Notification } from '@/lib/types';

const KIND_ICON: Record<string, React.ReactNode> = {
  bug_assigned: <Bug />,
  bug_update: <Bug />,
  comment: <AtSign />,
  invite: <Mail />,
  project_change: <FolderKanban />,
  task_update: <CheckSquare />,
  script_edit: <Code2 />,
  publish: <Rocket />,
};

export function linkFor(n: Notification): string {
  const l = n.link || {};
  switch (l.type) {
    case 'bug':
      return `/bugs/${l.id}`;
    case 'task':
      return `/projects/${l.project}/tasks?task=${l.id}`;
    case 'project':
      return `/projects/${l.id}`;
    case 'script':
      return `/scripts/${l.id}`;
    case 'publish':
      return `/projects/${l.id}/publish`;
    case 'invite':
      return '/team/invitations';
    default:
      return '/';
  }
}

export function NotificationCenter() {
  const open = useUI((s) => s.notifications);
  const set = useUI((s) => s.set);
  const { items, markRead, remove, clearRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const navigate = useNavigate();
  const list = filter === 'unread' ? items.filter((n) => !n.read_at) : items;
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <Sheet open={open} onOpenChange={(o) => set({ notifications: o })} width={420} label="Notifications">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Bell className="size-4 text-fg-muted" />
        <h2 className="flex-1 text-[14px] font-semibold">Notifications</h2>
        <IconButton label="Notification settings" onClick={() => { set({ notifications: false }); navigate('/settings/notifications'); }}>
          <Settings className="size-3.5" />
        </IconButton>
        <IconButton label="Close" onClick={() => set({ notifications: false })}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <Segmented label="Filter notifications" size="xs" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` }]} />
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" icon={<CheckCheck className="size-3" />} disabled={!unread} onClick={() => markRead()}>
            Mark all read
          </Button>
          <Button size="xs" variant="ghost" icon={<Trash2 className="size-3" />} disabled={!items.some((n) => n.read_at)} onClick={() => clearRead()}>
            Clear read
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyState icon={<Bell />} title={filter === 'unread' ? 'All caught up' : 'No notifications yet'} body="Assignments, comments, invitations, script edits and publishing updates show up here as they happen." />
        ) : (
          <ul>
            {list.map((n) => (
              <li key={n.id} className="group relative border-b border-line">
                <button
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                  onClick={() => {
                    markRead([n.id]);
                    set({ notifications: false });
                    navigate(linkFor(n));
                  }}
                >
                  <span className="relative mt-0.5">
                    {n.actor_id ? <UserAvatar userId={n.actor_id} size={26} /> : <span className="grid size-[26px] place-items-center rounded-full bg-raised text-fg-muted [&>svg]:size-3.5">{KIND_ICON[n.kind] ?? <Bell />}</span>}
                    <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-overlay text-fg-muted ring-2 ring-panel [&>svg]:size-2.5">{KIND_ICON[n.kind] ?? <Bell />}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', n.read_at ? 'text-fg-muted' : 'font-medium text-fg')}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block truncate text-[12px] text-fg-subtle">{n.body}</span>}
                    <span className="mt-1 block text-[11.5px] text-fg-subtle">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </button>
                <IconButton label="Dismiss" size="xs" className="absolute right-3 top-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => remove(n.id)}>
                  <X className="size-3" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
