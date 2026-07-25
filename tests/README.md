# Browser end-to-end tests

These are the **only** behavioural tests in this repo. The two Playwright
harnesses drive the real app in Chromium with a fake microphone and scripted
GPS, then assert against what actually landed in IndexedDB and the rendered
DOM. Every other `tests/*.sh` file is a static / structure check.

## Files

| File | What it covers |
|---|---|
| `e2e-verify.mjs` | The root location app (`index.html`, `sw.js`, `manifest.webmanifest`). Voice recording with improving GPS, GPS denied, poor fix labelling, legacy demo purge. |
| `e2e-merge.mjs`  | The merged GardenOS app (`index.html`, `sw.js` at the repo root). GardenOS v0.1 regression coverage (sections, plants, tasks, journal, settings, all handlers) + the new voice+GPS capture that adds a journal entry. |
| `run-e2e.sh` | One-shot runner. Picks a free port, starts `python3 -m http.server` on the repo root, runs both harnesses, tears the server down on EXIT. |
| `validate-release.sh` | Static release gate (string/structure checks against `index.html`, `sw.js`, `manifest.webmanifest`, `VERSION`). Unrelated to this README. |
| `validate-merge.sh`  | Static merge gate for the GardenOS app at the repo root. Unrelated to this README. |

## Prerequisite: Playwright

The harnesses need Playwright (currently pinned to **1.61.1**) somewhere on the
machine. **This repo does NOT include `package.json` and you must NOT add one.**
(`tests/validate-release.sh` check 19, `no-build-system`, fails the release
if `package.json` exists at the repo root.)

Install Playwright in any other project (global or local) — the runner does
not care where, as long as one of these resolves:

1. `$PLAYWRIGHT_MODULE` — full absolute path to `playwright/index.mjs`
2. `$PLAYWRIGHT_ROOT`   — a directory containing `node_modules/playwright/index.mjs`
3. `/opt/homebrew/lib/node_modules/playwright/index.mjs` (Homebrew on Apple Silicon)
4. `/usr/local/lib/node_modules/playwright/index.mjs`  (Homebrew on Intel, Linux)
5. `$HOME/node_modules/playwright/index.mjs`
6. `./node_modules/playwright/index.mjs` (cwd)

Quickest install on macOS:

```bash
brew install playwright
# or
npm install -g playwright@1.61.1
```

If Playwright is missing, each harness prints the list of locations it tried
and exits non-zero with an actionable install instruction.

The harness also needs the Chromium browser binary that Playwright manages.
The first run downloads it automatically; subsequent runs reuse the cache:

```bash
npx -y playwright@1.61.1 install chromium
```

## Running

From the repo root:

```bash
bash tests/run-e2e.sh
```

That single command:

1. Picks a free TCP port (no assumptions about 8123/8124).
2. Starts `python3 -m http.server 127.0.0.1:<port>` serving the repo root.
3. Runs `e2e-verify.mjs` against `http://127.0.0.1:<port>/`.
4. Runs `e2e-merge.mjs`  against `http://127.0.0.1:<port>/`.
5. Tears the server down on EXIT — even if a harness fails or you hit Ctrl-C.
6. Prints `RESULT=PASS` and exits 0 only when both harnesses are green.

If you want to run a single harness by hand (for debugging), start a server
yourself and pass the URL:

```bash
python3 -m http.server 8123 &
node tests/e2e-verify.mjs http://127.0.0.1:8123/
node tests/e2e-merge.mjs  http://127.0.0.1:8123/
```

## Why this slice exists

These harnesses were the only proof that the voice + GPS capture actually
worked end-to-end. They previously lived in a session scratchpad. Committing
them means the next change to this app can be proven safe, not just
grep-checked.