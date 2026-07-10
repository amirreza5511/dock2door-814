-- Dock2Door — Expand skills catalog + multi-skill jobs + ongoing job openings
-- ------------------------------------------------------------------------------
-- Extends the `shift_category` enum from 4 values into a full trades catalog,
-- adds multi-skill requirements to shift posts, and an "ongoing job opening"
-- flag so employers can post recurring roles (not just single dated shifts).
--
-- NOTE ON ENUM VALUES: `ALTER TYPE ... ADD VALUE` new labels cannot be *used*
-- (as literals / in DML) in the same transaction that adds them. This migration
-- only ADDs the values and backfills from PRE-EXISTING enum values, so it is safe.

-- =============================================================
-- 1) Expand the shift_category enum into a full catalog
-- =============================================================
-- Warehouse & logistics
alter type public.shift_category add value if not exists 'Loader';
alter type public.shift_category add value if not exists 'Inventory';
-- Construction & trades
alter type public.shift_category add value if not exists 'Electrical';
alter type public.shift_category add value if not exists 'Plumbing';
alter type public.shift_category add value if not exists 'Painting';
alter type public.shift_category add value if not exists 'Carpentry';
alter type public.shift_category add value if not exists 'Drywall';
alter type public.shift_category add value if not exists 'Welding';
alter type public.shift_category add value if not exists 'HVAC';
alter type public.shift_category add value if not exists 'Roofing';
alter type public.shift_category add value if not exists 'Construction';
alter type public.shift_category add value if not exists 'Landscaping';
-- Facilities & cleaning
alter type public.shift_category add value if not exists 'Janitorial';
alter type public.shift_category add value if not exists 'IndustrialCleaning';
alter type public.shift_category add value if not exists 'Groundskeeping';
-- Hospitality & retail
alter type public.shift_category add value if not exists 'Server';
alter type public.shift_category add value if not exists 'Barista';
alter type public.shift_category add value if not exists 'Kitchen';
alter type public.shift_category add value if not exists 'Cashier';
alter type public.shift_category add value if not exists 'Stocker';
alter type public.shift_category add value if not exists 'EventStaff';
-- Media & production
alter type public.shift_category add value if not exists 'FilmCrew';
alter type public.shift_category add value if not exists 'Grip';
alter type public.shift_category add value if not exists 'CameraAssistant';
alter type public.shift_category add value if not exists 'ProductionAssistant';
alter type public.shift_category add value if not exists 'Lighting';
-- Health & care
alter type public.shift_category add value if not exists 'PharmacyWorker';
alter type public.shift_category add value if not exists 'CareAide';
alter type public.shift_category add value if not exists 'MedicalAssistant';
alter type public.shift_category add value if not exists 'CleaningTech';
-- Office & other
alter type public.shift_category add value if not exists 'Reception';
alter type public.shift_category add value if not exists 'DataEntry';
alter type public.shift_category add value if not exists 'Security';
alter type public.shift_category add value if not exists 'Flagger';

-- =============================================================
-- 2) Multi-skill requirements + ongoing job openings on shift_posts
-- =============================================================
alter table public.shift_posts
  add column if not exists skills public.shift_category[] not null default '{}',
  add column if not exists is_ongoing boolean not null default false;

-- Backfill the multi-skill array from the existing single category so no
-- existing job loses its skill (uses pre-existing enum values only).
update public.shift_posts
   set skills = array[category]
 where coalesce(array_length(skills, 1), 0) = 0;
