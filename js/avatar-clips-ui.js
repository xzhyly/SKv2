// js/avatar-clips-ui.js
// avatar-clips.html: pick a sign -> pick a video -> extract (progress + skeleton overlay) ->
// auto-trim with manual handles -> preview on the avatar -> Save / Redo / Delete (decision 4).
// The video is only ever read locally through an object URL; the only request that carries data is
// the clip JSON posted to php/api/avatar_clip.php. A sign's recognition samples are never touched.
(function () {
  'use strict';

  var PIN = '2026';                         // same PIN as Train Gestures (js/gesture-training-ui.js)
  var UNLOCK_KEY = 'sk_train_unlocked';     // unlock time (ms), set by Train Gestures; this tab session only
  var UNLOCK_MS = 10 * 60 * 1000;           // ... and honoured for 10 minutes
  var SIGNER_KEY = 'sk_avatar_signer';
  var TRACK_W = 472;
  var HAND = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
  var P = window.AvatarClip ? window.AvatarClip.P : null;

  function $(id) { return document.getElementById(id); }

  var state = {
    signs: {}, key: null, ext: null, extracting: false, abort: null, deleteTimer: null,
    player: null, extractor: null, seeking: false, pendingSeek: null
  };

  // ── PIN ──
  var pin = '';
  function pinDots() {
    document.querySelectorAll('.pin-dot').forEach(function (d, i) { d.classList.toggle('active', i < pin.length); });
  }
  function unlock() {
    $('pin-screen').classList.remove('active');
    $('ac-ui').classList.add('active');
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
    var s = $('ac-status');
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  // ── Signs ──
  function signText(s, key) {
    if (!s) return key;
    if (s.set === 'FSL') return s.textFil || key;
    return s.textEn || s.textFil || key;
  }
  function setLabel(s) { return s.set === 'BOTH' ? 'Both' : s.set; }

  function loadSigns() {
    return fetch('php/api/signs.php', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) throw new Error((d && d.error) || 'signs.php failed');
      state.signs = d.signs || {};
      var keys = Object.keys(state.signs);
      var withClip = keys.filter(function (k) { return state.signs[k].avatar; }).length;
      $('ac-count').textContent = keys.length + ' signs · ' + withClip + ' with a clip';
      renderList();
      renderSelected();
    }).catch(function (e) {
      status('Could not load the signs: ' + (e && e.message ? e.message : e), true);
    });
  }

  function renderList() {
    var list = $('ac-list');
    var q = $('ac-search').value.trim().toLowerCase();
    var keys = Object.keys(state.signs).filter(function (k) {
      if (!q) return true;
      var s = state.signs[k];
      return [k, s.textEn, s.textFil].some(function (t) { return t && String(t).toLowerCase().indexOf(q) !== -1; });
    }).sort(function (a, b) { return signText(state.signs[a], a).localeCompare(signText(state.signs[b], b)); });
    list.textContent = '';
    if (!keys.length) {
      var e = document.createElement('div');
      e.className = 'ac-empty';
      e.textContent = q ? 'No sign matches "' + q + '".' : 'No signs yet.';
      list.appendChild(e);
      return;
    }
    keys.forEach(function (k) {
      var s = state.signs[k];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ac-item' + (k === state.key ? ' active' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', k === state.key ? 'true' : 'false');
      b.dataset.key = k;
      b.disabled = state.extracting;
      var t = document.createElement('span'); t.className = 'ac-item-text'; t.textContent = signText(s, k);
      var set = document.createElement('span'); set.className = 'ac-item-set'; set.textContent = setLabel(s);
      var c = document.createElement('span'); c.className = 'ac-item-clip' + (s.avatar ? ' yes' : '');
      c.textContent = s.avatar ? '✓' : '—';
      c.title = s.avatar ? 'Has an avatar clip' : 'No avatar clip';
      b.appendChild(t); b.appendChild(set); b.appendChild(c);
      b.addEventListener('click', function () { selectSign(k); });
      list.appendChild(b);
    });
  }

  function renderSelected() {
    var sel = $('ac-selected');
    var s = state.key && state.signs[state.key];
    if (!s) { sel.textContent = state.key ? 'This sign no longer exists.' : 'Pick a sign.'; }
    else sel.textContent = '"' + signText(s, state.key) + '" (' + setLabel(s) + ') · ' + (s.avatar ? 'has a clip' : 'no clip yet');
    updateButtons();
  }

  function selectSign(key) {
    if (state.extracting) return;
    state.key = key;
    discardExtraction();
    disarmDelete();
    renderList();
    renderSelected();
    status(state.signs[key] && state.signs[key].avatar
      ? 'This sign has a clip. Preview plays it; choose a video to replace it.'
      : 'Choose a video of this sign.');
  }

  function updateButtons() {
    var s = state.key && state.signs[state.key];
    var canChoose = !!s && !state.extracting && window.AvatarExtract.simdSupported();
    $('ac-file').disabled = !canChoose;
    $('ac-choose').setAttribute('aria-disabled', canChoose ? 'false' : 'true');
    var tooLong = state.ext && state.ext.trim.end - state.ext.trim.start + 1 > window.AvatarClip.MAX_FRAMES;
    $('ac-save').disabled = !(s && state.ext && !state.extracting && !tooLong);
    $('ac-redo').disabled = !(state.ext || state.extracting);
    $('ac-delete').disabled = !(s && s.avatar && !state.extracting);
    $('ac-preview').disabled = !(s && !state.extracting && (state.ext || s.avatar) && state.player);
    document.querySelectorAll('.ac-item').forEach(function (b) { b.disabled = state.extracting; });
  }

  // ── Stage: video frame + skeleton ──
  function drawSkeleton(g, frame, box) {
    function pt(p) { return { x: box.x + p[0] * box.w, y: box.y + p[1] * box.h }; }
    function line(a, b, col, w) {
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    function dot(a, col, r) { g.fillStyle = col; g.beginPath(); g.arc(a.x, a.y, r, 0, Math.PI * 2); g.fill(); }
    var pose = frame && frame[0];
    if (pose) {
      [[P.shL, P.elL], [P.elL, P.wrL], [P.shR, P.elR], [P.elR, P.wrR], [P.shL, P.shR]].forEach(function (e) {
        line(pt(pose[e[0]]), pt(pose[e[1]]), '#22d3ee', 3);
      });
      [[P.shL, P.hipL], [P.shR, P.hipR], [P.hipL, P.hipR]].forEach(function (e) { line(pt(pose[e[0]]), pt(pose[e[1]]), '#facc15', 2); });
      [P.shL, P.shR, P.elL, P.elR, P.wrL, P.wrR].forEach(function (i) { dot(pt(pose[i]), '#22d3ee', 4); });
      [P.nose, P.earL, P.earR].forEach(function (i) { dot(pt(pose[i]), '#facc15', 3.5); });
    }
    [[frame && frame[2], '#f43f5e'], [frame && frame[1], '#a3e635']].forEach(function (h) {
      if (!h[0]) return;
      HAND.forEach(function (c) { for (var i = 1; i < c.length; i++) line(pt(h[0][c[i - 1]]), pt(h[0][c[i]]), h[1], 2); });
      h[0].forEach(function (p) { dot(pt(p), h[1], 2); });
    });
  }

  function drawVideoFrame(source, frame) {
    var cv = $('ac-video-canvas'), g = cv.getContext('2d');
    g.fillStyle = '#1a2540';
    g.fillRect(0, 0, cv.width, cv.height);
    if (!source) return;
    var sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
    if (!sw || !sh) return;
    var s = Math.min(cv.width / sw, cv.height / sh);
    var box = { w: sw * s, h: sh * s };
    box.x = (cv.width - box.w) / 2; box.y = (cv.height - box.h) / 2;
    g.drawImage(source, box.x, box.y, box.w, box.h);
    drawSkeleton(g, frame, box);
  }

  // Show extracted frame `i` (seek the kept local video; coalesce rapid handle drags).
  function showFrame(i) {
    if (!state.ext) return;
    if (state.seeking) { state.pendingSeek = i; return; }
    var v = $('ac-video');
    state.seeking = true;
    var done = function () {
      v.removeEventListener('seeked', done);
      if (state.seekDone !== done) return;          // discarded meanwhile
      state.seekDone = null;
      state.seeking = false;
      if (state.ext) drawVideoFrame(v, state.ext.frames[i]);
      if (state.pendingSeek !== null) { var n = state.pendingSeek; state.pendingSeek = null; showFrame(n); }
    };
    state.seekDone = done;
    v.addEventListener('seeked', done);
    v.currentTime = Math.min(i / state.ext.fps, Math.max(0, v.duration - 0.001));
  }

  function setView(which) {
    var avatar = which === 'avatar';
    $('ac-stage').classList.toggle('avatar', avatar);
    $('ac-view-video').classList.toggle('active', !avatar);
    $('ac-view-avatar').classList.toggle('active', avatar);
    $('ac-view-video').setAttribute('aria-pressed', avatar ? 'false' : 'true');
    $('ac-view-avatar').setAttribute('aria-pressed', avatar ? 'true' : 'false');
    if (avatar && state.player && !state.player.isPlaying()) state.player.showRest();
  }

  // ── Trim ──
  function fmt(ms) { return (ms / 1000).toFixed(2) + ' s'; }
  function idxToX(i) { var n = state.ext.frames.length; return n > 1 ? i / (n - 1) * TRACK_W : 0; }
  function xToIdx(x) { var n = state.ext.frames.length; return Math.round(Math.max(0, Math.min(TRACK_W, x)) / TRACK_W * (n - 1)); }

  function renderTrim() {
    var trim = $('ac-trim');
    var bars = $('ac-trim-bars'), g = bars.getContext('2d');
    g.clearRect(0, 0, bars.width, bars.height);
    if (!state.ext) {
      trim.classList.add('empty');
      $('ac-shade-l').style.width = '0'; $('ac-shade-r').style.width = '0';
      $('ac-trim-label').textContent = 'No video yet';
      return;
    }
    trim.classList.remove('empty');
    var f = state.ext.frames, n = f.length, w = TRACK_W / n;
    for (var i = 0; i < n; i++) {
      var x = i * w;
      if (f[i][1] || f[i][2]) { g.fillStyle = '#1a2540'; g.fillRect(x, 26, Math.max(1, w), 30); }
      else if (f[i][0]) { g.fillStyle = '#9aa7bd'; g.fillRect(x, 44, Math.max(1, w), 12); }
      if (window.AvatarClip.handUp(f[i])) { g.fillStyle = '#f97316'; g.fillRect(x, 0, Math.max(1, w), 8); }
    }
    var t = state.ext.trim;
    var xl = idxToX(t.start), xr = idxToX(t.end);
    $('ac-handle-l').style.left = xl + 'px';
    $('ac-handle-r').style.left = xr + 'px';
    $('ac-shade-l').style.width = xl + 'px';
    $('ac-shade-r').style.width = (TRACK_W - xr) + 'px';
    [['ac-handle-l', t.start], ['ac-handle-r', t.end]].forEach(function (h) {
      var el = $(h[0]);
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(n - 1));
      el.setAttribute('aria-valuenow', String(h[1]));
    });
    var fps = state.ext.fps;
    var count = t.end - t.start + 1;
    $('ac-trim-label').textContent = fmt(t.start * 1000 / fps) + ' – ' + fmt(t.end * 1000 / fps) +
      (t.auto ? ' (auto)' : '') + ' · ' + count + ' frames' +
      (count > window.AvatarClip.MAX_FRAMES ? ' — too long, trim to ' + window.AvatarClip.MAX_FRAMES / fps + ' s' : '');
    updateButtons();
  }

  // Overlapping handles (a 1-2 frame trim): the first drag direction decides which one moves.
  function bindHandle(id, which0) {
    var el = $(id);
    var which = which0, startX = 0, undecided = false;
    function move(clientX) {
      if (!state.ext || state.extracting) return;
      if (undecided) {
        if (Math.abs(clientX - startX) < 3) return;
        which = clientX < startX ? 'start' : 'end';
        undecided = false;
      }
      var rect = $('ac-trim').getBoundingClientRect();
      var i = xToIdx(clientX - rect.left);
      var t = state.ext.trim;
      if (which === 'start') t.start = Math.min(i, t.end - 1);
      else t.end = Math.max(i, t.start + 1);
      t.auto = false;
      renderTrim();
      setView('video');
      showFrame(which === 'start' ? t.start : t.end);
    }
    el.addEventListener('pointerdown', function (e) {
      if (!state.ext) return;
      el.setPointerCapture(e.pointerId);
      which = which0;
      startX = e.clientX;
      undecided = Math.abs(idxToX(state.ext.trim.end) - idxToX(state.ext.trim.start)) < 44;
      if (!undecided) move(e.clientX);
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) { if (el.hasPointerCapture(e.pointerId)) move(e.clientX); });
    el.addEventListener('keydown', function (e) {
      if (!state.ext) return;
      var t = state.ext.trim, d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!d) return;
      if (which0 === 'start') t.start = Math.max(0, Math.min(t.start + d, t.end - 1));
      else t.end = Math.min(state.ext.frames.length - 1, Math.max(t.end + d, t.start + 1));
      t.auto = false;
      renderTrim();
      showFrame(which0 === 'start' ? t.start : t.end);
      e.preventDefault();
    });
  }

  // ── Extraction ──
  function discardExtraction() {
    if (state.abort) state.abort.abort();
    if (state.player) state.player.cancel();
    state.ext = null;
    state.seeking = false;
    state.pendingSeek = null;
    var v = $('ac-video');
    if (state.seekDone) { v.removeEventListener('seeked', state.seekDone); state.seekDone = null; }
    if (v.src && v.src.indexOf('blob:') === 0) URL.revokeObjectURL(v.src);
    v.removeAttribute('src');
    v.load();
    $('ac-progress').value = 0;
    drawVideoFrame(null);
    renderTrim();
    updateButtons();
  }

  function runExtraction(file) {
    if (!state.key || state.extracting) return;
    var key = state.key;
    discardExtraction();
    state.extracting = true;
    state.abort = new AbortController();
    var signal = state.abort.signal;
    setView('video');
    updateButtons();
    status('Loading the extractor…');
    if (!state.extractor) state.extractor = window.AvatarExtract.createExtractor();
    var t0 = performance.now();
    state.extractor.extract(file, {
      video: $('ac-video'),
      signal: signal,
      onFrame: function (i, n, results, canvas) {
        if (signal.aborted) return;
        $('ac-progress').value = (i + 1) / n;
        status('Extracting: frame ' + (i + 1) + ' of ' + n);
        drawVideoFrame(canvas, window.AvatarClip.packFrame(results));
      }
    }).then(function (res) {
      if (signal.aborted || key !== state.key) return;
      var auto = window.AvatarClip.autoTrim(res.frames);
      var trim = auto ? { start: auto.start, end: auto.end, auto: true } : { start: 0, end: Math.max(1, res.frames.length - 1), auto: false };
      state.ext = { frames: res.frames, fps: res.fps, video: res.video, trim: trim, ms: Math.round(performance.now() - t0) };
      var c = { pose: 0, lh: 0, rh: 0 };
      res.frames.forEach(function (f) { if (f[0]) c.pose++; if (f[1]) c.lh++; if (f[2]) c.rh++; });
      // read by tests/avatar/admin-check.mjs (agreement with the prototype's full-resolution run)
      window.avatarClipsLastExtraction = { frames: res.frames, counts: c, trim: trim, ms: state.ext.ms };
      status('Done: ' + res.frames.length + ' frames in ' + (state.ext.ms / 1000).toFixed(1) + ' s. Pose in ' + c.pose +
        ', right hand in ' + c.rh + ', left hand in ' + c.lh + '. ' +
        (auto ? 'Trimmed to the first hand raise .. last hand lower; drag the handles to change it.'
          : 'No raised hand found: the whole video is selected; drag the handles to trim it.'));
      renderTrim();
      showFrame(trim.start);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      console.warn('[avatar-clips] extraction failed:', e);
      if (e && e.message === 'NO_SIMD') status('This browser cannot run the extractor: WebAssembly SIMD is missing. Use the laptop\'s Chrome.', true);
      else status('Extraction failed: ' + (e && e.message ? e.message : e), true);
      discardExtraction();
    }).finally(function () {
      if (state.abort && state.abort.signal === signal) state.abort = null;
      state.extracting = false;
      updateButtons();
    });
  }

  function currentClip() {
    var e = state.ext;
    return window.AvatarClip.buildClip({
      key: state.key, fps: e.fps, video: e.video, frames: e.frames, trim: e.trim,
      signer: $('ac-signer').value.trim()
    });
  }

  // ── Preview / Save / Redo / Delete ──
  function preview() {
    if (!state.player) return;
    if (state.player.isPlaying()) { state.player.cancel(); return; }
    var clipPromise;
    if (state.ext) clipPromise = Promise.resolve(currentClip());
    else clipPromise = fetch('saved_gestures/' + encodeURIComponent(state.key) + '/avatar.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    clipPromise.then(function (clip) {
      var v = window.AvatarClip.validateClip(clip);
      if (!v.ok) throw new Error(v.error);
      var prep = window.AvatarRetarget.prepare(clip, window.AvatarRig);
      setView('avatar');
      $('ac-preview').textContent = '■ Stop';
      return state.player.play([prep]);
    }).catch(function (e) {
      status('Preview failed: ' + (e && e.message ? e.message : e), true);
    }).finally(function () { $('ac-preview').textContent = '▶ Preview'; });
  }

  function save() {
    if (!state.ext || !state.key) return;
    var clip = currentClip();
    var v = window.AvatarClip.validateClip(clip);
    if (!v.ok) { status('Cannot save: ' + v.error, true); return; }
    var key = state.key;
    $('ac-save').disabled = true;
    status('Saving…');
    fetch('php/api/avatar_clip.php', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', key: key, clip: clip })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (res) {
      if (!res.ok || !res.d.success) throw new Error(res.d && res.d.error ? res.d.error : 'save failed');
      toast('✅ Clip saved');
      status('Saved: ' + res.d.frames + ' frames (' + Math.round(res.d.bytes / 1024) + ' KB). The video was not uploaded.');
      return loadSigns();
    }).catch(function (e) {
      status('Save failed: ' + (e && e.message ? e.message : e), true);
    }).finally(updateButtons);
  }

  function redo() {
    discardExtraction();
    status('Choose a video for this sign.');
    if (!$('ac-file').disabled) $('ac-file').click();
  }

  function disarmDelete() {
    clearTimeout(state.deleteTimer);
    var b = $('ac-delete');
    b.classList.remove('confirm');
    b.textContent = 'Delete';
  }
  function del() {
    var b = $('ac-delete');
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm');
      b.textContent = 'Tap again to delete';
      state.deleteTimer = setTimeout(disarmDelete, 3000);
      return;
    }
    disarmDelete();
    var key = state.key;
    b.disabled = true;
    fetch('php/api/avatar_clip.php', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: key })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.success) throw new Error(d.error || 'delete failed');
      toast('🗑️ Clip deleted');
      status('The clip was deleted. The sign and its recognition samples are unchanged.');
      return loadSigns();
    }).catch(function (e) {
      status('Delete failed: ' + (e && e.message ? e.message : e), true);
    }).finally(updateButtons);
  }

  // ── Start ──
  var started = false;
  function start() {
    if (started) return;
    started = true;
    try { $('ac-signer').value = localStorage.getItem(SIGNER_KEY) || ''; } catch (e) { /* storage blocked */ }
    $('ac-signer').addEventListener('input', function () {
      try { localStorage.setItem(SIGNER_KEY, $('ac-signer').value); } catch (e) { /* storage blocked */ }
    });
    $('ac-search').addEventListener('input', renderList);
    $('ac-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';                    // choosing the same file again still fires change
      if (f) runExtraction(f);
    });
    $('ac-view-video').addEventListener('click', function () { setView('video'); });
    $('ac-view-avatar').addEventListener('click', function () { setView('avatar'); });
    $('ac-preview').addEventListener('click', preview);
    $('ac-save').addEventListener('click', save);
    $('ac-redo').addEventListener('click', redo);
    $('ac-delete').addEventListener('click', del);
    bindHandle('ac-handle-l', 'start');
    bindHandle('ac-handle-r', 'end');
    drawVideoFrame(null);
    renderTrim();
    if (!window.AvatarExtract.simdSupported()) {
      status('This browser cannot run the extractor: WebAssembly SIMD is missing. Use the laptop\'s Chrome. Saved clips can still be previewed and deleted.', true);
    } else {
      status('Pick a sign.');
    }
    window.AvatarRenderer.loadParts().then(function (parts) {
      state.player = window.AvatarPlayer.create({ canvas: $('ac-avatar-canvas'), parts: parts, view: window.AvatarRig.views.admin });
      state.player.showRest();
      updateButtons();
    }).catch(function (e) { status('Avatar parts failed to load: ' + e.message, true); });
    loadSigns();
  }

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
