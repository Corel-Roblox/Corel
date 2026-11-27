import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, BarChart3, Bug, CheckSquare, ChevronDown, Code2, ExternalLink, FolderKanban, ImagePlus, LayoutDashboard, Link2, Plus, Rocket, Settings, Trash2, Users, Activity as ActivityIcon, RefreshCw } from 'lucide-react';
import { Page } from '@/components/layout/Shell';
import { Badge, Button, Card, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Notice, Select, Stat, Tabs, Textarea, confirm } from '@/components/ui';
import { BugStatusIcon, LastActive, PresenceStack, ProjectThumb, SeverityBadge, UserAvatar, UserName, isOpenBug } from '@/components/common';
import { BugDetailSheet, BugTable } from '@/components/bugs';
import { TaskBoard } from '@/components/tasks';
import { ActivityFeed, useNow } from '@/components/activity';
import { ProjectAnalytics } from './Analytics';
import { PublishHistoryList } from './Publish';
import { useMe, useProjectRole, useWorkspace } from '@/store/workspace';
import { useEngine } from '@/store/engine';
import { useUI } from '@/store/ui';
import { deleteProject, setProjectMember, updateProject, uploadPublicImage } from '@/lib/actions';
import { hasPerm, projectPerm, ROLE_INFO } from '@/lib/perms';
import { countdown, longDate, timeAgo } from '@/lib/format';
import { invoke, isDesktop, openExternal, pickFile } from '@/lib/tauri';
import type { Project, ResolvedGame, Role } from '@/lib/types';

type Tab = 'overview' | 'tasks' | 'bugs' | 'scripts' | 'publish' | 'analytics' | 'members' | 'activity' | 'settings';

export function ProjectWorkspace() {
  const { id = '', tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const project = useWorkspace((s) => s.projects.find((p) => p.id === id));
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const loading = useWorkspace((s) => s.loading);
  const me = useMe();
  const prole = useProjectRole(id);
  const bugs = useWorkspace((s) => s.bugs.filter((b) => b.project_id === id));
  const tasks = useWorkspace((s) => s.tasks.filter((t) => t.project_id === id));
  const openCreate = useUI((s) => s.openCreate);
  const [bugId, setBugId] = useState<string | undefined>();

  if (!project) {
    return <Page><EmptyState icon={<FolderKanban />} title={loading ? 'Loading project…' : 'Project not found'} body={loading ? undefined : 'It may have been deleted, or you no longer have access.'} action={!loading && <Button onClick={() => navigate('/projects')}>All projects</Button>} /></Page>;
  }
  const canEdit = projectPerm(me, prole, 'edit_content');
  const canComment = projectPerm(me, prole, 'comment');
  const openBugs = bugs.filter((b) => isOpenBug(b.status)).length;
  const go = (t: Tab) => navigate(`/projects/${id}/${t === 'overview' ? '' : t}`);

  return (
    <Page wide>
      <div className="mb-4 flex items-start gap-4">
        <ProjectThumb project={project} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Menu>
              <MenuTrigger asChild>
                <button className="flex min-w-0 items-center gap-1.5 rounded-md px-1 -mx-1 text-[20px] font-semibold tracking-[-0.02em] hover:bg-hover" aria-label="Switch project">
                  <span className="truncate">{project.name}</span>
                  <ChevronDown className="size-4 shrink-0 text-fg-subtle" />
                </button>
              </MenuTrigger>
              <MenuContent align="start" className="w-[260px]">
                <MenuLabel>Switch project</MenuLabel>
                {projects.map((p) => (
                  <MenuItem key={p.id} icon={<ProjectThumb project={p} size={16} />} onSelect={() => navigate(`/projects/${p.id}/${tab === 'overview' ? '' : tab}`)}>{p.name}</MenuItem>
                ))}
              </MenuContent>
            </Menu>
            {project.archived && <Badge>Archived</Badge>}
            {project.visibility === 'members' && <Badge tone="info"><Users className="size-3" />Members only</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
            {project.universe_id ? <span className="font-mono">Universe {project.universe_id}</span> : <span>No experience linked</span>}
            {project.place_id && <span className="font-mono">Place {project.place_id}</span>}
            {project.place_id && <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => openExternal(`https://www.roblox.com/games/${project.place_id}`)}><ExternalLink className="size-3" />Open on Roblox</button>}
          </div>
        </div>
        <PresenceStack filter={(p) => p.project_id === id} />
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(tab === 'tasks' ? 'task' : 'bug', { projectId: id })} disabled={!canEdit}>
          {tab === 'tasks' ? 'New task' : 'Report bug'}
        </Button>
      </div>
      <Tabs
        value={tab as Tab}
        onChange={go}
        className="mb-5"
        tabs={[
          { value: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
          { value: 'tasks', label: 'Tasks', icon: <CheckSquare />, count: tasks.filter((t) => t.status !== 'done').length },
          { value: 'bugs', label: 'Bugs', icon: <Bug />, count: openBugs },
          { value: 'scripts', label: 'Scripts', icon: <Code2 /> },
          { value: 'publish', label: 'Publish', icon: <Rocket /> },
          { value: 'analytics', label: 'Analytics', icon: <BarChart3 /> },
          { value: 'members', label: 'Members', icon: <Users /> },
          { value: 'activity', label: 'Activity', icon: <ActivityIcon /> },
          { value: 'settings', label: 'Settings', icon: <Settings /> },
        ]}
      />
      <div key={tab} className="animate-fade-in">
        {tab === 'overview' && <ProjectOverview project={project} onBug={setBugId} />}
        {tab === 'tasks' && <TaskBoard projectId={id} canEdit={canEdit} canComment={canComment} openTaskId={search.get('task')} onOpenTask={(t) => setSearch(t ? { task: t } : {})} />}
        {tab === 'bugs' && <BugTable projectId={id} />}
        {tab === 'scripts' && <ProjectScripts project={project} />}
        {tab === 'publish' && <ProjectPublish project={project} />}
        {tab === 'analytics' && <ProjectAnalytics projectId={id} />}
        {tab === 'members' && <ProjectMembers project={project} />}
        {tab === 'activity' && <Card><ActivityFeed projectId={id} /></Card>}
        {tab === 'settings' && <ProjectSettings project={project} />}
      </div>
      <BugDetailSheet bugId={bugId} onClose={() => setBugId(undefined)} />
    </Page>
  );
}

function ProjectOverview({ project, onBug }: { project: Project; onBug: (id: string) => void }) {
  const bugs = useWorkspace((s) => s.bugs.filter((b) => b.project_id === project.id));
  const tasks = useWorkspace((s) => s.tasks.filter((t) => t.project_id === project.id));
  const update = useWorkspace((s) => s.publish.find((u) => u.project_id === project.id && ['preparing', 'scheduled', 'restoring'].includes(u.status)));
  const now = useNow(1000);
  const open = bugs.filter((b) => isOpenBug(b.status));
  const done = tasks.filter((t) => t.status === 'done').length;
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-2 grid grid-cols-3 gap-3">
        <Stat label="Open bugs" value={open.length} icon={<Bug />} tone={open.some((b) => b.severity === 'critical') ? 'danger' : undefined} hint={`${open.filter((b) => b.severity === 'critical').length} critical`} />
        <Stat label="Tasks done" value={`${done}/${tasks.length}`} icon={<CheckSquare />} hint={tasks.length ? `${Math.round((done / tasks.length) * 100)}% complete` : 'No tasks yet'} />
        <Stat label="Next update" value={update ? countdown(new Date(update.update_at).getTime() - now) : '—'} icon={<Rocket />} hint={update ? longDate(update.update_at) : 'Nothing scheduled'} />
        <Card title="Open bugs" className="col-span-3" padded={false} action={<Link to={`/projects/${project.id}/bugs`} className="text-[12px] text-fg-muted hover:text-fg">View all</Link>}>
          {open.length === 0 ? <EmptyState compact icon={<Bug />} title="No open bugs" /> : (
            <div className="divide-y divide-line">
              {open.slice(0, 6).map((b) => (
                <button key={b.id} onClick={() => onBug(b.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-hover">
                  <BugStatusIcon status={b.status} />
                  <span className="font-mono text-[11.5px] text-fg-subtle">BUG-{b.number}</span>
                  <span className="flex-1 truncate text-[13px]">{b.title}</span>
                  <SeverityBadge severity={b.severity} />
                  <UserAvatar userId={b.assignee_id} size={20} />
                </button>
              ))}
            </div>
          )}
        </Card>
        <div className="col-span-3"><ProjectAnalytics projectId={project.id} compact /></div>
      </div>
      <div className="flex flex-col gap-3">
        <Card title="About">
          <p className="selectable whitespace-pre-wrap text-[13px] text-fg-muted">{project.description || 'No description yet. Add one in Settings.'}</p>
          <p className="mt-3 text-[11.5px] text-fg-subtle">Created {timeAgo(project.created_at)} by <UserName userId={project.created_by} /></p>
        </Card>
        <Card title="Recent activity" padded={false}>
          <div className="max-h-[420px] overflow-y-auto p-2"><ActivityFeed projectId={project.id} limit={15} filters={false} compact /></div>
        </Card>
      </div>
    </div>
  );
}

function ProjectScripts({ project }: { project: Project }) {
  const scripts = useWorkspace((s) => s.scripts.filter((x) => x.visibility === 'team' || x.shared_project_ids.includes(project.id)));
  const shared = scripts.filter((x) => x.shared_project_ids.includes(project.id));
  const openCreate = useUI((s) => s.openCreate);
  const Row = ({ s }: { s: (typeof scripts)[number] }) => (
    <Link to={`/scripts/${s.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-hover">
      <Code2 className="size-3.5 text-fg-subtle" />
      <span className="w-[220px] truncate text-[13px]">{s.name}</span>
      <Badge>{s.category}</Badge>
      <span className="flex-1 truncate text-[12px] text-fg-muted">{s.description}</span>
      <span className="text-[11.5px] text-fg-subtle">v{s.version} · {timeAgo(s.updated_at)}</span>
    </Link>
  );
  return (
    <div className="space-y-3">
      <Card title="Shared with this project" description="Scripts whose sharing includes this project" padded={false} action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => openCreate('script')}>New script</Button>}>
        {shared.length ? <div className="divide-y divide-line">{shared.map((s) => <Row key={s.id} s={s} />)}</div> : <EmptyState compact icon={<Code2 />} title="No project-specific scripts" body="Open a script and add this project under Sharing." />}
      </Card>
      <Card title="Team library" description="Available to everyone in the team" padded={false}>
        {scripts.filter((s) => s.visibility === 'team').length ? <div className="divide-y divide-line">{scripts.filter((s) => s.visibility === 'team').map((s) => <Row key={s.id} s={s} />)}</div> : <EmptyState compact icon={<Code2 />} title="No team scripts yet" />}
      </Card>
    </div>
  );
}

function ProjectPublish({ project }: { project: Project }) {
  const updates = useWorkspace((s) => s.publish.filter((u) => u.project_id === project.id));
  const local = useEngine((s) => s.state?.experiences.find((e) => e.project_id === project.id));
  const navigate = useNavigate();
  const me = useMe();
  const prole = useProjectRole(project.id);
  const canPublish = projectPerm(me, prole, 'manage_publish');
  const [adding, setAdding] = useState(false);
  const linkHere = async () => {
    if (!project.universe_id) return;
    setAdding(true);
    try {
      const id = await invoke<string>('exp_add', { input: project.universe_id, projectId: project.id });
      navigate(`/publish/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };
  return (
    <div className="space-y-3">
      <Card title="Icon updates on this PC" description="The PC that schedules an update uploads the countdown icons and switches them on time.">
        {!isDesktop ? <Notice>Publishing runs in the Corel desktop app.</Notice> : local ? (
          <div className="flex items-center gap-3">
            <Rocket className="size-4 text-accent-text" />
            <span className="flex-1 text-[13px]">{local.name} is set up for publishing on this PC.</span>
            <Button variant="primary" onClick={() => navigate(`/publish/${local.id}`)}>Open in Publish</Button>
          </div>
        ) : !project.universe_id ? (
          <Notice tone="warning">Link a Roblox experience in this project’s Settings first.</Notice>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[13px] text-fg-muted">Set up countdown icons and scheduled updates for this experience on this PC.</span>
            <Button variant="primary" loading={adding} disabled={!canPublish} onClick={linkHere}>Set up publishing</Button>
          </div>
        )}
      </Card>
      <Card title="Update history" description="Shared with the whole team" padded={false}>
        <PublishHistoryList updates={updates} />
      </Card>
    </div>
  );
}

function ProjectMembers({ project }: { project: Project }) {
  const members = useWorkspace((s) => s.members);
  const pm = useWorkspace((s) => s.projectMembers.filter((m) => m.project_id === project.id));
  const me = useMe();
  const canManage = hasPerm(me, 'manage_projects');
  const roleOptions = [{ value: 'inherit', label: 'Team role' }, ...(['admin', 'developer', 'viewer'] as Role[]).map((r) => ({ value: r, label: ROLE_INFO[r].label }))];
  return (
    <Card title="Project members" description={project.visibility === 'members' ? 'Only owners, admins and the members listed with a project role can see this project.' : 'Everyone in the team can see this project. A project role overrides the team role inside this project.'} padded={false}>
      <div className="divide-y divide-line">
        {members.map((m) => {
          const override = pm.find((x) => x.user_id === m.user_id)?.role;
          const elevated = m.role === 'owner' || m.role === 'admin';
          return (
            <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
              <UserAvatar userId={m.user_id} size={28} presence />
              <div className="min-w-0 flex-1">
                <UserName userId={m.user_id} className="block text-[13px] font-medium" />
                <LastActive userId={m.user_id} />
              </div>
              <Badge className="capitalize">Team: {m.role}</Badge>
              <div className="w-[150px]">
                {elevated ? (
                  <span className="text-[12px] text-fg-subtle">Full access</span>
                ) : (
                  <Select label="Project role" size="sm" value={override ?? 'inherit'} disabled={!canManage} options={roleOptions}
                    onChange={async (v) => { try { await setProjectMember(project.id, m.user_id, v === 'inherit' ? null : (v as Role)); } catch (e) { toast.error((e as Error).message); } }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ProjectSettings({ project }: { project: Project }) {
  const me = useMe();
  const prole = useProjectRole(project.id);
  const navigate = useNavigate();
  const canEdit = projectPerm(me, prole, 'edit_content') || hasPerm(me, 'manage_projects');
  const canManage = hasPerm(me, 'manage_projects');
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [universe, setUniverse] = useState(project.universe_id ?? '');
  const [place, setPlace] = useState(project.place_id ?? '');
  const [visibility, setVisibility] = useState(project.visibility);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const dirty = name !== project.name || description !== project.description || universe !== (project.universe_id ?? '') || place !== (project.place_id ?? '') || visibility !== project.visibility;

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setUniverse(project.universe_id ?? '');
    setPlace(project.place_id ?? '');
    setVisibility(project.visibility);
  }, [project.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (universe && !/^\d+$/.test(universe)) return toast.error('Universe ID must be a number.');
    if (place && !/^\d+$/.test(place)) return toast.error('Place ID must be a number.');
    setSaving(true);
    try {
      await updateProject(project.id, { name: name.trim(), description, universe_id: universe || null, place_id: place || null, visibility });
      toast.success('Project saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const lookup = async () => {
    setResolving(true);
    try {
      const r = await invoke<ResolvedGame>('roblox_resolve', { input: place || universe });
      setUniverse(r.universeId);
      setPlace(r.rootPlaceId);
      if (r.iconUrl) await updateProject(project.id, { thumbnail_url: r.iconUrl });
      toast.success(`Found ${r.name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResolving(false);
    }
  };
  const uploadThumb = async () => {
    const f = await pickFile('image/png,image/jpeg,image/webp');
    if (!f) return;
    try {
      const url = await uploadPublicImage('thumbnails', project.team_id, f);
      await updateProject(project.id, { thumbnail_url: url });
      toast.success('Thumbnail updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const memo = useMemo(() => project, [project]);

  return (
    <div className="grid max-w-[760px] gap-3">
      <Card title="Project details">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ProjectThumb project={memo} size={56} />
            <Button size="sm" icon={<ImagePlus className="size-3.5" />} disabled={!canEdit} onClick={uploadThumb}>Upload thumbnail</Button>
            {project.thumbnail_url && <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => updateProject(project.id, { thumbnail_url: null })}>Remove</Button>}
          </div>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={80} /></Field>
          <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} rows={4} /></Field>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <Field label="Universe ID"><Input value={universe} onChange={(e) => setUniverse(e.target.value.trim())} disabled={!canEdit} className="font-mono" inputMode="numeric" /></Field>
            <Field label="Root place ID (experience ID)"><Input value={place} onChange={(e) => setPlace(e.target.value.trim())} disabled={!canEdit} className="font-mono" inputMode="numeric" /></Field>
            <Button icon={<RefreshCw className="size-3.5" />} loading={resolving} disabled={!canEdit || !isDesktop || !(universe || place)} onClick={lookup}>Look up</Button>
          </div>
          <Field label="Visibility">
            <Select label="Visibility" value={visibility} onChange={(v) => setVisibility(v as Project['visibility'])} disabled={!canManage} options={[{ value: 'team', label: 'Everyone in the team' }, { value: 'members', label: 'Project members only' }]} />
          </Field>
          <div className="flex justify-end"><Button variant="primary" loading={saving} disabled={!dirty || !canEdit || !name.trim()} onClick={save}>Save changes</Button></div>
        </div>
      </Card>
      <Card title="Danger zone">
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={project.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} disabled={!canManage} onClick={async () => { await updateProject(project.id, { archived: !project.archived }); toast.success(project.archived ? 'Project restored' : 'Project archived'); }}>
            {project.archived ? 'Restore project' : 'Archive project'}
          </Button>
          <Button variant="danger" icon={<Trash2 className="size-3.5" />} disabled={!canManage}
            onClick={async () => { if (await confirm({ title: `Delete ${project.name}?`, body: 'All of its bugs, tasks, comments, publishing history and analytics are permanently deleted for everyone. Scripts stay in the team library.', danger: true, confirm: 'Delete project', typeToConfirm: project.name })) { try { await deleteProject(project.id); toast.success('Project deleted'); navigate('/projects'); } catch (e) { toast.error((e as Error).message); } } }}>
            Delete project
          </Button>
          {!canManage && <span className="text-[12px] text-fg-subtle"><Link2 className="mr-1 inline size-3" />Requires the Manage projects permission.</span>}
        </div>
      </Card>
    </div>
  );
}
