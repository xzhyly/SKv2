// js/glove.js
// The optional wired data gloves (glove-serial phase 2026-10-20, protocol v2 glove-hw phase 2026-10-21,
// docs/system/GLOVE.md): two gloves, 10 flex sensors on a 16-channel mux, one ESP32, optional MPU6050,
// USB serial 115200 baud, one JSON object per line. Web Serial only, no libraries. Attaches
// window.SKGlove. The glove sends the raw value of all 16 channels. Which channel is which finger is fixed
// in hardware since the glove-static phase (2026-10-22): MAP below, the one place it is defined. The open/fist
// calibration, the camera's handedness and the IMU's hand are the glove's setup, stored ON THE GLOVE
// (cfg-get / cfg-set), so a glove set up on the laptop works on the Pi.
// A simulator source produces the same protocol lines through the same parser.
(function () {
  'use strict';

  var BAUD = 115200;
  var CH = 16;                  // mux channels in every data line
  var RETRY_MS = 3000;          // unplugged: getPorts() retried this often
  var AVG = 3;                  // moving average over the last 3 readings
  var LOG_MAX = 2000;           // lines kept for Download log
  var MINSPAN = 50;             // open/fist closer than this -> that finger reads null
  var CFG_MAX = 1000;           // longest setup the firmware stores (characters)
  var CFG_TIMEOUT_MS = 2000;    // cfg-set / cfg-clear answer timeout
  var DEFAULT_W = 0.3;          // glove strength (Phase 2 re-ranking)
  var SIM_MS = 33;              // simulator: ~30 lines/s
  var SIM_BAD_EVERY = 150;      // simulator: one bad line about every 5 s
  var SIM_CFG_KEY = 'sk_glove_sim_cfg';   // the simulator's "flash"
  var FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  var HANDS = ['L', 'R'];
  // The fixed wiring (glove-static phase): mux channel per finger, thumb..pinky. Right C0-C4, left C9-C5.
  var MAP = { R: [0, 1, 2, 3, 4], L: [9, 8, 7, 6, 5] };
  // MediaPipe labels handedness as if the picture were a mirrored selfie; js/gesture-data.js sends it the camera's
  // own unmirrored frames (selfieMode not set), so the wearer's right hand reads "Left": mirror on. Used for a setup
  // with no measured cam (Set up glove has no camera step since the glove-static phase).
  var DEFAULT_MIRROR = true;

  var listeners = { status: [], data: [], hello: [], raw: [], error: [], pong: [], config: [] };
  var state = 'disconnected';
  var port = null, reader = null, writer = null;
  var userClosed = false, retryTimer = null;
  var hello = null, latestData = null;
  var cfg = null;               // validated setup from the glove, or null
  var cfgState = 'unknown';     // 'unknown' (no answer yet) | 'none' | 'ok' | 'damaged'
  var cfgCal = 'none';          // what happened to the stored calibration: 'none' | 'same' | 'moved' | 'dropped'
  var pendingCfg = null;        // { resolve, reject, timer, next } while cfg-set / cfg-clear waits
  var history = [];             // last AVG { L: [5], R: [5] } normalized readings
  var lineBuf = '';
  var pingAt = 0;
  var sim = null;               // { timer, n, t0 } while the simulator runs
  var simOn = readSimSetting();
  var simBend = {};             // tests / wizard checks: channel -> forced bend 0..1
  var st = freshStats();

  function freshStats() {
    return { lines: 0, bad: 0, data: 0, lastDataAt: 0, helloAt: 0, connectedAt: 0, reconnects: 0,
      lastBadAt: 0, lastBad: null, stamps: [], min: nulls(CH), max: nulls(CH),
      recent: [] };   // recent: last 30 raw channel arrays (debugger hints)
  }
  function nulls(n) { var a = []; for (var i = 0; i < n; i++) a.push(null); return a; }

  function emit(ev, arg) {
    (listeners[ev] || []).slice().forEach(function (cb) {
      try { cb(arg); } catch (e) { console.warn('[glove] listener failed:', e); }
    });
  }
  function on(ev, cb) {
    if (!listeners[ev]) listeners[ev] = [];
    listeners[ev].push(cb);
    return function () { listeners[ev] = listeners[ev].filter(function (f) { return f !== cb; }); };
  }
  function setStatus(s) {
    if (s === state) return;
    state = s;
    if (s === 'connected') st.connectedAt = Date.now();
    emit('status', s);
  }

  function serialAvailable() { return typeof navigator !== 'undefined' && !!navigator.serial && !!window.isSecureContext; }
  function isSupported() { return simOn || serialAvailable(); }
  function status() { return !simOn && !serialAvailable() ? 'unsupported' : state; }

  // The simulator runs only when the page address has ?glove=sim (tests and development). Owner 2026-10-22: no
  // "Use simulator" switch on any page any more, so a kiosk can never show a fake glove by accident; an old
  // sk_glove_sim value left in localStorage is ignored.
  function readSimSetting() {
    try { return /(?:^|[?&])glove=sim(?:&|$)/.test(location.search); } catch (e) { return false; }
  }

  // ── the setup (docs/system/GLOVE.md "The setup") ──
  function isInt(v, lo, hi) { return typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi; }
  function five(a, check) { return Array.isArray(a) && a.length === 5 && a.every(check); }
  function sameMap(m) { return HANDS.every(function (h) { return m[h].every(function (c, i) { return c === MAP[h][i]; }); }); }
  // Returns a clean copy of a valid setup, or null. Unknown keys are dropped. The map is always MAP: a setup saved
  // with another (older, per-glove) map keeps its calibration only when every MAP channel has one there, re-keyed
  // by channel; otherwise the calibration is dropped and the glove needs a new one. info.cal (optional out) says
  // which: 'none' | 'same' | 'moved' | 'dropped'. No cam -> DEFAULT_MIRROR.
  function validateConfig(c, info) {
    info = info || {};
    info.cal = 'none';
    if (!c || typeof c !== 'object' || c.v !== 1) return null;
    var m = c.map;
    var chOrNull = function (v) { return v === null || isInt(v, 0, CH - 1); };
    if (m != null && (!five(m.L, chOrNull) || !five(m.R, chOrNull))) return null;
    var out = { v: 1, map: { L: MAP.L.slice(), R: MAP.R.slice() }, cal: null, cam: { mirror: DEFAULT_MIRROR }, imuHand: null, w: DEFAULT_W };
    if (c.cal != null) {
      var adc = function (v) { return isInt(v, 0, 4095); };
      var hand = function (h) { return h && five(h.open, adc) && five(h.fist, adc); };
      if (!hand(c.cal.L) || !hand(c.cal.R) || typeof c.cal.at !== 'string') return null;
      if (!m || sameMap(m)) {
        out.cal = { L: { open: c.cal.L.open.slice(), fist: c.cal.L.fist.slice() },
          R: { open: c.cal.R.open.slice(), fist: c.cal.R.fist.slice() }, at: c.cal.at };
        info.cal = 'same';
      } else {
        var byCh = {};   // channel -> { open, fist } from the old map
        HANDS.forEach(function (h) { m[h].forEach(function (ch, i) { if (ch !== null) byCh[ch] = { open: c.cal[h].open[i], fist: c.cal[h].fist[i] }; }); });
        var all = HANDS.every(function (h) { return MAP[h].every(function (ch) { return !!byCh[ch]; }); });
        if (all) {
          var moved = function (h) {
            return { open: MAP[h].map(function (ch) { return byCh[ch].open; }), fist: MAP[h].map(function (ch) { return byCh[ch].fist; }) };
          };
          out.cal = { L: moved('L'), R: moved('R'), at: c.cal.at };
          info.cal = 'moved';
        } else info.cal = 'dropped';
      }
    }
    if (c.cam != null) {
      if (typeof c.cam.mirror !== 'boolean') return null;
      out.cam = { mirror: c.cam.mirror };
    }
    if (c.imuHand != null) {
      if (c.imuHand !== 'L' && c.imuHand !== 'R') return null;
      out.imuHand = c.imuHand;
    }
    if (c.w != null) {
      if (typeof c.w !== 'number' || !(c.w >= 0 && c.w <= 1)) return null;
      out.w = c.w;
    }
    return out;
  }
  function setConfig(c, s) {
    cfg = c;
    cfgState = s;
    history = [];
    emit('config', { config: cfg, state: cfgState });
  }

  // ── parsing (one line) ──
  var logLines = [];
  function logLine(dir, line, ok, error) {
    var entry = { at: Date.now(), dir: dir, line: line, ok: ok, error: error || null };
    logLines.push(entry);
    if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
    emit('raw', entry);
  }

  // { L: { raw: [5], norm: [5] }, R: {...} } from the 16 channels through MAP (with or without a setup).
  // norm is null for a finger whose open and fist are closer than MINSPAN; a sensor that reads lower when bent
  // (fist < open) works the same (the span is negative). Without a calibration norm = raw / 4095. Moving average
  // of AVG readings.
  function handsFrom(ch) {
    var now = {};
    var out = {};
    HANDS.forEach(function (h) {
      var cal = cfg && cfg.cal ? cfg.cal[h] : null;
      var raw = MAP[h].map(function (c) { return ch[c]; });
      now[h] = raw.map(function (v, i) {
        if (v === null) return null;
        if (!cal) return v / 4095;
        var span = cal.fist[i] - cal.open[i];
        if (Math.abs(span) < MINSPAN) return null;
        var x = (v - cal.open[i]) / span;
        return x < 0 ? 0 : x > 1 ? 1 : x;
      });
      out[h] = { raw: raw };
    });
    history.push(now);
    if (history.length > AVG) history.shift();
    HANDS.forEach(function (h) {
      out[h].norm = now[h].map(function (v, i) {
        if (v === null) return null;
        var s = 0, n = 0;
        history.forEach(function (r) { if (r[h][i] !== null) { s += r[h][i]; n++; } });
        return s / n;
      });
    });
    return out;
  }

  function validImu(imu) {
    if (imu === undefined) return true;
    if (!imu || typeof imu !== 'object') return false;
    return ['ax', 'ay', 'az', 'gx', 'gy', 'gz'].every(function (k) { return typeof imu[k] === 'number' && isFinite(imu[k]); });
  }

  function handleLine(text) {
    var line = text.replace(/\r$/, '');
    if (!line.trim()) return;
    st.lines++;
    var now = Date.now();
    st.stamps.push(now);
    while (st.stamps.length && now - st.stamps[0] > 1000) st.stamps.shift();
    var msg;
    try { msg = JSON.parse(line); } catch (e) {
      if (/^\{"type":"cfg"/.test(line)) { bad(line, 'setup on the glove is damaged: ' + e.message); setConfig(null, 'damaged'); return; }
      return bad(line, 'not JSON: ' + e.message);
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return bad(line, 'not a JSON object');
    if (msg.type === 'hello') {
      if (typeof msg.device !== 'string') return bad(line, 'hello without device');
      hello = msg;
      st.helloAt = now;
      logLine('in', line, true);
      emit('hello', msg);
      if (msg.hasCfg === true) send('cfg-get');
      else if (msg.hasCfg === false) setConfig(null, 'none');
      return;
    }
    if (msg.type === 'pong') {
      logLine('in', line, true);
      if (pingAt) { var rtt = now - pingAt; pingAt = 0; emit('pong', { rtt: rtt, t: msg.t }); }
      return;
    }
    if (msg.type === 'cfg') {
      logLine('in', line, true);
      if (msg.cfg === null) { cfgCal = 'none'; setConfig(null, 'none'); return; }
      var info = {};
      var v = validateConfig(msg.cfg, info);
      cfgCal = info.cal;
      if (v) setConfig(v, 'ok');
      else { st.lastBad = 'setup on the glove is damaged'; setConfig(null, 'damaged'); }
      return;
    }
    if (msg.type === 'cfg-ok' || msg.type === 'cfg-error') {
      logLine('in', line, msg.type === 'cfg-ok', msg.type === 'cfg-error' ? String(msg.why) : null);
      var p = pendingCfg;
      if (!p) return;
      pendingCfg = null;
      clearTimeout(p.timer);
      if (msg.type === 'cfg-ok') { cfgCal = p.next && p.next.cal ? 'same' : 'none'; setConfig(p.next, p.next ? 'ok' : 'none'); p.resolve(p.next); }
      else p.reject(new Error('The glove did not save the setup: ' + msg.why));
      return;
    }
    if (msg.type !== undefined) return bad(line, 'unknown type "' + msg.type + '"');
    if (Array.isArray(msg.f)) return bad(line, 'old firmware (5 fingers): flash sk_glove 2.0');
    var ch = msg.ch;
    if (!Array.isArray(ch) || ch.length !== CH || !ch.every(function (v) { return isInt(v, 0, 4095); })) {
      return bad(line, 'ch must be 16 integers 0-4095');
    }
    if (typeof msg.t !== 'number') return bad(line, 't must be a number');
    if (!validImu(msg.imu)) return bad(line, 'imu must have numbers ax ay az gx gy gz');
    logLine('in', line, true);
    st.data++;
    st.lastDataAt = now;
    ch.forEach(function (v, i) {
      if (st.min[i] === null || v < st.min[i]) st.min[i] = v;
      if (st.max[i] === null || v > st.max[i]) st.max[i] = v;
    });
    st.recent.push(ch.slice());
    if (st.recent.length > 30) st.recent.shift();
    latestData = { t: msg.t, ch: ch.slice(), hands: handsFrom(ch), imu: msg.imu || null, at: now };
    emit('data', latestData);
  }
  function bad(line, why) {
    st.bad++;
    st.lastBadAt = Date.now();
    st.lastBad = why;
    logLine('in', line, false, why);
  }

  function feed(chunk) {
    lineBuf += chunk;
    var i;
    while ((i = lineBuf.indexOf('\n')) >= 0) {
      var line = lineBuf.slice(0, i);
      lineBuf = lineBuf.slice(i + 1);
      try { handleLine(line); } catch (e) { bad(line, 'parser error: ' + e.message); }
    }
    if (lineBuf.length > 4096) { bad(lineBuf.slice(0, 200) + '…', 'line longer than 4096 characters'); lineBuf = ''; }
  }

  // ── setup on the glove: save / clear ──
  function cfgCommand(line, next) {
    return new Promise(function (resolve, reject) {
      if (state !== 'connected') { reject(new Error('The glove is not connected')); return; }
      if (pendingCfg) { reject(new Error('Another save is still waiting for the glove')); return; }
      pendingCfg = { resolve: resolve, reject: reject, next: next, timer: setTimeout(function () {
        pendingCfg = null;
        reject(new Error('No answer from the glove (2 s): check the cable and the firmware (sk_glove 2.0)'));
      }, CFG_TIMEOUT_MS) };
      if (!send(line)) { clearTimeout(pendingCfg.timer); pendingCfg = null; reject(new Error('Could not send to the glove')); }
    });
  }
  function saveConfig(c) {
    var v = validateConfig(c);
    if (!v) return Promise.reject(new Error('The setup is not complete or not valid'));
    var text = JSON.stringify(v);
    if (text.length > CFG_MAX) return Promise.reject(new Error('The setup is too long for the glove (' + text.length + ' characters)'));
    return cfgCommand('cfg-set ' + text, v);
  }
  function clearConfig() { return cfgCommand('cfg-clear', null); }
  function ready() { return status() === 'connected' && !!cfg && !!cfg.cal; }

  // ── Web Serial ──
  function resetLink() {
    lineBuf = '';
    hello = null;
    st.helloAt = 0;
    cfg = null;
    cfgState = 'unknown';
    cfgCal = 'none';
    history = [];
    if (pendingCfg) { clearTimeout(pendingCfg.timer); pendingCfg.reject(new Error('The glove disconnected')); pendingCfg = null; }
  }
  async function openPort(p) {
    setStatus(state === 'reconnecting' ? 'reconnecting' : 'connecting');
    try {
      await p.open({ baudRate: BAUD });
    } catch (e) {
      // already open (InvalidStateError) is fine; anything else is a real failure
      if (!(e && e.name === 'InvalidStateError')) throw e;
    }
    port = p;
    resetLink();
    var wasReconnect = state === 'reconnecting';
    setStatus('connected');
    if (wasReconnect) st.reconnects++;
    writer = p.writable ? p.writable.getWriter() : null;
    readLoop(p);
    send('hello');
  }

  async function readLoop(p) {
    var decoder = new TextDecoder();
    try {
      reader = p.readable.getReader();
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        feed(decoder.decode(r.value, { stream: true }));
      }
    } catch (e) {
      if (!userClosed) emit('error', 'Glove read stopped: ' + (e && e.message ? e.message : e));
    } finally {
      try { if (reader) reader.releaseLock(); } catch (e) { /* already released */ }
      reader = null;
    }
    if (port === p && !userClosed) lost();
  }

  function lost() {
    releaseWriter();
    var p = port;
    port = null;
    if (p) p.close().catch(function () { /* the device is gone */ });
    resetLink();
    latestData = null;
    setStatus('reconnecting');
    emit('config', { config: null, state: cfgState });
    scheduleRetry();
  }
  function releaseWriter() {
    try { if (writer) writer.releaseLock(); } catch (e) { /* already released */ }
    writer = null;
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retry, RETRY_MS);
  }
  async function retry() {
    if (userClosed || simOn || state !== 'reconnecting') return;
    try {
      var ports = await navigator.serial.getPorts();
      if (ports.length) { await openPort(ports[0]); return; }
    } catch (e) {
      emit('error', 'Reconnect failed: ' + (e && e.message ? e.message : e));
    }
    if (state === 'reconnecting') scheduleRetry();
  }

  async function connect() {
    userClosed = false;
    if (simOn) { startSim(); return true; }
    if (!serialAvailable()) { emit('error', 'Web Serial is not available in this browser or address'); return false; }
    try {
      var p = await navigator.serial.requestPort();
      await openPort(p);
      return true;
    } catch (e) {
      if (state === 'connecting') setStatus('disconnected');
      if (!(e && e.name === 'NotFoundError')) emit('error', 'Connect failed: ' + (e && e.message ? e.message : e));
      return false;   // NotFoundError: the picker was closed without choosing a port
    }
  }

  async function autoReconnect() {
    userClosed = false;
    if (simOn) { startSim(); return true; }
    if (!serialAvailable()) return false;
    try {
      var ports = await navigator.serial.getPorts();
      if (!ports.length) return false;
      await openPort(ports[0]);
      return true;
    } catch (e) {
      emit('error', 'Auto-connect failed: ' + (e && e.message ? e.message : e));
      setStatus('reconnecting');
      scheduleRetry();
      return false;
    }
  }

  async function disconnect() {
    userClosed = true;
    clearTimeout(retryTimer);
    stopSim();
    var p = port;
    port = null;
    try { if (reader) await reader.cancel(); } catch (e) { /* already closed */ }
    releaseWriter();
    if (p) { try { await p.close(); } catch (e) { /* already closed */ } }
    resetLink();
    latestData = null;
    setStatus('disconnected');
    emit('config', { config: null, state: cfgState });
  }

  function send(line) {
    var text = String(line).replace(/[\r\n]+/g, ' ');
    if (sim) { logLine('out', text, true); simCommand(text); return true; }
    if (!writer) { emit('error', 'Not connected: "' + text + '" not sent'); return false; }
    logLine('out', text, true);
    writer.write(new TextEncoder().encode(text + '\n')).catch(function (e) {
      emit('error', 'Send failed: ' + (e && e.message ? e.message : e));
    });
    return true;
  }
  function ping() { pingAt = Date.now(); return send('ping'); }

  if (typeof navigator !== 'undefined' && navigator.serial && navigator.serial.addEventListener) {
    navigator.serial.addEventListener('disconnect', function (e) {
      if (port && e.target === port && !userClosed) lost();
    });
    navigator.serial.addEventListener('connect', function (e) {
      if (userClosed) return;
      if (state === 'reconnecting') {
        retry();
      } else if (state === 'disconnected') {
        autoReconnect();
      }
    });
  }

  // ── Simulator: firmware 2.0's lines, produced here and fed through feed() ──
  // Wiring it pretends: MAP (C0-C4 = right thumb..pinky, C9-C5 = left thumb..pinky), C10-C15 unused
  // (low noise, except C10, which copies part of C9 as the owner's real mux does). A finger reads ~3300 straight and drops toward ~1300 bent, like the real divider.
  // Its "flash" is localStorage (sk_glove_sim_cfg), so a saved setup survives a page reload.
  function simLine(obj) { feed(JSON.stringify(obj) + '\n'); }
  function simCfgText() { try { return localStorage.getItem(SIM_CFG_KEY); } catch (e) { return null; } }
  function simHello() {
    simLine({ type: 'hello', device: 'sk-glove', fw: '2.0-sim', channels: CH, imu: true, i2c: '21/22', hasCfg: !!simCfgText() });
  }
  function simChannel(c, t) {
    if (c >= 10) return Math.round(20 + Math.random() * 30);
    var bend = simBend[c] !== undefined ? simBend[c] : (Math.sin(t / 900 + c * 0.9) + 1) / 2 * 0.05;   // idle: small wobble (~100)
    return Math.max(0, Math.min(4095, Math.round(3300 - bend * 2000 + (Math.random() - 0.5) * 30)));
  }
  function startSim() {
    stopSim();
    resetLink();
    setStatus('connected');
    sim = { n: 0, t0: Date.now() };
    simHello();
    sim.timer = setInterval(function () {
      if (!sim) return;
      sim.n++;
      var t = Date.now() - sim.t0;
      if (sim.n % SIM_BAD_EVERY === 0) { feed('{"t":' + t + ',"ch":[1200,3400\n'); return; }   // a cut-off line
      var ch = [];
      for (var c = 0; c < CH; c++) ch.push(simChannel(c, t));
      ch[10] = Math.round(ch[9] * 0.65);   // like the real mux: unconnected C10 copies part of C9 (read just before it)
      var s = t / 1000;
      simLine({ t: t, ch: ch, imu: { ax: +(Math.sin(s * 0.7) * 0.3).toFixed(2), ay: +(Math.cos(s * 0.5) * 0.2).toFixed(2),
        az: 0.95, gx: +(Math.sin(s) * 12).toFixed(2), gy: +(Math.cos(s * 1.3) * 8).toFixed(2), gz: +(Math.sin(s * 0.8) * 35).toFixed(2) } });
    }, SIM_MS);
  }
  function stopSim() {
    if (sim) clearInterval(sim.timer);
    sim = null;
  }
  function simCommand(text) {
    var cmd = text.trim();
    setTimeout(function () {
      if (!sim) return;
      if (cmd === 'hello') simHello();
      else if (cmd === 'ping') simLine({ type: 'pong', t: Date.now() - sim.t0 });
      else if (cmd === 'cfg-get') {
        var stored = simCfgText();
        feed('{"type":"cfg","cfg":' + (stored || 'null') + '}\n');   // verbatim, like the firmware
      } else if (cmd.indexOf('cfg-set ') === 0) {
        var json = cmd.slice(8);
        if (json.length > CFG_MAX) { simLine({ type: 'cfg-error', why: 'too long' }); return; }
        try { localStorage.setItem(SIM_CFG_KEY, json); } catch (e) { simLine({ type: 'cfg-error', why: 'flash write failed' }); return; }
        simLine({ type: 'cfg-ok' });
      } else if (cmd === 'cfg-clear') {
        try { localStorage.removeItem(SIM_CFG_KEY); } catch (e) { /* nothing stored */ }
        simLine({ type: 'cfg-ok' });
      }
    }, 4);
  }
  // Switch the source for this page only (not stored); a running connection is closed first.
  async function simulator(onOff) {
    onOff = !!onOff;
    if (onOff === simOn) return;
    await disconnect();
    simOn = onOff;
    emit('status', status());
  }
  // Simulator only: hold channel c at a bend (0 straight .. 1 bent); null releases it.
  function simSetBend(c, bend) {
    if (bend === null || bend === undefined) delete simBend[c];
    else simBend[c] = Math.max(0, Math.min(1, Number(bend)));
  }

  function stats() {
    var now = Date.now();
    while (st.stamps.length && now - st.stamps[0] > 1000) st.stamps.shift();
    return {
      linesPerSec: st.stamps.length, lines: st.lines, bad: st.bad, data: st.data,
      lastDataAgeMs: st.lastDataAt ? now - st.lastDataAt : null,
      sinceHelloMs: st.helloAt ? now - st.helloAt : null,
      connectedMs: state === 'connected' && st.connectedAt ? now - st.connectedAt : null,
      reconnects: st.reconnects, lastBadAgeMs: st.lastBadAt ? now - st.lastBadAt : null, lastBad: st.lastBad,
      min: st.min.slice(), max: st.max.slice(), recent: st.recent.slice()
    };
  }
  function resetMinMax() { st.min = nulls(CH); st.max = nulls(CH); }
  function log() { return logLines.slice(); }

  window.SKGlove = {
    CHANNELS: CH,
    FINGERS: FINGERS.slice(),
    HANDS: HANDS.slice(),
    MAP: { R: MAP.R.slice(), L: MAP.L.slice() },
    DEFAULT_MIRROR: DEFAULT_MIRROR,
    DEFAULT_W: DEFAULT_W,
    MINSPAN: MINSPAN,
    isSupported: isSupported,
    status: status,
    connect: connect,
    autoReconnect: autoReconnect,
    disconnect: disconnect,
    send: send,
    ping: ping,
    on: on,
    latest: function () { return latestData; },
    info: function () { return hello; },
    config: function () { return cfg; },
    configState: function () { return cfgState; },
    calibrationFrom: function () { return cfgCal; },
    validateConfig: validateConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    ready: ready,
    stats: stats,
    resetMinMax: resetMinMax,
    log: log,
    simulator: simulator,
    isSimulator: function () { return simOn; },
    simSetBend: simSetBend,
    _feed: feed   // tests: push protocol text through the parser
  };
})();
