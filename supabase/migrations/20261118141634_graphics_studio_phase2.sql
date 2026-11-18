-- NWTT Graphics Studio, Phase 2: shared storage, roles, broadcast sessions and live OBS output.
-- Target: a Supabase project dedicated to Graphics Studio (NOT Sentinel's operational project).
-- Every table has RLS. Live-control actions are only possible through the SECURITY DEFINER functions
-- below, which check the caller's role, session control and an expected version number.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- types
create type public.gs_role as enum ('admin', 'producer', 'editor', 'broadcaster', 'viewer');
create type public.gs_approval as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.gs_session_status as enum ('draft', 'ready', 'live', 'interrupted', 'ended', 'archived');

-- ---------------------------------------------------------------- organisation
create table public.org_settings (
  id int primary key default 1 check (id = 1),
  org_name text not null default 'NWTT' check (char_length(org_name) between 1 and 120),
  settings jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 65536),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.org_settings (id) values (1);

create table public.org_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text check (char_length(display_name) <= 120),
  role public.gs_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Role of the signed-in user (null when not an active member). SECURITY DEFINER so policies can call it
-- without recursive RLS on org_members.
create function public.gs_role() returns public.gs_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.org_members where user_id = auth.uid() and active
$$;
create function public.gs_has_role(variadic roles public.gs_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.gs_role() = any (roles), false)
$$;
create function public.gs_is_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.gs_role() is not null
$$;

-- ---------------------------------------------------------------- audit + rate limiting
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  session_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index audit_log_session_idx on public.audit_log (session_id, at desc);

create function public.gs_audit(p_action text, p_session uuid, p_detail jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (actor_id, actor_email, session_id, action, detail)
  values (auth.uid(), (select email from public.org_members where user_id = auth.uid()), p_session, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

create table public.rate_limits (
  key text not null,
  bucket text not null,
  window_start timestamptz not null,
  count int not null,
  primary key (key, bucket)
);
-- Fixed-window limiter. Raises 'rate_limited' when exceeded.
create function public.gs_rate_limit(p_key text, p_bucket text, p_max int, p_window_s int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s); c int;
begin
  insert into public.rate_limits as r (key, bucket, window_start, count) values (p_key, p_bucket, w, 1)
  on conflict (key, bucket) do update set count = case when r.window_start = w then r.count + 1 else 1 end, window_start = w
  returning count into c;
  if c > p_max then raise exception 'rate_limited' using errcode = 'P0001', hint = 'Too many requests; wait a moment and retry.'; end if;
end $$;

-- ---------------------------------------------------------------- shared projects, revisions, templates, assets
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  category text not null default 'general' check (char_length(category) <= 40),
  data jsonb not null check (pg_column_size(data) < 6000000),
  thumb text check (char_length(thumb) < 300000),
  owner_id uuid not null default auth.uid() references auth.users (id),
  team_can_edit boolean not null default true,
  approval public.gs_approval not null default 'draft',
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  save_kind text not null default 'auto' check (save_kind in ('auto', 'manual', 'import')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  deleted_at timestamptz
);
create index projects_updated_idx on public.projects (updated_at desc);

create table public.project_revisions (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null,
  name text not null,
  data jsonb not null,
  save_kind text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index project_revisions_idx on public.project_revisions (project_id, version desc);

-- Version bump, ownership/approval rules and revision history for every project write.
create function public.gs_projects_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.gs_role := public.gs_role();
begin
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid(); new.updated_by := auth.uid(); new.version := 1;
    if new.approval in ('approved', 'rejected') and r not in ('admin', 'producer') then new.approval := 'draft'; end if;
  else
    if new.owner_id is distinct from old.owner_id and r <> 'admin' then raise exception 'Only an administrator can change a project''s owner.'; end if;
    if new.approval is distinct from old.approval then
      if new.approval in ('approved', 'rejected') and r not in ('admin', 'producer') then
        raise exception 'Only a producer or administrator can approve graphics for broadcast.';
      end if;
      if new.approval = 'approved' then new.approved_by := auth.uid(); new.approved_at := now(); end if;
    elsif new.data is distinct from old.data and old.approval = 'approved' then
      new.approval := 'draft'; new.approved_by := null; new.approved_at := null;   -- edited after approval: needs approval again
    end if;
    new.version := old.version + 1; new.updated_at := now(); new.updated_by := auth.uid();
  end if;
  return new;
end $$;
create trigger projects_write before insert or update on public.projects for each row execute function public.gs_projects_write();

create function public.gs_projects_revision() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare last_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.name = old.name then return null; end if;
  select max(created_at) into last_at from public.project_revisions where project_id = new.id;
  -- Every manual save or import, and at most one autosave revision per 10 minutes.
  if new.save_kind <> 'auto' or last_at is null or last_at < now() - interval '10 minutes' then
    insert into public.project_revisions (project_id, version, name, data, save_kind, created_by)
    values (new.id, new.version, new.name, new.data, new.save_kind, auth.uid());
    delete from public.project_revisions where project_id = new.id and id not in
      (select id from public.project_revisions where project_id = new.id order by id desc limit 100);
  end if;
  return null;
end $$;
create trigger projects_revision after insert or update on public.projects for each row execute function public.gs_projects_revision();

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  category text not null default 'general' check (char_length(category) <= 40),
  collection text check (char_length(collection) <= 80),
  w int not null check (w between 64 and 8192),
  h int not null check (h between 64 and 8192),
  data jsonb not null check (pg_column_size(data) < 6000000),
  thumb text check (char_length(thumb) < 300000),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  collection text check (char_length(collection) <= 80),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  w int check (w between 1 and 8192),
  h int check (h between 1 and 8192),
  bytes int not null check (bytes between 1 and 20000000),
  storage_path text not null unique,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- broadcast sessions
create table public.broadcast_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  incident_name text check (char_length(incident_name) <= 200),
  incident_ref jsonb check (pg_column_size(incident_ref) < 8192),
  broadcast_type text not null default 'general' check (broadcast_type in ('general', 'wildfire', 'severe', 'tropical', 'evacuation', 'breaking', 'briefing')),
  status public.gs_session_status not null default 'draft',
  created_by uuid not null references auth.users (id),
  producer_id uuid references auth.users (id),
  broadcaster_id uuid references auth.users (id),
  controller_id uuid references auth.users (id),
  started_at timestamptz,
  ended_at timestamptz,
  preview_revision_id bigint,
  live_revision_id bigint,
  live_seq bigint not null default 0,
  live_changed_at timestamptz,
  live_changed_by uuid,
  version int not null default 0,
  channel_key text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_members (
  session_id uuid not null references public.broadcast_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_role text not null check (session_role in ('producer', 'editor', 'broadcaster', 'viewer')),
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Can the signed-in user see this session? Admins and producers see all; others only sessions they are assigned to.
create function public.gs_session_visible(p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.gs_has_role('admin', 'producer') or exists (
    select 1 from public.broadcast_sessions s where s.id = p_session and public.gs_is_member()
      and (auth.uid() in (s.created_by, s.producer_id, s.broadcaster_id, s.controller_id)
           or exists (select 1 from public.session_members m where m.session_id = s.id and m.user_id = auth.uid())))
$$;

-- A rendered graphic offered to a session (the "Preview" state). The PNG is the exact file that airs.
create table public.broadcast_revisions (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.broadcast_sessions (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  project_version int,
  name text not null check (char_length(name) between 1 and 200),
  category text check (char_length(category) <= 40),
  overlay boolean not null,
  w int not null check (w = 1920),
  h int not null check (h = 1080),
  transition text not null default 'fade' check (transition in ('fade', 'cut')),
  expires_at timestamptz,
  stale_after_s int check (stale_after_s between 30 and 86400),
  source text check (char_length(source) <= 300),
  source_time timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz
);
create index broadcast_revisions_session_idx on public.broadcast_revisions (session_id, id desc);

create table public.render_images (
  revision_id bigint primary key references public.broadcast_revisions (id) on delete cascade,
  png bytea not null check (octet_length(png) between 100 and 8000000),
  sha256 text not null
);

-- Every change to what is on air, in order (seq = the session's live_seq after the change).
create table public.live_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.broadcast_sessions (id) on delete cascade,
  seq bigint not null,
  action text not null check (action in ('take', 'update', 'clear', 'rollback', 'expire', 'end')),
  revision_id bigint references public.broadcast_revisions (id) on delete set null,
  actor_id uuid,
  at timestamptz not null default now(),
  unique (session_id, seq)
);

-- OBS output credentials: only the SHA-256 of the token is stored. Read-only access to the live graphic.
create table public.output_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.broadcast_sessions (id) on delete cascade,
  token_hash text not null unique,
  label text not null check (char_length(label) between 1 and 80),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  last_seen_at timestamptz,
  last_rendered_seq bigint,
  last_status text check (char_length(last_status) <= 80),
  user_agent text check (char_length(user_agent) <= 300)
);

-- ---------------------------------------------------------------- RLS
alter table public.org_settings enable row level security;
alter table public.org_members enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;
alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;
alter table public.templates enable row level security;
alter table public.assets enable row level security;
alter table public.broadcast_sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.broadcast_revisions enable row level security;
alter table public.render_images enable row level security;
alter table public.live_events enable row level security;
alter table public.output_tokens enable row level security;

-- Nothing is readable or writable by anonymous users. The OBS output uses bc_output_state()/bc_output_image() only.

create policy org_settings_read on public.org_settings for select to authenticated using (public.gs_is_member());
create policy org_settings_admin on public.org_settings for update to authenticated using (public.gs_has_role('admin')) with check (public.gs_has_role('admin'));

create policy org_members_read on public.org_members for select to authenticated using (public.gs_is_member() or user_id = auth.uid());
-- writes only through gs_set_member()

create policy audit_read on public.audit_log for select to authenticated
  using (public.gs_has_role('admin', 'producer') or (session_id is not null and public.gs_session_visible(session_id)));

create policy projects_read on public.projects for select to authenticated using (public.gs_is_member());
create policy projects_insert on public.projects for insert to authenticated
  with check (public.gs_has_role('admin', 'producer', 'editor') and owner_id = auth.uid());
create policy projects_update on public.projects for update to authenticated
  using (public.gs_has_role('admin') or (public.gs_has_role('producer', 'editor') and (owner_id = auth.uid() or team_can_edit)))
  with check (public.gs_has_role('admin') or (public.gs_has_role('producer', 'editor') and (owner_id = auth.uid() or team_can_edit)));
create policy projects_delete on public.projects for delete to authenticated using (public.gs_has_role('admin') or (owner_id = auth.uid() and public.gs_has_role('producer', 'editor')));

create policy revisions_read on public.project_revisions for select to authenticated using (public.gs_is_member());

create policy templates_read on public.templates for select to authenticated using (public.gs_is_member());
create policy templates_insert on public.templates for insert to authenticated with check (public.gs_has_role('admin', 'producer', 'editor') and created_by = auth.uid());
create policy templates_update on public.templates for update to authenticated
  using (public.gs_has_role('admin') or (created_by = auth.uid() and public.gs_has_role('producer', 'editor'))) with check (public.gs_has_role('admin') or created_by = auth.uid());
create policy templates_delete on public.templates for delete to authenticated using (public.gs_has_role('admin') or (created_by = auth.uid() and public.gs_has_role('producer', 'editor')));

create policy assets_read on public.assets for select to authenticated using (public.gs_is_member());
create policy assets_insert on public.assets for insert to authenticated
  with check (public.gs_has_role('admin', 'producer', 'editor') and created_by = auth.uid() and storage_path like auth.uid()::text || '/%');
create policy assets_delete on public.assets for delete to authenticated using (public.gs_has_role('admin') or created_by = auth.uid());

create policy sessions_read on public.broadcast_sessions for select to authenticated using (public.gs_session_visible(id));
create policy session_members_read on public.session_members for select to authenticated using (public.gs_session_visible(session_id));
create policy revisions_bc_read on public.broadcast_revisions for select to authenticated using (public.gs_session_visible(session_id));
create policy render_read on public.render_images for select to authenticated
  using (exists (select 1 from public.broadcast_revisions r where r.id = revision_id and public.gs_session_visible(r.session_id)));
create policy live_events_read on public.live_events for select to authenticated using (public.gs_session_visible(session_id));
create policy output_tokens_read on public.output_tokens for select to authenticated
  using (public.gs_session_visible(session_id) and public.gs_has_role('admin', 'producer', 'broadcaster'));

-- Supabase's default privileges grant everything to anon/authenticated; start from nothing and grant what RLS expects.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.projects, public.templates to authenticated;
grant select, insert, delete on public.assets to authenticated;
grant select on public.org_settings, public.org_members, public.audit_log, public.project_revisions, public.broadcast_sessions,
  public.session_members, public.broadcast_revisions, public.render_images, public.live_events, public.output_tokens to authenticated;
grant update on public.org_settings to authenticated;
revoke all on public.rate_limits from authenticated;

-- ---------------------------------------------------------------- storage: shared assets bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('graphics-assets', 'graphics-assets', false, 20000000, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;
create policy "graphics assets read" on storage.objects for select to authenticated
  using (bucket_id = 'graphics-assets' and public.gs_is_member());
create policy "graphics assets upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'graphics-assets' and public.gs_has_role('admin', 'producer', 'editor') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "graphics assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'graphics-assets' and (public.gs_has_role('admin') or (storage.foldername(name))[1] = auth.uid()::text));

-- ---------------------------------------------------------------- functions: members
create function public.gs_me() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('user_id', auth.uid(), 'email', coalesce(m.email, (select email from auth.users where id = auth.uid())),
    'role', case when m.active then m.role end, 'display_name', m.display_name, 'active', coalesce(m.active, false))
  from (select 1) x left join public.org_members m on m.user_id = auth.uid()
$$;

create function public.gs_set_member(p_email text, p_role public.gs_role, p_display_name text default null, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; old public.org_members;
begin
  if not public.gs_has_role('admin') then raise exception 'Only an administrator can manage members.' using errcode = '42501'; end if;
  perform public.gs_rate_limit(auth.uid()::text, 'admin', 60, 60);
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account with that email. Invite the person from the Supabase dashboard (Authentication → Users) first.'; end if;
  select * into old from public.org_members where user_id = uid;
  if old.role = 'admin' and (p_role <> 'admin' or not p_active)
     and (select count(*) from public.org_members where role = 'admin' and active) <= 1 then
    raise exception 'Cannot remove the last active administrator.';
  end if;
  insert into public.org_members (user_id, email, role, display_name, active)
  values (uid, lower(trim(p_email)), p_role, nullif(trim(coalesce(p_display_name, '')), ''), p_active)
  on conflict (user_id) do update set role = excluded.role, active = excluded.active,
    display_name = coalesce(excluded.display_name, public.org_members.display_name), updated_at = now();
  perform public.gs_audit('member.set', null, jsonb_build_object('email', lower(trim(p_email)), 'role', p_role, 'active', p_active, 'previous_role', old.role));
  return jsonb_build_object('user_id', uid, 'role', p_role, 'active', p_active);
end $$;

-- Broadcast approval of a shared project (producers/administrators), independent of who may edit it.
create function public.gs_set_approval(p_project uuid, p_approval public.gs_approval, p_note text default null) returns public.projects
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.projects;
begin
  if not public.gs_has_role('admin', 'producer') then raise exception 'Only a producer or administrator can approve graphics for broadcast.' using errcode = '42501'; end if;
  perform public.gs_rate_limit(auth.uid()::text, 'control', 60, 60);
  -- The write trigger checks the role again and stamps approved_by/approved_at. Content and version are untouched apart from the bump.
  update public.projects set approval = p_approval, save_kind = 'auto' where id = p_project and deleted_at is null returning * into p;
  if not found then raise exception 'Project not found.'; end if;
  perform public.gs_audit('project.' || p_approval, null, jsonb_build_object('project', p_project, 'name', p.name, 'version', p.version, 'note', left(p_note, 300)));
  return p;
end $$;

-- ---------------------------------------------------------------- functions: broadcast control
-- Lock a session and check the caller may control it. Returns the locked row.
create function public.bc_lock(p_session uuid, p_expected_version int, p_need_control boolean) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions;
begin
  if not public.gs_is_member() then raise exception 'Not signed in as an NWTT Graphics Studio member.' using errcode = '42501'; end if;
  perform public.gs_rate_limit(auth.uid()::text, 'control', 60, 60);
  select * into s from public.broadcast_sessions where id = p_session for update;
  if not found or not public.gs_session_visible(p_session) then raise exception 'Broadcast session not found.' using errcode = 'P0002'; end if;
  if p_expected_version is not null and s.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001', detail = s.version::text,
      hint = 'Someone else changed this session. The console has been refreshed; check the current state and try again.';
  end if;
  if p_need_control and s.controller_id is distinct from auth.uid() then
    raise exception 'You are not the controller of this session. Ask the current controller to transfer control.' using errcode = '42501';
  end if;
  return s;
end $$;

-- Notify OBS outputs that the live state changed. The message carries only the sequence number; outputs then
-- fetch the state with their token. Never fails the transaction if Realtime is unavailable.
create function public.bc_notify(s public.broadcast_sessions) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform realtime.send(jsonb_build_object('seq', s.live_seq), 'live', 'nwtt-out-' || s.channel_key, false);
  exception when others then null;
  end;
end $$;

create function public.bc_create_session(p_title text, p_type text default 'general', p_incident_name text default null,
  p_incident_ref jsonb default null, p_broadcaster uuid default null) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions;
begin
  if not public.gs_has_role('admin', 'producer') then raise exception 'Only producers and administrators can create broadcast sessions.' using errcode = '42501'; end if;
  perform public.gs_rate_limit(auth.uid()::text, 'control', 60, 60);
  if p_broadcaster is not null and not exists (select 1 from public.org_members where user_id = p_broadcaster and active) then
    raise exception 'The assigned broadcaster is not an active member.';
  end if;
  insert into public.broadcast_sessions (title, broadcast_type, incident_name, incident_ref, created_by, producer_id, controller_id, broadcaster_id, status)
  values (trim(p_title), coalesce(p_type, 'general'), nullif(trim(coalesce(p_incident_name, '')), ''), p_incident_ref, auth.uid(), auth.uid(), auth.uid(), p_broadcaster, 'ready')
  returning * into s;
  insert into public.session_members (session_id, user_id, session_role, added_by) values (s.id, auth.uid(), 'producer', auth.uid());
  if p_broadcaster is not null then
    insert into public.session_members (session_id, user_id, session_role, added_by) values (s.id, p_broadcaster, 'broadcaster', auth.uid()) on conflict do nothing;
  end if;
  perform public.gs_audit('session.create', s.id, jsonb_build_object('title', s.title, 'type', s.broadcast_type, 'incident', s.incident_name));
  return s;
end $$;

create function public.bc_add_member(p_session uuid, p_user uuid, p_role text, p_expected_version int) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions;
begin
  s := public.bc_lock(p_session, p_expected_version, true);
  if not exists (select 1 from public.org_members where user_id = p_user and active) then raise exception 'Not an active member.'; end if;
  if p_role not in ('producer', 'editor', 'broadcaster', 'viewer') then raise exception 'Invalid session role.'; end if;
  insert into public.session_members (session_id, user_id, session_role, added_by) values (p_session, p_user, p_role, auth.uid())
  on conflict (session_id, user_id) do update set session_role = excluded.session_role;
  update public.broadcast_sessions set version = version + 1, updated_at = now(),
    broadcaster_id = case when p_role = 'broadcaster' then p_user else broadcaster_id end where id = p_session returning * into s;
  perform public.gs_audit('session.member', p_session, jsonb_build_object('user', p_user, 'role', p_role));
  return s;
end $$;

-- Explicit control transfer: only the current controller (or an administrator, audited as an override).
create function public.bc_transfer_control(p_session uuid, p_to uuid, p_expected_version int) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; is_override boolean;
begin
  s := public.bc_lock(p_session, p_expected_version, false);
  is_override := s.controller_id is distinct from auth.uid();
  if is_override and not public.gs_has_role('admin') then
    if not (s.controller_id is null and public.gs_has_role('producer') and p_to = auth.uid()) then
      raise exception 'Only the current controller can transfer control (administrators can override).' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.org_members where user_id = p_to and active and role in ('admin', 'producer')) then
    raise exception 'Control can only be given to an active producer or administrator.';
  end if;
  if s.status in ('ended', 'archived') then raise exception 'This session has ended.'; end if;
  update public.broadcast_sessions set controller_id = p_to, version = version + 1, updated_at = now() where id = p_session returning * into s;
  insert into public.session_members (session_id, user_id, session_role, added_by) values (p_session, p_to, 'producer', auth.uid()) on conflict do nothing;
  perform public.gs_audit(case when is_override then 'control.override' else 'control.transfer' end, p_session, jsonb_build_object('to', p_to));
  return s;
end $$;

-- Preview: store a rendered 1920x1080 PNG for review. Never changes what is on air.
create function public.bc_create_preview(p_session uuid, p_name text, p_png_base64 text, p_overlay boolean,
  p_project uuid default null, p_project_version int default null, p_category text default null,
  p_transition text default 'fade', p_expires_at timestamptz default null, p_stale_after_s int default null,
  p_source text default null, p_source_time timestamptz default null) returns public.broadcast_revisions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; r public.broadcast_revisions; png bytea; pw int; ph int; p public.projects;
begin
  s := public.bc_lock(p_session, null, false);
  if s.status in ('ended', 'archived') then raise exception 'This session has ended; previews are closed.'; end if;
  if not (public.gs_has_role('admin', 'producer') or (public.gs_has_role('editor')
          and exists (select 1 from public.session_members m where m.session_id = p_session and m.user_id = auth.uid() and m.session_role in ('editor', 'producer')))) then
    raise exception 'You are not allowed to send graphics to this session''s preview.' using errcode = '42501';
  end if;
  if p_project is null and not public.gs_has_role('admin', 'producer') then
    raise exception 'Graphics editors can only preview approved shared projects.' using errcode = '42501';
  end if;
  if p_project is not null then
    select * into p from public.projects where id = p_project;
    if not found then raise exception 'Project not found.'; end if;
    if not public.gs_has_role('admin', 'producer') and p.approval <> 'approved' then
      raise exception 'Graphics editors can only preview approved graphics. Submit it for approval first.' using errcode = '42501';
    end if;
  end if;
  if p_transition not in ('fade', 'cut') then raise exception 'Invalid transition.'; end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '24 hours') then
    raise exception 'Expiry must be in the future and within 24 hours.';
  end if;
  begin png := decode(p_png_base64, 'base64'); exception when others then raise exception 'Image is not valid base64.'; end;
  if octet_length(png) > 8000000 then raise exception 'Rendered graphic is larger than 8 MB.'; end if;
  if substring(png from 1 for 8) <> '\x89504e470d0a1a0a'::bytea then raise exception 'Rendered graphic must be a PNG.'; end if;
  pw := (get_byte(png, 16) << 24) | (get_byte(png, 17) << 16) | (get_byte(png, 18) << 8) | get_byte(png, 19);
  ph := (get_byte(png, 20) << 24) | (get_byte(png, 21) << 16) | (get_byte(png, 22) << 8) | get_byte(png, 23);
  if pw <> 1920 or ph <> 1080 then raise exception 'Live graphics must be exactly 1920×1080 (got %×%).', pw, ph; end if;
  insert into public.broadcast_revisions (session_id, project_id, project_version, name, category, overlay, w, h, transition, expires_at, stale_after_s, source, source_time, created_by)
  values (p_session, p_project, p_project_version, left(trim(p_name), 200), p_category, p_overlay, pw, ph, p_transition, p_expires_at, p_stale_after_s,
          nullif(left(trim(coalesce(p_source, '')), 300), ''), p_source_time, auth.uid())
  returning * into r;
  insert into public.render_images (revision_id, png, sha256) values (r.id, png, encode(extensions.digest(png, 'sha256'), 'hex'));
  update public.broadcast_sessions set preview_revision_id = r.id, updated_at = now(), version = version + 1 where id = p_session;
  perform public.gs_audit('graphic.preview', p_session, jsonb_build_object('revision', r.id, 'name', r.name, 'project', p_project, 'expires_at', p_expires_at));
  return r;
end $$;

-- Take Live / Update Live / Rollback: the authoritative published revision. Controller only, version-checked.
create function public.bc_publish(p_session uuid, p_revision bigint, p_mode text, p_expected_version int) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; r public.broadcast_revisions;
begin
  s := public.bc_lock(p_session, p_expected_version, true);
  if p_mode not in ('take', 'update', 'rollback') then raise exception 'Invalid publish mode.'; end if;
  if s.status in ('ended', 'archived') then raise exception 'This session has ended. Nothing can be published to it.'; end if;
  select * into r from public.broadcast_revisions where id = p_revision and session_id = p_session;
  if not found then raise exception 'That graphic is not part of this session.'; end if;
  if r.expires_at is not null and r.expires_at <= now() then raise exception 'That graphic has expired and cannot be published.'; end if;
  if p_mode = 'take' and s.live_revision_id is not null then raise exception 'A graphic is already live. Use Update Live to replace it.'; end if;
  if p_mode = 'update' and s.live_revision_id is null then raise exception 'Nothing is live. Use Take Live.'; end if;
  if p_mode = 'rollback' and not exists (select 1 from public.live_events e where e.session_id = p_session and e.revision_id = p_revision) then
    raise exception 'You can only roll back to a graphic that was previously live in this session.';
  end if;
  update public.broadcast_sessions set live_revision_id = r.id, live_seq = live_seq + 1, version = version + 1,
    live_changed_at = now(), live_changed_by = auth.uid(), updated_at = now(),
    status = case when status in ('draft', 'ready', 'interrupted') then 'live'::public.gs_session_status else status end,
    started_at = coalesce(started_at, now())
  where id = p_session returning * into s;
  update public.broadcast_revisions set approved_by = coalesce(approved_by, auth.uid()), approved_at = coalesce(approved_at, now()) where id = r.id;
  insert into public.live_events (session_id, seq, action, revision_id, actor_id) values (p_session, s.live_seq, p_mode, r.id, auth.uid());
  perform public.gs_audit('live.' || p_mode, p_session, jsonb_build_object('revision', r.id, 'name', r.name, 'seq', s.live_seq));
  perform public.bc_notify(s);
  return s;
end $$;

create function public.bc_clear(p_session uuid, p_expected_version int) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; prev bigint;
begin
  s := public.bc_lock(p_session, p_expected_version, true);
  prev := s.live_revision_id;
  update public.broadcast_sessions set live_revision_id = null, live_seq = live_seq + 1, version = version + 1,
    live_changed_at = now(), live_changed_by = auth.uid(), updated_at = now() where id = p_session returning * into s;
  insert into public.live_events (session_id, seq, action, revision_id, actor_id) values (p_session, s.live_seq, 'clear', null, auth.uid());
  perform public.gs_audit('live.clear', p_session, jsonb_build_object('previous_revision', prev, 'seq', s.live_seq));
  perform public.bc_notify(s);
  return s;
end $$;

-- Session lifecycle. Ending clears the output, revokes every output token and blocks further publishing.
create function public.bc_set_status(p_session uuid, p_status public.gs_session_status, p_expected_version int) returns public.broadcast_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; ok boolean;
begin
  s := public.bc_lock(p_session, p_expected_version, not public.gs_has_role('admin'));
  ok := case s.status
    when 'draft' then p_status in ('ready', 'ended')
    when 'ready' then p_status in ('draft', 'ended')
    when 'live' then p_status in ('interrupted', 'ended')
    when 'interrupted' then p_status in ('live', 'ended')
    when 'ended' then p_status = 'archived'
    else false end;
  if not ok then raise exception 'Cannot change a % session to %.', s.status, p_status; end if;
  if p_status = 'ended' then
    update public.broadcast_sessions set status = 'ended', ended_at = now(), live_revision_id = null, preview_revision_id = null,
      live_seq = live_seq + 1, version = version + 1, updated_at = now(), live_changed_at = now(), live_changed_by = auth.uid()
    where id = p_session returning * into s;
    insert into public.live_events (session_id, seq, action, revision_id, actor_id) values (p_session, s.live_seq, 'end', null, auth.uid());
    update public.output_tokens set revoked_at = now(), revoked_by = auth.uid() where session_id = p_session and revoked_at is null;
    perform public.bc_notify(s);
  else
    update public.broadcast_sessions set status = p_status, version = version + 1, updated_at = now() where id = p_session returning * into s;
  end if;
  perform public.gs_audit('session.' || p_status, p_session, '{}'::jsonb);
  return s;
end $$;

-- ---------------------------------------------------------------- functions: OBS output credentials
create function public.bc_issue_output_token(p_session uuid, p_label text, p_ttl_hours int default 12) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; raw text; t public.output_tokens;
begin
  s := public.bc_lock(p_session, null, false);
  if not (s.controller_id = auth.uid() or public.gs_has_role('admin')
          or (public.gs_has_role('producer', 'broadcaster') and auth.uid() in (s.producer_id, s.broadcaster_id))
          or exists (select 1 from public.session_members m where m.session_id = p_session and m.user_id = auth.uid() and m.session_role in ('producer', 'broadcaster'))) then
    raise exception 'Only the session''s producer, controller or assigned broadcaster can create OBS outputs.' using errcode = '42501';
  end if;
  if s.status in ('ended', 'archived') then raise exception 'This session has ended.'; end if;
  if p_ttl_hours not between 1 and 72 then raise exception 'Output access must last between 1 and 72 hours.'; end if;
  if (select count(*) from public.output_tokens where session_id = p_session and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'This session already has 10 active OBS outputs. Revoke one first.';
  end if;
  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.output_tokens (session_id, token_hash, label, created_by, expires_at)
  values (p_session, encode(extensions.digest(raw, 'sha256'), 'hex'), left(trim(coalesce(nullif(trim(p_label), ''), 'OBS output')), 80), auth.uid(), now() + make_interval(hours => p_ttl_hours))
  returning * into t;
  perform public.gs_audit('output.issue', p_session, jsonb_build_object('output', t.id, 'label', t.label, 'expires_at', t.expires_at));
  return jsonb_build_object('id', t.id, 'token', raw, 'expires_at', t.expires_at, 'label', t.label);
end $$;

create function public.bc_output_token_admin(p_token_id uuid, p_action text, p_hours int default 12) returns public.output_tokens
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.output_tokens; s public.broadcast_sessions;
begin
  select * into t from public.output_tokens where id = p_token_id;
  if not found then raise exception 'Output not found.'; end if;
  s := public.bc_lock(t.session_id, null, false);
  if not (s.controller_id = auth.uid() or public.gs_has_role('admin') or t.created_by = auth.uid() or auth.uid() = s.producer_id) then
    raise exception 'You cannot change this OBS output.' using errcode = '42501';
  end if;
  if p_action = 'revoke' then
    update public.output_tokens set revoked_at = now(), revoked_by = auth.uid() where id = p_token_id returning * into t;
  elsif p_action = 'extend' then
    if t.revoked_at is not null then raise exception 'A revoked output cannot be renewed. Create a new one.'; end if;
    if s.status in ('ended', 'archived') then raise exception 'This session has ended.'; end if;
    if p_hours not between 1 and 72 then raise exception 'Renew for 1 to 72 hours.'; end if;
    update public.output_tokens set expires_at = now() + make_interval(hours => p_hours) where id = p_token_id returning * into t;
  else raise exception 'Unknown action.'; end if;
  perform public.gs_audit('output.' || p_action, t.session_id, jsonb_build_object('output', t.id, 'label', t.label, 'expires_at', t.expires_at));
  return t;
end $$;

-- The only things an OBS output can call. Read-only with respect to broadcast state: it can record its own
-- heartbeat (last seen, last rendered sequence) but cannot change sessions, revisions or other tokens.
create function public.bc_output_state(p_token text, p_rendered_seq bigint default null, p_status text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.output_tokens; s public.broadcast_sessions; r public.broadcast_revisions; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.gs_rate_limit(h, 'output', 240, 60);
  select * into t from public.output_tokens where token_hash = h;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if t.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into s from public.broadcast_sessions where id = t.session_id;
  if s.status in ('ended', 'archived') then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  update public.output_tokens set last_seen_at = now(),
    last_rendered_seq = coalesce(p_rendered_seq, last_rendered_seq),
    last_status = coalesce(left(p_status, 80), last_status),
    user_agent = coalesce(left(p_user_agent, 300), user_agent)
  where id = t.id;
  if s.live_revision_id is not null then select * into r from public.broadcast_revisions where id = s.live_revision_id; end if;
  return jsonb_build_object('ok', true, 'server_now', now(), 'seq', s.live_seq, 'channel', 'nwtt-out-' || s.channel_key,
    'token_expires_at', t.expires_at,
    'live', case when r.id is null or (r.expires_at is not null and r.expires_at <= now()) then null else jsonb_build_object(
      'revision', r.id, 'overlay', r.overlay, 'transition', r.transition, 'expires_at', r.expires_at, 'stale_after_s', r.stale_after_s) end,
    'expired', r.id is not null and r.expires_at is not null and r.expires_at <= now());
end $$;

-- Image bytes of the CURRENT live revision only (no previews, no history).
create function public.bc_output_image(p_token text, p_revision bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.output_tokens; s public.broadcast_sessions; img bytea; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'invalid output token' using errcode = '42501'; end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.gs_rate_limit(h, 'output-image', 60, 60);
  select * into t from public.output_tokens where token_hash = h and revoked_at is null and expires_at > now();
  if not found then raise exception 'invalid output token' using errcode = '42501'; end if;
  select * into s from public.broadcast_sessions where id = t.session_id and status not in ('ended', 'archived');
  if not found or s.live_revision_id is distinct from p_revision then raise exception 'not the live graphic' using errcode = '42501'; end if;
  select png into img from public.render_images where revision_id = p_revision;
  return translate(encode(img, 'base64'), E'\n', '');
end $$;

-- ---------------------------------------------------------------- grants for functions
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.gs_role(), public.gs_has_role(public.gs_role[]), public.gs_is_member(), public.gs_session_visible(uuid),
  public.gs_me(), public.gs_set_member(text, public.gs_role, text, boolean), public.gs_set_approval(uuid, public.gs_approval, text),
  public.bc_create_session(text, text, text, jsonb, uuid), public.bc_add_member(uuid, uuid, text, int),
  public.bc_transfer_control(uuid, uuid, int),
  public.bc_create_preview(uuid, text, text, boolean, uuid, int, text, text, timestamptz, int, text, timestamptz),
  public.bc_publish(uuid, bigint, text, int), public.bc_clear(uuid, int), public.bc_set_status(uuid, public.gs_session_status, int),
  public.bc_issue_output_token(uuid, text, int), public.bc_output_token_admin(uuid, text, int)
  to authenticated;
grant execute on function public.bc_output_state(text, bigint, text, text), public.bc_output_image(text, bigint) to anon, authenticated;
-- gs_audit, gs_rate_limit, bc_lock and bc_notify stay private (no grant): only callable from the functions above.

-- ---------------------------------------------------------------- realtime (console status; RLS applies)
alter publication supabase_realtime add table public.broadcast_sessions, public.output_tokens, public.live_events;

-- Make PostgREST pick up the new functions immediately.
notify pgrst, 'reload schema';
