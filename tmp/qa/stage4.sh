#!/bin/bash
. tmp/qa/api.sh
# 1) ai_copilot_context for every role
for E in test_worker test_employer test_trucking test_driver test_warehouse test_forwarder test_broker test_insurer test_rental test_repair test_service test_buyer test_salesagent test_gatestaff test_customer test_shipper test_drayage test_agency test_guest test_superadmin; do
  T=$(login $E@rorkqa.com)
  if [ -z "$T" ]; then echo "$E: LOGIN FAILED"; continue; fi
  R=$(rpc "$T" ai_copilot_context '{}')
  OK=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok role='+str(d.get('role')) if isinstance(d,dict) else 'ERR '+str(d)[:120])" 2>/dev/null || echo "PARSE_ERR: $(echo $R | head -c 150)")
  echo "$E: $OK"
done
