#!/usr/bin/env bash
# smoke-test.sh — full-chain verification for the expo-eyes monorepo.
# Boots relay + mock phone, drives the agent CLI through it, checks the
# MCP server registers all tools. Exits non-zero on any failure.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTTP_PORT=18765
WS_PORT=18766
TOKEN="test-token-123"
BASE="http://127.0.0.1:${HTTP_PORT}"
# NOTE: 127.0.0.1, not localhost — on IPv6-first runners `localhost` resolves
# to ::1 and Node's ws/http will not fall back to IPv4 (ECONNREFUSED ::1).
LOG_DIR="/tmp/expo-eyes-smoke"
mkdir -p "$LOG_DIR"

PASS=0; FAIL=0
check() { # check <name> <condition-exit-code>
  if [ "$2" -eq 0 ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1"; FAIL=$((FAIL+1)); fi
}

cleanup() {
  [ -n "${RELAY_PID:-}" ] && kill "$RELAY_PID" 2>/dev/null
  [ -n "${PHONE_PID:-}" ] && kill "$PHONE_PID" 2>/dev/null
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

# Defensive: clear orphans from previous runs (they would hold the test
# ports and serve stale screens, making results flaky).
pkill -f "node src/index.js" 2>/dev/null
pkill -f "mock-phone.js" 2>/dev/null
sleep 1

echo "── 1. Boot relay (HTTP :$HTTP_PORT, WS :$WS_PORT, token auth)"
(cd "$ROOT/packages/expo-eyes-relay" && exec env EXPO_EYES_HTTP_PORT=$HTTP_PORT EXPO_EYES_WS_PORT=$WS_PORT \
  node src/index.js --token "$TOKEN") >"$LOG_DIR/relay.log" 2>&1 &
RELAY_PID=$!

echo "── 2. Connect mock phone"
(cd "$ROOT/scripts" && exec env EXPO_EYES_WS_URL="ws://127.0.0.1:$WS_PORT" EXPO_EYES_TOKEN="$TOKEN" \
  node mock-phone.js) >"$LOG_DIR/phone.log" 2>&1 &
PHONE_PID=$!

# Wait for chain readiness
READY=1
for i in $(seq 1 30); do
  PING=$(curl -s "$BASE/ping" 2>/dev/null)
  echo "$PING" | grep -Eq '"phoneReplied":true' && READY=0 && break
  sleep 0.5
done
check "end-to-end /ping (relay → WS → phone → back)" $READY
[ $READY -ne 0 ] && { echo "relay.log:"; tail -20 "$LOG_DIR/relay.log"; echo "phone.log:"; tail -10 "$LOG_DIR/phone.log"; exit 1; }

echo "── 3. Relay HTTP API"
curl -s "$BASE/health" | grep -Eq '"phoneConnected":true'; check "GET /health shows connected phone" $?
curl -s "$BASE/tools" -H "Authorization: Bearer $TOKEN" | grep -Eq '"scrollIntoView"'; check "GET /tools lists composite tools" $?
curl -s -X POST "$BASE/tool/visibleText" -H "Authorization: Bearer $TOKEN" | grep -Eq '"Sign in"'; check "POST /tool/visibleText sees mock screen" $?
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/tool/inspect" | grep -Eq 401; check "auth enforced without token (401)" $?

echo "── 4. Agent CLI (typed client + zod validation)"
CLI="node $ROOT/packages/expo-eyes-agent/dist/cli.js"
export EXPO_EYES_RELAY_URL="$BASE" EXPO_EYES_TOKEN="$TOKEN"
$CLI health | grep -Eq '"phoneConnected": ?true'; check "cli health" $?
$CLI tools | grep -Eq '"name": ?"find"'; check "cli tools (live from relay)" $?
$CLI visibleText | grep -Eq '"Sign in"'; check "cli visibleText" $?
$CLI find --testID sign-in | grep -Eq '"viewTag": ?4'; check "cli find --testID" $?
$CLI fill --text "hi@example.com" --placeholder example | grep -Eq '"ok": ?true'; check "cli fill (input by placeholder)" $?
TAP=$($CLI tapText --text "Sign in" 2>&1)
echo "$TAP" | grep -Eq '"screenChanged": ?true'; check "cli tapText verified (screen changed)" $?
echo "$TAP" | grep -Eq 'Signed in'; check "tap actually toggled the mock button" $?
$CLI tapText --text "Nonexistent Button" >/dev/null 2>&1; [ $? -ne 0 ]; check "tapText on missing element fails cleanly" $?
$CLI tapText --text "Sign in" --verify notabool 2>/dev/null >/dev/null; [ $? -ne 0 ]; check "bad args rejected by validation" $?

echo "── 5. MCP server (26 tools over stdio)"
export EXPO_EYES_RELAY_URL="$BASE" EXPO_EYES_TOKEN="$TOKEN"
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}'
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
printf '%s\n%s\n' "$INIT" "$LIST" | $CLI mcp >"$LOG_DIR/mcp.log" 2>&1 &
MCP_PID=$!
sleep 2; kill $MCP_PID 2>/dev/null
grep -Eq '"name":"expo-eyes"' "$LOG_DIR/mcp.log"; check "mcp initialize handshake" $?
TOOLCOUNT=$(grep -oE '"name": ?"' "$LOG_DIR/mcp.log" | wc -l)
[ "$TOOLCOUNT" -ge 26 ]; check "mcp tools/list exposes >=26 tools (got $TOOLCOUNT)" $?

echo ""
echo "════════════════════════════════════"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "════════════════════════════════════"
[ $FAIL -eq 0 ]
