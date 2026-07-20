#!/bin/bash
# QA signup helper — creates one test account via the same GoTrue signup the app uses.
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5YXJnemNpeXd1cWhsY2Fvcnd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDkzOTUsImV4cCI6MjA5MjMyNTM5NX0.UkDNFFDL9dmNj_C4RrFaQU0YcMRoag9EAr1QSIZuvsk"
BASE="https://hyargzciywuqhlcaorwy.supabase.co"
EMAIL="$1"; NAME="$2"; ROLE="$3"; COMPANY="$4"; EXTRA="$5"
DATA="{\"name\":\"$NAME\",\"role\":\"$ROLE\",\"company_name\":\"$COMPANY\",\"city\":\"Vancouver\",\"accepted_terms\":\"true\",\"signup_platform\":\"agent-test\"$EXTRA}"
RES=$(curl -s -X POST "$BASE/auth/v1/signup" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!\",\"data\":$DATA}")
NEWID=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('id') or d.get('id') or d.get('msg') or d.get('error_code') or d)" 2>/dev/null)
echo "$EMAIL -> $NEWID"
