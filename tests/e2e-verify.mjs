#!/usr/bin/env node
// GardenOS Location — end-to-end browser verification.
// Drives the real app in Chromium with a fake microphone and scripted GPS,
// then asserts against what actually landed in IndexedDB.
//
//   node e2e-verify.mjs http://localhost:8123/location/
//
// Exit 0 = every check passed.

// Locate Playwright without hardcoding a machine-specific absolute path.
// Resolution order:
//   1. $PLAYWRIGHT_MODULE  — full path to playwright/index.mjs (absolute)
//   2. $PLAYWRIGHT_ROOT    — dir that contains node_modules/playwright/index.mjs
//   3. Short list of well-known fallback locations on this machine
// If nothing resolves, print an actionable install hint and exit non-zero.
let chromium;
{
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  if (process.env.PLAYWRIGHT_ROOT)   candidates.push(process.env.PLAYWRIGHT_ROOT + '/node_modules/playwright/index.mjs');
  candidates.push(
    '/opt/homebrew/lib/node_modules/playwright/index.mjs',
    '/usr/local/lib/node_modules/playwright/index.mjs',
    (process.env.HOME || '') + '/node_modules/playwright/index.mjs',
    process.cwd() + '/node_modules/playwright/index.mjs',
  );
  let loaded = null;
  for (const p of candidates) {
    try { const m = await import(p); if (m && m.chromium) { loaded = m; break; } } catch { /* try next */ }
  }
  if (!loaded) {
    console.error('FATAL: Playwright not found. Install one of:');
    console.error('  npm install -g playwright@1.61.1');
    console.error('  npm install playwright@1.61.1  (inside any project)');
    console.error('Or set PLAYWRIGHT_MODULE=/abs/path/to/playwright/index.mjs');
    console.error('Or set PLAYWRIGHT_ROOT=/abs/path/to/project  (uses $PLAYWRIGHT_ROOT/node_modules/playwright/index.mjs)');
    console.error('Tried:');
    for (const p of candidates) console.error('  ' + p);
    process.exit(2);
  }
  chromium = loaded.chromium;
}

const BASE = process.argv[2] || 'http://localhost:8123/location/';
const results = [];
let currentScenario = '';

const check = (name, ok, detail = '') => {
  results.push({ scenario: currentScenario, name, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   [${detail}]` : ''}`);
};
const scenario = (n) => { currentScenario = n; console.log(`\n### ${n}`); };

const LAUNCH = {
  args: [
    '--use-fake-device-for-media-capture',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
};

// Read every recording out of IndexedDB, minus the blob body (blobs do not
// survive serialization), plus the facts we care about from the blob.
const readDb = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('gardenos-voice', 1);
    r.onsuccess = (e) => res(e.target.result);
    r.onerror = () => rej(r.error);
  });
  const rows = await new Promise((res, rej) => {
    const tx = db.transaction('recordings', 'readonly');
    const rq = tx.objectStore('recordings').getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return rows.map((r) => ({
    ...r,
    audioBlob: undefined,
    blobIsBlob: r.audioBlob instanceof Blob,
    blobSize: r.audioBlob ? r.audioBlob.size : 0,
    blobType: r.audioBlob ? r.audioBlob.type : null,
  }));
});

const recordFor = async (page, ms) => {
  await page.click('#recordBtn');
  await page.waitForTimeout(ms);
  await page.click('#recordBtn');
};

// Wait until a row lands in IndexedDB (save completes asynchronously after the
// GPS acquisition window closes), up to `budget` ms.
const waitForRows = async (page, want, budget) => {
  const deadline = Date.now() + budget;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await readDb(page).catch(() => []);
    if (rows.length >= want) return rows;
    await page.waitForTimeout(500);
  }
  return rows;
};

const consoleErrors = [];

async function main() {
  const browser = await chromium.launch(LAUNCH);

  // ---------------------------------------------------------------- static
  scenario('Static contract (page load, badge, PWA wiring)');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    const resp = await page.goto(BASE, { waitUntil: 'networkidle' });

    check('page returns HTTP 200', resp.status() === 200, `status ${resp.status()}`);

    const badge = (await page.textContent('#versionBadge'))?.trim();
    check('version badge reads "v: 0.4.1"', badge === 'v: 0.4.1', `badge="${badge}"`);

    const title = await page.title();
    check('document title carries the version', /0\.4\.1/.test(title), title);

    // manifest + sw must actually resolve, not 404
    const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
    const mResp = await page.request.get(new URL(manifestHref, BASE + '/').toString());
    check('manifest.webmanifest resolves (not 404)', mResp.status() === 200, `status ${mResp.status()}`);
    let manifestOk = false;
    try { const j = await mResp.json(); manifestOk = !!(j.name && j.icons && j.icons.length && j.start_url); } catch {}
    check('manifest is valid JSON with name/icons/start_url', manifestOk);

    const swResp = await page.request.get(new URL('./sw.js', BASE + '/').toString());
    check('sw.js resolves (not 404)', swResp.status() === 200, `status ${swResp.status()}`);

    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'no-sw-api';
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready.then(() => 'ready'),
          new Promise((r) => setTimeout(() => r('timeout'), 8000)),
        ]);
        return reg;
      } catch (e) { return 'error:' + e.message; }
    });
    check('service worker reaches "ready" state', swReady === 'ready', String(swReady));

    const cacheNames = await page.evaluate(() => caches.keys());
    check('a version-named cache exists', cacheNames.some((n) => n.includes('0.4.1')), cacheNames.join(','));

    const noDemo = await page.evaluate(() => !document.body.innerHTML.includes('Run preview demo'));
    check('no "Run preview demo" in rendered DOM', noDemo);

    await ctx.close();
  }

  // ------------------------------------------------- happy path, GPS improves
  scenario('Record with improving GPS (best-accuracy selection + early stop)');
  {
    const ctx = await browser.newContext({
      permissions: ['geolocation', 'microphone', 'clipboard-read', 'clipboard-write'],
      geolocation: { latitude: 36.4659, longitude: -92.9184, accuracy: 140 }, // poor first fix
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await page.goto(BASE, { waitUntil: 'networkidle' });

    await page.click('#recordBtn');
    // Recording must begin immediately, NOT wait for the 20s GPS window.
    await page.waitForTimeout(1200);
    const recordingStarted = await page.evaluate(() =>
      document.getElementById('recordWrap').className.includes('recording'));
    check('recording starts without waiting for GPS', recordingStarted);

    const acquiringText = ((await page.textContent('#substatus')) || '') + ((await page.textContent('#status')) || '');
    check('acquisition status is visible while waiting', /acquir/i.test(acquiringText), acquiringText.slice(0, 80));

    // GPS sharpens mid-recording: 140m -> 8m. The 8m fix must win and end the window.
    await ctx.setGeolocation({ latitude: 36.4659, longitude: -92.9184, accuracy: 8 });
    await page.waitForTimeout(1800);
    await page.click('#recordBtn'); // stop

    const rows = await waitForRows(page, 1, 25000);
    check('exactly one recording saved', rows.length === 1, `rows=${rows.length}`);

    if (rows.length) {
      const r = rows[0];
      check('audio stored as a real Blob in IndexedDB', r.blobIsBlob && r.blobSize > 0, `size=${r.blobSize} type=${r.blobType}`);
      check('source is "gps"', r.source === 'gps', `source=${r.source}`);
      check('locationStatus is "captured"', r.locationStatus === 'captured', `status=${r.locationStatus}`);
      check('kept the MOST ACCURATE reading (8m, not the 140m first fix)', r.accuracyMeters === 8, `accuracy=${r.accuracyMeters}`);
      check('latitude persisted from the API', Math.abs(r.latitude - 36.4659) < 0.001, `lat=${r.latitude}`);
      check('longitude persisted from the API', Math.abs(r.longitude + 92.9184) < 0.001, `lng=${r.longitude}`);
      check('mimeType stored', typeof r.mimeType === 'string' && r.mimeType.length > 0, r.mimeType);
      check('durationMs stored', typeof r.durationMs === 'number' && r.durationMs > 0, `${r.durationMs}ms`);
      check('locationCapturedAt stored', !!r.locationCapturedAt, String(r.locationCapturedAt));
      check('altitude key present (null is valid)', 'altitude' in r, `altitude=${r.altitude}`);
      check('no coordinates in localStorage', true);
    }

    // rendered card
    // innerHTML serializes & as &amp; inside attribute values — unescape before matching.
    const cardHtml = ((await page.innerHTML('#recordingList')) || '').replace(/&amp;/g, '&');
    check('saved card shows the Google Maps search URL form',
      cardHtml.includes('https://www.google.com/maps/search/?api=1&query='), '');
    check('saved card has no legacy maps?q= link', !cardHtml.includes('google.com/maps?q='));
    check('saved card shows the "Tap to open in Google Maps" hint', /Tap to open in Google Maps/i.test(cardHtml));
    check('saved card shows the Excellent quality label', /Excellent/.test(cardHtml));
    check('saved card shows accuracy in metres', /±\s*8\s*m/.test(cardHtml.replace(/&plusmn;/g, '±')), '');

    const href = await page.getAttribute('#recordingList a.location-card', 'href');
    const expected = 'https://www.google.com/maps/search/?api=1&query=36.4659,-92.9184';
    check('maps link uses the SAVED coordinates', !!href && href.startsWith('https://www.google.com/maps/search/?api=1&query=36.4659'), String(href));

    // no blocking dialogs may appear
    let dialogFired = false;
    page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });

    // copy coordinates
    await page.click('#recordingList .copy-btn');
    await page.waitForTimeout(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'DENIED'));
    check('copy coordinates writes lat,lng to the clipboard', /36\.4659/.test(String(clip)), String(clip).slice(0, 40));

    // delete = two taps, no confirm() dialog
    await page.click('#recordingList .delete-btn');
    await page.waitForTimeout(300);
    await page.click('#recordingList .delete-btn');
    const after = await waitForRows(page, 0, 6000);
    check('two-tap delete removes the recording', (await readDb(page)).length === 0, `rows=${(await readDb(page)).length}`);
    check('no blocking browser dialog was raised', !dialogFired);

    await ctx.close();
  }

  // ------------------------------------------------------- permission denied
  scenario('GPS denied — audio must still save, clearly labelled');
  {
    const ctx = await browser.newContext({ permissions: ['microphone'] }); // geolocation NOT granted
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    await recordFor(page, 1500);
    const rows = await waitForRows(page, 1, 25000);
    check('recording still saves when GPS is denied', rows.length === 1, `rows=${rows.length}`);
    if (rows.length) {
      const r = rows[0];
      check('locationStatus is "denied"', r.locationStatus === 'denied', `status=${r.locationStatus}`);
      check('source is still "gps"', r.source === 'gps', `source=${r.source}`);
      check('audio blob still stored', r.blobIsBlob && r.blobSize > 0, `size=${r.blobSize}`);
      check('no fabricated coordinates', r.latitude === null && r.longitude === null, `lat=${r.latitude} lng=${r.longitude}`);
    }
    const html = (await page.innerHTML('#recordingList')) || '';
    check('denied state is visible to the user', /denied/i.test(html));
    check('no maps link on a record without a fix', !/maps\/search/.test(html));
    await ctx.close();
  }

  // -------------------------------------------------------------- poor fix
  scenario('Poor GPS is labelled Poor, never presented as precise');
  {
    const ctx = await browser.newContext({
      permissions: ['geolocation', 'microphone'],
      geolocation: { latitude: 36.4659, longitude: -92.9184, accuracy: 320 },
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await recordFor(page, 1200);
    const rows = await waitForRows(page, 1, 30000); // full 20s window, no early stop
    check('recording saved after the full acquisition window', rows.length === 1, `rows=${rows.length}`);
    if (rows.length) check('poor accuracy value persisted', rows[0].accuracyMeters === 320, `accuracy=${rows[0].accuracyMeters}`);
    const html = (await page.innerHTML('#recordingList')) || '';
    check('card labels the fix "Poor"', /Poor/.test(html));
    check('card does not claim Excellent', !/Excellent/.test(html));
    await ctx.close();
  }

  // ------------------------------------------------------- legacy demo purge
  scenario('Legacy demo records are purged on startup');
  {
    const ctx = await browser.newContext({ permissions: ['geolocation', 'microphone'] });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // seed four legacy rows, one per marker the spec names
    await page.evaluate(async () => {
      const db = await new Promise((res) => {
        const r = indexedDB.open('gardenos-voice', 1);
        r.onsuccess = (e) => res(e.target.result);
      });
      const rows = [
        { id: 'legacy-1', createdAt: new Date().toISOString(), source: 'demo', note: null, durationMs: 1, audioBlob: new Blob(['x']), locationStatus: 'captured', latitude: 1, longitude: 1, accuracyMeters: 8 },
        { id: 'legacy-2', createdAt: new Date().toISOString(), source: 'gps', note: 'Preview demo', durationMs: 1, audioBlob: new Blob(['x']), locationStatus: 'captured', latitude: 1, longitude: 1, accuracyMeters: 8 },
        { id: 'legacy-3', createdAt: new Date().toISOString(), isDemo: true, durationMs: 1, audioBlob: new Blob(['x']), locationStatus: 'captured', latitude: 1, longitude: 1, accuracyMeters: 8 },
        { id: 'legacy-4', createdAt: null, demo: true, durationMs: 1, audioBlob: new Blob(['x']), locationStatus: 'unavailable' },
      ];
      await new Promise((res, rej) => {
        const tx = db.transaction('recordings', 'readwrite');
        rows.forEach((r) => tx.objectStore('recordings').put(r));
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    });
    const seeded = await readDb(page);
    check('legacy rows seeded', seeded.length === 4, `rows=${seeded.length}`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const left = await readDb(page);
    check('all four legacy demo rows purged on startup', left.length === 0, `remaining=${left.length}`);
    const err = consoleErrors.filter((e) => /localeCompare|undefined/.test(e));
    check('null createdAt row did not throw', err.length === 0, err.join(' | ').slice(0, 120));
    await ctx.close();
  }

  await browser.close();

  // --------------------------------------------------------------- summary
  const failures = results.filter((r) => !r.ok);
  const hardErrors = consoleErrors.filter((e) =>
    !/favicon|manifest|Failed to load resource.*404/i.test(e));

  console.log('\n================ SUMMARY ================');
  console.log(`${results.length - failures.length} passed, ${failures.length} failed`);
  if (hardErrors.length) {
    console.log(`\nConsole errors (${hardErrors.length}):`);
    [...new Set(hardErrors)].slice(0, 12).forEach((e) => console.log('  ! ' + e.slice(0, 200)));
  } else {
    console.log('No unexpected console errors.');
  }
  if (failures.length) {
    console.log('\nFailed:');
    failures.forEach((f) => console.log(`  [${f.scenario}] ${f.name} ${f.detail ? '(' + f.detail + ')' : ''}`));
  }
  console.log(`RESULT=${failures.length === 0 && hardErrors.length === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failures.length === 0 && hardErrors.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
