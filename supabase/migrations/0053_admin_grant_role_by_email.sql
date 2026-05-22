-- Migration 0053: admin_grant_role_by_email
-- Resolves the roles page sending p_user_email to admin_grant_role (which expects p_user_id uuid).
-- This new RPC looks up the auth.users record by email server-side and then delegates to admin_grant_role.

create or replace function public.admin_grant_role_by_email(
  p_email    text,
  p_role     platform_role,
  p_reason   text
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_user_id uuid;
begin
  perform public.require_admin();
  perform public.require_reason(p_reason);

  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then
    raise exception 'No user found with email: %', p_email;
  end if;

  insert into public.user_roles(user_id, role, granted_by)
    values (v_user_id, p_role, auth.uid())
    on conflict do nothing;

  perform public.write_audit(
    'role.grant', 'user_roles', v_user_id::text,
    null,
    jsonb_build_object('role', p_role, 'email', p_email),
    p_reason, null
  );

  return v_user_id;
end;
$$;

grant execute on function public.admin_grant_role_by_email(text, platform_role, text) to authenticated;
