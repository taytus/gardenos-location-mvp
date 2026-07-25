# GardenOS Location v0.4.1

## Added
- `sw.js` and `manifest.webmanifest` are now part of the build. Both files previously 404'd on the live site, so the PWA install prompt and offline shell never actually worked.
- Service worker cache is named after the app version, so a new deploy replaces the old cache instead of stacking on top of it.
- Location cards now also show acquisition time and altitude when available, and carry a "Tap to open in Google Maps" hint.
- Inline confirmations replace the blocking `alert()` and `confirm()` dialogs.

## Fixed
- PWA install and offline support: with `sw.js` and `manifest.webmanifest` now present and referenced with version query strings, the service worker can register and the manifest can be parsed by the browser.
- Service worker activates cleanly across deploys: it enumerates caches on activate and deletes older ones, so the new version takes over on the next refresh.
- GPS acquisition no longer aborts on the first transient error. The window now samples for up to 20 seconds, keeps the most accurate reading, and stops early at 15 meters or better.
- Google Maps links now use the documented `https://www.google.com/maps/search/?api=1&query=LAT,LNG` form.

## Changed
- Recording no longer waits for GPS. Tapping record starts the microphone immediately and acquires location in the background, so the first tap is instant instead of stalling up to 20 seconds.
- New recordings are tagged with `source: "gps"`.
- The visible version badge `v: 0.4.1` is rendered from the single `APP_VERSION` constant in `index.html`, mirrored in the `VERSION` file and the `v0.4.1` git tag.

## Known limitation
Recordings live only in this browser's IndexedDB on this device. Clearing site data deletes them. There is no sync, no cloud backup, and no export.

---

# GardenOS Location v0.4.0

## Added
- Visible app version badge: `v: 0.4.0`.
- Single `APP_VERSION` constant in `index.html`.
- Root `VERSION` file for release tracking.

## Removed
- Demo button and hardcoded preview coordinates.

## Notes
The assistant controls the application version number from this release onward.