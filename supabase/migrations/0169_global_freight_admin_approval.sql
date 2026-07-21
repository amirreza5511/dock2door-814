-- =========================================================================
-- 0169 — Global Freight: admin approval flow.
-- Idempotent & additive. Safe to run multiple times.
--
-- New requests are created 'PendingReview'. An admin reviews the queue and
-- either approves (→ 'Open', notify eligible providers) or rejects
-- (→ 'Rejected' with a reason, notify the customer).
-- =========================================================================

-- ─── 1) Approve a request → open it for quotes ──────────────────────────────
create or replace function public.freight_approve_quote(p_quote_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_q public.freight_quotes;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve freight requests' using errcode='42501';
  end if;
  select * into v_q from public.freight_quotes where id = p_quote_id for update;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_q.status <> 'PendingReview' then
    raise exception 'This request is not pending review (status: %)', v_q.status;
  end if;

  update public.freight_quotes
     set status = 'Open', approved_by = auth.uid(), approved_at = now(),
         rejected_reason = '', updated_at = now()
   where id = p_quote_id;

  -- Notify the customer.
  perform public.queue_notification(
    cu.user_id, 'system', 'Freight request approved',
    v_q.title || ' is now open for quotes.',
    'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id)
  )
  from public.company_users cu
  where cu.company_id = v_q.customer_company_id and cu.status = 'Active';

  -- Notify eligible freight providers (forwarders + carriers).
  perform public.queue_notification(
    cu.user_id, 'system', 'New freight request to quote',
    v_q.title,
    'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id)
  )
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where c.type::text in ('FreightForwarder','GlobalFreightForwarder','Carrier')
    and cu.status = 'Active';

  -- If the customer wants container pickup, notify ground providers too.
  if v_q.needs_container_pickup then
    perform public.queue_notification(
      cu.user_id, 'system', 'New container pickup leg to quote',
      v_q.title,
      'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id, 'leg', 'ground')
    )
    from public.company_users cu
    join public.companies c on c.id = cu.company_id
    where c.type::text in ('TruckingCompany','DrayageCompany')
      and cu.status = 'Active';
  end if;

  perform public.write_audit('freight.quote_approved','freight_quotes', p_quote_id::text, null,
    jsonb_build_object('title', v_q.title), null, v_q.customer_company_id);
end;
$$;
grant execute on function public.freight_approve_quote(uuid) to authenticated;

-- ─── 2) Reject a request ────────────────────────────────────────────────────
create or replace function public.freight_reject_quote(p_quote_id uuid, p_reason text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_q public.freight_quotes;
begin
  if not public.is_admin() then
    raise exception 'Only admins can reject freight requests' using errcode='42501';
  end if;
  select * into v_q from public.freight_quotes where id = p_quote_id for update;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if v_q.status not in ('PendingReview','Open') then
    raise exception 'This request cannot be rejected (status: %)', v_q.status;
  end if;

  update public.freight_quotes
     set status = 'Rejected', rejected_reason = coalesce(trim(p_reason),''),
         approved_by = auth.uid(), updated_at = now()
   where id = p_quote_id;

  perform public.queue_notification(
    cu.user_id, 'system', 'Freight request needs changes',
    v_q.title || case when coalesce(trim(p_reason),'') <> '' then ' — ' || trim(p_reason) else '' end,
    'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id)
  )
  from public.company_users cu
  where cu.company_id = v_q.customer_company_id and cu.status = 'Active';

  perform public.write_audit('freight.quote_rejected','freight_quotes', p_quote_id::text, null,
    jsonb_build_object('reason', coalesce(trim(p_reason),'')), null, v_q.customer_company_id);
end;
$$;
grant execute on function public.freight_reject_quote(uuid, text) to authenticated;

-- ─── 3) Admin queue / list ──────────────────────────────────────────────────
create or replace function public.freight_admin_list(p_scope text default 'pending')
returns table (
  id uuid, reference_code text, title text, freight_mode text,
  origin_country text, origin_city text, dest_country text, dest_city text,
  weight numeric, weight_unit text, pieces int,
  commodity text, declared_value numeric, currency text,
  delivery_method text, needs_container_pickup boolean,
  status text, customer_name text, doc_count bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
  select q.id, q.reference_code, q.title, q.freight_mode,
         q.origin_country, q.origin_city, q.dest_country, q.dest_city,
         q.weight, q.weight_unit, q.pieces,
         q.commodity, q.declared_value, q.currency,
         q.delivery_method, q.needs_container_pickup,
         q.status, coalesce(c.name,'Company'),
         (select count(*) from public.freight_quote_documents d where d.quote_id = q.id),
         q.created_at
  from public.freight_quotes q
  left join public.companies c on c.id = q.customer_company_id
  where (p_scope = 'all' or q.status = 'PendingReview')
  order by
    case when q.status = 'PendingReview' then 0 else 1 end,
    q.created_at desc;
end;
$$;
grant execute on function public.freight_admin_list(text) to authenticated;

notify pgrst, 'reload schema';
