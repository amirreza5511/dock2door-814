-- =========================================================================
-- 0171 — Global Freight: accept offers (freight + ground) + shared chat.
-- Idempotent & additive. Safe to run multiple times.
--
-- The customer can accept ONE freight offer and (independently) ONE ground
-- offer. Accepting rejects the other pending offers of the SAME kind and
-- awards that leg. A shared chat opens between the customer and the awarded
-- provider(s) for coordination.
-- =========================================================================

-- ─── 1) Accept an offer (freight or ground leg) ─────────────────────────────
create or replace function public.freight_accept_offer(p_offer_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_off public.freight_quote_offers;
  v_q public.freight_quotes;
  v_cust_name text;
begin
  select * into v_off from public.freight_quote_offers where id = p_offer_id for update;
  if v_off is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  select * into v_q from public.freight_quotes where id = v_off.quote_id for update;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_q.customer_company_id) then
    raise exception 'Only the requesting company can accept an offer' using errcode='42501';
  end if;
  if v_off.status <> 'Pending' then
    raise exception 'This offer is no longer available (status: %)', v_off.status;
  end if;

  if v_off.offer_kind = 'freight' then
    if v_q.status not in ('Open','Quoted') then
      raise exception 'The freight leg is no longer open (status: %)', v_q.status;
    end if;
  else
    if v_q.status not in ('Open','Quoted','Accepted') then
      raise exception 'This request is no longer open (status: %)', v_q.status;
    end if;
  end if;

  -- Accept this offer; reject remaining pending offers of the SAME kind.
  update public.freight_quote_offers set status = 'Accepted', updated_at = now() where id = p_offer_id;
  update public.freight_quote_offers
     set status = 'Rejected', updated_at = now()
   where quote_id = v_q.id and offer_kind = v_off.offer_kind and id <> p_offer_id and status = 'Pending';

  if v_off.offer_kind = 'freight' then
    update public.freight_quotes
       set status = 'Accepted', awarded_offer_id = p_offer_id,
           awarded_company_id = v_off.provider_company_id, awarded_amount = v_off.amount,
           booked_at = now(), updated_at = now()
     where id = v_q.id;
  else
    update public.freight_quotes
       set ground_awarded_offer_id = p_offer_id,
           ground_awarded_company_id = v_off.provider_company_id,
           ground_awarded_amount = v_off.amount, updated_at = now()
     where id = v_q.id;
  end if;

  select name into v_cust_name from public.companies where id = v_q.customer_company_id;
  perform public.queue_notification(
    cu.user_id, 'system',
    case when v_off.offer_kind = 'ground' then 'Your pickup quote was accepted' else 'Your freight quote was accepted' end,
    coalesce(v_cust_name,'The customer') || ' booked your offer for: ' || v_q.title,
    'freight_quotes', v_q.id::text, jsonb_build_object('quote_id', v_q.id, 'kind', v_off.offer_kind)
  )
  from public.company_users cu
  where cu.company_id = v_off.provider_company_id and cu.status = 'Active';

  perform public.write_audit('freight.offer_accepted','freight_quotes', v_q.id::text, null,
    jsonb_build_object('offer_id', p_offer_id, 'kind', v_off.offer_kind, 'amount', v_off.amount), null, v_q.customer_company_id);
end;
$$;
grant execute on function public.freight_accept_offer(uuid) to authenticated;

-- ─── 2) Customer cancels an open request ────────────────────────────────────
create or replace function public.freight_cancel_quote(p_quote_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_q public.freight_quotes;
begin
  select * into v_q from public.freight_quotes where id = p_quote_id for update;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_member_of(v_q.customer_company_id) then
    raise exception 'Only the requesting company can cancel' using errcode='42501';
  end if;
  if v_q.status in ('Cancelled','Rejected') then
    raise exception 'This request is already closed (status: %)', v_q.status;
  end if;
  update public.freight_quotes set status = 'Cancelled', updated_at = now() where id = p_quote_id;
  update public.freight_quote_offers set status = 'Rejected', updated_at = now()
   where quote_id = p_quote_id and status = 'Pending';
end;
$$;
grant execute on function public.freight_cancel_quote(uuid) to authenticated;

-- ─── 3) Shared chat ─────────────────────────────────────────────────────────
create or replace function public.freight_send_message(p_quote_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_q public.freight_quotes;
  v_id uuid;
  v_name text;
  v_is_customer boolean;
begin
  select * into v_q from public.freight_quotes where id = p_quote_id;
  if v_q is null then raise exception 'Request not found' using errcode='P0002'; end if;
  if not public.is_freight_party(p_quote_id) then
    raise exception 'You are not part of this shipment' using errcode='42501';
  end if;
  if coalesce(trim(p_body),'') = '' then
    raise exception 'Message cannot be empty';
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.freight_quote_messages (quote_id, sender_user_id, sender_name, body)
  values (p_quote_id, auth.uid(), coalesce(v_name,''), trim(p_body))
  returning id into v_id;

  v_is_customer := public.is_member_of(v_q.customer_company_id);
  if v_is_customer then
    -- Notify awarded providers (freight + ground).
    perform public.queue_notification(
      cu.user_id, 'system', 'New freight message',
      coalesce(v_name,'The customer') || ': ' || left(trim(p_body), 120),
      'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id)
    )
    from public.company_users cu
    where cu.status = 'Active'
      and cu.company_id in (v_q.awarded_company_id, v_q.ground_awarded_company_id)
      and cu.company_id is not null;
  else
    -- A provider messaged → notify the customer.
    perform public.queue_notification(
      cu.user_id, 'system', 'New freight message',
      coalesce(v_name,'A provider') || ': ' || left(trim(p_body), 120),
      'freight_quotes', p_quote_id::text, jsonb_build_object('quote_id', p_quote_id)
    )
    from public.company_users cu
    where cu.company_id = v_q.customer_company_id and cu.status = 'Active';
  end if;

  return v_id;
end;
$$;
grant execute on function public.freight_send_message(uuid, text) to authenticated;

notify pgrst, 'reload schema';
