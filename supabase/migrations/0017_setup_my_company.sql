-- 0017_setup_my_company.sql
-- Self-service company setup for users who signed up without a company_name.
-- Idempotent.

create or replace function public.setup_my_company(
  p_name text,
  p_city text,
  p_type company_type
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_role user_role;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'name_required';
  end if;

  -- If the user already owns a company of that type, reuse it
  select c.id into v_company_id
    from public.companies c
    join public.company_users cu on cu.company_id = c.id
   where cu.user_id = v_uid
     and cu.company_role = 'Owner'
     and cu.status = 'Active'
     and c.type = p_type
   limit 1;

  if v_company_id is not null then
    update public.companies
       set name = p_name,
           city = coalesce(p_city, city)
     where id = v_company_id;
    return v_company_id;
  end if;

  insert into public.companies (name, type, city, status)
  values (p_name, p_type, coalesce(nullif(btrim(p_city), ''), 'Vancouver'), 'PendingApproval')
  returning id into v_company_id;

  insert into public.company_users (company_id, user_id, company_role, status)
  values (v_company_id, v_uid, 'Owner', 'Active')
  on conflict (company_id, user_id) do update set company_role = 'Owner', status = 'Active';

  -- Keep profiles.company_id in sync for legacy code paths, if the column exists
  select role into v_role from public.profiles where id = v_uid;
  update public.profiles set company_id = coalesce(company_id, v_company_id) where id = v_uid;

  return v_company_id;
end;
$$;

grant execute on function public.setup_my_company(text, text, company_type) to authenticated;
