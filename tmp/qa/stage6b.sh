#!/bin/bash
. tmp/qa/api.sh
WRK=$(login test_worker@rorkqa.com)
WRK_ID="36aaf593-0e32-45e9-9ce3-8034d9c427c8"
echo "1. WRK escalate role->SuperAdmin (expect BLOCKED/empty+role Worker): $(rest "$WRK" PATCH "profiles?id=eq.$WRK_ID&select=role" '{"role":"SuperAdmin"}' | head -c 150)"
echo "2. VERIFY role still Worker: $(rest "$WRK" GET "profiles?id=eq.$WRK_ID&select=role")"
echo "3. WRK change status (expect blocked): $(rest "$WRK" PATCH "profiles?id=eq.$WRK_ID&select=status" '{"status":"Suspended"}' | head -c 150)"
echo "4. WRK legit self-update name (expect success): $(rest "$WRK" PATCH "profiles?id=eq.$WRK_ID&select=name" '{"name":"Test Worker"}' | head -c 150)"
echo "5. FINAL role: $(rest "$WRK" GET "profiles?id=eq.$WRK_ID&select=name,role,status")"
