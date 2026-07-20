#!/bin/bash
. tmp/qa/api.sh
RNT=$(login test_rental@rorkqa.com); RPR=$(login test_repair@rorkqa.com); INS=$(login test_insurer@rorkqa.com); BUY=$(login test_buyer@rorkqa.com); AGY=$(login test_agency@rorkqa.com); SA=$(login test_superadmin@rorkqa.com)
declare -A CO=( [RNT]="4f72eeca-ef15-48e8-982e-b530287ad062" [RPR]="2426db47-f9e4-4bd9-92ba-92ded90cdd62" [INS]="f82e1361-928b-4c35-be48-bffe59d2af11" )
declare -A ST=( [RNT]="equipment_rental" [RPR]="mobile_repair" [INS]="cargo_insurance" )
declare -A TI=( [RNT]="QA Forklift Rental" [RPR]="QA Mobile Repair" [INS]="QA Cargo Insurance" )
for K in RNT RPR INS; do
  TOK=$(eval echo \$$K)
  SL=$(rest "$TOK" POST "service_listings" "{\"company_id\":\"${CO[$K]}\",\"category\":\"Labour\",\"coverage_area\":[\"Vancouver\"],\"hourly_rate\":50,\"minimum_hours\":1,\"certifications\":\"\",\"status\":\"Draft\",\"service_type\":\"${ST[$K]}\",\"title\":\"${TI[$K]}\",\"description\":\"QA listing\"}")
  SL_ID=$(echo "$SL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else '')" 2>/dev/null)
  echo "$K LISTING=$SL_ID $(([ -z "$SL_ID" ]) && echo $SL | head -c 180)"
  if [ -n "$SL_ID" ]; then
    echo "  SUBMIT: $(rpc "$TOK" provider_submit_service_listing "{\"p_listing_id\":\"$SL_ID\"}" | head -c 100)"
    echo "  ADMIN APPROVE: $(rpc "$SA" admin_set_service_listing_status "{\"p_listing_id\":\"$SL_ID\",\"p_status\":\"Active\",\"p_reason\":\"QA approve\"}" | head -c 120)"
  fi
done
echo "BUYER BROWSE: $(rest "$BUY" GET "service_listings?status=eq.Active&select=title,service_type&order=created_at.desc&limit=5" | head -c 300)"
echo "AGENCY ADD: $(rpc "$AGY" agency_add_worker '{"p_name":"QA Roster Worker","p_email":"qa_roster@rorkqa.com","p_phone":"6045551234","p_hourly_cost":22}' | head -c 150)"
