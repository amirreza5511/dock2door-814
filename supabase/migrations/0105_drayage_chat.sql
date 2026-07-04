-- 0105_drayage_chat.sql
-- Order-scoped messaging for the container-drayage world so the assigned driver
-- and the drayage company's dispatchers can talk to each other in-app about a
-- specific container order (pickup/drop-off coordination, port timing, etc.).
--
-- Mirrors open_load_thread (0088): a SECURITY DEFINER helper finds (or creates)
-- the single thread for a drayage order and makes sure every relevant party is a
-- participant (RLS only lets a caller add themselves, so we do it here).
--
-- Idempotent.

alter table public.chat_threads
  add column if not exists drayage_order_id uuid references public.drayage_orders(id) on delete set null;

create index if not exists idx_chat_threads_drayage_order on public.chat_threads(drayage_order_id);

create or replace function public.open_drayage_thread(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.drayage_orders;
  v_thread_id uuid;
  v_is_customer boolean;
  v_is_drayage  boolean;
  v_is_driver   boolean;
  v_subject   text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_order from public.drayage_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  -- Who is allowed into this conversation:
  --   the customer / forwarder who posted it, members of the drayage company
  --   that claimed it, any driver assigned to one of its moves, or an admin.
  v_is_customer := v_order.customer_user_id = auth.uid()
                   or public.is_member_of(v_order.customer_company_id);
  v_is_drayage  := public.is_member_of(v_order.drayage_company_id);
  v_is_driver   := exists (
    select 1 from public.drayage_moves m
    where m.order_id = p_order_id and m.driver_user_id = auth.uid()
  );

  if not (v_is_customer or v_is_drayage or v_is_driver or public.is_admin()) then
    raise exception 'Not authorized for this order' using errcode = '42501';
  end if;

  -- Reuse the existing thread for this order if one already exists.
  select id into v_thread_id
    from public.chat_threads
   where drayage_order_id = p_order_id
   order by created_at asc
   limit 1;

  v_subject := 'Order: ' || coalesce(nullif(v_order.reference_code, ''), 'Drayage');

  if v_thread_id is null then
    insert into public.chat_threads (scope, drayage_order_id, company_id, subject, created_by)
    values ('Direct', p_order_id, v_order.drayage_company_id, v_subject, auth.uid())
    returning id into v_thread_id;
  end if;

  -- Every driver assigned to a move on this order.
  insert into public.thread_participants (thread_id, user_id)
  select v_thread_id, m.driver_user_id
    from public.drayage_moves m
   where m.order_id = p_order_id and m.driver_user_id is not null
  on conflict (thread_id, user_id) do nothing;

  -- Every active member of the drayage company (dispatchers).
  if v_order.drayage_company_id is not null then
    insert into public.thread_participants (thread_id, user_id)
    select v_thread_id, cu.user_id
      from public.company_users cu
     where cu.company_id = v_order.drayage_company_id and cu.status = 'Active'
    on conflict (thread_id, user_id) do nothing;
  end if;

  -- The caller (covers the forwarder/customer who opens it, or a fresh dispatcher).
  insert into public.thread_participants (thread_id, user_id)
  values (v_thread_id, auth.uid())
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$$;

grant execute on function public.open_drayage_thread(uuid) to authenticated;
