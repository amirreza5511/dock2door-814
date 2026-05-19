-- 0040_chat_preview_notify_fix.sql
-- 1. Add last_message_preview column to chat_threads (used by thread-list UI to
--    avoid fetching all messages per thread on page load).
-- 2. Re-create tg_notify_thread_message to:
--    a) Write last_message_preview on the chat_threads row (new)
--    b) Use profiles.name, not profiles.full_name (was broken in 0016; 0029 fixed
--       the function body, but this migration re-applies it idempotently so the
--       fix is guaranteed regardless of partial-apply history).
-- Idempotent.

alter table public.chat_threads
  add column if not exists last_message_preview text;

create or replace function public.tg_notify_thread_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_thread      public.chat_threads;
  v_preview     text;
  r             record;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if v_thread is null then
    return new;
  end if;

  -- Use profiles.name (profiles.full_name does not exist — see 0029 fix note)
  select coalesce(nullif(trim(name), ''), 'New message')
    into v_sender_name
    from public.profiles
   where id = new.sender_user_id;
  v_sender_name := coalesce(v_sender_name, 'New message');

  v_preview := coalesce(new.body, '');
  if length(v_preview) > 140 then
    v_preview := substr(v_preview, 1, 137) || '...';
  end if;
  if v_preview = '' and jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > 0 then
    v_preview := '[attachment]';
  end if;

  -- Update thread metadata (updated_at + preview) so the thread list can show
  -- the last message without fetching all thread_messages rows.
  update public.chat_threads
     set last_message_preview = v_preview,
         updated_at            = now()
   where id = new.thread_id;

  -- Queue push notifications for all participants except the sender.
  for r in
    select tp.user_id
      from public.thread_participants tp
     where tp.thread_id = new.thread_id
       and tp.user_id is distinct from new.sender_user_id
  loop
    if coalesce(
         (select np.push_enabled
            from public.notification_preferences np
           where np.user_id = r.user_id),
         true
       ) then
      perform public.queue_notification(
        r.user_id,
        'thread_message',
        v_sender_name,
        v_preview,
        'chat_threads',
        new.thread_id::text,
        jsonb_build_object(
          'thread_id',       new.thread_id,
          'message_id',      new.id,
          'sender_user_id',  new.sender_user_id,
          'sender_name',     v_sender_name,
          'scope',           v_thread.scope
        )
      );
    end if;
  end loop;

  return new;
end; $$;

-- Re-attach the trigger (drop-and-recreate is idempotent).
drop trigger if exists tr_notify_thread_message on public.thread_messages;
create trigger tr_notify_thread_message
  after insert on public.thread_messages
  for each row execute function public.tg_notify_thread_message();
