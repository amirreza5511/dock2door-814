-- 0016_message_notifs_stripe_dashboard.sql
-- 1) Push notification trigger for new chat messages (thread_messages)
-- 2) (Stripe Express dashboard link is handled by Edge Function stripe-connect-dashboard)
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Trigger: queue notifications for every thread participant (except sender)
-- on each new thread_messages row. The `push-notifications` Edge Function
-- dispatcher will pick these up (row in public.notifications with read_at IS NULL
-- and payload->>'delivered_at' IS NULL) and send them via Expo Push.
-- ---------------------------------------------------------------------------
create or replace function public.tg_notify_thread_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_thread public.chat_threads;
  v_title   text;
  v_body    text;
  v_preview text;
  r record;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if v_thread is null then
    return new;
  end if;

  select coalesce(nullif(trim(full_name), ''), 'New message')
    into v_sender_name
    from public.profiles where id = new.sender_user_id;
  v_sender_name := coalesce(v_sender_name, 'New message');

  v_preview := coalesce(new.body, '');
  if length(v_preview) > 140 then
    v_preview := substr(v_preview, 1, 137) || '...';
  end if;
  if v_preview = '' and jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > 0 then
    v_preview := '[attachment]';
  end if;

  v_title := v_sender_name;
  v_body  := v_preview;

  for r in
    select tp.user_id
      from public.thread_participants tp
     where tp.thread_id = new.thread_id
       and tp.user_id is distinct from new.sender_user_id
  loop
    -- respect notification_preferences.push_enabled (default true when no row)
    if coalesce(
         (select np.push_enabled
            from public.notification_preferences np
           where np.user_id = r.user_id),
         true
       ) then
      perform public.queue_notification(
        r.user_id,
        'thread_message',
        v_title,
        v_body,
        'chat_threads',
        new.thread_id::text,
        jsonb_build_object(
          'thread_id', new.thread_id,
          'message_id', new.id,
          'sender_user_id', new.sender_user_id,
          'sender_name', v_sender_name,
          'scope', v_thread.scope
        )
      );
    end if;
  end loop;

  -- bump thread updated_at so thread lists re-sort correctly
  update public.chat_threads set updated_at = now() where id = new.thread_id;

  return new;
end;
$$;

drop trigger if exists tr_notify_thread_message on public.thread_messages;
create trigger tr_notify_thread_message
  after insert on public.thread_messages
  for each row execute function public.tg_notify_thread_message();
