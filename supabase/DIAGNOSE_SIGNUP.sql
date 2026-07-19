-- ============================================================================
-- DIAGNOSE_SIGNUP.sql — run this in Supabase Dashboard → SQL Editor
-- Purpose: find the exact database error behind "Database error saving new user"
-- Safe: the simulated signup is rolled back; nothing is persisted.
-- ============================================================================

-- 1) Which triggers exist on auth.users?
select t.tgname as trigger_name, p.proname as function_name, t.tgenabled as enabled
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal;

-- 2) Is the deployed handle_new_user the latest version (with the Guest branch)?
select
  (prosrc like '%is_guest%')          as has_guest_branch,
  (prosrc like '%CustomsBroker%')     as has_customs_broker,
  (prosrc like '%EmploymentAgency%')  as has_employment_agency,
  length(prosrc)                      as body_length
from pg_proc
where proname = 'handle_new_user'
  and pronamespace = 'public'::regnamespace;

-- 3) Simulate a CustomsBroker signup exactly like the app does (ROLLED BACK).
--    The NOTICE output below shows the real error message.
do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    'diag-sim-' || substr(v_id::text, 1, 8) || '@example.com',
    'x-not-a-real-password-hash',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'name', 'Diag Broker',
      'role', 'CustomsBroker',
      'company_name', 'Diag Brokerage Inc',
      'city', 'Vancouver',
      'fleet_code', '',
      'agent_code', '',
      'accepted_terms', 'true',
      'terms_version', '1.0',
      'accepted_nda', 'true',
      'nda_version', '1.0',
      'nda_signed_name', 'Diag Broker',
      'signup_platform', 'web'
    ),
    now(), now(), '', '', '', ''
  );
  -- If we get here the trigger worked. Force a rollback of the test insert.
  raise exception 'DIAG_ROLLBACK';
exception
  when others then
    if sqlerrm = 'DIAG_ROLLBACK' then
      raise notice 'SIGNUP SIMULATION SUCCEEDED - trigger is fine (test user rolled back)';
    else
      raise notice 'SIGNUP FAILED -> % (SQLSTATE: %)', sqlerrm, sqlstate;
    end if;
end $$;

-- 4) Same simulation for a plain Customer signup (also rolled back).
do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    'diag-sim-' || substr(v_id::text, 1, 8) || '@example.com',
    'x-not-a-real-password-hash',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'name', 'Diag Customer',
      'role', 'Customer',
      'company_name', '',
      'city', '',
      'accepted_terms', 'true',
      'accepted_nda', 'true',
      'nda_signed_name', 'Diag Customer',
      'signup_platform', 'web'
    ),
    now(), now(), '', '', '', ''
  );
  raise exception 'DIAG_ROLLBACK';
exception
  when others then
    if sqlerrm = 'DIAG_ROLLBACK' then
      raise notice 'CUSTOMER SIMULATION SUCCEEDED - trigger is fine (test user rolled back)';
    else
      raise notice 'CUSTOMER SIGNUP FAILED -> % (SQLSTATE: %)', sqlerrm, sqlstate;
    end if;
end $$;
