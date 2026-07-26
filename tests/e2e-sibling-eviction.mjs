#!/usr/bin/env node
// GardenOS sibling-eviction regression.
//
// The bug (now fixed in sw.js + location/sw.js): both service workers used
// to wipe every cache on the origin that was not their own current version.
// Because caches.keys() is origin-scoped, not worker-scoped, that meant each
// app silently destroyed the other app's offline shell. Installing GardenOS,
// then opening /location/ once, left the recorder cache alive and the
// GardenOS cache gone. The garden app then could not load offline, which is
// the exact failure this PWA exists to prevent.
//
// The test models the real device, in order:
//
//   1. Fresh browser context, install the root GardenOS worker, confirm
//      its cache exists and the page is controlled by that worker.
//   2. Visit /location/ for the first time. Let its worker install + activate.
//   3. Assert the GardenOS cache is still there (THE bug).
//   4. Return to the root. Assert the recorder's cache is still there.
//   5. Same-app upgrade: seed a stale-version GardenOS cache, reload, confirm
//      it got cleaned up (the sweep must still do its job for its own lineage).
//   6. Foreign-cache safety: seed a perimeter cache that is not ours at all,
//      reload, confirm it is left untouched.
//
//   node e2e-sibling-eviction.mjs http://127.0.0.1:8123/
//
// Exit 0 = every check passed.

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

const ROOT = (process.argv[2] || 'http://127.0.0.1:8123/').replace(/\/$/, '') + '/';
const REC  = ROOT + 'location/';
const APP_CACHE       = 'gardenos-app-v0.4.1';
const REC_CACHE       = 'gardenos-location-v0.4.1';
const STALE_APP_CACHE = 'gardenos-app-v0.4.0'; // simulates an old release
const FOREIGN_CACHE   = 'perimeter-poc-v0.1.0'; // belongs to a third app on this origin

const results = [];
let current = '';
const check = (name, ok, detail = '') => {
  results.push({ scenario: current, name, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   [${detail}]` : ''}`);
};
const scenario = (n) => { current = n; console.log(`\n### ${n}`); };

// Wait until the SW that controls the page has changed to a worker whose
// scriptURL ends with the given path (ignoring any ?v= cache-bust query).
// Returns the controller's scriptURL (or null if none).
const waitForController = async (page, scriptPath, budgetMs = 10000) => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const url = await page.evaluate(async (suffix) => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return null;
      const c = reg.active || reg.waiting || reg.installing;
      return c ? c.scriptURL : null;
    }, scriptPath).catch(() => null);
    if (url) {
      const pathOnly = url.split('?')[0];
      if (pathOnly.endsWith(scriptPath)) return url;
    }
    await page.waitForTimeout(150);
  }
  return null;
};

// Wait until a worker at the given scriptURL is the active controller for
// the page. Drives the worker through installing -> activated by reloading
// if needed.
const activateWorker = async (page, scriptSuffix) => {
  // Make sure the registration exists by loading the page at least once.
  await page.evaluate(async (swUrl) => {
    if (!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register(swUrl); } catch { /* may already exist */ }
  }, scriptSuffix);
  await waitForController(page, scriptSuffix);
  // Hard reload so the new controller actually controls the document.
  await page.reload({ waitUntil: 'networkidle' });
  await waitForController(page, scriptSuffix);
};

async function main() {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-capture',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  // Suppress the page's auto-registration of the SW so we control when
// install + activate happen. Without this, every page.goto triggers the
// activate handler before we have a chance to seed any caches — which
// makes the test vacuous (there is nothing left to evict).
const suppressAutoRegister = async (ctx) => {
  await ctx.addInitScript(() => {
    const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    let blocked = true;
    navigator.serviceWorker.register = function (...args) {
      if (blocked) {
        // Reject silently the way the page already catches with .catch.
        return Promise.reject(new Error('auto-register suppressed by test'));
      }
      return origRegister(...args);
    };
    // Expose a small unblock hook so the test can allow a register
    // through once it has its seeds in place.
    window.__unblockSwRegister = () => { blocked = false; };
  });
};

  // ============================================================
  // Sibling eviction: install root, then visit /location/, both
  // caches must survive.
  // ============================================================
  scenario('Root GardenOS cache survives a visit to /location/');
  {
    const ctx = await browser.newContext();
    await suppressAutoRegister(ctx);
    const page = await ctx.newPage();

    // 1. Visit root, install GardenOS worker, confirm its cache.
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__unblockSwRegister && window.__unblockSwRegister());
    await activateWorker(page, '/sw.js');
    const rootCtrl = await page.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL);
    check('root page is controlled by /sw.js after install',
      !!rootCtrl && rootCtrl.split('?')[0].endsWith('/sw.js'), String(rootCtrl));

    const afterRoot = await page.evaluate(() => caches.keys());
    check('GardenOS cache exists after install',
      afterRoot.includes(APP_CACHE), afterRoot.join(','));

    // 2. Visit /location/. The page will try to auto-register, but our
    // init script blocks it (we re-add it because navigating to a new
    // document starts a fresh script context, but addInitScript persists
    // across navigations in the same context).
    await page.goto(REC, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__unblockSwRegister && window.__unblockSwRegister());
    await activateWorker(page, '/location/sw.js');
    const recCtrl = await page.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL);
    check('recorder page is controlled by /location/sw.js after install',
      !!recCtrl && recCtrl.split('?')[0].endsWith('/location/sw.js'), String(recCtrl));

    // 3. THE bug: the recorder's activate handler used to wipe the root cache.
    const afterRec = await page.evaluate(() => caches.keys());
    check('GardenOS cache STILL EXISTS after /location/ activation',
      afterRec.includes(APP_CACHE),
      'caches=' + afterRec.join(',') + ' (must include ' + APP_CACHE + ')');
    check('recorder cache also exists after /location/ activation',
      afterRec.includes(REC_CACHE),
      'caches=' + afterRec.join(',') + ' (must include ' + REC_CACHE + ')');

    // 4. Return to root and confirm the recorder cache is still there.
    await page.goto(ROOT, { waitUntil: 'networkidle' });
    await waitForController(page, '/sw.js');
    // The recorder worker does not control root, but its cache must still
    // live in the origin-wide cache store.
    const afterReturn = await page.evaluate(() => caches.keys());
    check('recorder cache STILL EXISTS after returning to root',
      afterReturn.includes(REC_CACHE),
      'caches=' + afterReturn.join(',') + ' (must include ' + REC_CACHE + ')');

    await ctx.close();
  }

  // ============================================================
  // Same-app upgrade: a stale-version GardenOS cache MUST still be
  // cleaned up by the root worker (its lineage, its responsibility).
  // ============================================================
  scenario('Stale-version cache of the SAME app is still evicted');
  {
    const ctx = await browser.newContext();
    await suppressAutoRegister(ctx);
    const page = await ctx.newPage();

    // First load with auto-register blocked, so the SW is NOT installed
    // and the activate handler has not fired. Seed a stale-version
    // cache, then unblock the register and let the current SW install.
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);
    await page.evaluate(async (staleName) => {
      const c = await caches.open(staleName);
      await c.put(new Request('./index.html'), new Response('<html>stale</html>'));
    }, STALE_APP_CACHE);
    const seeded = await page.evaluate(() => caches.keys());
    check('stale-version GardenOS cache seeded',
      seeded.includes(STALE_APP_CACHE), seeded.join(','));

    await page.evaluate(() => window.__unblockSwRegister && window.__unblockSwRegister());
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => caches.keys());
    check('stale GardenOS cache was evicted by current worker',
      !after.includes(STALE_APP_CACHE),
      'caches=' + after.join(','));
    check('current GardenOS cache is present',
      after.includes(APP_CACHE),
      'caches=' + after.join(','));

    await ctx.close();
  }

  // ============================================================
  // Foreign cache safety: a perimeter cache that is nobody's lineage
  // here must be left untouched.
  // ============================================================
  scenario('A foreign cache on this origin is left alone');
  {
    const ctx = await browser.newContext();
    await suppressAutoRegister(ctx);
    const page = await ctx.newPage();

    // Phase 1: ROOT, seed foreign cache, then let the root SW install+activate.
    await page.goto(ROOT, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);
    await page.evaluate(async (foreignName) => {
      const c = await caches.open(foreignName);
      await c.put(new Request('./index.html'), new Response('<html>foreign</html>'));
    }, FOREIGN_CACHE);
    const seeded = await page.evaluate(() => caches.keys());
    check('foreign cache seeded on origin',
      seeded.includes(FOREIGN_CACHE), seeded.join(','));

    await page.evaluate(() => window.__unblockSwRegister && window.__unblockSwRegister());
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(1500);

    const afterRoot = await page.evaluate(() => caches.keys());
    check('foreign cache survived the ROOT worker activating',
      afterRoot.includes(FOREIGN_CACHE),
      'caches=' + afterRoot.join(','));

    // Phase 2: /location/. Seed nothing extra; let the recorder SW
    // install+activate and verify it also leaves the foreign cache alone.
    await page.goto(REC, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__unblockSwRegister && window.__unblockSwRegister());
    await page.evaluate(async () => {
      // Absolute path: the page is at /location/ so a relative URL would
      // resolve to /location/location/sw.js.
      await navigator.serviceWorker.register('/location/sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => caches.keys());
    check('foreign cache survived both workers activating',
      after.includes(FOREIGN_CACHE),
      'caches=' + after.join(','));

    await ctx.close();
  }

  await browser.close();

  const failures = results.filter((r) => !r.ok);
  console.log('\n================ SUMMARY ================');
  console.log(`${results.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailed:');
    failures.forEach((f) => console.log(`  [${f.scenario}] ${f.name} ${f.detail ? '(' + f.detail + ')' : ''}`));
  }
  console.log(`RESULT=${failures.length === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });