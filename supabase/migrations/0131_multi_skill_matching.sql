-- Dock2Door — Multi-skill matching for shift notifications
-- ------------------------------------------------------------------------------
-- Before this migration, notify_matching_workers() only matched a worker when
-- the shift's single primary `category` was in the worker's skills. Multi-skill
-- job posts (shift_posts.skills[]) were effectively ignored beyond their primary
-- category. This updates the matcher to use full array overlap between the job's
-- required skills and the worker's skills, so any overlapping skill triggers a
-- match. Falls back to the primary category if a legacy post has no skills[].
--
-- Idempotent. Safe to re-run.

create or replace function public.notify_matching_workers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_company_name text;
begin
  -- Only fire when the shift becomes Posted (insert as Posted, or transition into Posted).
  if NEW.status <> 'Posted' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.status = 'Posted' then
    return NEW;
  end if;

  select name into v_company_name from public.companies where id = NEW.employer_company_id;

  for r in
    -- skill overlap + city match, OR the worker favorited this employer
    select distinct wp.user_id
      from public.worker_profiles wp
     where wp.status = 'Active'
       and (
         (
           -- Any of the job's required skills overlaps the worker's skills.
           -- Fall back to the single category for legacy posts with no skills[].
           (
             case
               when coalesce(array_length(NEW.skills, 1), 0) > 0
                 then NEW.skills && wp.skills
               else NEW.category = any(wp.skills)
             end
           )
           and (
             coalesce(array_length(wp.coverage_cities, 1), 0) = 0
             or exists (
               select 1 from unnest(wp.coverage_cities) c
               where lower(c) = lower(coalesce(NEW.location_city, ''))
             )
           )
         )
         or exists (
           select 1 from public.worker_favorite_employers f
           where f.worker_user_id = wp.user_id
             and f.employer_company_id = NEW.employer_company_id
         )
       )
  loop
    perform public.queue_notification(
      r.user_id,
      'shift_match',
      'New shift for you',
      coalesce(v_company_name, 'An employer') || ' posted "' || coalesce(nullif(NEW.title, ''), 'a shift')
        || '" in ' || coalesce(nullif(NEW.location_city, ''), 'your area'),
      'shift', NEW.id::text,
      jsonb_build_object('shift_id', NEW.id, 'category', NEW.category, 'skills', NEW.skills)
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_matching_workers on public.shift_posts;
create trigger trg_notify_matching_workers
  after insert or update of status on public.shift_posts
  for each row execute function public.notify_matching_workers();
