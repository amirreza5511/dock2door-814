-- Dock2Door — Advertisements: multi-placement + multi-link.
-- Lets a single ad run on several pages at once (or all pages), and carry
-- several tappable destinations at the same time (website, Instagram, phone,
-- WhatsApp, YouTube, email). Backward compatible with the single `placement`
-- and `link_type`/`target_url` columns. Idempotent.

alter table public.advertisements
  add column if not exists placements text[] not null default '{}',   -- e.g. {'all'} or {'customer','driver'}
  add column if not exists links jsonb not null default '[]'::jsonb;  -- [{ "type": "website", "value": "https://…" }, …]

-- Backfill placements from the legacy single placement so existing ads keep working.
update public.advertisements
  set placements = array[placement]
  where placements is null or array_length(placements, 1) is null;

-- Backfill links from the legacy single link where present.
update public.advertisements
  set links = jsonb_build_array(jsonb_build_object('type', coalesce(link_type, 'website'), 'value', target_url))
  where (links is null or jsonb_array_length(links) = 0) and coalesce(target_url, '') <> '';

create index if not exists idx_advertisements_placements
  on public.advertisements using gin (placements);

notify pgrst, 'reload schema';
