#!/bin/bash
. tmp/qa/api.sh
WRK=$(login test_worker@rorkqa.com); EMP=$(login test_employer@rorkqa.com); SHP=$(login test_shipper@rorkqa.com)
WRK_ID="36aaf593-0e32-45e9-9ce3-8034d9c427c8"
# 1) ai-chat edge function as authenticated user
CHAT=$(curl -s -X POST "$BASE/functions/v1/ai-chat" -H "Authorization: Bearer $WRK" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Reply with exactly: QA-OK"}]}')
echo "1. AI-CHAT: $(echo $CHAT | head -c 200)"
# 2) chat history write/read (same as app)
INS=$(rest "$WRK" POST "ai_chat_messages" "{\"user_id\":\"$WRK_ID\",\"role\":\"user\",\"content\":\"QA history message\"}")
echo "2. HISTORY WRITE: $(echo $INS | head -c 120)"
# 3) another user must NOT see it
echo "3. EMP READS WRK HISTORY (expect []): $(rest "$EMP" GET "ai_chat_messages?user_id=eq.$WRK_ID&select=content")"
# 4) forging user_id must fail
FORGE=$(rest "$EMP" POST "ai_chat_messages" "{\"user_id\":\"$WRK_ID\",\"role\":\"user\",\"content\":\"forged\"}")
echo "4. FORGE INSERT (expect error): $(echo $FORGE | head -c 150)"
# 5) ai_list_provider_companies (used by forward intake action)
echo "5. PROVIDERS: $(rpc "$SHP" ai_list_provider_companies '{"p_type":"DrayageCompany"}' | head -c 250)"
# 6) ai_forward_intake — shipper forwards a request to drayage company
FWD=$(rpc "$SHP" ai_forward_intake '{"p_company_id":"8336c680-e465-44fd-928f-263fba365b71","p_summary":"QA: need a container moved from port to Burnaby"}')
echo "6. FORWARD: $(echo $FWD | head -c 200)"
# 7) drayage company sees the thread message
DRY=$(login test_drayage@rorkqa.com)
TH_ID=$(echo "$FWD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('threadId','') if isinstance(d,dict) else (d if isinstance(d,str) else ''))" 2>/dev/null | tr -d '"')
echo "7. DRAYAGE READS: $(rest "$DRY" GET "thread_messages?thread_id=eq.$TH_ID&select=body&limit=1" | head -c 200)"
# 8) ai memories isolation
rest "$WRK" POST "ai_memories" "{\"user_id\":\"$WRK_ID\",\"content\":\"QA memory\"}" >/dev/null 2>&1
echo "8. EMP READS WRK MEMORIES (expect []): $(rest "$EMP" GET "ai_memories?user_id=eq.$WRK_ID&select=content")"
