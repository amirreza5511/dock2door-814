#!/bin/bash
. tmp/qa/api.sh
SHP=$(login test_shipper@rorkqa.com); DRY=$(login test_drayage@rorkqa.com)
echo "5. PROVIDERS: $(rpc "$SHP" ai_list_provider_companies '{"p_types":["DrayageCompany"]}' | head -c 250)"
FWD=$(rpc "$SHP" ai_forward_intake '{"p_target_company_id":"8336c680-e465-44fd-928f-263fba365b71","p_subject":"QA drayage request","p_body":"QA: need a container moved from port to Burnaby"}')
echo "6. FORWARD: $(echo $FWD | head -c 200)"
TH_ID=$(echo "$FWD" | tr -d '"')
echo "7. DRAYAGE READS: $(rest "$DRY" GET "thread_messages?thread_id=eq.$TH_ID&select=body&limit=1" | head -c 200)"
# ai events log + watchdog
WRK=$(login test_worker@rorkqa.com)
echo "8. LOG EVENT: $(rpc "$WRK" ai_log_event '{"p_kind":"qa_test","p_title":"QA event","p_body":"testing","p_severity":"info"}' | head -c 150)"
echo "9. WATCHDOG: $(rpc "$WRK" ai_maybe_run_watchdog '{}' | head -c 150)"
