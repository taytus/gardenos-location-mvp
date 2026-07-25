# GardenOS Location

A mobile-first, single-user field tool. Speak, the app captures your voice and your GPS fix together, and saves both locally on your phone. Tap a coordinate to verify it on Google Maps.

Live app: **https://taytus.github.io/gardenos-location-mvp/location/**

The GardenOS app lives at the site root. This voice recorder is the original
experiment that proved GPS can be captured alongside audio; the capability
has since been merged into GardenOS and lives there now. The recorder stays
reachable at `/location/` for reference.

## How to use it in the field

1. Open the live URL on the phone.
2. Add it to the home screen so it launches like a regular app.
3. Allow microphone and location when prompted.
4. Tap the big button to start recording. Tap again to stop.
5. The new note appears at the top of the list, with its coordinates and accuracy.
6. Tap any coordinate card to open that exact point in Google Maps.

## GPS behaviour

- The app samples GPS for up to 20 seconds, then keeps the most accurate reading.
- It stops early the moment it gets a fix of 15 meters or better.
- Quality labels:
  - **Excellent** at 15 meters or better.
  - **Good** between 16 and 50 meters.
  - **Poor** above 50 meters.
- A transient GPS error does not abort the acquisition. Only `PERMISSION_DENIED` aborts it. Recording still starts immediately on tap; location is acquired in the background and saved when it arrives.
- If location is denied or unavailable, the recording is still saved and labelled accordingly.

## Local development

No build, no dependencies, no `node_modules`. Serve the folder with any static server. The simplest one is the one Python already ships with:

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

Microphone and geolocation are permitted on `localhost` in every modern browser.

## Requirements

- HTTPS, or `http://localhost`. Browsers gate microphone and geolocation behind this.
- Microphone permission for recording.
- Location permission for GPS tagging.

## Storage

- All recordings live in IndexedDB in this browser on this device.
- Clearing site data deletes them.
- There is no sync, no cloud backup, and no export.

## Browser support and real limitations

- iOS Safari reports altitude as `null` on most devices.
- GPS accuracy indoors is frequently worse than 50 meters. Expect `Poor` quality or no fix at all.
- `MediaRecorder` produces `audio/mp4` on iOS Safari and `audio/webm` on Chrome and most Chromium-based browsers.

## Versioning

- The `v: X.Y.Z` badge in the header is rendered from the `APP_VERSION` constant in `index.html`.
- The same string is mirrored in the `VERSION` file in the repository root.
- A matching `vX.Y.Z` git tag marks each release.