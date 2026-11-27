import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, Bell, Bug, Check, ChevronsUpDown, Code2, FolderKanban, LayoutDashboard, Lock, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Rocket, Search, Settings, User, Users } from 'lucide-react';
import { Avatar, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui';
import { cn, modKey } from '@/lib/format';
import { usePrefs } from '@/store/prefs';
import { displayName, useWorkspace } from '@/store/workspace';
import { useSession } from '@/store/session';
import { useNotifications } from '@/store/notifications';
import { useUI } from '@/store/ui';
import { useEngine } from '@/store/engine';
import { isOpenBug } from '@/components/common';

const TEAM_COLORS: Record<string, string> = { green: '#22c55e', indigo: '#818cf8', blue: '#3b9eff', violet: '#a78bfa', amber: '#f5b83d', rose: '#fb7185' };
export const teamColor = (c: string) => TEAM_COLORS[c] ?? TEAM_COLORS.green;

export function TeamMark({ name, color, size = 22, url }: { name: string; color: string; size?: number; url?: string | null }) {
  if (url) return <img src={url} alt="" className="shrink-0 rounded-md object-cover ring-1 ring-line" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-md font-semibold text-black/80" style={{ width: size, height: size, background: teamColor(color), fontSize: size * 0.48 }} aria-hidden>
      {name.trim()[0]?.toUpperCase() ?? 'T'}
    </span>
  );
}

export function Sidebar({ offline }: { offline?: boolean }) {
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const setPrefs = usePrefs((s) => s.set);
  const navigate = useNavigate();
  const { teams, teamId, selectTeam } = useWorkspace();
  const team = teams.find((t) => t.id === teamId);
  const user = useSession((s) => s.user);
  const profile = useSession((s) => s.profile);
  const unread = useNotifications((s) => s.items.filter((n) => !n.read_at).length);
  const myOpenBugs = useWorkspace((s) => s.bugs.filter((b) => b.assignee_id === user?.id && isOpenBug(b.status)).length);
  const activeLocal = useEngine((s) => s.state?.experiences.filter((e) => e.update && ['preparing', 'scheduled', 'restoring'].includes(e.update.status)).length ?? 0);
  const setUI = useUI((s) => s.set);

  const nav = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true, key: 'O' },
    { to: '/projects', label: 'Projects', icon: FolderKanban, key: 'P' },
    { to: '/publish', label: 'Publish', icon: Rocket, key: 'U', count: activeLocal || undefined, countTone: 'accent' as const },
    { to: '/analytics', label: 'Analytics', icon: BarChart3, key: 'A' },
    { to: '/bugs', label: 'Bugs', icon: Bug, key: 'B', count: myOpenBugs || undefined },
    { to: '/scripts', label: 'Scripts', icon: Code2, key: 'S' },
    { to: '/team', label: 'Team', icon: Users, key: 'T' },
  ];
  const name = offline ? 'Offline mode' : displayName(profile, user?.email ?? 'You');

  return (
    <aside
      className={cn('flex shrink-0 flex-col border-r border-line bg-sunken transition-[width] duration-200 ease-out', collapsed ? 'w-[56px]' : 'w-[232px]')}
      aria-label="Main navigation"
    >
      {/* Team switcher */}
      <div className="flex h-12 items-center gap-1 px-2">
        {offline ? (
          <div className={cn('flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-fg-muted', collapsed && 'justify-center px-0')}>
            <Lock className="size-4 shrink-0" />
            {!collapsed && <span className="truncate text-[13px]">Local only</span>}
          </div>
        ) : (
          <Menu>
            <MenuTrigger asChild>
              <button className={cn('flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover', collapsed && 'justify-center px-0')} aria-label="Switch team">
                <TeamMark name={team?.name ?? 'Team'} color={team?.color ?? 'green'} url={team?.avatar_url} />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{team?.name ?? 'Select team'}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
                  </>
                )}
              </button>
            </MenuTrigger>
            <MenuContent align="start" className="w-[240px]">
              <MenuLabel>Teams</MenuLabel>
              {teams.map((t) => (
                <MenuItem key={t.id} icon={<TeamMark name={t.name} color={t.color} url={t.avatar_url} size={16} />} onSelect={() => { selectTeam(t.id); navigate('/'); }}>
                  <span className="flex items-center justify-between gap-2">
                    {t.name}
                    {t.id === teamId && <Check className="size-3.5 text-accent-text" />}
                  </span>
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem icon={<Plus />} onSelect={() => navigate('/team/new')}>Create team</MenuItem>
              <MenuItem icon={<Users />} onSelect={() => navigate('/team/settings')}>Team settings</MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>

      {/* Search */}
      {!offline && (
        <div className="px-2 pb-2">
          <Tooltip content={collapsed ? `Search (${modKey}+K)` : ''}>
            <button
              onClick={() => setUI({ palette: true })}
              className={cn('flex h-8 w-full items-center gap-2 rounded-md border border-line bg-panel px-2 text-[12.5px] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted', collapsed && 'justify-center px-0')}
              aria-label="Search"
            >
              <Search className="size-3.5 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Search…</span>
                  <Kbd>{modKey} K</Kbd>
                </>
              )}
            </button>
          </Tooltip>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-2 py-1">
        {nav.map((item) => {
          const locked = offline && item.to !== '/publish';
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors duration-150',
                  isActive ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  collapsed && 'justify-center px-0',
                  locked && 'opacity-50',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-accent" />}
                  <item.icon className={cn('size-4 shrink-0', isActive ? 'text-accent-text' : 'text-fg-subtle group-hover:text-fg-muted')} />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {!collapsed && locked && <Lock className="size-3 text-fg-subtle" />}
                  {!collapsed && !locked && item.count !== undefined && (
                    <span className={cn('tabular rounded-[4px] px-1.5 text-[11px] font-medium', item.countTone === 'accent' ? 'bg-accent-soft text-accent-text' : 'bg-active text-fg-muted')}>{item.count}</span>
                  )}
                  {collapsed && item.count !== undefined && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />}
                </>
              )}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to} content={<span className="flex items-center gap-2">{item.label}<Kbd>G {item.key}</Kbd></span>} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      {/* Bottom: notifications, settings, profile */}
      <div className="flex flex-col gap-px border-t border-line p-2">
        {!offline && (
          <SideButton collapsed={collapsed} icon={<Bell className="size-4" />} label="Notifications" onClick={() => setUI({ notifications: true })} badge={unread || undefined} />
        )}
        <NavLink to="/settings" className={({ isActive }) => cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors', isActive ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg', collapsed && 'justify-center px-0')}>
          <Settings className="size-4 shrink-0 text-fg-subtle" />
          {!collapsed && <span>Settings</span>}
        </NavLink>
        <div className={cn('mt-1 flex items-center gap-1', collapsed && 'flex-col')}>
          <Menu>
            <MenuTrigger asChild>
              <button className={cn('flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover', collapsed && 'w-full justify-center px-0')} aria-label="Account menu">
                <Avatar name={name} url={profile?.avatar_url} id={user?.id} size={26} online={!offline ? true : undefined} />
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{name}</span>
                    <span className="block truncate text-[11.5px] text-fg-subtle">{offline ? 'Not signed in' : user?.email}</span>
                  </span>
                )}
              </button>
            </MenuTrigger>
            <MenuContent align="start" side="top" className="w-[220px]">
              {offline ? (
                <MenuItem icon={<User />} onSelect={() => setUI({ offline: false })}>Sign in to a workspace</MenuItem>
              ) : (
                <>
                  <MenuItem icon={<User />} onSelect={() => navigate('/settings/profile')}>Profile</MenuItem>
                  <MenuItem icon={<Settings />} onSelect={() => navigate('/settings')} shortcut={`${modKey} ,`}>Settings</MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<LogOut />} onSelect={() => useSession.getState().signOut()}>Sign out</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
          <Tooltip content={`${collapsed ? 'Expand' : 'Collapse'} sidebar (${modKey}+B)`} side="right">
            <button onClick={() => setPrefs({ sidebarCollapsed: !collapsed })} className="grid size-8 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

function SideButton({ collapsed, icon, label, onClick, badge }: { collapsed: boolean; icon: React.ReactNode; label: string; onClick: () => void; badge?: number }) {
  const btn = (
    <button onClick={onClick} className={cn('relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg [&>svg]:text-fg-subtle', collapsed && 'justify-center px-0')} aria-label={badge ? `${label}, ${badge} unread` : label}>
      {icon}
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {badge !== undefined && (collapsed ? <span className="absolute right-2 top-1.5 size-2 rounded-full bg-accent" /> : <span className="tabular rounded-[4px] bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{badge}</span>)}
    </button>
  );
  return collapsed ? <Tooltip content={label} side="right">{btn}</Tooltip> : btn;
}
