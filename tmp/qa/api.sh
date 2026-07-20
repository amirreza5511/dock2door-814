#!/bin/bash
# QA harness: login as a test user, call RPCs / REST exactly like the app does.
export ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5YXJnemNpeXd1cWhsY2Fvcnd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDkzOTUsImV4cCI6MjA5MjMyNTM5NX0.UkDNFFDL9dmNj_C4RrFaQU0YcMRoag9EAr1QSIZuvsk"
export BASE="https://hyargzciywuqhlcaorwy.supabase.co"

# login <email> -> prints access_token
login() {
  curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"Test1234!\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))"
}

# rpc <token> <fn_name> <json_args>
rpc() {
  curl -s -X POST "$BASE/rest/v1/rpc/$2" \
    -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "Content-Type: application/json" \
    -d "${3:-{\}}"
}

# rest <token> <method> <path+query> [json_body]
rest() {
  if [ -n "$4" ]; then
    curl -s -X "$2" "$BASE/rest/v1/$3" \
      -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "Content-Type: application/json" \
      -H "Prefer: return=representation" -d "$4"
  else
    curl -s -X "$2" "$BASE/rest/v1/$3" \
      -H "apikey: $ANON" -H "Authorization: Bearer $1"
  fi
}
