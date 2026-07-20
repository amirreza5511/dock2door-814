#!/bin/bash
. tmp/qa/api.sh
EMP=$(login test_employer@rorkqa.com); WRK=$(login test_worker@rorkqa.com)
TODAY=$(date -d "+2 days" +%F)
WORKER_ID="36aaf593-0e32-45e9-9ce3-8034d9c427c8"
# new shift for invitation tests
S2=$(rest "$EMP" POST "shift_posts" "{\"employer_company_id\":\"2b742e61-e493-4c6a-bcfb-09fe823d7f1a\",\"title\":\"QA Invite Shift\",\"category\":\"General\",\"skills\":[\"General\"],\"is_ongoing\":false,\"location_address\":\"123 Test St\",\"location_city\":\"Vancouver\",\"date\":\"$TODAY\",\"start_time\":\"09:00\",\"end_time\":\"17:00\",\"hourly_rate\":28,\"minimum_hours\":4,\"workers_needed\":2,\"requirements\":\"\",\"notes\":\"QA invite\",\"status\":\"Posted\"}")
S2_ID=$(echo "$S2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) else '')" 2>/dev/null)
echo "1. SHIFT2=$S2_ID"
INV=$(rpc "$EMP" employer_invite_worker "{\"p_shift_id\":\"$S2_ID\",\"p_worker_user_id\":\"$WORKER_ID\",\"p_message\":\"QA invitation\"}")
echo "2. INVITE: $INV"
INV_ID=$(echo "$INV" | tr -d '"')
echo "3. ACCEPT_INVITE: $(rpc "$WRK" worker_respond_invitation "{\"p_invitation_id\":\"$INV_ID\",\"p_accept\":true}")"
echo "4. ASSIGNMENT NOW: $(rest "$WRK" GET "shift_assignments?shift_id=eq.$S2_ID&select=id,status,worker_confirmed")"
# apply + withdraw test on a third shift
TODAY3=$(date -d "+3 days" +%F)
S3=$(rest "$EMP" POST "shift_posts" "{\"employer_company_id\":\"2b742e61-e493-4c6a-bcfb-09fe823d7f1a\",\"title\":\"QA Withdraw Shift\",\"category\":\"General\",\"skills\":[\"General\"],\"is_ongoing\":false,\"location_address\":\"123 Test St\",\"location_city\":\"Vancouver\",\"date\":\"$TODAY3\",\"start_time\":\"09:00\",\"end_time\":\"17:00\",\"hourly_rate\":22,\"minimum_hours\":4,\"workers_needed\":1,\"requirements\":\"\",\"notes\":\"\",\"status\":\"Posted\"}")
S3_ID=$(echo "$S3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) else '')" 2>/dev/null)
A3=$(rpc "$WRK" worker_apply_shift "{\"p_shift_id\":\"$S3_ID\"}" | tr -d '"')
echo "5. APPLY3=$A3"
echo "6. WITHDRAW: $(rpc "$WRK" worker_withdraw_shift "{\"p_application_id\":\"$A3\"}")"
# re-apply then employer rejects
A4=$(rpc "$WRK" worker_apply_shift "{\"p_shift_id\":\"$S3_ID\"}" | tr -d '"')
echo "7. REAPPLY=$A4"
echo "8. REJECT: $(rpc "$EMP" employer_reject_applicant "{\"p_application_id\":\"$A4\",\"p_reason\":\"QA reject test\"}")"
echo "9. APP STATUSES: $(rest "$WRK" GET "shift_applications?shift_id=eq.$S3_ID&select=id,status,rejection_reason")"
# worker notifications check
echo "10. WORKER NOTIFS: $(rest "$WRK" GET "notifications?select=kind,title&order=created_at.desc&limit=5")"
