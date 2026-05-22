-- 0044_fix_admin_resolve_dispute_audit.sql
-- Fixes confirmed bug in admin_resolve_dispute (0041):
--
-- BUG — write_audit called with wrong argument order.
--   The 0041 call was:
--     perform write_audit(auth.uid(), 'admin_resolve_dispute', 'dispute', p_dispute_id, v_before, v_after, reason);
--   But write_audit signature is:
--     write_audit(p_action text, p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb, p_reason text, p_company_id uuid)
--   Effect: auth.uid() (a uuid) was passed as the action (text), 'admin_resolve_dispute'
--   became entity_type, 'dispute' became entity_id (the actual entity_id was dropped),
--   p_dispute_id was passed as p_before (a jsonb argument), v_before became p_after,
--   v_after became p_reason, and the real reason was cast to uuid and silently truncated.
--   Result: every audit entry for dispute resolution has wrong data in every column.
--
-- FIX: recreate the function with the correct write_audit argument order.
-- Idempotent.

create or replace function public.admin_resolve_dispute(
  p_dispute_id  uuid,
  p_status      text,
  p_outcome     text  default null,
  p_admin_notes text  default null,
  p_reason      text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  perform public.require_admin();

  -- Reason is mandatory when resolving or escalating.
  if p_status in ('Resolved', 'Escalated') then
    perform public.require_reason(coalesce(p_reason, p_admin_notes));
  end if;

  -- Capture before state.
  select to_jsonb(d) into v_before
  from public.disputes d
  where d.id = p_dispute_id;

  if v_before is null then
    raise exception 'Dispute % not found', p_dispute_id;
  end if;

  -- Apply the update.
  update public.disputes
  set
    status      = p_status::dispute_status,
    outcome     = case when p_outcome is not null then p_outcome::dispute_outcome else outcome end,
    admin_notes = coalesce(p_admin_notes, admin_notes),
    resolved_by = case when p_status = 'Resolved' then auth.uid() else resolved_by end,
    resolved_at = case when p_status = 'Resolved' then now() else resolved_at end
  where id = p_dispute_id;

  -- Capture after state.
  select to_jsonb(d) into v_after
  from public.disputes d
  where d.id = p_dispute_id;

  -- FIXED: correct argument order — (action, entity_type, entity_id, before, after, reason)
  perform public.write_audit(
    'admin_resolve_dispute',
    'disputes',
    p_dispute_id::text,
    v_before,
    v_after,
    coalesce(p_reason, p_admin_notes)
  );
end;
$$;

grant execute on function public.admin_resolve_dispute(uuid, text, text, text, text) to authenticated;
