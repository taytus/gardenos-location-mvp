#!/usr/bin/env bash
# tests/run-e2e.sh — one-shot runner for the Playwright harnesses.
#
# What it does:
#   1. Picks a free TCP port at runtime (never assumes 8123/8124 are free).
#   2. Starts `python3 -m http.server` on 127.0.0.1:<port> serving this repo root.
#   3. Waits for it to answer a real HTTP request before launching harnesses.
#   4. Runs both harnesses with the right base URL.
#        e2e-verify.mjs  → http://127.0.0.1:<port>/          (root app)
#        e2e-merge.mjs   → http://127.0.0.1:<port>/gardenos/  (merged app)
#   5. Tears the server down on EXIT (trap), even on harness failure or Ctrl-C.
#      Belt-and-braces: also kills any leftover listener on that port.
#
# Exits 0 only when BOTH harnesses pass. Any other outcome is non-zero.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- Pick a free port at runtime (no assumptions) ---------------------------
find_free_port() {
  python3 -c 'import socket
s = socket.socket()
s.bind(("", 0))
print(s.getsockname()[1])
s.close()'
}

PORT="$(find_free_port)"
echo "[run-e2e] starting http.server on 127.0.0.1:$PORT (serving $REPO_ROOT)"

SERVER_LOG="$(mktemp -t run-e2e-server.XXXXXX.log)"
SERVER_PID=""

cleanup() {
  local rc=$?
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    local leftover
    leftover="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
    if [ -n "$leftover" ]; then kill $leftover 2>/dev/null || true; fi
  fi
  rm -f "$SERVER_LOG" 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

# --- Start the server in the background -------------------------------------
python3 -m http.server "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# --- Wait for it to answer a real request (up to ~10s) ----------------------
ready=0
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    ready=1; break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "[run-e2e] FATAL: http.server did not answer within 10s"
  echo "--- server log ---"
  cat "$SERVER_LOG" 2>/dev/null || true
  exit 1
fi

# --- Run both harnesses, capture exit codes ---------------------------------
VERIFY_RC=0
MERGE_RC=0

echo
echo "[run-e2e] === e2e-verify.mjs  (root app at http://127.0.0.1:$PORT/) ==="
node tests/e2e-verify.mjs "http://127.0.0.1:$PORT/" || VERIFY_RC=$?

echo
echo "[run-e2e] === e2e-merge.mjs   (merged app at http://127.0.0.1:$PORT/gardenos/) ==="
node tests/e2e-merge.mjs "http://127.0.0.1:$PORT/gardenos/" || MERGE_RC=$?

echo
echo "[run-e2e] verify_rc=$VERIFY_RC  merge_rc=$MERGE_RC"

if [ "$VERIFY_RC" -ne 0 ] || [ "$MERGE_RC" -ne 0 ]; then
  echo "[run-e2e] RESULT=FAIL"
  exit 1
fi

echo "[run-e2e] RESULT=PASS"
exit 0