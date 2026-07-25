// GardenOS voice + GPS capture engine.
// Loaded as a classic script: exposes window.GardenVoice.
// Keeps audio Blobs in IndexedDB (Blobs cannot live in JSON-string app state)
// so the journal entry stays a small JSON object with just an audioId reference.
//
// Style: vanilla JS, no build step, no dependencies, no em dashes / en dashes.

(function(){
  "use strict";

  const DB_NAME = "gardenos-audio";
  const STORE = "recordings";
  const WINDOW_MS = 20000;        // GPS sampling window
  const EARLY_STOP_M = 15;        // stop the watch once we hit this accuracy
  const MIME_CANDIDATES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];

  // Best-of-window GPS acquirer. Uses watchPosition so we keep collecting
  // readings while one is in flight; the watch is also bounded by a hard
  // timeout so we never hang. The single best (smallest accuracyMeters)
  // reading is the resolved answer. Only PERMISSION_DENIED aborts early;
  // every other error is transient and the watch keeps running.
  function acquireLocation(options){
    const onProgress = options && typeof options.onProgress === "function"
      ? options.onProgress
      : null;
    const empty = {
      status: "unavailable",
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      altitude: null,
      capturedAt: null
    };

    return new Promise(resolve => {
      if(!navigator.geolocation){
        resolve(empty);
        return;
      }

      let best = null;
      let settled = false;
      let watchId = null;
      let timeoutId = null;
      const startedAt = Date.now();

      const finish = result => {
        if(settled) return;
        settled = true;
        if(watchId !== null){
          try{ navigator.geolocation.clearWatch(watchId); }catch(_){}
          watchId = null;
        }
        if(timeoutId !== null){
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve(result);
      };

      const reportProgress = () => {
        if(onProgress){
          const remaining = Math.max(0, WINDOW_MS - (Date.now() - startedAt));
          onProgress(best, remaining);
        }
      };

      watchId = navigator.geolocation.watchPosition(
        pos => {
          const candidate = {
            status: "captured",
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
            altitude: pos.coords.altitude == null ? null : pos.coords.altitude,
            capturedAt: new Date(pos.timestamp).toISOString()
          };
          if(!best || candidate.accuracyMeters < best.accuracyMeters){
            best = candidate;
          }
          reportProgress();
          if(candidate.accuracyMeters <= EARLY_STOP_M){
            // Good enough. Stop now so the journal entry is created fast.
            finish(candidate);
          }
        },
        err => {
          // PERMISSION_DENIED (code 1) is fatal: the user said no. Stop trying.
          if(err && err.code === 1){
            finish({
              status: "denied",
              latitude: null,
              longitude: null,
              accuracyMeters: null,
              altitude: null,
              capturedAt: new Date().toISOString()
            });
            return;
          }
          // Transient (POSITION_UNAVAILABLE / TIMEOUT): keep watching.
          reportProgress();
        },
        {enableHighAccuracy: true, maximumAge: 0, timeout: 20000}
      );

      timeoutId = setTimeout(() => {
        finish(best || empty);
      }, WINDOW_MS);
    });
  }

  function qualityLabel(accuracyMeters){
    if(typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters)){
      return {label: "Unknown", className: "unknown"};
    }
    if(accuracyMeters <= 15) return {label: "Excellent", className: "excellent"};
    if(accuracyMeters <= 50) return {label: "Good", className: "good"};
    return {label: "Poor", className: "poor"};
  }

  function mapsUrl(latitude, longitude){
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  function pickMimeType(){
    if(typeof window.MediaRecorder === "undefined") return "";
    return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) || "";
  }

  // Lazy singleton IndexedDB connection. We open on first use and reuse it.
  let dbPromise = null;
  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if(typeof indexedDB === "undefined"){
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const database = e.target.result;
        if(!database.objectStoreNames.contains(STORE)){
          database.createObjectStore(STORE, {keyPath: "id"});
        }
      };
      req.onsuccess = e => {
        const database = e.target.result;
        database.onversionchange = () => {
          // Another tab is upgrading; drop our handle so they can proceed.
          try{ database.close(); }catch(_){}
          dbPromise = null;
        };
        resolve(database);
      };
      req.onerror = () => reject(req.error || new Error("Could not open audio database."));
      req.onblocked = () => reject(new Error("Audio database is blocked by another tab."));
    });
    return dbPromise;
  }

  function txDone(tx){
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Audio database transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("Audio database transaction aborted."));
    });
  }

  function saveAudio(id, blob, mimeType){
    if(!id) return Promise.reject(new Error("saveAudio requires an id."));
    if(!(blob instanceof Blob)) return Promise.reject(new Error("saveAudio requires a Blob."));
    return openDb().then(db => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        id,
        blob,
        mimeType: mimeType || blob.type || "",
        savedAt: new Date().toISOString()
      });
      return txDone(tx);
    });
  }

  function getAudioRecord(id){
    if(!id) return Promise.resolve(null);
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Could not read audio record."));
    })).catch(() => null);  // a missing DB or record is not fatal
  }

  // Object URLs must be revoked by the caller when no longer needed.
  // We return null (not a rejected promise) when the audio is gone, so a
  // journal entry that outlived its blob still renders gracefully.
  function getAudioUrl(id){
    return getAudioRecord(id).then(record => {
      if(!record || !record.blob) return null;
      return URL.createObjectURL(record.blob);
    });
  }

  function deleteAudio(id){
    if(!id) return Promise.resolve();
    return openDb().then(db => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      return txDone(tx);
    }).catch(() => { /* a missing record is not an error */ });
  }

  // Recording state. The capture engine is a singleton: at most one capture
  // runs at a time, because the microphone stream is exclusive.
  let activeStream = null;
  let activeRecorder = null;
  let activeChunks = null;
  let activeMimeType = "";
  let activeStartedAt = 0;
  let activeLocationPromise = null;
  let activeObjectUrl = null;

  function isRecording(){
    return !!(activeRecorder && activeRecorder.state === "recording");
  }

  function ensureSupportedOrThrow(){
    const support = GardenVoice.supported;
    if(!support.secureContext){
      throw new Error("Recording requires a secure context (HTTPS or localhost).");
    }
    if(!support.mediaRecorder){
      throw new Error("This browser does not support MediaRecorder.");
    }
    if(!support.getUserMedia){
      throw new Error("This browser does not support microphone capture.");
    }
    if(!support.geolocation){
      throw new Error("This browser does not support geolocation.");
    }
    if(!support.indexedDB){
      throw new Error("This browser does not support IndexedDB, so audio cannot be stored.");
    }
  }

  function startRecording(){
    ensureSupportedOrThrow();
    if(isRecording()){
      return Promise.reject(new Error("A recording is already in progress."));
    }

    return navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
      activeStream = stream;

      // GPS runs concurrently. Do not await it here; the recorder starts
      // immediately so we never block the user's voice on the GPS window.
      activeLocationPromise = acquireLocation({onProgress: null});

      activeMimeType = pickMimeType();
      try{
        activeRecorder = activeMimeType
          ? new MediaRecorder(stream, {mimeType: activeMimeType})
          : new MediaRecorder(stream);
      }catch(err){
        stream.getTracks().forEach(t => t.stop());
        activeStream = null;
        throw new Error("Could not start the audio recorder: " + (err && err.message ? err.message : "unknown error"));
      }

      activeChunks = [];
      activeStartedAt = Date.now();

      activeRecorder.ondataavailable = e => {
        if(e.data && e.data.size > 0) activeChunks.push(e.data);
      };

      try{
        activeRecorder.start();
      }catch(err){
        stream.getTracks().forEach(t => t.stop());
        activeStream = null;
        activeRecorder = null;
        throw new Error("MediaRecorder refused to start: " + (err && err.message ? err.message : "unknown error"));
      }
    }, err => {
      // Mic refused or unavailable. Surface a clear message.
      const name = err && err.name ? err.name : "Error";
      const msg = name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone permission was denied. Allow access in your browser settings and try again."
        : name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Could not access the microphone: " + (err && err.message ? err.message : name);
      throw new Error(msg);
    });
  }

  function stopRecording(){
    if(!isRecording()){
      return Promise.reject(new Error("There is no recording in progress."));
    }

    return new Promise(resolve => {
      const recorder = activeRecorder;
      const stream = activeStream;
      const chunks = activeChunks || [];
      const mimeType = activeMimeType || (recorder && recorder.mimeType) || "";
      const startedAt = activeStartedAt;
      const locationPromise = activeLocationPromise;

      recorder.onstop = () => {
        // Free the microphone so other apps can use it.
        if(stream){
          try{ stream.getTracks().forEach(t => t.stop()); }catch(_){}
        }
        activeStream = null;
        activeRecorder = null;
        activeChunks = null;
        activeMimeType = "";
        activeStartedAt = 0;
        activeLocationPromise = null;

        const durationMs = Date.now() - startedAt;
        const blob = new Blob(chunks, {type: mimeType || "audio/webm"});

        const settle = (location) => {
          resolve({
            audioBlob: blob,
            mimeType: blob.type || mimeType || "audio/webm",
            durationMs,
            location
          });
        };

        // Always wait on the GPS promise so we capture the best location we
        // accumulated during the recording. If it rejected, fall back to
        // an unavailable result.
        Promise.resolve(locationPromise).then(loc => {
          settle(loc || {
            status: "unavailable",
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            altitude: null,
            capturedAt: null
          });
        }, () => {
          settle({
            status: "unavailable",
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            altitude: null,
            capturedAt: null
          });
        });
      };

      try{
        recorder.stop();
      }catch(_){
        // If stop throws, resolve with whatever we have so the caller never
        // hangs. Clear state to keep isRecording() honest.
        if(stream){
          try{ stream.getTracks().forEach(t => t.stop()); }catch(__){}
        }
        activeStream = null;
        activeRecorder = null;
        const durationMs = Date.now() - startedAt;
        const blob = new Blob(chunks, {type: mimeType || "audio/webm"});
        Promise.resolve(locationPromise).then(loc => {
          resolve({
            audioBlob: blob,
            mimeType: blob.type || mimeType || "audio/webm",
            durationMs,
            location: loc || {
              status: "unavailable",
              latitude: null,
              longitude: null,
              accuracyMeters: null,
              altitude: null,
              capturedAt: null
            }
          });
        }, () => {
          resolve({
            audioBlob: blob,
            mimeType: blob.type || mimeType || "audio/webm",
            durationMs,
            location: {
              status: "unavailable",
              latitude: null,
              longitude: null,
              accuracyMeters: null,
              altitude: null,
              capturedAt: null
            }
          });
        });
      }
    });
  }

  // Capability snapshot. UI uses this to explain WHY recording is unavailable.
  const supported = Object.freeze({
    get secureContext(){
      try{ return !!window.isSecureContext; }catch(_){ return false; }
    },
    get mediaRecorder(){
      return typeof window.MediaRecorder !== "undefined";
    },
    get getUserMedia(){
      return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
    },
    get geolocation(){
      return !!navigator.geolocation;
    },
    get indexedDB(){
      return typeof indexedDB !== "undefined";
    }
  });

  // Convenience: a single boolean the UI can use as a gate, and a list of
  // missing pieces so it can render an actionable explanation.
  function checkSupport(){
    const missing = [];
    if(!supported.secureContext) missing.push("secure context (HTTPS or localhost)");
    if(!supported.mediaRecorder) missing.push("MediaRecorder");
    if(!supported.getUserMedia) missing.push("microphone capture (getUserMedia)");
    if(!supported.geolocation) missing.push("geolocation");
    if(!supported.indexedDB) missing.push("IndexedDB");
    return {
      ok: missing.length === 0,
      missing
    };
  }

  // Public surface. Everything below is what the UI in gardenos/index.html
  // consumes; the keys and shapes match the shared contract exactly.
  window.GardenVoice = Object.freeze({
    acquireLocation,
    startRecording,
    stopRecording,
    isRecording,
    saveAudio,
    getAudioUrl,
    deleteAudio,
    qualityLabel,
    mapsUrl,
    supported,
    checkSupport
  });

  // Internal cleanup if the page unloads mid-recording: free the mic.
  if(typeof window !== "undefined"){
    window.addEventListener("pagehide", () => {
      if(activeStream){
        try{ activeStream.getTracks().forEach(t => t.stop()); }catch(_){}
        activeStream = null;
      }
      if(activeObjectUrl){
        try{ URL.revokeObjectURL(activeObjectUrl); }catch(_){}
        activeObjectUrl = null;
      }
    });
  }
})();