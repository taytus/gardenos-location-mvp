# GardenOS

A local-first garden companion. Track garden sections, plantings, tasks, and
an observation journal enriched with voice notes and GPS coordinates.

## Run it

This is a static site. No build step, no install, no npm, no accounts.

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000/gardenos/
```

Or just visit the live build:

- https://taytus.github.io/gardenos-location-mvp/gardenos/

> **Why not `file://`?** Voice notes use `getUserMedia` (microphone) and
> `Geolocation.watchPosition` (GPS). Both require a **secure context**, so
> opening `index.html` straight from disk gives you a silent app with no mic
> and no location. Always serve over `http://localhost`, `https://`, or any
> other secure origin.

## What it does

- Today dashboard with metrics, today's actions, and rule-based recommendations
- Garden sections, grouped plantings, and a simple task list
- Observation journal with title, date, section, tags, and notes
- **Voice notes** captured from the microphone, up to 20 seconds
- **GPS** captured alongside each voice note, with accuracy and a Google Maps link
- Settings for name, location, USDA zone, soil, sun exposure, and preferences
- Settings → **Reset demo data** restores the sample dataset
- Responsive desktop and mobile layouts, installable as a PWA

On the Journal tab, tap `● Record` to capture a voice note. The browser will
ask for microphone and location permission. GPS is collected for up to 20
seconds during the recording (the best reading wins). The audio and coordinates
are saved against the journal entry.

## Data

Two browser stores, used for different things:

- `localStorage` key **`gardenos-v01`** — all app state (profile, sections,
  plantings, tasks, journal entries). Plain JSON.
- **IndexedDB** database **`gardenos-audio`**, object store `recordings` —
  audio Blobs. Blobs cannot live in `localStorage`, so each journal entry
  stores only an `audioId` reference; the actual audio sits in IndexedDB.

Settings → Reset demo data wipes both stores and reloads the sample data.

## Files

- `index.html` — the app
- `voice-gps.js` — voice + GPS capture engine, audio storage
- `sw.js` — service worker (offline cache for the app shell)
- `manifest.webmanifest` — PWA manifest
