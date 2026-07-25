#!/usr/bin/env bash
# Verify the live GardenOS deployment matches the repo's VERSION file.
# After the nextsteps-0725-delta layout swap the site root serves the merged
# GardenOS app and the voice recorder (the previous root) lives at /location/.
# Expects to be run from inside the repo (or anywhere with a sibling VERSION file).
# Exits non-zero on any failure, prints which check failed.
set -uo pipefail

URL_BASE="https://taytus.github.io/gardenos-location-mvp"
RECORDER_URL="${URL_BASE}/location/"
EXPECTED_VERSION="$(tr -d '[:space:]' < VERSION)"
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

note(){ echo "  ..  $*"; }
pass(){ echo "  PASS  $*"; }
fail(){ echo "  FAIL  $*"; FAIL=1; }

# 1. Root HTML: serves GardenOS, no legacy demo UI, no fake coordinates.
HTML="$TMP/index.html"
curl -fsSL "${URL_BASE}/?verify=$(date +%s)" -o "$HTML" || fail "fetch ${URL_BASE}/"

if grep -qF "GardenOS v0.1" "$HTML"; then
    pass "root serves GardenOS (title 'GardenOS v0.1' present)"
else
    fail "root does not appear to serve GardenOS (expected 'GardenOS v0.1' title)"
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

# 2. Root sw.js: returns 200 and its cache name embeds the version.
SW="$TMP/sw.js"
SW_CODE="$(curl -fsS -o "$SW" -w '%{http_code}' "${URL_BASE}/sw.js" || true)"
if [ "$SW_CODE" = "200" ]; then
    pass "sw.js returns 200"
else
    fail "sw.js returned HTTP ${SW_CODE:-NO_RESPONSE}"
fi

# Assert the exact cache constant, not a loose pattern. A stale cache name is the
# one defect that permanently traps a phone on an old release, so this check has to
# name what it expects. The previous pattern used [^A-Za-z]* between "gardenos" and
# the version, which could never cross the letters in "gardenos-app-v...", so it
# failed on every possible input.
SW_CACHE_EXPECTED="gardenos-app-v${EXPECTED_VERSION}"
SW_CACHE_ACTUAL="$(grep -oE '"gardenos-[A-Za-z]+-v[0-9]+\.[0-9]+\.[0-9]+"' "$SW" | head -1 | tr -d '"')"
if [ "$SW_CACHE_ACTUAL" = "$SW_CACHE_EXPECTED" ]; then
    pass "sw.js cache name is $SW_CACHE_EXPECTED"
else
    fail "sw.js cache name is '${SW_CACHE_ACTUAL:-NONE FOUND}', expected '$SW_CACHE_EXPECTED'"
fi

# 3. Root manifest.webmanifest: returns 200 and parses as JSON.
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

# 4. /location/ (the original voice recorder) still serves its v: $EXPECTED_VERSION
# badge so phones that had the old root installed have something to land on.
REC_HTML="$TMP/location.html"
REC_CODE="$(curl -fsS -o "$REC_HTML" -w '%{http_code}' "${RECORDER_URL}?verify=$(date +%s)" || true)"
if [ "$REC_CODE" = "200" ]; then
    pass "/location/ returns 200"
else
    fail "/location/ returned HTTP ${REC_CODE:-NO_RESPONSE}"
fi
if [ "$REC_CODE" = "200" ] && grep -qF "v: $EXPECTED_VERSION" "$REC_HTML"; then
    pass "/location/ still serves the v: $EXPECTED_VERSION badge"
else
    fail "/location/ is missing the v: $EXPECTED_VERSION badge"
fi

# 5. plain http redirects to https.
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
