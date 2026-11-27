-- =====================================================================================
-- Corel workspace schema
-- Teams, projects, tasks, bugs, comments, scripts (with version history), publishing,
-- analytics snapshots, activity feed and notifications. Every table is protected by
-- row level security; activity and notifications are written only by triggers so they
-- cannot be forged from a client.
-- =====================================================================================


-- ------------------------------------------------------------------ types

create type public.team_role as enum ('owner', 'admin', 'developer', 'viewer');
create type public.bug_severity as enum ('low', 'medium', 'high', 'critical');
create type public.bug_status as enum ('reported', 'confirmed', 'in_progress', 'fixed', 'closed');
create type public.task_status as enum ('todo', 'in_progress', 'done');
create type public.task_priority as enum ('none', 'low', 'medium', 'high', 'urgent');

-- ------------------------------------------------------------------ tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  username text unique check (username is null or username ~ '^[a-z0-9_.-]{2,32}$'),
  avatar_url text,
  roblox_username text,
  bio text not null default '',
  notification_prefs jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  color text not null default 'green',
  created_by uuid references auth.users (id) on delete set null,
  bug_seq integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null default 'developer',
  permissions jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  role public.team_role not null default 'developer' check (role <> 'owner'),
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  uses integer not null default 0,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index team_invites_team_idx on public.team_invites (team_id);
create index team_invites_email_idx on public.team_invites (lower(email));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  thumbnail_url text,
  place_id text check (place_id is null or place_id ~ '^[0-9]{1,20}$'),
  universe_id text check (universe_id is null or universe_id ~ '^[0-9]{1,20}$'),
  color text not null default 'green',
  visibility text not null default 'team' check (visibility in ('team', 'members')),
  archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_team_idx on public.projects (team_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null default 'developer' check (role <> 'owner'),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'none',
  assignee_id uuid references auth.users (id) on delete set null,
  due_date date,
  position double precision not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_team_idx on public.tasks (team_id);
create index tasks_project_idx on public.tasks (project_id);

create table public.bugs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  number integer not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  steps text not null default '',
  environment text not null default '',
  severity public.bug_severity not null default 'medium',
  status public.bug_status not null default 'reported',
  assignee_id uuid references auth.users (id) on delete set null,
  reporter_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fixed_at timestamptz
);
create index bugs_team_idx on public.bugs (team_id);
create index bugs_project_idx on public.bugs (project_id);

create table public.bug_attachments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  bug_id uuid not null references public.bugs (id) on delete cascade,
  path text not null,
  name text not null,
  size bigint not null default 0,
  mime text not null default 'application/octet-stream',
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index bug_attachments_bug_idx on public.bug_attachments (bug_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  entity_type text not null check (entity_type in ('bug', 'task')),
  entity_id uuid not null,
  author_id uuid references auth.users (id) on delete set null default auth.uid(),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_entity_idx on public.comments (entity_id);
create index comments_team_idx on public.comments (team_id);

create table public.script_folders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  parent_id uuid references public.script_folders (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  folder_id uuid references public.script_folders (id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '',
  category text not null default 'Module',
  tags text[] not null default '{}',
  content text not null default '',
  visibility text not null default 'team' check (visibility in ('team', 'projects', 'private')),
  shared_project_ids uuid[] not null default '{}',
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scripts_team_idx on public.scripts (team_id);

create table public.script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.scripts (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  version integer not null,
  content text not null,
  message text not null default '',
  edited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (script_id, version)
);

create table public.script_favorites (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  script_id uuid not null references public.scripts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, script_id)
);

create table public.publish_updates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  local_update_id text not null unique,
  scheduled_by uuid references auth.users (id) on delete set null default auth.uid(),
  machine text not null default '',
  update_at timestamptz not null,
  status text not null check (status in ('preparing', 'scheduled', 'restoring', 'done', 'cancelled')),
  steps jsonb not null default '[]'::jsonb,
  place_names text[] not null default '{}',
  announcement_title text not null default '',
  announcement_body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index publish_updates_team_idx on public.publish_updates (team_id);

create table public.analytics_snapshots (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  bucket bigint not null,
  captured_at timestamptz not null default now(),
  visits bigint,
  playing bigint,
  favorites bigint,
  up_votes bigint,
  down_votes bigint,
  unique (project_id, bucket)
);
create index analytics_snapshots_project_idx on public.analytics_snapshots (project_id, captured_at);

create table public.analytics_metrics (
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  metric text not null check (metric ~ '^[a-z0-9_]{2,40}$'),
  day date not null,
  value double precision not null,
  source text not null default 'import',
  imported_by uuid references auth.users (id) on delete set null default auth.uid(),
  imported_at timestamptz not null default now(),
  primary key (project_id, metric, day)
);

create table public.activity (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  verb text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_team_idx on public.activity (team_id, created_at desc);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ------------------------------------------------------------------ permission helpers

-- Default permissions per role. Owners always have everything; per-member overrides
-- live in team_members.permissions ({"manage_publish": false, ...}).
create or replace function public.role_default(r public.team_role, p text)
returns boolean language sql immutable as $$
  select case r
    when 'owner' then true
    when 'admin' then true
    when 'developer' then p in ('edit_content', 'comment', 'manage_scripts', 'manage_publish', 'view_analytics')
    else p in ('view_analytics')
  end
$$;

create or replace function public.is_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid())
$$;

create or replace function public.team_role_of(p_team uuid)
returns public.team_role language sql stable security definer set search_path = public as $$
  select role from team_members where team_id = p_team and user_id = auth.uid()
$$;

create or replace function public.has_perm(p_team uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'owner' then true
      when m.permissions ? p_perm then (m.permissions ->> p_perm)::boolean
      else public.role_default(m.role, p_perm)
    end
    from team_members m where m.team_id = p_team and m.user_id = auth.uid()
  ), false)
$$;

create or replace function public.can_view_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.is_member(pr.team_id) and (
      pr.visibility = 'team'
      or public.team_role_of(pr.team_id) in ('owner', 'admin')
      or pr.created_by = auth.uid()
      or exists (select 1 from project_members pm where pm.project_id = pr.id and pm.user_id = auth.uid())
    )
    from projects pr where pr.id = p_project
  ), false)
$$;

-- Project-level permission: a project role (project_members) replaces the team role
-- inside that project, except for team owners and admins.
create or replace function public.project_perm(p_project uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when not public.can_view_project(pr.id) then false
      when public.team_role_of(pr.team_id) in ('owner', 'admin') then public.has_perm(pr.team_id, p_perm)
      when pm.role is not null then public.role_default(pm.role, p_perm)
      else public.has_perm(pr.team_id, p_perm)
    end
    from projects pr
    left join project_members pm on pm.project_id = pr.id and pm.user_id = auth.uid()
    where pr.id = p_project
  ), false)
$$;

create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members where project_id = p_project and user_id = auth.uid())
$$;

create or replace function public.project_team(p_project uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from projects where id = p_project
$$;

create or replace function public.shares_team(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

create or replace function public.can_view_script(s public.scripts)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member(s.team_id) and (
    s.visibility = 'team'
    or s.created_by = auth.uid()
    or public.team_role_of(s.team_id) in ('owner', 'admin')
    or (s.visibility = 'projects' and exists (select 1 from unnest(s.shared_project_ids) pid where public.can_view_project(pid)))
  )
$$;

create or replace function public.display_name_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), username, split_part(email, '@', 1), 'Someone') from profiles where id = p_user
$$;

-- ------------------------------------------------------------------ activity + notifications

create or replace function public.log_activity(p_team uuid, p_project uuid, p_verb text, p_type text, p_id text, p_summary text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into activity (team_id, project_id, actor_id, verb, entity_type, entity_id, summary, meta)
  values (p_team, p_project, auth.uid(), p_verb, p_type, p_id, p_summary, coalesce(p_meta, '{}'::jsonb))
$$;
revoke execute on function public.log_activity(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- Sends a notification unless it is to the actor or the user turned that kind off.
create or replace function public.notify_user(p_user uuid, p_team uuid, p_kind text, p_title text, p_body text, p_link jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare prefs jsonb;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  select notification_prefs into prefs from profiles where id = p_user;
  if prefs is not null and prefs ? p_kind and (prefs ->> p_kind)::boolean = false then return; end if;
  insert into notifications (user_id, team_id, kind, title, body, link, actor_id)
  values (p_user, p_team, p_kind, p_title, coalesce(p_body, ''), coalesce(p_link, '{}'::jsonb), auth.uid());
end $$;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ triggers: housekeeping

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger bugs_touch before update on public.bugs for each row execute function public.touch_updated_at();
create trigger publish_touch before update on public.publish_updates for each row execute function public.touch_updated_at();

-- team_id on child rows always comes from the project, never from the client.
create or replace function public.set_team_from_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from projects where id = new.project_id;
  if new.team_id is null then raise exception 'Project not found'; end if;
  return new;
end $$;

create trigger tasks_team before insert or update of project_id on public.tasks for each row execute function public.set_team_from_project();
create trigger comments_team before insert on public.comments for each row execute function public.set_team_from_project();
create trigger publish_team before insert or update of project_id on public.publish_updates for each row execute function public.set_team_from_project();
create trigger snapshots_team before insert on public.analytics_snapshots for each row execute function public.set_team_from_project();
create trigger metrics_team before insert or update on public.analytics_metrics for each row execute function public.set_team_from_project();

-- A comment must belong to an item in the project it claims.
create or replace function public.comments_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'bug' and not exists (select 1 from bugs where id = new.entity_id and project_id = new.project_id) then
    raise exception 'Bug not found in this project';
  end if;
  if new.entity_type = 'task' and not exists (select 1 from tasks where id = new.entity_id and project_id = new.project_id) then
    raise exception 'Task not found in this project';
  end if;
  new.author_id = auth.uid();
  return new;
end $$;
create trigger comments_validate before insert on public.comments for each row execute function public.comments_validate();

-- The email on a profile mirrors the sign-in email and cannot be edited directly.
create or replace function public.profiles_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then new.email = old.email; end if;
  new.created_at = old.created_at;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

create or replace function public.bugs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from projects where id = new.project_id;
  if new.team_id is null then raise exception 'Project not found'; end if;
  update teams set bug_seq = bug_seq + 1 where id = new.team_id returning bug_seq into new.number;
  new.reporter_id = coalesce(auth.uid(), new.reporter_id);
  return new;
end $$;
create trigger bugs_insert before insert on public.bugs for each row execute function public.bugs_before_insert();

create or replace function public.bugs_before_update()
returns trigger language plpgsql as $$
begin
  new.number = old.number;
  new.reporter_id = old.reporter_id;
  if new.project_id <> old.project_id then
    select team_id into new.team_id from public.projects where id = new.project_id;
    if new.team_id <> old.team_id then raise exception 'Bugs cannot move between teams'; end if;
  end if;
  if new.status in ('fixed', 'closed') and old.status not in ('fixed', 'closed') then new.fixed_at = now(); end if;
  if new.status not in ('fixed', 'closed') then new.fixed_at = null; end if;
  return new;
end $$;
create trigger bugs_update before update on public.bugs for each row execute function public.bugs_before_update();

create or replace function public.tasks_before_update()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and old.status <> 'done' then new.completed_at = now(); end if;
  if new.status <> 'done' then new.completed_at = null; end if;
  return new;
end $$;
create trigger tasks_update before update on public.tasks for each row execute function public.tasks_before_update();

create or replace function public.attachments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from bugs where id = new.bug_id;
  if new.team_id is null then raise exception 'Bug not found'; end if;
  return new;
end $$;
create trigger attachments_team before insert on public.bug_attachments for each row execute function public.attachments_before_insert();

-- Script content changes only through save_script(), which checks the version so
-- nobody's work is silently overwritten.
create or replace function public.scripts_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.content is distinct from old.content and coalesce(current_setting('corel.via_save', true), '') <> 'on' then
      raise exception 'Script content can only be changed with save_script()';
    end if;
    if coalesce(current_setting('corel.via_save', true), '') <> 'on' then
      new.version = old.version;
    end if;
    new.team_id = old.team_id;
    new.created_by = old.created_by;
    new.updated_at = now();
  end if;
  return new;
end $$;
create trigger scripts_guard before update on public.scripts for each row execute function public.scripts_guard();

create or replace function public.scripts_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into script_versions (script_id, team_id, version, content, message, edited_by)
  values (new.id, new.team_id, new.version, new.content, 'Created', auth.uid());
  perform log_activity(new.team_id, null, 'created', 'script', new.id::text, 'created script ' || new.name, jsonb_build_object('name', new.name));
  return new;
end $$;
create trigger scripts_insert after insert on public.scripts for each row execute function public.scripts_after_insert();

-- ------------------------------------------------------------------ triggers: activity

create or replace function public.projects_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.team_id, new.id, 'created', 'project', new.id::text, 'created project ' || new.name, '{}');
  elsif tg_op = 'UPDATE' then
    if new.archived and not old.archived then
      perform log_activity(new.team_id, new.id, 'archived', 'project', new.id::text, 'archived project ' || new.name, '{}');
    elsif (new.name, new.description, new.place_id, new.universe_id, new.thumbnail_url, new.visibility)
      is distinct from (old.name, old.description, old.place_id, old.universe_id, old.thumbnail_url, old.visibility) then
      perform log_activity(new.team_id, new.id, 'updated', 'project', new.id::text, 'updated project ' || new.name, '{}');
      if old.created_by is not null then
        perform notify_user(old.created_by, new.team_id, 'project_change', public.display_name_of(auth.uid()) || ' updated ' || new.name, '', jsonb_build_object('type', 'project', 'id', new.id));
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger projects_activity after insert or update on public.projects for each row execute function public.projects_activity();

create or replace function public.bugs_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare tag text := 'BUG-' || new.number;
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.team_id, new.project_id, 'created', 'bug', new.id::text, 'reported ' || tag || ': ' || new.title, jsonb_build_object('severity', new.severity));
    if new.assignee_id is not null then
      perform notify_user(new.assignee_id, new.team_id, 'bug_assigned', 'You were assigned ' || tag, new.title, jsonb_build_object('type', 'bug', 'id', new.id));
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    perform log_activity(new.team_id, new.project_id, 'status', 'bug', new.id::text,
      case when new.status = 'fixed' then 'marked ' || tag || ' as fixed' else 'moved ' || tag || ' to ' || replace(new.status::text, '_', ' ') end,
      jsonb_build_object('from', old.status, 'to', new.status));
    if new.reporter_id is not null then
      perform notify_user(new.reporter_id, new.team_id, 'bug_update', tag || ' is now ' || replace(new.status::text, '_', ' '), new.title, jsonb_build_object('type', 'bug', 'id', new.id));
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform log_activity(new.team_id, new.project_id, 'assigned', 'bug', new.id::text,
      case when new.assignee_id is null then 'unassigned ' || tag else 'assigned ' || tag || ' to ' || public.display_name_of(new.assignee_id) end,
      jsonb_build_object('assignee', new.assignee_id));
    perform notify_user(new.assignee_id, new.team_id, 'bug_assigned', 'You were assigned ' || tag, new.title, jsonb_build_object('type', 'bug', 'id', new.id));
  end if;
  if new.severity is distinct from old.severity then
    perform log_activity(new.team_id, new.project_id, 'severity', 'bug', new.id::text, 'set ' || tag || ' severity to ' || new.severity, jsonb_build_object('from', old.severity, 'to', new.severity));
  end if;
  if (new.title, new.description, new.steps, new.environment) is distinct from (old.title, old.description, old.steps, old.environment) then
    perform log_activity(new.team_id, new.project_id, 'edited', 'bug', new.id::text, 'edited ' || tag, '{}');
  end if;
  return null;
end $$;
create trigger bugs_activity after insert or update on public.bugs for each row execute function public.bugs_activity();

create or replace function public.tasks_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.team_id, new.project_id, 'created', 'task', new.id::text, 'created task ' || new.title, '{}');
    perform notify_user(new.assignee_id, new.team_id, 'task_update', 'You were assigned a task', new.title, jsonb_build_object('type', 'task', 'id', new.id, 'project', new.project_id));
    return null;
  end if;
  if new.status is distinct from old.status then
    perform log_activity(new.team_id, new.project_id, case when new.status = 'done' then 'completed' else 'status' end, 'task', new.id::text,
      case when new.status = 'done' then 'completed task ' || new.title else 'moved task ' || new.title || ' to ' || replace(new.status::text, '_', ' ') end, '{}');
    if new.status = 'done' then
      perform notify_user(new.created_by, new.team_id, 'task_update', 'Task completed', new.title, jsonb_build_object('type', 'task', 'id', new.id, 'project', new.project_id));
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform log_activity(new.team_id, new.project_id, 'assigned', 'task', new.id::text, 'assigned task ' || new.title || ' to ' || public.display_name_of(new.assignee_id), '{}');
    perform notify_user(new.assignee_id, new.team_id, 'task_update', 'You were assigned a task', new.title, jsonb_build_object('type', 'task', 'id', new.id, 'project', new.project_id));
  end if;
  return null;
end $$;
create trigger tasks_activity after insert or update on public.tasks for each row execute function public.tasks_activity();

create or replace function public.comments_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  label text;
  who text := public.display_name_of(auth.uid());
begin
  if new.entity_type = 'bug' then
    select 'BUG-' || number as tag, title, reporter_id, assignee_id into r from bugs where id = new.entity_id;
    label := r.tag;
    perform log_activity(new.team_id, new.project_id, 'commented', 'bug', new.entity_id::text, 'commented on ' || label, jsonb_build_object('comment', new.id));
    perform notify_user(u, new.team_id, 'comment', who || ' commented on ' || label, left(new.body, 200), jsonb_build_object('type', 'bug', 'id', new.entity_id))
      from (select distinct u from unnest(array[r.reporter_id, r.assignee_id]) u
            union select distinct author_id from comments where entity_id = new.entity_id and id <> new.id) s(u)
      where u is not null;
  else
    select title, created_by, assignee_id into r from tasks where id = new.entity_id;
    perform log_activity(new.team_id, new.project_id, 'commented', 'task', new.entity_id::text, 'commented on task ' || r.title, jsonb_build_object('comment', new.id));
    perform notify_user(u, new.team_id, 'comment', who || ' commented on ' || r.title, left(new.body, 200), jsonb_build_object('type', 'task', 'id', new.entity_id, 'project', new.project_id))
      from (select distinct u from unnest(array[r.created_by, r.assignee_id]) u) s(u) where u is not null;
  end if;
  return null;
end $$;
create trigger comments_activity after insert on public.comments for each row execute function public.comments_activity();

create or replace function public.members_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into activity (team_id, actor_id, verb, entity_type, entity_id, summary)
    values (new.team_id, new.user_id, 'joined', 'member', new.user_id::text, 'joined the team');
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform log_activity(new.team_id, null, 'role', 'member', new.user_id::text, 'changed ' || public.display_name_of(new.user_id) || '''s role to ' || new.role, '{}');
  elsif tg_op = 'DELETE' then
    insert into activity (team_id, actor_id, verb, entity_type, entity_id, summary)
    select old.team_id, auth.uid(), 'left', 'member', old.user_id::text,
      case when auth.uid() = old.user_id then 'left the team' else 'removed ' || public.display_name_of(old.user_id) || ' from the team' end
    where exists (select 1 from teams where id = old.team_id);
  end if;
  return null;
end $$;
create trigger members_activity after insert or update or delete on public.team_members for each row execute function public.members_activity();

create or replace function public.project_members_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select team_id, name into p from projects where id = new.project_id;
  perform log_activity(p.team_id, new.project_id, 'joined', 'project', new.project_id::text, 'added ' || public.display_name_of(new.user_id) || ' to ' || p.name, '{}');
  perform notify_user(new.user_id, p.team_id, 'project_change', 'You were added to ' || p.name, '', jsonb_build_object('type', 'project', 'id', new.project_id));
  return null;
end $$;
create trigger project_members_activity after insert on public.project_members for each row execute function public.project_members_activity();

create or replace function public.publish_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare pname text;
begin
  select name into pname from projects where id = new.project_id;
  if tg_op = 'INSERT' then
    perform log_activity(new.team_id, new.project_id, 'scheduled', 'update', new.id::text, 'scheduled an update for ' || pname, jsonb_build_object('at', new.update_at));
    perform notify_user(m.user_id, new.team_id, 'publish', 'Update scheduled for ' || pname, to_char(new.update_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC', jsonb_build_object('type', 'publish', 'id', new.project_id))
      from team_members m where m.team_id = new.team_id and public.role_default(m.role, 'manage_publish');
  elsif new.status is distinct from old.status and new.status in ('done', 'cancelled') then
    perform log_activity(new.team_id, new.project_id, new.status, 'update', new.id::text,
      case when new.status = 'done' then 'published the new icon for ' || pname else 'cancelled the update for ' || pname end, '{}');
  end if;
  return null;
end $$;
create trigger publish_activity after insert or update on public.publish_updates for each row execute function public.publish_activity();

-- ------------------------------------------------------------------ RPCs

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email after update of email on auth.users for each row execute function public.handle_user_email_change();

create or replace function public.create_team(p_name text, p_color text default 'green')
returns public.teams language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into teams (name, color, created_by) values (trim(p_name), coalesce(p_color, 'green'), auth.uid()) returning * into t;
  insert into team_members (team_id, user_id, role) values (t.id, auth.uid(), 'owner');
  return t;
end $$;

create or replace function public.get_invite(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'team_id', i.team_id, 'team_name', t.name, 'team_color', t.color, 'role', i.role,
    'email', i.email, 'status', i.status, 'expired', i.expires_at < now(), 'invited_by', public.display_name_of(i.invited_by),
    'already_member', public.is_member(i.team_id))
  from team_invites i join teams t on t.id = i.team_id where i.token = p_token
$$;

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i team_invites;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into i from team_invites where token = p_token for update;
  if i.id is null then raise exception 'This invite link is not valid.'; end if;
  if i.status <> 'pending' then raise exception 'This invite was already %.', i.status; end if;
  if i.expires_at < now() then raise exception 'This invite has expired. Ask for a new one.'; end if;
  if i.email is not null and lower(i.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to %. Sign in with that email to accept it.', i.email;
  end if;
  insert into team_members (team_id, user_id, role) values (i.team_id, auth.uid(), i.role) on conflict do nothing;
  update team_invites set uses = uses + 1, status = case when email is null then status else 'accepted' end where id = i.id;
  return i.team_id;
end $$;

create or replace function public.decline_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update team_invites set status = 'declined'
  where id = p_invite and status = 'pending' and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  if not found then raise exception 'Invite not found.'; end if;
end $$;

create or replace function public.invites_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare tname text;
begin
  select name into tname from teams where id = new.team_id;
  if new.email is not null then
    perform notify_user(p.id, new.team_id, 'invite', public.display_name_of(auth.uid()) || ' invited you to ' || tname, 'Join as ' || new.role, jsonb_build_object('type', 'invite', 'id', new.id))
      from profiles p where lower(p.email) = lower(new.email);
  end if;
  perform log_activity(new.team_id, null, 'invited', 'member', new.id::text,
    case when new.email is null then 'created an invite link (' || new.role || ')' else 'invited ' || new.email || ' as ' || new.role end, '{}');
  return null;
end $$;
create trigger invites_after_insert after insert on public.team_invites for each row execute function public.invites_after_insert();

create or replace function public.set_member_role(p_team uuid, p_user uuid, p_role public.team_role)
returns void language plpgsql security definer set search_path = public as $$
declare me team_role := public.team_role_of(p_team); target team_role;
begin
  select role into target from team_members where team_id = p_team and user_id = p_user;
  if target is null then raise exception 'Not a member of this team.'; end if;
  if not public.has_perm(p_team, 'manage_members') then raise exception 'You do not have permission to manage members.'; end if;
  if (target = 'owner' or p_role = 'owner') and me <> 'owner' then raise exception 'Only the owner can transfer ownership.'; end if;
  if target = 'admin' and me <> 'owner' then raise exception 'Only the owner can change an admin''s role.'; end if;
  if p_role = 'owner' then
    update team_members set role = 'admin' where team_id = p_team and user_id = auth.uid();
  end if;
  if target = 'owner' and p_role <> 'owner' and not exists (select 1 from team_members where team_id = p_team and role = 'owner' and user_id <> p_user) then
    raise exception 'A team needs an owner. Transfer ownership first.';
  end if;
  update team_members set role = p_role where team_id = p_team and user_id = p_user;
end $$;

create or replace function public.set_member_permissions(p_team uuid, p_user uuid, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm(p_team, 'manage_members') then raise exception 'You do not have permission to manage members.'; end if;
  if exists (select 1 from team_members where team_id = p_team and user_id = p_user and role in ('owner', 'admin')) and public.team_role_of(p_team) <> 'owner' then
    raise exception 'Only the owner can change an admin''s permissions.';
  end if;
  update team_members set permissions = coalesce(p_perms, '{}'::jsonb) where team_id = p_team and user_id = p_user;
end $$;

create or replace function public.remove_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target team_role;
begin
  select role into target from team_members where team_id = p_team and user_id = p_user;
  if target is null then return; end if;
  if p_user = auth.uid() then
    if target = 'owner' then raise exception 'Transfer ownership before leaving the team.'; end if;
  else
    if not public.has_perm(p_team, 'manage_members') then raise exception 'You do not have permission to remove members.'; end if;
    if target = 'owner' then raise exception 'The owner cannot be removed.'; end if;
    if target = 'admin' and public.team_role_of(p_team) <> 'owner' then raise exception 'Only the owner can remove an admin.'; end if;
  end if;
  delete from team_members where team_id = p_team and user_id = p_user;
  delete from project_members pm using projects p where pm.project_id = p.id and p.team_id = p_team and pm.user_id = p_user;
end $$;

create or replace function public.delete_team(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.team_role_of(p_team) is distinct from 'owner' then raise exception 'Only the owner can delete the team.'; end if;
  delete from teams where id = p_team;
end $$;

-- Saves new script content only if nobody saved since base_version.
create or replace function public.save_script(p_id uuid, p_content text, p_base_version integer, p_message text default '')
returns public.scripts language plpgsql security definer set search_path = public as $$
declare s scripts;
begin
  select * into s from scripts where id = p_id for update;
  if s.id is null or not public.can_view_script(s) then raise exception 'Script not found.'; end if;
  if not public.has_perm(s.team_id, 'manage_scripts') then raise exception 'You do not have permission to edit scripts.'; end if;
  if s.version <> p_base_version then
    raise exception using errcode = 'P0409', message = 'conflict', detail = json_build_object('version', s.version, 'updated_by', s.updated_by)::text;
  end if;
  perform set_config('corel.via_save', 'on', true);
  update scripts set content = p_content, version = s.version + 1, updated_by = auth.uid() where id = p_id returning * into s;
  perform set_config('corel.via_save', 'off', true);
  insert into script_versions (script_id, team_id, version, content, message, edited_by)
  values (s.id, s.team_id, s.version, p_content, coalesce(p_message, ''), auth.uid());
  perform log_activity(s.team_id, null, 'edited', 'script', s.id::text, 'edited script ' || s.name, jsonb_build_object('version', s.version));
  if s.created_by is not null then
    perform notify_user(s.created_by, s.team_id, 'script_edit', public.display_name_of(auth.uid()) || ' edited ' || s.name, 'Version ' || s.version, jsonb_build_object('type', 'script', 'id', s.id));
  end if;
  return s;
end $$;

-- Public experience numbers captured by any member's desktop app, at most one row per 15 minutes.
create or replace function public.record_snapshots(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0; b bigint := floor(extract(epoch from now()) / 900);
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    if public.can_view_project((r ->> 'project_id')::uuid) then
      insert into analytics_snapshots (team_id, project_id, bucket, visits, playing, favorites, up_votes, down_votes)
      values ('00000000-0000-0000-0000-000000000000', (r ->> 'project_id')::uuid, b,
        (r ->> 'visits')::bigint, (r ->> 'playing')::bigint, (r ->> 'favorites')::bigint, (r ->> 'up_votes')::bigint, (r ->> 'down_votes')::bigint)
      on conflict (project_id, bucket) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if exists (
    select 1 from team_members m where m.user_id = auth.uid() and m.role = 'owner'
      and exists (select 1 from team_members o where o.team_id = m.team_id and o.user_id <> auth.uid())
  ) then
    raise exception 'You own a team with other members. Transfer ownership or delete that team first.';
  end if;
  delete from teams t where exists (select 1 from team_members m where m.team_id = t.id and m.user_id = auth.uid() and m.role = 'owner');
  delete from auth.users where id = auth.uid();
end $$;

-- ------------------------------------------------------------------ row level security

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.bugs enable row level security;
alter table public.bug_attachments enable row level security;
alter table public.comments enable row level security;
alter table public.script_folders enable row level security;
alter table public.scripts enable row level security;
alter table public.script_versions enable row level security;
alter table public.script_favorites enable row level security;
alter table public.publish_updates enable row level security;
alter table public.analytics_snapshots enable row level security;
alter table public.analytics_metrics enable row level security;
alter table public.activity enable row level security;
alter table public.notifications enable row level security;

create policy "profiles: read teammates" on public.profiles for select to authenticated using (public.shares_team(id));
create policy "profiles: update self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "teams: members read" on public.teams for select to authenticated using (public.is_member(id));
create policy "teams: admins update" on public.teams for update to authenticated using (public.has_perm(id, 'manage_members')) with check (public.has_perm(id, 'manage_members'));

create policy "members: read" on public.team_members for select to authenticated using (public.is_member(team_id));

create policy "invites: managers and invitee read" on public.team_invites for select to authenticated
  using (public.has_perm(team_id, 'manage_members') or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "invites: managers create" on public.team_invites for insert to authenticated
  with check (public.has_perm(team_id, 'manage_members') and invited_by = auth.uid() and status = 'pending' and uses = 0
    and (role <> 'admin' or public.team_role_of(team_id) = 'owner'));
create policy "invites: managers revoke" on public.team_invites for update to authenticated
  using (public.has_perm(team_id, 'manage_members')) with check (public.has_perm(team_id, 'manage_members'));
create policy "invites: managers delete" on public.team_invites for delete to authenticated using (public.has_perm(team_id, 'manage_members'));

-- Inline (not can_view_project) so INSERT ... RETURNING can see the new row.
create policy "projects: read" on public.projects for select to authenticated using (
  public.is_member(team_id) and (
    visibility = 'team' or created_by = auth.uid() or public.team_role_of(team_id) in ('owner', 'admin')
    or public.is_project_member(id)
  )
);
create policy "projects: create" on public.projects for insert to authenticated with check (public.has_perm(team_id, 'manage_projects'));
create policy "projects: edit" on public.projects for update to authenticated
  using (public.project_perm(id, 'edit_content') or public.has_perm(team_id, 'manage_projects'))
  with check (public.is_member(team_id));
create policy "projects: delete" on public.projects for delete to authenticated using (public.has_perm(team_id, 'manage_projects'));

create policy "project members: read" on public.project_members for select to authenticated using (public.can_view_project(project_id));
create policy "project members: manage" on public.project_members for all to authenticated
  using (public.has_perm(public.project_team(project_id), 'manage_projects'))
  with check (public.has_perm(public.project_team(project_id), 'manage_projects')
    and exists (select 1 from public.team_members m where m.team_id = public.project_team(project_id) and m.user_id = project_members.user_id));

create policy "tasks: read" on public.tasks for select to authenticated using (public.can_view_project(project_id));
create policy "tasks: create" on public.tasks for insert to authenticated with check (public.project_perm(project_id, 'edit_content'));
create policy "tasks: edit" on public.tasks for update to authenticated using (public.project_perm(project_id, 'edit_content')) with check (public.project_perm(project_id, 'edit_content'));
create policy "tasks: delete" on public.tasks for delete to authenticated using (public.project_perm(project_id, 'edit_content'));

create policy "bugs: read" on public.bugs for select to authenticated using (public.can_view_project(project_id));
create policy "bugs: create" on public.bugs for insert to authenticated with check (public.project_perm(project_id, 'edit_content'));
create policy "bugs: edit" on public.bugs for update to authenticated using (public.project_perm(project_id, 'edit_content')) with check (public.project_perm(project_id, 'edit_content'));
create policy "bugs: delete" on public.bugs for delete to authenticated
  using (public.has_perm(team_id, 'manage_projects') or (reporter_id = auth.uid() and public.project_perm(project_id, 'edit_content')));

create policy "attachments: read" on public.bug_attachments for select to authenticated
  using (exists (select 1 from public.bugs b where b.id = bug_id and public.can_view_project(b.project_id)));
create policy "attachments: add" on public.bug_attachments for insert to authenticated
  with check (exists (select 1 from public.bugs b where b.id = bug_id and public.project_perm(b.project_id, 'edit_content')));
create policy "attachments: delete" on public.bug_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.has_perm(team_id, 'manage_projects'));

create policy "comments: read" on public.comments for select to authenticated using (public.can_view_project(project_id));
create policy "comments: add" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.project_perm(project_id, 'comment'));
create policy "comments: edit own" on public.comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "comments: delete" on public.comments for delete to authenticated using (author_id = auth.uid() or public.has_perm(team_id, 'manage_projects'));

create policy "folders: read" on public.script_folders for select to authenticated using (public.is_member(team_id));
create policy "folders: manage" on public.script_folders for all to authenticated
  using (public.has_perm(team_id, 'manage_scripts')) with check (public.has_perm(team_id, 'manage_scripts'));

create policy "scripts: read" on public.scripts for select to authenticated using (public.can_view_script(scripts));
create policy "scripts: create" on public.scripts for insert to authenticated
  with check (public.has_perm(team_id, 'manage_scripts') and created_by = auth.uid() and version = 1);
create policy "scripts: edit" on public.scripts for update to authenticated
  using (public.can_view_script(scripts) and public.has_perm(team_id, 'manage_scripts'))
  with check (public.has_perm(team_id, 'manage_scripts'));
create policy "scripts: delete" on public.scripts for delete to authenticated
  using (created_by = auth.uid() or public.team_role_of(team_id) in ('owner', 'admin'));

create policy "script versions: read" on public.script_versions for select to authenticated
  using (exists (select 1 from public.scripts s where s.id = script_id and public.can_view_script(s)));

create policy "favorites: own" on public.script_favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "publish: read" on public.publish_updates for select to authenticated using (public.can_view_project(project_id));
create policy "publish: write" on public.publish_updates for insert to authenticated with check (public.project_perm(project_id, 'manage_publish'));
create policy "publish: update" on public.publish_updates for update to authenticated
  using (public.project_perm(project_id, 'manage_publish')) with check (public.project_perm(project_id, 'manage_publish'));

create policy "snapshots: read" on public.analytics_snapshots for select to authenticated using (public.project_perm(project_id, 'view_analytics'));

create policy "metrics: read" on public.analytics_metrics for select to authenticated using (public.project_perm(project_id, 'view_analytics'));
create policy "metrics: import" on public.analytics_metrics for insert to authenticated with check (public.project_perm(project_id, 'edit_content'));
create policy "metrics: update" on public.analytics_metrics for update to authenticated using (public.project_perm(project_id, 'edit_content')) with check (public.project_perm(project_id, 'edit_content'));
create policy "metrics: delete" on public.analytics_metrics for delete to authenticated using (public.project_perm(project_id, 'edit_content'));

create policy "activity: read" on public.activity for select to authenticated
  using (public.is_member(team_id) and (project_id is null or public.can_view_project(project_id)));

create policy "notifications: own read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications: own update" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: own delete" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------ realtime

alter table public.notifications replica identity full;
alter publication supabase_realtime add table
  public.team_members, public.team_invites, public.projects, public.project_members, public.tasks, public.bugs,
  public.bug_attachments, public.comments, public.script_folders, public.scripts, public.publish_updates,
  public.analytics_snapshots, public.activity, public.notifications, public.profiles, public.teams;

-- Presence and broadcast channels are private and named "team:<team id>" or
-- "team:<team id>:<anything>". Only members of that team may join them.
create policy "realtime: team channels read" on realtime.messages for select to authenticated
  using (realtime.topic() like 'team:%' and public.is_member(nullif(split_part(realtime.topic(), ':', 2), '')::uuid));
create policy "realtime: team channels write" on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'team:%' and public.is_member(nullif(split_part(realtime.topic(), ':', 2), '')::uuid));

-- ------------------------------------------------------------------ storage

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400), ('avatars', 'avatars', true, 2097152), ('thumbnails', 'thumbnails', true, 5242880)
on conflict (id) do nothing;

-- attachments/<team id>/<bug id>/<file>
create policy "attachments: members read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "attachments: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.has_perm(((storage.foldername(name))[1])::uuid, 'edit_content'));
create policy "attachments: uploader delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (owner = auth.uid() or public.has_perm(((storage.foldername(name))[1])::uuid, 'manage_projects')));

-- avatars/<user id>/<file>
create policy "avatars: own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: own update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- thumbnails/<team id>/<file>
create policy "thumbnails: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'thumbnails' and public.has_perm(((storage.foldername(name))[1])::uuid, 'edit_content'));
create policy "thumbnails: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'thumbnails' and public.has_perm(((storage.foldername(name))[1])::uuid, 'edit_content'));

-- ------------------------------------------------------------------ grants

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.create_team(text, text), public.get_invite(text), public.accept_invite(text), public.decline_invite(uuid),
  public.set_member_role(uuid, uuid, public.team_role), public.set_member_permissions(uuid, uuid, jsonb), public.remove_member(uuid, uuid),
  public.delete_team(uuid), public.save_script(uuid, text, integer, text), public.record_snapshots(jsonb), public.delete_my_account()
  to authenticated;
