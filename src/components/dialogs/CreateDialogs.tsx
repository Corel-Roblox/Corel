import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Copy, Link2, Loader2, Mail, Paperclip, Search, X } from 'lucide-react';
import { Button, Dialog, Field, Input, Notice, Segmented, Select, Textarea } from '@/components/ui';
import { MemberSelect, ProjectSelect, ProjectThumb, PRIORITIES, TASK_STATUSES, severityOptions } from '@/components/common';
import { useUI } from '@/store/ui';
import { useMe, useWorkspace } from '@/store/workspace';
import { createBug, createInvite, createProject, createScript, createTask, inviteLink } from '@/lib/actions';
import { invoke, isDesktop, openExternal } from '@/lib/tauri';
import { bytes } from '@/lib/format';
import { hasPerm, ROLE_INFO } from '@/lib/perms';
import type { ResolvedGame, Role, Severity, TaskPriority, TaskStatus } from '@/lib/types';

export function CreateDialogs() {
  const kind = useUI((s) => s.create);
  const close = () => useUI.getState().set({ create: null });
  return (
    <>
      <NewProjectDialog open={kind === 'project'} onClose={close} />
      <NewBugDialog open={kind === 'bug'} onClose={close} />
      <NewScriptDialog open={kind === 'script'} onClose={close} />
      <InviteDialog open={kind === 'invite'} onClose={close} />
      <NewTaskDialog open={kind === 'task'} onClose={close} />
    </>
  );
}

// ------------------------------------------------------------------ project

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const me = useMe();
  const [link, setLink] = useState('');
  const [resolved, setResolved] = useState<ResolvedGame | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLink('');
      setResolved(null);
      setName('');
      setDescription('');
      setLookupError(null);
    }
  }, [open]);

  const lookup = async () => {
    if (!link.trim()) return;
    setResolving(true);
    setLookupError(null);
    try {
      const r = await invoke<ResolvedGame>('roblox_resolve', { input: link });
      setResolved(r);
      if (!name) setName(r.name);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const p = await createProject({ name: name.trim(), description: description.trim(), universe_id: resolved?.universeId ?? null, place_id: resolved?.rootPlaceId || null, thumbnail_url: resolved?.iconUrl ?? null });
      toast.success(`Created ${p.name}`);
      onClose();
      navigate(`/projects/${p.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const allowed = hasPerm(me, 'manage_projects');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New project"
      description="A project is one Roblox experience: its bugs, tasks, scripts, publishing and analytics live together."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!name.trim() || !allowed} onClick={submit}>Create project</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!allowed && <Notice tone="warning">Your role can’t create projects. Ask a team admin.</Notice>}
        <Field label="Roblox experience" optional hint={isDesktop ? 'Paste the game link, a place ID or a universe ID. Corel looks up the name, IDs and icon.' : 'Lookup needs the desktop app.'} error={lookupError}>
          <div className="flex gap-2">
            <Input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="https://www.roblox.com/games/1234567890/…" icon={<Link2 />} />
            <Button onClick={lookup} loading={resolving} disabled={!link.trim() || !isDesktop} icon={!resolving ? <Search className="size-3.5" /> : undefined}>Look up</Button>
          </div>
        </Field>
        {resolved && (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3 animate-pop-in">
            <ProjectThumb project={{ id: resolved.universeId, name: resolved.name, thumbnail_url: resolved.iconUrl }} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{resolved.name}</p>
              <p className="font-mono text-[11.5px] text-fg-subtle">Universe {resolved.universeId} · Place {resolved.rootPlaceId || '—'}</p>
              <p className="text-[11.5px] text-fg-subtle">by {resolved.creatorName || `${resolved.creatorKind} ${resolved.creatorId}`}</p>
            </div>
            <Check className="size-4 text-success" />
          </div>
        )}
        <Field label="Project name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="My Obby" autoFocus />
        </Field>
        <Field label="Description" optional>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this experience about? Goals for the next update?" />
        </Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ bug

export function NewBugDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useUI((s) => s.createContext);
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [environment, setEnvironment] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId(ctx.projectId ?? projects[0]?.id ?? '');
      setTitle('');
      setDescription('');
      setSteps('');
      setEnvironment('');
      setSeverity('medium');
      setAssignee(null);
      setFiles([]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setSaving(true);
    try {
      const b = await createBug({ project_id: projectId, title: title.trim(), description, steps, environment, severity, assignee_id: assignee }, files);
      toast.success(`Reported BUG-${b.number}`, { action: { label: 'Open', onClick: () => navigate(`/bugs/${b.id}`) } });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Report a bug"
      width={600}
      footer={
        <>
          <span className="mr-auto text-[12px] text-fg-subtle">Your team sees it instantly.</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim() || !projectId} onClick={submit}>Submit bug</Button>
        </>
      }
    >
      {projects.length === 0 ? (
        <Notice tone="info">Create a project first. Bugs always belong to a project.</Notice>
      ) : (
        <div className="space-y-4">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Players fall through the floor in the lobby" autoFocus />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Project"><ProjectSelect value={projectId} onChange={setProjectId} /></Field>
            <Field label="Severity"><Select label="Severity" value={severity} onChange={setSeverity} options={severityOptions} /></Field>
            <Field label="Assignee"><MemberSelect value={assignee} onChange={setAssignee} /></Field>
          </div>
          <Field label="Description" optional>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happens, and what should happen instead?" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Steps to reproduce" optional>
              <Textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'1. Join the server\n2. Walk to the lobby\n3. …'} />
            </Field>
            <Field label="Environment" optional hint="Device, platform, server version, place version…">
              <Textarea value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="Mobile (iOS), live server, place v412" />
            </Field>
          </div>
          <FilePicker files={files} onChange={setFiles} />
        </div>
      )}
    </Dialog>
  );
}

export function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  return (
    <div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-[12.5px] text-fg-muted transition-colors hover:border-accent hover:text-fg"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onChange([...files, ...Array.from(e.dataTransfer.files)]); }}
      >
        <Paperclip className="size-3.5" />
        Attach screenshots, videos or logs (drop or click, 25 MB each)
        <input type="file" multiple className="sr-only" onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])])} />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-[12.5px]">
              <Paperclip className="size-3 text-fg-subtle" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-fg-subtle">{bytes(f.size)}</span>
              <button aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-fg"><X className="size-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ script

export const SCRIPT_CATEGORIES = ['Module', 'Server', 'Client', 'Utility', 'UI', 'Data', 'Networking', 'Snippet', 'Plugin'];

const TEMPLATES: Record<string, string> = {
  Module: '--!strict\nlocal Module = {}\n\nfunction Module.init()\n\t\nend\n\nreturn Module\n',
  Server: '--!strict\nlocal Players = game:GetService("Players")\n\nPlayers.PlayerAdded:Connect(function(player)\n\t\nend)\n',
  Client: '--!strict\nlocal Players = game:GetService("Players")\nlocal player = Players.LocalPlayer\n\n',
  Empty: '',
};

export function NewScriptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const folders = useWorkspace((s) => s.folders);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Module');
  const [template, setTemplate] = useState('Module');
  const [folder, setFolder] = useState('none');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setCategory('Module');
      setTemplate('Module');
    }
  }, [open]);
  const submit = async () => {
    setSaving(true);
    try {
      const s = await createScript({ name: name.trim(), category, content: TEMPLATES[template] ?? '', folder_id: folder === 'none' ? null : folder });
      onClose();
      navigate(`/scripts/${s.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="New script" width={460}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!name.trim()} onClick={submit}>Create script</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="DataService" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Select label="Category" value={category} onChange={setCategory} options={SCRIPT_CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Folder"><Select label="Folder" value={folder} onChange={setFolder} options={[{ value: 'none', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} /></Field>
        </div>
        <Field label="Start from"><Segmented label="Template" value={template} onChange={setTemplate} options={Object.keys(TEMPLATES).map((t) => ({ value: t, label: t }))} /></Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ task

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useUI((s) => s.createContext);
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setProjectId(ctx.projectId ?? projects[0]?.id ?? '');
      setTitle('');
      setDescription('');
      setStatus('todo');
      setPriority('none');
      setAssignee(null);
      setDue('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setSaving(true);
    try {
      await createTask({ project_id: projectId, title: title.trim(), description, status, priority, assignee_id: assignee, due_date: due || null });
      toast.success('Task created');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="New task" width={540}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!title.trim() || !projectId} onClick={submit}>Create task</Button></>}>
      <div className="space-y-4">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Build the new lobby" autoFocus /></Field>
        <Field label="Description" optional><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project"><ProjectSelect value={projectId} onChange={setProjectId} /></Field>
          <Field label="Assignee"><MemberSelect value={assignee} onChange={setAssignee} /></Field>
          <Field label="Status"><Select label="Status" value={status} onChange={setStatus} options={TASK_STATUSES} /></Field>
          <Field label="Priority"><Select label="Priority" value={priority} onChange={setPriority} options={PRIORITIES} /></Field>
          <Field label="Due date" optional><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ invite

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const team = useWorkspace((s) => s.teams.find((t) => t.id === s.teamId));
  const [mode, setMode] = useState<'email' | 'link'>('email');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('developer');
  const [days, setDays] = useState('14');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ link: string; email: string | null } | null>(null);
  useEffect(() => {
    if (open) {
      setEmail('');
      setCreated(null);
      setRole('developer');
    }
  }, [open]);
  const allowed = hasPerm(me, 'manage_members');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const submit = async () => {
    setSaving(true);
    try {
      const inv = await createInvite(mode === 'email' ? email : null, role, Number(days));
      setCreated({ link: inviteLink(inv.token), email: inv.email });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const roleOptions = (['admin', 'developer', 'viewer'] as Role[]).filter((r) => r !== 'admin' || me?.role === 'owner').map((r) => ({ value: r, label: ROLE_INFO[r].label, hint: r === 'admin' ? 'Owner only' : undefined }));
  const mailto = created?.email
    ? `mailto:${created.email}?subject=${encodeURIComponent(`Join ${team?.name} on Corel`)}&body=${encodeURIComponent(`You're invited to join ${team?.name} on Corel as a ${role}.\n\n1. Install Corel and sign up with ${created.email}.\n2. Open this link, or paste it into Team → Join with an invite: ${created.link}\n\nThe invite expires in ${days} days.`)}`
    : '';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={`Invite to ${team?.name ?? 'team'}`} width={500}
      footer={created ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!allowed || (mode === 'email' && !emailOk)} onClick={submit}>{mode === 'email' ? 'Create invite' : 'Create link'}</Button></>}>
      {!allowed ? (
        <Notice tone="warning">Your role can’t invite members.</Notice>
      ) : created ? (
        <div className="space-y-4 animate-pop-in">
          <Notice tone="success" icon={<Check />}>
            {created.email ? <>Invite created for <b className="text-fg">{created.email}</b>. If they already have a Corel account they get a notification now; otherwise they’ll see it as soon as they sign up with that email.</> : 'Invite link created. Anyone with this link can join until it expires or you revoke it.'}
          </Notice>
          <Field label="Invite link" hint="Opens Corel directly. They can also paste it in Team → Join with an invite.">
            <div className="flex gap-2">
              <Input readOnly value={created.link} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
              <Button icon={<Copy className="size-3.5" />} onClick={() => { navigator.clipboard.writeText(created.link); toast.success('Link copied'); }}>Copy</Button>
            </div>
          </Field>
          {created.email && <Button icon={<Mail className="size-3.5" />} onClick={() => openExternal(mailto)}>Send with my email app</Button>}
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented label="Invite type" value={mode} onChange={setMode} options={[{ value: 'email', label: 'By email', icon: <Mail className="size-3" /> }, { value: 'link', label: 'Invite link', icon: <Link2 className="size-3" /> }]} />
          {mode === 'email' && <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@studio.dev" autoFocus /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" hint={ROLE_INFO[role].description}><Select label="Role" value={role} onChange={setRole} options={roleOptions} /></Field>
            <Field label="Expires after"><Select label="Expiry" value={days} onChange={setDays} options={[{ value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} /></Field>
          </div>
          {saving && <Loader2 className="size-4 animate-spin" />}
        </div>
      )}
    </Dialog>
  );
}
