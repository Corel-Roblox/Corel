import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Activity as ActivityIcon, Check, Copy, Crown, FolderKanban, KeyRound, Link2, LogOut, Mail, MoreHorizontal, Search, Settings, Shield, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Page } from '@/components/layout/Shell';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, Notice, PageHeader, Select, Switch, Tabs, Tooltip, confirm } from '@/components/ui';
import { LastActive, PresenceStack, ProjectThumb, UserAvatar, UserName } from '@/components/common';
import { ActivityFeed } from '@/components/activity';
import { CreateTeamForm, JoinWithInvite, PendingInvites } from './Onboarding';
import { teamColor, TeamMark } from '@/components/layout/Sidebar';
import { useUI } from '@/store/ui';
import { displayName, useMe, useWorkspace } from '@/store/workspace';
import { usePresence } from '@/store/presence';
import { useSession } from '@/store/session';
import { inviteLink, removeMember, uploadPublicImage, revokeInvite, setMemberPermissions, setMemberRole } from '@/lib/actions';
import { hasPerm, PERMS, roleDefault, ROLE_INFO, ROLES } from '@/lib/perms';
import { cn, shortDate, timeAgo } from '@/lib/format';
import { must, sb } from '@/lib/supabase';
import { pickFile } from '@/lib/tauri';
import type { Member, Perm, Role, Team } from '@/lib/types';

type Tab = 'members' | 'invitations' | 'projects' | 'permissions' | 'activity' | 'settings' | 'new';

export function TeamPage() {
  const { tab = 'members' } = useParams();
  const navigate = useNavigate();
  const team = useWorkspace((s) => s.teams.find((t) => t.id === s.teamId));
  const members = useWorkspace((s) => s.members);
  const invites = useWorkspace((s) => s.invites.filter((i) => i.status === 'pending' && new Date(i.expires_at) > new Date()));
  const online = usePresence((s) => Object.keys(s.online).length);
  const me = useMe();
  const openCreate = useUI((s) => s.openCreate);
  const canManage = hasPerm(me, 'manage_members');

  if (tab === 'new') {
    return (
      <Page>
        <PageHeader title="Create a team" description="Teams have their own projects, scripts, members and permissions." />
        <Card className="max-w-[440px]"><CreateTeamForm onCreated={() => navigate('/')} /></Card>
      </Page>
    );
  }

  return (
    <Page wide>
      <PageHeader
        icon={team && <TeamMark name={team.name} color={team.color} url={team.avatar_url} size={36} />}
        title={team?.name ?? 'Team'}
        description={`${members.length} member${members.length === 1 ? '' : 's'} · ${online} online now`}
        actions={<><PresenceStack max={6} />{canManage && <Button variant="primary" icon={<UserPlus className="size-3.5" />} onClick={() => openCreate('invite')}>Invite</Button>}</>}
      />
      <Tabs
        value={tab as Tab}
        onChange={(t) => navigate(`/team/${t === 'members' ? '' : t}`)}
        className="mb-5"
        tabs={[
          { value: 'members', label: 'Members', icon: <Users />, count: members.length },
          { value: 'invitations', label: 'Invitations', icon: <Mail />, count: invites.length || undefined },
          { value: 'projects', label: 'Shared projects', icon: <FolderKanban /> },
          { value: 'permissions', label: 'Roles & permissions', icon: <Shield /> },
          { value: 'activity', label: 'Activity', icon: <ActivityIcon /> },
          { value: 'settings', label: 'Settings', icon: <Settings /> },
        ]}
      />
      <div key={tab} className="animate-fade-in">
        {tab === 'members' && <MembersTab />}
        {tab === 'invitations' && <InvitationsTab />}
        {tab === 'projects' && <SharedProjectsTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'activity' && <Card><ActivityFeed /></Card>}
        {tab === 'settings' && <TeamSettingsTab />}
      </div>
    </Page>
  );
}

function MembersTab() {
  const members = useWorkspace((s) => s.members);
  const profiles = useWorkspace((s) => s.profiles);
  const onlineMap = usePresence((s) => s.online);
  const projects = useWorkspace((s) => s.projects);
  const me = useMe();
  const uid = useSession((s) => s.user?.id);
  const [search] = useSearchParams();
  const highlight = search.get('member');
  const [q, setQ] = useState('');
  const [permsFor, setPermsFor] = useState<Member | null>(null);
  const canManage = hasPerm(me, 'manage_members');
  const roleRank: Record<Role, number> = { owner: 0, admin: 1, developer: 2, viewer: 3 };
  const list = members
    .filter((m) => !q || displayName(profiles[m.user_id]).toLowerCase().includes(q.toLowerCase()) || profiles[m.user_id]?.email?.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!onlineMap[b.user_id]) - Number(!!onlineMap[a.user_id]) || roleRank[a.role] - roleRank[b.role]);

  const changeRole = async (m: Member, role: Role) => {
    if (role === 'owner' && !(await confirm({ title: `Make ${displayName(profiles[m.user_id])} the owner?`, body: 'You become an admin. Only the new owner can transfer ownership back.', confirm: 'Transfer ownership' }))) return;
    try {
      await setMemberRole(m.user_id, role);
      toast.success('Role updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <div className="mb-3 w-[280px]"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" icon={<Search />} aria-label="Search members" /></div>
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {list.map((m) => {
          const p = profiles[m.user_id];
          const viewing = onlineMap[m.user_id];
          const viewingProject = viewing?.project_id ? projects.find((x) => x.id === viewing.project_id) : null;
          const overrides = Object.keys(m.permissions || {}).length;
          const canChange = canManage && m.user_id !== uid && m.role !== 'owner' && (m.role !== 'admin' || me?.role === 'owner');
          return (
            <div key={m.user_id} className={cn('flex items-center gap-3 px-4 py-3 transition-colors', highlight === m.user_id && 'bg-accent-soft/30')}>
              <UserAvatar userId={m.user_id} size={34} presence />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13.5px] font-medium">
                  {displayName(p)}
                  {m.user_id === uid && <Badge>You</Badge>}
                  {m.role === 'owner' && <Crown className="size-3.5 text-warning" aria-label="Owner" />}
                </p>
                <p className="truncate text-[12px] text-fg-subtle">{p?.email}{p?.roblox_username && ` · @${p.roblox_username} on Roblox`}</p>
              </div>
              <div className="w-[190px] text-right">
                <LastActive userId={m.user_id} />
                {viewingProject && <p className="truncate text-[11.5px] text-fg-subtle">In {viewingProject.name}</p>}
              </div>
              <span className="w-[110px] whitespace-nowrap text-right text-[11.5px] text-fg-subtle">Joined {format(new Date(m.joined_at), 'MMM d, yyyy')}</span>
              <div className="w-[130px]">
                {canChange ? (
                  <Select label={`Role for ${displayName(p)}`} size="sm" value={m.role} onChange={(r: Role) => changeRole(m, r)} options={ROLES.filter((r) => r !== 'owner' || me?.role === 'owner').map((r) => ({ value: r, label: ROLE_INFO[r].label }))} />
                ) : (
                  <Badge tone={m.role === 'owner' ? 'warning' : m.role === 'admin' ? 'accent' : 'neutral'} className="capitalize">{m.role}</Badge>
                )}
              </div>
              {overrides > 0 ? <Tooltip content="Has custom permissions"><KeyRound className="size-3.5 text-accent-text" /></Tooltip> : <span className="w-3.5" />}
              <Menu>
                <MenuTrigger asChild><Button size="sm" variant="ghost" aria-label={`Actions for ${displayName(p)}`} className="w-7 px-0"><MoreHorizontal className="size-4" /></Button></MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<KeyRound />} disabled={!canChange} onSelect={() => setPermsFor(m)}>Customize permissions</MenuItem>
                  {m.user_id === uid ? (
                    <MenuItem icon={<LogOut />} danger disabled={m.role === 'owner'} onSelect={async () => { if (await confirm({ title: 'Leave this team?', body: 'You lose access to its projects and scripts until someone invites you again.', danger: true, confirm: 'Leave team' })) { try { await removeMember(m.user_id); } catch (e) { toast.error((e as Error).message); } } }}>Leave team</MenuItem>
                  ) : (
                    <MenuItem icon={<UserMinus />} danger disabled={!canChange} onSelect={async () => { if (await confirm({ title: `Remove ${displayName(p)}?`, body: 'They lose access to this team’s projects, bugs and scripts immediately. Their past work stays.', danger: true, confirm: 'Remove member' })) { try { await removeMember(m.user_id); toast.success('Member removed'); } catch (e) { toast.error((e as Error).message); } } }}>Remove from team</MenuItem>
                  )}
                </MenuContent>
              </Menu>
            </div>
          );
        })}
      </div>
      <PermissionsDialog member={permsFor} onClose={() => setPermsFor(null)} />
    </>
  );
}

function PermissionsDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const profile = useWorkspace((s) => (member ? s.profiles[member.user_id] : undefined));
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft({ ...(member?.permissions ?? {}) } as Record<string, boolean>), [member]);
  if (!member) return null;
  const effective = (p: Perm) => (p in draft ? draft[p] : roleDefault(member.role, p));
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()} title={`Permissions for ${displayName(profile)}`} description={`Starts from the ${ROLE_INFO[member.role].label} role. Changes here apply only to this person.`} width={520}
      footer={<><Button variant="ghost" onClick={() => setDraft({})}>Reset to role defaults</Button><Button variant="primary" loading={saving} onClick={async () => { setSaving(true); try { await setMemberPermissions(member.user_id, draft); toast.success('Permissions saved'); onClose(); } catch (e) { toast.error((e as Error).message); } setSaving(false); }}>Save</Button></>}>
      <ul className="divide-y divide-line">
        {PERMS.map((p) => (
          <li key={p.key} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px]">{p.label}{p.key in draft && <Badge tone="accent">Custom</Badge>}</p>
              <p className="text-[12px] text-fg-subtle">{p.description}</p>
            </div>
            <Switch checked={effective(p.key)} label={p.label} onChange={(v) => setDraft((d) => { const n = { ...d }; if (v === roleDefault(member.role, p.key)) delete n[p.key]; else n[p.key] = v; return n; })} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function InvitationsTab() {
  const all = useWorkspace((s) => s.invites);
  const me = useMe();
  const openCreate = useUI((s) => s.openCreate);
  const canManage = hasPerm(me, 'manage_members');
  const pending = all.filter((i) => i.status === 'pending' && new Date(i.expires_at) > new Date());
  const past = all.filter((i) => !pending.includes(i)).slice(0, 30);
  const myInvites = useWorkspace((s) => s.myInvites);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-3">
      <div className="space-y-3">
        {!canManage ? <Notice>Only members who can manage the team see its invitations.</Notice> : (
          <Card title="Pending invitations" padded={false} action={<Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => openCreate('invite')}>Invite</Button>}>
            {pending.length === 0 ? <EmptyState compact icon={<Mail />} title="No pending invitations" body="Invite by email or create a shareable link." /> : (
              <ul className="divide-y divide-line">
                {pending.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                    {i.email ? <Mail className="size-4 text-fg-subtle" /> : <Link2 className="size-4 text-fg-subtle" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{i.email ?? 'Invite link'}{!i.email && i.uses > 0 && <span className="text-fg-subtle"> · used {i.uses}×</span>}</p>
                      <p className="text-[11.5px] text-fg-subtle">Invited by <UserName userId={i.invited_by} /> · expires {timeAgo(i.expires_at)}</p>
                    </div>
                    <Badge className="capitalize">{i.role}</Badge>
                    <Tooltip content="Copy invite link"><Button size="sm" variant="ghost" className="w-7 px-0" aria-label="Copy invite link" onClick={() => { navigator.clipboard.writeText(inviteLink(i.token)); toast.success('Link copied'); }}><Copy className="size-3.5" /></Button></Tooltip>
                    <Tooltip content="Revoke"><Button size="sm" variant="ghost" className="w-7 px-0" aria-label="Revoke invite" onClick={async () => { if (await confirm({ title: 'Revoke this invite?', body: 'The link stops working immediately.', danger: true, confirm: 'Revoke' })) revokeInvite(i.id).catch((e) => toast.error(e.message)); }}><X className="size-3.5" /></Button></Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {canManage && past.length > 0 && (
          <Card title="Past invitations" padded={false}>
            <ul className="divide-y divide-line">
              {past.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                  <span className="flex-1 truncate text-fg-muted">{i.email ?? 'Invite link'}</span>
                  <Badge tone={i.status === 'accepted' ? 'success' : 'neutral'} className="capitalize">{i.status === 'pending' ? 'expired' : i.status}</Badge>
                  <span className="w-[90px] text-right text-[11.5px] text-fg-subtle">{timeAgo(i.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <div className="space-y-3">
        <Card title="Invitations for you">
          {myInvites.length ? <PendingInvites /> : <p className="text-[12.5px] text-fg-subtle">No invitations waiting.</p>}
        </Card>
        <Card title="Join another team"><Field label="Paste an invite link"><JoinWithInvite /></Field></Card>
      </div>
    </div>
  );
}

function SharedProjectsTab() {
  const projects = useWorkspace((s) => s.projects.filter((p) => !p.archived));
  const pm = useWorkspace((s) => s.projectMembers);
  const members = useWorkspace((s) => s.members);
  const online = usePresence((s) => s.online);
  const navigate = useNavigate();
  if (!projects.length) return <EmptyState icon={<FolderKanban />} title="No shared projects yet" />;
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-panel">
      {projects.map((p) => {
        const access = p.visibility === 'team' ? members.length : members.filter((m) => m.role === 'owner' || m.role === 'admin' || pm.some((x) => x.project_id === p.id && x.user_id === m.user_id)).length;
        const here = Object.values(online).filter((o) => o.project_id === p.id).length;
        return (
          <button key={p.id} onClick={() => navigate(`/projects/${p.id}/members`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
            <ProjectThumb project={p} size={32} />
            <span className="flex-1 truncate text-[13.5px] font-medium">{p.name}</span>
            <span className="text-[12px] text-fg-muted">{p.visibility === 'team' ? 'Whole team' : 'Members only'} · {access} with access</span>
            <span className="w-[90px] text-right text-[12px] text-success">{here ? `${here} here now` : ''}</span>
            <PresenceStack filter={(o) => o.project_id === p.id} size={20} />
          </button>
        );
      })}
    </div>
  );
}

function PermissionsTab() {
  return (
    <div className="space-y-3">
      <Notice icon={<Shield />}>Roles set what each member can do across the team. You can customize individual members from the Members tab, and give someone a different role inside a single project from that project’s Members tab. The workspace server enforces these rules, not just the app.</Notice>
      <Card padded={false}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-3 font-medium text-fg-muted">Permission</th>
              {ROLES.map((r) => (
                <th key={r} className="px-4 py-3 text-center font-medium">
                  {ROLE_INFO[r].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {PERMS.map((p) => (
              <tr key={p.key}>
                <td className="px-4 py-2.5"><p>{p.label}</p><p className="text-[11.5px] text-fg-subtle">{p.description}</p></td>
                {ROLES.map((r) => (
                  <td key={r} className="px-4 py-2.5 text-center">{roleDefault(r, p.key) ? <Check className="mx-auto size-4 text-success" aria-label="Allowed" /> : <span className="text-fg-subtle" aria-label="Not allowed">—</span>}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2.5"><p>Delete the team, transfer ownership</p></td>
              {ROLES.map((r) => <td key={r} className="px-4 py-2.5 text-center">{r === 'owner' ? <Check className="mx-auto size-4 text-success" /> : <span className="text-fg-subtle">—</span>}</td>)}
            </tr>
          </tbody>
        </table>
      </Card>
      <div className="grid grid-cols-4 gap-3">
        {ROLES.map((r) => <Card key={r} title={ROLE_INFO[r].label}><p className="text-[12.5px] text-fg-muted">{ROLE_INFO[r].description}</p></Card>)}
      </div>
    </div>
  );
}

const COLORS = ['green', 'indigo', 'blue', 'violet', 'amber', 'rose'];

export function TeamSettingsTab() {
  const team = useWorkspace((s) => s.teams.find((t) => t.id === s.teamId));
  const me = useMe();
  const navigate = useNavigate();
  const [name, setName] = useState(team?.name ?? '');
  const canManage = hasPerm(me, 'manage_members');
  if (!team) return null;
  const [uploading, setUploading] = useState(false);
  const save = async (patch: { name?: string; color?: string; avatar_url?: string | null }, ok = 'Team updated') => {
    try {
      // .select() makes an update that changed nothing (no permission) an error instead of a silent no-op.
      const { data, error } = await sb().from('teams').update(patch).eq('id', team.id).select().maybeSingle();
      if (error) {
        if (/avatar_url/.test(error.message)) throw new Error('Team pictures need a database update. Run supabase/migrations/20261127000000_team_avatars.sql in the Supabase SQL Editor, then try again.');
        throw new Error(error.message);
      }
      if (!data) throw new Error('You don’t have permission to change this team.');
      useWorkspace.setState({ teams: useWorkspace.getState().teams.map((t) => (t.id === team.id ? { ...t, ...(data as Partial<Team>) } : t)) });
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message, { duration: 10000 });
    }
  };
  return (
    <div className="grid max-w-[640px] gap-3">
      <Card title="Team profile">
        <div className="space-y-4">
          <Field label="Team picture" hint="Square PNG, JPG or WebP, up to 5 MB. Shown in the sidebar, invites and team pages.">
            <div className="flex items-center gap-3">
              <TeamMark name={team.name} color={team.color} url={team.avatar_url} size={56} />
              <Button size="sm" disabled={!canManage} loading={uploading} onClick={async () => {
                const f = await pickFile('image/png,image/jpeg,image/webp');
                if (!f) return;
                setUploading(true);
                try {
                  const url = await uploadPublicImage('thumbnails', team.id, f);
                  await save({ avatar_url: url }, 'Team picture updated');
                } catch (e) {
                  toast.error(`Upload failed: ${(e as Error).message}`, { duration: 10000 });
                } finally {
                  setUploading(false);
                }
              }}>{uploading ? 'Uploading…' : 'Upload picture'}</Button>
              {team.avatar_url && <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => save({ avatar_url: null })}>Remove</Button>}
            </div>
          </Field>
          <Field label="Name">
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} maxLength={60} />
              <Button disabled={!canManage || !name.trim() || name === team.name} onClick={() => save({ name: name.trim() })}>Save</Button>
            </div>
          </Field>
          <Field label="Colour">
            <div className="flex gap-2">
              {COLORS.map((c) => <button key={c} disabled={!canManage} aria-label={c} aria-pressed={team.color === c} onClick={() => save({ color: c })} className={cn('size-7 rounded-md ring-offset-2 ring-offset-panel disabled:opacity-50', team.color === c && 'ring-2 ring-fg')} style={{ background: teamColor(c) }} />)}
            </div>
          </Field>
          <p className="text-[12px] text-fg-subtle">Created {shortDate(team.created_at)} by <UserName userId={team.created_by} /></p>
        </div>
      </Card>
      <Card title="Danger zone">
        <div className="flex flex-wrap gap-2">
          {me?.role !== 'owner' && <Button variant="danger" icon={<LogOut className="size-3.5" />} onClick={async () => { if (await confirm({ title: `Leave ${team.name}?`, danger: true, confirm: 'Leave team' })) { try { await removeMember(me!.user_id); navigate('/'); } catch (e) { toast.error((e as Error).message); } } }}>Leave team</Button>}
          <Button variant="danger" icon={<Trash2 className="size-3.5" />} disabled={me?.role !== 'owner'}
            onClick={async () => { if (await confirm({ title: `Delete ${team.name}?`, body: 'Every project, bug, task, script, comment and analytics record in this team is permanently deleted for all members.', danger: true, confirm: 'Delete team forever', typeToConfirm: team.name })) { try { must(await sb().rpc('delete_team', { p_team: team.id })); await useWorkspace.getState().loadTeams(); navigate('/'); toast.success('Team deleted'); } catch (e) { toast.error((e as Error).message); } } }}>
            Delete team
          </Button>
          {me?.role !== 'owner' && <span className="self-center text-[12px] text-fg-subtle">Only the owner can delete the team.</span>}
        </div>
      </Card>
    </div>
  );
}

