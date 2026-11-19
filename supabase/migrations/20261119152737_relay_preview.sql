-- Field reporters panel (Live Broadcast Control): live browser previews of NWTT field reporters from the SRT relay.
-- The relay (Sentinel infra/aws, SentinelSrtRelay) serves each reporter over WebRTC (WHEP) behind HTTPS, and reading
-- needs a login. That "preview" login must reach staff browsers without being public, so it lives here: one row,
-- no table access for anyone, readable only through gs_relay_preview() by approved members, set only by admins.

create table public.relay_config (
  id boolean primary key default true check (id),                      -- single row
  whep_base text not null check (whep_base ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
  preview_user text not null check (preview_user ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  preview_pass text not null check (char_length(preview_pass) between 16 and 200),
  reporters jsonb not null default '[]'::jsonb check (jsonb_typeof(reporters) = 'array' and jsonb_array_length(reporters) <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.relay_config enable row level security;
revoke all on public.relay_config from anon, authenticated;            -- no policies: functions only

-- Members (any approved role) get the preview login and the reporter list for the panel.
create function public.gs_relay_preview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.relay_config;
begin
  if not public.gs_is_member() then raise exception 'Not signed in as an NWTT member.' using errcode = '42501'; end if;
  select * into c from public.relay_config where id;
  if not found then return null; end if;
  return jsonb_build_object('whep_base', c.whep_base, 'user', c.preview_user, 'pass', c.preview_pass, 'reporters', c.reporters, 'updated_at', c.updated_at);
end $$;

-- Administrators set it (after deploying the relay or changing reporters). The password is never written to the audit log.
create function public.gs_set_relay_config(p_whep_base text, p_preview_user text, p_preview_pass text, p_reporters jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.gs_has_role('admin') then raise exception 'Only administrators can configure the field reporter relay.' using errcode = '42501'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_reporters, '[]'::jsonb)) r
             where jsonb_typeof(r) <> 'object' or coalesce(r ->> 'name', '') !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' or char_length(coalesce(r ->> 'label', '')) > 80) then
    raise exception 'Each reporter needs a name (3-32 chars: a-z, 0-9, -) and an optional label (max 80 chars).';
  end if;
  insert into public.relay_config (id, whep_base, preview_user, preview_pass, reporters, updated_at, updated_by)
  values (true, rtrim(p_whep_base, '/'), p_preview_user, p_preview_pass, coalesce(p_reporters, '[]'::jsonb), now(), auth.uid())
  on conflict (id) do update set whep_base = excluded.whep_base, preview_user = excluded.preview_user, preview_pass = excluded.preview_pass,
    reporters = excluded.reporters, updated_at = now(), updated_by = auth.uid();
  perform public.gs_audit('relay.configure', null, jsonb_build_object('whep_base', rtrim(p_whep_base, '/'), 'reporters', jsonb_array_length(coalesce(p_reporters, '[]'::jsonb))));
end $$;

revoke all on function public.gs_relay_preview(), public.gs_set_relay_config(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.gs_relay_preview(), public.gs_set_relay_config(text, text, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
