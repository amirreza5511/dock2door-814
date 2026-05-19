-- 0039_admin_platform_settings_rpc.sql
-- SECURITY DEFINER RPC for admin platform settings mutations.
-- Every change is captured in audit_logs (before + after) and requires is_admin().

create or replace function public.admin_update_platform_settings(
  p_warehouse_commission_percentage  numeric,
  p_service_commission_percentage    numeric,
  p_labour_commission_percentage     numeric,
  p_handling_fee_per_pallet_default  numeric,
  p_tax_mode                         text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  perform public.require_admin();

  select id into v_id from public.platform_settings limit 1;
  if v_id is null then
    raise exception 'platform_settings row not found' using errcode = 'P0002';
  end if;

  select to_jsonb(p.*) into v_before from public.platform_settings p where id = v_id;

  update public.platform_settings set
    warehouse_commission_percentage  = p_warehouse_commission_percentage,
    service_commission_percentage    = p_service_commission_percentage,
    labour_commission_percentage     = p_labour_commission_percentage,
    handling_fee_per_pallet_default  = p_handling_fee_per_pallet_default,
    tax_mode                         = p_tax_mode,
    updated_at                       = now()
  where id = v_id;

  select to_jsonb(p.*) into v_after from public.platform_settings p where id = v_id;

  perform public.write_audit(
    'platform_settings.update',
    'platform_settings',
    v_id::text,
    v_before,
    v_after
  );
end;
$$;

grant execute on function public.admin_update_platform_settings(numeric, numeric, numeric, numeric, text) to authenticated;
