/* @rtl/sarah-recorder global build — drop-in <script> tag */
"use strict";
var __sarahRecorderInternal = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/auto.ts
  var auto_exports = {};
  __export(auto_exports, {
    bootRecorder: () => bootRecorder,
    deferAutoBoot: () => deferAutoBoot,
    installNetworkCaptureEarly: () => installNetworkCaptureEarly
  });

  // ../res/dist/types.js
  var RES_SCHEMA_VERSION = "1.0.0";
  var RES_SCHEMA_ID = "rtl.res";

  // ../res/dist/serialize.js
  var STUB_VERSION = `${RES_SCHEMA_ID}@${RES_SCHEMA_VERSION}`;

  // ../collector/dist/core.js
  var DEFAULT_CAPACITY = 4096;
  var DEFAULT_MAX_ATTR_BYTES = 4 * 1024;
  var COLLECTOR_VERSION = "1.0.0";
  function zeroLoss() {
    return {
      droppedOnOverflow: 0,
      droppedOnInvalidShape: 0,
      droppedOnInvalidVersion: 0,
      droppedOnNoTarget: 0,
      totalDropped: 0
    };
  }
  function freezeLoss(m) {
    return {
      droppedOnOverflow: m.droppedOnOverflow,
      droppedOnInvalidShape: m.droppedOnInvalidShape,
      droppedOnInvalidVersion: m.droppedOnInvalidVersion,
      droppedOnNoTarget: m.droppedOnNoTarget,
      totalDropped: m.totalDropped
    };
  }
  function bump(m, reason) {
    switch (reason) {
      case "overflow":
        m.droppedOnOverflow++;
        break;
      case "invalid-shape":
        m.droppedOnInvalidShape++;
        break;
      case "invalid-version":
        m.droppedOnInvalidVersion++;
        break;
      case "no-target":
        m.droppedOnNoTarget++;
        break;
      case "admitted":
        return;
    }
    m.totalDropped++;
  }
  var RingBuffer = class {
    // number of valid entries (<= capacity)
    constructor(capacity) {
      __publicField(this, "capacity");
      __publicField(this, "buf");
      __publicField(this, "head", 0);
      // index of the next write
      __publicField(this, "count", 0);
      this.capacity = capacity;
      if (!Number.isInteger(capacity) || capacity <= 0) {
        throw new RangeError(`ring capacity must be a positive integer, got ${capacity}`);
      }
      this.buf = new Array(capacity);
    }
    /**
     * Push an event. Returns true iff this push evicted an existing entry
     * (i.e. the buffer was already at capacity). The new event is admitted
     * either way; "evicted" only means we displaced the oldest.
     */
    push(ev) {
      if (this.count === this.capacity) {
        this.buf[this.head] = ev;
        this.head = (this.head + 1) % this.capacity;
        return true;
      }
      this.buf[this.head] = ev;
      this.head = (this.head + 1) % this.capacity;
      this.count++;
      return false;
    }
    /** Iterate events in insertion order (oldest first), no allocation. */
    *iterate() {
      const start = this.count === this.capacity ? this.head : 0;
      for (let i = 0; i < this.count; i++) {
        yield this.buf[(start + i) % this.capacity];
      }
    }
    clear() {
      for (let i = 0; i < this.capacity; i++)
        this.buf[i] = void 0;
      this.head = 0;
      this.count = 0;
    }
  };
  function makeClock(provided) {
    const source = provided ?? defaultSource();
    let last = 0;
    const epoch = source();
    return () => {
      const raw = source() - epoch;
      const micros = Math.floor(raw * 1e3);
      const next = micros > last ? micros : last + 1;
      last = next;
      return next;
    };
  }
  function defaultSource() {
    const g = globalThis;
    if (g.performance && typeof g.performance.now === "function") {
      return () => g.performance.now();
    }
    return () => Date.now();
  }
  function validateEventForBus(event) {
    if (typeof event !== "object" || event === null)
      return false;
    const ev = event;
    if (ev.schema !== RES_SCHEMA_ID)
      return false;
    if (ev.schemaVersion !== RES_SCHEMA_VERSION)
      return false;
    if (typeof ev.kind !== "string" || ev.kind.length === 0)
      return false;
    if (typeof ev.t !== "number" || !Number.isFinite(ev.t))
      return false;
    if (!isUsableEntityRef(ev.target))
      return false;
    return true;
  }
  function isUsableEntityRef(ref) {
    if (typeof ref !== "object" || ref === null)
      return false;
    const r = ref;
    if (r.schema !== RES_SCHEMA_ID)
      return false;
    if (r.schemaVersion !== RES_SCHEMA_VERSION)
      return false;
    const hasId = r.id !== void 0 && r.id !== null;
    const hasGap = r.gap !== void 0;
    if (hasId === hasGap)
      return false;
    return true;
  }
  function createCollector(config = {}) {
    const capacity = config.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    const now = makeClock(config.nowMicros);
    const onLoss = config.onLoss ?? noopLoss;
    const buffer = new RingBuffer(capacity);
    const loss = zeroLoss();
    let totalAdmitted = 0;
    let disposed = false;
    const classifyFailure = (event) => {
      if (typeof event !== "object" || event === null)
        return "invalid-shape";
      const ev = event;
      const target = ev["target"];
      if (target === void 0 || target === null)
        return "no-target";
      if (ev["schema"] !== RES_SCHEMA_ID)
        return "invalid-version";
      if (ev["schemaVersion"] !== RES_SCHEMA_VERSION)
        return "invalid-version";
      if (typeof ev["kind"] !== "string")
        return "invalid-shape";
      if (typeof ev["t"] !== "number" || !Number.isFinite(ev["t"]))
        return "invalid-shape";
      return "invalid-shape";
    };
    const core = {
      config: Object.freeze({
        capacity,
        nowMicros: now,
        onLoss
      }),
      now() {
        assertLive(disposed);
        return now();
      },
      record(event) {
        assertLive(disposed);
        if (!validateEventForBus(event)) {
          const reason = classifyFailure(event);
          bump(loss, reason);
          onLoss({
            kind: reason === "no-target" ? "drop-on-no-target" : reason === "invalid-shape" ? "drop-on-invalid-shape" : "drop-on-invalid-version",
            t: now()
          });
          return { admitted: false, dropped: true, reason };
        }
        const evicted = buffer.push(event);
        if (evicted) {
          bump(loss, "overflow");
          onLoss({ kind: "drop-on-overflow", t: now() });
          totalAdmitted++;
          return { admitted: true, dropped: true, reason: "overflow" };
        }
        totalAdmitted++;
        return { admitted: true, dropped: false, reason: "admitted" };
      },
      snapshot() {
        assertLive(disposed);
        const events = [];
        for (const ev of buffer.iterate())
          events.push(ev);
        return {
          schema: RES_SCHEMA_ID,
          schemaVersion: RES_SCHEMA_VERSION,
          collectorVersion: COLLECTOR_VERSION,
          t: now(),
          size: events.length,
          capacity,
          events,
          totalAdmitted,
          totalDropped: loss.totalDropped,
          loss: freezeLoss(loss)
        };
      },
      export(opts) {
        assertLive(disposed);
        const fromT = opts?.fromT ?? 0;
        const toT = opts?.toT ?? Number.MAX_SAFE_INTEGER;
        const windowed = !(fromT === 0 && toT === Number.MAX_SAFE_INTEGER);
        const filtered = [];
        for (const ev of buffer.iterate()) {
          if (ev.t >= fromT && ev.t <= toT)
            filtered.push(ev);
        }
        const emitted = filtered.length;
        const accounting = windowed ? emitted + loss.totalDropped + (totalAdmitted - emitted - loss.totalDropped) === totalAdmitted : emitted + loss.totalDropped === totalAdmitted;
        const completeness = {
          emitted,
          admitted: totalAdmitted,
          dropped: loss.totalDropped,
          accounting,
          windowed,
          bufferCapacity: capacity,
          gaps: opts?.gaps ? [...opts.gaps] : []
        };
        const fromTActual = filtered.length === 0 ? fromT : filtered[0].t;
        const toTActual = filtered.length === 0 ? toT : filtered[filtered.length - 1].t;
        return {
          schema: RES_SCHEMA_ID,
          schemaVersion: RES_SCHEMA_VERSION,
          collectorVersion: COLLECTOR_VERSION,
          exportedAt: now(),
          fromT: fromTActual,
          toT: toTActual,
          events: filtered,
          completeness
        };
      },
      reset() {
        assertLive(disposed);
        buffer.clear();
        loss.droppedOnOverflow = 0;
        loss.droppedOnInvalidShape = 0;
        loss.droppedOnInvalidVersion = 0;
        loss.droppedOnNoTarget = 0;
        loss.totalDropped = 0;
        totalAdmitted = 0;
      },
      dispose() {
        disposed = true;
        buffer.clear();
      },
      get disposed() {
        return disposed;
      }
    };
    return core;
  }
  function noopLoss(_loss) {
  }
  function assertLive(disposed) {
    if (disposed)
      throw new Error("collector is disposed");
  }

  // ../collector/dist/plugins/_event.js
  var V = { schema: RES_SCHEMA_ID, schemaVersion: RES_SCHEMA_VERSION };
  function ent(id, kind = "dom-node") {
    return { ...V, id, kind };
  }
  function mkEvent(kind, t, target, data) {
    return { ...V, kind, t, target, ...data ? { data } : {} };
  }

  // ../collector/dist/plugins/dom.js
  function installDomPlugin(collector, root, ObserverCtor, entityFor = () => ent("dom-node", "dom-node")) {
    const observer = new ObserverCtor((records) => {
      for (const rec of records) {
        collector.record(mkEvent("dom-mutation", collector.now(), entityFor(rec.target), {
          type: rec.type,
          added: rec.addedNodes.length,
          removed: rec.removedNodes.length
        }));
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    return { disconnect: () => observer.disconnect() };
  }

  // ../collector/dist/plugins/react-adapter.js
  function createReactAdapter(collector) {
    const subscribers = /* @__PURE__ */ new Set();
    return {
      notifyRender(n) {
        collector.record(mkEvent("render", collector.now(), ent(n.componentId, "component"), { reason: n.reason ?? "render" }));
        for (const s of subscribers) {
          s(n);
        }
      },
      subscribe(fn) {
        subscribers.add(fn);
        return () => {
          subscribers.delete(fn);
        };
      }
    };
  }

  // src/span-context.ts
  var ACTIVE_SPAN_TTL_MS = 3e4;
  function createSpanContext(nowMs = () => Date.now(), ttlMs = ACTIVE_SPAN_TTL_MS) {
    let active = null;
    const expired = () => active !== null && nowMs() - active.mintedAtMs > ttlMs;
    return {
      set(span) {
        active = span;
      },
      get() {
        if (active === null) return null;
        if (expired()) {
          active = null;
          return null;
        }
        return active;
      },
      clear() {
        active = null;
      }
    };
  }
  function mintSpanId(nowMicros) {
    const t = nowMicros().toString(36);
    const r = Math.random().toString(36).slice(2, 10);
    return `sp-${t}-${r}`;
  }

  // src/with-span.ts
  function makeSpanContextSlot() {
    let ctx = null;
    return {
      get: () => ctx,
      set: (c) => {
        ctx = c;
      }
    };
  }
  function withSpan(inner, slot) {
    const wrapped = {
      inner,
      config: inner.config,
      now: () => inner.now(),
      record(event) {
        const ctx = slot.get();
        if (!ctx) return inner.record(event);
        const span = ctx.get();
        if (!span) return inner.record(event);
        const stamped = {
          ...event,
          data: { ...event.data ?? {}, span: span.id }
        };
        return inner.record(stamped);
      },
      snapshot: () => inner.snapshot(),
      export: (opts) => inner.export(opts),
      reset: () => inner.reset(),
      dispose: () => inner.dispose(),
      get disposed() {
        return inner.disposed;
      }
    };
    return wrapped;
  }

  // src/plugins/input.ts
  var ALL_KINDS = [
    "click",
    "pointerdown",
    "submit",
    "input",
    "change"
  ];
  function labelForElement(el) {
    const dataset = el.dataset ?? {};
    if (dataset.testid) return String(dataset.testid);
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim().length > 0) return aria.trim();
    const tagUpper = el.tagName;
    if (tagUpper === "INPUT" || tagUpper === "SELECT" || tagUpper === "TEXTAREA") {
      const id2 = el.id;
      if (id2) {
        const owner = el.ownerDocument?.querySelector(`label[for="${cssEscape(id2)}"]`);
        if (owner && owner.textContent) {
          const t = owner.textContent.trim();
          if (t) return t;
        }
      }
    }
    const role = el.getAttribute("role");
    if (role) {
      const accessibleName = el.getAttribute("aria-labelledby") || el.textContent?.trim();
      if (accessibleName) return `${role}:${accessibleName}`.slice(0, 120);
    }
    const id = el.id;
    if (id) return `${el.tagName.toLowerCase()}#${id}`;
    return el.tagName.toLowerCase();
  }
  function cssEscape(s) {
    if (typeof globalThis.CSS?.escape === "function") {
      return globalThis.CSS.escape(s);
    }
    return s.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1");
  }
  function entityRefFor(el, bmm) {
    const id = entityIdForElement(el);
    const label = labelForElement(el);
    const origin = bmm?.resolveOrigin(el) ?? void 0;
    return {
      schema: RES_SCHEMA_ID,
      schemaVersion: RES_SCHEMA_VERSION,
      id,
      kind: "dom-node",
      label,
      ...origin !== void 0 ? { origin } : {}
    };
  }
  function entityIdForElement(el) {
    const dataset = el.dataset ?? {};
    if (dataset.rtlId) return `e_${dataset.rtlId}`;
    if (el.id) return `e_${el.id}`;
    if (dataset.testid) return `e_testid_${dataset.testid}`;
    return `e_${el.tagName.toLowerCase()}_${ordinal(el)}`;
    function ordinal(node) {
      let n = 0;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) n++;
        sib = sib.previousElementSibling;
      }
      return n;
    }
  }
  function isInteractiveElement(el) {
    if (!isElementLike(el)) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "FORM") {
      return true;
    }
    const role = el.getAttribute("role");
    if (role === "button" || role === "link" || role === "menuitem") {
      return true;
    }
    const dataset = el.dataset ?? {};
    if (dataset.testid) return true;
    if (el.hasAttribute("tabindex")) {
      return el.getAttribute("tabindex") !== "-1";
    }
    return false;
  }
  function resolveSemanticTarget(rawTarget) {
    let node = rawTarget;
    while (node && !isInteractiveElement(node)) {
      const parent = node.parentElement;
      if (!parent) break;
      node = parent;
    }
    return { target: node ?? rawTarget, raw: rawTarget };
  }
  function installInputPlugin(opts) {
    const log = opts.log ?? noopLog;
    const doc = opts.document ?? (typeof document !== "undefined" ? document : null);
    if (!doc) {
      log("debug", "input plugin skipped (no document)");
      return null;
    }
    if (typeof doc.addEventListener !== "function") {
      log("debug", "input plugin skipped (document.addEventListener missing)");
      return null;
    }
    const kinds = opts.kinds && opts.kinds.length > 0 ? opts.kinds : ALL_KINDS;
    const bmm = opts.bmm ?? null;
    const handler = (kind) => (ev) => {
      try {
        handleEvent(kind, ev);
      } catch (err) {
        log("warn", `input handler (${kind}) threw`, err);
      }
    };
    const handleEvent = (kind, ev) => {
      const raw = ev.target;
      if (!isElementLike(raw)) return;
      const { target } = resolveSemanticTarget(raw);
      const spanId = mintSpanId(opts.collector.now);
      opts.spanContext.set({ id: spanId, mintedAtMs: Date.now() });
      const ref = entityRefFor(target, bmm);
      const data = {
        type: kind,
        span: spanId,
        rawTarget: {
          tagName: raw.tagName.toLowerCase()
        }
      };
      if (kind === "submit" && raw instanceof HTMLFormElement) {
        const fd = raw.elements;
        const fieldNames = [];
        for (let i = 0; i < fd.length; i++) {
          const f = fd.item(i);
          if (f && f.tagName !== "BUTTON") {
            fieldNames.push(f.getAttribute("name") ?? f.id ?? "?");
          }
        }
        data["formAction"] = raw.getAttribute("action") ?? "";
        data["formMethod"] = (raw.getAttribute("method") ?? "get").toLowerCase();
        data["fields"] = fieldNames;
      }
      if (kind === "input" || kind === "change") {
        if (isHtmlInputElement(raw)) {
          data["valueType"] = raw.type;
          if (raw.type !== "password") {
            data["valuePreview"] = String(raw.value ?? "").slice(0, 64);
          } else {
            data["valuePreview"] = "[redacted]";
          }
        } else if (isHtmlTextAreaElement(raw)) {
          data["valuePreview"] = String(raw.value ?? "").slice(0, 64);
        } else if (isHtmlSelectElement(raw)) {
          data["valuePreview"] = raw.value;
        }
      }
      const event = mkEvent("user-input", opts.collector.now(), ref, data);
      const enriched = { ...event, span: { schema: RES_SCHEMA_ID, schemaVersion: RES_SCHEMA_VERSION, id: spanId } };
      opts.collector.record(enriched);
    };
    const bound = [];
    for (const kind of kinds) {
      const fn = handler(kind);
      doc.addEventListener(kind, fn, true);
      bound.push([kind, fn]);
    }
    return {
      uninstall: () => {
        for (const [kind, fn] of bound) {
          try {
            doc.removeEventListener(kind, fn, true);
          } catch {
          }
        }
      }
    };
  }
  function noopLog() {
  }
  function isElementLike(x) {
    return typeof x === "object" && x !== null && typeof x.tagName === "string";
  }
  function isHtmlInputElement(x) {
    if (!isElementLike(x)) return false;
    const tag = x.tagName;
    return tag === "INPUT" || tag === "input";
  }
  function isHtmlTextAreaElement(x) {
    if (!isElementLike(x)) return false;
    const tag = x.tagName;
    return tag === "TEXTAREA" || tag === "textarea";
  }
  function isHtmlSelectElement(x) {
    if (!isElementLike(x)) return false;
    const tag = x.tagName;
    return tag === "SELECT" || tag === "select";
  }

  // src/recorder.ts
  var SESSION_STORAGE_KEY = "__sarahSessionId";
  var PATCH_FLAG_XHR = "__sarahRecorderXhrPatched";
  var spanContextSlot = makeSpanContextSlot();
  var currentRecorderSessionId;
  function defaultLog(level, msg, extra) {
    if (level === "error" || level === "warn") {
      try {
        (console[level] ?? console.log).call(console, `[sarah-recorder] ${msg}`, extra ?? "");
      } catch {
      }
    }
  }
  function readScriptAttrs() {
    if (typeof document === "undefined") return {};
    const out = {};
    const scripts = document.querySelectorAll("script");
    for (const s of Array.from(scripts)) {
      const gw = s.getAttribute("data-gateway");
      const sid = s.getAttribute("data-session");
      if (gw && !out.gateway) out.gateway = gw;
      if (sid && !out.sessionId) out.sessionId = sid;
    }
    return out;
  }
  function resolveSessionId(candidate) {
    if (candidate && candidate.length > 0) return candidate;
    if (typeof sessionStorage !== "undefined") {
      try {
        const pinned = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (pinned) return pinned;
        const fresh = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `sarah-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
        return fresh;
      } catch {
      }
    }
    return `sarah-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function defaultTransport(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      mode: "cors",
      credentials: "omit"
    }).then((res) => ({ ok: res.ok, status: res.status })).catch(() => ({ ok: false, status: 0 }));
  }
  function installXhrPatch(collector, Xhr, log) {
    if (!Xhr || !Xhr.prototype) {
      log("debug", "XHR not available; skipping XHR patch");
      return null;
    }
    if (Xhr[PATCH_FLAG_XHR]) {
      return { uninstall: () => void 0 };
    }
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;
    const inflight = /* @__PURE__ */ new WeakMap();
    const patchedOpen = function patchedOpen2(method, url, ...rest) {
      const traceId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      inflight.set(this, { traceId, url: String(url), method: String(method) });
      return originalOpen.apply(this, [method, url, ...rest]);
    };
    const patchedSend = function patchedSend2(body) {
      const meta = inflight.get(this);
      if (meta) {
        collector.record(
          mkEvent("network", collector.now(), ent(meta.url, "request"), {
            phase: "start",
            trace: meta.traceId,
            method: meta.method,
            transport: "xhr"
          })
        );
      }
      try {
        if (meta && currentRecorderSessionId) {
          const href = window?.location?.href;
          if (href && new URL(meta.url, href).origin === new URL(href).origin) {
            this.setRequestHeader?.("X-Sarah-Session", currentRecorderSessionId);
          }
        }
      } catch {
      }
      const xhr = this;
      const onDone = () => {
        if (!meta) return;
        collector.record(
          mkEvent("network", collector.now(), ent(meta.url, "request"), {
            phase: "end",
            trace: meta.traceId,
            method: meta.method,
            transport: "xhr",
            status: this.status
          })
        );
      };
      if (typeof xhr.addEventListener === "function") {
        xhr.addEventListener("loadend", onDone);
      }
      return originalSend.call(this, body);
    };
    Xhr.prototype.open = patchedOpen;
    Xhr.prototype.send = patchedSend;
    Xhr[PATCH_FLAG_XHR] = true;
    return {
      uninstall: () => {
        Xhr.prototype.open = originalOpen;
        Xhr.prototype.send = originalSend;
        delete Xhr[PATCH_FLAG_XHR];
      }
    };
  }
  var FETCH_PATCH_FLAG = "__sarahRecorderFetchPatched";
  function installFetchPatch(collector, log) {
    if (typeof window === "undefined") return null;
    const w = window;
    const original = w.fetch;
    if (typeof original !== "function") return null;
    if (w[FETCH_PATCH_FLAG]) return { uninstall: () => void 0 };
    const patchedFetch = async function patchedFetch2(input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const isRecorderFlush = method === "POST" && /\/events\/?(\?|$)/.test(url);
      const traceId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!isRecorderFlush) {
        collector.record(
          mkEvent("network", collector.now(), ent(url, "request"), {
            phase: "start",
            trace: traceId,
            method,
            transport: "fetch"
          })
        );
      }
      let result;
      try {
        let finalInit = init;
        try {
          const locationHref = w.location?.href;
          if (locationHref) {
            const u = new URL(url, locationHref);
            if (u.origin === new URL(locationHref).origin) {
              const headers = new Headers(init?.headers ?? {});
              headers.set("x-rtl-trace", traceId);
              if (!isRecorderFlush && currentRecorderSessionId) {
                headers.set("X-Sarah-Session", currentRecorderSessionId);
              }
              finalInit = { ...init, headers };
            }
          }
        } catch {
        }
        result = await original.call(w, input, finalInit);
      } catch (err) {
        if (!isRecorderFlush) {
          collector.record(
            mkEvent("network", collector.now(), ent(url, "request"), {
              phase: "end",
              trace: traceId,
              method,
              transport: "fetch",
              status: 0,
              error: String(err)
            })
          );
        }
        throw err;
      }
      if (!isRecorderFlush) {
        collector.record(
          mkEvent("network", collector.now(), ent(url, "request"), {
            phase: "end",
            trace: traceId,
            method,
            transport: "fetch",
            status: result.status
          })
        );
      }
      return result;
    };
    w[FETCH_PATCH_FLAG] = true;
    w.fetch = patchedFetch;
    return {
      uninstall: () => {
        try {
          w.fetch = original;
          delete w[FETCH_PATCH_FLAG];
        } catch {
        }
      }
    };
  }
  function installNetworkCaptureEarly(opts = {}) {
    if (typeof window === "undefined") return null;
    const w = window;
    if (w.__sarahEarlyNetwork) return w.__sarahEarlyNetwork;
    const log = opts.log ?? defaultLog;
    const rawCollector = createCollector({ capacity: opts.capacity ?? 4096 });
    const collector = withSpan(rawCollector, spanContextSlot);
    const netHandle = installFetchPatch(collector, log);
    const Xhr = window.XMLHttpRequest;
    let xhrHandle = null;
    if (Xhr && Xhr.prototype) {
      xhrHandle = installXhrPatch(collector, Xhr, log);
    }
    const handle = {
      collector,
      uninstall: () => {
        try {
          netHandle?.uninstall();
        } catch {
        }
        try {
          xhrHandle?.uninstall();
        } catch {
        }
        try {
          delete window.__sarahEarlyNetwork;
        } catch {
        }
      }
    };
    w.__sarahEarlyNetwork = handle;
    return handle;
  }
  function readEarlyNetworkCapture() {
    if (typeof window === "undefined") return null;
    const w = window;
    return w.__sarahEarlyNetwork ?? null;
  }
  function bootRecorder(opts = {}) {
    const log = opts.log ?? defaultLog;
    const earlyCapture = readEarlyNetworkCapture();
    const scriptAttrs = readScriptAttrs();
    const configFromWindow = readWindowConfig();
    const windowGateway = typeof window !== "undefined" ? window.__sarahGateway : void 0;
    const windowSession = typeof window !== "undefined" ? window.__sarahSessionId : void 0;
    const gateway = opts.gateway ?? configFromWindow.gateway ?? scriptAttrs.gateway ?? windowGateway ?? "";
    const sessionId = resolveSessionId(
      opts.sessionId ?? configFromWindow.sessionId ?? scriptAttrs.sessionId ?? windowSession
    );
    currentRecorderSessionId = sessionId;
    if (!gateway) {
      log(
        "warn",
        "no gateway configured \u2014 recorder will buffer locally; nothing will stream until a gateway is provided"
      );
    }
    const rawCollector = earlyCapture?.collector.inner ?? createCollector({
      capacity: opts.capacity ?? 4096
    });
    const collector = earlyCapture?.collector ?? withSpan(rawCollector, spanContextSlot);
    const spanContext = createSpanContext();
    spanContextSlot.set(spanContext);
    let domHandle = null;
    try {
      const root = opts.root ?? (typeof document !== "undefined" ? document.body : null);
      const ObserverCtor = opts.mutationObserver ?? (typeof window !== "undefined" ? window.MutationObserver : void 0);
      if (root && ObserverCtor) {
        const entityFor = makeEntityFor(opts.bmm ?? null);
        domHandle = installDomPlugin(
          collector,
          root,
          ObserverCtor,
          entityFor
        );
      } else {
        log("debug", "DOM plugin skipped (no root or no MutationObserver)");
      }
    } catch (err) {
      log("error", "DOM plugin install failed", err);
    }
    let inputHandle = null;
    try {
      inputHandle = installInputPlugin({
        collector,
        spanContext,
        document: typeof document !== "undefined" ? document : null,
        bmm: opts.bmm ?? null,
        log
      });
      if (!inputHandle) {
        log("debug", "input plugin skipped (no document)");
      }
    } catch (err) {
      log("error", "input plugin install failed", err);
    }
    let reactAdapter = null;
    try {
      reactAdapter = createReactAdapter(collector);
    } catch (err) {
      log("error", "react adapter install failed", err);
    }
    let netHandle = null;
    let xhrHandle = null;
    if (earlyCapture) {
      const earlyUninstall = earlyCapture.uninstall;
      netHandle = { uninstall: () => earlyUninstall() };
      xhrHandle = { uninstall: () => earlyUninstall() };
    } else {
      try {
        netHandle = installFetchPatch(collector, log);
        if (!netHandle) {
          log("debug", "network plugin skipped (no fetch)");
        }
        const Xhr = opts.xmlHttpRequest ?? (typeof window !== "undefined" ? window.XMLHttpRequest : void 0);
        xhrHandle = installXhrPatch(collector, Xhr, log);
      } catch (err) {
        log("error", "network plugin install failed", err);
      }
    }
    const transport = opts.transport ?? defaultTransport;
    const intervalMs = opts.flushIntervalMs ?? 1e3;
    const url = typeof location !== "undefined" ? location.href : "";
    let stopped = false;
    let inflight = false;
    let backoffMs = 0;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 5;
    let flushTimer = null;
    async function flush() {
      if (stopped) return null;
      if (!gateway) return null;
      if (inflight) return null;
      inflight = true;
      try {
        const exp = collector.export();
        const events = exp.events;
        if (events.length === 0) return null;
        const body = { sessionId, url, events };
        const endpoint = gateway.replace(/\/+$/, "") + "/events";
        const res = await transport(endpoint, body);
        if (res.ok) {
          backoffMs = 0;
          consecutiveFailures = 0;
          return exp;
        }
        log("debug", "gateway non-OK; will retry with backoff", res);
        consecutiveFailures++;
        backoffMs = consecutiveFailures >= MAX_FAILURES ? 0 : backoffMs === 0 ? 2e3 : Math.min(backoffMs * 2, 3e4);
        return null;
      } catch (err) {
        log("warn", "flush failed; events remain in local buffer", err);
        consecutiveFailures++;
        backoffMs = consecutiveFailures >= MAX_FAILURES ? 0 : backoffMs === 0 ? 2e3 : Math.min(backoffMs * 2, 3e4);
        return null;
      } finally {
        inflight = false;
      }
    }
    function scheduleFlush() {
      if (stopped) return;
      if (consecutiveFailures >= MAX_FAILURES) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const delay = backoffMs > 0 ? Math.max(intervalMs, backoffMs) : intervalMs;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush().finally(() => scheduleFlush());
      }, delay);
    }
    if (gateway) scheduleFlush();
    const beforeUnload = () => {
      try {
        const exp = collector.export();
        const events = exp.events;
        if (events.length === 0 || !gateway) return;
        void transport(gateway, { sessionId, url, events });
      } catch (err) {
        log("warn", "beforeunload flush failed", err);
      }
    };
    const onOnline = () => {
      if (!stopped && !flushTimer) scheduleFlush();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", beforeUnload);
      window.addEventListener("pagehide", beforeUnload);
      window.addEventListener("online", onOnline);
    }
    const notifyRender = reactAdapter ? (n) => reactAdapter.notifyRender(n) : null;
    const handle = {
      sessionId,
      gateway,
      collector,
      flush,
      ...notifyRender ? { notifyRender } : {},
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        try {
          domHandle?.disconnect();
        } catch {
        }
        try {
          inputHandle?.uninstall();
        } catch {
        }
        try {
          netHandle?.uninstall();
        } catch {
        }
        try {
          xhrHandle?.uninstall();
        } catch {
        }
        spanContextSlot.set(null);
        if (typeof window !== "undefined") {
          window.removeEventListener("beforeunload", beforeUnload);
          window.removeEventListener("pagehide", beforeUnload);
          window.removeEventListener("online", onOnline);
        }
      }
    };
    if (typeof window !== "undefined") {
      const g = window;
      g.__sarah = {
        collector,
        sessionId,
        gateway,
        flush,
        export: () => collector.export(),
        ...notifyRender ? { notifyRender } : {}
      };
    }
    return handle;
  }
  function readWindowConfig() {
    if (typeof window === "undefined") return {};
    const w = window;
    return w.__sarahConfig ?? {};
  }
  function makeEntityFor(bmm) {
    return (target) => {
      if (bmm && isElementLike2(target)) {
        try {
          const origin = bmm.resolveOrigin(target);
          if (origin) {
            const base = ent("dom-node", "dom-node");
            if (base.id !== null) {
              return { ...base, origin };
            }
          }
        } catch {
        }
      }
      return ent("dom-node", "dom-node");
    };
  }
  function isElementLike2(x) {
    return typeof x === "object" && x !== null && typeof x.tagName === "string";
  }

  // src/auto.ts
  var DEFAULT_AUTO_BOOT = true;
  function autoBoot() {
    if (typeof window === "undefined") return;
    const w = window;
    if (w.__sarahAutoBooted) return;
    w.__sarahAutoBooted = true;
    let dataGateway;
    let dataSession;
    try {
      if (typeof document !== "undefined") {
        const scripts = document.querySelectorAll("script[data-gateway]");
        for (const s of Array.from(scripts)) {
          const gw = s.getAttribute("data-gateway");
          const sid = s.getAttribute("data-session");
          if (gw) dataGateway = gw;
          if (sid) dataSession = sid;
        }
      }
    } catch {
    }
    const cfg = w.__sarahConfig ?? {};
    const gateway = cfg.gateway ?? dataGateway;
    const sessionId = cfg.sessionId ?? dataSession;
    if (!gateway && !DEFAULT_AUTO_BOOT) return;
    try {
      bootRecorder({ gateway, sessionId });
    } catch (err) {
      try {
        console.error("[sarah-recorder] auto-boot failed", err);
      } catch {
      }
    }
  }
  function deferAutoBoot() {
    if (typeof document !== "undefined" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", deferAutoBoot, { once: true });
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(autoBoot));
    } else {
      setTimeout(autoBoot, 100);
    }
  }
  if (typeof window !== "undefined") {
    try {
      installNetworkCaptureEarly();
    } catch {
    }
    deferAutoBoot();
  }
  return __toCommonJS(auto_exports);
})();
if (typeof window !== "undefined") { window.__sarah = __sarahRecorderInternal; }
//# sourceMappingURL=sarah-recorder.global.js.map
