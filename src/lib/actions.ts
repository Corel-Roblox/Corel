// Data mutations. Each one writes to Supabase; the realtime subscription then updates
// every connected member (including this one), so state is never edited only locally.
import { toast } from 'sonner';
import { must, sb } from './supabase';
import type { Bug, Invite, Project, Role, Script, Task } from './types';
import { useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';

const teamId = () => {
  const t = useWorkspace.getState().teamId;
  if (!t) throw new Error('No team selected.');
  return t;
};

/** Apply a row returned by a mutation immediately (realtime will confirm it). */
function applyRow<K extends 'bugs' | 'tasks' | 'projects' | 'scripts' | 'invites'>(key: K, row: { id: string }) {
  const s = useWorkspace.getState();
  const list = s[key] as { id: string }[];
  const i = list.findIndex((r) => r.id === row.id);
  useWorkspace.setState({ [key]: i < 0 ? [row, ...list] : list.map((r) => (r.id === row.id ? { ...r, ...row } : r)) } as never);
}

export async function run<T>(p: Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const v = await p;
    if (success) toast.success(success);
    return v;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

// ------------------------------------------------------------------ projects

export async function createProject(input: Partial<Project>): Promise<Project> {
  const row = must(await sb().from('projects').insert({ ...input, team_id: teamId() }).select().single()) as Project;
  applyRow('projects', row);
  return row;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const row = must(await sb().from('projects').update(patch).eq('id', id).select().single()) as Project;
  applyRow('projects', row);
  return row;
}

export async function deleteProject(id: string) {
  must(await sb().from('projects').delete().eq('id', id));
  useWorkspace.setState({ projects: useWorkspace.getState().projects.filter((p) => p.id !== id) });
}

export async function uploadPublicImage(bucket: 'thumbnails' | 'avatars', folder: string, file: File): Promise<string> {
  if (file.size > (bucket === 'avatars' ? 2 : 5) * 1024 * 1024) throw new Error(`Images must be under ${bucket === 'avatars' ? 2 : 5} MB.`);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  must(await sb().storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false }));
  return sb().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------------ bugs

export async function createBug(input: Partial<Bug>, files: File[] = []): Promise<Bug> {
  const row = must(await sb().from('bugs').insert(input).select().single()) as Bug;
  applyRow('bugs', row);
  for (const f of files) await uploadAttachment(row, f);
  return row;
}

export async function updateBug(id: string, patch: Partial<Bug>) {
  const row = must(await sb().from('bugs').update(patch).eq('id', id).select().single()) as Bug;
  applyRow('bugs', row);
  return row;
}

export async function deleteBug(id: string) {
  must(await sb().from('bugs').delete().eq('id', id));
  useWorkspace.setState({ bugs: useWorkspace.getState().bugs.filter((b) => b.id !== id) });
}

export async function uploadAttachment(bug: Bug, file: File) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`);
  const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-80);
  const path = `${bug.team_id}/${bug.id}/${crypto.randomUUID()}-${safe}`;
  must(await sb().storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
  must(await sb().from('bug_attachments').insert({ bug_id: bug.id, path, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' }));
}

// ------------------------------------------------------------------ tasks

export async function createTask(input: Partial<Task>): Promise<Task> {
  const tasks = useWorkspace.getState().tasks.filter((t) => t.project_id === input.project_id && t.status === (input.status ?? 'todo'));
  const position = (tasks.reduce((m, t) => Math.max(m, t.position), 0) || 0) + 1;
  const row = must(await sb().from('tasks').insert({ position, ...input }).select().single()) as Task;
  applyRow('tasks', row);
  return row;
}

export async function updateTask(id: string, patch: Partial<Task>) {
  const row = must(await sb().from('tasks').update(patch).eq('id', id).select().single()) as Task;
  applyRow('tasks', row);
  return row;
}

export async function deleteTask(id: string) {
  must(await sb().from('tasks').delete().eq('id', id));
  useWorkspace.setState({ tasks: useWorkspace.getState().tasks.filter((t) => t.id !== id) });
}

// ------------------------------------------------------------------ comments

export async function addComment(projectId: string, entityType: 'bug' | 'task', entityId: string, body: string) {
  must(await sb().from('comments').insert({ project_id: projectId, entity_type: entityType, entity_id: entityId, body: body.trim(), author_id: useSession.getState().user?.id }));
}

// ------------------------------------------------------------------ scripts

export async function createScript(input: Partial<Script>): Promise<Script> {
  const row = must(await sb().from('scripts').insert({ ...input, team_id: teamId(), created_by: useSession.getState().user?.id, updated_by: useSession.getState().user?.id }).select().single()) as Script;
  applyRow('scripts', row);
  return row;
}

export async function updateScriptMeta(id: string, patch: Partial<Script>) {
  const row = must(await sb().from('scripts').update(patch).eq('id', id).select().single()) as Script;
  applyRow('scripts', row);
  return row;
}

export class ScriptConflict extends Error {
  constructor(public latestVersion: number) {
    super('Someone saved a newer version of this script.');
  }
}

/** Saves only if nobody else saved since `baseVersion`; otherwise throws ScriptConflict. */
export async function saveScript(id: string, content: string, baseVersion: number, message = ''): Promise<Script> {
  const res = await sb().rpc('save_script', { p_id: id, p_content: content, p_base_version: baseVersion, p_message: message });
  if (res.error) {
    if (res.error.message === 'conflict' || res.error.code === 'P0409') {
      let v = baseVersion + 1;
      try {
        v = JSON.parse(res.error.details || '{}').version ?? v;
      } catch {
        /* ignore */
      }
      throw new ScriptConflict(v);
    }
    throw new Error(res.error.message);
  }
  const row = res.data as Script;
  applyRow('scripts', row);
  return row;
}

export async function deleteScript(id: string) {
  must(await sb().from('scripts').delete().eq('id', id));
  useWorkspace.setState({ scripts: useWorkspace.getState().scripts.filter((s) => s.id !== id) });
}

export async function toggleFavorite(scriptId: string) {
  const favs = useWorkspace.getState().favorites;
  const on = favs.includes(scriptId);
  useWorkspace.setState({ favorites: on ? favs.filter((f) => f !== scriptId) : [...favs, scriptId] });
  const q = on ? sb().from('script_favorites').delete().eq('script_id', scriptId).eq('user_id', useSession.getState().user!.id) : sb().from('script_favorites').insert({ script_id: scriptId });
  const { error } = await q;
  if (error) {
    useWorkspace.setState({ favorites: favs });
    toast.error(error.message);
  }
}

// ------------------------------------------------------------------ team

export async function createInvite(email: string | null, role: Role, days = 14): Promise<Invite> {
  const row = must(
    await sb()
      .from('team_invites')
      .insert({ team_id: teamId(), email: email?.trim().toLowerCase() || null, role, invited_by: useSession.getState().user?.id, expires_at: new Date(Date.now() + days * 86400_000).toISOString() })
      .select()
      .single(),
  ) as Invite;
  applyRow('invites', row);
  return row;
}

export const inviteLink = (token: string) => `corel://join/${token}`;

export async function revokeInvite(id: string) {
  must(await sb().from('team_invites').update({ status: 'revoked' }).eq('id', id));
  useWorkspace.setState({ invites: useWorkspace.getState().invites.map((i) => (i.id === id ? { ...i, status: 'revoked' } : i)) });
}

export async function setMemberRole(userId: string, role: Role) {
  must(await sb().rpc('set_member_role', { p_team: teamId(), p_user: userId, p_role: role }));
  await useWorkspace.getState().refresh();
}

export async function setMemberPermissions(userId: string, perms: Record<string, boolean>) {
  must(await sb().rpc('set_member_permissions', { p_team: teamId(), p_user: userId, p_perms: perms }));
  useWorkspace.setState({ members: useWorkspace.getState().members.map((m) => (m.user_id === userId ? { ...m, permissions: perms } : m)) });
}

export async function removeMember(userId: string) {
  must(await sb().rpc('remove_member', { p_team: teamId(), p_user: userId }));
  if (userId === useSession.getState().user?.id) await useWorkspace.getState().loadTeams();
  else useWorkspace.setState({ members: useWorkspace.getState().members.filter((m) => m.user_id !== userId) });
}

export async function acceptInvite(token: string) {
  const team = must(await sb().rpc('accept_invite', { p_token: token })) as string;
  await useWorkspace.getState().loadTeams();
  await useWorkspace.getState().selectTeam(team);
  return team;
}

export async function declineInvite(id: string) {
  must(await sb().rpc('decline_invite', { p_invite: id }));
  useWorkspace.setState({ myInvites: useWorkspace.getState().myInvites.filter((i) => i.id !== id) });
}

export async function setProjectMember(projectId: string, userId: string, role: Role | null) {
  if (role === null) must(await sb().from('project_members').delete().eq('project_id', projectId).eq('user_id', userId));
  else must(await sb().from('project_members').upsert({ project_id: projectId, user_id: userId, role }));
  const s = useWorkspace.getState();
  const rest = s.projectMembers.filter((m) => !(m.project_id === projectId && m.user_id === userId));
  useWorkspace.setState({ projectMembers: role ? [...rest, { project_id: projectId, user_id: userId, role, added_at: new Date().toISOString() }] : rest });
}
