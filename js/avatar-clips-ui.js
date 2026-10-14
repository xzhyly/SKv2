// js/avatar-clips-ui.js
// avatar-clips.html: pick a sign -> pick a video -> extract (progress + skeleton overlay) ->
// auto-trim with manual handles -> preview on the avatar -> Save / Redo / Delete (decision 4).
// The video is only ever read locally through an object URL; the only request that carries data is
// the clip JSON posted to php/api/avatar_clip.php. A sign's recognition samples are never touched.
// "Import JSON" loads a landmark file (the system's own clip or the prototype tool's output,
// AvatarClip.importClip) instead of a video and joins the same flow at the trim step, with no
// video to show; "Export JSON" downloads a sign's saved clip as <key>.avatar.json.
// "Candidates (n)" lists the clips the bulk importer (bulk-import.html) cached for the selected
// sign, one per signer: Preview plays one on the avatar, "Use this" saves it as the sign's clip
// through the same php/api/avatar_clip.php and records the choice as picked by hand
// (php/api/bulk_import.php, picks). Without that cache the control simply stays disabled.
(function () {
  'use strict';

  var PIN = '2026';                         // same PIN as Train Gestures (js/gesture-training-ui.js)
  var UNLOCK_KEY = 'sk_train_unlocked';     // unlock time (ms), set by Train Gestures; this tab session only
  var UNLOCK_MS = 10 * 60 * 1000;           // ... and honoured for 10 minutes
  var SIGNER_KEY = 'sk_avatar_signer';
  var MAX_JSON_BYTES = 8 * 1024 * 1024;     // Import JSON: 1500 untrimmed frames are about 1.3 MB
  var BULK_API = 'php/api/bulk_import.php'; // the bulk importer's cache: candidates and picks
  var PICK_SIGNER_RE = /^P(0[1-9]|[1-9][0-9])$/i;   // the signer ids a pick may name
  var TRACK_W = 472;
  var HAND = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
  var P = window.AvatarClip ? window.AvatarClip.P : null;

  function $(id) { return document.getElementById(id); }

  var state = {
    signs: {}, key: null, ext: null, extracting: false, abort: null, deleteTimer: null,
    player: null, extractor: null, seeking: false, pendingSeek: null, lastSource: 'video', importId: 0,
    // Candidates of the selected sign ([{signer, set, frames, videoId, repIndex, savedAt}]) and the
    // picks of every sign ({key: {signer, by}}); candPlaying: the signer whose candidate plays.
    // playId: one counter for the main Preview and the candidates' Preview (the latest press wins).
    // inUse: is the saved clip really the picked signer's candidate? true | false | null (not
    // known yet), looked up for inUseId; clipVersion counts the reloads of the sign list.
    cands: [], candsToken: 0, picks: {}, candPlaying: null, playId: 0, candBusy: false,
    inUse: null, inUseId: '', clipVersion: 0
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
      state.clipVersion++;
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
    renderCands();
  }

  function selectSign(key) {
    if (state.extracting) return;
    state.key = key;
    discardExtraction();
    disarmDelete();
    renderList();
    renderSelected();
    loadCands(key);
    loadPicks();                             // another tab (the bulk importer) may have changed them
    status(state.signs[key] && state.signs[key].avatar
      ? 'This sign has a clip. Preview plays it; choose a video or import a JSON to replace it.'
      : 'Choose a video of this sign, or import a JSON clip.');
  }

  function updateButtons() {
    var s = state.key && state.signs[state.key];
    var canChoose = !!s && !state.extracting && window.AvatarExtract.simdSupported();
    $('ac-file').disabled = !canChoose;
    $('ac-choose').setAttribute('aria-disabled', canChoose ? 'false' : 'true');
    var canImport = !!s && !state.extracting;     // no extractor involved: works without SIMD
    $('ac-json').disabled = !canImport;
    $('ac-import').setAttribute('aria-disabled', canImport ? 'false' : 'true');
    $('ac-view-video').disabled = !!(state.ext && state.ext.imported);   // an imported clip has no video
    var tooLong = state.ext && state.ext.trim.end - state.ext.trim.start + 1 > window.AvatarClip.MAX_FRAMES;
    $('ac-save').disabled = !(s && state.ext && !state.extracting && !tooLong);
    $('ac-redo').disabled = !(state.ext || state.extracting);
    $('ac-delete').disabled = !(s && s.avatar && !state.extracting);
    $('ac-export').disabled = !(s && s.avatar && !state.extracting);
    $('ac-preview').disabled = !(s && !state.extracting && (state.ext || s.avatar || state.candPlaying) && state.player);
    document.querySelectorAll('.ac-item').forEach(function (b) { b.disabled = state.extracting; });
    var canPick = !!s && !state.extracting && state.cands.length > 0;
    $('ac-cands-open').disabled = !canPick;
    if (!canPick) closeCands();
    document.querySelectorAll('.ac-cand button').forEach(function (b) {
      b.disabled = !state.player || state.candBusy || (b.dataset.act === 'use' && (state.extracting || b.dataset.blocked === '1'));
    });
  }

  // ── Candidates (the bulk importer's cache) ──
  // Every request here may fail (no cache on this machine, Apache down): a failed read means "no
  // candidates", a failed pick is only a console.warn. Neither is ever an error state of the page.
  function bulkAnswer(r) {
    return r.json().then(function (d) {
      if (!r.ok || !d || !d.success) throw new Error((d && d.error) || 'HTTP ' + r.status);
      return d;
    });
  }
  function bulkGet(query) { return fetch(BULK_API + '?' + query, { cache: 'no-cache' }).then(bulkAnswer); }
  function bulkPost(body) {
    return fetch(BULK_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(bulkAnswer);
  }
  function ownKey(obj, key) { return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined; }

  function loadPicks() {
    return bulkGet('action=picks').then(function (d) {
      state.picks = d.picks || {};
      renderCands();
    }).catch(function () { /* no cache: no picks */ });
  }
  function loadCands(key) {
    var token = ++state.candsToken;
    state.cands = [];
    closeCands();
    renderCands();
    if (!key) return;
    bulkGet('action=candidates&key=' + encodeURIComponent(key)).then(function (d) {
      if (token !== state.candsToken) return;
      var list = ownKey(d.candidates, key);
      state.cands = Array.isArray(list) ? list : [];
      renderCands();
    }).catch(function () { /* no cache, or a key the cache cannot hold: no candidates */ });
  }
  // Records how the sign's clip was chosen. signer: a P01..P99 id -> picked by hand from that
  // signer; anything else -> the pick is removed (a sign with a clip and no pick already counts
  // as picked by hand). The removal first READS the picks again, now: the bulk importer's "Apply
  // to all signs" (another tab) may have recorded a pick since this page loaded, and leaving it
  // would let the next Apply replace the clip that was just saved. Nothing is posted when there
  // is no pick to remove. Never part of a save or a delete: -> Promise of true / false (failed,
  // only a console.warn).
  function recordPick(key, signer) {
    var change = {};
    signer = String(signer || '').trim();
    change[key] = PICK_SIGNER_RE.test(signer) ? { signer: signer.toUpperCase(), by: 'hand' } : null;
    var ready = change[key] ? Promise.resolve(true) : bulkGet('action=picks').then(function (d) {
      state.picks = d.picks || {};
      return ownKey(state.picks, key) !== undefined;
    });
    return ready.then(function (post) {
      if (!post) { renderCands(); return true; }
      return bulkPost({ action: 'set_picks', picks: change }).then(function (d) {
        state.picks = d.picks || {};
        renderCands();
        return true;
      });
    }).catch(function (e) {
      console.warn('[avatar-clips] the pick of "' + key + '" was not recorded:', e);
      return false;
    });
  }

  // Why this candidate may not become the sign's clip, or null: it was made from a video of
  // another set than the sign's (an ESL video for a sign that exists as FSL). A candidate without
  // a set is of an unknown set and may be used. The same rule as BulkImportCore.candidateUsable().
  function candidateBlocked(c, s) {
    var sets = ['ESL', 'FSL', 'BOTH'];
    if (!c || !s || sets.indexOf(c.set) < 0 || sets.indexOf(s.set) < 0 || c.set === s.set) return null;
    return 'made from a' + (c.set === 'BOTH' ? ' BOTH' : c.set === 'ESL' ? 'n ESL' : 'n FSL') + ' video; this sign is ' + s.set + ' — cannot be used';
  }
  function candsOpen() { return !$('ac-cands').hidden; }
  function closeCands() {
    $('ac-cands').hidden = true;
    $('ac-cands-open').setAttribute('aria-expanded', 'false');
  }
  function toggleCands() {
    if (candsOpen() || !state.cands.length) { closeCands(); return; }
    $('ac-cands').hidden = false;
    $('ac-cands-open').setAttribute('aria-expanded', 'true');
    renderCands();                           // looks up whether the picked candidate is the saved clip
  }
  // Is the sign's saved clip really the candidate its pick names? (The clip may have been saved
  // from an own video with that signer id, or the candidate extracted again since.) Compared
  // cheaply, and only while the panel is open: signer and frame count first, then the first frame.
  // -> true | false | null (not known yet: the rows are drawn again when it is).
  function inUseMatch(key, pick) {
    var cand = state.cands.filter(function (c) { return c.signer === pick.signer; })[0];
    if (!cand) return null;
    var id = [key, pick.signer, pick.by, pick.at, cand.savedAt, cand.frames, state.clipVersion].join('|');
    if (state.inUseId === id) return state.inUse;
    if (!candsOpen()) return null;
    state.inUseId = id;
    state.inUse = null;
    fetch('saved_gestures/' + encodeURIComponent(key) + '/avatar.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (saved) {
      if (!saved || !Array.isArray(saved.frames) || saved.signer !== pick.signer || saved.frames.length !== cand.frames) return false;
      return bulkGet('action=candidate&key=' + encodeURIComponent(key) + '&signer=' + encodeURIComponent(pick.signer)).then(function (d) {
        var clip = d.candidate && d.candidate.clip;
        return !!(clip && Array.isArray(clip.frames) && JSON.stringify(clip.frames[0]) === JSON.stringify(saved.frames[0]));
      });
    }).then(function (same) {
      if (state.inUseId !== id) return;
      state.inUse = same;
      renderCands();
    }).catch(function () { /* not known: no mark */ });
    return null;
  }
  function renderCands() {
    var key = state.key, s = key && state.signs[key];
    var list = $('ac-cands-list');
    $('ac-cands-open').textContent = 'Candidates (' + state.cands.length + ')';
    $('ac-cands-title').textContent = s ? 'Candidates for "' + signText(s, key) + '"' : 'Candidates';
    list.textContent = '';
    var pick = s && s.avatar ? ownKey(state.picks, key) : undefined;
    var match = pick ? inUseMatch(key, pick) : null;
    state.cands.forEach(function (c) {
      var mine = !!pick && pick.signer === c.signer;
      var inUse = mine && match === true;
      var row = document.createElement('div');
      row.className = 'ac-cand' + (inUse ? ' in-use' : '');
      row.dataset.signer = c.signer;
      var who = document.createElement('span'); who.className = 'ac-cand-signer'; who.textContent = c.signer;
      var info = document.createElement('span'); info.className = 'ac-cand-info';
      var blocked = candidateBlocked(c, s);
      var frames = document.createElement('span'); frames.className = 'ac-cand-frames';
      frames.textContent = c.frames + ' frames' + (c.set ? ' · ' + c.set : '');
      var mark = document.createElement('span'); mark.className = 'ac-cand-mark' + (blocked ? ' blocked' : '');
      mark.textContent = blocked ? blocked : inUse ? '✓ in use · ' + (pick.by === 'hand' ? 'picked by hand' : 'default')
        : mine && match === false ? (pick.by === 'hand' ? 'picked by hand (own clip)' : 'default (another clip)') : '';
      info.appendChild(frames); info.appendChild(mark);
      var play = document.createElement('button'); play.type = 'button'; play.className = 'ac-btn ac-cand-btn'; play.dataset.act = 'preview';
      play.textContent = state.candPlaying === c.signer ? '■ Stop' : '▶ Preview';
      play.setAttribute('aria-label', 'Preview the candidate of ' + c.signer);
      play.addEventListener('click', function () { previewCandidate(c.signer); });
      var use = document.createElement('button'); use.type = 'button'; use.className = 'ac-btn ac-cand-btn ac-cand-use'; use.dataset.act = 'use';
      use.textContent = 'Use this';
      use.setAttribute('aria-label', 'Use the candidate of ' + c.signer + (blocked ? ' (' + blocked + ')' : ''));
      if (blocked) { use.dataset.blocked = '1'; use.title = 'This clip was ' + blocked + '.'; }
      use.addEventListener('click', function () { useCandidate(c.signer); });
      row.appendChild(who); row.appendChild(info); row.appendChild(play); row.appendChild(use);
      list.appendChild(row);
    });
    updateButtons();
  }

  // The candidate's clip, validated like any clip this page plays or saves.
  function candidateClip(key, signer) {
    return bulkGet('action=candidate&key=' + encodeURIComponent(key) + '&signer=' + encodeURIComponent(signer)).then(function (d) {
      var clip = d.candidate && d.candidate.clip;
      var v = window.AvatarClip.validateClip(clip);
      if (!v.ok) throw new Error(v.error);
      return clip;
    });
  }
  // Plays a candidate on the avatar with the page's own preview machinery; the main Preview
  // button shows Stop meanwhile and stops it (preview() cancels whatever plays).
  function previewCandidate(signer) {
    if (!state.player || !state.key) return;
    if (state.candPlaying === signer && state.player.isPlaying()) { state.player.cancel(); return; }
    state.player.cancel();
    state.candPlaying = null;
    var key = state.key, id = ++state.playId;
    candidateClip(key, signer).then(function (clip) {
      if (id !== state.playId || key !== state.key) return null;   // a later Preview press took over
      var prep = window.AvatarRetarget.prepare(clip, window.AvatarRig);
      setView('avatar');
      state.candPlaying = signer;
      $('ac-preview').textContent = '■ Stop';
      renderCands();
      status('Playing the candidate of ' + signer + ' (' + clip.frames.length + ' frames).');
      return state.player.play([prep]);
    }).catch(function (e) {
      status('Preview failed: ' + (e && e.message ? e.message : e), true);
    }).finally(function () {
      if (id !== state.playId) return;              // a later preview owns the button now
      state.candPlaying = null;
      $('ac-preview').textContent = '▶ Preview';
      renderCands();
    });
  }
  // "Use this": the candidate becomes the sign's clip (the same request Save sends), and the
  // choice is recorded as picked by hand, so the bulk importer's "Apply to all signs" keeps it.
  function useCandidate(signer) {
    if (!state.key || state.extracting || state.candBusy) return;
    var key = state.key;
    var cand = state.cands.filter(function (c) { return c.signer === signer; })[0];
    var blocked = candidateBlocked(cand, state.signs[key]);
    if (blocked) { status('The candidate of ' + signer + ' was ' + blocked + '.', true); return; }
    state.candBusy = true;
    updateButtons();
    status('Saving the clip of ' + signer + '…');
    candidateClip(key, signer).then(function (clip) {
      clip.key = key;
      return fetch('php/api/avatar_clip.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', key: key, clip: clip })
      });
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (res) {
      if (!res.ok || !res.d.success) throw new Error(res.d && res.d.error ? res.d.error : 'save failed');
      return recordPick(key, signer);
    }).then(function (recorded) {
      toast('✅ Clip set');
      status(recorded ? 'Clip set from ' + signer + ' (picked by hand).'
        : 'Clip set from ' + signer + '. The choice could not be recorded in the bulk importer\'s cache.');
      return loadSigns();
    }).catch(function (e) {
      status('This candidate could not be used: ' + (e && e.message ? e.message : e), true);
    }).finally(function () {
      state.candBusy = false;
      updateButtons();
    });
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
    if (state.ext.imported) {                       // no video: the avatar holds that frame's pose
      var prep = state.ext.prep;
      if (prep && prep.poses[i] && state.player && !state.player.isPlaying()) state.player.renderer.draw(prep.poses[i], performance.now());
      return;
    }
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
    var avatar = which === 'avatar' || !!(state.ext && state.ext.imported);
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
    state.importId++;                               // a file still being read is dropped
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
    state.lastSource = 'video';
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

  // ── Import JSON ──
  function runImport(file) {
    if (!state.key || state.extracting) return;
    var key = state.key;
    discardExtraction();
    state.lastSource = 'json';
    var id = state.importId;
    function fail(why) { status('Import failed. ' + why + ' Nothing was saved.', true); }
    if (file.size > MAX_JSON_BYTES) { fail('This file is too large to be an avatar clip.'); return; }
    status('Reading ' + file.name + '…');
    file.text().then(function (text) {
      if (id !== state.importId || key !== state.key || state.extracting) return;
      var data;
      try { data = JSON.parse(text); } catch (e) { fail('This file is not valid JSON.'); return; }
      var res = window.AvatarClip.importClip(data);
      if (!res.ok) { fail(res.error); return; }
      var n = res.frames.length;
      // A system clip is already trimmed: keep it whole. The prototype's output is a whole video.
      var auto = res.source === 'prototype' ? window.AvatarClip.autoTrim(res.frames) : null;
      var trim = auto ? { start: auto.start, end: auto.end, auto: true } : { start: 0, end: n - 1, auto: false };
      var prep;
      try {     // per-frame avatar poses, for the still shown while a trim handle is dragged
        prep = window.AvatarRetarget.prepare(window.AvatarClip.buildClip({
          key: key, fps: res.fps, video: res.video, frames: res.frames, trim: { start: 0, end: n - 1 }
        }), window.AvatarRig);
      } catch (e) {
        fail('This clip cannot be shown on the avatar (' + (e && e.message ? e.message : e) + ').');
        return;
      }
      state.ext = { frames: res.frames, fps: res.fps, video: res.video, trim: trim, imported: true, offsetMs: res.offsetMs, prep: prep };
      if (res.signer) $('ac-signer').value = res.signer;
      var c = { pose: 0, lh: 0, rh: 0 };
      res.frames.forEach(function (f) { if (f[0]) c.pose++; if (f[1]) c.lh++; if (f[2]) c.rh++; });
      // read by tests/avatar/import-check.mjs
      window.avatarClipsLastImport = { name: file.name, source: res.source, frames: res.frames, counts: c, trim: trim };
      $('ac-progress').value = 1;
      status('Imported ' + file.name + ': ' + n + ' frames. Pose in ' + c.pose + ', right hand in ' + c.rh + ', left hand in ' + c.lh + '. ' +
        (res.source === 'clip' ? 'This clip is already trimmed; drag the handles to trim it more.'
          : auto ? 'Trimmed to the first hand raise .. last hand lower; drag the handles to change it.'
            : 'No raised hand found: every frame is selected; drag the handles to trim it.'));
      setView('avatar');
      renderTrim();
      showFrame(trim.start);
    }).catch(function (e) {
      if (id === state.importId) fail('This file could not be read (' + (e && e.message ? e.message : e) + ').');
    });
  }

  function currentClip() {
    var e = state.ext;
    var clip = window.AvatarClip.buildClip({
      key: state.key, fps: e.fps, video: e.video, frames: e.frames, trim: e.trim,
      signer: $('ac-signer').value.trim()
    });
    // a re-imported system clip: its trim times stay those of its original video
    if (e.offsetMs) { clip.trim.startMs += e.offsetMs; clip.trim.endMs += e.offsetMs; }
    return clip;
  }

  // ── Export JSON ──
  function exportClip() {
    var key = state.key;
    if (!key) return;
    fetch('saved_gestures/' + encodeURIComponent(key) + '/avatar.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var v = window.AvatarClip.validateClip(JSON.parse(text));
      if (!v.ok) throw new Error(v.error);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = key + '.avatar.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      status('Exported ' + key + '.avatar.json to this computer\'s downloads.');
    }).catch(function (e) {
      status('Export failed: ' + (e && e.message ? e.message : e), true);
    });
  }

  // ── Preview / Save / Redo / Delete ──
  function preview() {
    if (!state.player) return;
    if (state.player.isPlaying()) { state.player.cancel(); return; }
    var id = ++state.playId;                  // drops a candidate preview that is still being fetched
    var clipPromise;
    if (state.ext) clipPromise = Promise.resolve(currentClip());
    else clipPromise = fetch('saved_gestures/' + encodeURIComponent(state.key) + '/avatar.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    clipPromise.then(function (clip) {
      if (id !== state.playId) return null;   // a candidate's Preview was pressed meanwhile
      var v = window.AvatarClip.validateClip(clip);
      if (!v.ok) throw new Error(v.error);
      var prep = window.AvatarRetarget.prepare(clip, window.AvatarRig);
      setView('avatar');
      $('ac-preview').textContent = '■ Stop';
      return state.player.play([prep]);
    }).catch(function (e) {
      status('Preview failed: ' + (e && e.message ? e.message : e), true);
    }).finally(function () { if (id === state.playId) $('ac-preview').textContent = '▶ Preview'; });
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
      var said = 'Saved: ' + res.d.frames + ' frames (' + Math.round(res.d.bytes / 1024) + ' KB).' +
        (state.ext && state.ext.imported ? '' : ' The video was not uploaded.');
      status(said);
      // not waited for: never part of the save. A failure is only added to the status line.
      recordPick(key, clip.signer).then(function (recorded) {
        if (!recorded && $('ac-status').textContent === said) status(said + ' The choice could not be recorded as picked by hand.');
      });
      return loadSigns();
    }).catch(function (e) {
      status('Save failed: ' + (e && e.message ? e.message : e), true);
    }).finally(updateButtons);
  }

  function redo() {
    var json = state.lastSource === 'json';
    discardExtraction();
    status(json ? 'Choose a JSON clip for this sign.' : 'Choose a video for this sign.');
    var input = $(json ? 'ac-json' : 'ac-file');
    if (!input.disabled) input.click();
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
      recordPick(key, null);                  // the pick goes with the clip; not waited for
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
    $('ac-json').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) runImport(f);
    });
    $('ac-export').addEventListener('click', exportClip);
    $('ac-view-video').addEventListener('click', function () { setView('video'); });
    $('ac-view-avatar').addEventListener('click', function () { setView('avatar'); });
    $('ac-preview').addEventListener('click', preview);
    $('ac-save').addEventListener('click', save);
    $('ac-redo').addEventListener('click', redo);
    $('ac-delete').addEventListener('click', del);
    $('ac-cands-open').addEventListener('click', toggleCands);
    $('ac-cands-close').addEventListener('click', closeCands);
    bindHandle('ac-handle-l', 'start');
    bindHandle('ac-handle-r', 'end');
    drawVideoFrame(null);
    renderTrim();
    if (!window.AvatarExtract.simdSupported()) {
      status('This browser cannot run the extractor: WebAssembly SIMD is missing. Use the laptop\'s Chrome. Saved clips can still be previewed, exported and deleted, and JSON clips imported.', true);
    } else {
      status('Pick a sign.');
    }
    window.AvatarRenderer.loadParts().then(function (parts) {
      state.player = window.AvatarPlayer.create({ canvas: $('ac-avatar-canvas'), parts: parts, view: window.AvatarRig.views.admin });
      state.player.showRest();
      updateButtons();
    }).catch(function (e) { status('Avatar parts failed to load: ' + e.message, true); });
    loadSigns();
    loadPicks();
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
