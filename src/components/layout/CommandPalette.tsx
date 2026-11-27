// Global search (Ctrl+K): projects, bugs, scripts, tasks and members are searched
// locally from the live workspace; comments and older activity are searched on the
// server as you type.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import * as RDialog from '@radix-ui/react-dialog';
import { Activity as ActivityIcon, BarChart3, Bug, CheckSquare, Code2, FolderKanban, LayoutDashboard, MessageSquare, Moon, Plus, Rocket, Settings, Sun, UserPlus, Users } from 'lucide-react';
import { useUI } from '@/store/ui';
import { displayName, useWorkspace } from '@/store/workspace';
import { usePrefs } from '@/store/prefs';
import { getSupabase } from '@/lib/supabase';
import { Kbd } from '@/components/ui';
import { ProjectThumb, UserAvatar, BugStatusIcon } from '@/components/common';
import type { Activity, Comment } from '@/lib/types';
import { timeAgo } from '@/lib/format';

export function CommandPalette() {
  const open = useUI((s) => s.palette);
  const set = useUI((s) => s.set);
  const openCreate = useUI((s) => s.openCreate);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const ws = useWorkspace();
  const theme = usePrefs((s) => s.theme);
  const [remote, setRemote] = useState<{ comments: Comment[]; activity: Activity[] }>({ comments: [], activity: [] });

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  useEffect(() => {
    const supabase = getSupabase();
    const term = q.trim();
    if (!supabase || !ws.teamId || term.length < 3) {
      setRemote({ comments: [], activity: [] });
      return;
    }
    const t = window.setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, '')}%`;
      const [c, a] = await Promise.all([
        supabase.from('comments').select('*').eq('team_id', ws.teamId!).ilike('body', like).order('created_at', { ascending: false }).limit(8),
        supabase.from('activity').select('*').eq('team_id', ws.teamId!).ilike('summary', like).order('created_at', { ascending: false }).limit(8),
      ]);
      setRemote({ comments: (c.data as Comment[]) || [], activity: (a.data as Activity[]) || [] });
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, ws.teamId]);

  const go = (path: string) => {
    set({ palette: false });
    navigate(path);
  };

  const term = q.trim().toLowerCase();
  const match = (...fields: (string | null | undefined)[]) => !term || fields.some((f) => f?.toLowerCase().includes(term));
  const projects = useMemo(() => ws.projects.filter((p) => match(p.name, p.description, p.universe_id, p.place_id)).slice(0, 6), [ws.projects, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const bugs = useMemo(() => (term ? ws.bugs.filter((b) => match(b.title, `bug-${b.number}`, String(b.number), b.description)).slice(0, 8) : []), [ws.bugs, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const scripts = useMemo(() => (term ? ws.scripts.filter((s) => match(s.name, s.description, s.category, ...s.tags)).slice(0, 6) : []), [ws.scripts, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => (term ? ws.tasks.filter((t) => match(t.title, t.description)).slice(0, 6) : []), [ws.tasks, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const members = useMemo(() => (term ? ws.members.filter((m) => match(displayName(ws.profiles[m.user_id]), ws.profiles[m.user_id]?.email, ws.profiles[m.user_id]?.username)).slice(0, 6) : []), [ws.members, ws.profiles, term]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = 'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg aria-selected:bg-hover [&>svg]:size-4 [&>svg]:text-fg-subtle';
  const group = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle';

  return (
    <RDialog.Root open={open} onOpenChange={(o) => set({ palette: o })}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50 animate-fade-in" />
        <RDialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[620px] max-w-[calc(100vw-48px)] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-pop animate-pop-in">
          <RDialog.Title className="sr-only">Search and commands</RDialog.Title>
          <RDialog.Description className="sr-only">Search projects, bugs, scripts, tasks, members, comments and activity</RDialog.Description>
          <Command shouldFilter={false} loop label="Search">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Command.Input value={q} onValueChange={setQ} placeholder="Search projects, bugs, scripts, people, comments…" className="h-12 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:outline-none" autoFocus />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-10 text-center text-[13px] text-fg-muted">No results for “{q}”.</Command.Empty>
              {projects.length > 0 && (
                <Command.Group heading="Projects" className={group}>
                  {projects.map((p) => (
                    <Command.Item key={p.id} value={`p-${p.id}`} onSelect={() => go(`/projects/${p.id}`)} className={item}>
                      <ProjectThumb project={p} size={18} />
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.universe_id && <span className="font-mono text-[11px] text-fg-subtle">{p.universe_id}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {bugs.length > 0 && (
                <Command.Group heading="Bugs" className={group}>
                  {bugs.map((b) => (
                    <Command.Item key={b.id} value={`b-${b.id}`} onSelect={() => go(`/bugs/${b.id}`)} className={item}>
                      <BugStatusIcon status={b.status} />
                      <span className="font-mono text-[11.5px] text-fg-subtle">BUG-{b.number}</span>
                      <span className="flex-1 truncate">{b.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {scripts.length > 0 && (
                <Command.Group heading="Scripts" className={group}>
                  {scripts.map((s) => (
                    <Command.Item key={s.id} value={`s-${s.id}`} onSelect={() => go(`/scripts/${s.id}`)} className={item}>
                      <Code2 />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="text-[11.5px] text-fg-subtle">{s.category}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {tasks.length > 0 && (
                <Command.Group heading="Tasks" className={group}>
                  {tasks.map((t) => (
                    <Command.Item key={t.id} value={`t-${t.id}`} onSelect={() => go(`/projects/${t.project_id}/tasks?task=${t.id}`)} className={item}>
                      <CheckSquare />
                      <span className="flex-1 truncate">{t.title}</span>
                      <span className="text-[11.5px] text-fg-subtle">{ws.projects.find((p) => p.id === t.project_id)?.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {members.length > 0 && (
                <Command.Group heading="Team members" className={group}>
                  {members.map((m) => (
                    <Command.Item key={m.user_id} value={`m-${m.user_id}`} onSelect={() => go(`/team?member=${m.user_id}`)} className={item}>
                      <UserAvatar userId={m.user_id} size={18} presence />
                      <span className="flex-1 truncate">{displayName(ws.profiles[m.user_id])}</span>
                      <span className="text-[11.5px] capitalize text-fg-subtle">{m.role}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {remote.comments.length > 0 && (
                <Command.Group heading="Comments" className={group}>
                  {remote.comments.map((c) => (
                    <Command.Item key={c.id} value={`c-${c.id}`} onSelect={() => go(c.entity_type === 'bug' ? `/bugs/${c.entity_id}` : `/projects/${c.project_id}/tasks?task=${c.entity_id}`)} className={item}>
                      <MessageSquare />
                      <span className="flex-1 truncate">{c.body}</span>
                      <span className="text-[11.5px] text-fg-subtle">{timeAgo(c.created_at)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {remote.activity.length > 0 && (
                <Command.Group heading="Activity" className={group}>
                  {remote.activity.map((a) => (
                    <Command.Item key={a.id} value={`a-${a.id}`} onSelect={() => go(a.project_id ? `/projects/${a.project_id}/activity` : '/team/activity')} className={item}>
                      <ActivityIcon />
                      <span className="flex-1 truncate">
                        {displayName(ws.profiles[a.actor_id ?? ''], 'Someone')} {a.summary}
                      </span>
                      <span className="text-[11.5px] text-fg-subtle">{timeAgo(a.created_at)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!term && (
                <>
                  <Command.Group heading="Create" className={group}>
                    <Command.Item value="new-bug" onSelect={() => openCreate('bug')} className={item}><Bug />Report a bug<span className="ml-auto"><Kbd>C</Kbd></span></Command.Item>
                    <Command.Item value="new-project" onSelect={() => openCreate('project')} className={item}><Plus />New project</Command.Item>
                    <Command.Item value="new-script" onSelect={() => openCreate('script')} className={item}><Code2 />New script</Command.Item>
                    <Command.Item value="invite" onSelect={() => openCreate('invite')} className={item}><UserPlus />Invite a teammate</Command.Item>
                    <Command.Item value="schedule" onSelect={() => go('/publish')} className={item}><Rocket />Schedule an update</Command.Item>
                  </Command.Group>
                  <Command.Group heading="Go to" className={group}>
                    {[
                      ['Overview', '/', LayoutDashboard, 'O'],
                      ['Projects', '/projects', FolderKanban, 'P'],
                      ['Publish', '/publish', Rocket, 'U'],
                      ['Analytics', '/analytics', BarChart3, 'A'],
                      ['Bugs', '/bugs', Bug, 'B'],
                      ['Scripts', '/scripts', Code2, 'S'],
                      ['Team', '/team', Users, 'T'],
                      ['Settings', '/settings', Settings, ','],
                    ].map(([label, path, Icon, key]) => {
                      const I = Icon as typeof Bug;
                      return (
                        <Command.Item key={path as string} value={`go-${label}`} onSelect={() => go(path as string)} className={item}>
                          <I />
                          {label as string}
                          <span className="ml-auto"><Kbd>{key === ',' ? 'Ctrl ,' : `G ${key}`}</Kbd></span>
                        </Command.Item>
                      );
                    })}
                    <Command.Item value="theme" onSelect={() => { usePrefs.getState().set({ theme: theme === 'light' ? 'dark' : 'light' }); set({ palette: false }); }} className={item}>
                      {theme === 'light' ? <Moon /> : <Sun />}Switch to {theme === 'light' ? 'dark' : 'light'} theme
                    </Command.Item>
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
