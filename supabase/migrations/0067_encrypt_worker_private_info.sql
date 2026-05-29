-- Enable pgcrypto (Supabase installs extensions into the "extensions" schema)
create extension if not exists pgcrypto with schema extensions;

-- Add encrypted columns alongside existing ones
alter table public.worker_private_info
  add column if not exists sin_number_enc bytea,
  add column if not exists bank_account_number_enc bytea,
  add column if not exists bank_transit_number_enc bytea,
  add column if not exists bank_institution_number_enc bytea;

-- Encrypt existing plaintext data using app-level key from vault
-- (will be NULL until app writes new values — existing plaintext columns
-- kept for migration safety, to be dropped in a future migration)

-- Create helper functions
create or replace function public.encrypt_pii(p_value text)
returns bytea
language sql
security definer
set search_path = public, extensions
as $func$
  select extensions.pgp_sym_encrypt(p_value, current_setting('app.pii_key', true))
$func$;

create or replace function public.decrypt_pii(p_value bytea)
returns text
language sql
security definer
set search_path = public, extensions
as $func$
  select extensions.pgp_sym_decrypt(p_value, current_setting('app.pii_key', true))
$func$;

-- Grant execute on helpers to authenticated role
grant execute on function public.encrypt_pii(text) to authenticated;
grant execute on function public.decrypt_pii(bytea) to authenticated;
