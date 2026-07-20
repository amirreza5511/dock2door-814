#!/bin/bash
. tmp/qa/api.sh
EMP=$(login test_employer@rorkqa.com); WRK=$(login test_worker@rorkqa.com); SA=$(login test_superadmin@rorkqa.com)
WRK_ID="36aaf593-0e32-45e9-9ce3-8034d9c427c8"
# 1) open shift thread on the ACTIVE (Scheduled) invite shift
TH=$(rpc "$WRK" open_shift_thread '{"p_shift_id":"005b303a-908c-4e4f-ab3d-942745316d96"}' | tr -d '"')
echo "1. THREAD=$TH"
# 2) worker sends message (same insert the app does)
MSG=$(rest "$WRK" POST "thread_messages" "{\"thread_id\":\"$TH\",\"sender_user_id\":\"$WRK_ID\",\"body\":\"QA message from worker\",\"attachments\":[]}")
echo "2. SEND: $(echo $MSG | head -c 200)"
# 3) employer reads it
echo "3. EMP READS: $(rest "$EMP" GET "thread_messages?thread_id=eq.$TH&select=body&order=created_at.desc&limit=1")"
# 4) stranger (customer) must NOT read it
CUST=$(login test_customer@rorkqa.com)
echo "4. STRANGER READS (expect []): $(rest "$CUST" GET "thread_messages?thread_id=eq.$TH&select=body")"
# 5) support ticket
TK=$(rpc "$WRK" create_support_ticket '{"p_subject":"QA ticket from worker","p_summary":"Testing the ticket flow end to end"}')
echo "5. TICKET: $(echo $TK | head -c 200)"
TK_ID=$(echo "$TK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ticketId',''))" 2>/dev/null)
# 6) superadmin sees all tickets
echo "6. SA LIST: $(rpc "$SA" list_support_tickets '{"p_scope":"all"}' | head -c 300)"
# 7) employer with scope=all must NOT see it (only own)
echo "7. EMP scope=all: $(rpc "$EMP" list_support_tickets '{"p_scope":"all"}' | head -c 200)"
# 8) superadmin sets status
echo "8. SET STATUS: $(rpc "$SA" set_support_ticket_status "{\"p_id\":\"$TK_ID\",\"p_status\":\"resolved\"}")"
echo "9. TICKET NOW: $(rest "$WRK" GET "support_tickets?id=eq.$TK_ID&select=status,subject")"
