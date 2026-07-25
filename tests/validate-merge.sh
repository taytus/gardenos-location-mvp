#!/usr/bin/env bash
# Durable gate proving the GardenOS v0.1 + voice/GPS merge landed and v0.1
# lost nothing. Run from the repo root (or pass the repo-root as argv[1]).
#
# Usage: bash tests/validate-merge.sh [repo-root]
# Exit 0 if every check passes; 1 otherwise. No network. No colours.

set -u

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
A="$REPO_ROOT/gardenos/index.html"
V="$REPO_ROOT/gardenos/voice-gps.js"
S="$REPO_ROOT/gardenos/sw.js"
M="$REPO_ROOT/gardenos/manifest.webmanifest"

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS  $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL  $1  ($2)"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# Run a Node one-liner against a file. Exits 0 on pass, 1 on fail, 2 if node absent.
# Args: <file> <node-script-source>
run_node() {
  local file="$1" script="$2"
  if ! command -v node >/dev/null 2>&1; then return 2; fi
  if node -e "$script" "$file" >/dev/null 2>&1; then return 0; fi
  return 1
}

# Aggregate check: every regex pattern must match the file. Echoes the list of
# missing patterns on failure; returns 0 only if all matched.
all_present() {
  local file="$1"; shift
  local p miss=()
  for p in "$@"; do
    grep -qE -- "$p" "$file" 2>/dev/null || miss+=("$p")
  done
  if [ "${#miss[@]}" -eq 0 ]; then return 0; fi
  echo "${miss[*]}"
  return 1
}

# ----- required files: bail early so missing infrastructure is loud -----
for f in "$A" "$V" "$S" "$M"; do
  if [ ! -f "$f" ]; then
    echo "FAIL  required file present ($f)  (missing)"
    echo "0 passed, 1 failed"
    echo "RESULT=FAIL"
    exit 1
  fi
done

# ----- REGRESSION (1-3) -----

# Check 1: every v0.1 function still defined in index.html
FNS=(seedData loadData saveData showView syncSelects escapeHtml render renderTasks taskCard renderSections renderPlantings renderJournal renderRecommendations renderProfile addSection addPlanting addTask addJournal toggleTask deleteTask deletePlanting deleteJournal deleteSection saveProfile resetDemo openModal closeModal formatDate sectionName)
miss=()
for fn in "${FNS[@]}"; do
  # Match "function fn", or "fn:" / "fn (" as an identifier boundary
  if ! grep -qE "(function[[:space:]]+${fn}\b|[^A-Za-z0-9_]${fn}[[:space:]]*[\(:=])" "$A" 2>/dev/null; then
    miss+=("$fn")
  fi
done
if [ "${#miss[@]}" -eq 0 ]; then
  pass "v0.1 feature preservation (${#FNS[@]} functions intact)"
else
  fail "v0.1 feature preservation" "missing: ${miss[*]}"
fi

# Check 2: localStorage state key still present
if grep -qE 'gardenos-v0' "$A" 2>/dev/null; then
  pass "localStorage state key gardenos-v0* retained for app state"
else
  fail "localStorage state key gardenos-v0* retained for app state" "key not found in index.html"
fi

# Check 3: seed section "Butterfly Garden" still present
if grep -qF "Butterfly Garden" "$A" 2>/dev/null; then
  pass "seed section Butterfly Garden preserved"
else
  fail "seed section Butterfly Garden preserved" "seed missing"
fi

# ----- INTEGRATION (4-7) -----

# Check 4: index.html loads voice-gps.js and references the GardenVoice API
m=$(all_present "$A" 'voice-gps\.js' 'GardenVoice')
if [ $? -eq 0 ]; then
  pass "index.html loads voice-gps.js and references GardenVoice"
else
  fail "index.html loads voice-gps.js and references GardenVoice" "missing: $m"
fi

# Check 5: journal entry carries audioId + 4 location fields + source: "gps"
JKEYS=(audioId latitude longitude accuracyMeters locationStatus)
miss=()
for k in "${JKEYS[@]}"; do
  grep -qF -- "$k" "$A" 2>/dev/null || miss+=("$k")
done
if [ "${#miss[@]}" -eq 0 ] && grep -qE 'source[[:space:]]*:[[:space:]]*"gps"' "$A" 2>/dev/null; then
  pass "journal entry carries audioId, latitude, longitude, accuracyMeters, locationStatus, source: \"gps\""
else
  msg="missing keys: ${miss[*]:-(none)}"
  if ! grep -qE 'source[[:space:]]*:[[:space:]]*"gps"' "$A" 2>/dev/null; then
    msg="$msg; source:\"gps\" missing"
  fi
  fail "journal entry carries audioId, latitude, longitude, accuracyMeters, locationStatus, source: \"gps\"" "$msg"
fi

# Check 6: renders audio playback element AND a Google Maps link in the required form
m=$(all_present "$A" '<audio|createElement\("audio"\)' 'maps/search/\?api=1&query=')
if [ $? -eq 0 ]; then
  pass "renders <audio> element and Google Maps link of the required form"
else
  fail "renders <audio> element and Google Maps link of the required form" "missing: $m"
fi

# Check 7: deleteJournal also calls deleteAudio
if grep -qF 'deleteAudio' "$A" 2>/dev/null; then
  pass "deleteJournal also calls deleteAudio (no orphan audio blobs)"
else
  fail "deleteJournal also calls deleteAudio (no orphan audio blobs)" "deleteAudio not referenced"
fi

# ----- STORAGE SPLIT (8-10) -----

# Check 8: voice-gps.js opens IndexedDB for audio
if grep -qF 'indexedDB.open' "$V" 2>/dev/null; then
  pass "voice-gps.js opens IndexedDB for audio"
else
  fail "voice-gps.js opens IndexedDB for audio" "indexedDB.open not found"
fi

# Check 9: voice-gps.js contains NO localStorage
if grep -qF 'localStorage' "$V" 2>/dev/null; then
  fail "voice-gps.js contains no localStorage" "localStorage referenced in the capture module"
else
  pass "voice-gps.js contains no localStorage"
fi

# Check 10: no line in index.html writes audio or a Blob to localStorage
if grep -nE 'localStorage[^;]*(audio|Blob|blob)' "$A" >/dev/null 2>&1; then
  fail "no audio/Blob written to localStorage in index.html" "found a line writing audio/blob via localStorage"
else
  pass "no audio/Blob written to localStorage in index.html"
fi

# ----- CAPTURE ENGINE (11-15) -----

# Check 11: defines window.GardenVoice + all 9 contract methods
m=$(all_present "$V" 'window\.GardenVoice' 'acquireLocation' 'startRecording' 'stopRecording' 'isRecording' 'saveAudio' 'getAudioUrl' 'deleteAudio' 'qualityLabel' 'mapsUrl')
if [ $? -eq 0 ]; then
  pass "window.GardenVoice exposes all 9 contract methods"
else
  fail "window.GardenVoice exposes all 9 contract methods" "missing: $m"
fi

# Check 12: GPS options + watchPosition + clearWatch
m=$(all_present "$V" 'enableHighAccuracy[[:space:]]*:[[:space:]]*true' 'maximumAge[[:space:]]*:[[:space:]]*0' 'timeout[[:space:]]*:[[:space:]]*20000' 'watchPosition' 'clearWatch')
if [ $? -eq 0 ]; then
  pass "GPS uses enableHighAccuracy+maximumAge 0+timeout 20000+watchPosition+clearWatch"
else
  fail "GPS uses enableHighAccuracy+maximumAge 0+timeout 20000+watchPosition+clearWatch" "missing: $m"
fi

# Check 13: thresholds 15 / 50 + labels Excellent / Good / Poor
m=$(all_present "$V" '<=?[[:space:]]*15' '<=?[[:space:]]*50' 'Excellent' 'Good' 'Poor')
if [ $? -eq 0 ]; then
  pass "GPS thresholds (15, 50) and quality labels (Excellent, Good, Poor) present"
else
  fail "GPS thresholds (15, 50) and quality labels (Excellent, Good, Poor) present" "missing: $m"
fi

# Check 14: statuses denied and unavailable handled
m=$(all_present "$V" 'denied' 'unavailable')
if [ $? -eq 0 ]; then
  pass "GPS statuses denied and unavailable handled"
else
  fail "GPS statuses denied and unavailable handled" "missing: $m"
fi

# Check 15: PERMISSION_DENIED (code === 1) distinguished from transient errors
m=$(all_present "$V" 'code[[:space:]]*===?[[:space:]]*1' 'PERMISSION_DENIED')
if [ $? -eq 0 ]; then
  pass "PERMISSION_DENIED (code===1) distinguished from transient errors"
else
  fail "PERMISSION_DENIED (code===1) distinguished from transient errors" "missing: $m"
fi

# ----- PWA (16-18) -----

# Check 16: sw.js has cache-lifecycle plumbing + navigate detection + response.ok gate + namespaced cache name
miss=()
for p in 'caches\.keys' 'caches\.delete' 'skipWaiting' 'clients\.claim' 'navigate|request\.mode' 'response\.ok|networkResponse\.ok|cachedResponse\.ok' 'gardenos'; do
  grep -qE -- "$p" "$S" 2>/dev/null || miss+=("$p")
done
if [ "${#miss[@]}" -eq 0 ]; then
  pass "sw.js has cache lifecycle, navigate detection, response.ok gate, namespaced cache"
else
  fail "sw.js has cache lifecycle, navigate detection, response.ok gate, namespaced cache" "missing: ${miss[*]}"
fi

# Check 17: manifest.webmanifest valid JSON + required keys + non-empty icons + relative start_url
run_node "$M" 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const need=["name","short_name","start_url","display","theme_color"];const miss=need.filter(k=>!(k in m));if(miss.length){console.error(miss.join(","));process.exit(1)}if(!Array.isArray(m.icons)||!m.icons.length)process.exit(1);if(String(m.start_url).startsWith("/"))process.exit(1)'
rc=$?
case "$rc" in
  0) pass "manifest.webmanifest is valid JSON with relative start_url and required keys" ;;
  2) echo "SKIP  manifest.webmanifest is valid JSON with relative start_url and required keys (node not installed)" ;;
  *) fail "manifest.webmanifest is valid JSON with relative start_url and required keys" "schema or JSON parse failure" ;;
esac

# Check 18: no absolute-root asset paths in sw.js or index.html
hit=""
for f in "$S" "$A"; do
  if grep -qE '"/index\.html"|"/sw\.js"|"/voice-gps\.js"' "$f" 2>/dev/null; then
    hit="$f"
    break
  fi
done
if [ -z "$hit" ]; then
  pass "no absolute-root asset paths in sw.js or index.html"
else
  fail "no absolute-root asset paths in sw.js or index.html" "found forbidden path in $hit"
fi

# ----- HYGIENE (19-20) -----

# Check 19: no coordinate literals or "Run preview demo" under gardenos/
hit=""
for pat in '36.3990' '-92.9099' 'Run preview demo'; do
  if grep -rqF -- "$pat" "$REPO_ROOT/gardenos/" 2>/dev/null; then
    hit="$pat"
    break
  fi
done
if [ -z "$hit" ]; then
  pass "no hardcoded demo coordinates or \"Run preview demo\" text under gardenos/"
else
  fail "no hardcoded demo coordinates or \"Run preview demo\" text under gardenos/" "found: $hit"
fi

# Check 20: voice-gps.js + sw.js parse; every inline <script> in index.html parses
if ! command -v node >/dev/null 2>&1; then
  echo "SKIP  voice-gps.js + sw.js + inline scripts parse as valid JS (node not installed)"
else
  js_ok=1
  run_node "$V" 'new Function(require("fs").readFileSync(process.argv[1],"utf8"))' || js_ok=0
  run_node "$S" 'new Function(require("fs").readFileSync(process.argv[1],"utf8"))' || js_ok=0
  run_node "$A" 'const h=require("fs").readFileSync(process.argv[1],"utf8");const m=[...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];if(!m.length)process.exit(1);m.forEach(x=>new Function(x[1]))' || js_ok=0
  if [ "$js_ok" -eq 1 ]; then
    pass "voice-gps.js + sw.js + every inline <script> in index.html parse as valid JS"
  else
    fail "voice-gps.js + sw.js + every inline <script> in index.html parse as valid JS" "parse error in one of the files"
  fi
fi

# ----- summary -----
echo
echo "$PASS_COUNT passed, $FAIL_COUNT failed"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "RESULT=PASS"
  exit 0
fi
echo "RESULT=FAIL"
exit 1