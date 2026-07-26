const CACHE = "gardenos-app-v0.4.1";
const PREFIX = "gardenos-app-";
// Every runtime asset must be listed here or the app degrades offline in exactly
// the situation it exists for: standing in a garden with one bar of signal.
// Rangers are barred from editing this file so parallel work cannot conflict on
// it; the Coordinator adds each new asset at integration.
const PRECACHE = [
  "./",
  "./index.html",
  "./voice-gps.js",
  "./manifest.webmanifest",
  "./js/router.js",
  "./js/confirm.js",
  "./vendor/sweetalert2.min.js",
  "./vendor/sweetalert2.min.css",
];
const APP_SHELL = "./index.html";

function isHtmlRequest(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.indexOf("text/html") !== -1;
}

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async function (url) {
      try {
        await cache.add(url);
      } catch (e) {
        // swallow per-entry failures so one bad entry cannot abort install
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(function (name) {
      if (name.startsWith(PREFIX) && name !== CACHE) return caches.delete(name);
      return null;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isHtmlRequest(req)) {
    event.respondWith((async function () {
      try {
        const networkResponse = await fetch(req);
        if (networkResponse.ok && networkResponse.status === 200 && networkResponse.type !== "opaque") {
          const cache = await caches.open(CACHE);
          try { cache.put(req, networkResponse.clone()); } catch (e) { /* do not cache failed writes */ }
        }
        return networkResponse;
      } catch (e) {
        const cached = await caches.match(APP_SHELL);
        if (cached) return cached;
        return new Response("Service Unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain" }
        });
      }
    })());
    return;
  }

  event.respondWith((async function () {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const networkResponse = await fetch(req);
      if (networkResponse.ok && networkResponse.status === 200 && networkResponse.type !== "opaque") {
        const cache = await caches.open(CACHE);
        try { cache.put(req, networkResponse.clone()); } catch (e) { /* do not cache failed writes */ }
      }
      return networkResponse;
    } catch (e) {
      return new Response("Offline", {
        status: 504,
        headers: { "Content-Type": "text/plain" }
      });
    }
  })());
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});