#!/usr/bin/env node
// GardenOS merged app: end-to-end browser verification.
// Drives the real merged app in Chromium with a fake microphone and scripted GPS.
// Proves BOTH that voice+GPS capture works AND that GardenOS v0.1 lost nothing.
//
//   node e2e-merge.mjs http://localhost:8124/

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

const BASE = process.argv[2] || 'http://localhost:8124/';
const results = [];
let phase = '';
const check = (name, ok, detail = '') => {
  results.push({ phase, name, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   [${detail}]` : ''}`);
};
const section = (n) => { phase = n; console.log(`\n### ${n}`); };

const LAUNCH = { args: [
  '--use-fake-device-for-media-capture',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
]};

const consoleErrors = [];
const attach = (page) => {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
};

// read the app's localStorage state
const readState = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('gardenos-v01') || localStorage.getItem('gardenos-v02');
  return raw ? JSON.parse(raw) : null;
});

// read audio rows out of IndexedDB
const readAudio = (page) => page.evaluate(async () => {
  const names = (await indexedDB.databases?.()) || [];
  const target = names.find(d => /garden/i.test(d.name || ''));
  if (!target) return { db: null, rows: [] };
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(target.name);
    r.onsuccess = e => res(e.target.result); r.onerror = () => rej(r.error);
  });
  const store = [...db.objectStoreNames][0];
  if (!store) return { db: target.name, rows: [] };
  const rows = await new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).getAll();
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  return { db: target.name, store, rows: rows.map(r => {
    const blob = r instanceof Blob ? r : (r.blob || r.audioBlob || r.audio);
    return { isBlob: blob instanceof Blob, size: blob ? blob.size : 0, type: blob ? blob.type : null };
  })};
});

// The record button pulses while recording, so Playwright sees it as "not stable".
// Tap it via JS, which is what a real tap ends up doing anyway.
const tapRecord = (page) => page.evaluate(() => {
  const b = document.querySelector('#recordBtn, .record-btn, [data-action="record"]');
  if (!b) return false; b.click(); return true;
});

const waitFor = async (fn, budget = 25000, every = 500) => {
  const end = Date.now() + budget;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, every)); }
  return null;
};

async function main() {
  const browser = await chromium.launch(LAUNCH);

  // ============================================ v0.1 regression, no permissions
  section('GardenOS v0.1 still works (regression)');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
    check('app loads 200', resp.status() === 200, `status ${resp.status()}`);
    check('title is GardenOS', /GardenOS/i.test(await page.title()), await page.title());

    const st = await readState(page);
    check('seed state present in localStorage', !!st && Array.isArray(st.sections), st ? `sections=${st.sections.length}` : 'null');
    check('seed section "Butterfly Garden" present',
      !!st && st.sections.some(s => /Butterfly Garden/i.test(s.name)));
    check('journal array exists', !!st && Array.isArray(st.journal));
    check('profile preserved', !!st && !!st.profile && /Roberto/i.test(st.profile.name || ''), st?.profile?.name);

    // every v0.1 view must still be reachable
    const views = await page.evaluate(() => {
      const out = {};
      for (const v of ['dashboard','garden','plants','tasks','journal','settings']) {
        try { window.showView && window.showView(v); out[v] = true; } catch { out[v] = false; }
      }
      return out;
    });
    check('all six views callable', Object.values(views).every(Boolean), JSON.stringify(views));

    // core functions still defined
    const fns = await page.evaluate(() => ['addSection','addPlanting','addTask','addJournal',
      'toggleTask','deleteTask','deletePlanting','deleteJournal','deleteSection','saveProfile',
      'resetDemo','render','renderJournal','renderRecommendations','syncSelects']
      .filter(n => typeof window[n] !== 'function'));
    check('all v0.1 handlers still defined', fns.length === 0, fns.length ? 'missing: ' + fns.join(',') : 'all present');

    await ctx.close();
  }

  // ============================================ voice + GPS capture
  section('Voice note with GPS creates a journal entry');
  {
    const ctx = await browser.newContext({
      permissions: ['geolocation', 'microphone', 'clipboard-read', 'clipboard-write'],
      geolocation: { latitude: 36.46596379, longitude: -92.91844979, accuracy: 150 },
    });
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const api = await page.evaluate(() => {
      const g = window.GardenVoice;
      if (!g) return null;
      return ['acquireLocation','startRecording','stopRecording','isRecording','saveAudio',
              'getAudioUrl','deleteAudio','qualityLabel','mapsUrl'].filter(m => typeof g[m] !== 'function');
    });
    check('window.GardenVoice is loaded', api !== null);
    check('GardenVoice exposes the full API', api && api.length === 0, api ? 'missing: ' + api.join(',') : 'absent');

    const before = (await readState(page))?.journal.length ?? -1;

    // the record control lives in the journal view, so navigate there first
    await page.evaluate(() => window.showView && window.showView('journal'));
    await page.waitForTimeout(400);
    const rec = await page.$('#recordBtn, .record-btn, [data-action="record"]');
    check('record control exists in the UI', !!rec);
    if (rec) {
      await tapRecord(page);
      await page.waitForTimeout(1200);
      const recording = await page.evaluate(() => window.GardenVoice?.isRecording?.() === true);
      check('recording starts immediately (not blocked on GPS)', recording);

      // GPS sharpens mid-recording: 150m -> 7m. Best fix must win.
      await ctx.setGeolocation({ latitude: 36.46596379, longitude: -92.91844979, accuracy: 7 });
      await page.waitForTimeout(1800);
      await tapRecord(page);
    }

    const st = await waitFor(async () => {
      const s = await readState(page);
      return s && s.journal.length > before ? s : null;
    }, 28000);
    check('a new journal entry was created', !!st, st ? `journal=${st.journal.length}` : 'none');

    if (st) {
      const e = st.journal.find(x => x.source === 'gps') || st.journal[0];
      check('entry has source "gps"', e.source === 'gps', `source=${e.source}`);
      check('entry has an audioId', !!e.audioId, String(e.audioId));
      check('entry stores latitude', Math.abs((e.latitude ?? 0) - 36.46596379) < 0.001, `lat=${e.latitude}`);
      check('entry stores longitude', Math.abs((e.longitude ?? 0) + 92.91844979) < 0.001, `lng=${e.longitude}`);
      check('kept the most accurate fix (7m not 150m)', e.accuracyMeters === 7, `accuracy=${e.accuracyMeters}`);
      check('locationStatus captured', e.locationStatus === 'captured', `status=${e.locationStatus}`);
      check('entry keeps the v0.1 shape (title/date/sectionId)',
        !!e.title && !!e.date && 'sectionId' in e, `title="${e.title}" date=${e.date}`);
      check('entry filed to a garden section', !!e.sectionId, String(e.sectionId));
    }

    // audio must be in IndexedDB, never in localStorage
    const audio = await readAudio(page);
    check('audio blob stored in IndexedDB', audio.rows.some(r => r.isBlob && r.size > 0),
      `db=${audio.db} rows=${audio.rows.length} size=${audio.rows[0]?.size}`);
    const lsSize = await page.evaluate(() => (localStorage.getItem('gardenos-v01')||localStorage.getItem('gardenos-v02')||'').length);
    check('localStorage stayed small (no blob smuggled in)', lsSize < 60000, `${lsSize} chars`);

    // rendered journal
    await page.evaluate(() => window.showView && window.showView('journal'));
    await page.waitForTimeout(1200);
    const html = (await page.content()).replace(/&amp;/g, '&');
    check('journal renders an audio player', /<audio/i.test(html));
    check('journal renders the Google Maps search link',
      html.includes('https://www.google.com/maps/search/?api=1&query='));
    check('journal shows a GPS quality label', /Excellent|Good|Poor/.test(html));
    check('journal shows the maps hint', /Tap to open in Google Maps/i.test(html));

    await ctx.close();
  }

  // ============================================ GPS denied
  section('GPS denied: the voice note still saves');
  {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const before = (await readState(page))?.journal.length ?? 0;
    await page.evaluate(() => window.showView && window.showView('journal'));
    await page.waitForTimeout(400);
    const rec = await page.$('#recordBtn, .record-btn, [data-action="record"]');
    if (rec) { await tapRecord(page); await page.waitForTimeout(1500); await tapRecord(page); }
    const st = await waitFor(async () => {
      const s = await readState(page); return s && s.journal.length > before ? s : null;
    }, 28000);
    check('entry saved without a GPS fix', !!st, st ? `journal=${st.journal.length}` : 'none');
    if (st) {
      const e = st.journal.find(x => x.source === 'gps') || st.journal[0];
      check('locationStatus is denied', e.locationStatus === 'denied', `status=${e.locationStatus}`);
      check('no fabricated coordinates', e.latitude == null && e.longitude == null, `lat=${e.latitude}`);
      check('audio still captured', !!e.audioId);
    }
    await ctx.close();
  }

  // ============================================ legacy entries still render
  section('Pre-existing typed journal entries still render');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const key = localStorage.getItem('gardenos-v01') ? 'gardenos-v01' : 'gardenos-v02';
      const s = JSON.parse(localStorage.getItem(key));
      s.journal.push({ id: 'legacy-typed-1', title: 'Old typed note', date: '2026-01-15',
        sectionId: s.sections[0].id, tags: ['legacy'], description: 'Written before voice existed.' });
      localStorage.setItem(key, JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.showView && window.showView('journal'));
    await page.waitForTimeout(900);
    const html = await page.content();
    check('legacy entry title renders', /Old typed note/.test(html));
    check('legacy entry body renders', /Written before voice existed/.test(html));
    check('legacy entry did not crash the render', !consoleErrors.some(e => /journal/i.test(e)));
    await ctx.close();
  }

  // ============================================ recommendations drill down to evidence
  // Hotel slice: each recommendation card must carry data-nav that reaches the
  // actual matching records. Pest-monitoring recommendation must point at the
  // journal entries that contain the matched word — not a generic list.
  section('Recommendation cards drill down to the matching records');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Seed two journal entries: one with the matched word, one without.
    await page.evaluate(() => {
      const key = localStorage.getItem('gardenos-v01') ? 'gardenos-v01' : 'gardenos-v02';
      const s = JSON.parse(localStorage.getItem(key));
      const matchId = 'test-match-1';
      const noMatchId = 'test-nomatch-1';
      // remove any prior runs
      s.journal = (s.journal || []).filter(j => j.id !== matchId && j.id !== noMatchId);
      s.journal.push({
        id: matchId, title: 'Aphid colony on rose',
        date: '2026-07-20', sectionId: s.sections[0].id,
        tags: ['pest', 'aphid'],
        description: 'No beetle damage observed; aphids are the current pest concern.',
      });
      s.journal.push({
        id: noMatchId, title: 'Watering log',
        date: '2026-07-21', sectionId: s.sections[1].id,
        tags: ['watering'],
        description: 'Deep-watered the tomatoes this morning. No pest activity noted.',
      });
      localStorage.setItem(key, JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.showView && window.showView('dashboard'));
    await page.waitForTimeout(700);

    // 1) Pest-monitoring recommendation exists, carries data-nav, and reaches a list.
    const recInfo = await page.evaluate(() => {
      const recs = Array.from(document.querySelectorAll('#recommendations .recommendation'));
      const pest = recs.find(r => /pest monitoring/i.test(r.textContent || ''));
      if (!pest) return { found: false };
      return {
        found: true,
        nav: pest.getAttribute('data-nav'),
        isLink: pest.getAttribute('role') === 'link' && pest.getAttribute('tabindex') === '0',
      };
    });
    check('pest-monitoring recommendation is rendered', recInfo.found);
    check('pest-monitoring recommendation is keyboard reachable (role+tabindex)',
      !!recInfo.found && recInfo.isLink);
    check('pest-monitoring recommendation carries a drill-down data-nav',
      !!recInfo.found && typeof recInfo.nav === 'string' && recInfo.nav.startsWith('#/journal'),
      recInfo.nav || 'none');

    // 2) Clicking the recommendation reaches the journal view and shows ONLY matching entries.
    await page.evaluate(() => {
      const rec = Array.from(document.querySelectorAll('#recommendations .recommendation'))
        .find(r => /pest monitoring/i.test(r.textContent || ''));
      if (rec) rec.click();
    });
    await page.waitForTimeout(600);
    const onJournal = await page.evaluate(() =>
      document.getElementById('journal')?.classList.contains('active'));
    check('clicking the recommendation navigates to the journal view', onJournal);

    const reachedMatch = await page.evaluate(() =>
      !!document.querySelector('.journal-entry[data-entry-id="test-match-1"]'));
    const didNotReachNoMatch = await page.evaluate(() =>
      !document.querySelector('.journal-entry[data-entry-id="test-nomatch-1"]'));
    check('drill-down reaches the entry that contained the matched word', reachedMatch);
    check('drill-down does NOT reach the entry that had no match', didNotReachNoMatch);

    // 3) The clear-filter chip returns to the full journal.
    await page.evaluate(() => {
      const a = document.querySelector('.gardenos-listing-chip a');
      if (a) a.click();
    });
    await page.waitForTimeout(500);
    const both = await page.evaluate(() =>
      !!document.querySelector('.journal-entry[data-entry-id="test-match-1"]') &&
      !!document.querySelector('.journal-entry[data-entry-id="test-nomatch-1"]'));
    check('clearing the filter returns the full journal list', both);

    // 4) The pollinator recommendation reaches the named section (not a generic landing).
    const pollinatorInfo = await page.evaluate(() => {
      const recs = Array.from(document.querySelectorAll('#recommendations .recommendation'));
      const poll = recs.find(r => /pollinator/i.test(r.textContent || ''));
      return poll ? poll.getAttribute('data-nav') : null;
    });
    check('pollinator recommendation, when present, points at a specific section',
      pollinatorInfo === null || pollinatorInfo.startsWith('#/sections/'),
      pollinatorInfo || 'no pollinator rec (acceptable)');

    // 5) The fallback "stable" recommendation does not advertise a drill-down.
    const fallbackInfo = await page.evaluate(() => {
      const recs = Array.from(document.querySelectorAll('#recommendations .recommendation'));
      const fallback = recs.find(r => /stable/i.test(r.textContent || ''));
      if (!fallback) return null;
      return {
        nav: fallback.getAttribute('data-nav'),
        isLink: fallback.getAttribute('role') === 'link',
      };
    });
    check('"garden is stable" fallback does not promise drill-down it cannot keep',
      fallbackInfo === null || fallbackInfo.nav === null,
      fallbackInfo ? `nav=${fallbackInfo.nav}` : 'no fallback rec (acceptable)');

    await ctx.close();
  }

  // ============================================ journal entries open detail, tags filter
  // Hotel slice: clicking a journal entry opens its detail view. Tags on an
  // entry act as filters. Voice note entry still renders its audio element.
  // Delete still works and does not navigate.
  section('Journal entries open detail; tags filter; voice still plays');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Seed a typed journal entry plus a tag we can filter on.
    await page.evaluate(() => {
      const key = localStorage.getItem('gardenos-v01') ? 'gardenos-v01' : 'gardenos-v02';
      const s = JSON.parse(localStorage.getItem(key));
      s.journal.push({
        id: 'test-typed-1',
        title: 'Inspect pollinator bed',
        date: '2026-07-22',
        sectionId: s.sections[0].id,
        tags: ['pollinator', 'inspection'],
        description: 'Visited the pollinator bed at dusk to count visitors.',
      });
      localStorage.setItem(key, JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.showView && window.showView('journal'));
    await page.waitForTimeout(700);

    // 1) The entry exists, is keyboard reachable, and carries data-nav.
    const entryInfo = await page.evaluate(() => {
      const el = document.querySelector('.journal-entry[data-entry-id="test-typed-1"]');
      if (!el) return null;
      return {
        nav: el.getAttribute('data-nav'),
        role: el.getAttribute('role'),
        tab: el.getAttribute('tabindex'),
      };
    });
    check('seeded journal entry renders', !!entryInfo);
    check('seeded journal entry is keyboard reachable', !!entryInfo && entryInfo.role === 'link' && entryInfo.tab === '0');
    check('seeded journal entry carries data-nav to its detail',
      !!entryInfo && entryInfo.nav === '#/journal/test-typed-1',
      entryInfo ? entryInfo.nav : 'none');

    // 2) Click opens the detail view and hides the list.
    await page.evaluate(() => {
      const el = document.querySelector('.journal-entry[data-entry-id="test-typed-1"]');
      if (el) el.click();
    });
    await page.waitForTimeout(500);
    const detail = await page.evaluate(() => {
      const d = document.getElementById('journalDetail');
      const l = document.getElementById('journalList');
      return {
        detailVisible: d && !d.hidden && /Inspect pollinator bed/.test(d.textContent || ''),
        listHidden: l && l.hidden === true,
        backLink: d && !!d.querySelector('a[href="#/journal"]'),
      };
    });
    check('clicking the entry opens its detail', detail.detailVisible);
    check('detail view hides the list while open', detail.listHidden);
    check('detail view offers a back link', detail.backLink);

    // 3) Back link returns to the full list.
    await page.evaluate(() => {
      const a = document.querySelector('#journalDetail a[href="#/journal"]');
      if (a) a.click();
    });
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => {
      const d = document.getElementById('journalDetail');
      const l = document.getElementById('journalList');
      return { detailHidden: d && d.hidden, listVisible: l && !l.hidden };
    });
    check('back link returns to the full journal list', back.detailHidden && back.listVisible);

    // 4) Tag click filters the list and shows the active-filter chip.
    await page.evaluate(() => {
      const tag = document.querySelector('.journal-entry[data-entry-id="test-typed-1"] .pill-link');
      if (tag) tag.click();
    });
    await page.waitForTimeout(500);
    const filterState = await page.evaluate(() => {
      const chip = document.querySelector('.gardenos-listing-chip');
      const entry = document.querySelector('.journal-entry[data-entry-id="test-typed-1"]');
      // any entry whose tags include "pollinator" should still be in the list
      const noTagEntry = document.querySelector('.journal-entry[data-entry-id="test-nomatch-2"]');
      return {
        chipVisible: !!chip && /pollinator/.test(chip.textContent || ''),
        seededEntryStillVisible: !!entry,
      };
    });
    check('tag click shows the active-filter chip with the tag name', filterState.chipVisible);
    check('tag-filtered list still includes entries that carry the tag',
      filterState.seededEntryStillVisible);

    // 5) Voice-note entry still renders an audio element after these changes.
    // Seed a journal entry that references a real audio recording in IndexedDB.
    const audioId = 'test-audio-survives-1';
    await page.evaluate((aid) => {
      const key = localStorage.getItem('gardenos-v01') ? 'gardenos-v01' : 'gardenos-v02';
      const s = JSON.parse(localStorage.getItem(key));
      s.journal = (s.journal || []).filter(j => j.id !== 'test-voice-1');
      s.journal.push({
        id: 'test-voice-1',
        title: 'Voice note survival check',
        date: '2026-07-23',
        sectionId: s.sections[0].id,
        tags: ['voice'],
        description: 'A voice note that must survive the navigation rework.',
        source: 'gps',
        audioId: aid,
        durationMs: 1500,
      });
      localStorage.setItem(key, JSON.stringify(s));
      // seed an IndexedDB recording row matching that audioId
      const open = indexedDB.open('gardenos-audio', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('recordings')) {
          db.createObjectStore('recordings', { keyPath: 'id' });
        }
      };
      return new Promise((res) => {
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('recordings', 'readwrite');
          tx.objectStore('recordings').put({
            id: aid,
            savedAt: new Date().toISOString(),
            mimeType: 'audio/webm',
            durationMs: 1500,
            blob: new Blob(['x'.repeat(64)], { type: 'audio/webm' }),
          });
          tx.oncomplete = () => res(true);
          tx.onerror = () => res(false);
        };
      });
    }, audioId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.showView && window.showView('journal'));
    await page.waitForTimeout(900);

    const audioInfo = await page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll('.journal-entry audio[data-audio-id]'));
      const ours = audios.find(a => a.getAttribute('data-audio-id') === 'test-audio-survives-1');
      return {
        count: audios.length,
        ourRendered: !!ours,
        ourSrcAfterAttach: ours ? (ours.src || '').slice(0, 16) : '',
      };
    });
    check('journal entry with audioId still renders an <audio> element',
      audioInfo.ourRendered, `count=${audioInfo.count} src=${audioInfo.ourSrcAfterAttach}`);
    // Give the async attach a moment, then verify the audio got its blob: URL.
    await page.waitForTimeout(700);
    const audioSrc = await page.evaluate(() => {
      const a = document.querySelector('.journal-entry audio[data-audio-id="test-audio-survives-1"]');
      return a ? a.src : '';
    });
    check('audio element receives a blob: URL after attachAudioElements',
      audioSrc.startsWith('blob:'), audioSrc.slice(0, 24));

    // 6) Delete button still works and does NOT navigate to the detail view.
    await page.evaluate(async () => {
      const btn = document.querySelector('.journal-entry[data-entry-id="test-typed-1"] [data-delete-kind="journal"]');
      if (!btn) return;
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      const confirmBtn = document.querySelector('.swal2-confirm');
      if (confirmBtn) confirmBtn.click();
    });
    await page.waitForTimeout(900);
    const stillOnList = await page.evaluate(() => {
      const d = document.getElementById('journalDetail');
      const l = document.getElementById('journalList');
      const entry = document.querySelector('.journal-entry[data-entry-id="test-typed-1"]');
      return {
        detailHidden: d && d.hidden,
        listVisible: l && !l.hidden,
        entryRemoved: !entry,
      };
    });
    check('delete does not navigate into the detail view', stillOnList.detailHidden && stillOnList.listVisible);
    check('delete removes the entry from the list', stillOnList.entryRemoved);

    await ctx.close();
  }

  // ============================================ delete handler survives adversarial names
  // Regression for the attribute-injection hole: previously the item name was
  // interpolated into an inline onclick="..." attribute, so a name containing
  // a double quote closed the attribute early, the parser invented junk
  // attributes, the handler was truncated, and clicking threw "Invalid or
  // unexpected token". The fix removes the name from markup entirely; this
  // case seeds an adversarial name and proves the delete button + dialog
  // behave correctly.
  section('Delete button survives quotes, brackets, and tags in item names');
  {
    const ADVERSARIAL = `My "big"<bed' & roses`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    await page.evaluate((name) => {
      const key = localStorage.getItem('gardenos-v01') ? 'gardenos-v01' : 'gardenos-v02';
      const s = JSON.parse(localStorage.getItem(key));
      s.sections.push({
        id: 'sec-attack', name: name,
        description: 'adversarial section', sun: 'full', soil: 'loam',
      });
      localStorage.setItem(key, JSON.stringify(s));
    }, ADVERSARIAL);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.showView && window.showView('garden'));
    await page.waitForTimeout(700);

    // 1) Button exists and carries the exact attribute set, with nothing invented
    const btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('[data-delete-kind="section"][data-delete-id="sec-attack"]');
      if (!btn) return null;
      return {
        attrs: Array.from(btn.attributes).map(a => a.name).sort(),
        onclick: btn.getAttribute('onclick') || '',
      };
    });
    const EXPECTED_ATTRS = ['class','data-delete-id','data-delete-kind','data-icon','onclick','style','title'];
    check('delete button exists for seeded section', !!btnInfo);
    check('button attribute set is exact (no invented attrs from quote injection)',
      !!btnInfo && JSON.stringify(btnInfo.attrs) === JSON.stringify(EXPECTED_ATTRS),
      btnInfo ? btnInfo.attrs.join(',') : 'null');
    check('onclick value is exactly gardenAskDelete(this) — no truncation',
      !!btnInfo && btnInfo.onclick === 'gardenAskDelete(this)',
      btnInfo ? btnInfo.onclick : 'null');

    // 2) Click opens the confirm dialog with no page error
    const errorsBefore = consoleErrors.length;
    await page.evaluate(() => {
      const btn = document.querySelector('[data-delete-kind="section"][data-delete-id="sec-attack"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(900);
    const dialogOpen = await page.evaluate(() => !!document.querySelector('.swal2-popup, .garden-confirm'));
    check('click opens the confirm dialog', dialogOpen);
    const clickErrors = consoleErrors.slice(errorsBefore)
      .filter(e => !/favicon|404 \(Not Found\)|sw\.js/i.test(e));
    check('click did not raise a page error', clickErrors.length === 0,
      clickErrors.slice(0,2).join(' | '));

    // 3) Dialog displays the name correctly, quotes + bracket intact, not double-escaped
    const dialogText = await page.evaluate(() => {
      const el = document.querySelector('.garden-confirm__item');
      return el ? el.textContent : null;
    });
    check('dialog shows the section name with quotes + bracket intact (no double-escape)',
      dialogText === ADVERSARIAL,
      `got=${JSON.stringify(dialogText)} expected=${JSON.stringify(ADVERSARIAL)}`);

    // 4) Cancel leaves the item present
    await page.evaluate(() => {
      const cancel = document.querySelector('.swal2-cancel');
      if (cancel) cancel.click();
    });
    await page.waitForTimeout(600);
    let st = await readState(page);
    check('cancel preserves the seeded item',
      !!st && st.sections.some(s => s.id === 'sec-attack'));

    // 5) Confirm removes it
    await page.evaluate(() => {
      const btn = document.querySelector('[data-delete-kind="section"][data-delete-id="sec-attack"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const confirmBtn = document.querySelector('.swal2-confirm');
      if (confirmBtn) confirmBtn.click();
    });
    await page.waitForTimeout(900);
    st = await readState(page);
    check('confirm removes the seeded item',
      !!st && !st.sections.some(s => s.id === 'sec-attack'));

    await ctx.close();
  }

  await browser.close();

  const failures = results.filter(r => !r.ok);
  const hard = consoleErrors.filter(e => !/favicon|404 \(Not Found\)|sw\.js/i.test(e));
  console.log('\n================ SUMMARY ================');
  console.log(`${results.length - failures.length} passed, ${failures.length} failed`);
  if (hard.length) { console.log(`Console errors (${hard.length}):`); [...new Set(hard)].slice(0,10).forEach(e => console.log('  ! ' + e.slice(0,180))); }
  else console.log('No unexpected console errors.');
  if (failures.length) { console.log('\nFailed:'); failures.forEach(f => console.log(`  [${f.phase}] ${f.name} ${f.detail ? '('+f.detail+')' : ''}`)); }
  console.log(`RESULT=${failures.length === 0 && hard.length === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failures.length === 0 && hard.length === 0 ? 0 : 1);
}
main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
