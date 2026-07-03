-- Dock2Door — Auto-generate racking locations from declared capacity
-- A warehouse provider declares "I have 500 pallet positions" on their listing
-- (warehouse_listings.available_pallet_capacity). Operators should NOT have to
-- hand-create 500 shelf locations. This migration generates a full, structured
-- racking layout automatically from that number, one pallet per slot.
--
-- Layout math (human-friendly, warehouse-realistic codes like A-03-02-1):
--   * 4 levels per rack, 10 racks per aisle => 40 slots per aisle
--   * aisles roll up under zone letters (A, B, C, ...), 5 aisles per zone
--   * ground level (level 1) accepts oversize / over-standard pallets
-- Idempotent: only creates the slots that are still missing (by unique code),
-- so re-running (or increasing capacity later) tops up without duplicating.

create or replace function public.wms_generate_locations(
  p_listing_id uuid,
  p_count int default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.warehouse_listings;
  v_target int;
  v_created int := 0;
  v_i int;
  v_zone_idx int;
  v_aisle_in_zone int;
  v_rack int;
  v_level int;
  v_slot_in_aisle int;
  v_aisle_global int;
  v_zone text;
  v_code text;
  v_oversize boolean;
  c_levels_per_rack constant int := 4;
  c_racks_per_aisle constant int := 10;
  c_aisles_per_zone constant int := 5;
  c_slots_per_aisle constant int := 40;   -- levels_per_rack * racks_per_aisle
begin
  select * into v_listing from public.warehouse_listings where id = p_listing_id;
  if v_listing.id is null then raise exception 'Listing not found'; end if;
  if not (public.is_member_of(v_listing.company_id) or public.is_admin()) then
    raise exception 'Not authorized for this warehouse';
  end if;

  v_target := greatest(coalesce(p_count, v_listing.available_pallet_capacity, 0), 0);
  if v_target <= 0 then return 0; end if;
  -- Safety cap so a typo can't create millions of rows.
  v_target := least(v_target, 5000);

  for v_i in 0 .. (v_target - 1) loop
    v_aisle_global   := v_i / c_slots_per_aisle;                 -- 0-based aisle
    v_slot_in_aisle  := v_i % c_slots_per_aisle;                 -- 0..39
    v_rack           := (v_slot_in_aisle / c_levels_per_rack);   -- 0..9
    v_level          := (v_slot_in_aisle % c_levels_per_rack);   -- 0..3
    v_zone_idx       := v_aisle_global / c_aisles_per_zone;      -- 0-based zone
    v_aisle_in_zone  := v_aisle_global % c_aisles_per_zone;      -- 0..4

    v_zone  := chr(65 + (v_zone_idx % 26));                      -- A, B, C ...
    v_oversize := (v_level = 0);                                 -- ground level

    v_code := format('%s-%02s-%02s-%s',
      v_zone,
      (v_aisle_in_zone + 1)::text,
      (v_rack + 1)::text,
      (v_level + 1)::text);

    insert into public.warehouse_locations (
      warehouse_company_id, listing_id, code, zone, aisle, rack, level, bin,
      kind, pallet_capacity, accepts_oversize
    ) values (
      v_listing.company_id, p_listing_id, v_code, v_zone,
      lpad((v_aisle_in_zone + 1)::text, 2, '0'),
      lpad((v_rack + 1)::text, 2, '0'),
      (v_level + 1)::text, '',
      'storage', 1, v_oversize
    )
    on conflict (warehouse_company_id, code) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  return v_created;
end; $$;
grant execute on function public.wms_generate_locations(uuid, int) to authenticated;
