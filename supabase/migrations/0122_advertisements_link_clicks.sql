-- Dock2Door — Advertisements: per-link click tracking.
-- An ad can carry several tappable destinations (website, Instagram, phone,
-- WhatsApp, YouTube, email). This records which button people actually tap so
-- the super admin can see the best-performing destination per ad. The total
-- `clicks` counter (0119) keeps working; this adds a per-type breakdown.
-- Idempotent.

alter table public.advertisements
  add column if not exists link_clicks jsonb not null default '{}'::jsonb; -- { "website": 12, "phone": 3, ... }

-- Bump the overall click counter AND the per-link-type counter in one call.
-- SECURITY DEFINER so any authenticated viewer can record a tap without holding
-- UPDATE rights on the table.
create or replace function public.ad_record_link_click(p_id uuid, p_link_type text)
returns void language sql security definer set search_path = public as $$
  update public.advertisements
  set clicks = clicks + 1,
      link_clicks = jsonb_set(
        coalesce(link_clicks, '{}'::jsonb),
        array[coalesce(nullif(p_link_type, ''), 'website')],
        to_jsonb(
          coalesce((link_clicks ->> coalesce(nullif(p_link_type, ''), 'website'))::bigint, 0) + 1
        )
      )
  where id = p_id;
$$;
grant execute on function public.ad_record_link_click(uuid, text) to authenticated;

notify pgrst, 'reload schema';
