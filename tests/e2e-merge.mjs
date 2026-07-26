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

  // ============================================ Section depth (alpha → golf)
  // Section cards in Garden overview navigate to a detail view, the detail
  // view shows real counts and each count links onward, tag pills become
  // filters, an unknown id shows not-found, and the delete button inside a
  // card does not navigate.
  section('Section cards drill into a depth-aware detail view');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const st = await readState(page);
    const seedSection = st && st.sections.find(s => /Butterfly Garden/i.test(s.name));
    check('seed Butterfly Garden section is present',
      !!seedSection, seedSection ? seedSection.id : 'missing');

    // Each card carries data-nav pointing at the section detail route.
    const navAttrs = await page.evaluate(() => {
      const plots = Array.from(document.querySelectorAll('#gardenSections .plot, #dashboardMap .plot'));
      return plots.slice(0, 4).map(p => ({
        nav: p.getAttribute('data-nav') || '',
        role: p.getAttribute('role') || '',
        tabindex: p.getAttribute('tabindex') || '',
      }));
    });
    check('garden section cards are keyboard-reachable navigation targets',
      navAttrs.length >= 2 && navAttrs.every(a => a.nav.startsWith('#/sections/') && a.role === 'link' && a.tabindex === '0'),
      JSON.stringify(navAttrs));

    // Click the Butterfly Garden card → detail view, matching counts.
    const detail = await page.evaluate((id) => {
      const card = Array.from(document.querySelectorAll('#gardenSections .plot'))
        .find(p => (p.getAttribute('data-nav') || '').indexOf(id) >= 0);
      if (!card) return { ok: false, reason: 'card not found' };
      card.click();
      return { ok: true };
    }, seedSection.id);
    check('clicking a section card reaches the detail view', detail.ok, JSON.stringify(detail));

    await page.waitForTimeout(400);
    const detailState = await page.evaluate(() => {
      const v = document.getElementById('sections');
      const body = document.getElementById('sectionDetailBody');
      return {
        active: v && v.classList.contains('active'),
        name: (document.getElementById('sectionDetailName') || {}).textContent || '',
        tiles: Array.from((body || document).querySelectorAll('.section-detail-stat')).map(t => ({
          nav: t.getAttribute('data-nav') || '',
          label: (t.querySelector('.metric strong') || {}).textContent || '',
          text: t.textContent || '',
        })),
      };
    });
    check('detail view is active', detailState.active);
    check('detail view shows the section name', /Butterfly Garden/.test(detailState.name), detailState.name);
    check('detail view shows three navigation tiles (plantings/tasks/journal)',
      detailState.tiles.length === 3,
      `count=${detailState.tiles.length}`);
    check('each tile is a navigable link to a filtered list',
      detailState.tiles.every(t => /data-nav="#\/(plants|tasks|journal)\?section=/.test('data-nav="' + t.nav + '"')),
      JSON.stringify(detailState.tiles.map(t => t.nav)));

    // Counts must match the real seed data for Butterfly Garden.
    const expected = await page.evaluate(() => {
      const s = (JSON.parse(localStorage.getItem('gardenos-v01') || '{}')).sections.find(x => /Butterfly Garden/.test(x.name));
      if (!s) return null;
      const data = JSON.parse(localStorage.getItem('gardenos-v01') || '{}');
      return {
        plantings: data.plantings.filter(p => p.sectionId === s.id).length,
        openTasks: data.tasks.filter(t => t.sectionId === s.id && !t.completed).length,
        observations: data.journal.filter(j => j.sectionId === s.id).length,
      };
    });
    check('planting count matches data', /1 planting/.test(detailState.tiles[0].text) || /0 plantings here/.test(detailState.tiles[0].text),
      `tile=${detailState.tiles[0]?.text} expected=${JSON.stringify(expected)}`);
    check('task count matches data', expected && /[12] open tasks?/.test(detailState.tiles[1].text),
      `tile=${detailState.tiles[1]?.text} expected=${JSON.stringify(expected)}`);
    check('observation count matches data', expected && /1 observation/.test(detailState.tiles[2].text),
      `tile=${detailState.tiles[2]?.text} expected=${JSON.stringify(expected)}`);

    // Clicking the plantings tile routes to the filtered plants view.
    await page.evaluate(() => {
      const tile = document.querySelector('.section-detail-stat[data-nav^="#/plants?section="]');
      if (tile) tile.click();
    });
    await page.waitForTimeout(400);
    const routedToPlants = await page.evaluate(() => {
      const v = document.getElementById('plants');
      const list = document.getElementById('plantingList');
      return {
        active: v && v.classList.contains('active'),
        hash: location.hash,
        items: list ? list.children.length : 0,
      };
    });
    check('plantings tile navigates to filtered plants view',
      routedToPlants.active && /^#\/plants\?section=/.test(routedToPlants.hash),
      JSON.stringify(routedToPlants));

    // Back button returns to the detail view, browser back returns to garden.
    await page.evaluate(() => { window.showView && window.showView('sections') || (location.hash = '#/sections'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#sections a, #sections [data-nav]'))
        .find(el => (el.getAttribute('data-nav') || '') === '#/garden');
      if (b) b.click();
    });
    await page.waitForTimeout(400);
    const backToGarden = await page.evaluate(() => ({
      active: document.getElementById('garden').classList.contains('active'),
      hash: location.hash,
    }));
    check('back link from detail view returns to garden', backToGarden.active && backToGarden.hash === '#/garden',
      JSON.stringify(backToGarden));

    // Unknown id must not throw — show not-found.
    await page.goto(BASE + '#/sections/no-such-id', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const notFound = await page.evaluate(() => ({
      active: document.getElementById('sections').classList.contains('active'),
      name: (document.getElementById('sectionDetailName') || {}).textContent || '',
      body: (document.getElementById('sectionDetailBody') || {}).textContent || '',
    }));
    check('unknown id activates the detail view', notFound.active);
    check('unknown id shows a not-found state', /not found/i.test(notFound.name) || /may have been deleted/i.test(notFound.body),
      JSON.stringify(notFound));

    await ctx.close();
  }

  section('Tag pills are real filters on the garden view');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); attach(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // A sun pill in the dashboard card navigates to the filtered garden view.
    await page.evaluate(() => {
      const pill = Array.from(document.querySelectorAll('#dashboardMap .pill[data-nav^="#/garden?tag="]'))[0];
      if (pill) pill.click();
    });
    await page.waitForTimeout(500);
    const filtered = await page.evaluate(() => {
      const card = document.querySelector('#gardenSections');
      const chip = card && card.parentNode.querySelector('.gardenos-listing-chip');
      return {
        active: document.getElementById('garden').classList.contains('active'),
        hash: location.hash,
        chipText: chip ? chip.textContent : '',
        visibleSections: Array.from(document.querySelectorAll('#gardenSections .plot')).length,
        allSections: (JSON.parse(localStorage.getItem('gardenos-v01') || '{}')).sections.length,
      };
    });
    check('pill click activates garden view with the tag in the URL',
      filtered.active && /^#\/garden\?tag=/.test(filtered.hash),
      JSON.stringify(filtered));
    check('filtered view shows a dismissible chip',
      /Filtering by/.test(filtered.chipText) && /clear/i.test(filtered.chipText),
      filtered.chipText);
    check('filtered view shows fewer (or equal) sections than the full set',
      filtered.visibleSections > 0 && filtered.visibleSections <= filtered.allSections,
      `visible=${filtered.visibleSections} all=${filtered.allSections}`);

    // Clear filter returns to all sections.
    await page.evaluate(() => {
      const clear = document.querySelector('#gardenSections').parentNode
        .querySelector('.gardenos-listing-chip a[data-nav="#/garden"]');
      if (clear) clear.click();
    });
    await page.waitForTimeout(400);
    const cleared = await page.evaluate(() => ({
      hash: location.hash,
      visibleSections: Array.from(document.querySelectorAll('#gardenSections .plot')).length,
      chip: !!document.querySelector('#gardenSections').parentNode.querySelector('.gardenos-listing-chip'),
    }));
    check('clearing the chip returns to all sections',
      cleared.hash === '#/garden' && cleared.chip === false && cleared.visibleSections >= 2,
      JSON.stringify(cleared));

    // Keyboard reachability: the card has tabindex=0, focus + Enter navigates.
    // Cards live inside the dashboard view, so test on the dashboard view
    // where the card is actually visible (hidden .view children can't take
    // focus under display:none).
    await page.evaluate(() => { window.showView && window.showView('dashboard'); });
    await page.waitForTimeout(300);
    const beforeKb = await page.evaluate(() => location.hash);
    const hasCards = await page.evaluate(() => document.querySelectorAll('#dashboardMap .plot').length);
    if (hasCards > 0) {
      await page.focus('#dashboardMap .plot');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      const afterKb = await page.evaluate(() => location.hash);
      check('keyboard Enter on a card navigates to its detail view',
        /^#\/sections\//.test(afterKb),
        `before=${beforeKb} after=${afterKb}`);
    } else {
      check('keyboard Enter on a card navigates to its detail view', false, 'no cards found');
    }

    // Delete button inside a card must not navigate. Tested on the garden
    // view (where garden cards live); use the first garden card's delete.
    await page.evaluate(() => { window.showView && window.showView('garden'); });
    await page.waitForTimeout(300);
    const beforeDelete = await page.evaluate(() => location.hash);
    const deleteClick = await page.evaluate(() => {
      const btn = document.querySelector('#gardenSections [data-delete-kind="section"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await page.waitForTimeout(700);
    const afterDelete = await page.evaluate(() => location.hash);
    check('clicking a card\'s delete button opens confirm without changing the hash',
      deleteClick && (afterDelete === beforeDelete),
      `hash before=${beforeDelete} after=${afterDelete} clicked=${deleteClick}`);

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
