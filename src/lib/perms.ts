// Mirrors public.role_default / has_perm in the migration. The UI uses this only to
// hide or disable controls; the database enforces the same rules.
import type { Member, Perm, Role } from './types';

export const ROLES: Role[] = ['owner', 'admin', 'developer', 'viewer'];

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Full control over the team, projects, settings and members.' },
  admin: { label: 'Admin', description: 'Manage projects, members and workspace settings.' },
  developer: { label: 'Developer', description: 'Create and edit project content, scripts, tasks and bugs.' },
  viewer: { label: 'Viewer', description: 'View projects and activity without making changes.' },
};

export const PERMS: { key: Perm; label: string; description: string }[] = [
  { key: 'manage_members', label: 'Manage members', description: 'Invite, remove and change roles of members' },
  { key: 'manage_projects', label: 'Manage projects', description: 'Create, archive and delete projects' },
  { key: 'edit_content', label: 'Edit content', description: 'Create and edit tasks, bugs and project info' },
  { key: 'comment', label: 'Comment', description: 'Comment on bugs and tasks' },
  { key: 'manage_scripts', label: 'Edit scripts', description: 'Create and edit shared Luau scripts' },
  { key: 'manage_publish', label: 'Manage publishing', description: 'Schedule icon updates and countdowns' },
  { key: 'view_analytics', label: 'View analytics', description: 'See experience statistics' },
];

export function roleDefault(role: Role, perm: Perm): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role === 'developer') return ['edit_content', 'comment', 'manage_scripts', 'manage_publish', 'view_analytics'].includes(perm);
  return perm === 'view_analytics';
}

export function hasPerm(member: Member | undefined | null, perm: Perm): boolean {
  if (!member) return false;
  if (member.role === 'owner') return true;
  const o = member.permissions?.[perm];
  return typeof o === 'boolean' ? o : roleDefault(member.role, perm);
}

export function projectPerm(member: Member | undefined | null, projectRole: Role | undefined, perm: Perm): boolean {
  if (!member) return false;
  if (member.role === 'owner' || member.role === 'admin') return hasPerm(member, perm);
  if (projectRole) return roleDefault(projectRole, perm);
  return hasPerm(member, perm);
}
