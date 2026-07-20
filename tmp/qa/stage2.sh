#!/bin/bash
. tmp/qa/api.sh
EMP=$(login test_employer@rorkqa.com); WRK=$(login test_worker@rorkqa.com)
TODAY=$(date +%F)
SHIFT=$(rest "$EMP" POST "shift_posts" "{\"employer_company_id\":\"2b742e61-e493-4c6a-bcfb-09fe823d7f1a\",\"title\":\"QA Test Shift\",\"category\":\"General\",\"skills\":[\"General\"],\"is_ongoing\":false,\"location_address\":\"123 Test St\",\"location_city\":\"Vancouver\",\"date\":\"$TODAY\",\"start_time\":\"00:30\",\"end_time\":\"23:30\",\"hourly_rate\":25,\"minimum_hours\":4,\"workers_needed\":2,\"requirements\":\"\",\"notes\":\"QA\",\"status\":\"Posted\"}")
SHIFT_ID=$(echo "$SHIFT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) else '')" 2>/dev/null)
echo "1. SHIFT_ID=$SHIFT_ID"
[ -z "$SHIFT_ID" ] && echo "$SHIFT" && exit 1
APP_ID=$(rpc "$WRK" worker_apply_shift "{\"p_shift_id\":\"$SHIFT_ID\"}" | tr -d '"')
echo "2. APPLICATION=$APP_ID"
ASSIGN=$(rpc "$EMP" employer_accept_applicant "{\"p_application_id\":\"$APP_ID\",\"p_rate\":25}" | tr -d '"')
echo "3. ASSIGNMENT=$ASSIGN"
echo "4. CONFIRM_ATTENDANCE: $(rpc "$WRK" worker_confirm_attendance "{\"p_assignment_id\":\"$ASSIGN\",\"p_confirmed\":true,\"p_reason\":null}")"
echo "5. CLOCK_IN: $(rpc "$WRK" worker_clock_in "{\"p_assignment_id\":\"$ASSIGN\",\"p_lat\":49.2827,\"p_lng\":-123.1207,\"p_accuracy\":10}")"
sleep 2
echo "6. CLOCK_OUT: $(rpc "$WRK" worker_clock_out "{\"p_assignment_id\":\"$ASSIGN\",\"p_lat\":49.2827,\"p_lng\":-123.1207}")"
TE=$(rest "$EMP" GET "time_entries?assignment_id=eq.$ASSIGN&select=id")
TE_ID=$(echo "$TE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)
echo "7. TIME_ENTRY=$TE_ID"
echo "8. CONFIRM_HOURS: $(rpc "$EMP" employer_confirm_hours "{\"p_time_entry_id\":\"$TE_ID\",\"p_hours\":4,\"p_notes\":\"QA confirmed\"}")"
echo "9. FINAL ASSIGNMENT: $(rest "$WRK" GET "shift_assignments?id=eq.$ASSIGN&select=status,confirmed_rate,worker_confirmed")"
echo "$SHIFT_ID" > tmp/qa/shift_id.txt; echo "$ASSIGN" > tmp/qa/assign_id.txt
