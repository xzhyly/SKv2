// js/glove.js
// The optional wired data glove (glove-serial phase, docs/system/GLOVE.md): an ESP32 with 5 flex
// sensors (+ optional MPU6050) on USB serial, 115200 baud, one JSON object per line. Web Serial only,
// no libraries. Attaches window.SKGlove. A simulator source produces the same protocol lines through
// the same parser, so the whole path runs without hardware. Recognition does not use the glove yet.
(function () {
  'use strict';

  var BAUD = 115200;
  var RETRY_MS = 3000;          // unplugged: getPorts() retried this often
  var AVG = 3;                  // moving average over the last 3 readings
  var LOG_MAX = 2000;           // lines kept for Download log
  var MINSPAN = 50;             // calibration open/fist closer than this -> finger reads 0
  var SIM_MS = 33;              // simulator: ~30 lines/s
  var SIM_BAD_EVERY = 150;      // simulator: one bad line about every 5 s
  var CAL_KEY = 'sk_glove_calibration';
  var SIM_KEY = 'sk_glove_sim';
  var FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

  var listeners = { status: [], data: [], hello: [], raw: [], error: [], pong: [] };
  var state = 'disconnected';
  var port = null, reader = null, writer = null;
  var userClosed = false, retryTimer = null;
  var hello = null, latestData = null;
  var history = [];             // last AVG normalized readings
  var lineBuf = '';
  var pingAt = 0;
  var sim = null;               // { timer, n, t0 } while the simulator runs
  var simOn = readSimSetting();
  var st = freshStats();

  function freshStats() {
    return { lines: 0, bad: 0, data: 0, lastDataAt: 0, helloAt: 0, connectedAt: 0, reconnects: 0,
      lastBadAt: 0, lastBad: null, stamps: [], min: [null, null, null, null, null], max: [null, null, null, null, null],
      recent: [] };   // recent: last 30 raw finger arrays (debugger hints)
  }

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

  // ── storage (per kiosk, never fatal) ──
  function readSimSetting() {
    try {
      if (/(?:^|[?&])glove=sim(?:&|$)/.test(location.search)) return true;
      return localStorage.getItem(SIM_KEY) === '1';
    } catch (e) { return false; }
  }
  var calibration = {
    get: function () {
      try {
        var c = JSON.parse(localStorage.getItem(CAL_KEY) || 'null');
        if (c && Array.isArray(c.open) && Array.isArray(c.fist) && c.open.length === 5 && c.fist.length === 5) return c;
      } catch (e) { /* no storage or bad value */ }
      return null;
    },
    set: function (c) {
      var v = { open: c.open.map(Number), fist: c.fist.map(Number), at: c.at || new Date().toISOString() };
      try { localStorage.setItem(CAL_KEY, JSON.stringify(v)); } catch (e) { emit('error', 'Calibration not saved: storage blocked'); return false; }
      history = [];
      return true;
    },
    reset: function () {
      try { localStorage.removeItem(CAL_KEY); } catch (e) { /* nothing stored */ }
      history = [];
    }
  };

  // ── parsing (one line) ──
  var logLines = [];
  function logLine(dir, line, ok, error) {
    var entry = { at: Date.now(), dir: dir, line: line, ok: ok, error: error || null };
    logLines.push(entry);
    if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
    emit('raw', entry);
  }

  function normalize(raw) {
    var cal = calibration.get();
    var n = raw.map(function (v, i) {
      if (!cal) return v / 4095;
      var span = cal.fist[i] - cal.open[i];
      if (Math.abs(span) < MINSPAN) return 0;
      var x = (v - cal.open[i]) / span;
      return x < 0 ? 0 : x > 1 ? 1 : x;
    });
    history.push(n);
    if (history.length > AVG) history.shift();
    return n.map(function (_, i) {
      var s = 0;
      history.forEach(function (h) { s += h[i]; });
      return s / history.length;
    });
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
    try { msg = JSON.parse(line); } catch (e) { return bad(line, 'not JSON: ' + e.message); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return bad(line, 'not a JSON object');
    if (msg.type === 'hello') {
      if (typeof msg.device !== 'string') return bad(line, 'hello without device');
      hello = msg;
      st.helloAt = now;
      logLine('in', line, true);
      emit('hello', msg);
      return;
    }
    if (msg.type === 'pong') {
      logLine('in', line, true);
      if (pingAt) { var rtt = now - pingAt; pingAt = 0; emit('pong', { rtt: rtt, t: msg.t }); }
      return;
    }
    if (msg.type !== undefined) return bad(line, 'unknown type "' + msg.type + '"');
    var f = msg.f;
    if (!Array.isArray(f) || f.length !== 5 || !f.every(function (v) { return typeof v === 'number' && v >= 0 && v <= 4095 && Math.floor(v) === v; })) {
      return bad(line, 'f must be 5 integers 0-4095');
    }
    if (typeof msg.t !== 'number') return bad(line, 't must be a number');
    if (!validImu(msg.imu)) return bad(line, 'imu must have numbers ax ay az gx gy gz');
    logLine('in', line, true);
    st.data++;
    st.lastDataAt = now;
    f.forEach(function (v, i) {
      if (st.min[i] === null || v < st.min[i]) st.min[i] = v;
      if (st.max[i] === null || v > st.max[i]) st.max[i] = v;
    });
    st.recent.push(f.slice());
    if (st.recent.length > 30) st.recent.shift();
    latestData = { t: msg.t, raw: f.slice(), norm: normalize(f), imu: msg.imu || null, at: now };
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

  // ── Web Serial ──
  async function openPort(p) {
    setStatus(state === 'reconnecting' ? 'reconnecting' : 'connecting');
    try {
      await p.open({ baudRate: BAUD });
    } catch (e) {
      // already open (InvalidStateError) is fine; anything else is a real failure
      if (!(e && e.name === 'InvalidStateError')) throw e;
    }
    port = p;
    lineBuf = '';
    hello = null;
    st.helloAt = 0;
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
    setStatus('reconnecting');
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
    hello = null;
    latestData = null;
    history = [];
    setStatus('disconnected');
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
    navigator.serial.addEventListener('connect', function () {
      if (state === 'reconnecting' && !userClosed) retry();
    });
  }

  // ── Simulator: the firmware's lines, produced here and fed through feed() ──
  function simLine(obj) { feed(JSON.stringify(obj) + '\n'); }
  function simHello() { simLine({ type: 'hello', device: 'sk-glove', fw: '1.0-sim', fingers: 5, imu: true }); }
  function startSim() {
    stopSim();
    lineBuf = '';
    hello = null;
    st.helloAt = 0;
    setStatus('connected');
    sim = { n: 0, t0: Date.now() };
    simHello();
    sim.timer = setInterval(function () {
      if (!sim) return;
      sim.n++;
      var t = Date.now() - sim.t0;
      if (sim.n % SIM_BAD_EVERY === 0) { feed('{"t":' + t + ',"f":[1200,3400\n'); return; }   // a cut-off line
      var f = FINGERS.map(function (_, i) {
        var bend = (Math.sin(t / 900 + i * 0.9) + 1) / 2;            // 0..1, each finger out of phase
        return Math.round(1000 + bend * 2400 + (Math.random() - 0.5) * 40);
      });
      var s = t / 1000;
      simLine({ t: t, f: f, imu: { ax: +(Math.sin(s * 0.7) * 0.3).toFixed(2), ay: +(Math.cos(s * 0.5) * 0.2).toFixed(2),
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
    }, 4);
  }
  // Switch the source. Stored per kiosk; a running connection is closed first.
  async function simulator(onOff) {
    onOff = !!onOff;
    try { localStorage.setItem(SIM_KEY, onOff ? '1' : '0'); } catch (e) { /* not stored */ }
    if (onOff === simOn) return;
    await disconnect();
    simOn = onOff;
    emit('status', status());
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
  function resetMinMax() { st.min = [null, null, null, null, null]; st.max = [null, null, null, null, null]; }
  function log() { return logLines.slice(); }

  window.SKGlove = {
    FINGERS: FINGERS.slice(),
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
    calibration: calibration,
    stats: stats,
    resetMinMax: resetMinMax,
    log: log,
    simulator: simulator,
    isSimulator: function () { return simOn; },
    _feed: feed   // tests: push protocol text through the parser
  };
})();
