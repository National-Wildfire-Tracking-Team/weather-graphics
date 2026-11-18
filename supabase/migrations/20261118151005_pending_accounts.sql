-- Pending approval: accounts that exist in Auth but have no Graphics Studio role yet.
-- Administrators see them, then approve (gs_set_member with a role) or decline. Additive only.

-- Accounts with no org_members row. Declined accounts get an inactive row, so they leave this list.
create function public.gs_pending_accounts()
returns table (user_id uuid, email text, created_at timestamptz, email_confirmed boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.gs_has_role('admin') then
    raise exception 'Only an administrator can see accounts waiting for approval.' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at
    from auth.users u
    where not exists (select 1 from public.org_members m where m.user_id = u.id)
    order by u.created_at desc
    limit 500;
end $$;

-- Decline: record the account as an inactive member with no access (reversible: approve it later with gs_set_member).
-- Deleting the Auth account itself needs the dashboard (service role), which the browser never has.
create function public.gs_decline_account(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare em text;
begin
  if not public.gs_has_role('admin') then raise exception 'Only an administrator can decline accounts.' using errcode = '42501'; end if;
  perform public.gs_rate_limit(auth.uid()::text, 'admin', 60, 60);
  select email into em from auth.users where id = p_user;
  if em is null then raise exception 'Account not found.'; end if;
  if exists (select 1 from public.org_members where user_id = p_user) then raise exception 'That account is already a member; change it under Members instead.'; end if;
  insert into public.org_members (user_id, email, role, active) values (p_user, lower(em), 'viewer', false);
  perform public.gs_audit('member.decline', null, jsonb_build_object('email', lower(em)));
end $$;

revoke all on function public.gs_pending_accounts(), public.gs_decline_account(uuid) from public, anon, authenticated;
grant execute on function public.gs_pending_accounts(), public.gs_decline_account(uuid) to authenticated;

notify pgrst, 'reload schema';
