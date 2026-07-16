-- ===========================================================================
-- 0152 — Admins can edit a company's active customizations directly
--
-- decide_customization_request already applies approved payloads. This adds a
-- direct editor so platform admins can set a company's active settings without
-- a pending request (e.g. fix a term, hide a module on request over the phone).
-- Same merge semantics as approval: hiddenModules/customFields/sectionOrder are
-- replaced when present; defaults/terminology shallow-merged. Additive + safe.
-- ===========================================================================

create or replace function public.admin_set_company_customizations(
  p_company_id uuid,
  p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_settings jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_company_id is null then raise exception 'company id is required'; end if;

  select coalesce(settings, '{}'::jsonb) into v_settings
  from public.company_customizations where company_id = p_company_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  if p_payload ? 'hiddenModules' then
    v_settings := jsonb_set(v_settings, '{hiddenModules}', coalesce(p_payload->'hiddenModules', '[]'::jsonb));
  end if;
  if p_payload ? 'customFields' then
    v_settings := jsonb_set(v_settings, '{customFields}', coalesce(p_payload->'customFields', '[]'::jsonb));
  end if;
  if p_payload ? 'sectionOrder' then
    v_settings := jsonb_set(v_settings, '{sectionOrder}', coalesce(p_payload->'sectionOrder', '[]'::jsonb));
  end if;
  if p_payload ? 'defaults' then
    v_settings := jsonb_set(v_settings, '{defaults}',
      coalesce(v_settings->'defaults', '{}'::jsonb) || coalesce(p_payload->'defaults', '{}'::jsonb));
  end if;
  if p_payload ? 'terminology' then
    v_settings := jsonb_set(v_settings, '{terminology}',
      coalesce(v_settings->'terminology', '{}'::jsonb) || coalesce(p_payload->'terminology', '{}'::jsonb));
  end if;

  insert into public.company_customizations (company_id, settings, updated_at)
  values (p_company_id, v_settings, now())
  on conflict (company_id) do update
    set settings = excluded.settings, updated_at = now();

  perform public.write_audit('customization_admin_edit', 'company_customizations', p_company_id::text, null,
    jsonb_build_object('company', p_company_id, 'keys', (select jsonb_agg(k) from jsonb_object_keys(p_payload) k)), '');

  return v_settings;
end; $$;

grant execute on function public.admin_set_company_customizations(uuid, jsonb) to authenticated;

-- Read a specific company's active settings (admins only) for the direct editor.
create or replace function public.admin_get_company_customizations(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return coalesce((select settings from public.company_customizations where company_id = p_company_id), '{}'::jsonb);
end; $$;

grant execute on function public.admin_get_company_customizations(uuid) to authenticated;
