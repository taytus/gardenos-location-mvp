# GardenOS Voice MVP

## What this build does

- Records audio from the phone microphone.
- Captures GPS coordinates and accuracy.
- Stores the original audio and metadata in IndexedDB.
- Lists recordings newest first.
- Plays recordings in the browser.
- Deletes recordings.
- Works offline after the first successful load.

## Test on a computer

Run:

```bash
python server.py
```

Then open:

`http://localhost:8000`

Microphone access works on localhost.

## Test on a phone

Mobile browsers require HTTPS for microphone and geolocation access.

The fastest approach is to upload this folder to any HTTPS static host, including:
- Netlify Drop
- Cloudflare Pages
- GitHub Pages
- Vercel

Then open the HTTPS URL on the phone and add it to the home screen.

## Important limitation

This MVP stores recordings only on the current device and browser. Clearing browser storage will delete them.
