-- Phase 3: Sentinel Live Broadcast Map. Extends the Phase 2 broadcast sessions (same sessions, roles, controller,
-- audit log, output tokens and Realtime nudge channel) with a server-authoritative LIVE MAP STATE per session.
--   * Sentinel's Broadcast Control Center edits a private preview locally and publishes it (Take Live), or streams
--     changes in explicit live-control mode. Only the session controller can publish; every write is version-checked.
--   * Sentinel's Broadcast Output (OBS Browser Source) reads the live map state with a map-scoped output token.
--   * The map state is a description (camera, layers, radar playback, selected warning/incident, annotations).
--     Annotations live only here, never in incident or alert data.

-- ---------------------------------------------------------------- output token scope
alter table public.output_tokens add column scope text not null default 'graphics' check (scope in ('graphics', 'map'));

-- Graphics outputs must not be usable with a map token (least privilege): same functions, plus a scope check.
create or replace function public.bc_output_state(p_token text, p_rendered_seq bigint default null, p_status text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.output_tokens; s public.broadcast_sessions; r public.broadcast_revisions; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.gs_rate_limit(h, 'output', 240, 60);
  select * into t from public.output_tokens where token_hash = h and scope = 'graphics';
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

create or replace function public.bc_output_image(p_token text, p_revision bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.output_tokens; s public.broadcast_sessions; img bytea; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'invalid output token' using errcode = '42501'; end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.gs_rate_limit(h, 'output-image', 60, 60);
  select * into t from public.output_tokens where token_hash = h and scope = 'graphics' and revoked_at is null and expires_at > now();
  if not found then raise exception 'invalid output token' using errcode = '42501'; end if;
  select * into s from public.broadcast_sessions where id = t.session_id and status not in ('ended', 'archived');
  if not found or s.live_revision_id is distinct from p_revision then raise exception 'not the live graphic' using errcode = '42501'; end if;
  select png into img from public.render_images where revision_id = p_revision;
  return translate(encode(img, 'base64'), E'\n', '');
end $$;

-- Issue an output credential for graphics (Graphics Studio) or the live map (Sentinel). Replaces the 3-argument version.
drop function public.bc_issue_output_token(uuid, text, int);
create function public.bc_issue_output_token(p_session uuid, p_label text, p_ttl_hours int default 12, p_scope text default 'graphics') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; raw text; t public.output_tokens;
begin
  s := public.bc_lock(p_session, null, false);
  if p_scope not in ('graphics', 'map') then raise exception 'Unknown output type.'; end if;
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
  insert into public.output_tokens (session_id, token_hash, label, created_by, expires_at, scope)
  values (p_session, encode(extensions.digest(raw, 'sha256'), 'hex'), left(trim(coalesce(nullif(trim(p_label), ''), 'OBS output')), 80), auth.uid(), now() + make_interval(hours => p_ttl_hours), p_scope)
  returning * into t;
  perform public.gs_audit('output.issue', p_session, jsonb_build_object('output', t.id, 'label', t.label, 'scope', t.scope, 'expires_at', t.expires_at));
  return jsonb_build_object('id', t.id, 'token', raw, 'expires_at', t.expires_at, 'label', t.label, 'scope', t.scope);
end $$;

-- ---------------------------------------------------------------- live map state
create table public.broadcast_map_state (
  session_id uuid primary key references public.broadcast_sessions (id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 262144),
  version int not null default 0,
  live_control boolean not null default false,     -- true: the controller's changes stream to air as they happen
  updated_at timestamptz not null default now(),
  updated_by uuid,
  last_action text
);

-- Saved geographic camera / layout / incident presets (organisation-wide; created by producers, admins, editors).
create table public.map_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'view' check (kind in ('view', 'layout', 'incident')),
  incident_key text check (char_length(incident_key) <= 200),
  state jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 131072),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.broadcast_map_state enable row level security;
alter table public.map_presets enable row level security;
create policy map_state_read on public.broadcast_map_state for select to authenticated using (public.gs_session_visible(session_id));
create policy map_presets_read on public.map_presets for select to authenticated using (public.gs_is_member());
create policy map_presets_insert on public.map_presets for insert to authenticated
  with check (public.gs_has_role('admin', 'producer', 'editor') and created_by = auth.uid());
create policy map_presets_update on public.map_presets for update to authenticated
  using (public.gs_has_role('admin') or (created_by = auth.uid() and public.gs_has_role('producer', 'editor')))
  with check (public.gs_has_role('admin') or created_by = auth.uid());
create policy map_presets_delete on public.map_presets for delete to authenticated
  using (public.gs_has_role('admin') or (created_by = auth.uid() and public.gs_has_role('producer', 'editor')));
revoke all on public.broadcast_map_state, public.map_presets from anon, authenticated;
grant select on public.broadcast_map_state to authenticated;
grant select, insert, update, delete on public.map_presets to authenticated;

-- Shape checks that keep a published state sane for every output (the client owns the detailed schema).
create function public.bc_map_validate(p jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare cam jsonb := p -> 'camera';
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Map state must be an object.'; end if;
  if cam is null or jsonb_typeof(cam) <> 'object' then raise exception 'Map state needs a camera.'; end if;
  if jsonb_typeof(cam -> 'center') <> 'array' or jsonb_array_length(cam -> 'center') <> 2
     or abs((cam -> 'center' ->> 0)::float8) > 180 or abs((cam -> 'center' ->> 1)::float8) > 90 then
    raise exception 'Camera center must be [longitude, latitude].';
  end if;
  if coalesce((cam ->> 'zoom')::float8, -1) not between 0 and 22 then raise exception 'Camera zoom must be between 0 and 22.'; end if;
  if coalesce((cam ->> 'pitch')::float8, 0) not between 0 and 85 then raise exception 'Camera pitch must be between 0 and 85.'; end if;
  if p ? 'annotations' and (jsonb_typeof(p -> 'annotations') <> 'object' or jsonb_typeof(p -> 'annotations' -> 'features') <> 'array'
     or jsonb_array_length(p -> 'annotations' -> 'features') > 300) then
    raise exception 'Annotations must be a GeoJSON FeatureCollection of at most 300 features.';
  end if;
  if p ? 'layers' and jsonb_typeof(p -> 'layers') <> 'object' then raise exception 'Layers must be an object.'; end if;
  if p ? 'radar' and jsonb_typeof(p -> 'radar') <> 'object' then raise exception 'Radar settings must be an object.'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Map state has a non-numeric camera value.';
end $$;

-- Publish the live map state. Controller only; p_expected_version guards against conflicting updates.
-- p_action: 'take' (preview → live), 'live' (live-control streaming), 'preset', 'incident', 'warning', 'annotations', 'radar', 'fallback', 'clear'.
create function public.bc_map_publish(p_session uuid, p_state jsonb, p_expected_version int, p_action text default 'take', p_live_control boolean default null)
returns public.broadcast_map_state
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; m public.broadcast_map_state;
begin
  if not public.gs_is_member() then raise exception 'Not signed in as an NWTT member.' using errcode = '42501'; end if;
  -- Live-control mode can stream camera moves, so the map has its own, larger budget than other control actions.
  perform public.gs_rate_limit(auth.uid()::text, 'map', 600, 60);
  select * into s from public.broadcast_sessions where id = p_session for update;
  if not found or not public.gs_session_visible(p_session) then raise exception 'Broadcast session not found.' using errcode = 'P0002'; end if;
  if s.controller_id is distinct from auth.uid() then
    raise exception 'You are not the controller of this session. Ask the current controller to transfer control.' using errcode = '42501';
  end if;
  if s.status in ('ended', 'archived') then raise exception 'This session has ended. Nothing can be published to it.'; end if;
  if p_action not in ('take', 'live', 'preset', 'incident', 'warning', 'annotations', 'radar', 'fallback', 'clear') then raise exception 'Unknown map action.'; end if;
  perform public.bc_map_validate(p_state);
  insert into public.broadcast_map_state (session_id) values (p_session) on conflict do nothing;
  select * into m from public.broadcast_map_state where session_id = p_session for update;
  if p_expected_version is distinct from m.version then
    raise exception 'version_conflict' using errcode = '40001', detail = m.version::text,
      hint = 'The live map was changed elsewhere. The latest state has been loaded; check it and try again.';
  end if;
  update public.broadcast_map_state set state = p_state, version = version + 1, updated_at = now(), updated_by = auth.uid(),
    last_action = p_action, live_control = coalesce(p_live_control, live_control)
  where session_id = p_session returning * into m;
  if s.status in ('draft', 'ready') then update public.broadcast_sessions set status = 'live', started_at = coalesce(started_at, now()), version = version + 1, updated_at = now() where id = p_session; end if;
  -- Continuous live-control camera moves are not individually audited; everything else is.
  if p_action <> 'live' then perform public.gs_audit('map.' || p_action, p_session, jsonb_build_object('map_version', m.version, 'live_control', m.live_control)); end if;
  begin perform realtime.send(jsonb_build_object('map_version', m.version), 'map', 'nwtt-out-' || s.channel_key, false); exception when others then null; end;
  return m;
end $$;

-- Toggle live-control mode (audited) without changing what is on air.
create function public.bc_map_set_live_control(p_session uuid, p_on boolean) returns public.broadcast_map_state
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.broadcast_sessions; m public.broadcast_map_state;
begin
  s := public.bc_lock(p_session, null, true);
  insert into public.broadcast_map_state (session_id) values (p_session) on conflict do nothing;
  update public.broadcast_map_state set live_control = p_on, updated_at = now() where session_id = p_session returning * into m;
  perform public.gs_audit(case when p_on then 'map.live_control_on' else 'map.live_control_off' end, p_session, '{}'::jsonb);
  return m;
end $$;

-- What a map output (OBS) may read: the live map state only, newer than the version it already has. Read-only apart
-- from its own heartbeat. Map-scoped tokens only.
create function public.bc_map_output_state(p_token text, p_have_version int default null, p_status text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.output_tokens; s public.broadcast_sessions; m public.broadcast_map_state; h text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  h := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.gs_rate_limit(h, 'map-output', 240, 60);
  select * into t from public.output_tokens where token_hash = h and scope = 'map';
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if t.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into s from public.broadcast_sessions where id = t.session_id;
  if s.status in ('ended', 'archived') then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  select * into m from public.broadcast_map_state where session_id = t.session_id;
  update public.output_tokens set last_seen_at = now(), last_rendered_seq = coalesce(p_have_version, last_rendered_seq),
    last_status = coalesce(left(p_status, 80), last_status), user_agent = coalesce(left(p_user_agent, 300), user_agent)
  where id = t.id;
  return jsonb_build_object('ok', true, 'server_now', now(), 'channel', 'nwtt-out-' || s.channel_key, 'token_expires_at', t.expires_at,
    'version', coalesce(m.version, 0), 'updated_at', m.updated_at,
    'state', case when m.version is not null and (p_have_version is null or m.version > p_have_version) then m.state end);
end $$;

-- ---------------------------------------------------------------- grants and realtime
revoke all on function public.bc_issue_output_token(uuid, text, int, text), public.bc_map_validate(jsonb),
  public.bc_map_publish(uuid, jsonb, int, text, boolean), public.bc_map_set_live_control(uuid, boolean),
  public.bc_map_output_state(text, int, text, text) from public, anon, authenticated;
grant execute on function public.bc_issue_output_token(uuid, text, int, text), public.bc_map_publish(uuid, jsonb, int, text, boolean),
  public.bc_map_set_live_control(uuid, boolean) to authenticated;
grant execute on function public.bc_map_output_state(text, int, text, text) to anon, authenticated;
-- bc_map_validate stays private (called only from bc_map_publish).

alter publication supabase_realtime add table public.broadcast_map_state;
notify pgrst, 'reload schema';
