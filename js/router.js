/* ============================================================================
   GardenOS navigation substrate — Alpha layer
   ----------------------------------------------------------------------------
   This file defines the APP'S NAVIGATION CONTRACT. Three later rangers build
   depth on top of it. Read this block before changing anything in this file;
   any change here is a breaking change for the depth rangers.
   ----------------------------------------------------------------------------
   CONTRACT — the `data-nav` attribute convention
     Any element carrying `data-nav="<hash-route>"` becomes a navigation
     target. The router delegates clicks AND keyboard activation at the
     document level; no per-element event handler is required.

     Non-interactive elements (div, span, li, ...) MUST additionally carry
       role="link" tabindex="0"
     to be keyboard reachable and screen-reader friendly. Authors set these
     attributes in markup; the router does not inject them.

     Examples:
       <div class="card" data-nav="#/garden" role="link" tabindex="0">...</div>
       <span class="pill" data-nav="#/plants?tag=full-sun">full sun</span>
       <a     href="#"   data-nav="#/journal?section=abc">notes for X</a>

     Activation: click, Enter, or Space on the focused element navigates.
     Native <a> / <button> elements are not hijacked (their built-in handlers
     still run). The browser back / forward buttons work — every route change
     is a real history entry.

   CONTRACT — the URL scheme (hash routes)
     #/dashboard                                      default landing
     #/garden                                         all garden sections
     #/plants                                         all plantings
     #/plants?section=<id-or-name>                    filtered to one section
     #/plants?tag=<name>                              filtered by one tag
     #/tasks?section=<id-or-name>                     tasks filtered to section
     #/journal?section=<id-or-name>                   observations filtered
     #/sections/:id                                   single section in detail
     #/settings

     `section=<id-or-name>` accepts a UUID id (canonical) OR a section name
     (case-insensitive convenience). Other routes ignore unknown params.

   CONTRACT — the filtered-listing primitive
     window.gardenosRouter.renderListing(opts) renders a list of items into
     a target element with an active-filter chip and a graceful empty state.

       opts.view          : string  required — view that must be active
       opts.targetId      : string  required — element ID to render into
       opts.sourceArray   : any[]   required — the array to filter
       opts.filterFn      : (item, params) => boolean   (default: keep all)
       opts.params        : object  the current route params
       opts.renderItem    : (item) => string HTML       (required when items)
       opts.emptyHtml     : string  markup for empty state (default below)
       opts.chipHostId    : string? element ID to render active-filter chip.
                                  If omitted AND opts.chipHtml is provided,
                                  the chip is inserted as a sibling of the
                                  target and updated on each call (empty
                                  chipHtml removes it).
       opts.chipHtml      : (params) => string HTML    chip markup

     Returns the count of matching items. Idempotent: safe to call twice.

   PUBLIC API (window.gardenosRouter)
     .route()                      re-apply the current hash route now
     .navigate(hash)               go to a hash route (no-op if identical)
     .onNavigate(callback)         cb(view: string, params: object) on every
                                   route change after render() has run
     .renderListing(opts)          see CONTRACT above
     .parseParams(hash?)           parse query params out of a hash route
     .makeNavigable(el, hash)      helper: sets data-nav, role, tabindex
     .init()                       install the hashchange listener and route
                                   once; called automatically on
                                   DOMContentLoaded
   ============================================================================ */
(function () {
  'use strict';

  // ---- View registry --------------------------------------------------------
  var SUPPORTED_VIEWS = ['dashboard', 'garden', 'plants', 'tasks', 'journal', 'settings'];
  var DEFAULT_VIEW = 'dashboard';

  function getViewFromHash(hash) {
    var raw = (hash || '').replace(/^#\/?/, '');
    var head = raw.split('?')[0].split('/').filter(Boolean)[0] || '';
    return head || DEFAULT_VIEW;
  }

  // Parse "?a=b&c=d" out of "#/plants?a=b&c=d". Without an arg, parses
  // location.hash, so callers can just say parseParams().
  function parseParams(hash) {
    if (hash == null) hash = (typeof location !== 'undefined' ? location.hash : '');
    var qs = (hash.split('?')[1] || '');
    var params = {};
    if (!qs) return params;
    qs.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i >= 0 ? kv.slice(0, i) : kv;
      var v = i >= 0 ? kv.slice(i + 1) : '';
      try { params[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { params[k] = v; }
    });
    return params;
  }

  // ---- Navigation core ------------------------------------------------------
  var _onNavCallbacks = [];
  function onNavigate(cb) { if (typeof cb === 'function') _onNavCallbacks.push(cb); }

  function activateView(view, params) {
    if (SUPPORTED_VIEWS.indexOf(view) < 0) view = DEFAULT_VIEW;
    var sections = document.querySelectorAll('.view');
    for (var i = 0; i < sections.length; i++) sections[i].classList.remove('active');
    var active = document.getElementById(view);
    if (active) active.classList.add('active');
    var navBtns = document.querySelectorAll('[data-view]');
    for (var j = 0; j < navBtns.length; j++) {
      navBtns[j].classList.toggle('active', navBtns[j].dataset.view === view);
    }
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
    // Run render() FIRST so callbacks can post-process (e.g. apply filters).
    try {
      if (typeof window.render === 'function') window.render();
    } catch (e) { /* tolerate missing render in unrelated views */ }
    for (var k = 0; k < _onNavCallbacks.length; k++) {
      try { _onNavCallbacks[k](view, params); } catch (e2) { /* one bad listener does not break the page */ }
    }
  }

  function routeFromHash() {
    var h = (typeof location !== 'undefined') ? location.hash : '';
    activateView(getViewFromHash(h), parseParams(h));
  }
  function route() { routeFromHash(); }

  function navigate(hash) {
    if (hash == null) return;
    hash = String(hash);
    if (hash.charAt(0) !== '#') hash = '#' + (hash.charAt(0) === '/' ? hash : '/' + hash);
    if (typeof location === 'undefined') return;
    if (location.hash === hash) {
      // No history event on identical hash; re-apply explicitly so listeners fire.
      routeFromHash();
    } else {
      location.hash = hash;
    }
  }

  // ---- data-nav delegation --------------------------------------------------
  function findNavTarget(start) {
    var el = start;
    while (el && el !== document.documentElement && el !== document) {
      if (el.dataset && el.dataset.nav) return el;
      // Native interactive elements without data-nav keep their built-in behavior.
      if (el.tagName === 'A' || el.tagName === 'BUTTON') return null;
      el = el.parentNode;
    }
    return null;
  }

  function onDocClick(e) {
    var t = findNavTarget(e.target);
    if (!t) return;
    // Prevent the browser from also following href="#" / native button submit.
    e.preventDefault();
    navigate(t.dataset.nav);
  }

  function onDocKeydown(e) {
    var key = e.key || e.keyCode;
    // Enter (13) or Space (32 / ' ').
    if (key !== 'Enter' && key !== 13 && key !== ' ' && key !== 'Spacebar' && key !== 32) return;
    var a = document.activeElement;
    if (!a || !a.dataset || !a.dataset.nav) return;
    if (a.tagName === 'A' || a.tagName === 'BUTTON') return; // native handles
    e.preventDefault();
    navigate(a.dataset.nav);
  }

  function makeNavigable(el, hash) {
    if (!el) return el;
    if (hash != null && !el.hasAttribute('data-nav')) el.setAttribute('data-nav', hash);
    if (!el.hasAttribute('role')) el.setAttribute('role', 'link');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    return el;
  }

  // ---- Filtered-listing primitive ------------------------------------------
  var DEFAULT_EMPTY = '<div class="empty">No matches.</div>';

  function renderListing(opts) {
    if (!opts || !opts.targetId) return 0;
    if (opts.view) {
      var sections = document.querySelectorAll('.view');
      for (var i = 0; i < sections.length; i++) sections[i].classList.remove('active');
      var v = document.getElementById(opts.view);
      if (v) v.classList.add('active');
      var navBtns = document.querySelectorAll('[data-view]');
      for (var j = 0; j < navBtns.length; j++) {
        navBtns[j].classList.toggle('active', navBtns[j].dataset.view === opts.view);
      }
      if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    var target = document.getElementById(opts.targetId);
    if (!target) return 0;
    var src = Array.isArray(opts.sourceArray) ? opts.sourceArray : [];
    var pred = typeof opts.filterFn === 'function' ? opts.filterFn : function () { return true; };
    var params = opts.params || parseParams();
    var items = src.filter(function (it) { return pred(it, params); });
    if (items.length) {
      if (typeof opts.renderItem !== 'function') {
        target.textContent = items.length + ' items';
        return items.length;
      }
      target.innerHTML = items.map(function (it) { return opts.renderItem(it); }).join('');
    } else {
      target.innerHTML = opts.emptyHtml || DEFAULT_EMPTY;
    }
    if (opts.chipHtml) {
      var chipText = typeof opts.chipHtml === 'function' ? opts.chipHtml(params) : (opts.chipHtml || '');
      if (opts.chipHostId) {
        var host = document.getElementById(opts.chipHostId);
        if (host) host.innerHTML = chipText || '';
      } else {
        // Sibling mode: insert/update <div class="gardenos-listing-chip">
        // immediately before the target. Empty chipText removes it.
        var parent = target.parentNode;
        if (parent) {
          var prev = target.previousSibling;
          while (prev && prev.nodeType !== 1) prev = prev.previousSibling;
          var existing = (prev && prev.classList && prev.classList.contains('gardenos-listing-chip')) ? prev : null;
          if (chipText) {
            if (existing) {
              existing.innerHTML = chipText;
            } else {
              var chipEl = document.createElement('div');
              chipEl.className = 'gardenos-listing-chip';
              chipEl.innerHTML = chipText;
              parent.insertBefore(chipEl, target);
            }
          } else if (existing) {
            parent.removeChild(existing);
          }
        }
      }
    }
    return items.length;
  }

  // ---- Init -----------------------------------------------------------------
  function install() {
    window.addEventListener('hashchange', routeFromHash, false);
    routeFromHash(); // initial route from address bar
  }
  function init() { install(); }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocClick, false);
    document.addEventListener('keydown', onDocKeydown, false);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
      install();
    }
  }

  // ---- Public surface -------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.gardenosRouter = {
      route: route,
      navigate: navigate,
      onNavigate: onNavigate,
      renderListing: renderListing,
      parseParams: parseParams,
      makeNavigable: makeNavigable,
      init: init,
      // exposed for tests / other rangers that want to introspect
      _getViewFromHash: getViewFromHash,
      _SUPPORTED_VIEWS: SUPPORTED_VIEWS
    };
  }
})();
