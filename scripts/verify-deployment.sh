#!/usr/bin/env bash
# Verify the live GardenOS Location deployment matches the repo's VERSION file.
# Expects to be run from inside the repo (or anywhere with a sibling VERSION file).
# Exits non-zero on any failure, prints which check failed.
set -uo pipefail

URL_BASE="https://taytus.github.io/gardenos-location-mvp"
EXPECTED_VERSION="$(tr -d '[:space:]' < VERSION)"
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

note(){ echo "  ..  $*"; }
pass(){ echo "  PASS  $*"; }
fail(){ echo "  FAIL  $*"; FAIL=1; }

# 1. HTML page: version badge correct, no legacy demo UI, no fake coordinates.
HTML="$TMP/index.html"
curl -fsSL "${URL_BASE}/?verify=$(date +%s)" -o "$HTML" || fail "fetch ${URL_BASE}/"

if grep -qF "v: $EXPECTED_VERSION" "$HTML"; then
    pass "badge shows v: $EXPECTED_VERSION"
else
    fail "badge missing 'v: $EXPECTED_VERSION'"
fi

if grep -qF "Run preview demo" "$HTML"; then
    fail "legacy 'Run preview demo' button present"
else
    pass "no legacy 'Run preview demo' button"
fi

if grep -qF "36.3990" "$HTML"; then
    fail "legacy fake latitude 36.3990 present"
else
    pass "no legacy fake latitude 36.3990"
fi

if grep -qF -- "-92.9099" "$HTML"; then
    fail "legacy fake longitude -92.9099 present"
else
    pass "no legacy fake longitude -92.9099"
fi

# 2. sw.js: returns 200 and its cache name embeds the version.
SW="$TMP/sw.js"
SW_CODE="$(curl -fsS -o "$SW" -w '%{http_code}' "${URL_BASE}/sw.js" || true)"
if [ "$SW_CODE" = "200" ]; then
    pass "sw.js returns 200"
else
    fail "sw.js returned HTTP ${SW_CODE:-NO_RESPONSE}"
fi

if grep -qE "gardenos-location-v${EXPECTED_VERSION//./\\.}|cache[^A-Za-z]*${EXPECTED_VERSION}" "$SW"; then
    pass "sw.js cache name contains version $EXPECTED_VERSION"
else
    fail "sw.js cache name does not contain version $EXPECTED_VERSION"
fi

# 3. manifest.webmanifest: returns 200 and parses as JSON.
MANIFEST="$TMP/manifest.webmanifest"
MANIFEST_CODE="$(curl -fsS -o "$MANIFEST" -w '%{http_code}' "${URL_BASE}/manifest.webmanifest" || true)"
if [ "$MANIFEST_CODE" = "200" ]; then
    pass "manifest.webmanifest returns 200"
else
    fail "manifest.webmanifest returned HTTP ${MANIFEST_CODE:-NO_RESPONSE}"
fi

if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$MANIFEST" 2>/dev/null; then
    pass "manifest.webmanifest parses as JSON"
else
    fail "manifest.webmanifest does not parse as JSON"
fi

# 4. plain http redirects to https.
REDIRECT_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "http://taytus.github.io/gardenos-location-mvp/" || true)"
case "$REDIRECT_CODE" in
    301|302|307|308) pass "http -> https redirect returns ${REDIRECT_CODE}";;
    200)             fail "http served 200 directly (no https redirect)";;
    *)               fail "http redirect returned ${REDIRECT_CODE:-NO_RESPONSE}";;
esac

echo
if [ "$FAIL" -eq 0 ]; then
    echo "==> PASS: live deployment verified for v $EXPECTED_VERSION"
    exit 0
else
    echo "==> FAIL: live deployment did not match v $EXPECTED_VERSION"
    exit 1
fi
