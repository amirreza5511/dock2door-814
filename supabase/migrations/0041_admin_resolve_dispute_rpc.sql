-- Migration 0041: admin_resolve_dispute SECURITY DEFINER RPC
-- Replaces direct table UPDATE on disputes with an audited, admin-only RPC.
-- Every status change is written to audit_logs with before/after JSONB.

create or replace function public.admin_resolve_dispute(
  p_dispute_id  uuid,
  p_status      text,           -- 'UnderReview' | 'Escalated' | 'Resolved'
  p_outcome     text  default null,  -- 'Refund' | 'PartialRefund' | 'Denied' | 'Other'
  p_admin_notes text  default null,
  p_reason      text  default null   -- required for 'Resolved' / 'Escalated'
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
  -- Must be an admin.
  perform require_admin();

  -- Reason is mandatory when resolving or escalating.
  if p_status in ('Resolved', 'Escalated') then
    perform require_reason(coalesce(p_reason, p_admin_notes));
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

  -- Write audit entry.
  perform write_audit(
    auth.uid(),
    'admin_resolve_dispute',
    'dispute',
    p_dispute_id,
    v_before,
    v_after,
    coalesce(p_reason, p_admin_notes)
  );
end;
$$;

-- Grant to authenticated so the web app can call it via supabase.rpc().
grant execute on function public.admin_resolve_dispute(uuid, text, text, text, text) to authenticated;
