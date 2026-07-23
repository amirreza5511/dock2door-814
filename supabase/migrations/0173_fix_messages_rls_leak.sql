-- =========================================================================
-- 0173 — SECURITY FIX: scope `public.messages` to conversation participants
--
-- The old SELECT policy was `auth.role() = 'authenticated'`, which let ANY
-- signed-in user read EVERY message in the system. The INSERT policy only
-- checked `sender_user_id = auth.uid()`, so anyone could also post into any
-- conversation. This ties both read and write to the two parties of the
-- referenced WarehouseBooking / ServiceJob / ShiftAssignment.
--
-- Idempotent & safe to re-run.
-- =========================================================================

-- Membership helper: is auth.uid() an active member of the given company?
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_company_id is not null and (
    exists (
      select 1 from public.company_users cu
      where cu.company_id = p_company_id
        and cu.user_id = auth.uid()
        and cu.status = 'Active'
    )
    or exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.company_id = p_company_id
    )
  );
$$;
grant execute on function public.is_company_member(uuid) to authenticated;

-- Can the current user access the conversation attached to this reference?
create or replace function public.can_access_message(p_ref_type text, p_ref_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_ref_type
    when 'WarehouseBooking' then exists (
      select 1 from public.warehouse_bookings b
      where b.id = p_ref_id
        and (b.created_by = auth.uid()
          or public.is_company_member(b.customer_company_id)
          or public.is_company_member(b.warehouse_company_id))
    )
    when 'ServiceJob' then exists (
      select 1 from public.service_jobs j
      where j.id = p_ref_id
        and (j.created_by = auth.uid()
          or public.is_company_member(j.customer_company_id)
          or public.is_company_member(j.provider_company_id))
    )
    when 'ShiftAssignment' then exists (
      select 1 from public.shift_assignments s
      where s.id = p_ref_id
        and (s.worker_user_id = auth.uid()
          or public.is_company_member(s.employer_company_id)
          or public.is_company_member(s.agency_company_id))
    )
    else false
  end;
$$;
grant execute on function public.can_access_message(text, uuid) to authenticated;

-- Replace the leaky read policy: only participants (or admins) may read.
drop policy if exists "msg_read_auth" on public.messages;
drop policy if exists "msg_read_participant" on public.messages;
create policy "msg_read_participant" on public.messages
  for select
  using (
    is_admin()
    or sender_user_id = auth.uid()
    or public.can_access_message(reference_type::text, reference_id)
  );

-- Tighten insert: the sender must be themselves AND a participant of the thread.
drop policy if exists "msg_self_insert" on public.messages;
drop policy if exists "msg_participant_insert" on public.messages;
create policy "msg_participant_insert" on public.messages
  for insert
  with check (
    sender_user_id = auth.uid()
    and (is_admin() or public.can_access_message(reference_type::text, reference_id))
  );

notify pgrst, 'reload schema';
