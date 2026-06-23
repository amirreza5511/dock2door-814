-- 0075_thread_scope_support.sql
-- Fix: open_support_thread() (migration 0074) inserts chat_threads.scope = 'Support',
-- but the thread_scope enum (migration 0002) never included that value, so the call
-- fails at runtime with: invalid input value for enum thread_scope: "Support".
--
-- Add the missing value. ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block and the new value cannot be used in the same transaction, so this is kept
-- as its own statement in a dedicated migration.

alter type thread_scope add value if not exists 'Support';
