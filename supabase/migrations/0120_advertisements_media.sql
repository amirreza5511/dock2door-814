-- Dock2Door — Advertisements: rich media + link types + play caps.
-- Extends the base advertisements table (0119) so sponsors can run image OR
-- video OR YouTube creatives, link to a website / Instagram / phone / WhatsApp /
-- YouTube, run several ads at once (rotated randomly by weight), and cap how many
-- times each ad is shown (max_impressions). Idempotent.

alter table public.advertisements
  add column if not exists media_type text not null default 'image',      -- image | video | youtube
  add column if not exists video_url text not null default '',            -- direct .mp4/.m3u8 or any video URL
  add column if not exists link_type text not null default 'website',     -- website | instagram | phone | whatsapp | youtube | email
  add column if not exists max_impressions bigint not null default 0,     -- 0 = unlimited
  add column if not exists weight int not null default 1;                 -- random-rotation weighting (higher = shown more)

-- Keep the serving index useful for the new caps too.
create index if not exists idx_advertisements_serving2
  on public.advertisements(status, placement, priority desc, weight desc);

notify pgrst, 'reload schema';
