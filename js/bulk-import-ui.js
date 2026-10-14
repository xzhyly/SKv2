// js/bulk-import-ui.js
// bulk-import.html, steps 1 to 4 (docs/reports/2026-10-13-bulk-import-step1.md): choose a folder
// -> parse the file names -> pick the signers -> extract every video (Hands pass + segmentation,
// exactly the live capture's calls; then, for an avatar signer, Holistic on the best repetition's
// window only) -> cache each video at once through php/api/bulk_import.php -> review what an
// import would add -> import: one sample per repetition through php/api/save_gesture.php.
// Step 5 (Avatar): a default signer + fallbacks -> every sign gets that signer's candidate clip
// through php/api/avatar_clip.php (the same request avatar-clips.html sends); works straight from
// the cache, with no folder chosen.
// The videos are only ever read locally through object URLs made by the two extractors; the only
// requests that carry data are landmark JSON to php/api/bulk_import.php and, once Import is
// pressed, to php/api/save_gesture.php (plus the edited texts of new signs to php/api/signs.php).
// Nothing is written to saved_gestures before that.
// Laptop only: Holistic needs WebAssembly SIMD, and must be initialised BEFORE
// GestureDataRecorder.setupMediaPipe() patches WebAssembly.validate (js/gesture-data.js:202-225).
(function () {
  'use strict';

  var PIN = '2026';                         // same PIN as Train Gestures (js/gesture-training-ui.js)
  var UNLOCK_KEY = 'sk_train_unlocked';     // unlock time (ms), set by Train Gestures; this tab session only
  var UNLOCK_MS = 10 * 60 * 1000;           // ... and honoured for 10 minutes
  var REC_KEY = 'sk_bulk_recognition_signers';
  var AVATAR_KEY = 'sk_bulk_avatar_signers';
  var API = 'php/api/bulk_import.php';
  var MAX_CANDIDATE_MS = 60000;             // AvatarExtract refuses longer videos (js/avatar-extract.js:15)
  var DEFAULT_RECOGNITION = 2;              // the first 2 signers found
  var DEFAULT_AVATAR = 3;                   // the first 3 signers found
  var STEPS = ['folder', 'extract', 'review', 'import', 'avatar'];
  // Files a folder holds without anyone putting them there: ignored without a word.
  var JUNK_RE = /^(desktop\.ini|thumbs\.db|ehthumbs\.db|\.ds_store|\..*|~\$.*)$/i;
  var HAND = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
  var TOO_LONG = 'video longer than 60 s';
  // js/gesture-data.js: detect() / createVideoDetector() gave up waiting for MediaPipe Hands.
  var DETECTOR_TIMEOUT_RE = /timed out waiting for MediaPipe results|createVideoDetector\(\): timed out/;
  var NO_SIMD = 'This page must be run on the laptop\'s Chrome: this browser has no WebAssembly SIMD, which the extractor needs. Extraction is disabled.';
  var Core = window.BulkImportCore;
  var POSE = window.AvatarClip ? window.AvatarClip.P : null;   // pose point indices

  function $(id) { return document.getElementById(id); }
  function now() { return performance.now(); }
  function abortError() { return new DOMException('Aborted', 'AbortError'); }

  // Everything the page knows, in one object (window.BulkImport.state): the later steps read it.
  //   videos[]: { file, name, relPath, size, lastModified, parsed:{set,label,key,signer,ext}, id,
  //               cached, meta (the cached meta.json, or null), status, progress, error,
  //               failedStep ('hands'|'holistic'|null), did:{hands,holistic}|null (what its last
  //               turn did), timing:{...}|null, ownsCandidate (false: an earlier file of the
  //               same sign and signer makes the avatar candidate), dupOf (that file's name),
  //               before (the earlier files of the same sign and signer, in file-name order),
  //               importIds ({repIndex: importId} once the Review step has hashed them) }
  //   status: pending | cached | hands | holistic | saving | done | skipped | failed
  var state = {
    step: 'folder',
    simd: false,
    engines: 'idle',            // idle | loading | ready | failed
    engineError: null,
    folder: { name: '', files: 0, ignored: 0, loading: false },
    videos: [],                 // sorted by file name: the extraction queue
    problems: [],               // [{name, relPath, reason}]
    signs: [],                  // sign keys found, sorted
    signers: [],                // signers found, sorted
    signerCounts: {},           // signer -> videos
    recognitionSigners: [],     // sorted
    avatarSigners: [],          // in priority order: [default, ...fallbacks]
    avatarOrder: [],            // every known signer (found in the folder, or with a candidate
                                // in the cache), in the order the list shows them
    cacheSigners: [],           // signers with at least one candidate in the cache, sorted
                                // (known once the Avatar step has read the cache)
    cache: {},                  // videoId -> meta (GET ?action=index, kept up to date)
    clipOwners: null,           // key -> {signer: videoId}: which video each stored candidate came
                                // from (GET ?action=candidates, kept up to date); null = not known
    cacheLoaded: false,
    preview: true,
    run: {
      status: 'idle',           // idle | running | paused | resuming | done
      index: -1, total: 0, current: null, runs: 0,
      elapsedMs: 0, etaMs: null, rate: null,
      counts: { hands: 0, holistic: 0, skipped: 0, failed: 0, done: 0 },   // of the last Start
      work: { ms: 0, videoMs: 0, videos: 0 }                              // measured, for the ETA
    },
    // Summed over this page load: ms spent inside each extractor and the frames it returned.
    timings: { hands: { ms: 0, frames: 0, videos: 0 }, holistic: { ms: 0, frames: 0, videos: 0 } },
    // Step 3. rows[]: one per video and per file-name problem, in file-name order:
    //   { id (null for a file-name problem), name, relPath, video (the videos[] entry), label, key,
    //     set, signer, reps, kind, text (the status shown), group (the reason a summary counts it
    //     under), enabled, checked, isNew (its key is no sign yet), newSign (isNew and importable),
    //     problem, addReps:[{index, rows}] (repetitions not saved yet), doneReps (already saved) }
    //   kind: ok | problem (importable, not ticked by default) | imported | collision |
    //         set-differs | not-extracted | failed | not-used | no-reps | bad-name
    review: {
      status: 'idle',           // idle | loading | ready | failed
      error: null,
      signs: {},                // key -> {set, textEn, textFil, samples, avatar}: the signs that exist
      files: {},                // key -> {sample file name: true}: what saved_gestures holds
      current: { ESL: 0, FSL: 0 },   // training rows per model now, as the kiosk loads them
      labels: { ESL: {}, FSL: {} },  // per model: the sign keys that have at least one row
      rows: [],
      newSigns: [],             // [{key, set, file, textEn, textFil, draftEn, draftFil, active}]
      checks: {},               // videoId -> the tick the user chose (absent: the default)
      texts: {},                // key -> {textEn, textFil} as typed
      filter: 'all',            // all | problems | new | import
      // {current, added, projected: {ESL, FSL} rows; knn: {status: 'measuring'|'ready', capped,
      //  current, projected: {ESL, FSL} ms (null until measured), labels: {current, projected}}}
      projection: null,
      toImport: { videos: 0, samples: 0 },
      blocked: null             // why Import cannot be pressed (a message), or null
    },
    // Step 4. queue[]: { id, name, video, key, set, isNew, rep (next repetition to send), reps,
    //                    added, duplicates, skip (why the video was left, or null), hands }
    imp: {
      status: 'idle',           // idle | running | paused | done
      phase: 'samples',         // samples | texts | finish | done
      queue: [], index: 0, textAt: 0, current: null,
      added: 0, duplicates: 0, skipped: 0,
      signs: {},                // key -> {key, set, isNew, created, added, duplicates, texts, textUpdated, textError}
                                //   (created: new at Review time and at least one repetition accepted)
      notPicked: [],            // [{name, reason}]: the folder's videos this import leaves out
      langs: {},                // model language -> true once a sample was added to it
      message: null, error: false, pauseAsked: false,
      summary: null             // the last finished import (see buildSummary)
    },
    // Step 5. rows[]: one per sign and per candidate key without a sign, sorted by key:
    //   { key, text, current (the clip it has now, as shown), signers (its candidates), kind, action }
    //   kind: set | fallback | no-clip | left-alone | not-imported | set-differs (its only
    //   candidates from the listed signers were made from a video of another set)
    av: {
      status: 'idle',           // idle | loading | ready | failed
      error: null,
      signs: {},                // key -> {set, textEn, textFil, samples, avatar} (GET signs.php)
      candidates: {},           // key -> [{signer, frames, videoId, repIndex, savedAt}]
      picks: {},                // key -> {signer, by, at}
      keepHand: true,
      plan: null,               // BulkImportCore.assignDefaults() on the above
      rows: [],
      starting: false,          // Apply / Resume is reading the signs and the cache again first
      notice: null,             // why the last Apply did not start (the data changed), or null
      // One Apply: keys = the plan's signs in key order, index = the next one; saved / failed /
      // leftAlone (picked by hand while it was paused) fill as it goes, so Resume after a pause
      // simply carries on. before: key -> {avatar, pick} when it started; inFlight: the sign
      // whose save was sent when it paused; stuck: the sign a server error paused it at.
      run: { status: 'idle', plan: null, order: [], keepHand: true, keys: [], index: 0, saved: [], failed: [], leftAlone: [], before: {}, inFlight: null, stuck: null, picksDone: false, picksError: null, message: null, error: false },
      summary: null             // the last finished Apply (see buildAvatarSummary)
    }
  };
  var extractor = null;         // the one AvatarExtract extractor
  var rowEls = {};              // videoId -> its <tr>
  var folderToken = 0;
  var runAbort = null;
  var runPromise = null;
  var runSince = 0;             // when the queue was last (re)started
  var videoSince = 0;           // when the video in progress was started
  var ticker = null;
  var runFresh = false;         // the next pass is a Start (not a Resume)
  var holisticReady = false;

  function emit(type, detail) {
    document.dispatchEvent(new CustomEvent('bulkimport:' + type, { detail: detail || null }));
  }

  // ── PIN ──
  var pin = '';
  function pinDots() {
    document.querySelectorAll('.pin-dot').forEach(function (d, i) { d.classList.toggle('active', i < pin.length); });
  }
  function unlock() {
    $('pin-screen').classList.remove('active');
    $('bi-ui').classList.add('active');
    start();
  }
  function onPinKey(v) {
    if (v === 'clear') pin = '';
    else if (v === 'back') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += v;
    pinDots();
    if (pin.length === 4) {
      setTimeout(function () {
        if (pin === PIN) {
          try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now())); } catch (e) { /* storage blocked */ }
          pin = ''; pinDots(); unlock();
        } else {
          var card = document.querySelector('.pin-card');
          card.classList.add('shake');
          toast('❌ Incorrect PIN. Try again.');
          setTimeout(function () { card.classList.remove('shake'); pin = ''; pinDots(); }, 450);
        }
      }, 120);
    }
  }

  function toast(message) {
    var t = $('sk-toast');
    if (!t) return;
    t.textContent = message;
    t.style.opacity = '1';
    clearTimeout(window.skToastTimeout);
    window.skToastTimeout = setTimeout(function () { t.style.opacity = '0'; }, 3000);
  }

  function status(text, isError) {
    var s = $('bi-status');
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  // ── Steps ──
  function showStep(step) {
    if (STEPS.indexOf(step) < 0) return;
    state.step = step;
    STEPS.forEach(function (s) {
      var on = s === step;
      $('bi-step-' + s).classList.toggle('active', on);
      $('bi-tab-' + s).classList.toggle('active', on);
      $('bi-tab-' + s).setAttribute('aria-selected', on ? 'true' : 'false');
    });
    emit('step', { step: step });
  }

  // ── Cache endpoint ──
  function request(url, options) {
    return fetch(url, options).then(function (r) {
      return r.text().then(function (text) {
        var d = null;
        try { d = JSON.parse(text); } catch (e) { /* not JSON: reported below */ }
        if (!r.ok || !d || !d.success) {
          var err = new Error((d && d.error) || 'HTTP ' + r.status);
          err.http = r.status;
          throw err;
        }
        return d;
      });
    });
  }
  function apiGet(query) { return request(API + '?' + query, { cache: 'no-cache' }); }
  function apiPost(body) {
    return request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  // A cache write of the extraction queue. When the server cannot be reached or answers 5xx the
  // error is marked cacheWrite: the queue then pauses instead of failing video after video.
  // (A 4xx is the server refusing this one video, e.g. too large: only that video fails.)
  function cachePost(body) {
    return apiPost(body).catch(function (e) {
      if (!e || !e.http || e.http >= 500) { e = e || new Error('no answer'); e.cacheWrite = true; }
      throw e;
    });
  }

  // Re-reads the cache index and marks every video cached / not cached.
  function refreshCache() {
    // The candidate list says which video each stored clip came from: a video's own meta can
    // still say "ok" after another file of the same sign and signer replaced its clip. Display
    // only: when it cannot be read the owners are simply not known.
    var owners = apiGet('action=candidates').then(function (d) {
      var map = {};
      Object.keys(d.candidates || {}).forEach(function (key) {
        map[key] = {};
        (d.candidates[key] || []).forEach(function (c) { map[key][c.signer] = c.videoId; });
      });
      return map;
    }, function () { return null; });
    return apiGet('action=index').then(null, function (e) { state.cacheLoaded = false; throw e; }).then(function (d) {
      return owners.then(function (map) { state.clipOwners = map; return d; });
    }).then(function (d) {
      state.cache = d.videos || {};
      state.cacheLoaded = true;
      state.videos.forEach(function (row) {
        var meta = Object.prototype.hasOwnProperty.call(state.cache, row.id) ? state.cache[row.id] : null;
        row.meta = meta;
        row.cached = !!meta;
        if (meta && (row.status === 'pending' || row.status === 'failed')) row.status = 'cached';
        if (!meta && (row.status === 'cached' || row.status === 'skipped' || row.status === 'done')) row.status = 'pending';
      });
      renderCounts();
      state.videos.forEach(updateRow);
      emit('cache');
    });
  }

  // ── Folder ──
  function sha32(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      var b = new Uint8Array(buf), s = '';
      for (var i = 0; i < 16; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      return s;
    });
  }
  function byName(a, b) {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
  }

  // files: a FileList / array of File (the folder input's files). Parses every name, hashes the
  // video ids, loads the cache index and shows the signer lists. Nothing is read from the videos.
  function setFolder(files) {
    if (state.run.status === 'running') { toast('Pause the extraction before choosing another folder.'); return Promise.resolve(false); }
    if (state.imp.status === 'running') { toast('Wait for the import to finish, or pause it, before choosing another folder.'); return Promise.resolve(false); }
    var token = ++folderToken;
    var list = Array.prototype.slice.call(files || []);
    var rows = [], problems = [], ignored = 0;
    list.forEach(function (f) {
      var relPath = f.webkitRelativePath || f.name;
      var parsed = Core.parseName(f.name);
      if (!parsed.ok) {
        if (JUNK_RE.test(f.name)) ignored++;
        else problems.push({ name: f.name, relPath: relPath, reason: parsed.reason });
        return;
      }
      rows.push({
        file: f, name: f.name, relPath: relPath, size: f.size, lastModified: f.lastModified, parsed: parsed,
        id: null, cached: false, meta: null, status: 'pending', progress: 0, error: null, failedStep: null, did: null, timing: null,
        ownsCandidate: true, dupOf: null, before: [], importIds: null
      });
    });
    var first = list.length ? (list[0].webkitRelativePath || '') : '';
    state.folder = { name: first.indexOf('/') > 0 ? first.split('/')[0] : '', files: list.length, ignored: ignored, loading: true };
    state.run.status = 'idle';
    state.run.index = -1;
    state.run.current = null;
    updateRunButtons();
    status('Reading ' + list.length + ' file names…');
    return Promise.all(rows.map(function (row) { return sha32(Core.videoIdSource(row)); })).then(function (ids) {
      if (token !== folderToken) return false;
      var seen = {};
      var videos = [];
      rows.forEach(function (row, i) { row.id = ids[i]; });
      rows.sort(byName).forEach(function (row) {
        // The same file twice (a copy in a sub-folder): one cache entry, so only the first is kept.
        if (seen[row.id]) { problems.push({ name: row.name, relPath: row.relPath, reason: 'same file as ' + seen[row.id] }); return; }
        seen[row.id] = row.relPath;
        videos.push(row);
      });
      problems.sort(byName);
      var signers = {}, signs = {}, owners = {};
      videos.forEach(function (row) {
        // Two files of one sign by one signer: both give recognition samples, but only the first
        // in file-name order makes the avatar candidate (candidates/<key>/<SIGNER>.json is one file).
        // A later one only takes over when every earlier one gave up (mayMakeCandidate()).
        var pair = row.parsed.key + '|' + row.parsed.signer;
        if (owners[pair]) { row.ownsCandidate = false; row.dupOf = owners[pair][0].name; row.before = owners[pair].slice(); owners[pair].push(row); }
        else owners[pair] = [row];
        signers[row.parsed.signer] = (signers[row.parsed.signer] || 0) + 1;
        signs[row.parsed.key] = true;
      });
      state.videos = videos;
      state.problems = problems;
      state.signerCounts = signers;
      state.signers = Object.keys(signers).sort();
      state.signs = Object.keys(signs).sort();
      state.run.total = videos.length;
      resolveSignerLists();
      renderProblems();
      renderSigners();
      renderVideos();
      renderCounts();
      return refreshCache().then(function () {
        var found = 'Found ' + videos.length + ' videos of ' + state.signs.length + ' signs by ' + state.signers.length + ' signers. ';
        if (!videos.length) status('No video with a valid name in this folder.', true);
        else if (!state.simd) status(found + NO_SIMD, true);
        else if (state.engines === 'failed') status(found + 'The extractors could not be loaded: ' + state.engineError, true);
        else status(found + 'Check the signer lists, then go to Extract.');
      }, function (e) {
        state.cacheLoaded = false;
        status('The folder was read, but the cache could not be loaded: ' + (e && e.message ? e.message : e), true);
      });
    }).then(function () {
      if (token !== folderToken) return false;
      state.folder.loading = false;
      updateRunButtons();
      renderProgress();
      emit('folder');
      return true;
    }, function (e) {
      if (token !== folderToken) return false;
      state.folder.loading = false;
      updateRunButtons();
      status('This folder could not be read: ' + (e && e.message ? e.message : e), true);
      return false;
    });
  }

  // ── Signer lists (remembered in localStorage, restricted to the signers found) ──
  function stored(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v.filter(function (s) { return typeof s === 'string'; }) : null;
    } catch (e) { return null; }
  }
  function remember() {
    try {
      localStorage.setItem(REC_KEY, JSON.stringify(state.recognitionSigners));
      localStorage.setItem(AVATAR_KEY, JSON.stringify(state.avatarSigners));
    } catch (e) { /* storage blocked */ }
  }
  // A remembered list is used as far as its signers are in this folder; a remembered EMPTY list is
  // a choice and is kept; a list naming only signers that are not here falls back to the default.
  // found: the signers the list may name; first: where the default comes from (default: found).
  function pickList(key, count, found, first) {
    var saved = stored(key);
    if (saved) {
      var here = saved.filter(function (s, i) { return found.indexOf(s) >= 0 && saved.indexOf(s) === i; });
      if (here.length || !saved.length) return here;
    }
    return (first || found).slice(0, count);
  }
  // The signers the avatar list offers: those found in the folder and those that have a candidate
  // in the cache (the Avatar step works with no folder chosen), sorted.
  function knownSigners() {
    return state.signers.concat(state.cacheSigners.filter(function (s) { return state.signers.indexOf(s) < 0; })).sort();
  }
  function resolveAvatarList() {
    var known = knownSigners();
    state.avatarSigners = pickList(AVATAR_KEY, DEFAULT_AVATAR, known, state.signers.length ? state.signers : known);
    state.avatarOrder = state.avatarSigners.concat(known.filter(function (s) { return state.avatarSigners.indexOf(s) < 0; }));
  }
  function resolveSignerLists() {
    state.recognitionSigners = pickList(REC_KEY, DEFAULT_RECOGNITION, state.signers).sort();
    resolveAvatarList();
  }
  // list: the signers that have a candidate in the cache (the Avatar step has just read it). The
  // list in use keeps its ticks and its order; a signer that is new to it is added at the end,
  // not ticked. Nothing is remembered: this is not a choice of the user.
  function setCacheSigners(list) {
    var next = list.slice().sort();
    if (next.join() === state.cacheSigners.join()) return;
    var fresh = !state.avatarOrder.length;
    state.cacheSigners = next;
    var known = knownSigners();
    if (fresh) resolveAvatarList();
    else {
      state.avatarSigners = state.avatarSigners.filter(function (s) { return known.indexOf(s) >= 0; });
      state.avatarOrder = state.avatarOrder.filter(function (s) { return known.indexOf(s) >= 0; })
        .concat(known.filter(function (s) { return state.avatarOrder.indexOf(s) < 0; }));
    }
    renderSigners();
    state.videos.forEach(updateRow);
    emit('signers');
  }
  function signersChanged() {
    state.avatarSigners = state.avatarOrder.filter(function (s) { return state.avatarSigners.indexOf(s) >= 0; });
    remember();
    renderSigners();
    state.videos.forEach(updateRow);
    renderProgress();
    emit('signers');
  }
  function setRecognitionSigners(list) {
    state.recognitionSigners = state.signers.filter(function (s) { return (list || []).indexOf(s) >= 0; });
    signersChanged();
  }
  // list: [default, ...fallbacks]; signers that are not known (not in the folder and without a
  // candidate in the cache) are dropped.
  function setAvatarSigners(list) {
    var known = knownSigners();
    var keep = (list || []).filter(function (s, i) { return known.indexOf(s) >= 0 && list.indexOf(s) === i; });
    state.avatarSigners = keep;
    state.avatarOrder = keep.concat(known.filter(function (s) { return keep.indexOf(s) < 0; }));
    signersChanged();
  }
  function moveAvatar(signer, by) {
    var o = state.avatarOrder, i = o.indexOf(signer), j = i + by;
    if (i < 0 || j < 0 || j >= o.length) return;
    o[i] = o[j]; o[j] = signer;
    signersChanged();
    var again = document.querySelector('.bi-panel.active .bi-move[data-signer="' + signer + '"][data-by="' + by + '"]');
    if (again && !again.disabled) again.focus();
  }

  function renderSigners() {
    $('bi-signers').hidden = !state.signers.length;
    var rec = $('bi-recognition');
    rec.textContent = '';
    state.signers.forEach(function (s) {
      var label = document.createElement('label'); label.className = 'bi-check';
      var box = document.createElement('input'); box.type = 'checkbox'; box.dataset.signer = s;
      box.checked = state.recognitionSigners.indexOf(s) >= 0;
      box.addEventListener('change', function () {
        var next = state.recognitionSigners.filter(function (x) { return x !== s; });
        if (box.checked) next.push(s);
        setRecognitionSigners(next);
      });
      var count = document.createElement('small'); count.textContent = state.signerCounts[s] + ' videos';
      label.appendChild(box); label.appendChild(document.createTextNode(s)); label.appendChild(count);
      rec.appendChild(label);
    });
    renderOrder($('bi-avatar'));
    renderOrder($('bi-av-order'));
    renderAvatarDefault();
  }
  // The avatar signers' priority list (state.avatarOrder / state.avatarSigners): shown in the
  // Folder step and in the Avatar step, one state behind both.
  function renderOrder(av) {
    av.textContent = '';
    var rank = 0;
    state.avatarOrder.forEach(function (s, i) {
      var on = state.avatarSigners.indexOf(s) >= 0;
      var row = document.createElement('div'); row.className = 'bi-order-row' + (on ? ' on' : ''); row.dataset.signer = s;
      var label = document.createElement('label');
      var box = document.createElement('input'); box.type = 'checkbox'; box.dataset.signer = s; box.checked = on;
      box.addEventListener('change', function () {
        if (box.checked) state.avatarSigners.push(s);
        else state.avatarSigners = state.avatarSigners.filter(function (x) { return x !== s; });
        signersChanged();
      });
      label.appendChild(box); label.appendChild(document.createTextNode(s));
      var role = document.createElement('span'); role.className = 'bi-order-role';
      if (on) { rank++; role.textContent = rank === 1 ? 'default signer' : 'fallback ' + (rank - 1); if (rank === 1) role.classList.add('default'); }
      else role.textContent = 'not used';
      row.appendChild(label); row.appendChild(role);
      [[-1, '↑', 'up'], [1, '↓', 'down']].forEach(function (m) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'bi-move'; b.textContent = m[1];
        b.dataset.signer = s; b.dataset.by = String(m[0]);
        b.setAttribute('aria-label', 'Move ' + s + ' ' + m[2]);
        b.disabled = i + m[0] < 0 || i + m[0] >= state.avatarOrder.length;
        b.addEventListener('click', function () { moveAvatar(s, m[0]); });
        row.appendChild(b);
      });
      av.appendChild(row);
    });
  }

  function renderCounts() {
    var cached = state.videos.filter(function (r) { return r.cached; }).length;
    $('bi-n-videos').textContent = state.videos.length;
    $('bi-n-signs').textContent = state.signs.length;
    $('bi-n-signers').textContent = state.signers.length;
    $('bi-n-problems').textContent = state.problems.length;
    $('bi-n-cached').textContent = cached;
    $('bi-folder-name').textContent = state.folder.files
      ? (state.folder.name ? state.folder.name + ' · ' : '') + state.folder.files + ' files' +
        (state.folder.ignored ? ' (' + state.folder.ignored + ' ignored)' : '')
      : 'No folder chosen.';
    $('bi-count').textContent = state.videos.length ? state.videos.length + ' videos · ' + cached + ' extracted' : '';
    $('bi-problem-count').textContent = state.problems.length ? '(' + state.problems.length + ')' : '';
    $('bi-video-count').textContent = state.videos.length ? '(' + state.videos.length + ')' : '';
    $('bi-to-extract').disabled = !state.videos.length;
  }

  function cell(tr, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    tr.appendChild(td);
    return td;
  }

  function renderProblems() {
    var body = $('bi-problems').querySelector('tbody');
    body.textContent = '';
    state.problems.forEach(function (p) {
      var tr = document.createElement('tr');
      cell(tr, p.relPath, 'bi-file');
      cell(tr, p.reason, 'bi-warn');
      body.appendChild(tr);
    });
    $('bi-problems').hidden = !state.problems.length;
    $('bi-problems-empty').hidden = !!state.problems.length;
    $('bi-problems-empty').textContent = state.folder.files ? 'No problems: every file name was understood.' : 'Choose a folder to list its videos.';
  }

  // ── Video table ──
  var STATUS_TEXT = {
    pending: 'waiting', cached: 'already extracted', saving: 'saving…', done: 'done', skipped: 'skipped (already extracted)'
  };
  function statusText(row) {
    if (row.status === 'hands') return 'reading hands ' + Math.round(row.progress * 100) + '%';
    if (row.status === 'holistic') return 'avatar clip ' + Math.round(row.progress * 100) + '%';
    if (row.status === 'failed' && row.failedStep === 'holistic') return 'avatar clip failed: ' + row.error + ' (recognition data kept)';
    if (row.status === 'failed') return 'failed: ' + row.error;
    if (row.status === 'done' && row.did && !row.did.hands) return 'done (avatar clip only)';
    return STATUS_TEXT[row.status] || row.status;
  }
  // A video's meta.candidate ({state:'ok'|'none', ...}), or null while it has none.
  function candidateOf(meta) {
    return (meta && meta.candidate) || null;
  }
  // May this video make the avatar candidate of its sign and signer? The first file in file-name
  // order does; a later one only when every earlier one gave up (its extraction failed, or it has
  // no clip: no repetition, too long, ...). The earlier files always have their turn first.
  function mayMakeCandidate(row) {
    return row.ownsCandidate || row.before.every(function (o) {
      var c = candidateOf(o.meta);
      return o.status === 'failed' || !!(c && c.state === 'none');
    });
  }
  // The video the stored candidate of this row's sign and signer came from, when it is ANOTHER
  // video (its id), else null. The candidate file is trusted, not this video's meta.
  function clipTakenBy(row) {
    var byKey = state.clipOwners && Object.prototype.hasOwnProperty.call(state.clipOwners, row.parsed.key) ? state.clipOwners[row.parsed.key] : null;
    var id = byKey && Object.prototype.hasOwnProperty.call(byKey, row.parsed.signer) ? byKey[row.parsed.signer] : null;
    return id && id !== row.id ? id : null;
  }
  function candidateText(row) {
    var c = candidateOf(row.meta);
    if (c && c.state === 'ok' && clipTakenBy(row)) {
      var by = clipTakenBy(row), other = null;
      state.videos.forEach(function (v) { if (v.id === by) other = v.name; });
      return 'replaced: ' + (other || 'another video') + ' now makes the clip of this sign and signer';
    }
    if (c) return c.state === 'ok' ? c.frames + ' frames (rep ' + c.repIndex + ')' : 'none: ' + c.reason;
    if (state.avatarSigners.indexOf(row.parsed.signer) < 0) return '—';
    return mayMakeCandidate(row) ? 'not yet' : 'none: ' + row.dupOf + ' makes the clip of this sign and signer';
  }
  function renderVideos() {
    var body = $('bi-videos').querySelector('tbody');
    body.textContent = '';
    rowEls = {};
    var frag = document.createDocumentFragment();
    state.videos.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.dataset.id = row.id;
      cell(tr, row.relPath, 'bi-file');
      cell(tr, row.parsed.key);
      cell(tr, row.parsed.set);
      cell(tr, row.parsed.signer);
      cell(tr, '', 'bi-num bi-reps');
      cell(tr, '', 'bi-st');
      cell(tr, '', 'bi-cand');
      rowEls[row.id] = tr;
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    $('bi-videos').hidden = !state.videos.length;
    $('bi-videos-empty').hidden = !!state.videos.length;
    state.videos.forEach(updateRow);
  }
  function updateRow(row) {
    var tr = rowEls[row.id];
    if (!tr) return;
    var found = row.meta && row.meta.seg ? row.meta.seg.repsFound : null;
    var reps = tr.querySelector('.bi-reps');
    reps.textContent = found === null ? '—' : String(found);
    reps.classList.toggle('bi-warn', found !== null && found !== Core.REQUIRED_REPS);
    tr.querySelector('.bi-st').textContent = statusText(row);
    var cand = tr.querySelector('.bi-cand');
    cand.textContent = candidateText(row);
    var c = candidateOf(row.meta);
    cand.classList.toggle('bi-warn', !!(c && c.state === 'none') || !!(c && clipTakenBy(row)) ||
      (!c && !mayMakeCandidate(row) && state.avatarSigners.indexOf(row.parsed.signer) >= 0));
    tr.className = (row.status === 'failed' ? 'failed' : row.status === 'done' ? 'done' : row.cached ? 'cached' : '') +
      (state.run.current === row ? ' current' : '');
  }

  // ── Preview: the frame an extractor has just read, with what it found ──
  function fit(source) {
    var cv = $('bi-preview'), g = cv.getContext('2d');
    g.fillStyle = '#1a2540';
    g.fillRect(0, 0, cv.width, cv.height);
    if (!source || !source.width || !source.height) return null;
    var s = Math.min(cv.width / source.width, cv.height / source.height);
    var box = { w: source.width * s, h: source.height * s };
    box.x = (cv.width - box.w) / 2; box.y = (cv.height - box.h) / 2;
    g.drawImage(source, box.x, box.y, box.w, box.h);
    return { g: g, box: box };
  }
  function strokeHand(g, box, points, color) {
    function pt(p) { return { x: box.x + (p.x !== undefined ? p.x : p[0]) * box.w, y: box.y + (p.y !== undefined ? p.y : p[1]) * box.h }; }
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2; g.lineCap = 'round';
    HAND.forEach(function (c) {
      g.beginPath();
      c.forEach(function (i, k) { var a = pt(points[i]); if (k) g.lineTo(a.x, a.y); else g.moveTo(a.x, a.y); });
      g.stroke();
    });
    points.forEach(function (p) { var a = pt(p); g.beginPath(); g.arc(a.x, a.y, 2, 0, Math.PI * 2); g.fill(); });
  }
  // Hands pass: canvas is the 320x240 picture sent to MediaPipe Hands, results what it answered.
  function drawHandsFrame(canvas, results) {
    var d = fit(canvas);
    if (!d) return;
    (results.multiHandLandmarks || []).forEach(function (hand, i) { strokeHand(d.g, d.box, hand, i ? '#f43f5e' : '#a3e635'); });
  }
  // Holistic pass: frame is AvatarClip.packFrame()'s [pose, leftHand, rightHand].
  function drawHolisticFrame(canvas, frame) {
    var d = fit(canvas);
    if (!d || !frame) return;
    var g = d.g, box = d.box, pose = frame[0];
    function pt(p) { return { x: box.x + p[0] * box.w, y: box.y + p[1] * box.h }; }
    if (pose && POSE) {
      g.strokeStyle = '#22d3ee'; g.lineWidth = 3; g.lineCap = 'round';
      [[POSE.shL, POSE.elL], [POSE.elL, POSE.wrL], [POSE.shR, POSE.elR], [POSE.elR, POSE.wrR], [POSE.shL, POSE.shR], [POSE.shL, POSE.hipL], [POSE.shR, POSE.hipR], [POSE.hipL, POSE.hipR]].forEach(function (e) {
        var a = pt(pose[e[0]]), b = pt(pose[e[1]]);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      });
    }
    if (frame[2]) strokeHand(g, box, frame[2], '#f43f5e');
    if (frame[1]) strokeHand(g, box, frame[1], '#a3e635');
  }

  function drawHolisticResults(canvas, results) { drawHolisticFrame(canvas, window.AvatarClip.packFrame(results)); }
  // Display only: an error while drawing must never fail a video.
  function preview(draw, canvas, found) {
    if (!state.preview) return;
    try { draw(canvas, found); } catch (e) { console.warn('[bulk-import] preview failed:', e); }
  }

  // ── Extraction of one video ──
  // Which work a video still needs: 'full' (Hands pass, then the candidate when its signer is an
  // avatar signer), 'candidate' (cached, but its signer was added to the avatar list later: only
  // the Holistic step, from the cached best repetition) or 'skip'. A later file of a sign and
  // signer whose first file makes the clip has no candidate work (nothing is stored for it).
  function needsCandidate(row, meta) {
    return state.avatarSigners.indexOf(row.parsed.signer) >= 0 && !candidateOf(meta) && mayMakeCandidate(row);
  }
  function planWork(row) {
    if (!row.cached || !row.meta) return 'full';
    return needsCandidate(row, row.meta) ? 'candidate' : 'skip';
  }

  function setProgress(row, fraction) {
    row.progress = fraction;
    var tr = rowEls[row.id];
    if (tr) tr.querySelector('.bi-st').textContent = statusText(row);
    renderProgress();
  }

  // The Hands pass and the segmentation: the same calls, with the same arguments, as the live
  // capture's saveRecording() (js/gesture-capture-ui.js:557-592). The only addition is that the
  // detector is watched, so the picture it was sent can be shown.
  async function handsPass(row, signal) {
    var det = null;
    var result;
    var t0 = now();
    try {
      det = await window.GestureDataRecorder.createVideoDetector();
      var watched = {
        reset: function () { det.reset(); },
        detect: function (canvas) {
          return det.detect(canvas).then(function (r) {
            if (!signal.aborted) preview(drawHandsFrame, canvas, r);
            return r;
          });
        }
      };
      result = await window.VideoLandmarks.extractVideoLandmarks(row.file, {
        detector: watched,
        fps: window.GestureCaptureCore.CAPTURE.PROCESS_FPS,
        signal: signal,
        onProgress: function (done, total) {
          if (signal.aborted || !total) return;
          setProgress(row, done / total);
        }
      });
    } finally {
      if (det) {
        try { det.release(); } catch (e) { console.warn('[bulk-import] detector release failed:', e); }
      }
    }
    var ms = now() - t0;
    var seg = window.GestureCaptureCore.segmentFrames(
      result.frames.map(function (f) { return { t: f.t, handPresent: f.hands.length > 0 }; }),
      { endMs: result.durationMs }
    );
    return { result: result, seg: seg, ms: ms };
  }

  function releaseVideo() {
    var v = $('bi-video');
    if (v.src && v.src.indexOf('blob:') === 0) URL.revokeObjectURL(v.src);
    v.removeAttribute('src');
    v.load();
  }

  // The avatar candidate of a video whose signer is an avatar signer: Holistic on the best
  // repetition's window only. -> the meta.candidate value ({state:'ok'|'none', ...}).
  async function candidateStep(row, meta, signal, timing) {
    var t0 = now();
    var signer = row.parsed.signer;
    var best = meta.bestRep;
    function none(reason) {
      return { state: 'none', reason: reason, signer: signer, frames: 0, repIndex: best ? best.index : null, ms: Math.round(now() - t0) };
    }
    if (!best) return none('no repetition found');
    if (meta.hands.durationMs >= MAX_CANDIDATE_MS) return none(TOO_LONG);
    row.status = 'holistic';
    setProgress(row, 0);
    var res;
    try {
      res = await extractor.extract(row.file, {
        video: $('bi-video'),
        range: { startMs: best.windowStartMs, endMs: best.windowEndMs },
        signal: signal,
        onFrame: function (i, n, results, canvas) {
          if (signal.aborted) return;
          setProgress(row, (i + 1) / n);
          preview(drawHolisticResults, canvas, results);
        }
      });
    } catch (e) {
      // the extractor's own refusal of a long video (js/avatar-extract.js: "... under 60 s")
      if (e && e.name !== 'AbortError' && /under \d+ s$/.test(e.message || '')) return none(TOO_LONG);
      throw e;
    } finally {
      releaseVideo();
    }
    timing.holisticMs = now() - t0;
    timing.holisticFrames = res.frames.length;
    var built = Core.buildCandidate({
      key: row.parsed.key, signer: signer, holistic: res, AvatarClip: window.AvatarClip, createdAt: new Date().toISOString()
    });
    if (!built.ok) return none(built.reason);
    if (signal.aborted) throw abortError();
    // ... with the video's set: a clip of an ESL video is never offered to a sign that exists as FSL
    await cachePost({ action: 'put_candidate', key: row.parsed.key, signer: signer, set: row.parsed.set, videoId: row.id, repIndex: best.index, clip: built.clip });
    // candidates/<key>/<SIGNER>.json is now this video's: any other video of the pair whose meta
    // still says "ok" no longer owns the clip (its meta is left as it is, its row says so).
    if (!state.clipOwners) state.clipOwners = {};
    if (!Object.prototype.hasOwnProperty.call(state.clipOwners, row.parsed.key)) state.clipOwners[row.parsed.key] = {};
    state.clipOwners[row.parsed.key][signer] = row.id;
    state.videos.forEach(function (v) { if (v !== row && v.parsed.key === row.parsed.key && v.parsed.signer === signer) updateRow(v); });
    return { state: 'ok', signer: signer, frames: built.clip.frames.length, repIndex: best.index, ms: Math.round(now() - t0) };
  }

  function adoptMeta(row, meta) {
    row.meta = meta;
    row.cached = true;
    state.cache[row.id] = meta;
  }

  // plan: 'full' or 'candidate'. The Hands result is cached as soon as it exists (put_video with
  // candidate: null); the candidate step follows and ends with a meta-only put_video. So an abort
  // or a failure during the Holistic step keeps the cached Hands result: the video then only needs
  // 'candidate' work. Throws on an abort or a failure; an error of the candidate step has
  // step === 'holistic'.
  async function processVideo(row, plan, signal) {
    var timing = row.timing = { handsMs: 0, handsFrames: 0, holisticMs: 0, holisticFrames: 0, totalMs: 0 };
    var did = row.did = { hands: false, holistic: false };
    var t0 = now();
    var t = state.timings;
    var meta = row.meta;
    if (plan === 'full') {
      row.status = 'hands';
      setProgress(row, 0);
      var h = await handsPass(row, signal);
      var r = h.result;
      var reps = Core.summarizeReps(r, h.seg);
      timing.handsMs = h.ms;
      timing.handsFrames = r.frames.length;
      meta = {
        v: 1, id: row.id,
        file: { name: row.name, size: row.size, lastModified: row.lastModified, relPath: row.relPath },
        parsed: { set: row.parsed.set, label: row.parsed.label, key: row.parsed.key, signer: row.parsed.signer },
        hands: {
          videoWidth: r.videoWidth, videoHeight: r.videoHeight, fps: r.fps, durationMs: r.durationMs, input: r.input,
          frameCount: r.frames.length,
          handFrames: r.frames.filter(function (f) { return f.hands.length > 0; }).length,
          ms: Math.round(h.ms)
        },
        seg: { ok: !!h.seg.ok, reason: h.seg.ok ? null : h.seg.reason, repsFound: h.seg.reps.length },
        reps: reps,
        bestRep: Core.pickBestRep(reps, r.durationMs, h.seg),
        candidate: null,
        savedAt: new Date().toISOString()      // when the Hands result was cached; later updates keep it
      };
      var hands = {
        id: row.id,
        meta: { videoWidth: r.videoWidth, videoHeight: r.videoHeight, fps: r.fps, input: r.input },
        reps: h.seg.reps.map(function (rep) {
          return { index: rep.index, frames: r.frames.slice(rep.startFrame, rep.endFrame + 1) };
        })
      };
      if (signal.aborted) throw abortError();
      row.status = 'saving';
      setProgress(row, 1);
      await cachePost({ action: 'put_video', id: row.id, meta: meta, hands: hands });
      adoptMeta(row, meta);
      did.hands = true;
      state.run.counts.hands++;
      t.hands.ms += timing.handsMs; t.hands.frames += timing.handsFrames; t.hands.videos++;
      updateRow(row);
    }
    if (needsCandidate(row, meta)) {
      var candidate;
      try {
        candidate = await candidateStep(row, meta, signal, timing);
      } catch (e) {
        if (e && !e.cacheWrite && e.name !== 'AbortError') e.step = 'holistic';
        throw e;
      }
      var next = JSON.parse(JSON.stringify(meta));
      next.candidate = candidate;
      row.status = 'saving';
      setProgress(row, 1);
      try {
        await cachePost({ action: 'put_video', id: row.id, meta: next });
      } catch (e) {
        // the server refused this meta (4xx): the Hands result is cached, only the clip is lost
        if (e && !e.cacheWrite && e.name !== 'AbortError') e.step = 'holistic';
        throw e;
      }
      adoptMeta(row, next);
      if (timing.holisticFrames) {
        did.holistic = true;
        state.run.counts.holistic++;
        t.holistic.ms += timing.holisticMs; t.holistic.frames += timing.holisticFrames; t.holistic.videos++;
      }
    }
    timing.totalMs = now() - t0;
    return timing;
  }

  // ── The queue ──
  function fmtTime(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function elapsedNow() {
    return state.run.elapsedMs + (state.run.status === 'running' ? now() - runSince : 0);
  }
  // ETA from the measured rate so far: processing seconds per second of video (work.ms /
  // work.videoMs), times the video seconds still to do. The length of a video that has not been
  // opened yet is not known, so the mean length of the videos done so far stands in for it; that
  // is the mean processing time per video times the videos that still need work.
  function estimate() {
    var run = state.run, w = run.work;
    if (!w.videos || !w.videoMs) { run.etaMs = null; run.rate = null; return; }
    run.rate = w.ms / w.videoMs;
    if (run.status === 'done') { run.etaMs = 0; return; }
    var left = 0;
    for (var i = Math.max(0, run.index); i < state.videos.length; i++) if (planWork(state.videos[i]) !== 'skip') left++;
    var mean = w.ms / w.videos;
    var spent = run.status === 'running' && run.current ? Math.min(mean, now() - videoSince) : 0;
    run.etaMs = Math.max(0, left * mean - spent);
  }
  function renderProgress() {
    var run = state.run, n = state.videos.length;
    var at = run.index < 0 ? 0 : run.status === 'done' ? n : run.index + (run.current ? 1 : 0);
    var part = run.current ? (run.current.status === 'hands' ? run.current.progress * 0.5
      : run.current.status === 'holistic' ? 0.5 + run.current.progress * 0.5 : run.current.status === 'saving' ? 1 : 0) : 0;
    var frac = !n ? 0 : run.status === 'done' ? 1 : run.index < 0 ? 0 : Math.min(1, (run.index + part) / n);
    $('bi-progress').value = frac;
    $('bi-run-count').textContent = 'Video ' + Math.min(at, n) + ' of ' + n;
    $('bi-run-pct').textContent = n ? Math.round(frac * 100) + '%' : '';
    $('bi-run-file').textContent = run.current ? run.current.name : run.status === 'done' ? 'Finished.' : run.status === 'paused' ? 'Paused.' : '—';
    estimate();
    $('bi-elapsed').textContent = fmtTime(elapsedNow());
    $('bi-eta').textContent = run.etaMs === null ? '—' : fmtTime(run.etaMs);
    $('bi-rate').textContent = run.rate === null ? '—' : run.rate.toFixed(1) + ' s per video s';
  }
  // Never while an import or an Apply (step 5) is running (their requests are in flight); a
  // paused one has none.
  function canStart() {
    return state.simd && state.engines === 'ready' && state.videos.length > 0 && !state.folder.loading && state.imp.status !== 'running' && !applyActive();
  }
  function updateRunButtons() {
    var s = state.run.status;
    $('bi-start').disabled = !(canStart() && (s === 'idle' || s === 'done'));
    $('bi-pause').disabled = s !== 'running';
    $('bi-resume').disabled = !(canStart() && s === 'paused');
    var busy = s === 'running' || state.imp.status === 'running';
    $('bi-folder').disabled = busy;
    $('bi-choose').setAttribute('aria-disabled', busy ? 'true' : 'false');
  }

  // Walks the whole list in file-name order. A video that needs nothing is skipped at once, so
  // Start after a reload, Resume after a Pause and Start after a signer was added all use this.
  async function runQueue() {
    var run = state.run;
    if (run.status !== 'running' && run.status !== 'resuming') return;   // paused before it began
    var fresh = runFresh;
    runFresh = false;
    var pauseNote = null;
    run.status = 'running';
    updateRunButtons();
    if (fresh) {
      run.runs++;
      run.elapsedMs = 0;
      run.index = -1;
      run.counts = { hands: 0, holistic: 0, skipped: 0, failed: 0, done: 0 };
      // Never extract against a cache that cannot be read: every video would be redone, or lost.
      status('Reading the cache…');
      try {
        await refreshCache();
      } catch (e) {
        run.status = 'idle';
        status('The cache could not be read: ' + (e && e.message ? e.message : e) + '. Check that Apache is running, then press Start.', true);
        updateRunButtons();
        renderProgress();
        emit('run', { status: run.status });
        return;
      }
    }
    runSince = now();
    if (run.status === 'running') {
      status('Extracting… Keep this tab open and in front; closing it loses only the video in progress.');
      ticker = setInterval(renderProgress, 500);
      emit('run', { status: 'running' });
    }
    // Resume carries on at the video that was stopped; Start looks at every video again.
    var from = fresh ? 0 : Math.max(0, run.index);
    for (var i = from; i < state.videos.length && run.status === 'running'; i++) {
      var row = state.videos[i];
      var plan = planWork(row);
      run.index = i;
      if (plan === 'skip') {
        run.counts.skipped++;
        if (row.status !== 'done') { row.status = 'skipped'; updateRow(row); }
        continue;
      }
      var ctrl = new AbortController();
      runAbort = ctrl;
      run.current = row;
      row.error = null;
      row.failedStep = null;
      videoSince = now();
      updateRow(row);
      emit('row', { id: row.id, status: 'started' });
      var tr = rowEls[row.id];
      if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest' });
      try {
        var timing = await processVideo(row, plan, ctrl.signal);
        row.status = 'done';
        run.counts.done++;
        // the rate: a candidate-only video counts with the length of the window that was read
        run.work.ms += timing.totalMs;
        run.work.videoMs += plan === 'full' ? row.meta.hands.durationMs : row.meta.bestRep ? row.meta.bestRep.windowEndMs - row.meta.bestRep.windowStartMs : 0;
        run.work.videos++;
      } catch (e) {
        var why = e && e.message ? e.message : String(e);
        if (ctrl.signal.aborted || (e && e.name === 'AbortError')) {
          // Paused: the step in progress is dropped (a Hands result already cached is kept).
          row.status = row.cached ? 'cached' : 'pending';
          row.progress = 0;
        } else if (e && e.cacheWrite) {
          // The cache is not answering: stop here instead of losing video after video.
          row.status = row.cached ? 'cached' : 'pending';
          row.progress = 0;
          run.status = 'paused';
          pauseNote = 'The cache could not be written: ' + why + '. Check that Apache is running, then Resume.';
        } else {
          console.warn('[bulk-import] ' + row.name + ' failed:', e);
          row.status = 'failed';
          row.error = why;
          row.failedStep = e && e.step === 'holistic' ? 'holistic' : 'hands';
          run.counts.failed++;
          if (DETECTOR_TIMEOUT_RE.test(why)) {
            // A late answer of the hand tracker could become the next video's first frame.
            run.status = 'paused';
            run.index = i + 1;
            pauseNote = 'The hand tracker stopped answering on ' + row.name + '. Resume carries on with the next video; reload the page if this happens again.';
          }
        }
      }
      if (runAbort === ctrl) runAbort = null;
      run.current = null;
      updateRow(row);
      renderCounts();
      emit('row', { id: row.id, status: row.status });
    }
    clearInterval(ticker);
    run.elapsedMs += now() - runSince;
    if (run.status === 'running') {
      run.status = 'done';
      run.index = state.videos.length;
      var c = run.counts;
      // A Resume carries on at the video that was stopped. A signer ticked in the avatar list
      // during the pause leaves EARLIER videos without their avatar step: Start looks at them.
      var earlier = !fresh && state.videos.slice(0, from).some(function (v) { return v.status !== 'failed' && planWork(v) !== 'skip'; });
      status('Finished: ' + c.done + ' extracted, ' + c.skipped + ' skipped (already extracted)' +
        (c.failed ? ', ' + c.failed + ' failed — press Start to try those again' : '') + '.' +
        (earlier ? ' Avatar signers changed: press Start to run the avatar step for the earlier videos.' : ''), c.failed > 0 || earlier);
    } else {
      status(pauseNote || 'Paused. The step in progress was dropped; Resume carries on with that video.', !!pauseNote);
    }
    updateRunButtons();
    renderProgress();
    emit('run', { status: run.status });
  }

  // One pass at a time: the next one starts when the previous one has let go of its video.
  function launch() {
    runPromise = Promise.resolve(runPromise).then(runQueue).catch(function (e) {
      console.warn('[bulk-import] the queue stopped:', e);
      clearInterval(ticker);
      runAbort = null;
      state.run.status = 'idle';
      state.run.current = null;
      status('The extraction stopped on an unexpected error: ' + (e && e.message ? e.message : e) + '. Press Start to carry on.', true);
      updateRunButtons();
      renderProgress();
      emit('run', { status: 'idle' });
    });
    return runPromise;
  }
  function startRun() {
    if (!canStart() || (state.run.status !== 'idle' && state.run.status !== 'done')) return runPromise;
    state.run.status = 'running';        // at once: a second click must not queue a second pass
    runFresh = true;
    updateRunButtons();
    return launch();
  }
  function pauseRun() {
    if (state.run.status !== 'running') return;
    state.run.status = 'paused';
    if (runAbort) runAbort.abort();
    updateRunButtons();
  }
  function resumeRun() {
    if (!canStart() || state.run.status !== 'paused') return runPromise;
    state.run.status = 'resuming';       // until the paused pass has let go of its video
    updateRunButtons();
    return launch();
  }

  // ── Review (step 3) ──
  // Reads what exists (the signs, the saved samples), works out one status per video and shows
  // what an import would add. Nothing is written here: saved_gestures, the signs and the database
  // are only touched by the Import button (step 4, below).
  var SIGNS_API = 'php/api/signs.php';
  var SAVE_API = 'php/api/save_gesture.php';
  var TEXT_MAX = 255;                       // SIGN_TEXT_MAX (php/api/sign_meta.php:7)
  var NOT_USED = 'not used for recognition (result kept in the cache)';
  var MODELS = ['ESL', 'FSL'];
  var PROBLEM_KINDS = ['collision', 'set-differs', 'not-extracted', 'failed', 'no-reps', 'problem', 'bad-name'];
  var reviewToken = 0;
  var importPromise = null;

  // obj[key] for a map keyed by sign key: only its own keys ("constructor" is a valid sign key).
  function own(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  }
  function baseName(p) { return String(p).split('/').pop(); }
  function sampleFile(importId) { return 'sample_i' + importId + '.json'; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function why(e) { return e && e.message ? e.message : String(e); }

  function extracting() { return state.run.status === 'running' || state.run.status === 'resuming'; }
  // The models a sign's rows are loaded into on the kiosk: by its set, except that the control
  // signs "start" and "stop" go into both whatever their set (js/sign-to-text-ui.js:118).
  function modelsOf(key, set) {
    return key === 'start' || key === 'stop' || set === 'BOTH' ? MODELS : set === 'FSL' ? ['FSL'] : ['ESL'];
  }

  // ── The knnPredict estimate ──
  // How long one camera frame takes to classify against a model of a given size, in this
  // browser. knnShape() is this page's OWN function with the whole shape of the kiosk's
  // knnPredict() (js/sign-to-text-ui.js:204-243): the mirrored copy of the features (with the
  // two-hand swap), per label a map over its rows with the larger of two cosine similarities, a
  // descending sort and the mean of the top 5, then the final sort and normalisation. The kiosk's
  // function and model are never loaded here. It runs on a made-up model of the same shape as the
  // real one: that many labels, that many rows, 126 numbers per row with a zero second hand,
  // built with JSON.parse like the model the kiosk reads from localStorage.
  var KNN_MAX_ROWS = 100000;    // a larger model is timed at this size (and the box says so)
  var KNN_RUNS = 9;             // the estimate is the median of this many warm runs
  var KNN_RUN_MS = 20;          // a run repeats the call until it lasts about this long
  var KNN_DEBOUNCE_MS = 400;
  var knnMemo = {};             // "labels|rows" -> ms
  var knnToken = 0;
  var knnTimer = null;

  function knnCosine(a, b) {
    var dot = 0, magA = 0, magB = 0;
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
    var denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }
  function knnShape(model, features) {
    var labels = Object.keys(model);
    if (!labels.length) return null;
    var mirrored = features.slice(), i;
    for (i = 0; i < mirrored.length; i += 3) mirrored[i] = -mirrored[i];
    if (mirrored.length === 126) {
      var hand1 = mirrored.slice(0, 63), hand2 = mirrored.slice(63, 126);
      var notZero = function (v) { return v !== 0; };
      if (hand1.some(notZero) && hand2.some(notZero)) {
        Array.prototype.splice.apply(mirrored, [0, 63].concat(hand2));
        Array.prototype.splice.apply(mirrored, [63, 63].concat(hand1));
      }
    }
    var raw = {};
    labels.forEach(function (label) {
      var rows = model[label];
      if (!rows || !rows.length) { raw[label] = 0; return; }
      var sims = rows.map(function (row) { return Math.max(knnCosine(features, row), knnCosine(mirrored, row)); });
      sims.sort(function (a, b) { return b - a; });
      var top = sims.slice(0, Math.min(5, sims.length));
      raw[label] = top.reduce(function (sum, v) { return sum + v; }, 0) / top.length;
    });
    var entries = labels.map(function (label) { return [label, raw[label]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var scores = {};
    entries.forEach(function (e) { scores[e[0]] = Math.max(0, Math.min(1, (e[1] - 0.3) / 0.7)); });
    return { label: entries[0][0], confidence: scores[entries[0][0]], scores: scores };
  }
  // A builder of the made-up model, label by label (so a large one can be built in slices):
  // -> { model, features, labels, rows, done, step(n) }. The rows are spread evenly over the labels.
  function knnBuilder(labels, rows) {
    rows = Math.max(0, Math.min(Math.round(rows), KNN_MAX_ROWS));
    labels = Math.max(1, Math.min(Math.round(labels) || 1, rows || 1));
    var seed = 20261013, at = 0, per = Math.floor(rows / labels), extra = rows % labels;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; }
    function rowText() {
      var parts = [], j;
      for (j = 0; j < 63; j++) parts.push(rnd().toFixed(6));
      for (j = 63; j < 126; j++) parts.push('0');
      return '[' + parts.join(',') + ']';
    }
    var b = { model: {}, features: JSON.parse(rowText()), labels: labels, rows: rows, done: false };
    b.step = function (count) {
      for (var n = 0; n < count && at < labels; n++, at++) {
        var texts = [], mine = per + (at < extra ? 1 : 0);
        for (var i = 0; i < mine; i++) texts.push(rowText());
        b.model['sign_' + at] = JSON.parse('[' + texts.join(',') + ']');
      }
      b.done = at >= labels;
      return b;
    };
    return b;
  }
  // The whole made-up model at once (tests time the kiosk's real function on it).
  function knnSynthetic(labels, rows) {
    var b = knnBuilder(labels, rows);
    while (!b.done) b.step(50);
    return { model: b.model, features: b.features, labels: b.labels, rows: b.rows };
  }
  function nextTask() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
  function median(list) {
    var v = list.slice().sort(function (a, b) { return a - b; }), m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  // -> Promise of { ms, labels, rows, capped }: the median of KNN_RUNS warm runs. Works in short
  // slices (the page stays usable); a size that was measured before is answered at once.
  async function knnTime(labels, rows) {
    var b = knnBuilder(labels, rows), key = b.labels + '|' + b.rows;
    var out = { ms: 0, labels: b.labels, rows: b.rows, capped: rows > KNN_MAX_ROWS };
    if (!b.rows) return out;
    if (knnMemo[key] === undefined) {
      while (!b.done) { b.step(10); await nextTask(); }
      var t0, i, k, times = [];
      for (i = 0; i < 3; i++) { knnShape(b.model, b.features); await nextTask(); }   // warm-up
      t0 = now(); knnShape(b.model, b.features);
      var reps = Math.max(1, Math.min(200, Math.ceil(KNN_RUN_MS / Math.max(now() - t0, 0.1))));
      for (i = 0; i < KNN_RUNS; i++) {
        await nextTask();
        t0 = now();
        for (k = 0; k < reps; k++) knnShape(b.model, b.features);
        times.push((now() - t0) / reps);
      }
      knnMemo[key] = median(times);
    }
    out.ms = knnMemo[key];
    return out;
  }
  // Fills state.review.projection.knn for the model sizes in it: at once when every size was
  // measured before, otherwise a little later (debounced: ticking boxes must stay responsive).
  // Only while the Review step is open and neither the extraction nor an import is running: a
  // figure measured while something else is working is wrong, and must never be memoised.
  function knnQuiet() {
    return state.step === 'review' && !extracting() && state.imp.status !== 'running';
  }
  function scheduleKnn() {
    var proj = state.review.projection, token = ++knnToken, jobs = [];
    clearTimeout(knnTimer);
    if (!proj) return;
    var K = proj.knn, todo = false;
    ['current', 'projected'].forEach(function (when) {
      MODELS.forEach(function (m) {
        var rows = Math.min(proj[when][m], KNN_MAX_ROWS), labels = Math.max(1, Math.min(K.labels[when][m] || 1, rows || 1));
        var known = rows ? knnMemo[labels + '|' + rows] : 0;
        if (proj[when][m] > KNN_MAX_ROWS) K.capped = true;
        K[when][m] = known === undefined ? null : known;
        if (known === undefined) todo = true;
        jobs.push({ when: when, model: m });
      });
    });
    K.status = todo ? 'measuring' : 'ready';
    if (!todo || state.review.status !== 'ready' || !knnQuiet()) return;   // stays 'measuring'
    knnTimer = setTimeout(async function () {
      try {
        for (var i = 0; i < jobs.length; i++) {
          var j = jobs[i];
          if (!knnQuiet()) return;                // measured again when Review is next worked out
          var had = Object.keys(knnMemo);
          var r = await knnTime(K.labels[j.when][j.model], proj[j.when][j.model]);
          if (!knnQuiet()) {                      // something started meanwhile: the figure is dropped
            var memo = r.labels + '|' + r.rows;
            if (had.indexOf(memo) < 0) delete knnMemo[memo];
            return;
          }
          if (token !== knnToken) return;         // the projection changed meanwhile
          K[j.when][j.model] = r.ms;
        }
        K.status = 'ready';
        renderProjection();
        emit('review');
      } catch (e) { console.warn('[bulk-import] the knnPredict estimate failed:', e); }
    }, KNN_DEBOUNCE_MS);
  }

  // The importId of every cached repetition (SHA-256, so asynchronous): hashed once per video.
  function ensureImportIds() {
    var jobs = [];
    state.videos.forEach(function (v) {
      if (!v.meta || !Array.isArray(v.meta.reps)) return;
      if (!v.importIds) v.importIds = {};
      v.meta.reps.forEach(function (rep) {
        if (v.importIds[rep.index]) return;
        jobs.push(sha32(Core.importIdSource(v, rep.index)).then(function (id) { v.importIds[rep.index] = id; }));
      });
    });
    return Promise.all(jobs);
  }

  // GET php/api/signs.php (the signs) and the dataset listing (GET save_gesture.php?no_sync=1,
  // through GestureDataRecorder: the samples with their file names, turned into training rows by
  // the same recordingsToTrainingRows() the trainer uses, which is what
  // loadGestureDatasetForTraining(true) does with it). Two GETs; nothing is written.
  function loadReviewData() {
    var R = state.review, token = ++reviewToken, rec = window.GestureDataRecorder;
    R.status = 'loading';
    R.error = null;
    updateImportControls();
    return Promise.all([request(SIGNS_API, { cache: 'no-cache' }), rec.loadSavedGestureDataset(true)]).then(function (res) {
      if (token !== reviewToken) return false;
      var listed = res[0].signs || {}, gestures = res[1] || {}, disk = rec.getSigns() || {};
      var signs = {}, files = {}, current = { ESL: 0, FSL: 0 }, labels = { ESL: {}, FSL: {} };
      Object.keys(listed).forEach(function (k) {
        var s = listed[k];
        signs[k] = { set: s.set, textEn: s.textEn, textFil: s.textFil, samples: s.samples, avatar: !!s.avatar };
      });
      Object.keys(gestures).forEach(function (k) {
        var list = gestures[k] || [], d = own(disk, k), names = {};
        list.forEach(function (sample) { names[baseName(sample.file)] = true; });
        files[k] = names;
        if (!list.length || !d) return;
        // Disk is the source of truth (save_gesture.php checks it first): its set wins, and a
        // sign the database does not list yet still exists.
        if (own(signs, k)) signs[k].set = d.set;
        else signs[k] = { set: d.set, textEn: d.textEn, textFil: d.textFil, samples: list.length, avatar: false };
      });
      // the rows each model holds, as the kiosk's mergeSavedGestureSamples() loads them
      rec.recordingsToTrainingRows(gestures).forEach(function (row) {
        modelsOf(row.label, row.signLanguage).forEach(function (m) { current[m]++; labels[m][row.label] = true; });
      });
      R.signs = signs;
      R.files = files;
      R.current = current;
      R.labels = labels;
      R.status = 'ready';
      return true;
    }, function (e) {
      if (token !== reviewToken) return false;
      console.warn('[bulk-import] review data failed to load:', e);
      R.status = 'failed';
      R.error = why(e);
      return false;
    });
  }

  // reload: read the signs and the dataset again; false: only work the rows out again (the folder,
  // the cache or the signer lists changed, which needs no request).
  function refreshReview(reload) {
    return (reload ? loadReviewData() : Promise.resolve(true)).then(ensureImportIds).then(function () {
      computeReview();
      renderReview();
      emit('review');
      return state.review.status === 'ready';
    });
  }

  // One status per video, in this order: the key exists with another set; a new key whose set
  // differs from the first file (in file-name order) of that key; not extracted; signer not used
  // for recognition; no repetition; every repetition already saved; a repetition count other than
  // 3 (importable, not ticked by default); OK.
  function computeReview() {
    var R = state.review, rec = state.recognitionSigners, firstNew = {}, rows = [];
    state.videos.forEach(function (v) {
      var p = v.parsed, meta = v.meta, map = Core.mapRow(p, R.signs);
      var r = {
        id: v.id, name: v.name, relPath: v.relPath, video: v, label: p.label, key: p.key, set: p.set, signer: p.signer,
        reps: meta && meta.seg ? meta.seg.repsFound : null, kind: 'ok', text: 'OK', group: 'not ticked',
        enabled: false, checked: false, isNew: map.status === 'new', newSign: false, problem: false, addReps: [], doneReps: 0
      };
      function is(kind, text, group) { r.kind = kind; r.text = text; r.group = group || text; }
      var first = null;
      if (r.isNew) {
        first = own(firstNew, p.key);
        if (!first) first = firstNew[p.key] = v;
      }
      var rs = meta ? Core.rowStatus(meta) : null;
      var saved = own(R.files, p.key) || {};
      if (map.status === 'problem') is('collision', map.reason);
      else if (first && first !== v && first.parsed.set !== p.set) is('set-differs', 'set differs from ' + first.name, 'set differs from another file of the sign');
      else if (!meta && v.status === 'failed') is('failed', 'extraction failed: ' + v.error, 'extraction failed');
      else if (!meta) is('not-extracted', 'not extracted yet');
      else if (rec.indexOf(p.signer) < 0) is('not-used', NOT_USED, 'not used for recognition');
      else if (!rs.importable) is('no-reps', rs.reason);
      else {
        (meta.reps || []).forEach(function (rep) {
          var id = v.importIds && v.importIds[rep.index];
          if (id && saved[sampleFile(id)] === true) r.doneReps++;
          else r.addReps.push({ index: rep.index, rows: rep.rows });
        });
        if (!r.addReps.length) is('imported', 'already imported' + (rs.status === 'problem' ? ' (' + rs.reason + ')' : ''), 'already imported');
        else if (rs.status === 'problem') is('problem', rs.reason);
        else if (r.doneReps) is('ok', 'OK (' + r.doneReps + ' of ' + (r.doneReps + r.addReps.length) + ' repetitions already imported)', 'not ticked');
      }
      r.enabled = r.kind === 'ok' || r.kind === 'problem';
      r.problem = PROBLEM_KINDS.indexOf(r.kind) >= 0;
      var chosen = own(R.checks, v.id);
      r.checked = r.enabled && (chosen === undefined ? r.kind === 'ok' : !!chosen);
      r.newSign = r.isNew && r.enabled;
      rows.push(r);
    });
    state.problems.forEach(function (p) {
      rows.push({
        id: null, name: p.name, relPath: p.relPath, video: null, label: null, key: null, set: null, signer: null, reps: null,
        kind: 'bad-name', text: p.reason, group: /^same file as /.test(p.reason) ? 'same file twice in the folder' : p.reason,
        enabled: false, checked: false, isNew: false, newSign: false, problem: true, addReps: [], doneReps: 0
      });
    });
    rows.sort(byName);
    // The new signs an import can create: every new key with at least one importable video.
    var news = [];
    Object.keys(firstNew).sort().forEach(function (key) {
      if (!rows.some(function (r) { return r.key === key && r.newSign; })) return;
      var set = firstNew[key].parsed.set, draft = Core.draftText(key), typed = own(R.texts, key) || {};
      news.push({
        key: key, set: set, file: firstNew[key].name,
        draftEn: set === 'FSL' ? null : draft, draftFil: set === 'ESL' ? null : draft,
        textEn: set === 'FSL' ? null : typeof typed.textEn === 'string' ? typed.textEn : draft,
        textFil: set === 'ESL' ? null : typeof typed.textFil === 'string' ? typed.textFil : draft,
        active: false
      });
    });
    R.rows = rows;
    R.newSigns = news;
    computeTotals();
  }

  // The first new sign that would be created with an empty text its set needs, as a message.
  function missingText(keys) {
    var list = state.review.newSigns;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (keys ? keys.indexOf(s.key) < 0 : !s.active) continue;
      if (s.set !== 'FSL' && !String(s.textEn || '').trim()) return 'Type the English text of "' + s.key + '" under New signs before importing.';
      if (s.set !== 'ESL' && !String(s.textFil || '').trim()) return 'Type the Filipino text of "' + s.key + '" under New signs before importing.';
    }
    return null;
  }
  function blockedReason() {
    var R = state.review, imp = state.imp.status;
    if (imp === 'running' || imp === 'paused') return 'An import is in progress: see step 4.';
    if (R.status === 'failed') return 'The saved signs could not be read: ' + R.error + '. Open this step again to retry.';
    if (R.status !== 'ready') return 'Reading the saved signs…';
    if (extracting()) return 'Pause the extraction before importing.';
    if (!state.videos.length) return 'Choose a folder in step 1.';
    if (!R.toImport.videos) return 'No video is ticked.';
    return missingText(null);
  }

  // What the ticked videos add: videos, samples, rows and labels per model; the knnPredict
  // estimate for those model sizes follows (scheduleKnn).
  function computeTotals() {
    var R = state.review, planned = [], videos = 0, samples = 0, active = {};
    var nowLabels = { ESL: Object.keys(R.labels.ESL).length, FSL: Object.keys(R.labels.FSL).length };
    var newLabels = { ESL: {}, FSL: {} };
    R.rows.forEach(function (r) {
      if (!r.checked) return;
      videos++;
      active[r.key] = true;
      var models = modelsOf(r.key, r.set);
      r.addReps.forEach(function (rep) {
        samples++;
        planned.push({ set: models.length === 2 ? 'BOTH' : models[0], rows: rep.rows });
        if (rep.rows > 0) models.forEach(function (m) { if (own(R.labels[m], r.key) === undefined) newLabels[m][r.key] = true; });
      });
    });
    R.newSigns.forEach(function (s) { s.active = own(active, s.key) === true; });
    var cur = { ESL: R.current.ESL, FSL: R.current.FSL }, after = Core.projectRows(cur, planned);
    R.toImport = { videos: videos, samples: samples };
    R.projection = {
      current: cur, added: { ESL: after.ESL - cur.ESL, FSL: after.FSL - cur.FSL }, projected: after,
      knn: {
        status: 'measuring', capped: false, current: { ESL: null, FSL: null }, projected: { ESL: null, FSL: null },
        labels: {
          current: nowLabels,
          projected: { ESL: nowLabels.ESL + Object.keys(newLabels.ESL).length, FSL: nowLabels.FSL + Object.keys(newLabels.FSL).length }
        }
      }
    };
    R.blocked = blockedReason();
    scheduleKnn();
  }

  function setChecked(id, on) {
    var R = state.review;
    if (!id) return;
    R.checks[id] = !!on;
    R.rows.forEach(function (r) { if (r.id === id) r.checked = r.enabled && !!on; });
    computeTotals();
    renderDerived();
    var box = document.querySelector('#bi-review tr[data-id="' + id + '"] input');
    if (box) box.checked = R.rows.some(function (r) { return r.id === id && r.checked; });
    emit('review');
  }
  function setSignText(key, field, value) {
    var R = state.review;
    if (field !== 'textEn' && field !== 'textFil') return;
    var typed = own(R.texts, key);
    if (!typed) typed = R.texts[key] = {};
    typed[field] = String(value).slice(0, TEXT_MAX);
    R.newSigns.forEach(function (s) { if (s.key === key && s[field] !== null) s[field] = typed[field]; });
    R.blocked = blockedReason();
    updateImportControls();
  }
  function setFilter(filter) {
    if (['all', 'problems', 'new', 'import'].indexOf(filter) < 0) return;
    state.review.filter = filter;
    renderReviewTable();
    renderFilters();
  }
  function inFilter(r) {
    var f = state.review.filter;
    return f === 'problems' ? r.problem : f === 'new' ? r.newSign : f === 'import' ? r.checked : true;
  }

  function renderFilters() {
    var R = state.review;
    var n = { all: R.rows.length, problems: 0, 'new': 0, 'import': 0 };
    R.rows.forEach(function (r) { if (r.problem) n.problems++; if (r.newSign) n['new']++; if (r.checked) n['import']++; });
    document.querySelectorAll('.bi-filter').forEach(function (b) {
      var on = b.dataset.filter === R.filter;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.querySelector('span').textContent = String(n[b.dataset.filter]);
    });
    $('bi-review-count').textContent = R.rows.length ? '(' + R.rows.length + ')' : '';
  }
  function renderReviewTable() {
    var R = state.review, body = $('bi-review').querySelector('tbody'), frag = document.createDocumentFragment();
    var shown = R.rows.filter(inFilter);
    body.textContent = '';
    shown.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.className = r.kind === 'ok' || r.kind === 'imported' || r.kind === 'problem' ? 'k-' + r.kind : r.problem ? 'k-bad' : 'k-off';
      tr.dataset.kind = r.kind;
      if (r.id) tr.dataset.id = r.id;
      var tick = document.createElement('td'); tick.className = 'bi-tick';
      var box = document.createElement('input'); box.type = 'checkbox'; box.id = 'bi-rv-' + i;
      box.checked = r.checked;
      box.disabled = !r.enabled;
      box.setAttribute('aria-label', 'Import ' + r.name);
      box.addEventListener('change', function () { setChecked(r.id, box.checked); });
      tick.appendChild(box);
      tr.appendChild(tick);
      cell(tr, r.relPath, 'bi-file');
      cell(tr, r.key === null ? '—' : r.label === r.key ? r.key : r.label + ' → ' + r.key);
      cell(tr, r.set || '—');
      cell(tr, r.signer || '—');
      var reps = cell(tr, r.reps === null ? '—' : String(r.reps), 'bi-num');
      if (r.reps !== null && r.reps !== Core.REQUIRED_REPS) reps.classList.add('bi-warn');
      var st = cell(tr, r.text, 'bi-rst');
      if (r.newSign) {
        var tag = document.createElement('span'); tag.className = 'bi-tag'; tag.textContent = 'new sign';
        st.appendChild(tag);
      }
      if (r.kind === 'problem') {
        var label = document.createElement('label');
        label.htmlFor = box.id;
        label.textContent = 'import the ' + plural(r.addReps.length, 'repetition') + (r.doneReps ? ' not imported yet' : ' found');
        st.appendChild(label);
      }
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    $('bi-review').hidden = !R.rows.length;
    $('bi-review-empty').hidden = shown.length > 0;
    $('bi-review-empty').textContent = R.rows.length ? 'No video under this filter.' : 'Choose a folder in step 1.';
  }
  function renderNewSigns() {
    var R = state.review, list = $('bi-new-signs');
    list.textContent = '';
    R.newSigns.forEach(function (s) {
      var row = document.createElement('div'); row.className = 'bi-new-row' + (s.active ? '' : ' off'); row.dataset.key = s.key;
      var key = document.createElement('span'); key.className = 'bi-new-key'; key.textContent = s.key;
      var set = document.createElement('span'); set.className = 'bi-new-set'; set.textContent = s.set;
      row.appendChild(key); row.appendChild(set);
      [['textEn', 'English'], ['textFil', 'Filipino']].forEach(function (f) {
        if (s[f[0]] === null) return;
        var label = document.createElement('label'); label.className = 'bi-new-field';
        var name = document.createElement('span'); name.textContent = f[1];
        var input = document.createElement('input'); input.type = 'text'; input.maxLength = TEXT_MAX;
        input.value = s[f[0]];
        input.dataset.key = s.key; input.dataset.field = f[0];
        input.setAttribute('aria-label', f[1] + ' text of ' + s.key);
        input.classList.toggle('bad', !input.value.trim());
        input.addEventListener('input', function () {
          input.classList.toggle('bad', !input.value.trim());
          setSignText(s.key, f[0], input.value);
        });
        label.appendChild(name); label.appendChild(input);
        row.appendChild(label);
      });
      list.appendChild(row);
    });
    $('bi-new-card').hidden = !R.newSigns.length;
    $('bi-new-count').textContent = R.newSigns.length ? '(' + R.newSigns.length + ')' : '';
  }
  function fmtMs(v) { return (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' ms'; }
  function renderProjection() {
    var proj = state.review.projection, body = $('bi-projection').querySelector('tbody');
    body.textContent = '';
    if (!proj) return;
    MODELS.forEach(function (m) {
      var tr = document.createElement('tr'); tr.dataset.model = m;
      cell(tr, m);
      cell(tr, String(proj.current[m]));
      cell(tr, '+' + proj.added[m], proj.added[m] ? 'bi-add' : '');
      cell(tr, String(proj.projected[m]));
      cell(tr, proj.knn.current[m] === null ? '…' : fmtMs(proj.knn.current[m]));
      cell(tr, proj.knn.projected[m] === null ? '…' : fmtMs(proj.knn.projected[m]));
      body.appendChild(tr);
    });
    $('bi-proj-capped').hidden = !proj.knn.capped;
  }
  function updateImportControls() {
    var R = state.review, t = R.toImport;
    R.blocked = blockedReason();
    $('bi-import').textContent = 'Import ' + plural(t.videos, 'video') + ' (' + plural(t.samples, 'sample') + ')';
    $('bi-import').disabled = R.blocked !== null;
    $('bi-import-note').textContent = R.blocked || '';
    $('bi-import-note').classList.toggle('error', R.status === 'failed' || /^Type the /.test(R.blocked || ''));
  }
  // Everything but the table: a tick must not rebuild the row that was just clicked.
  function renderDerived() {
    renderNewSigns();
    renderProjection();
    renderFilters();
    updateImportControls();
  }
  function renderReview() {
    renderReviewTable();
    renderDerived();
  }

  // ── Import (step 4) ──
  // One POST per repetition to php/api/save_gesture.php, the payload of a live capture's
  // repetition (js/gesture-capture-ui.js:648-660) plus source "video-import", signer and importId,
  // and WITHOUT texts: the key must stay the file's label. The server answers "duplicate" for a
  // repetition it already has, so pressing Import twice, Resume, or a reload in the middle adds
  // nothing twice.
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.text().then(function (text) {
        var d = null;
        try { d = JSON.parse(text); } catch (e) { /* not JSON: a server error, handled by the caller */ }
        return { http: r.status, json: d };
      });
    });
  }
  function serverFailed(res) { return res.http >= 500 || !res.json; }

  // The synchronous part of invalidateCaches() in js/gesture-capture-ui.js:694-707, for one model
  // language: done as soon as a sample is added to it, so a reload mid-import leaves no stale cache.
  function dropLabelsCache(lang) {
    try { localStorage.removeItem('sining_kamay_labels_' + lang); } catch (e) { /* storage blocked */ }
  }
  // ... and the whole of it, for every language this import added a sample to.
  async function invalidateCaches(langs) {
    langs.forEach(dropLabelsCache);
    for (var i = 0; i < langs.length; i++) {
      try {
        if (window.tf && window.tf.io && typeof window.tf.io.removeModel === 'function') {
          await window.tf.io.removeModel('indexeddb://sining-kamay-model-' + langs[i]);
        }
      } catch (e) { /* the model may not exist yet - safe to ignore */ }
    }
  }

  // opts.ids (tests, and a forced re-import): import these videos instead of the ticked ones, also
  // when they are already imported (every repetition is then answered "duplicate"). The other
  // rules stay: extracted, signer used for recognition, no set collision, at least one repetition.
  function startImport(opts) {
    var R = state.review, imp = state.imp;
    var ids = opts && Array.isArray(opts.ids) ? opts.ids : null;
    if (imp.status === 'running' || imp.status === 'paused') return importPromise;
    if (R.status !== 'ready' || extracting() || (!ids && R.blocked !== null)) {
      toast(R.blocked || blockedReason() || 'The import cannot start yet.');
      return Promise.resolve(null);
    }
    var picked = R.rows.filter(function (r) {
      if (!r.video || !r.video.meta) return false;
      if (ids) return ids.indexOf(r.id) >= 0 && (r.kind === 'ok' || r.kind === 'problem' || r.kind === 'imported');
      return r.enabled && r.checked;
    });
    var keys = picked.map(function (r) { return r.key; });
    var missing = missingText(keys);
    if (!picked.length || missing) {
      toast(missing || 'No video to import.');
      return Promise.resolve(null);
    }
    var signs = {};
    picked.forEach(function (r) {
      if (own(signs, r.key)) return;
      var fresh = null;
      R.newSigns.forEach(function (s) { if (s.key === r.key) fresh = s; });
      signs[r.key] = {
        key: r.key, set: r.set, isNew: !!fresh, created: false, accepted: false, existed: false, added: 0, duplicates: 0, textUpdated: false, textError: null,
        texts: fresh ? {
          textEn: fresh.textEn === null ? null : fresh.textEn.trim(), textFil: fresh.textFil === null ? null : fresh.textFil.trim(),
          draftEn: fresh.draftEn, draftFil: fresh.draftFil
        } : null
      };
    });
    imp.status = 'running';
    imp.phase = 'samples';
    imp.queue = picked.map(function (r) {
      return { id: r.id, name: r.name, video: r.video, key: r.key, set: r.set, isNew: r.isNew, rep: 0, reps: r.video.meta.reps.length, added: 0, duplicates: 0, skip: null, hands: null };
    });
    imp.index = 0;
    imp.textAt = 0;
    imp.current = null;
    imp.added = 0; imp.duplicates = 0; imp.skipped = 0;
    imp.signs = signs;
    imp.notPicked = R.rows.filter(function (r) { return picked.indexOf(r) < 0; }).map(function (r) { return { name: r.name, reason: r.group }; });
    imp.langs = {};
    imp.message = null; imp.error = false; imp.pauseAsked = false;
    showStep('import');
    importPromise = runImport();
    return importPromise;
  }

  function importPaused(message) {
    var imp = state.imp;
    imp.status = 'paused';
    imp.pauseAsked = false;
    imp.error = !!message;
    imp.message = message || 'Paused. Resume carries on where it stopped; nothing is imported twice.';
    renderImport();
    updateImportControls();
    emit('import', { status: 'paused' });
    return null;
  }

  // Runs (or carries on) the import: the samples, then the edited texts of the new signs, then
  // the model caches and the summary. Every position is kept in state.imp, so Resume after a
  // pause simply calls this again. A server that does not answer, or answers 5xx, pauses it.
  // The edited texts of every new sign that exists by now and has not had them stored yet: one
  // POST php/api/signs.php per sign (the sign was created with its draft texts, the sample POSTs
  // carry none; the key does not change). -> null, or the message to pause the import with.
  async function storeTexts() {
    var imp = state.imp, keys = Object.keys(imp.signs).sort(), res;
    for (var i = 0; i < keys.length; i++) {
      var s = imp.signs[keys[i]], t = s.texts;
      if (!s.created || !t || s.textUpdated || s.textError || (t.textEn === t.draftEn && t.textFil === t.draftFil)) continue;
      try {
        res = await postJson(SIGNS_API, { action: 'update', key: s.key, set: s.set, textEn: t.textEn, textFil: t.textFil });
      } catch (e) {
        return 'The sample is saved, but the server did not answer for the text of "' + s.key + '" (' + why(e) + '). Resume tries again.';
      }
      if (serverFailed(res)) return 'The sample is saved, but the text of "' + s.key + '" could not be stored (' + ((res.json && res.json.error) || 'HTTP ' + res.http) + '). Resume tries again.';
      if (res.json.success) s.textUpdated = true;
      else s.textError = res.json.error || 'HTTP ' + res.http;
    }
    return null;
  }

  async function runImport() {
    var imp = state.imp, res, paused;
    imp.status = 'running';
    imp.message = null; imp.error = false; imp.pauseAsked = false;
    renderImport();
    updateImportControls();
    emit('import', { status: 'running' });
    try {
      paused = await storeTexts();           // a text that was waiting when the import paused
      if (paused) return importPaused(paused);
      while (imp.phase === 'samples') {
        if (imp.index >= imp.queue.length) { imp.phase = 'texts'; imp.current = null; break; }
        var item = imp.current = imp.queue[imp.index];
        if (imp.pauseAsked) return importPaused(null);
        renderImport();
        if (!item.hands && !item.skip) {
          try {
            item.hands = await apiGet('action=hands&id=' + item.id);
            item.reps = item.hands.reps.length;
          } catch (e) {
            if (!e || !e.http || e.http >= 500) return importPaused('The cache could not be read: ' + why(e) + '. Check that Apache is running, then Resume.');
            item.skip = 'extraction result no longer in the cache';
          }
        }
        var sign = imp.signs[item.key];
        while (!item.skip && item.rep < item.hands.reps.length) {
          if (imp.pauseAsked) return importPaused(null);
          var rep = item.hands.reps[item.rep], hm = item.hands.meta || {};
          var importId = await sha32(Core.importIdSource(item.video, rep.index));
          try {
            res = await postJson(SAVE_API, {
              label: item.key, sign_language: item.set, frames: rep.frames,
              formatVersion: 3, source: 'video-import', repIndex: rep.index,
              videoWidth: hm.videoWidth, videoHeight: hm.videoHeight, fps: hm.fps, input: hm.input,
              signer: item.video.parsed.signer, importId: importId
            });
          } catch (e) {
            return importPaused('The server did not answer (' + why(e) + '). Nothing is lost: check that Apache is running, then Resume.');
          }
          if (res.http === 409) { item.skip = 'exists as ' + ((res.json && res.json.existingSet) || 'another set'); break; }
          if (serverFailed(res)) return importPaused('The server answered with an error (' + ((res.json && res.json.error) || 'HTTP ' + res.http) + '). Nothing is lost: Resume tries this repetition again.');
          if (!res.json.success) { item.skip = 'refused by the server: ' + (res.json.error || 'HTTP ' + res.http); break; }
          if (res.json.duplicate === true) { item.duplicates++; sign.duplicates++; imp.duplicates++; }
          else { item.added++; sign.added++; imp.added++; }
          item.rep++;
          // Accepted (saved now, or already there: the answer to an earlier save may have been
          // lost): the model of its language is stale, and a sign that was new at Review time
          // exists from here on.
          modelsOf(item.key, item.set).forEach(function (lang) {
            if (!imp.langs[lang]) { imp.langs[lang] = true; dropLabelsCache(lang); }
          });
          // ... unless it was created elsewhere after the Review was read: the first accepted
          // answer is then a real save into a sign that already had samples. Its texts are
          // someone else's and are left alone (created stays false: no texts are posted).
          if (sign.isNew && !sign.accepted && res.json.duplicate !== true && res.json.labelSampleCount > 1) sign.existed = true;
          sign.accepted = true;
          if (sign.isNew && !sign.existed) sign.created = true;
          renderImport();
          // ... and its edited texts are stored at once, not at the end of the run: a reload
          // from here on loses nothing (a later label-only save keeps the stored texts).
          paused = await storeTexts();
          if (paused) return importPaused(paused);
        }
        if (item.skip) imp.skipped++;
        item.hands = null;                   // the frames are not needed any more
        imp.index++;
      }
      if (imp.phase === 'texts') {
        // Normally nothing is left to do here: only a text whose POST was still to be retried.
        paused = await storeTexts();
        if (paused) return importPaused(paused);
        imp.phase = 'finish';
      }
      if (imp.phase === 'finish') {
        await invalidateCaches(Object.keys(imp.langs).sort());
        var listed;
        try {
          listed = await request(SIGNS_API, { cache: 'no-cache' });
        } catch (e) {
          return importPaused('The samples are saved, but the sign list could not be read for the summary: ' + why(e) + '. Resume tries again.');
        }
        imp.summary = buildSummary(listed.signs || {});
        imp.phase = 'done';
        imp.status = 'done';
        imp.current = null;
        imp.message = 'Finished: ' + plural(imp.added, 'sample') + ' added, ' + plural(imp.duplicates, 'duplicate') + ' skipped.';
      }
    } catch (e) {
      console.warn('[bulk-import] the import stopped:', e);
      return importPaused('The import stopped on an unexpected error: ' + why(e) + '. Resume carries on.');
    }
    renderImport();
    renderSummary();
    await refreshReview(true).catch(function (e) { console.warn('[bulk-import] review refresh failed:', e); });
    emit('import', { status: imp.status });
    return imp.summary;
  }
  function pauseImport() {
    var imp = state.imp;
    if (imp.status !== 'running') return;
    imp.pauseAsked = true;                 // honoured before the next request
    renderImport();
  }
  function resumeImport() {
    if (state.imp.status !== 'paused') return importPromise;
    if (extracting()) { toast('Pause the extraction before resuming the import.'); return importPromise; }
    importPromise = runImport();
    return importPromise;
  }

  // signsNow: a fresh GET php/api/signs.php, read after the last sample was saved.
  function buildSummary(signsNow) {
    var imp = state.imp, counts = {}, reasons = {}, order = [];
    Object.keys(signsNow).forEach(function (k) { counts[k] = signsNow[k].samples; });
    var imb = Core.imbalance(counts);
    var skippedVideos = imp.notPicked.slice();
    imp.queue.forEach(function (item) { if (item.skip) skippedVideos.push({ name: item.name, reason: item.skip }); });
    skippedVideos.forEach(function (v) {
      if (own(reasons, v.reason) === undefined) { reasons[v.reason] = 0; order.push(v.reason); }
      reasons[v.reason]++;
    });
    var signs = Object.keys(imp.signs).sort().map(function (k) {
      var s = imp.signs[k], listed = own(signsNow, k);
      return {
        key: k, set: s.set, added: s.added, duplicates: s.duplicates, total: listed ? listed.samples : 0,
        created: s.created, textUpdated: s.textUpdated, textError: s.textError
      };
    });
    return {
      finishedAt: new Date().toISOString(),
      videos: imp.queue.length, videosSkipped: imp.skipped, added: imp.added, duplicates: imp.duplicates,
      signs: signs,
      newSigns: signs.filter(function (s) { return s.created; }).map(function (s) { return s.key; }),
      textsUpdated: signs.filter(function (s) { return s.textUpdated; }).map(function (s) { return s.key; }),
      skipped: order.sort().map(function (reason) { return { reason: reason, videos: reasons[reason] }; }),
      skippedVideos: skippedVideos,
      languages: Object.keys(imp.langs).sort(),
      median: imb.median, low: imb.low,
      allSigns: Object.keys(counts).sort().map(function (k) {
        return { key: k, set: signsNow[k].set, samples: counts[k], low: imb.low.indexOf(k) >= 0 };
      })
    };
  }

  function renderImport() {
    var imp = state.imp, n = imp.queue.length, item = imp.current;
    var part = item && item.reps ? item.rep / item.reps : 0;
    var frac = !n ? 0 : imp.status === 'done' ? 1 : Math.min(1, (imp.index + part) / n);
    $('bi-imp-progress').value = frac;
    $('bi-imp-count').textContent = 'Video ' + Math.min(n, imp.index + (n ? 1 : 0)) + ' of ' + n;
    $('bi-imp-pct').textContent = n ? Math.round(frac * 100) + '%' : '';
    $('bi-imp-file').textContent = item ? item.name : imp.status === 'done' ? 'Finished.' : imp.status === 'paused' ? 'Paused.' : '—';
    $('bi-imp-added').textContent = String(imp.added);
    $('bi-imp-dup').textContent = String(imp.duplicates);
    $('bi-imp-skip').textContent = String(imp.skipped);
    $('bi-imp-pause').disabled = imp.status !== 'running' || imp.pauseAsked;
    $('bi-imp-resume').disabled = imp.status !== 'paused' || extracting();
    updateRunButtons();                    // Start / Resume of the extraction wait for the import
    var note = $('bi-imp-note');
    note.textContent = imp.message || (imp.status === 'running' ? (imp.pauseAsked ? 'Pausing…' : 'Importing… Leaving this page is safe: importing again skips what is already saved.')
      : 'Tick the videos in step 3, then press Import there.');
    note.classList.toggle('error', imp.error);
  }

  function sumHead(box, text) {
    var h = document.createElement('h3'); h.className = 'bi-sum-h'; h.textContent = text;
    box.appendChild(h);
  }
  function sumLine(box, text, cls) {
    var p = document.createElement('p'); p.className = 'bi-sum-line' + (cls ? ' ' + cls : ''); p.textContent = text;
    box.appendChild(p);
    return p;
  }
  function sumTable(box, id, heads) {
    var table = document.createElement('table'); table.className = 'bi-table'; table.id = id;
    var tr = table.createTHead().insertRow();
    heads.forEach(function (text) { var th = document.createElement('th'); th.textContent = text; tr.appendChild(th); });
    box.appendChild(table);
    return table.createTBody();
  }
  function renderSummary() {
    var S = state.imp.summary, box = $('bi-summary');
    $('bi-remind').hidden = !S;
    if (!S) return;
    box.textContent = '';
    sumHead(box, 'This import');
    sumLine(box, plural(S.added, 'sample') + ' added, ' + plural(S.duplicates, 'duplicate') + ' skipped, from ' + plural(S.videos - S.videosSkipped, 'video') + '.').id = 'bi-sum-total';
    var body = sumTable(box, 'bi-sum-signs', ['Sign', 'Set', 'Added', 'Duplicates skipped', 'Samples now']);
    S.signs.forEach(function (s) {
      var tr = document.createElement('tr'); tr.dataset.key = s.key;
      var key = cell(tr, s.key);
      if (s.created) { var tag = document.createElement('span'); tag.className = 'bi-tag'; tag.textContent = 'new sign'; key.appendChild(tag); }
      cell(tr, s.set); cell(tr, String(s.added), 'bi-num'); cell(tr, String(s.duplicates), 'bi-num'); cell(tr, String(s.total), 'bi-num');
      body.appendChild(tr);
    });
    sumHead(box, 'New signs created (' + S.newSigns.length + ')');
    sumLine(box, S.newSigns.length ? S.newSigns.join(', ') : 'None.').id = 'bi-sum-new';
    S.signs.forEach(function (s) {
      if (s.textError) sumLine(box, 'The text of "' + s.key + '" could not be stored (' + s.textError + '): it keeps its draft text. Edit it on Train Gestures.', 'bi-warn');
    });
    sumHead(box, 'Videos not imported (' + S.skippedVideos.length + ')');
    if (!S.skipped.length) sumLine(box, 'None.');
    else {
      body = sumTable(box, 'bi-sum-skipped', ['Why', 'Videos']);
      S.skipped.forEach(function (g) {
        var tr = document.createElement('tr');
        cell(tr, g.reason); cell(tr, String(g.videos), 'bi-num');
        body.appendChild(tr);
      });
    }
    sumHead(box, 'Samples per sign (all ' + S.allSigns.length + ' signs)');
    sumLine(box, S.low.length
      ? '⚠ ' + plural(S.low.length, 'sign') + ' with fewer than half the median (' + S.median + ' per sign): ' + S.low.join(', ') + '.'
      : 'No sign has fewer than half the median (' + S.median + ' per sign).', S.low.length ? 'bi-warn' : '').id = 'bi-sum-imbalance';
    body = sumTable(box, 'bi-sum-all', ['Sign', 'Set', 'Samples', '']);
    S.allSigns.slice().sort(function (a, b) { return a.low === b.low ? 0 : a.low ? -1 : 1; }).forEach(function (s) {
      var tr = document.createElement('tr'); tr.dataset.key = s.key;
      if (s.low) tr.className = 'low';
      cell(tr, s.key); cell(tr, s.set); cell(tr, String(s.samples), 'bi-num');
      cell(tr, s.low ? '⚠ below half the median' : '', s.low ? 'bi-warn' : '');
      body.appendChild(tr);
    });
  }

  // ── Avatar (step 5) ──
  // A default signer and fallbacks, in the order of the avatar signers' list: every sign gets the
  // candidate clip of the first of them that has one, through php/api/avatar_clip.php (the request
  // avatar-clips.html sends), and php/api/bulk_import.php records which signer each sign got.
  // The assignment itself is BulkImportCore.assignDefaults(); the table shows it before anything
  // is written. Reads the signs, the candidates and the picks from the server: no folder needed.
  var AVATAR_API = 'php/api/avatar_clip.php';
  var avToken = 0;
  var applyPromise = null;

  function loadAvatarData() {
    var A = state.av, token = ++avToken;
    A.status = 'loading';
    A.error = null;
    renderAvatarControls();
    return Promise.all([request(SIGNS_API, { cache: 'no-cache' }), apiGet('action=candidates'), apiGet('action=picks')]).then(function (res) {
      if (token !== avToken) return false;
      var listed = res[0].signs || {}, signs = {}, seen = {};
      Object.keys(listed).forEach(function (k) {
        var s = listed[k];
        signs[k] = { set: s.set, textEn: s.textEn, textFil: s.textFil, samples: s.samples, avatar: !!s.avatar };
      });
      A.signs = signs;
      A.candidates = res[1].candidates || {};
      A.picks = res[2].picks || {};
      A.status = 'ready';
      Object.keys(A.candidates).forEach(function (k) {
        (A.candidates[k] || []).forEach(function (c) { seen[c.signer] = true; });
      });
      setCacheSigners(Object.keys(seen));
      computeAvatar();
      renderAvatar();
      emit('avatar', { status: 'ready' });
      return true;
    }, function (e) {
      if (token !== avToken) return false;
      console.warn('[bulk-import] avatar data failed to load:', e);
      A.status = 'failed';
      A.error = why(e);
      renderAvatar();
      emit('avatar', { status: 'failed' });
      return false;
    });
  }

  function avatarText(sign, key) {
    if (!sign) return '—';
    return (sign.set === 'FSL' ? sign.textFil || sign.textEn : sign.textEn || sign.textFil) || key;
  }
  // The plan (pure: BulkImportCore.assignDefaults) and one table row per key.
  function setDiffersText(d, sign) {
    return 'candidate ' + d.signer + ' is ' + d.set + ', the sign is ' + (sign ? sign.set : '?') + ' — not used';
  }
  function computeAvatar() {
    var A = state.av, order = state.avatarSigners.slice();
    var plan = Core.assignDefaults({ signs: A.signs, candidates: A.candidates, picks: A.picks, order: order, keepHand: A.keepHand });
    var kinds = {}, seen = {}, differs = {};
    plan.summary.noClip.forEach(function (k) { kinds[k] = ['no-clip', 'no clip']; });
    plan.summary.leftAlone.forEach(function (k) { kinds[k] = ['left-alone', 'left alone']; });
    plan.summary.notImported.forEach(function (k) { kinds[k] = ['not-imported', 'not imported yet']; });
    Object.keys(plan.assign).forEach(function (k) {
      var s = plan.assign[k];
      kinds[k] = s === order[0] ? ['set', 'set to ' + s] : ['fallback', 'fallback ' + s];
    });
    // a candidate of another set than the sign's is never used: the only reason a sign gets nothing
    plan.summary.setDiffers.forEach(function (d) {
      if (own(differs, d.key) === undefined) differs[d.key] = [];
      differs[d.key].push(setDiffersText(d, own(A.signs, d.key)));
    });
    Object.keys(differs).forEach(function (k) { if (own(kinds, k) === undefined) kinds[k] = ['set-differs', differs[k].join('; ')]; });
    Object.keys(A.signs).concat(Object.keys(A.candidates)).forEach(function (k) { seen[k] = true; });
    A.plan = plan;
    A.rows = Object.keys(seen).sort().filter(function (k) { return own(kinds, k) !== undefined; }).map(function (key) {
      var sign = own(A.signs, key), pick = own(A.picks, key), kind = kinds[key], list = own(A.candidates, key) || [];
      var current = !sign ? '—' : !sign.avatar ? 'none'
        : !pick ? 'by hand (made on Avatar clips)' : pick.by === 'hand' ? pick.signer + ' by hand' : pick.signer + ' (default)';
      var action = kind[1];
      if (kind[0] === 'left-alone') action += pickedByHand(key) && A.keepHand ? ' (picked by hand)' : ' (no clip from the listed signers; keeps its clip)';
      return {
        key: key, text: avatarText(sign, key), current: current,
        signers: list.map(function (c) { return c.signer; }),
        // as shown: a candidate of another set says so
        shown: list.map(function (c) { return !sign || Core.candidateUsable(c, sign) ? c.signer : c.signer + ' (' + c.set + ', not used)'; }),
        kind: kind[0], action: action
      };
    });
  }

  function setKeepHand(on) {
    state.av.keepHand = !!on;
    $('bi-av-keep').checked = state.av.keepHand;
    if (state.av.status === 'ready') { computeAvatar(); renderAvatar(); }
  }

  function applyBusy() { return state.av.run.status === 'running' || state.av.run.status === 'paused'; }
  // An Apply has a request in flight (or is about to): the extraction may not start meanwhile.
  function applyActive() { return state.av.run.status === 'running' || state.av.starting; }
  function applyBlocked() {
    var A = state.av;
    if (A.starting) return 'Reading the signs and the cache…';
    if (applyBusy()) return A.run.status === 'paused' ? 'Paused: press Resume.' : 'Applying…';
    if (A.status === 'failed') return 'The signs or the cache could not be read: ' + A.error + '. Press Refresh.';
    if (A.status !== 'ready') return 'Reading the signs and the cache…';
    if (extracting()) return 'Pause the extraction before applying.';
    if (!state.avatarSigners.length) return 'Tick at least one avatar signer.';
    if (!Object.keys(A.plan.assign).length) return 'No sign would change.';
    return null;
  }
  // What the table promises: which sign gets which signer, and which signs are left alone.
  function planSignature(plan) {
    return JSON.stringify([Object.keys(plan.assign).sort().map(function (k) { return [k, plan.assign[k]]; }), plan.summary.leftAlone]);
  }
  // Is this sign picked by hand, as BulkImportCore.assignDefaults() sees it?
  function pickedByHand(key) {
    var sign = own(state.av.signs, key), pick = own(state.av.picks, key), has = !!(sign && sign.avatar);
    return pick ? pick.by === 'hand' && has : has;
  }

  // Apply never works from what the step read when it was opened: the signs, the candidates and
  // the picks are read again first (a clip may have been picked by hand on avatar-clips.html in
  // another tab since). When that changes what the table showed, nothing is written: the table is
  // shown again and Apply must be pressed again.
  function startApply() {
    var A = state.av;
    if (applyBusy() || A.starting) return applyPromise;
    A.notice = null;
    var blocked = applyBlocked();
    if (blocked) { toast(blocked); renderAvatarControls(); return Promise.resolve(null); }
    var shown = planSignature(A.plan);
    A.starting = true;
    renderAvatarControls();
    applyPromise = loadAvatarData().then(function (ok) {
      A.starting = false;
      if (!ok) { renderAvatarControls(); return null; }
      if (planSignature(A.plan) !== shown) {
        A.notice = 'The signs or the cache changed. Check the table, then press Apply again.';
        renderAvatarControls();
        emit('avatar', { status: 'changed' });
        return null;
      }
      blocked = applyBlocked();
      if (blocked) { toast(blocked); renderAvatarControls(); return null; }
      var before = {};
      Object.keys(A.plan.assign).forEach(function (k) {
        var sign = own(A.signs, k);
        before[k] = { avatar: !!(sign && sign.avatar), pick: JSON.stringify(own(A.picks, k) || null) };
      });
      A.run = {
        status: 'running', plan: A.plan, order: state.avatarSigners.slice(), keepHand: A.keepHand,
        keys: Object.keys(A.plan.assign).sort(), index: 0, saved: [], failed: [], leftAlone: [],
        before: before, inFlight: null, stuck: null,
        picksDone: false, picksError: null, message: null, error: false
      };
      return runApply();
    }, function (e) {
      A.starting = false;
      renderAvatarControls();
      throw e;
    });
    return applyPromise;
  }
  function applyPaused(message) {
    var run = state.av.run;
    run.status = 'paused';
    run.error = true;
    run.message = message;
    renderAvatarControls();
    emit('avatar', { status: 'paused' });
    return null;
  }
  // A server error (5xx) at one sign pauses the Apply; the SAME sign answering 5xx again after a
  // Resume is counted as failed instead (a damaged cache file must not pause for ever).
  // -> true when the Apply must pause now.
  function stuckOnce(key) {
    var run = state.av.run;
    if (run.stuck === key) { run.stuck = null; return false; }
    run.stuck = key;
    return true;
  }
  // One sign: GET the candidate of its signer (or, when that one is no longer in the cache, of
  // the next signer in the list that has one) and POST it to avatar_clip.php.
  // -> {signer} saved | {reason} failed | {pause: message}. Throws only on an unexpected error.
  async function applyOne(key) {
    var run = state.av.run, first = run.plan.assign[key], got = null, signer = null, res, e5 = null;
    var sign = own(state.av.signs, key), listed = own(state.av.candidates, key) || [];
    // the signers to try, from the planned one on; never one whose candidate is of another set
    var tries = run.order.slice(Math.max(0, run.order.indexOf(first))).filter(function (s) {
      return listed.every(function (c) { return c.signer !== s || Core.candidateUsable(c, sign); });
    });
    for (var i = 0; i < tries.length && !got; i++) {
      try {
        got = await apiGet('action=candidate&key=' + encodeURIComponent(key) + '&signer=' + encodeURIComponent(tries[i]));
        signer = tries[i];
        // (the file itself is asked too: it may have been replaced since the list was read)
        if (!Core.candidateUsable(got.candidate, sign)) { got = null; signer = null; }
      } catch (e) {
        if (!e || !e.http) return { pause: 'The cache could not be read (' + why(e) + '). Check that Apache is running, then Resume.' };
        if (e.http >= 500) { e5 = e; break; }
        if (e.http !== 404) return { signer: tries[i], reason: 'candidate of ' + tries[i] + ': ' + why(e) };
      }
    }
    if (e5) {
      if (stuckOnce(key)) return { pause: 'The cache answered with an error (' + why(e5) + '). Resume tries "' + key + '" again.' };
      return { signer: first, reason: 'candidate unreadable: ' + why(e5) };
    }
    if (!got) return { signer: first, reason: 'its candidates are no longer in the cache' };
    var clip = got.candidate ? got.candidate.clip : null;
    if (!clip) return { signer: signer, reason: 'candidate of ' + signer + ' has no clip' };
    // candidates/<key>/<SIGNER>.json must hold that sign's clip by that signer: never rewritten here
    if (clip.key !== key || clip.signer !== signer) return { signer: signer, reason: 'candidate file does not match its name' };
    var v = window.AvatarClip.validateClip(clip);
    if (!v.ok) return { signer: signer, reason: 'candidate of ' + signer + ' is not a valid clip: ' + v.error };
    run.inFlight = key;                    // from here on the server may have saved it
    try {
      res = await postJson(AVATAR_API, { action: 'save', key: key, clip: clip });
    } catch (e) {
      return { pause: 'The server did not answer (' + why(e) + '). Nothing is lost: check that Apache is running, then Resume.' };
    }
    if (serverFailed(res)) {
      var said = (res.json && res.json.error) || 'HTTP ' + res.http;
      if (stuckOnce(key)) return { pause: 'The server answered with an error (' + said + '). Nothing is lost: Resume tries "' + key + '" again.' };
      return { signer: signer, reason: said };
    }
    if (!res.json.success) return { signer: signer, reason: res.json.error || 'HTTP ' + res.http };
    return { signer: signer };
  }
  // Runs (or carries on) an Apply: one sign after the other (applyOne), then ONE set_picks for
  // the signs that were saved. A sign the server refuses (4xx), or that fails in any unexpected
  // way, is listed as failed and the rest go on; no answer, or a 5xx, pauses (Resume carries on at
  // that sign: saving the same clip again changes nothing).
  // A tab closed in the middle leaves the signs saved so far with their new clip and NO pick
  // (set_picks comes last): they then count as picked by hand, so a later Apply with "Keep signs I
  // picked by hand" leaves them alone. Hence the beforeunload warning while this runs.
  async function runApply() {
    var A = state.av, run = A.run;
    run.status = 'running';
    run.message = null; run.error = false;
    renderAvatarControls();
    emit('avatar', { status: 'running' });
    try {
      while (run.index < run.keys.length) {
        var key = run.keys[run.index], out;
        try {
          out = await applyOne(key);
        } catch (e) {
          console.warn('[bulk-import] Apply failed for ' + key + ':', e);
          out = { signer: run.plan.assign[key], reason: 'unexpected error: ' + why(e) };
        }
        if (out.pause) return applyPaused(out.pause);
        if (out.reason) run.failed.push({ key: key, signer: out.signer, reason: out.reason });
        else run.saved.push({ key: key, signer: out.signer });
        run.inFlight = null;
        run.stuck = null;
        run.index++;
        renderAvatarControls();
      }
      if (!run.picksDone && run.saved.length) {
        var picks = {};
        run.saved.forEach(function (s) { picks[s.key] = { signer: s.signer, by: 'default' }; });
        try {
          await apiPost({ action: 'set_picks', picks: picks });
        } catch (e) {
          if (!e || !e.http || e.http >= 500) return applyPaused('The clips are saved, but which signer each sign got could not be recorded (' + why(e) + '). Resume tries again.');
          run.picksError = why(e);
        }
      }
      run.picksDone = true;
    } catch (e) {
      console.warn('[bulk-import] the Apply stopped:', e);
      return applyPaused('Apply stopped on an unexpected error: ' + why(e) + '. Resume carries on.');
    }
    A.summary = buildAvatarSummary(run);
    run.status = 'done';
    run.message = 'Finished: ' + plural(run.saved.length, 'sign') + ' set' + (run.failed.length ? ', ' + run.failed.length + ' failed' : '') + '.';
    run.error = run.failed.length > 0 || !!run.picksError;
    renderAvatarSummary();
    await loadAvatarData();                  // the table then shows what every sign has now
    emit('avatar', { status: 'done' });
    return A.summary;
  }
  // Resume reads the signs and the picks again too. With "Keep signs I picked by hand", a sign
  // still to do that was picked by hand while the Apply was paused is dropped from the work and
  // reported as left alone. (The sign whose save was in flight when the Apply paused may have been
  // saved by the server: its clip without a pick is this Apply's own, not a pick by hand.)
  function resumeApply() {
    var A = state.av, run = A.run;
    if (run.status !== 'paused' || A.starting) return applyPromise;
    if (extracting()) { toast('Pause the extraction before resuming.'); return applyPromise; }
    A.starting = true;
    renderAvatarControls();
    applyPromise = loadAvatarData().then(function (ok) {
      A.starting = false;
      if (!ok) return applyPaused('The signs or the cache could not be read (' + A.error + '). Check that Apache is running, then Resume.');
      if (run.keepHand) {
        var keep = run.keys.slice(0, run.index);
        run.keys.slice(run.index).forEach(function (key) {
          var was = run.before[key], sign = own(A.signs, key), pick = own(A.picks, key);
          var changed = JSON.stringify(pick || null) !== was.pick || (!!(sign && sign.avatar) !== was.avatar && key !== run.inFlight);
          if (pickedByHand(key) && changed) run.leftAlone.push(key);
          else keep.push(key);
        });
        run.keys = keep;
      }
      return runApply();
    }, function (e) {
      A.starting = false;
      return applyPaused('Resume failed: ' + why(e) + '. Press Resume again.');
    });
    return applyPromise;
  }

  // What the Apply did: only the signs whose clip was really saved count for a signer.
  function buildAvatarSummary(run) {
    var bySigner = {}, fallback = [];
    run.saved.forEach(function (s) {
      bySigner[s.signer] = (bySigner[s.signer] || 0) + 1;
      if (s.signer !== run.order[0]) fallback.push({ key: s.key, signer: s.signer });
    });
    var S = run.plan.summary;
    return {
      // candidates of another set than their sign's, never used: {key, signer, set, signSet}
      setDiffers: S.setDiffers.map(function (d) {
        var sign = own(state.av.signs, d.key);
        return { key: d.key, signer: d.signer, set: d.set, signSet: sign ? sign.set : null };
      }),
      finishedAt: new Date().toISOString(), order: run.order.slice(), keepHand: run.keepHand,
      saved: run.saved.slice(), bySigner: bySigner, fallback: fallback,
      noClip: S.noClip.slice(), leftAlone: S.leftAlone.concat(run.leftAlone).sort(), notImported: S.notImported.slice(),
      failed: run.failed.slice(), picksError: run.picksError
    };
  }

  function renderAvatarDefault() {
    var sel = $('bi-av-default');
    sel.textContent = '';
    if (!state.avatarSigners.length) {
      var none = document.createElement('option'); none.value = ''; none.textContent = state.avatarOrder.length ? 'Choose…' : 'No signer yet';
      sel.appendChild(none);
    }
    state.avatarOrder.forEach(function (s) {
      var o = document.createElement('option'); o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
    sel.value = state.avatarSigners[0] || '';
    sel.disabled = !state.avatarOrder.length || applyBusy();
    $('bi-av-order-empty').hidden = state.avatarOrder.length > 0;
  }
  function renderAvatarControls() {
    var A = state.av, run = A.run, blocked = applyBlocked();
    $('bi-av-apply').disabled = blocked !== null;
    $('bi-av-resume').disabled = run.status !== 'paused' || A.starting;
    $('bi-av-refresh').disabled = A.status === 'loading' || applyBusy() || A.starting;
    updateRunButtons();                    // Start / Resume of the extraction wait for an Apply
    $('bi-av-keep').disabled = applyBusy();
    $('bi-av-default').disabled = !state.avatarOrder.length || applyBusy();
    $('bi-av-progress').value = run.keys.length ? run.index / run.keys.length : run.status === 'done' ? 1 : 0;
    var note = $('bi-av-note');
    note.textContent = A.starting ? 'Reading the signs and the cache…'
      : run.status === 'running' ? 'Applying: sign ' + Math.min(run.index + 1, run.keys.length) + ' of ' + run.keys.length + '…'
        : run.status === 'paused' ? run.message
          : A.notice ? A.notice
            : blocked && blocked !== 'No sign would change.' ? blocked : run.message || blocked || '';
    note.classList.toggle('error', !A.starting && (run.status === 'paused' || A.status === 'failed' || !!A.notice || (run.status === 'done' && run.error && !blocked)));
  }
  function renderAvatar() {
    var A = state.av, body = $('bi-av-table').querySelector('tbody'), frag = document.createDocumentFragment();
    renderAvatarControls();
    body.textContent = '';
    var ready = A.status === 'ready' && A.plan;
    $('bi-av-table').hidden = !ready || !A.rows.length;
    $('bi-av-empty').hidden = !!(ready && A.rows.length);
    $('bi-av-empty').textContent = A.status === 'failed' ? 'The signs or the cache could not be read: ' + A.error
      : ready ? 'No signs yet.' : A.status === 'loading' ? 'Reading the signs and the cache…' : 'Open this step to read the signs and the cache.';
    $('bi-av-count').textContent = ready ? '(' + A.rows.length + ')' : '';
    var counts = $('bi-av-counts');
    counts.textContent = '';
    if (!ready) return;
    var S = A.plan.summary, order = state.avatarSigners;
    var per = Object.keys(S.bySigner).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); })
      .map(function (s) { return s + ' ' + S.bySigner[s]; });
    [['set', plural(Object.keys(A.plan.assign).length, 'sign') + ' set' + (per.length ? ' (' + per.join(', ') + ')' : '')],
      ['fallback', S.fallback.length + ' by a fallback'], ['no-clip', S.noClip.length + ' no clip'],
      ['left-alone', S.leftAlone.length + ' left alone'], ['not-imported', S.notImported.length + ' not imported yet'],
      ['set-differs', A.rows.filter(function (r) { return r.kind === 'set-differs'; }).length + ' of another set']].forEach(function (c) {
      var span = document.createElement('span'); span.className = 'bi-av-chip'; span.dataset.kind = c[0]; span.textContent = c[1];
      counts.appendChild(span);
    });
    A.rows.forEach(function (r) {
      var tr = document.createElement('tr'); tr.dataset.key = r.key; tr.dataset.kind = r.kind; tr.className = 'a-' + r.kind;
      cell(tr, r.key, 'bi-file');
      cell(tr, r.text);
      cell(tr, r.current);
      cell(tr, r.shown.length ? r.shown.join(', ') : '—');
      cell(tr, r.action, 'bi-av-act');
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }
  function sumKeys(box, id, title, list, text) {
    sumHead(box, title + ' (' + list.length + ')');
    sumLine(box, list.length ? list.map(text || String).join(', ') : 'None.').id = id;
  }
  function renderAvatarSummary() {
    var S = state.av.summary, box = $('bi-av-summary');
    $('bi-av-sum-card').hidden = !S;
    if (!S) return;
    box.textContent = '';
    sumHead(box, 'Signs per signer');
    var signers = Object.keys(S.bySigner).sort(function (a, b) { return S.order.indexOf(a) - S.order.indexOf(b); });
    sumLine(box, signers.length ? signers.map(function (s) { return s + ': ' + S.bySigner[s]; }).join(', ') + ' — ' + plural(S.saved.length, 'sign') + ' set.'
      : 'No sign was set.').id = 'bi-av-sum-signers';
    if (S.picksError) sumLine(box, 'Which signer each sign got could not be recorded (' + S.picksError + '): these signs count as picked by hand.', 'bi-warn');
    sumKeys(box, 'bi-av-sum-fallback', 'Got a fallback', S.fallback, function (f) { return f.key + ' → ' + f.signer; });
    sumKeys(box, 'bi-av-sum-noclip', 'No clip', S.noClip);
    sumKeys(box, 'bi-av-sum-left', S.keepHand ? 'Left alone (picked by hand, or no clip from the listed signers)' : 'Left alone (no clip from the listed signers)', S.leftAlone);
    sumKeys(box, 'bi-av-sum-notimported', 'Not imported yet (a clip is cached, the sign does not exist)', S.notImported);
    sumKeys(box, 'bi-av-sum-setdiffers', 'Candidate made from a video of another set, never used', S.setDiffers, function (d) {
      return d.key + ': candidate ' + d.signer + ' is ' + d.set + ', the sign is ' + (d.signSet || '?');
    });
    sumHead(box, 'Failed (' + S.failed.length + ')');
    if (!S.failed.length) sumLine(box, 'None.').id = 'bi-av-sum-failed';
    else {
      var body = sumTable(box, 'bi-av-sum-failed', ['Sign', 'Signer', 'Why']);
      S.failed.forEach(function (f) {
        var tr = document.createElement('tr'); tr.dataset.key = f.key;
        cell(tr, f.key); cell(tr, f.signer); cell(tr, f.reason, 'bi-warn');
        body.appendChild(tr);
      });
    }
  }

  // ── Engines ──
  // Holistic first: its SIMD WebAssembly must be compiled before setupMediaPipe() makes
  // WebAssembly.validate answer "no SIMD" (js/gesture-data.js:206-225). #videoFeed never gets a
  // source, so js/gesture-data.js's own init() never calls setupMediaPipe() by itself.
  // preloadMediaPipe() = setupMediaPipe + pauseHandLoop + Hands.initialize(): the Hands model is
  // loaded now, not inside the first video's timing and 10 s detect timeout.
  // After a failure the Retry button runs this again; Hands is still only ever set up after a
  // successful Holistic init.
  function loadEngines() {
    state.engines = 'loading';
    state.engineError = null;
    $('bi-retry').hidden = true;
    status('Loading the extractors…');
    updateRunButtons();
    var holistic;
    if (holisticReady) holistic = Promise.resolve();
    else {
      extractor = window.AvatarExtract.createExtractor();
      holistic = extractor.init().then(function () { holisticReady = true; });
    }
    return holistic.then(function () {
      return window.GestureDataRecorder.preloadMediaPipe($('videoFeed'));
    }).then(function (ok) {
      if (!ok) throw new Error('MediaPipe Hands could not be set up');
      state.engines = 'ready';
      status(state.folder.files ? 'The extractors are ready.' : 'Choose the folder that holds the videos.');
    }).catch(function (e) {
      console.warn('[bulk-import] extractors failed to load:', e);
      state.engines = 'failed';
      state.engineError = e && e.message ? e.message : String(e);
      status('The extractors could not be loaded: ' + state.engineError, true);
      $('bi-retry').hidden = false;
    }).then(function () {
      updateRunButtons();
      emit('engines', { engines: state.engines });
    });
  }

  // ── Start ──
  var started = false;
  function start() {
    if (started) return;
    started = true;
    // Asked once, now: after preloadMediaPipe() the same test answers false on every browser.
    state.simd = window.AvatarExtract.simdSupported();
    STEPS.forEach(function (s) { $('bi-tab-' + s).addEventListener('click', function () { showStep(s); }); });
    $('bi-to-extract').addEventListener('click', function () { showStep('extract'); });
    $('bi-folder').addEventListener('change', function (e) {
      var files = e.target.files;
      if (files && files.length) setFolder(files);   // copies the list at once
      e.target.value = '';                           // choosing the same folder again still fires change
    });
    $('bi-start').addEventListener('click', startRun);
    $('bi-pause').addEventListener('click', pauseRun);
    $('bi-resume').addEventListener('click', resumeRun);
    $('bi-retry').addEventListener('click', function () { if (state.engines === 'failed') loadEngines(); });
    $('bi-preview-on').addEventListener('change', function () { state.preview = $('bi-preview-on').checked; if (!state.preview) fit(null); });
    // Review + Import. Opening Review reads the signs and the saved samples again; a change of
    // the folder, the cache or the signer lists works the rows out again (and, while Review is
    // open, reads again too).
    function review(reload) {
      refreshReview(reload).catch(function (e) { console.warn('[bulk-import] review failed:', e); });
    }
    document.addEventListener('bulkimport:step', function (e) { if (e.detail && e.detail.step === 'review') review(true); });
    document.addEventListener('bulkimport:folder', function () { review(state.step === 'review'); });
    // ... while a folder is being read the folder event follows the cache event: one reload, not two
    document.addEventListener('bulkimport:cache', function () { if (!state.folder.loading) review(state.step === 'review'); });
    ['signers', 'row'].forEach(function (type) {
      document.addEventListener('bulkimport:' + type, function () { review(false); });
    });
    document.addEventListener('bulkimport:run', function () { updateImportControls(); renderImport(); renderAvatarControls(); });
    // The knnPredict estimate waits while the extraction or an import runs: asked for again now.
    ['run', 'import'].forEach(function (type) {
      document.addEventListener('bulkimport:' + type, function () {
        var proj = state.review.projection;
        if (proj && proj.knn.status === 'measuring' && knnQuiet()) { scheduleKnn(); renderProjection(); }
      });
    });
    // Avatar: opening the step reads the signs, the candidates and the picks again.
    document.addEventListener('bulkimport:step', function (e) { if (e.detail && e.detail.step === 'avatar') loadAvatarData(); });
    document.addEventListener('bulkimport:signers', function () { if (state.av.status === 'ready') { computeAvatar(); renderAvatar(); } });
    $('bi-av-default').addEventListener('change', function () {
      var s = $('bi-av-default').value;
      if (s) setAvatarSigners([s].concat(state.avatarSigners.filter(function (x) { return x !== s; })));
    });
    $('bi-av-keep').addEventListener('change', function () { setKeepHand($('bi-av-keep').checked); });
    $('bi-av-refresh').addEventListener('click', function () { state.av.notice = null; loadAvatarData(); });
    // Leaving in the middle of an Apply leaves saved clips without their pick (see runApply).
    window.addEventListener('beforeunload', function (e) {
      if (!applyBusy() && !state.av.starting) return;   // also while paused: the picks are not written yet
      e.preventDefault();
      e.returnValue = '';
    });
    $('bi-av-apply').addEventListener('click', function () { startApply(); });
    $('bi-av-resume').addEventListener('click', resumeApply);
    $('bi-av-to-extract').addEventListener('click', function () { showStep('extract'); });
    document.querySelectorAll('.bi-filter').forEach(function (b) {
      b.addEventListener('click', function () { setFilter(b.dataset.filter); });
    });
    $('bi-import').addEventListener('click', function () { startImport(); });
    $('bi-imp-pause').addEventListener('click', pauseImport);
    $('bi-imp-resume').addEventListener('click', resumeImport);
    fit(null);
    renderCounts();
    renderProblems();
    renderProgress();
    updateRunButtons();
    computeReview();
    renderReview();
    renderImport();
    renderSigners();
    renderAvatar();
    if (!state.simd) {
      status(NO_SIMD, true);
      return;
    }
    loadEngines();
  }

  // For the later steps (Review / Import / Avatar) and tests/bulk-import/*.mjs.
  // Events on document: bulkimport:folder, :cache, :signers, :row ({id, status}: 'started', then
  // the row's status when its turn is over), :run, :step, :engines, :review (the Review rows or
  // totals changed), :import ({status}: running, paused, then done once the Review is up to date).
  // Review: state.review (rows, newSigns, projection, toImport, blocked); Import: state.imp
  // (status, queue, summary = the last finished import, also lastSummary()).
  // Avatar: state.av (rows, plan, run, summary = the last finished Apply, also
  // lastAvatarSummary()); bulkimport:avatar ({status}: ready | failed | running | paused | done).
  window.BulkImport = {
    state: state,
    setFolder: setFolder,
    refreshCache: refreshCache,
    setRecognitionSigners: setRecognitionSigners,
    setAvatarSigners: setAvatarSigners,
    setPreview: function (on) { state.preview = !!on; $('bi-preview-on').checked = state.preview; if (!state.preview) fit(null); },
    planWork: planWork,
    start: startRun,
    pause: pauseRun,
    resume: resumeRun,
    showStep: showStep,
    refreshReview: refreshReview,
    setChecked: setChecked,
    setSignText: function (key, field, value) { setSignText(key, field, value); renderNewSigns(); },
    setFilter: setFilter,
    knnTime: knnTime,
    knnSynthetic: knnSynthetic,
    'import': startImport,
    pauseImport: pauseImport,
    resumeImport: resumeImport,
    lastSummary: function () { return state.imp.summary; },
    refreshAvatar: loadAvatarData,
    setKeepHand: setKeepHand,
    applyDefaults: startApply,
    resumeApply: resumeApply,
    lastAvatarSummary: function () { return state.av.summary; },
    mayMakeCandidate: mayMakeCandidate,
    sha32: sha32,
    apiGet: apiGet,
    apiPost: apiPost,
    status: status,
    toast: toast
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-pin]').forEach(function (b) {
      b.addEventListener('click', function () { onPinKey(b.dataset.pin); });
    });
    var unlocked = false;
    try {
      var at = Number(sessionStorage.getItem(UNLOCK_KEY));
      unlocked = at > 0 && Date.now() - at >= 0 && Date.now() - at < UNLOCK_MS;
    } catch (e) { /* storage blocked */ }
    if (unlocked) unlock();
  });
})();
