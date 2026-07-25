# GardenOS Location: Maintainer Handoff

This document describes the project as it ships today. It is written for the
next maintainer, not for a one-shot session that is about to retire.

## Repository

- GitHub: https://github.com/taytus/gardenos-location-mvp
- GitHub Pages: https://taytus.github.io/gardenos-location-mvp/ (site root = merged GardenOS app)
- Legacy voice recorder (the v0.4.1 experiment): https://taytus.github.io/gardenos-location-mvp/location/
- Default branch: `main`
- Deployment source: `main` branch, repository root
- Current version: `0.4.1`
- Current release commit: `19f0048` ("Release GardenOS Location v0.4.1")
- Current release tag: `v0.4.1`

## Layout (as of the nextsteps-0725-delta swap)

- `/`            — merged GardenOS app (gardening + journal; voice/GPS capture lives here).
- `/location/`   — the original v0.4.1 voice recorder experiment, kept reachable for
  phones that installed it before the swap.

## Product objective

GardenOS Location is a single-user, voice-first field tool.

The core flow is:

1. Open the app on a phone.
2. Tap one large record button.
3. Record a spoken observation.
4. Capture the real device location in the background.
5. Save the original audio and location metadata locally.
6. Show recordings newest first.
7. Tap a recording to play it.
8. Tap its location card to open the exact coordinates in Google Maps.

The app should feel easier than taking notes manually or searching later.
It is not a garden database admin panel.

## Architecture

- Static HTML, CSS, and JavaScript. No build step. No package.json.
- Browser `MediaRecorder` API for audio.
- Browser `Geolocation` API for location.
- IndexedDB for audio blobs and metadata.
- Service worker (`sw.js`) and web manifest (`manifest.webmanifest`) for
  PWA install and offline shell.
- GitHub Pages for HTTPS hosting.

### Service worker

`sw.js` was added in v0.4.1. Before v0.4.1 it did not exist, so the live
site returned HTTP 404 for that path and no service worker was ever
serving stale code.

The service worker uses:

- Cache name `gardenos-location-v0.4.1` (renamed per release).
- Network-first for navigation requests and `index.html`. Only real
  HTTP 200 responses are written to the cache; 404 and 5xx are passed
  through to the user.
- Cache-first for other same-origin static assets, restricted to real,
  transparent 200 responses. Cross-origin requests are never routed
  through the cache.
- On `activate`, every cache whose name is not the current version is
  deleted, so an upgrade replaces the previous cache instead of
  stacking on top of it.
- `skipWaiting()` and `clients.claim()` so a new service worker takes
  over promptly after activation.
- A `{type: "SKIP_WAITING"}` message handler so the page can ask a
  waiting service worker to activate without forcing a reload.

The service worker only handles GET requests. POST and other methods
go straight to the network.

### Manifest

`manifest.webmanifest` was added in v0.4.1. Before that it also
returned 404 on the live site. The manifest declares `start_url`
`./index.html?v=0.4.1`, which forces the new shell to be loaded after
an upgrade. `index.html` registers `sw.js` and references the
manifest with the same `?v=0.4.1` query so caches do not stick to the
old version.

## Required recording data

Each real recording stores the following fields in IndexedDB:

- `id`
- `createdAt`
- `durationMs`
- `audioBlob`
- `mimeType`
- `latitude`
- `longitude`
- `accuracyMeters`
- `altitude` (when available)
- `locationCapturedAt`
- `locationStatus`
- `source: "gps"`
- optional note metadata

There is no `source: "demo"` field in production data. The visible
recording `source` is always `"gps"` for genuine captures.

## Geolocation behavior

The app uses high-accuracy browser geolocation with:

```js
{
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20000
}
```

The first reading is not blindly accepted. The acquisition window:

- samples `watchPosition` for up to 20 seconds
- keeps the reading with the smallest reported `accuracy` value
- stops early once a reading of 15 m or better arrives
- shows live acquisition status while it runs
- labels fixes as Excellent (<= 15 m), Good (> 15 m and <= 50 m),
  or Poor (> 50 m)
- records `locationStatus` so a poor fix is never confused with a
  precise one
- only aborts on `PERMISSION_DENIED`. Other transient errors are
  swallowed and the next reading is taken.
- records audio even if the location fix ultimately fails, but the
  status reflects that the coordinates are imprecise.

Tapping record starts the microphone immediately. GPS runs in the
background and the recording is saved as soon as the user stops
talking, so the first tap is never blocked on a 20 second wait.

## Location UI

The location card, both for the current capture and on every saved
recording, is large, high contrast, readable outdoors, and fully
tappable. It shows:

- latitude
- longitude
- accuracy in meters
- the Excellent / Good / Poor quality label
- the location acquisition timestamp
- altitude when available
- a "Tap to open in Google Maps" hint

Google Maps links use the documented form:

```
https://www.google.com/maps/search/?api=1&query=LATITUDE,LONGITUDE
```

## History (resolved)

The very first commit of this project (`1a41e60`, "Initial GardenOS
location MVP") shipped a preview build that contained:

- a `Run preview demo` button
- hardcoded fake coordinates `36.3990` and `-92.9099`
- title `GardenOS Voice` and subtitle `Capture now. Understand later.`
- no visible version badge

That preview was removed in commit `8471a6c` ("Force deploy GardenOS
Location v0.4.0"). The demo button, the hardcoded coordinates, and
the preview framing are gone from `main` and from the live site. The
historical record is preserved in git.

For reference, a real field test returned approximately:

- latitude `36.46596379810052`
- longitude `-92.91844979594315`

Those values must not be hardcoded either. All production coordinates
come from the device geolocation API at capture time.

## Versioning policy

The current version is `0.4.1`. The next release increments the
patch level unless the spec says otherwise. The rules are:

- A single source of truth lives in `index.html` as `APP_VERSION`.
- A root `VERSION` file mirrors it.
- An annotated Git tag `vX.Y.Z` is created at the release commit.
- A visible header badge is rendered in the exact format `v: X.Y.Z`.
- `RELEASE-NOTES.md` is updated for every release.
- The release validator enforces drift between these artifacts (see
  Release gating below).

## Release gating

Every release is gated by `tests/validate-release.sh`, a 20-check
script written from the spec, not from current file contents. The
checks include:

- all required files are present (`index.html`, `sw.js`,
  `manifest.webmanifest`, `VERSION`, `RELEASE-NOTES.md`, `README.md`,
  `PRD-001.md`, `PRD-002.md`, `PRD-003.md`)
- `VERSION` is valid semver and matches `APP_VERSION` in `index.html`
- the visible `v: X.Y.Z` literal and the runtime badge render agree
  with `APP_VERSION`
- `RELEASE-NOTES.md` mentions the current version
- the forbidden strings `36.3990`, `-92.9099`, and `Run preview demo`
  are absent from every production file (with a small exception for
  legacy cleanup lines that mention "Preview demo" alongside `note`,
  `purge`, or `legacy`)
- no coordinate literals appear in `index.html`
- `index.html` stores `source: "gps"` and uses IndexedDB, not
  `localStorage`
- the Google Maps link form is the documented `?api=1&query=` form
- geolocation options include `enableHighAccuracy`, `maximumAge: 0`,
  `timeout: 20000`, `watchPosition`, and `clearWatch`
- the quality thresholds `<= 15` and `<= 50` and the Excellent / Good
  / Poor labels are present
- `denied` and `unavailable` geolocation failure paths are handled
- `sw.js` exposes `caches.keys`, `caches.delete`, `skipWaiting`, and
  `clients.claim`, references the current version in its cache name,
  and uses `navigate` or `request.mode` for network-first routing
- `manifest.webmanifest` parses as JSON and carries `name`,
  `short_name`, `start_url`, `display`, `theme_color`, and `icons`
- `index.html` references `manifest.webmanifest?v=` and `sw.js?v=`
  with the current version
- no production file references an absolute root path such as
  `/index.html`, `/sw.js`, or `/manifest.webmanifest`, because the
  site is served from the `/gardenos-location-mvp/` sub-path
- there is no `package.json` and no build system
- `index.html` contains no `alert(` or `confirm(` blocking dialogs

The release scripts live under `scripts/`. `scripts/deploy.sh` is
the deployment entry point and `scripts/verify-deployment.sh`
confirms the live site matches the spec.

## Validation checklist (per release)

Before tagging:

- no demo button in `index.html`
- no hardcoded fake coordinates anywhere in production files
- the visible badge reads `v: 0.4.1` (or the new version)
- `APP_VERSION` matches `VERSION`
- `sw.js` cache name uses the new version
- audio is stored in IndexedDB, never `localStorage`
- location comes from the device `Geolocation` API
- maps links use the documented `?api=1&query=` form
- all touch targets are phone-friendly
- `bash tests/validate-release.sh` exits 0

After deploying:

- the live page at `https://taytus.github.io/gardenos-location-mvp/`
  contains `v: 0.4.1` (or the new version)
- the live page does not contain `Run preview demo`
- the live page does not contain the fake coordinates `36.3990` or
  `-92.9099`
- HTTPS is enforced
- the new service worker is active (clearing site data once should
  be enough to confirm it)
- a real recording on the actual phone saves a row with
  `source: "gps"` and a tappable Google Maps link

## Files expected in the repository

- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `VERSION`
- `RELEASE-NOTES.md`
- `README.md`
- `PRD-001.md`
- `PRD-002.md`
- `PRD-003.md`
- `tests/validate-release.sh`
- `scripts/deploy.sh`
- `scripts/verify-deployment.sh`

## Deployment workflow

The user expects deployment when they say "deploy." The preferred
workflow is:

1. Inspect the repository and working tree.
2. Pull the latest `main`.
3. Make and validate the change.
4. Run `bash tests/validate-release.sh` and confirm it exits 0.
5. Commit on `main`.
6. Tag with an annotated `vX.Y.Z` at the release commit.
7. Push `main` and push the tag.
8. Confirm GitHub Pages is configured for `main` / `/` with HTTPS.
9. Run `scripts/verify-deployment.sh` to confirm the live HTML and
   the visible version badge match the spec.