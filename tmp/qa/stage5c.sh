#!/bin/bash
. tmp/qa/api.sh
SHP=$(login test_shipper@rorkqa.com); DRY=$(login test_drayage@rorkqa.com); WH=$(login test_warehouse@rorkqa.com)
RNT=$(login test_rental@rorkqa.com); RPR=$(login test_repair@rorkqa.com); INS=$(login test_insurer@rorkqa.com); BUY=$(login test_buyer@rorkqa.com)
# ── Drayage order (shipper → targeted at test_drayage) ──
DO=$(rpc "$SHP" create_drayage_order '{"p_direction":"Import","p_container_number":"QAContainer1","p_container_size":"40ft","p_container_type":"DRY","p_bol_number":"BOL-QA","p_booking_number":"","p_commodity":"QA goods","p_weight_kg":1000,"p_is_hazmat":false,"p_is_overweight":false,"p_is_oversized":false,"p_origin_terminal_id":null,"p_destination_terminal_id":null,"p_warehouse_company_id":null,"p_pickup_address":"Port of Vancouver","p_pickup_city":"Vancouver","p_pickup_lat":49.29,"p_pickup_lng":-123.09,"p_delivery_address":"456 QA Ave","p_delivery_city":"Burnaby","p_delivery_lat":49.24,"p_delivery_lng":-122.97,"p_port_reservation_date":null,"p_port_reservation_time":"","p_is_prepull":false,"p_prepull_pickup_date":null,"p_prepull_yard_terminal_id":null,"p_notes":"QA","p_target_drayage_company_id":"8336c680-e465-44fd-928f-263fba365b71","p_handling_mode":"LiveUnload","p_pickup_back_date":null}')
echo "1. DRAYAGE ORDER: $(echo $DO | head -c 200)"
# drayage company sees it
echo "2. DRY SEES: $(rest "$DRY" GET "drayage_orders?select=id,status&order=created_at.desc&limit=1" | head -c 200)"
# ── Warehouse listing ──
WL=$(rest "$WH" POST "warehouse_listings" '{"company_id":"b3fdd8c3-d690-492c-9588-4c7e2be7a15a","name":"QA Warehouse","address":"789 QA Rd","city":"Vancouver","warehouse_type":"Dry","available_pallet_capacity":100,"min_pallets":1,"max_pallets":100,"storage_term":"Monthly","storage_rate_per_pallet":15,"status":"Draft"}')
WL_ID=$(echo "$WL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else '')" 2>/dev/null)
echo "3. WH LISTING=$WL_ID $(([ -z "$WL_ID" ]) && echo $WL | head -c 200)"
echo "4. SUBMIT: $(rpc "$WH" provider_submit_listing "{\"p_listing_id\":\"$WL_ID\"}" | head -c 120)"
# ── Marketplace service listings ──
for PAIR in "RNT:4f72eeca-ef15-48e8-982e-b530287ad062:EquipmentRental:QA Forklift Rental" "RPR:2426db47-f9e4-4bd9-92ba-92ded90cdd62:MobileRepair:QA Mobile Repair" "INS:f82e1361-928b-4c35-be48-bffe59d2af11:CargoInsurance:QA Cargo Insurance"; do
  TOKVAR=$(echo $PAIR | cut -d: -f1); CO=$(echo $PAIR | cut -d: -f2); ST=$(echo $PAIR | cut -d: -f3); TI=$(echo $PAIR | cut -d: -f4)
  TOK=$(eval echo \$$TOKVAR)
  SL=$(rest "$TOK" POST "service_listings" "{\"company_id\":\"$CO\",\"category\":\"Labour\",\"coverage_area\":[\"Vancouver\"],\"hourly_rate\":50,\"minimum_hours\":1,\"certifications\":\"\",\"status\":\"Draft\",\"service_type\":\"$ST\",\"title\":\"$TI\",\"description\":\"QA listing\"}")
  SL_ID=$(echo "$SL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else '')" 2>/dev/null)
  echo "5.$TOKVAR LISTING=$SL_ID $(([ -z "$SL_ID" ]) && echo $SL | head -c 180)"
done
# buyer browses Active marketplace
echo "6. BUYER BROWSE: $(rest "$BUY" GET "service_listings?status=eq.Active&select=title&limit=3" | head -c 200)"
# ── Agency adds worker to roster ──
AGY=$(login test_agency@rorkqa.com)
echo "7. AGENCY ADD: $(rpc "$AGY" agency_add_worker '{"p_name":"QA Roster Worker","p_email":"qa_roster@rorkqa.com","p_phone":"6045551234","p_skills":["General"]}' | head -c 200)"
