// js/sign-audio-admin.js
// Train Gestures -> sign details (the dataset modal's Edit panel): the "Audio" section
// (talk-turns-audio phase, docs/design/sign-audio-wireframe.html screen 1). One row per language the
// sign uses (letters: English only): play the saved audio, record it with the microphone
// (MediaRecorder, then play the new take before Save), upload a file, or delete it. Every change is
// saved at once through php/api/sign_audio.php (admin only), apart from the sign's texts and their Save.
(function () {
  'use strict';

  var MAX_BYTES = 2097152;          // php/api/sign_audio_lib.php SIGN_AUDIO_MAX_BYTES
  var MAX_RECORD_MS = 10000;        // a sign's word or phrase; also keeps a take far below 2 MB
  var ENDPOINT = 'php/api/sign_audio.php';
  var LANG_NAME = { en: 'English', fil: 'Filipino' };

  var state = null;   // { key, audio: {en, fil}, langs, onChange, rows: {lang: rowState} }
  var playing = null; // the <audio> playing now

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function btn(cls, text, title, onClick) {
    var b = el('button', 'tr-aud-btn ' + cls, text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', onClick);
    return b;
  }
  function fmtSecs(s) { return s.toFixed(1) + ' s'; }

  function stopPlaying() {
    if (playing) {
      try { playing.pause(); playing.removeAttribute('src'); playing.load(); } catch (e) { /* ignore */ }
      playing = null;
    }
  }
  function playUrl(url) {
    stopPlaying();
    var a = new Audio(url);
    playing = a;
    a.onended = function () { if (playing === a) stopPlaying(); };
    a.play().catch(function (e) { console.warn('[sign-audio] cannot play:', e); });
  }

  // Duration of a saved file, written into the status once known (MediaRecorder webm has none: "saved").
  // Read once per URL (a re-render, e.g. "busy" before a delete, must not fetch the file again).
  var durations = {};
  function showDuration(statusEl, url) {
    if (url in durations) {
      if (durations[url]) statusEl.textContent = '● ' + fmtSecs(durations[url]);
      return;
    }
    durations[url] = 0;
    var a = new Audio();
    a.preload = 'metadata';
    // Released once read: a live element keeps fetching ranges, which 404 after the file is deleted.
    function release() { a.onloadedmetadata = a.onerror = null; a.removeAttribute('src'); a.load(); }
    a.onloadedmetadata = function () {
      if (isFinite(a.duration) && a.duration > 0) {
        durations[url] = a.duration;
        // the row may have been drawn again meanwhile: update whichever status shows this file now
        Array.prototype.forEach.call(document.querySelectorAll('.tr-aud-status.ok'), function (el) {
          if (el.dataset.url === url) el.textContent = '● ' + fmtSecs(a.duration);
        });
      }
      release();
    };
    a.onerror = release;
    a.src = url;
  }

  async function send(body, isForm) {
    var res = await fetch(ENDPOINT, isForm
      ? { method: 'POST', body: body }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok || !json || !json.success) throw new Error((json && json.error) || 'HTTP ' + res.status);
    return json;
  }

  function setAudio(audio) {
    state.audio = audio || { en: null, fil: null };
    if (state.onChange) state.onChange(state.key, state.audio);
  }

  async function upload(lang, blob, name) {
    var r = state.rows[lang];
    if (blob.size > MAX_BYTES) { r.msg = 'The file is larger than 2 MB.'; renderRow(lang); return; }
    var fd = new FormData();
    fd.append('action', 'upload');
    fd.append('key', state.key);
    fd.append('lang', lang);
    fd.append('file', blob, name);
    r.busy = true; r.msg = 'Saving…'; renderRow(lang);
    var key = state.key;
    try {
      var json = await send(fd, true);
      if (!state || state.key !== key) return;
      discardTake(lang);
      setAudio(json.audio);
      r.msg = 'Saved.';
    } catch (e) {
      if (!state || state.key !== key) return;
      r.msg = 'Not saved: ' + e.message;
    } finally {
      if (state && state.key === key) { r.busy = false; renderRow(lang); }
    }
  }

  async function remove(lang) {
    var r = state.rows[lang];
    if (!confirm('Delete the ' + LANG_NAME[lang] + ' audio of this sign?')) return;
    stopPlaying();
    r.busy = true; r.msg = ''; renderRow(lang);
    var key = state.key;
    try {
      var json = await send({ action: 'delete', key: key, lang: lang });
      if (!state || state.key !== key) return;
      setAudio(json.audio);
      r.msg = 'Deleted.';
    } catch (e) {
      if (!state || state.key !== key) return;
      r.msg = 'Not deleted: ' + e.message;
    } finally {
      if (state && state.key === key) { r.busy = false; renderRow(lang); }
    }
  }

  function discardTake(lang) {
    var r = state.rows[lang];
    if (r.take) { URL.revokeObjectURL(r.take.url); r.take = null; }
  }

  async function startRecording(lang) {
    var r = state.rows[lang];
    stopAllRecorders();
    stopPlaying();
    discardTake(lang);
    r.msg = '';
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      r.msg = 'Microphone not available.';
      renderRow(lang);
      return;
    }
    if (!state || state.rows[lang] !== r) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(function (t) {
      return window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t);
    });
    var rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    var chunks = [];
    var t0 = Date.now();
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      clearInterval(r.timer);
      r.recorder = null;
      if (!state || state.rows[lang] !== r) return;
      var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size) {
        r.take = { blob: blob, url: URL.createObjectURL(blob), secs: (Date.now() - t0) / 1000,
          ext: /ogg/.test(blob.type) ? 'ogg' : 'webm' };
        r.msg = '';
      } else {
        r.msg = 'Nothing was recorded.';
      }
      renderRow(lang);
    };
    r.recorder = rec;
    r.timer = setInterval(function () {
      if (Date.now() - t0 >= MAX_RECORD_MS) { stopRecording(lang); return; }
      renderRow(lang);
    }, 250);
    r.t0 = t0;
    rec.start();
    renderRow(lang);
  }
  function stopRecording(lang) {
    var r = state && state.rows[lang];
    if (r && r.recorder && r.recorder.state !== 'inactive') r.recorder.stop();
  }
  function stopAllRecorders() {
    if (!state) return;
    Object.keys(state.rows).forEach(stopRecording);
  }

  function renderRow(lang) {
    if (!state) return;
    var r = state.rows[lang];
    var row = r.el;
    row.textContent = '';
    row.appendChild(el('b', 'tr-aud-name', LANG_NAME[lang]));
    var url = state.audio[lang];
    var status = el('span', 'tr-aud-status');
    var wave = el('div', 'tr-aud-wave');
    row.appendChild(wave);
    row.appendChild(status);
    var file = el('input');
    file.type = 'file';
    file.accept = '.webm,.mp3,.m4a,.wav,.ogg,audio/*';
    file.hidden = true;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (f) upload(lang, f, f.name);
    });
    var uploadBtn = btn('sec', '⇪ Upload', 'Upload an audio file', function () { file.click(); });
    if (r.recorder) {
      wave.classList.add('rec');
      status.classList.add('rec');
      var s = Math.floor((Date.now() - r.t0) / 1000);
      status.textContent = '● REC 0:' + (s < 10 ? '0' : '') + s;
      row.appendChild(btn('pri', '■ Stop', 'Stop recording', function () { stopRecording(lang); }));
    } else if (r.take) {
      wave.classList.add('take');
      status.textContent = 'New take ' + fmtSecs(r.take.secs) + ' — check it';
      row.appendChild(btn('sec', '▶', 'Play the new recording', function () { playUrl(r.take.url); }));
      row.appendChild(btn('pri', 'Save', 'Save the new recording', function () { upload(lang, r.take.blob, 'recording.' + r.take.ext); }));
      row.appendChild(btn('sec', 'Discard', 'Discard the new recording', function () { discardTake(lang); renderRow(lang); }));
    } else {
      if (url) {
        status.classList.add('ok');
        status.textContent = '● saved';
        status.dataset.url = url;
        showDuration(status, url);
        row.appendChild(btn('sec', '▶', 'Play the saved audio', function () { playUrl(url); }));
      } else {
        wave.classList.add('none');
        status.classList.add('no');
        status.textContent = '— no audio';
      }
      row.appendChild(btn('sec', url ? '● Re-record' : '● Record', 'Record with the microphone', function () { startRecording(lang); }));
      row.appendChild(uploadBtn);
      row.appendChild(file);
      if (url) row.appendChild(btn('red', '✕', 'Delete this audio', function () { remove(lang); }));
    }
    if (r.msg) row.appendChild(el('span', 'tr-aud-msg', r.msg));
    Array.prototype.forEach.call(row.querySelectorAll('button'), function (b) { if (r.busy) b.disabled = true; });
  }

  // container: the Audio section's element. sign: { key, audio:{en,fil}, langs: ['en'] | ['en','fil'] | ['fil'] }.
  // onChange(key, audio) after every save/delete (to refresh the sign list's 🔊 marker).
  function open(container, sign, onChange) {
    close();
    state = { key: sign.key, audio: sign.audio || { en: null, fil: null }, langs: sign.langs, onChange: onChange, rows: {} };
    container.textContent = '';
    container.appendChild(el('div', 'tr-flbl', 'AUDIO — played in Let\'s Talk when this sign is in the sentence'));
    sign.langs.forEach(function (lang) {
      var row = el('div', 'tr-aud-row');
      row.dataset.lang = lang;
      container.appendChild(row);
      state.rows[lang] = { el: row, recorder: null, take: null, msg: '', busy: false };
      renderRow(lang);
    });
    container.appendChild(el('div', 'tr-aud-note', '● Record = the kiosk mic, then ▶ to check it before Save. ⇪ Upload = webm / mp3 / m4a / wav / ogg, up to 2 MB.' +
      (sign.langs.length === 1 && sign.langs[0] === 'en' && sign.letter ? ' Letters: English only.' : '')));
    container.hidden = false;
  }

  function close() {
    if (!state) return;
    stopAllRecorders();
    stopPlaying();
    Object.keys(state.rows).forEach(function (lang) {
      var r = state.rows[lang];
      clearInterval(r.timer);
      if (r.take) URL.revokeObjectURL(r.take.url);
    });
    state = null;
  }

  window.SignAudioAdmin = { open: open, close: close };
})();
