// GardenOS Location service worker.
// Cache-correctness contract: any bad caching here permanently traps users on
// an old release. Network-first for HTML, cache-first for static assets, and
// purge every cache whose name isn't the current version.

(function () {
  "use strict";

  var CACHE = "gardenos-location-v0.4.1";
  // The shell: index.html, the manifest, and the directory root. Relative
  // paths because this app lives under /gardenos-location-mvp/ on GitHub
  // Pages — absolute paths would 404 in production.
  var PRECACHE = ["./", "./index.html", "./manifest.webmanifest"];
  var OFFLINE_HTML_BODY =
    "Offline. Open GardenOS Location while connected to load the app.";

  self.addEventListener("install", function (event) {
    // Precache each entry individually so a single 404 cannot abort install
    // (an aborted install means the app shell never gets cached at all).
    event.waitUntil(
      caches.open(CACHE).then(function (cache) {
        return Promise.all(
          PRECACHE.map(function (url) {
            return cache.add(url).catch(function () {
              // Per-entry swallow. Install must still succeed.
            });
          })
        );
      }).then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener("activate", function (event) {
    // Delete every cache whose name isn't the current version. This is what
    // makes an old release's cache disappear on upgrade.
    event.waitUntil(
      caches.keys().then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (name !== CACHE) {
              return caches.delete(name);
            }
            return null;
          })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  self.addEventListener("message", function (event) {
    // Support {type:"SKIP_WAITING"} from the page so a new SW can take over
    // without forcing a reload.
    if (event && event.data && event.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });

  function isHtmlRequest(request) {
    if (request && request.mode === "navigate") return true;
    var accept = request && request.headers && request.headers.get
      ? request.headers.get("accept")
      : null;
    return typeof accept === "string" && accept.indexOf("text/html") !== -1;
  }

  function offlineResponse() {
    return new Response(OFFLINE_HTML_BODY, {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  self.addEventListener("fetch", function (event) {
    var request = event && event.request;
    if (!request) return;

    // Only handle GET. Anything else (POST, etc.) goes straight through to
    // the network so we never break form submissions or other methods.
    if (request.method !== "GET") return;

    // Same-origin only. Cross-origin requests (CDN tiles, etc.) must not be
    // routed through our cache.
    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (isHtmlRequest(request)) {
      // NETWORK-FIRST for HTML. This is the anti-stale rule: never let the
      // service worker trap the user on an old index.html. Only cache real
      // 200 responses; a 404/500 must be shown to the user, never written
      // over the cached shell.
      event.respondWith(
        fetch(request)
          .then(function (networkResponse) {
            if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
              var clone = networkResponse.clone();
              caches.open(CACHE).then(function (cache) {
                cache.put("./index.html", clone).catch(function () {});
              });
            }
            return networkResponse;
          })
          .catch(function () {
            return caches.match("./index.html").then(function (cached) {
              if (cached) return cached;
              return offlineResponse();
            });
          })
      );
      return;
    }

    // CACHE-FIRST for everything else same-origin.
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (networkResponse) {
          // Only cache real, transparent 200 responses. Never cache opaque
          // (no-cors) responses or non-ok statuses.
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.status === 200
          ) {
            var clone = networkResponse.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(request, clone).catch(function () {});
            });
          }
          return networkResponse;
        });
      })
    );
  });
})();