// Team workspace state, kept in sync for every member with Supabase Realtime
// (postgres_changes). Rows arrive already filtered by row level security, so each
// member only receives what they are allowed to see. After a dropped connection the
// whole workspace is re-fetched so nothing missed while offline is lost.
import { createWithEqualityFn as create } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getSupabase, must, sb } from '@/lib/supabase';
import type { Activity, Bug, Invite, Member, Project, ProjectMember, Profile, PublishUpdate, Script, ScriptFolder, Task, Team } from '@/lib/types';
import { usePrefs } from './prefs';
import { useSession } from './session';

type RtStatus = 'idle' | 'connecting' | 'live' | 'offline';

interface Workspace {
  teams: Team[];
  myMemberships: Member[];
  teamsLoaded: boolean;
  teamId: string | null;
  loading: boolean;
  error: string | null;
  realtime: RtStatus;

  members: Member[];
  profiles: Record<string, Profile>;
  projects: Project[];
  projectMembers: ProjectMember[];
  invites: Invite[];
  myInvites: (Invite & { team_name?: string })[];
  bugs: Bug[];
  tasks: Task[];
  scripts: Script[];
  folders: ScriptFolder[];
  favorites: string[];
  publish: PublishUpdate[];
  activity: Activity[];

  loadTeams: () => Promise<void>;
  selectTeam: (id: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  createTeam: (name: string, color?: string) => Promise<Team>;
  reset: () => void;
}

const empty = {
  members: [], profiles: {}, projects: [], projectMembers: [], invites: [], bugs: [], tasks: [], scripts: [], folders: [], favorites: [], publish: [], activity: [],
};

let channel: RealtimeChannel | null = null;
let wasLive = false;

type Keyed = { id?: string | number };
function upsert<T extends Keyed>(list: T[], row: T, prepend = true): T[] {
  const i = list.findIndex((r) => r.id === row.id);
  if (i < 0) return prepend ? [row, ...list] : [...list, row];
  const next = list.slice();
  next[i] = { ...next[i], ...row };
  return next;
}
function remove<T extends Keyed>(list: T[], id: unknown): T[] {
  return list.filter((r) => r.id !== id);
}

export const useWorkspace = create<Workspace>()((set, get) => ({
  teams: [],
  myMemberships: [],
  teamsLoaded: false,
  teamId: null,
  loading: false,
  error: null,
  realtime: 'idle',
  myInvites: [],
  ...empty,

  reset: () => {
    if (channel) getSupabase()?.removeChannel(channel);
    channel = null;
    set({ teams: [], myMemberships: [], teamsLoaded: false, teamId: null, myInvites: [], realtime: 'idle', ...empty });
  },

  loadTeams: async () => {
    const supabase = sb();
    const uid = useSession.getState().user?.id;
    const email = useSession.getState().user?.email ?? '';
    if (!uid) return;
    const [mem, teams, inv] = await Promise.all([
      supabase.from('team_members').select('*').eq('user_id', uid),
      supabase.from('teams').select('*').order('created_at'),
      supabase.from('team_invites').select('*').eq('status', 'pending').ilike('email', email),
    ]);
    const memberships = must(mem) as Member[];
    const teamList = must(teams) as Team[];
    // Invites addressed to me for teams I am not in yet: fetch team names via get_invite.
    const pending = ((inv.data as Invite[]) || []).filter((i) => !memberships.some((m) => m.team_id === i.team_id) && new Date(i.expires_at) > new Date());
    const named = await Promise.all(
      pending.map(async (i) => {
        const { data } = await supabase.rpc('get_invite', { p_token: i.token });
        return { ...i, team_name: (data as { team_name?: string } | null)?.team_name };
      }),
    );
    set({ myMemberships: memberships, teams: teamList, teamsLoaded: true, myInvites: named });
    const current = get().teamId;
    const preferred = usePrefs.getState().lastTeamId;
    const pick = teamList.find((t) => t.id === current) ?? teamList.find((t) => t.id === preferred) ?? teamList[0];
    if (pick && pick.id !== current) await get().selectTeam(pick.id);
    if (!pick) await get().selectTeam(null);
  },

  selectTeam: async (id) => {
    const supabase = sb();
    if (channel) await supabase.removeChannel(channel);
    channel = null;
    wasLive = false;
    set({ teamId: id, ...empty, realtime: id ? 'connecting' : 'idle' });
    usePrefs.getState().set({ lastTeamId: id });
    if (!id) return;
    await get().refresh();
    subscribe(id);
  },

  refresh: async () => {
    const id = get().teamId;
    if (!id) return;
    const supabase = sb();
    const uid = useSession.getState().user?.id;
    set({ loading: true, error: null });
    try {
      const [members, projects, bugs, tasks, scripts, folders, favs, publish, activity] = await Promise.all([
        supabase.from('team_members').select('*').eq('team_id', id),
        supabase.from('projects').select('*').eq('team_id', id).order('created_at', { ascending: false }),
        supabase.from('bugs').select('*').eq('team_id', id).order('created_at', { ascending: false }).limit(2000),
        supabase.from('tasks').select('*').eq('team_id', id).order('position').limit(3000),
        supabase.from('scripts').select('*').eq('team_id', id).order('updated_at', { ascending: false }).limit(2000),
        supabase.from('script_folders').select('*').eq('team_id', id).order('name'),
        supabase.from('script_favorites').select('script_id').eq('user_id', uid ?? ''),
        supabase.from('publish_updates').select('*').eq('team_id', id).order('update_at', { ascending: false }).limit(500),
        supabase.from('activity').select('*').eq('team_id', id).order('created_at', { ascending: false }).limit(300),
      ]);
      const memberRows = must(members) as Member[];
      const projectRows = must(projects) as Project[];
      const projectIds = projectRows.map((p) => p.id);
      const [profiles, pm] = await Promise.all([
        supabase.from('profiles').select('*').in('id', memberRows.map((m) => m.user_id)),
        projectIds.length ? supabase.from('project_members').select('*').in('project_id', projectIds) : Promise.resolve({ data: [], error: null }),
      ]);
      const me = memberRows.find((m) => m.user_id === uid);
      const canManage = me && (me.role === 'owner' || me.role === 'admin' || me.permissions?.manage_members === true) && me.permissions?.manage_members !== false;
      const invites = canManage ? ((await supabase.from('team_invites').select('*').eq('team_id', id).order('created_at', { ascending: false })).data as Invite[]) || [] : [];
      set({
        members: memberRows,
        profiles: Object.fromEntries(((profiles.data as Profile[]) || []).map((p) => [p.id, p])),
        projects: projectRows,
        projectMembers: (pm.data as ProjectMember[]) || [],
        invites,
        bugs: must(bugs) as Bug[],
        tasks: must(tasks) as Task[],
        scripts: must(scripts) as Script[],
        folders: must(folders) as ScriptFolder[],
        favorites: ((favs.data as { script_id: string }[]) || []).map((f) => f.script_id),
        publish: must(publish) as PublishUpdate[],
        activity: must(activity) as Activity[],
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  createTeam: async (name, color = 'green') => {
    const t = must(await sb().rpc('create_team', { p_name: name, p_color: color })) as Team;
    await get().loadTeams();
    await get().selectTeam(t.id);
    return t;
  },
}), shallow);

function subscribe(teamId: string) {
  const supabase = sb();
  const ws = useWorkspace;
  const uid = useSession.getState().user?.id;
  const filter = `team_id=eq.${teamId}`;
  const ch = supabase.channel(`db:team:${teamId}`);

  const on = <T extends Record<string, unknown>>(table: string, handler: (p: RealtimePostgresChangesPayload<T>) => void, withFilter = true) =>
    ch.on('postgres_changes' as never, { event: '*', schema: 'public', table, ...(withFilter ? { filter } : {}) } as never, handler as never);

  const listHandler =
    <K extends 'projects' | 'bugs' | 'tasks' | 'scripts' | 'folders' | 'publish' | 'invites'>(key: K, prepend = true) =>
    (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const s = ws.getState();
      if (p.eventType === 'DELETE') ws.setState({ [key]: remove(s[key] as Keyed[], (p.old as Keyed).id) } as never);
      else ws.setState({ [key]: upsert(s[key] as Keyed[], p.new as Keyed, prepend) } as never);
    };

  on('projects', listHandler('projects'));
  on('bugs', listHandler('bugs'));
  on('tasks', listHandler('tasks', false));
  on('scripts', listHandler('scripts'));
  on('script_folders', listHandler('folders', false));
  on('publish_updates', listHandler('publish'));
  on('team_invites', listHandler('invites'));
  on('activity', (p) => {
    if (p.eventType !== 'INSERT') return;
    const a = p.new as unknown as Activity;
    ws.setState({ activity: [a, ...ws.getState().activity.filter((x) => x.id !== a.id)].slice(0, 300) });
  });
  on('team_members', async (p) => {
    const s = ws.getState();
    if (p.eventType === 'DELETE') {
      const old = p.old as unknown as Member;
      ws.setState({ members: s.members.filter((m) => m.user_id !== old.user_id) });
      if (old.user_id === uid) {
        await ws.getState().loadTeams();
      }
      return;
    }
    const m = p.new as unknown as Member;
    const i = s.members.findIndex((x) => x.user_id === m.user_id);
    ws.setState({ members: i < 0 ? [...s.members, m] : s.members.map((x) => (x.user_id === m.user_id ? m : x)) });
    if (!s.profiles[m.user_id]) {
      const { data } = await supabase.from('profiles').select('*').eq('id', m.user_id).maybeSingle();
      if (data) ws.setState({ profiles: { ...ws.getState().profiles, [m.user_id]: data as Profile } });
    }
  });
  on('profiles', (p) => {
    if (p.eventType === 'DELETE') return;
    const prof = p.new as unknown as Profile;
    if (!ws.getState().members.some((m) => m.user_id === prof.id)) return;
    ws.setState({ profiles: { ...ws.getState().profiles, [prof.id]: prof } });
    if (prof.id === uid) useSession.setState({ profile: prof });
  }, false);
  on('project_members', (p) => {
    const s = ws.getState();
    const row = (p.eventType === 'DELETE' ? p.old : p.new) as unknown as ProjectMember;
    if (!s.projects.some((x) => x.id === row.project_id)) return;
    const rest = s.projectMembers.filter((x) => !(x.project_id === row.project_id && x.user_id === row.user_id));
    ws.setState({ projectMembers: p.eventType === 'DELETE' ? rest : [...rest, row] });
  }, false);
  on('teams', (p) => {
    if (p.eventType === 'DELETE') {
      ws.getState().loadTeams();
      return;
    }
    const t = p.new as unknown as Team;
    ws.setState({ teams: ws.getState().teams.map((x) => (x.id === t.id ? t : x)) });
  }, false);

  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (wasLive) ws.getState().refresh();
      wasLive = true;
      ws.setState({ realtime: 'live' });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (ws.getState().teamId === teamId) ws.setState({ realtime: 'offline' });
    }
  });
  channel = ch;
}

// ------------------------------------------------------------------ selectors

export function useMe(): Member | undefined {
  const uid = useSession((s) => s.user?.id);
  return useWorkspace((s) => s.members.find((m) => m.user_id === uid));
}

export function useProfile(id: string | null | undefined): Profile | undefined {
  return useWorkspace((s) => (id ? s.profiles[id] : undefined));
}

export function displayName(p: Profile | undefined | null, fallback = 'Unknown'): string {
  if (!p) return fallback;
  return p.display_name || p.username || p.email?.split('@')[0] || fallback;
}

export function useProjectRole(projectId: string | undefined) {
  const uid = useSession((s) => s.user?.id);
  return useWorkspace((s) => s.projectMembers.find((m) => m.project_id === projectId && m.user_id === uid)?.role);
}
