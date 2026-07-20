#!/bin/bash
. tmp/qa/api.sh
CUST=$(login test_customer@rorkqa.com); BRK=$(login test_broker@rorkqa.com)
CR="c5d1dc01-6a0d-4af8-8080-3d53b33cb32c"
echo "1. BROKER LIST mine: $(rpc "$BRK" broker_list_requests '{"p_scope":"mine"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d),'rows; first status:',d[0]['status'] if d else '-')")"
echo "2. QUOTE: $(rpc "$BRK" broker_quote "{\"p_request_id\":\"$CR\",\"p_amount\":450,\"p_note\":\"QA quote\"}" | head -c 120)"
echo "3. ACCEPT: $(rpc "$CUST" clearance_accept_quote "{\"p_request_id\":\"$CR\"}" | head -c 120)"
echo "4. STATUS: $(rest "$CUST" GET "clearance_requests?id=eq.$CR&select=status,quote_amount")"
echo "5. CLR MSG: $(rpc "$CUST" clearance_send_message "{\"p_request_id\":\"$CR\",\"p_body\":\"QA message on clearance\"}" | head -c 120)"
echo "6. BROKER READS MSG: $(rest "$BRK" GET "clearance_messages?request_id=eq.$CR&select=body&limit=1" | head -c 150)"
