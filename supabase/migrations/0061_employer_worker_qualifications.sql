-- 0061_employer_worker_qualifications.sql
-- Safe employer-visible summary of a worker's APPROVED qualifications.
--
-- Problem: employers need to see what an applicant is qualified for BEFORE
-- accepting them, but worker_certifications RLS only opens up after a
-- shift_assignment exists (chicken-and-egg).
--
-- Solution: a SECURITY DEFINER RPC that returns only safe summary fields
-- (type, status='Approved', expiry_date) for workers who currently have
-- an Applied/Accepted application on a shift owned by the caller's company.
-- NEVER exposes file_path, notes, government ID, or rejected/pending docs.
--
-- Idempotent.

create or replace function public.employer_worker_qualifications_summary(
  p_worker_user_id uuid
) returns table (
  cert_type text,
  status text,
  expiry_date date
) language plpgsql security definer set search_path = public stable as $$
begin
  -- Caller must belong to a company that has an Applied/Accepted application
  -- OR an existing shift assignment with this worker.
  if not exists (
    select 1
      from public.shift_applications sa
      join public.shift_posts sp on sp.id = sa.shift_id
     where sa.worker_user_id = p_worker_user_id
       and sa.status in ('Applied','Accepted')
       and exists (
         select 1 from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.company_id = sp.employer_company_id
            and cu.status = 'Active'
       )
    union all
    select 1
      from public.shift_assignments asg
     where asg.worker_user_id = p_worker_user_id
       and exists (
         select 1 from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.company_id = asg.employer_company_id
            and cu.status = 'Active'
       )
  ) then
    raise exception 'Not authorized to view this worker''s qualifications';
  end if;

  return query
    select
      wc.type::text as cert_type,
      wc.status::text as status,
      wc.expiry_date
    from public.worker_certifications wc
    where wc.worker_user_id = p_worker_user_id
      and wc.status = 'Approved'
    order by wc.type;
end;
$$;

grant execute on function public.employer_worker_qualifications_summary(uuid) to authenticated;
