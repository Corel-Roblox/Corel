-- Team profile pictures. Images are uploaded to the public "thumbnails" bucket under
-- thumbnails/<team id>/..., which only members with edit permissions can write to.
alter table public.teams add column if not exists avatar_url text;

-- Invite previews show the team picture too.
create or replace function public.get_invite(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'team_id', i.team_id, 'team_name', t.name, 'team_color', t.color, 'team_avatar', t.avatar_url, 'role', i.role,
    'email', i.email, 'status', i.status, 'expired', i.expires_at < now(), 'invited_by', public.display_name_of(i.invited_by),
    'already_member', public.is_member(i.team_id))
  from team_invites i join teams t on t.id = i.team_id where i.token = p_token
$$;
