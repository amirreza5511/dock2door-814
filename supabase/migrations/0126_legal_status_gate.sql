-- =========================================================================
-- 0126 — Legal gate: let a signed-in user check which legal documents they
--         have already accepted, so the app can force existing users (who
--         registered before Terms/NDA acceptance was required) to sign before
--         continuing. Idempotent & safe to run multiple times.
-- =========================================================================

create or replace function public.my_legal_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_terms jsonb;
  v_nda jsonb;
begin
  if v_me is null then
    return jsonb_build_object('terms', null, 'nda', null);
  end if;

  select to_jsonb(la.*) into v_terms
    from public.legal_acceptances la
    where la.user_id = v_me and la.doc_type = 'terms'
    limit 1;

  select to_jsonb(la.*) into v_nda
    from public.legal_acceptances la
    where la.user_id = v_me and la.doc_type = 'nda'
    limit 1;

  return jsonb_build_object('terms', v_terms, 'nda', v_nda);
end;
$$;

grant execute on function public.my_legal_status() to authenticated;

notify pgrst, 'reload schema';
