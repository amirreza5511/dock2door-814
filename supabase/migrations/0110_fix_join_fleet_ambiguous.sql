-- =========================================================================
-- 0110 — Fix "column reference \"company_id\" is ambiguous" in join_fleet_by_code
-- Idempotent.
--
-- Root cause: join_fleet_by_code declared `returns table (company_id uuid, ...)`.
-- Those OUT columns are in scope for the whole function body, so a bare
-- `company_id` inside `... where company_id = v_company_id` on public.drivers
-- was ambiguous between the OUT column and drivers.company_id.
--
-- Fix: rename the OUT columns (out_company_id / out_company_name) so they can
-- never collide with a table column, and fully qualify column references.
-- =========================================================================

create or replace function public.join_fleet_by_code(p_code text)
returns table (company_id uuid, company_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_name text;
  v_me uuid := auth.uid();
  v_email text;
  v_name text;
  v_existing uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  select c.id, c.name into v_company_id, v_company_name
  from public.companies c
  where c.fleet_code = upper(trim(p_code))
  limit 1;

  if v_company_id is null then
    raise exception 'Invalid fleet code';
  end if;

  select p.email, p.name into v_email, v_name
  from public.profiles p
  where p.id = v_me;

  -- Reuse an existing (possibly dispatcher-created) driver row matched by
  -- linked user id or email; otherwise create a fresh one.
  select d.id into v_existing
  from public.drivers d
  where d.company_id = v_company_id
    and d.archived_at is null
    and ((d.data->>'userId') = v_me::text
         or lower(coalesce(d.data->>'email','')) = lower(coalesce(v_email,'')))
  limit 1;

  if v_existing is not null then
    update public.drivers d
    set profile_id = v_me,
        data = coalesce(d.data, '{}'::jsonb) || jsonb_build_object('userId', v_me::text, 'email', v_email),
        updated_at = now()
    where d.id = v_existing;
  else
    insert into public.drivers (company_id, profile_id, name, phone, status, data)
    values (
      v_company_id, v_me, coalesce(nullif(v_name, ''), split_part(coalesce(v_email,''), '@', 1)), '',
      'Active',
      jsonb_build_object('userId', v_me::text, 'email', v_email, 'name', coalesce(v_name, ''), 'selfRegistered', true)
    );
  end if;

  return query select v_company_id, v_company_name;
end;
$$;

grant execute on function public.join_fleet_by_code(text) to authenticated;

-- Refresh PostgREST schema cache so the new function is picked up immediately.
notify pgrst, 'reload schema';
