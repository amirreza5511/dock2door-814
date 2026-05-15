-- 0031_worker_address_identity.sql
-- Adds home address, nationality, and identity-doc fields to worker_private_info.
-- Also extends worker_profiles with a visible phone column (already added in 0025
-- as 'phone', this migration is a no-op for that column).

alter table public.worker_private_info
  add column if not exists address_line1    text default '',
  add column if not exists address_line2    text default '',
  add column if not exists city             text default '',
  add column if not exists province         text default '',
  add column if not exists postal_code      text default '',
  add column if not exists country          text default 'Canada',
  add column if not exists nationality      text default '',
  add column if not exists govt_id_path     text default '',
  add column if not exists govt_id_type     text default '';

-- govt_id_type valid values (enforced in app layer, not DB to keep flexible):
-- 'Passport' | 'Drivers Licence' | 'PR Card' | 'National ID' | 'Other'

comment on column public.worker_private_info.address_line1 is 'Street address, e.g. 123 Main St';
comment on column public.worker_private_info.address_line2 is 'Apt / Suite / Unit';
comment on column public.worker_private_info.city is 'City';
comment on column public.worker_private_info.province is 'Province or state code, e.g. BC, ON, AB';
comment on column public.worker_private_info.postal_code is 'Postal / ZIP code';
comment on column public.worker_private_info.country is 'Country, default Canada';
comment on column public.worker_private_info.nationality is 'Country of citizenship';
comment on column public.worker_private_info.govt_id_path is 'Storage path in certifications bucket for government ID scan';
comment on column public.worker_private_info.govt_id_type is 'Type of government ID uploaded';
