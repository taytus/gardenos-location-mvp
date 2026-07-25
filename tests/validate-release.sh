#!/usr/bin/env bash
# tests/validate-release.sh
#
# Durable release gate for GardenOS Location.
# Mechanically checks every release invariant from the spec.
# Independent of in-flight slices: written FROM the specification, not fitted
# to current file contents. Expected to FAIL today (other slices not landed).
#
# Usage:  bash tests/validate-release.sh [repo-root]
# Default repo-root is the script's parent directory.
# Exit 0 = all checks pass. Exit 1 = at least one failed.

set -u

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT" || { echo "FATAL: cannot cd to $REPO_ROOT"; exit 1; }

PASS_COUNT=0
FAIL_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL  %s  (%s)\n' "$1" "$2"; }

# ---------- Read VERSION once ----------
VERSION_FILE="$REPO_ROOT/VERSION"
if [ ! -f "$VERSION_FILE" ]; then
    fail "version-file-exists" "VERSION not found at $VERSION_FILE"
    printf '0 passed, 1 failed\nRESULT=FAIL\n'
    exit 1
fi
V=$(tr -d '[:space:]' < "$VERSION_FILE")

# ---------- Helpers ----------
# safe_cat: emit file content, or empty string if missing
safe_cat() {
    local p="$REPO_ROOT/$1"
    if [ -f "$p" ]; then cat "$p"; fi
}

# has_lit: returns 0 if needle (literal) appears in haystack
has_lit() { [[ "$1" == *"$2"* ]]; }

# grep_re: returns 0 if regex matches in haystack (uses /usr/bin/grep)
grep_re() { printf '%s' "$1" | /usr/bin/grep -Eq -- "$2"; }

INDEX_CONTENT=$(safe_cat index.html)
SW_CONTENT=$(safe_cat sw.js)
MANIFEST_CONTENT=$(safe_cat manifest.webmanifest)
RELEASE_CONTENT=$(safe_cat RELEASE-NOTES.md)

# ---------- Check 1: Required files exist ----------
CHECK_FILES=(index.html manifest.webmanifest sw.js VERSION RELEASE-NOTES.md README.md PRD-001.md PRD-002.md PRD-003.md)
MISSING=()
for f in "${CHECK_FILES[@]}"; do
    [ -f "$REPO_ROOT/$f" ] || MISSING+=("$f")
done
if [ ${#MISSING[@]} -eq 0 ]; then
    pass "required-files-exist"
else
    fail "required-files-exist" "missing: ${MISSING[*]}"
fi

# ---------- Check 2: VERSION is valid semver X.Y.Z ----------
if grep_re "$V" '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    pass "version-is-semver"
else
    fail "version-is-semver" "VERSION='$V' is not X.Y.Z"
fi

# ---------- Check 3: index.html declares APP_VERSION = $V ----------
if grep_re "$INDEX_CONTENT" "APP_VERSION[[:space:]]*=[[:space:]]*[\"']${V}[\"']"; then
    pass "index-declares-app-version"
else
    fail "index-declares-app-version" "APP_VERSION != ${V} in index.html"
fi

# ---------- Check 4: Badge literal matches APP_VERSION (drift-safe) ----------
# The release deliberately ships a literal "v: X.Y.Z" in the markup so a
# deployment can be confirmed with `curl | grep`. The duplication is safe
# because THIS check forbids drift between (a) the markup literal,
# (b) the runtime re-render from APP_VERSION, and (c) the APP_VERSION
# constant / VERSION file. If any disagree, the build fails.
V_ESC=$(printf '%s' "$V" | sed 's/\./\\./g')
LITERAL_OK=no
if grep_re "$INDEX_CONTENT" "v:[[:space:]]*${V_ESC}"; then
    LITERAL_OK=yes
fi
RUNTIME_OK=no
if has_lit "$INDEX_CONTENT" 'versionBadge.textContent' \
        && has_lit "$INDEX_CONTENT" 'APP_VERSION'; then
    RUNTIME_OK=yes
fi
APP_CONST_OK=no
if grep_re "$INDEX_CONTENT" "APP_VERSION[[:space:]]*=[[:space:]]*[\"']${V_ESC}[\"']"; then
    APP_CONST_OK=yes
fi
if [ "$LITERAL_OK" = "yes" ] && [ "$RUNTIME_OK" = "yes" ] && [ "$APP_CONST_OK" = "yes" ]; then
    pass "badge-literal-matches-app-version"
else
    fail "badge-literal-matches-app-version" "literal=$LITERAL_OK runtime=$RUNTIME_OK app_const=$APP_CONST_OK (version=$V)"
fi

# ---------- Check 5: RELEASE-NOTES.md mentions $V ----------
if has_lit "$RELEASE_CONTENT" "$V"; then
    pass "release-notes-mentions-version"
else
    fail "release-notes-mentions-version" "RELEASE-NOTES.md missing '$V'"
fi

# ---------- Check 6: Forbidden strings ----------
FORBIDDEN=("36.3990" "-92.9099" "Run preview demo")
FORBID_HIT=""
PROD_FILES=()
for f in index.html sw.js manifest.webmanifest RELEASE-NOTES.md README.md PRD-001.md PRD-002.md PRD-003.md; do
    [ -f "$REPO_ROOT/$f" ] && PROD_FILES+=("$f")
done
for f in "${PROD_FILES[@]}"; do
    fc=$(safe_cat "$f")
    for needle in "${FORBIDDEN[@]}"; do
        if has_lit "$fc" "$needle"; then
            FORBID_HIT="$f contains '$needle'"
            break 2
        fi
    done
done
# Preview demo special rule on index.html
PREVIEW_BAD=""
if has_lit "$INDEX_CONTENT" 'Preview demo'; then
    while IFS= read -r line; do
        body="${line#*:}"
        if ! grep_re "$body" 'note|purge|legacy'; then
            PREVIEW_BAD="non-legacy 'Preview demo' line in index.html"
            break
        fi
    done < <(printf '%s\n' "$INDEX_CONTENT" | /usr/bin/grep -nF -- 'Preview demo')
fi
if [ -z "$FORBID_HIT" ] && [ -z "$PREVIEW_BAD" ]; then
    pass "no-forbidden-strings"
else
    if [ -n "$FORBID_HIT" ]; then
        fail "no-forbidden-strings" "$FORBID_HIT"
    fi
    if [ -n "$PREVIEW_BAD" ]; then
        fail "no-forbidden-strings" "$PREVIEW_BAD"
    fi
fi

# ---------- Check 7: No coordinate literals in index.html ----------
COORD_HIT=""
if grep_re "$INDEX_CONTENT" 'latitude[[:space:]]*:[[:space:]]*-?[0-9]+\.[0-9]+'; then
    COORD_HIT="latitude literal"
fi
if grep_re "$INDEX_CONTENT" 'longitude[[:space:]]*:[[:space:]]*-?[0-9]+\.[0-9]+'; then
    if [ -z "$COORD_HIT" ]; then
        COORD_HIT="longitude literal"
    else
        COORD_HIT="$COORD_HIT, longitude literal"
    fi
fi
if [ -z "$COORD_HIT" ]; then
    pass "no-coord-literals-in-index"
else
    fail "no-coord-literals-in-index" "$COORD_HIT in index.html"
fi

# ---------- Check 8: index.html stores source: "gps" ----------
if grep_re "$INDEX_CONTENT" 'source[[:space:]]*:[[:space:]]*"gps"'; then
    pass "index-stores-source-gps"
else
    fail "index-stores-source-gps" 'source: "gps" not found'
fi

# ---------- Check 9: index.html uses IndexedDB, no localStorage ----------
IDB_OK=no
if has_lit "$INDEX_CONTENT" 'indexedDB.open' && has_lit "$INDEX_CONTENT" 'audioBlob'; then
    IDB_OK=yes
fi
if has_lit "$INDEX_CONTENT" 'localStorage'; then
    LS_HIT=yes
else
    LS_HIT=no
fi
if [ "$IDB_OK" = "yes" ] && [ "$LS_HIT" = "no" ]; then
    pass "uses-indexeddb-no-localstorage"
else
    fail "uses-indexeddb-no-localstorage" "idb=$IDB_OK localStorage=$LS_HIT"
fi

# ---------- Check 10: Google Maps links ----------
NEW_FORM='https://www.google.com/maps/search/?api=1&query='
LEGACY='google.com/maps?q='
if has_lit "$INDEX_CONTENT" "$NEW_FORM" && ! has_lit "$INDEX_CONTENT" "$LEGACY"; then
    pass "google-maps-link-form"
else
    fail "google-maps-link-form" "new form absent or legacy '$LEGACY' present"
fi

# ---------- Check 11: Geolocation options ----------
GEO_OK=yes
# Whitespace-tolerant regex for the key:value pairs (release uses
# {enableHighAccuracy:true, maximumAge:0, timeout:20000} with no spaces).
for re in 'enableHighAccuracy[[:space:]]*:[[:space:]]*true' \
          'maximumAge[[:space:]]*:[[:space:]]*0' \
          'timeout[[:space:]]*:[[:space:]]*20000'; do
    if ! grep_re "$INDEX_CONTENT" "$re"; then
        GEO_OK=no
        break
    fi
done
for needle in 'watchPosition' 'clearWatch'; do
    if ! has_lit "$INDEX_CONTENT" "$needle"; then
        GEO_OK=no
        break
    fi
done
if [ "$GEO_OK" = "yes" ]; then
    pass "geolocation-options-present"
else
    fail "geolocation-options-present" "missing one of: enableHighAccuracy/maximumAge/timeout/watchPosition/clearWatch"
fi

# ---------- Check 12: Quality thresholds ----------
Q_OK=yes
if ! grep_re "$INDEX_CONTENT" '<=[[:space:]]*15'; then Q_OK=no; fi
if ! grep_re "$INDEX_CONTENT" '<=[[:space:]]*50'; then Q_OK=no; fi
for lbl in Excellent Good Poor; do
    if ! has_lit "$INDEX_CONTENT" "$lbl"; then Q_OK=no; fi
done
if [ "$Q_OK" = "yes" ]; then
    pass "quality-thresholds-present"
else
    fail "quality-thresholds-present" "missing <=15, <=50, or labels Excellent/Good/Poor"
fi

# ---------- Check 13: Failure statuses ----------
FAIL_OK=yes
for s in denied unavailable; do
    if ! has_lit "$INDEX_CONTENT" "$s"; then FAIL_OK=no; fi
done
if [ "$FAIL_OK" = "yes" ]; then
    pass "failure-statuses-handled"
else
    fail "failure-statuses-handled" "missing 'denied' or 'unavailable'"
fi

# ---------- Check 14: sw.js cache name + APIs ----------
SW_MISSING=()
has_lit "$SW_CONTENT" "$V" || SW_MISSING+=("cache-name-with-version")
has_lit "$SW_CONTENT" 'caches.keys' || SW_MISSING+=("caches.keys")
has_lit "$SW_CONTENT" 'caches.delete' || SW_MISSING+=("caches.delete")
has_lit "$SW_CONTENT" 'skipWaiting' || SW_MISSING+=("skipWaiting")
has_lit "$SW_CONTENT" 'clients.claim' || SW_MISSING+=("clients.claim")
if [ ${#SW_MISSING[@]} -eq 0 ]; then
    pass "sw-js-cache-and-claim"
else
    fail "sw-js-cache-and-claim" "missing: ${SW_MISSING[*]}"
fi

# ---------- Check 15: sw.js navigations network-first ----------
# Pragmatic gate per spec: must reference 'navigate' OR 'request.mode'.
if grep_re "$SW_CONTENT" 'navigate|request\.mode'; then
    pass "sw-navigation-network-first"
else
    fail "sw-navigation-network-first" "no navigate/request.mode reference"
fi

# ---------- Check 16: manifest.webmanifest valid JSON + required keys ----------
if [ -z "$MANIFEST_CONTENT" ]; then
    fail "manifest-valid-json-and-keys" "manifest.webmanifest missing"
elif command -v node >/dev/null 2>&1; then
    # Write JS validator to a temp file (avoids bash single-quote string issues)
    JS_VALIDATOR=$(mktemp -t validate-manifest.XXXXXX.js)
    cat > "$JS_VALIDATOR" <<'JSEOF'
let s = "";
process.stdin.on("data", function (d) { s += d; });
process.stdin.on("end", function () {
    try {
        const o = JSON.parse(s);
        const need = ["name", "short_name", "start_url", "display", "theme_color", "icons"];
        const miss = need.filter(function (k) { return !(k in o); });
        if (miss.length) { console.log("MISSING:" + miss.join(",")); process.exit(0); }
        if (!Array.isArray(o.icons) || o.icons.length === 0) {
            console.log("MISSING:icons-empty");
            process.exit(0);
        }
        console.log("OK");
    } catch (e) {
        console.log("INVALID_JSON:" + e.message);
    }
});
JSEOF
    JSON_RESULT=$(printf '%s' "$MANIFEST_CONTENT" | node "$JS_VALIDATOR" 2>&1)
    rm -f "$JS_VALIDATOR"
    case "$JSON_RESULT" in
        OK) pass "manifest-valid-json-and-keys" ;;
        MISSING:*) fail "manifest-valid-json-and-keys" "missing: ${JSON_RESULT#MISSING:}" ;;
        INVALID_JSON:*) fail "manifest-valid-json-and-keys" "invalid JSON: ${JSON_RESULT#INVALID_JSON:}" ;;
        *) fail "manifest-valid-json-and-keys" "node output: $JSON_RESULT" ;;
    esac
else
    printf 'SKIP  manifest-valid-json-and-keys  (node not available)\n'
fi

# ---------- Check 17: manifest.webmanifest?v= and sw.js?v= references ----------
if has_lit "$INDEX_CONTENT" 'manifest.webmanifest?v=' && has_lit "$INDEX_CONTENT" 'sw.js?v='; then
    pass "versioned-asset-references"
else
    fail "versioned-asset-references" "missing versioned manifest.webmanifest?v= or sw.js?v= reference"
fi

# ---------- Check 18: No absolute-root asset paths ----------
ABS_HIT=""
for f in index.html sw.js; do
    fc=$(safe_cat "$f")
    for bare in /index.html /sw.js /manifest.webmanifest; do
        # Reject any reference to the asset at an absolute root, regardless of
        # whether it is wrapped in a " or ' quote. This is a GitHub Pages
        # PROJECT site served from a sub-path; absolute roots 404 in production.
        if has_lit "$fc" "\"${bare}\"" || has_lit "$fc" "'${bare}'"; then
            ABS_HIT="$f contains absolute-root ${bare}"
            break 2
        fi
    done
done
if [ -z "$ABS_HIT" ]; then
    pass "no-absolute-root-paths"
else
    fail "no-absolute-root-paths" "$ABS_HIT"
fi

# ---------- Check 19: No build system ----------
if [ -f "$REPO_ROOT/package.json" ]; then
    fail "no-build-system" "package.json exists at repo root"
else
    pass "no-build-system"
fi

# ---------- Check 20: No alert( or confirm( in index.html ----------
DIALOG_HIT=""
if grep_re "$INDEX_CONTENT" 'alert\('; then
    DIALOG_HIT="alert("
fi
if grep_re "$INDEX_CONTENT" 'confirm\('; then
    if [ -z "$DIALOG_HIT" ]; then
        DIALOG_HIT="confirm("
    else
        DIALOG_HIT="$DIALOG_HIT, confirm("
    fi
fi
if [ -z "$DIALOG_HIT" ]; then
    pass "no-blocking-dialogs"
else
    fail "no-blocking-dialogs" "found: $DIALOG_HIT"
fi

# ---------- Summary ----------
printf '%d passed, %d failed\n' "$PASS_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf 'RESULT=PASS\n'
    exit 0
else
    printf 'RESULT=FAIL\n'
    exit 1
fi
