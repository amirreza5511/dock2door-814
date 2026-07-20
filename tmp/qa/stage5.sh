#!/bin/bash
. tmp/qa/api.sh
CUST=$(login test_customer@rorkqa.com); BRK=$(login test_broker@rorkqa.com); SHP=$(login test_shipper@rorkqa.com)
# ── Customs clearance flow ──
CR=$(rpc "$CUST" clearance_create_request '{"p_title":"QA clearance","p_mode":"Import","p_container_no":"TEST1234567","p_bl_number":"BL-QA-1","p_port":"Vancouver","p_eta":null,"p_cargo_description":"QA cargo","p_commercial_value":10000,"p_currency":"CAD","p_incoterms":"FOB","p_notes":"QA"}' | tr -d '"')
echo "1. CLEARANCE_REQ=$CR"
echo "2. BROKER LIST: $(rpc "$BRK" broker_list_requests '{}' | head -c 200)"
echo "3. BROKER CLAIM: $(rpc "$BRK" broker_claim_request "{\"p_request_id\":\"$CR\"}" | head -c 150)"
echo "4. BROKER QUOTE: $(rpc "$BRK" broker_quote "{\"p_request_id\":\"$CR\",\"p_amount\":450,\"p_notes\":\"QA quote\"}" | head -c 150)"
echo "5. CUSTOMER ACCEPT: $(rpc "$CUST" clearance_accept_quote "{\"p_request_id\":\"$CR\"}" | head -c 150)"
echo "6. STATUS: $(rest "$CUST" GET "clearance_requests?id=eq.$CR&select=status,quote_amount" | head -c 200)"
