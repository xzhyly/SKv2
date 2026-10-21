# Glove hardware bring-up (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the group's real gloves (10 flex sensors on a 16-channel mux, one ESP32, optional MPU6050) work end to end on the laptop: firmware 2.0, protocol v2, `window.SKGlove` with the setup stored on the glove, and Settings -> Glove with two hands and a Set up glove wizard.

**Architecture:** The ESP32 sends the raw value of all 16 mux channels and stores an opaque setup string in flash (`cfg-get` / `cfg-set` / `cfg-clear`). `js/glove.js` parses protocol v2, validates the setup, and turns channels into left/right finger values. `settings.html` shows both hands and runs the wizard that discovers the wiring (fingers -> channels), calibrates, records the camera's handedness and the IMU hand, and saves it on the glove. Recognition is untouched (Phase 2).

**Tech Stack:** Arduino (ESP32 core: Wire, Preferences), vanilla JS (Web Serial), HTML/CSS, node 22 checks (vm + the repo's CDP driver), PHP built-in server for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-21-glove-hardware-design.md` (Phase 1 only).

## Global Constraints

- Offline only: no fetch to the internet, no CDN, no external API (CLAUDE.md hard rule).
- No build step, no npm, no bundler, no framework: vanilla JS/DOM only.
- Raspberry Pi 4B is the target: CPU only; bars redraw at most once per animation frame.
- Kiosk screen 1024x600: no page scroll, every control >= 44 px, no modals.
- PHP never touches the live glove path; nothing in this phase talks to the server.
- Pins exactly as the diagram: S0 GPIO 14, S1 GPIO 27, S2 GPIO 26, S3 GPIO 25, SIG GPIO 34, MPU6050 SDA 21 / SCL 22 (swap tried).
- Serial: 115200 baud, one JSON object per line, ~30 data lines/s, `ch` = 16 integers 0-4095.
- Setup stored on the glove, at most 1,000 characters; `w` default 0.3.
- Battery not used: USB power only; docs tell the owner to keep SW1 OFF while USB is plugged in.
- Reports go to `docs/reports/` with the header block (CLAUDE.md "Reports go to files, not chat"); every number measured, never estimated.
- Commits end with the session's attribution lines (Co-Authored-By / Claude-Session) and go on branch `glove-hw`.

## File map

| File | Responsibility |
|---|---|
| `js/glove.js` (rewrite) | protocol v2 parser, setup validate/save/clear, two-hand values, simulator v2 |
| `tests/glove/glove-core-check.mjs` (new) | node vm checks of `js/glove.js`, no browser |
| `tools/glove-firmware/sk_glove/sk_glove.ino` (rewrite) | firmware 2.0: mux, 16 channels, IMU with pin swap, setup in flash |
| `tools/glove-firmware/README.md` (rewrite) | wiring = the diagram, Windows driver, first upload, two checks |
| `settings.html` (rewrite) | two hands, Set up glove wizard, 16-channel debug, stored setup |
| `tests/glove/settings-check.mjs` (rewrite) | headless Chrome check of Settings with the simulator |
| `tests/glove/no-db-router.php` (new) | lets the browser check run on a machine without MySQL |
| `docs/system/GLOVE.md` (rewrite) | protocol v2, the setup, the API, the wizard, hints |
| `docs/system/UI.md` Part 5, `docs/system/PI-SETUP.md` glove lines | docs |
| `docs/reports/2026-10-21-glove-hw-final.md` (+ `docs/reports/img/glove-hw-*.png`) | phase report |

## Test environment (used by Tasks 1 and 3)

- node: `node --version` must print v22 or later.
- Browser check on the laptop: XAMPP running, `SK_BASE` unset (default `http://localhost/SKR/`), Chrome at the default path.
- Browser check without MySQL (cloud container): from a folder `W` whose `W/SKR` is the repo (symlink or copy):
  ```bash
  cd W && php -S 127.0.0.1:8080 SKR/tests/glove/no-db-router.php &
  cd W/SKR && SK_BASE=http://127.0.0.1:8080/SKR/ SK_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
    SK_CHROME_ARGS="--no-sandbox" node tests/glove/settings-check.mjs --shots /tmp/glove-shots
  ```

---

### Task 1: `js/glove.js` protocol v2 + the setup on the glove

**Files:**
- Test: `tests/glove/glove-core-check.mjs` (create)
- Modify (full rewrite): `js/glove.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 3 and Phase 2): `window.SKGlove` with `CHANNELS` (16), `FINGERS`, `HANDS` (`['L','R']`), `DEFAULT_W` (0.3), `status()`, `connect()`, `autoReconnect()`, `disconnect()`, `send(line)`, `ping()`, `on(event, cb)` (events `status|data|hello|config|raw|error|pong`), `latest()` -> `{ t, ch: number[16], hands: { L: { raw: (number|null)[5], norm: (number|null)[5] }, R: same } | null, imu, at }`, `info()`, `config()`, `configState()` -> `'unknown'|'none'|'ok'|'damaged'`, `validateConfig(c)` -> clean copy or null, `saveConfig(c)` -> Promise, `clearConfig()` -> Promise, `ready()` -> boolean, `stats()` (min/max arrays of 16), `resetMinMax()`, `log()`, `simulator(on)`, `isSimulator()`, `simSetBend(ch, bend|null)`, `_feed(text)`.

- [ ] **Step 1: Write the failing test** — create `tests/glove/glove-core-check.mjs`:

```js
// glove-hw phase: js/glove.js (protocol v2, docs/system/GLOVE.md) run in node's vm with a stub
// window - no browser, no server. Parser, the 16 channels, the setup (validate / damaged / hands /
// normalization), and the simulator's setup round trip (cfg-set, reconnect, cfg-get).
// Run: node tests/glove/glove-core-check.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/glove.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}

// A fresh js/glove.js with its own localStorage. search: the page's location.search.
function load(search = '') {
  const store = new Map();
  const ctx = {
    console, JSON, Math, Date, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder, isFinite,
    location: { search },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { G: ctx.SKGlove, store };
}
const CH16 = (v) => Array.from({ length: 16 }, (_, i) => (typeof v === 'function' ? v(i) : v));
const dataLine = (ch, extra = '') => `{"t":1000,"ch":${J(ch)}${extra}}\n`;
const CFG = {
  v: 1,
  map: { L: [5, 6, 7, 8, 9], R: [0, 1, 2, 3, 4] },
  cal: { L: { open: [3300, 3300, 3300, 3300, 3300], fist: [1300, 1300, 1300, 1300, 1300] },
         R: { open: [3300, 3300, 3300, 3300, 3300], fist: [1300, 1300, 1300, 1300, 1300] }, at: '2026-10-21T12:00:00.000Z' },
  cam: { mirror: true },
  imuHand: 'R',
  w: 0.3,
};

// 1. hello v2
{
  const { G } = load();
  G._feed('{"type":"hello","device":"sk-glove","fw":"2.0","channels":16,"imu":true,"i2c":"21/22","hasCfg":false}\n');
  check('hello v2 parsed; hasCfg false -> setup state "none"', G.info().channels === 16 && G.configState() === 'none' && G.config() === null,
    J({ info: G.info(), state: G.configState() }));
}

// 2. data lines: 16 channels, no setup -> no hands
{
  const { G } = load();
  G._feed(dataLine(CH16((i) => 100 * i)));
  const d = G.latest();
  check('data: 16 channels kept, hands null without a setup', d && d.ch.length === 16 && d.ch[15] === 1500 && d.hands === null, J(d));
  G._feed(dataLine(CH16(5), ',"imu":{"ax":0.1,"ay":0,"az":1,"gx":0,"gy":0,"gz":3}'));
  check('data with imu', G.latest().imu && G.latest().imu.gz === 3);
  const s = G.stats();
  check('min/max per channel (16)', s.min.length === 16 && s.min[15] === 5 && s.max[15] === 1500, J({ min: s.min, max: s.max }));
}

// 3. bad lines never throw, are counted, carry a reason
{
  const { G } = load();
  const cases = [
    ['{"t":1,"ch":[1,2,3]}', /ch must be 16 integers/],
    [`{"t":1,"ch":${J(CH16(4096))}}`, /ch must be 16 integers/],
    ['{"t":1,"f":[1,2,3,4,5]}', /old firmware \(5 fingers\)/],
    ['this is not json', /^not JSON/],
    [`{"ch":${J(CH16(1))}}`, /t must be a number/],
    ['{"type":"weird"}', /unknown type/],
  ];
  cases.forEach(([line]) => G._feed(line + '\n'));
  const bads = G.log().filter((e) => !e.ok).map((e) => e.error);
  check('bad lines: counted with the right reasons', G.stats().bad === cases.length && cases.every(([, re], i) => re.test(bads[i])), J(bads));
}

// 4. a valid setup from the glove -> hands, normalization, moving average
{
  const { G } = load();
  G._feed(`{"type":"cfg","cfg":${J(CFG)}}\n`);
  check('cfg line: setup state "ok", config kept', G.configState() === 'ok' && J(G.config().map) === J(CFG.map) && G.config().w === 0.3);
  G._feed(dataLine(CH16((i) => (i === 0 ? 2300 : i === 9 ? 1300 : 3300))));
  const h = G.latest().hands;
  check('hands: R thumb = C0 (raw 2300 -> 0.50), L pinky = C9 (fist -> 1), others open (0)',
    h.R.raw[0] === 2300 && Math.abs(h.R.norm[0] - 0.5) < 1e-9 && h.L.norm[4] === 1 && h.R.norm[1] === 0, J(h));
  G._feed(dataLine(CH16(1300)));
  G._feed(dataLine(CH16(1300)));
  const avg = G.latest().hands.R.norm[0];
  check('moving average of 3 readings', Math.abs(avg - (0.5 + 1 + 1) / 3) < 1e-9, String(avg));
  G._feed(dataLine(CH16(5000).map(() => 4095)));
  check('values beyond the calibration clamp to 0..1', G.latest().hands.R.norm.every((v) => v >= 0 && v <= 1));
}

// 5. a finger with no channel, a finger with open ~ fist -> null
{
  const { G } = load();
  const c = JSON.parse(J(CFG));
  c.map.R[2] = null;
  c.cal.L.fist[1] = 3280;   // 20 apart: < 50
  G._feed(`{"type":"cfg","cfg":${J(c)}}\n`);
  G._feed(dataLine(CH16(2000)));
  const h = G.latest().hands;
  check('no channel -> raw/norm null; open ~ fist -> norm null', h.R.raw[2] === null && h.R.norm[2] === null && h.L.norm[1] === null && h.L.norm[0] !== null, J(h));
}

// 6. damaged setups
{
  const a = load();
  a.G._feed('{"type":"cfg","cfg":{"v":1,"map":{"L":[5,6\n');
  check('cfg line cut off (bad flash) -> "damaged", counted as a bad line', a.G.configState() === 'damaged' && a.G.stats().bad === 1, a.G.configState());
  const b = load();
  b.G._feed('{"type":"cfg","cfg":{"v":1,"map":{"L":[1,2,3,4],"R":[0,1,2,3,4]}}}\n');
  check('cfg with a wrong map -> "damaged"', b.G.configState() === 'damaged' && b.G.config() === null);
  const c = load();
  c.G._feed('{"type":"cfg","cfg":null}\n');
  check('cfg null -> "none"', c.G.configState() === 'none');
}

// 7. validateConfig
{
  const { G } = load();
  const v = G.validateConfig({ v: 1, map: CFG.map, extra: 1 });
  check('validateConfig: minimal setup ok, unknown keys dropped, w defaults to 0.3, cal/cam/imuHand null',
    v && !('extra' in v) && v.w === 0.3 && v.cal === null && v.cam === null && v.imuHand === null, J(v));
  const bad = [
    { ...CFG, v: 2 },
    { ...CFG, map: { L: [16, 1, 2, 3, 4], R: CFG.map.R } },
    { ...CFG, w: 1.5 },
    { ...CFG, imuHand: 'X' },
    { ...CFG, cam: { mirror: 'yes' } },
    { ...CFG, cal: { L: CFG.cal.L, R: CFG.cal.R } },   // no "at"
  ];
  check('validateConfig rejects: version, channel 16, w > 1, imuHand, cam.mirror, cal without at',
    bad.every((x) => G.validateConfig(x) === null), J(bad.map((x) => G.validateConfig(x) !== null)));
}

// 8. simulator: setup round trip through its "flash", forced bends, ready()
{
  const { G, store } = load('?glove=sim');
  check('simulator on from ?glove=sim', G.isSimulator());
  await G.connect();
  await sleep(150);
  check('simulator: hello 2.0-sim, 16 channels, no setup yet', G.info().fw === '2.0-sim' && G.configState() === 'none' && G.latest().ch.length === 16,
    J({ info: G.info(), state: G.configState() }));
  check('ready() false without a setup', G.ready() === false);
  const saved = await G.saveConfig(CFG);
  check('saveConfig -> cfg-ok -> config() and ready()', J(saved.map) === J(CFG.map) && G.configState() === 'ok' && G.ready() === true);
  check('stored in the simulator flash, verbatim JSON', JSON.parse(store.get('sk_glove_sim_cfg')).imuHand === 'R');
  await G.disconnect();
  check('disconnect: config cleared, ready() false', G.config() === null && G.ready() === false && G.status() === 'disconnected');
  await G.connect();
  await sleep(150);
  check('reconnect: hello hasCfg -> cfg-get -> the same setup back', G.configState() === 'ok' && J(G.config()) === J(G.validateConfig(CFG)),
    J({ state: G.configState(), cfg: G.config() }));
  G.simSetBend(3, 1);
  await sleep(150);
  const ch3 = G.latest().ch[3];
  check('simSetBend(3, 1): channel 3 reads ~1300 (bent)', ch3 > 1200 && ch3 < 1400, String(ch3));
  check('unused channels C10-C15 read low noise', G.latest().ch.slice(10).every((v) => v < 100), J(G.latest().ch));
  await G.clearConfig();
  check('clearConfig -> "none", flash empty', G.configState() === 'none' && !store.has('sk_glove_sim_cfg'));
  let rejected = null;
  await G.saveConfig({ v: 1 }).catch((e) => { rejected = e.message; });
  check('saveConfig rejects an incomplete setup', /not complete/.test(rejected || ''), rejected);
  await G.disconnect();
  rejected = null;
  await G.saveConfig(CFG).catch((e) => { rejected = e.message; });
  check('saveConfig while disconnected rejects', /not connected/.test(rejected || ''), rejected);
}

console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it against the old module to see it fail**

Run: `node tests/glove/glove-core-check.mjs`
Expected: FAIL lines (e.g. `FAIL hello v2 parsed…`, `TypeError … validateConfig is not a function`), exit code 1.

- [ ] **Step 3: Replace `js/glove.js` with the v2 module**

```js
// js/glove.js
// The optional wired data gloves (glove-serial phase 2026-10-20, protocol v2 glove-hw phase 2026-10-21,
// docs/system/GLOVE.md): two gloves, 10 flex sensors on a 16-channel mux, one ESP32, optional MPU6050,
// USB serial 115200 baud, one JSON object per line. Web Serial only, no libraries. Attaches
// window.SKGlove. The glove sends the raw value of all 16 channels; which channel is which finger
// (the "map"), the open/fist calibration, the camera's handedness and the IMU's hand are the glove's
// setup, stored ON THE GLOVE (cfg-get / cfg-set), so a glove set up on the laptop works on the Pi.
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
  var SIM_KEY = 'sk_glove_sim';
  var SIM_CFG_KEY = 'sk_glove_sim_cfg';   // the simulator's "flash"
  var FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  var HANDS = ['L', 'R'];

  var listeners = { status: [], data: [], hello: [], raw: [], error: [], pong: [], config: [] };
  var state = 'disconnected';
  var port = null, reader = null, writer = null;
  var userClosed = false, retryTimer = null;
  var hello = null, latestData = null;
  var cfg = null;               // validated setup from the glove, or null
  var cfgState = 'unknown';     // 'unknown' (no answer yet) | 'none' | 'ok' | 'damaged'
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

  function readSimSetting() {
    try {
      if (/(?:^|[?&])glove=sim(?:&|$)/.test(location.search)) return true;
      return localStorage.getItem(SIM_KEY) === '1';
    } catch (e) { return false; }
  }

  // ── the setup (docs/system/GLOVE.md "The setup") ──
  function isInt(v, lo, hi) { return typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi; }
  function five(a, check) { return Array.isArray(a) && a.length === 5 && a.every(check); }
  // Returns a clean copy of a valid setup, or null. Unknown keys are dropped.
  function validateConfig(c) {
    if (!c || typeof c !== 'object' || c.v !== 1) return null;
    var m = c.map;
    var chOrNull = function (v) { return v === null || isInt(v, 0, CH - 1); };
    if (!m || !five(m.L, chOrNull) || !five(m.R, chOrNull)) return null;
    var out = { v: 1, map: { L: m.L.slice(), R: m.R.slice() }, cal: null, cam: null, imuHand: null, w: DEFAULT_W };
    if (c.cal != null) {
      var adc = function (v) { return isInt(v, 0, 4095); };
      var hand = function (h) { return h && five(h.open, adc) && five(h.fist, adc); };
      if (!hand(c.cal.L) || !hand(c.cal.R) || typeof c.cal.at !== 'string') return null;
      out.cal = { L: { open: c.cal.L.open.slice(), fist: c.cal.L.fist.slice() },
        R: { open: c.cal.R.open.slice(), fist: c.cal.R.fist.slice() }, at: c.cal.at };
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

  // { L: { raw: [5], norm: [5] }, R: {...} } from the 16 channels, or null without a map.
  // raw / norm are null for a finger with no channel; norm is null for a finger whose open and fist
  // are closer than MINSPAN. Without a calibration norm = raw / 4095. Moving average of AVG readings.
  function handsFrom(ch) {
    if (!cfg) return null;
    var now = {};
    var out = {};
    HANDS.forEach(function (h) {
      var cal = cfg.cal ? cfg.cal[h] : null;
      var raw = cfg.map[h].map(function (c) { return c === null ? null : ch[c]; });
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
      if (msg.cfg === null) { setConfig(null, 'none'); return; }
      var v = validateConfig(msg.cfg);
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
      if (msg.type === 'cfg-ok') { setConfig(p.next, p.next ? 'ok' : 'none'); p.resolve(p.next); }
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
    navigator.serial.addEventListener('connect', function () {
      if (state === 'reconnecting' && !userClosed) retry();
    });
  }

  // ── Simulator: firmware 2.0's lines, produced here and fed through feed() ──
  // Wiring it pretends: C0-C4 = right thumb..pinky, C5-C9 = left thumb..pinky, C10-C15 unused
  // (low noise). A finger reads ~3300 straight and drops toward ~1300 bent, like the real divider.
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
  // Switch the source. Stored per kiosk; a running connection is closed first.
  async function simulator(onOff) {
    onOff = !!onOff;
    try { localStorage.setItem(SIM_KEY, onOff ? '1' : '0'); } catch (e) { /* not stored */ }
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
    DEFAULT_W: DEFAULT_W,
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
```

- [ ] **Step 4: Run the test**

Run: `node tests/glove/glove-core-check.mjs`
Expected: 27 `PASS` lines, then `ALL CHECKS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/glove.js tests/glove/glove-core-check.mjs
git commit -m "glove: protocol v2 (16 mux channels), setup stored on the glove, two hands, simulator v2"
```

---

### Task 2: Firmware 2.0 and its README

**Files:**
- Modify (full rewrite): `tools/glove-firmware/sk_glove/sk_glove.ino`
- Modify (full rewrite): `tools/glove-firmware/README.md`

**Interfaces:**
- Consumes: protocol v2 as `js/glove.js` (Task 1) parses it: hello with `channels`, `imu`, `i2c`, `hasCfg`; data `{"t","ch":[16],"imu"?}`; answers `pong`, `cfg`, `cfg-ok`, `cfg-error`.
- Produces: the glove's serial behaviour the owner checks with the Serial Monitor.

- [ ] **Step 1: Replace `tools/glove-firmware/sk_glove/sk_glove.ino`**

```cpp
// sk_glove.ino — Sining Kamay data gloves, firmware 2.0 (glove-hw phase, 2026-10-21).
// Protocol: docs/system/GLOVE.md (v2). USB serial 115200 baud, one JSON object per line, ~30 lines/s.
// Hardware: the owner's circuit diagram (docs/superpowers/specs/2026-10-21-glove-hardware-design.md):
//
//   Two gloves, 10 flex sensors FS1-FS10 -> CD74HC4067 16-channel mux C0-C9, one ESP32 dev board.
//   Mux:  S0 -> GPIO 14   S1 -> GPIO 27   S2 -> GPIO 26   S3 -> GPIO 25   SIG -> GPIO 34
//         EN -> GND (always on)   VCC -> 3V3 (0.1 uF to GND)   GND -> GND
//   Each sensor:  3V3 --[ flex sensor ]--+--[ R ]-- GND
//                                        +-- mux C-pin
//   (bending raises the sensor's resistance, so its reading DROPS when the finger bends)
//   MPU6050 (GY-521, optional): VCC 3V3, GND, SDA GPIO 21, SCL GPIO 22 (tried swapped if nothing answers).
//   Power: USB only. The diagram's 18650 + TP4056 + SW1 are not used: keep SW1 OFF while USB is plugged in.
//
// This firmware sends the RAW value of all 16 mux channels. It never decides which channel is which
// finger: the kiosk's Settings -> Glove -> Set up glove finds that, and saves it here (flash) with
// cfg-set, so the same glove works on the laptop and on the Pi with no new setup.
//
// Board: "ESP32 Dev Module" (Arduino core for ESP32 by Espressif). Libraries: none beyond the core
// (Wire and Preferences are built in).

#include <Wire.h>
#include <Preferences.h>

static const char *FW = "2.0";
static const int MUX_S[4] = {14, 27, 26, 25};   // S0, S1, S2, S3
static const int MUX_SIG = 34;                  // ADC1_CH6, input only
static const int CHANNELS = 16;
static const uint32_t PERIOD_MS = 33;           // ~30 lines per second
static const uint8_t MPU_ADDR = 0x68;
static const size_t CFG_MAX = 1000;             // longest setup the page may store (characters)
static const size_t CMD_MAX = CFG_MAX + 16;     // "cfg-set " + the setup

static Preferences prefs;
static bool imuPresent = false;
static int sdaPin = 21, sclPin = 22;
static uint32_t nextAt = 0;
static char cmd[CMD_MAX + 1];
static size_t cmdLen = 0;
static bool cmdOverflow = false;

// ── mux ──
static int readChannel(int ch) {
  for (int b = 0; b < 4; b++) digitalWrite(MUX_S[b], (ch >> b) & 1);
  delayMicroseconds(10);          // mux + divider settle
  analogRead(MUX_SIG);            // first conversion after a switch is discarded
  return analogRead(MUX_SIG);
}

// ── MPU6050 (plain Wire, no library) ──
static bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}
static bool mpuDetect() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);                              // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 1) != 1) return false;
  uint8_t who = Wire.read();
  if (who != 0x68 && who != 0x70 && who != 0x72) return false;   // MPU6050 and common clones
  return mpuWrite(0x6B, 0x00)                    // wake up
      && mpuWrite(0x1B, 0x00)                    // gyro +-250 deg/s -> 131 LSB per deg/s
      && mpuWrite(0x1C, 0x00);                   // accel +-2 g     -> 16384 LSB per g
}
static bool mpuStart(int sda, int scl) {
  Wire.end();
  Wire.begin(sda, scl);
  Wire.setClock(400000);
  if (!mpuDetect()) return false;
  sdaPin = sda;
  sclPin = scl;
  return true;
}
static bool mpuRead(float *a, float *g) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                              // ACCEL_XOUT_H .. GYRO_ZOUT_L, 14 bytes
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) v[i] = (int16_t)((Wire.read() << 8) | Wire.read());
  for (int i = 0; i < 3; i++) a[i] = v[i] / 16384.0f;
  for (int i = 0; i < 3; i++) g[i] = v[i + 4] / 131.0f;   // v[3] is the temperature
  return true;
}

// ── setup storage (flash) ──
static bool hasCfg() { return prefs.isKey("cfg") && prefs.getString("cfg", "").length() > 0; }

static void sendHello() {
  Serial.print("{\"type\":\"hello\",\"device\":\"sk-glove\",\"fw\":\"");
  Serial.print(FW);
  Serial.print("\",\"channels\":16,\"imu\":");
  Serial.print(imuPresent ? "true" : "false");
  Serial.print(",\"i2c\":\"");
  Serial.print(sdaPin);
  Serial.print('/');
  Serial.print(sclPin);
  Serial.print("\",\"hasCfg\":");
  Serial.print(hasCfg() ? "true" : "false");
  Serial.print("}\n");
}
static void sendCfg() {
  Serial.print("{\"type\":\"cfg\",\"cfg\":");
  if (hasCfg()) Serial.print(prefs.getString("cfg", "null"));
  else Serial.print("null");
  Serial.print("}\n");
}
static void cfgError(const char *why) {
  Serial.print("{\"type\":\"cfg-error\",\"why\":\"");
  Serial.print(why);
  Serial.print("\"}\n");
}
static void cfgSet(const char *json) {
  size_t n = strlen(json);
  if (n == 0) { cfgError("empty"); return; }
  if (n > CFG_MAX) { cfgError("too long"); return; }
  if (json[0] != '{' || json[n - 1] != '}') { cfgError("not a JSON object"); return; }
  for (size_t i = 0; i < n; i++) {
    if (json[i] == '\n' || json[i] == '\r') { cfgError("line break inside"); return; }
  }
  if (prefs.putString("cfg", json) != n) { cfgError("flash write failed"); return; }
  Serial.print("{\"type\":\"cfg-ok\"}\n");
}

// ── commands from the page ──
static void handleCommand(const char *c) {
  if (strcmp(c, "hello") == 0) sendHello();
  else if (strcmp(c, "ping") == 0) {
    Serial.print("{\"type\":\"pong\",\"t\":");
    Serial.print(millis());
    Serial.print("}\n");
  } else if (strcmp(c, "cfg-get") == 0) sendCfg();
  else if (strncmp(c, "cfg-set ", 8) == 0) cfgSet(c + 8);
  else if (strcmp(c, "cfg-clear") == 0) {
    prefs.remove("cfg");
    Serial.print("{\"type\":\"cfg-ok\"}\n");
  }
  // anything else is ignored (docs/system/GLOVE.md)
}
static void readCommands() {
  while (Serial.available() > 0) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      cmd[cmdLen] = '\0';
      if (cmdOverflow) { if (strncmp(cmd, "cfg-set ", 8) == 0) cfgError("too long"); }
      else if (cmdLen > 0) handleCommand(cmd);
      cmdLen = 0;
      cmdOverflow = false;
    } else if (cmdLen < CMD_MAX) {
      cmd[cmdLen++] = ch;
    } else {
      cmdOverflow = true;          // keep the start (to answer "too long"), drop the rest
    }
  }
}

void setup() {
  Serial.setRxBufferSize(2048);    // a whole cfg-set line fits while a data line is being printed
  Serial.begin(115200);
  for (int b = 0; b < 4; b++) { pinMode(MUX_S[b], OUTPUT); digitalWrite(MUX_S[b], LOW); }
  analogReadResolution(12);                       // 0..4095
  analogSetPinAttenuation(MUX_SIG, ADC_11db);     // full 0..3.3 V range
  prefs.begin("skglove", false);
  imuPresent = mpuStart(21, 22) || mpuStart(22, 21);
  if (!imuPresent) { sdaPin = 21; sclPin = 22; }
  delay(200);                                     // let the USB-serial bridge settle
  sendHello();
  nextAt = millis();
}

void loop() {
  readCommands();
  uint32_t now = millis();
  if ((int32_t)(now - nextAt) < 0) return;
  nextAt += PERIOD_MS;
  if ((int32_t)(now - nextAt) > (int32_t)PERIOD_MS) nextAt = now + PERIOD_MS;   // fell behind: no burst

  Serial.print("{\"t\":");
  Serial.print(now);
  Serial.print(",\"ch\":[");
  for (int c = 0; c < CHANNELS; c++) {
    if (c) Serial.print(',');
    Serial.print(readChannel(c));
  }
  Serial.print(']');
  float a[3], g[3];
  if (imuPresent && mpuRead(a, g)) {
    Serial.printf(",\"imu\":{\"ax\":%.2f,\"ay\":%.2f,\"az\":%.2f,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f}", a[0], a[1], a[2], g[0], g[1], g[2]);
  }
  Serial.print("}\n");
  readCommands();
}
```

- [ ] **Step 2: Replace `tools/glove-firmware/README.md`**

````markdown
# Glove firmware (`sk_glove` 2.0)

The firmware for the two wired data gloves: 10 flex sensors on a CD74HC4067 16-channel mux, an optional MPU6050
(GY-521), one ESP32, and a USB cable to the Pi (the laptop while testing). It speaks protocol v2 in
[`docs/system/GLOVE.md`](../../docs/system/GLOVE.md): 115200 baud, one JSON object per line, ~30 lines per second,
the raw value of all 16 mux channels, and the glove's setup stored in its flash.

## Wiring (the owner's circuit diagram)

```
   ESP32 dev board                 CD74HC4067 16-channel mux
   GPIO 14 ───────────────────────  S0
   GPIO 27 ───────────────────────  S1
   GPIO 26 ───────────────────────  S2
   GPIO 25 ───────────────────────  S3
   GPIO 34 ───────────────────────  SIG
   GND ───────────────────────────  EN, GND
   3V3 ───────────────────────────  VCC   (0.1 µF from VCC to GND)
                                    C0..C9  <- FS1..FS10 (one divider each, below)

   One divider per flex sensor:   3V3 ──[ flex sensor ]──┬──[ R ]── GND
                                                         └── mux C-pin

   MPU6050 / GY-521 (optional):   VCC 3V3 · GND · SDA GPIO 21 · SCL GPIO 22 · AD0 GND
   USB ── cable to the laptop / Pi (power and data)
```

- **Which sensor is which finger does not matter here.** The firmware sends all 16 channels; Settings -> Glove ->
  **Set up glove** finds each finger's channel and saves it on the glove.
- **3.3 V only.** Never connect 5 V to an ESP32 pin, the mux or a sensor.
- **Bending lowers the reading** (the sensor's resistance rises). The page's calibration handles it.
- **Battery: not used.** The diagram's 18650 + TP4056 + switch SW1 are not needed: USB powers everything. Keep
  **SW1 OFF whenever USB is plugged in** (USB 5 V would otherwise push into the battery through VIN without the
  charger's control).

## First time on a Windows laptop

1. **Driver / COM port.** Plug the ESP32 in with a **data** USB cable (many cables are power-only). Open Device
   Manager -> Ports (COM & LPT):
   - "Silicon Labs CP210x USB to UART Bridge (COMx)" or "USB-SERIAL CH340 (COMx)": good, note COMx.
   - Nothing, or "Unknown device": install the driver for the chip on the board (the small chip near the USB
     socket says CP2102 or CH340): Silicon Labs "CP210x VCP driver" or WCH "CH341SER", then unplug / plug.
2. **Arduino IDE board package** (once, needs internet): File -> Preferences -> Additional boards manager URLs:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`, then Tools -> Board -> Boards Manager ->
   install **esp32 by Espressif Systems**.
3. Tools -> Board -> **ESP32 Dev Module**. Tools -> Port -> your COMx.
4. Open `tools/glove-firmware/sk_glove/sk_glove.ino` and press **Upload**. No extra libraries (`Wire` and
   `Preferences` come with the board package). If it stops at "Connecting…", hold the board's **BOOT** button
   until the upload starts.

## Check 1: Serial Monitor (no kiosk needed)

1. Tools -> Serial Monitor, **115200 baud**, line ending **Newline**.
2. Press the board's **EN/RST**. The first line is the hello:
   `{"type":"hello","device":"sk-glove","fw":"2.0","channels":16,"imu":true,"i2c":"21/22","hasCfg":false}`
   (`"imu":false` if the MPU6050 did not answer).
3. Then about 30 lines a second: `{"t":1234,"ch":[3290,3310,...16 numbers...],"imu":{...}}`.
   - Bend one finger at a time: **one** of the first 10 numbers must drop clearly (by hundreds).
   - A number that never changes, or sits at 0 or 4095, is a sensor or wire to check. The last 6 (C10-C15) have
     nothing connected and may read anything.
4. Type `ping` and Enter: `{"type":"pong","t":...}`. Type `cfg-get`: `{"type":"cfg","cfg":null}` on a new glove.
5. **Close the Serial Monitor** before the next check: only one program can open the port at a time.

## Check 2: Settings -> Glove (kiosk page, laptop)

1. XAMPP running; Chrome on `http://localhost/SKR/`; log in as an admin -> name chip -> **Settings** -> Glove ->
   **Connect glove** -> pick the ESP32's port. (Web Serial does not work on a LAN address or in Firefox.)
2. The status line: `sk-glove · firmware 2.0 · 16 channels · IMU yes (21/22) · 30 readings/s · not set up`.
3. **Debug**: about 30 lines/s; the 16-channel table's numbers change as you bend fingers.
4. **Set up glove**: follow the screen (fingers, calibrate, camera, IMU, Save on glove).
5. Unplug the cable: "reconnecting…". Plug it back: connected within 3 s with no prompt, and the setup is still
   there (it comes from the glove).

No glove at hand? Turn on **Use simulator** (or open `settings.html?glove=sim`): the same lines, including a bad one
about every 5 s.
````

- [ ] **Step 3: Compile check**

Try, in the workspace:
```bash
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli compile --fqbn esp32:esp32:esp32 tools/glove-firmware/sk_glove
```
Expected: "Sketch uses … bytes". If the board package cannot be downloaded (the cloud container's network policy refused `downloads.arduino.cc` and `espressif.github.io` while this plan was written), do not work around it: write "not compiled here" in the report, and the owner's checklist step "Upload" is the compile check (Arduino IDE on the laptop).

- [ ] **Step 4: Commit**

```bash
git add tools/glove-firmware/sk_glove/sk_glove.ino tools/glove-firmware/README.md
git commit -m "glove firmware 2.0: CD74HC4067 mux (16 channels), MPU6050 pin swap, setup stored in flash"
```

---

### Task 3: Settings -> Glove: two hands, Set up glove, 16-channel debug

**Files:**
- Modify (full rewrite): `settings.html`
- Modify (full rewrite): `tests/glove/settings-check.mjs`
- Create: `tests/glove/no-db-router.php`

**Interfaces:**
- Consumes: everything `window.SKGlove` produces (Task 1); `window.GestureDataRecorder.setupMediaPipe(video)`, `.resumeHandLoop()`, `.pauseHandLoop()`, `.onHandResults(fn)` -> unsubscribe (existing, `js/gesture-data.js`); `js/lib/mediapipe/hands.js` (existing, vendored).
- Produces: the stored setup `{ v: 1, map: { L, R }, cal: { L: { open, fist }, R, at }, cam: { mirror } | null, imuHand: 'L'|'R'|null, w }` on the glove; test hook `window.__skGloveSetup.camFeed(results)`.

- [ ] **Step 1: Write the failing browser check** — replace `tests/glove/settings-check.mjs`:

```js
// glove-hw phase (protocol v2, two gloves, setup on the glove): Settings -> Glove with the simulator,
// headless Chrome at 1024x600 via tests/video-capture/cdp.mjs (logs in as the seeded admin):
//   not connected; simulator: hello v2 + device line, "not set up"; Debug: console + red bad line,
//   counters, ping, 16-channel table, Download log; Set up glove: 10 fingers found (with one "no sensor
//   moved" and one "already used" retry), calibrate both hands, camera step (hand results injected),
//   IMU hand, Save on glove -> two hands of bars; reload -> the setup comes back from the glove;
//   Clear setup on glove; layout (no page scroll, controls >= 44 px) on every screen; admin menu;
//   0 console errors.
// Run (server at SK_BASE, default http://localhost/SKR/): node tests/glove/settings-check.mjs [--shots <dir>]
// Without MySQL: serve with tests/glove/no-db-router.php (see that file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchChrome } from '../video-capture/cdp.mjs';

const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}

const c = await launchChrome({ port: 9341, extraArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-glove-dl-'));
await c.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(() =>
  c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }));
const ev = (x) => c.evaluate(x);
const click = (sel) => ev(`document.querySelector(${J(sel)}).click()`);
const text = (id) => ev(`document.getElementById(${J(id)}).textContent`);
async function waitFor(expr, ms = 8000) {
  for (let t = 0; t < ms; t += 100) { if (await ev(expr)) return true; await sleep(100); }
  return false;
}
async function shot(name) {
  if (!SHOTS) return;
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from((r.result || r).data, 'base64'));
}
const layout = () => ev(`(() => {
  const small = [...document.querySelectorAll('button, input')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44)
    .map((e) => e.id || e.className || e.textContent.trim());
  return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, small };
})()`);
const layoutOk = (l) => l.sw === 1024 && l.sh === 600 && !l.small.length;

// The simulator's wiring (js/glove.js): C0-C4 = right thumb..pinky, C5-C9 = left thumb..pinky.
const SIM_CH = { R: [0, 1, 2, 3, 4], L: [5, 6, 7, 8, 9] };
// One finger step: wait for "BEND NOW", hold channel ch bent, wait for the verdict, release.
async function fingerStep(ch) {
  await waitFor(`/BEND NOW/.test(document.getElementById('su-f-phase').textContent)`, 4000);
  if (ch !== null) await ev(`SKGlove.simSetBend(${ch}, 1); true`);
  await waitFor(`document.getElementById('su-f-msg').textContent !== ''`, 4000);
  if (ch !== null) await ev(`SKGlove.simSetBend(${ch}, null); true`);
  return text('su-f-msg');
}

try {
  // 1. Not connected (simulator off, nothing stored)
  await c.navigate(BASE + 'settings.html');
  await ev(`['sk_glove_sim','sk_glove_sim_cfg','sk_glove_calibration'].forEach((k) => localStorage.removeItem(k)); true`);
  await c.navigate(BASE + 'settings.html');
  const s1 = await ev(`({ status: SKGlove.status(), title: document.getElementById('g-title').textContent,
    connectVisible: !document.getElementById('g-connect').hidden, sim: document.querySelector('[data-sim]').getAttribute('aria-checked') })`);
  check('not connected: status, title, Connect glove, simulator off',
    ['disconnected', 'unsupported'].includes(s1.status) && /not connected|not available/.test(s1.title) && s1.connectVisible && s1.sim === 'false', J(s1));
  const l1 = await layout();
  check('1024x600: no page scroll, controls >= 44 px', layoutOk(l1), J(l1));
  await shot('glove-hw-1-not-connected.png');

  // 2. Simulator on -> connected, hello v2, not set up
  await click('#g-simcard [data-sim]');
  await sleep(1500);
  const s2 = await ev(`({ status: SKGlove.status(), info: SKGlove.info(), sub: document.getElementById('g-sub').textContent,
    live: !document.getElementById('g-live').hidden, notset: !document.getElementById('g-notset').hidden,
    hands: !document.getElementById('g-hands').hidden, setupBtn: !document.getElementById('g-setup').hidden })`);
  check('simulator: connected, hello v2 (16 channels, IMU)', s2.status === 'connected' && s2.info && s2.info.channels === 16 && s2.info.imu === true, J(s2));
  check('device line', /sk-glove · firmware 2\.0-sim · 16 channels · IMU yes \(21\/22\) · \d+ readings\/s · not set up/.test(s2.sub), s2.sub);
  check('not set up: "Not set up yet" shown, no bars, Set up glove button', s2.live && s2.notset && !s2.hands && s2.setupBtn, J(s2));
  const imu = await ev(`['imu-tx','imu-ty','imu-turn'].map((id) => document.getElementById(id).textContent)`);
  check('IMU values shown', /°$/.test(imu[0]) && /°$/.test(imu[1]) && /°\/s$/.test(imu[2]), J(imu));
  await shot('glove-hw-2-not-set-up.png');

  // 3. Debug panel
  await click('#dbg-toggle');
  await ev(`SKGlove._feed('this is not json\\n'); true`);
  await sleep(1200);
  const d = await ev(`({ lines: document.querySelectorAll('#console > div').length,
    bad: [...document.querySelectorAll('#console .badl')].map((e) => e.textContent).slice(-1)[0] || null,
    lps: +document.getElementById('c-lps').textContent, total: +document.getElementById('c-lines').textContent,
    badCount: +document.getElementById('c-bad').textContent,
    rows: [...document.querySelectorAll('#mm tr')].map((r) => [...r.children].map((td) => td.textContent)),
    cfg: document.getElementById('d-cfg').textContent })`);
  check('console: lines and a red bad line with its parse error', d.lines > 20 && d.lines <= 200 && /this is not json\s+✖ not JSON/.test(d.bad || ''), J(d.bad));
  check('counters: ~30 lines/s, totals, bad >= 1', d.lps >= 25 && d.lps <= 35 && d.total > 30 && d.badCount >= 1, J({ lps: d.lps, total: d.total, bad: d.badCount }));
  check('16-channel table, nothing "used by" yet, live values', d.rows.length === 16 && d.rows[0][0] === 'C0' && d.rows[15][0] === 'C15' &&
    d.rows.every((r) => r[1] === '–' && /^\d+$/.test(r[5])), J(d.rows.slice(0, 2)));
  check('setup on the glove: "none"', d.cfg === 'none', d.cfg);
  await click('#d-ping');
  await sleep(300);
  check('Send "ping" shows the round trip', /^round trip \d+ ms$/.test(await text('d-rtt')));
  await click('#d-download');
  let file = null;
  for (let i = 0; i < 30 && !file; i++) { await sleep(200); file = fs.readdirSync(downloads).find((f) => /^glove-log-.*\.txt$/.test(f)); }
  const log = file ? fs.readFileSync(path.join(downloads, file), 'utf8') : '';
  check('Download log: timestamped lines incl. the hello v2 and the bad line',
    !!file && /^\d{4}-\d\d-\d\dT\S+Z < \{"type":"hello","device":"sk-glove","fw":"2\.0-sim"/m.test(log) && /\[BAD: not JSON/.test(log), file);
  const l3 = await layout();
  check('debug open: no page scroll, controls >= 44 px', layoutOk(l3), J(l3));
  await shot('glove-hw-3-debug.png');
  await click('#dbg-toggle');

  // 4. Set up glove: fingers
  await click('#g-setup');
  await sleep(300);
  check('Set up glove opens full screen at step 1', (await text('bar-title')) === 'SET UP GLOVE' &&
    await ev(`document.querySelector('#su-steps span.on').dataset.step === 'fingers'`));
  const l4 = await layout();
  check('setup screen: no page scroll, controls >= 44 px', layoutOk(l4), J(l4));
  await shot('glove-hw-4-fingers.png');
  const results = [];
  results.push(await fingerStep(SIM_CH.R[0]));                     // R thumb -> C0
  const dup = await fingerStep(SIM_CH.R[0]);                        // R index, but C0 bent again
  check('a channel already used -> "already R thumb", Retry and Skip shown',
    /C0 is already R thumb/.test(dup) && await ev(`!document.getElementById('su-retry').hidden && !document.getElementById('su-skip').hidden`), dup);
  await click('#su-retry');
  results.push(await fingerStep(SIM_CH.R[1]));                     // R index -> C1
  for (let i = 2; i < 5; i++) results.push(await fingerStep(SIM_CH.R[i]));
  const none = await fingerStep(null);                              // L thumb, nothing bent
  check('nothing bent -> "No sensor moved", Retry and Skip shown', /No sensor moved/.test(none), none);
  await click('#su-retry');
  for (let i = 0; i < 5; i++) results.push(await fingerStep(SIM_CH.L[i]));
  check('all 10 fingers found on the right channels', results.length === 10 &&
    results.every((m, k) => new RegExp('^Found: C' + [...SIM_CH.R, ...SIM_CH.L][k] + ' ').test(m)), J(results));
  await waitFor(`!document.getElementById('su-next').disabled`, 3000);
  check('"10 of 10 fingers found", Next enabled', /10 of 10 fingers found/.test(await text('su-f-msg')));
  await shot('glove-hw-5-fingers-done.png');

  // 5. Calibrate both hands
  await click('#su-next');
  await waitFor(`/STEP 2 · GET READY/.test(document.getElementById('s2-lbl').textContent)`, 6000);
  await ev(`[0,1,2,3,4,5,6,7,8,9].forEach((c) => SKGlove.simSetBend(c, 1)); true`);
  await waitFor(`/DONE/.test(document.getElementById('s2-lbl').textContent)`, 6000);
  await ev(`[0,1,2,3,4,5,6,7,8,9].forEach((c) => SKGlove.simSetBend(c, null)); true`);
  const cal = await ev(`({ s1: document.getElementById('s1-lbl').textContent, s2: document.getElementById('s2-lbl').textContent,
    v1: document.getElementById('s1-vals').textContent, next: !document.getElementById('su-next').disabled })`);
  check('calibrate: both steps done, values per hand, Next enabled', /DONE/.test(cal.s1) && /DONE/.test(cal.s2) && /^L: \d+/.test(cal.v1) && cal.next, J(cal));
  const l5 = await layout();
  check('calibrate screen: no page scroll, controls >= 44 px', layoutOk(l5), J(l5));
  await shot('glove-hw-6-calibrate.png');

  // 6. Camera step: the fake camera has no hand, so MediaPipe's results are injected
  await click('#su-next');
  await sleep(500);
  check('camera step shown with Skip', await ev(`document.getElementById('su-cam').classList.contains('on') && !document.getElementById('su-skip').hidden`));
  for (let i = 0; i < 5; i++) await ev(`window.__skGloveSetup.camFeed({ multiHandedness: [{ label: 'Left', score: 0.95 }] }); true`);
  const camMsg = await text('su-c-msg');
  check('right hand seen as "Left" -> mirror on, Next enabled', /seen as "Left".*mirror on/.test(camMsg) && await ev(`!document.getElementById('su-next').disabled`), camMsg);
  await shot('glove-hw-7-camera.png');

  // 7. IMU hand, 8. Save on glove
  await click('#su-next');
  await sleep(200);
  check('IMU step: Next disabled until a hand is picked', await ev(`document.getElementById('su-next').disabled`));
  await click('#su-imu-R');
  await click('#su-next');
  await sleep(200);
  const sum = await ev(`[...document.querySelectorAll('#su-sum tr')].map((r) => r.textContent)`);
  check('summary: both hands, calibration, camera, IMU', sum.length === 5 && /RIGHT hand.*Thumb C0/.test(sum[0]) && /mirror on/.test(sum[3]) && /right hand/.test(sum[4]), J(sum));
  const l7 = await layout();
  check('save screen: no page scroll, controls >= 44 px', layoutOk(l7), J(l7));
  await shot('glove-hw-8-save.png');
  await click('#su-savebtn');
  await waitFor(`document.getElementById('bar-title').textContent === 'SETTINGS'`, 4000);
  const saved = await ev(`({ cfg: SKGlove.config(), state: SKGlove.configState(), ready: SKGlove.ready(),
    sub: document.getElementById('g-sub').textContent, hands: !document.getElementById('g-hands').hidden })`);
  check('Save on glove: back on Settings, setup stored (map, cal, mirror, IMU R, w 0.3), ready()',
    saved.state === 'ok' && saved.ready && J(saved.cfg.map) === J({ L: SIM_CH.L, R: SIM_CH.R }) &&
    saved.cfg.cam.mirror === true && saved.cfg.imuHand === 'R' && saved.cfg.w === 0.3 && /setup saved on glove today/.test(saved.sub) && saved.hands, J(saved));
  await ev(`SKGlove.simSetBend(0, 1); true`);
  await sleep(600);
  const bars = await ev(`({ rThumb: parseInt(document.getElementById('barR0').style.height), rIndex: parseInt(document.getElementById('barR1').style.height) })`);
  await ev(`SKGlove.simSetBend(0, null); true`);
  check('bars: right thumb bent reads ~100 %, right index open reads low', bars.rThumb >= 90 && bars.rIndex <= 25, J(bars));
  await shot('glove-hw-9-two-hands.png');

  // 9. Reload: the setup comes back from the glove (the simulator's flash)
  await c.navigate(BASE + 'settings.html');
  await waitFor(`SKGlove.configState() === 'ok'`, 5000);
  check('reload: setup read back from the glove, bars shown', await ev(`SKGlove.ready() && !document.getElementById('g-hands').hidden &&
    /setup saved on glove today/.test(document.getElementById('g-sub').textContent)`));
  await click('#dbg-toggle');
  await sleep(700);
  const used = await ev(`[...document.querySelectorAll('#mm tr')].slice(0, 10).map((r) => r.children[1].textContent)`);
  check('Debug: "used by" shows the fingers', used[0] === 'R thumb' && used[9] === 'L pinky', J(used));
  check('Debug: the stored setup as JSON', /"imuHand":"R"/.test(await text('d-cfg')));

  // 10. Clear setup on glove
  await click('#d-cfgclear');
  await waitFor(`SKGlove.configState() === 'none'`, 3000);
  check('Clear setup on glove -> not set up', await ev(`!SKGlove.ready() && !document.getElementById('g-notset').hidden && document.getElementById('d-cfg').textContent === 'none'`));

  // 11. Admin menu lists Settings
  check('admin menu lists Settings', await (async () => {
    await c.navigate(BASE + 'index.html');
    return ev(`(() => { document.querySelector('#acct .sk-chip, .sk-chip')?.click(); return [...document.querySelectorAll('.sk-menu-item')].some((a) => a.getAttribute('href') === 'settings.html' && /Settings/.test(a.textContent)); })()`);
  })());

  const errs = c.getConsoleErrors().concat(c.getExceptions());
  check('0 console errors', errs.length === 0, J(errs).slice(0, 600));
} finally {
  await c.close();
  fs.rmSync(downloads, { recursive: true, force: true });
}
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Add the no-MySQL router** — create `tests/glove/no-db-router.php`:

```php
<?php
// tests/glove/no-db-router.php — a router for PHP's built-in server so the glove browser checks run
// on a machine WITHOUT MySQL (the cloud container the glove-hw phase was built in). It answers only
// the two account endpoints the Settings page and tests/video-capture/cdp.mjs need, as a logged-in
// admin; every other path is served from disk as usual. Never used by the kiosk (XAMPP / the Pi have
// the real php/auth.php and php/api/me.php).
// Run from a folder whose SKR/ points at the repo:  php -S 127.0.0.1:8080 SKR/tests/glove/no-db-router.php
// then SK_BASE=http://127.0.0.1:8080/SKR/
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#/SKR/php/auth\.php$#', $path)) {
    header('Content-Type: application/json');
    header('Set-Cookie: SKSESSID=glove-test; Path=/; HttpOnly');
    echo json_encode(['success' => true, 'user' => ['id' => 1, 'username' => 'admin', 'display_name' => 'Admin', 'role' => 'admin']]);
    return true;
}
if (preg_match('#/SKR/php/api/me\.php$#', $path)) {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-store');
    echo "window.SK_ME = {\"id\":1,\"username\":\"admin\",\"display_name\":\"Admin\",\"role\":\"admin\"};\n";
    return true;
}
return false;
```

- [ ] **Step 3: Run the check against the old page to see it fail**

Run (see "Test environment"): `node tests/glove/settings-check.mjs`
Expected: FAIL lines from "device line" on (the old page has no Set up glove / two hands), exit code 1.

- [ ] **Step 4: Replace `settings.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Settings — Sining Kamay</title>
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<!-- Admin -> Settings (glove-serial phase 2026-10-20; two gloves + setup on the glove, glove-hw phase
     2026-10-21, docs/superpowers/specs/2026-10-21-glove-hardware-design.md, docs/system/GLOVE.md).
     Admin only. Sections General · Voice · Glove; General and Voice are placeholders. Glove: status
     from the hello line, Connect / Set up glove / Disconnect, two hands of live finger bars, IMU, Use
     simulator, and a collapsible Debug panel (raw console, counters, commands, log download,
     16-channel table, the setup stored on the glove, hints). Set up glove is a full-screen wizard:
     find the fingers, calibrate, camera handedness, IMU hand, save ON THE GLOVE.
     Everything goes through window.SKGlove (js/glove.js); nothing here talks to the server. -->
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/virtual-keyboard.css">
<link rel="stylesheet" href="css/sk-pages.css">
<style>
  .st-body { flex: 1; min-height: 0; display: flex; gap: 14px; padding: 14px; }
  .st-nav { width: 190px; flex: none; align-self: flex-start; background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .st-nav button { width: 100%; height: 52px; display: flex; align-items: center; gap: 8px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--border); background: #fff; color: var(--muted); font-size: 15px; font-weight: 700; cursor: pointer; text-align: left; }
  .st-nav button:last-child { border-bottom: 0; }
  .st-nav button.on { background: #fff1e6; color: var(--orange); box-shadow: inset 4px 0 0 var(--orange); }
  .st-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; }
  .st-sec { display: none; flex-direction: column; gap: 12px; min-height: 100%; }
  .st-sec.on { display: flex; }
  .card { flex: none; background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .row { display: flex; gap: 10px; align-items: center; }
  .between { justify-content: space-between; }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; background: var(--muted-light); }
  .dot.ok { background: var(--green); } .dot.warn { background: var(--orange); } .dot.bad { background: var(--red); }
  .st-title { font-size: 18px; font-weight: 800; }
  .cnt { font-size: 13px; color: var(--muted); }
  .lbl { font-size: 12px; font-weight: 800; color: var(--muted); letter-spacing: 0.5px; }
  .btn { height: 48px; min-width: 120px; padding: 0 18px; border-radius: 10px; font-size: 15px; font-weight: 800; cursor: pointer; white-space: nowrap; border: 2px solid transparent; }
  .btn.pri { background: var(--orange); color: #fff; } .btn.pri:active { background: var(--orange-dark); }
  .btn.sec { background: #fff; color: var(--navy); border-color: var(--navy); }
  .btn.red { background: #fff; color: var(--red); border-color: var(--red); }
  .btn.small { height: 44px; min-width: 0; font-size: 14px; padding: 0 14px; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .sw { flex: none; width: 56px; height: 44px; border: 0; background: transparent; padding: 7px 0; cursor: pointer; }
  .sw span { display: block; width: 56px; height: 30px; border-radius: 15px; background: #c3cad6; position: relative; }
  .sw span::after { content: ""; position: absolute; left: 3px; top: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; }
  .sw[aria-checked="true"] span { background: var(--green); }
  .sw[aria-checked="true"] span::after { left: auto; right: 3px; }
  .warn-box { flex: none; background: #fdecec; border: 1px solid #f3b9b9; color: #8a1f1f; border-radius: 10px; padding: 12px 14px; font-size: 14px; }
  .placeholder { flex: 1; display: grid; place-items: center; color: var(--muted); font-size: 15px; min-height: 220px; text-align: center; }
  .live { display: flex; gap: 18px; min-height: 250px; }
  .hands { flex: 1; min-width: 0; display: flex; gap: 22px; }
  .hand { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .notset { flex: 1; display: grid; place-items: center; text-align: center; color: var(--muted); font-size: 15px; }
  .fingers { flex: 1; display: flex; gap: 8px; align-items: stretch; height: 190px; padding-top: 8px; }
  .fg { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .trk { flex: 1; width: 34px; background: #e6ebf3; border-radius: 8px; position: relative; overflow: hidden; }
  .trk i { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: var(--orange); border-radius: 8px; }
  .trk.off { background: repeating-linear-gradient(45deg, #eef1f6, #eef1f6 6px, #e2e7ef 6px, #e2e7ef 12px); }
  .fg b { font-size: 13px; font-variant-numeric: tabular-nums; }
  .fg span { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .imu { width: 200px; flex: none; border-left: 1px solid var(--border); padding-left: 16px; display: flex; flex-direction: column; gap: 6px; }
  .imu .cnt b { color: var(--navy); font-variant-numeric: tabular-nums; }
  /* Debug */
  .dbg-head { width: 100%; height: 48px; display: flex; align-items: center; justify-content: space-between; border: 0; background: transparent; padding: 0; font-size: 16px; font-weight: 800; color: var(--navy); cursor: pointer; }
  .dbg-body { display: none; flex-direction: column; gap: 10px; margin-top: 6px; }
  .dbg.open .dbg-body { display: flex; }
  .ctrs { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .ctr { background: var(--bg); border-radius: 8px; padding: 8px 10px; }
  .ctr div:first-child { font-size: 11px; font-weight: 700; color: var(--muted); }
  .ctr div:last-child { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .hints { display: flex; flex-direction: column; gap: 6px; }
  .hint { background: #fff1e6; border: 1px solid #f7c9a3; color: #7a3a07; border-radius: 8px; padding: 8px 12px; font-size: 14px; }
  .hint.ok { background: #e8f7ef; border-color: #b7e4c9; color: #15603a; }
  .dbg-input { flex: 1; min-width: 0; height: 44px; border: 2px solid var(--border); border-radius: 10px; padding: 0 12px; font-size: 15px; color: var(--navy); background: #fff; }
  .dbg-input:focus { border-color: var(--orange); outline: none; }
  .console { height: 220px; overflow-y: auto; background: #101727; color: #d5dceb; border-radius: 10px; padding: 8px 10px; font: 12px/1.45 Consolas, 'Courier New', monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .console .out { color: #8fc6ff; }
  .console .badl { color: #ff8a80; }
  .console .ts { color: #6f7b93; }
  table.mm { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  table.mm th, table.mm td { border-bottom: 1px solid var(--border); padding: 5px 8px; text-align: right; }
  table.mm th:first-child, table.mm td:first-child, table.mm th:nth-child(2), table.mm td:nth-child(2) { text-align: left; }
  table.mm tr.used td { font-weight: 700; color: var(--navy); }
  pre.cfg { margin: 0; background: var(--bg); border-radius: 8px; padding: 8px 10px; font: 12px/1.45 Consolas, 'Courier New', monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  /* Set up glove (full screen) */
  .su-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 14px; }
  .su-steps { flex: none; display: flex; gap: 8px; }
  .su-steps span { flex: 1; height: 36px; display: grid; place-items: center; border-radius: 8px; background: #e6ebf3; color: var(--muted); font-size: 13px; font-weight: 800; }
  .su-steps span.on { background: var(--orange); color: #fff; }
  .su-steps span.done { background: #e8f7ef; color: #15603a; }
  .su-panel { flex: 1; min-height: 0; display: none; gap: 14px; }
  .su-panel.on { display: flex; }
  .su-main { flex: 1; min-width: 0; background: #fff; border: 2px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; align-items: center; justify-content: center; text-align: center; }
  .su-main .big { font-size: 26px; font-weight: 800; color: var(--navy); }
  .su-main .phase { font-size: 13px; font-weight: 800; color: var(--orange); letter-spacing: 0.5px; min-height: 18px; }
  .su-main .hand { font-size: 60px; line-height: 1; }
  .su-side { width: 300px; flex: none; background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
  .chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .chip { height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-radius: 8px; background: var(--bg); font-size: 13px; font-weight: 700; color: var(--muted); }
  .chip.found { background: #e8f7ef; color: #15603a; }
  .chip.skip { background: #fdecec; color: #8a1f1f; }
  .chip.now { box-shadow: inset 0 0 0 2px var(--orange); color: var(--navy); }
  .prog { height: 10px; width: 100%; max-width: 360px; background: #e6ebf3; border-radius: 5px; overflow: hidden; }
  .prog i { display: block; height: 100%; width: 0; background: var(--orange); }
  .prog i.done { background: var(--green); }
  .su-msg { min-height: 20px; font-size: 15px; font-weight: 700; color: var(--red); }
  .su-msg.ok { color: #15803d; }
  .steps2 { flex: 1; display: flex; gap: 14px; min-height: 0; }
  .step { flex: 1; background: #fff; border: 2px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; text-align: center; }
  .step.on { border-color: var(--orange); background: #fff7f0; }
  .step .hand { font-size: 56px; line-height: 1; }
  .step b { font-size: 20px; }
  .cal-vals { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; min-height: 32px; }
  .cam-box { width: 320px; height: 240px; border-radius: 10px; overflow: hidden; background: #101727; flex: none; }
  .cam-box video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
  .pick { display: flex; gap: 14px; }
  .pick .btn { height: 72px; min-width: 200px; font-size: 18px; }
  .pick .btn.on { background: var(--orange); color: #fff; border-color: var(--orange); }
  table.sum { border-collapse: collapse; font-size: 14px; text-align: left; }
  table.sum td { padding: 5px 10px; border-bottom: 1px solid var(--border); }
  table.sum td:first-child { font-weight: 800; color: var(--muted); }
  .su-foot { flex: none; display: flex; gap: 10px; align-items: center; }
</style>
<script src="php/api/me.php"></script>
<script src="js/sk-account.js"></script>
<script>SKAccount.adminPage();</script>
</head>
<body class="sk-page">
  <div class="sk-bar">
    <div class="sk-bar-side"><button type="button" class="sk-back" id="back-btn">&#8592; Home</button></div>
    <h1 class="sk-title" id="bar-title">SETTINGS</h1>
    <div class="sk-bar-side right"><div id="acct"></div></div>
  </div>

  <div class="sk-screen on" id="screen-settings">
    <div class="st-body">
      <nav class="st-nav" aria-label="Settings sections">
        <button type="button" data-sec="general">General</button>
        <button type="button" data-sec="voice">Voice</button>
        <button type="button" data-sec="glove" class="on">&#129508; Glove</button>
      </nav>
      <div class="st-main" id="st-main">
        <section class="st-sec" id="sec-general"><div class="card placeholder">General settings will be here.</div></section>
        <section class="st-sec" id="sec-voice"><div class="card placeholder">Voice settings will be here.</div></section>

        <section class="st-sec on" id="sec-glove">
          <div class="card row between">
            <div style="min-width:0">
              <div class="row" style="gap:8px"><span class="dot" id="g-dot"></span><span class="st-title" id="g-title">Glove not connected</span></div>
              <div class="cnt" id="g-sub" style="margin-top:4px">Plug the gloves into a USB port, then tap Connect. The kiosk remembers them next time.</div>
            </div>
            <div class="row">
              <button type="button" class="btn pri" id="g-connect" style="width:180px">Connect glove</button>
              <button type="button" class="btn sec" id="g-setup" hidden>Set up glove</button>
              <button type="button" class="btn red" id="g-disconnect" hidden>Disconnect</button>
            </div>
          </div>
          <div class="warn-box" id="g-unsupported" hidden><b>This browser can't use the glove.</b> Web Serial works in Chromium/Chrome on <b>http://localhost</b> (the kiosk). It does not work over a network address or in Firefox. The simulator still works.</div>
          <div class="warn-box" id="g-oldfw" hidden><b>Old glove firmware.</b> This glove runs firmware 1.x (5 fingers, no mux). Flash <b>tools/glove-firmware/sk_glove</b> 2.0 (see its README).</div>
          <div class="card row between" id="g-simcard">
            <div><b>Use simulator</b><div class="cnt">Fake glove data for testing without hardware</div></div>
            <button type="button" class="sw" role="switch" aria-checked="false" aria-label="Use simulator" data-sim><span></span></button>
          </div>
          <div class="card placeholder" id="g-placeholder">Live finger view appears here when the glove is connected.</div>
          <div class="card live" id="g-live" hidden>
            <div class="hands" id="g-hands" hidden>
              <div class="hand"><div class="lbl">LEFT HAND</div><div class="fingers" id="g-fingers-L"></div></div>
              <div class="hand"><div class="lbl">RIGHT HAND</div><div class="fingers" id="g-fingers-R"></div></div>
            </div>
            <div class="notset" id="g-notset"><div><b>Not set up yet.</b><br>Tap <b>Set up glove</b>: it finds which sensor is which finger,<br>calibrates both hands and saves it on the glove.</div></div>
            <div class="imu">
              <div class="lbl">HAND MOTION (IMU)</div>
              <div id="g-imu-none" class="cnt">No IMU on this glove.</div>
              <div id="g-imu" hidden>
                <div class="cnt" id="imu-hand">On the – hand</div>
                <div class="cnt">Tilt X <b id="imu-tx">–</b></div>
                <div class="cnt">Tilt Y <b id="imu-ty">–</b></div>
                <div class="cnt">Turn <b id="imu-turn">–</b></div>
              </div>
              <div class="row" style="margin-top:auto"><b style="font-size:14px">Use simulator</b><button type="button" class="sw" role="switch" aria-checked="false" aria-label="Use simulator" data-sim style="margin-left:auto"><span></span></button></div>
            </div>
          </div>

          <div class="card dbg" id="dbg">
            <button type="button" class="dbg-head" id="dbg-toggle" aria-expanded="false"><span>Debug</span><span id="dbg-caret">&#9656;</span></button>
            <div class="dbg-body">
              <div class="ctrs">
                <div class="ctr"><div>LINES/S</div><div id="c-lps">0</div></div>
                <div class="ctr"><div>TOTAL LINES</div><div id="c-lines">0</div></div>
                <div class="ctr"><div>BAD LINES</div><div id="c-bad">0</div></div>
                <div class="ctr"><div>LAST DATA</div><div id="c-age">–</div></div>
                <div class="ctr"><div>SINCE HELLO</div><div id="c-hello">–</div></div>
                <div class="ctr"><div>RECONNECTS</div><div id="c-rec">0</div></div>
              </div>
              <div class="hints" id="hints"></div>
              <div class="row" style="flex-wrap:wrap">
                <button type="button" class="btn sec small" id="d-hello">Send "hello"</button>
                <button type="button" class="btn sec small" id="d-ping">Send "ping"</button>
                <span class="cnt" id="d-rtt">round trip –</span>
                <button type="button" class="btn sec small" id="d-download" style="margin-left:auto">Download log</button>
              </div>
              <div class="row">
                <input class="dbg-input" id="d-line" type="text" maxlength="200" autocomplete="off" spellcheck="false" placeholder="Line to send, e.g. hello">
                <button type="button" class="btn sec small" id="d-send">Send line</button>
              </div>
              <div class="row between">
                <span class="lbl">RAW SERIAL (LAST 200 LINES)</span>
                <div class="row">
                  <button type="button" class="btn sec small" id="d-pause">Pause</button>
                  <button type="button" class="btn sec small" id="d-clear">Clear</button>
                </div>
              </div>
              <div class="console" id="console" aria-live="off"></div>
              <div class="row between">
                <span class="lbl">16 MUX CHANNELS (RAW) — CHECK WIRING AND RESISTORS</span>
                <button type="button" class="btn sec small" id="d-mmreset">Reset min/max</button>
              </div>
              <table class="mm"><thead><tr><th>Channel</th><th>Used by</th><th>Min</th><th>Max</th><th>Range</th><th>Now</th></tr></thead><tbody id="mm"></tbody></table>
              <div class="row between">
                <span class="lbl">SETUP STORED ON THE GLOVE</span>
                <button type="button" class="btn red small" id="d-cfgclear">Clear setup on glove</button>
              </div>
              <pre class="cfg" id="d-cfg">–</pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>

  <!-- Set up glove (full screen): 1 Fingers · 2 Calibrate · 3 Camera · 4 IMU · 5 Save. -->
  <div class="sk-screen" id="screen-setup">
    <div class="su-body">
      <div class="su-steps" id="su-steps">
        <span data-step="fingers">1 · Fingers</span><span data-step="cal">2 · Calibrate</span><span data-step="cam">3 · Camera</span><span data-step="imu">4 · IMU</span><span data-step="save">5 · Save</span>
      </div>

      <div class="su-panel" id="su-fingers">
        <div class="su-main">
          <div class="phase" id="su-f-phase"></div>
          <div class="hand" id="su-f-icon">&#128070;</div>
          <div class="big" id="su-f-title">Bend your RIGHT thumb</div>
          <div class="cnt">Keep every other finger still and both hands open. First 1 second of rest, then bend and straighten that finger for 2 seconds.</div>
          <div class="prog"><i id="su-f-prog"></i></div>
          <div class="su-msg" id="su-f-msg" role="status"></div>
        </div>
        <div class="su-side">
          <div class="lbl">FINGERS FOUND</div>
          <div class="chips" id="su-f-chips"></div>
        </div>
      </div>

      <div class="su-panel" id="su-cal">
        <div class="steps2">
          <div class="step" id="cal-open"><div class="lbl" id="s1-lbl">STEP 1</div><div class="hand">&#128400;&#128400;</div><b>Open both hands</b><div class="cnt">Fingers straight, relaxed</div><div class="prog"><i id="s1-prog"></i></div><div class="cal-vals" id="s1-vals"></div></div>
          <div class="step" id="cal-fist"><div class="lbl" id="s2-lbl">STEP 2</div><div class="hand">&#9994;&#9994;</div><b>Make two fists</b><div class="cnt">Hold them for 3 seconds</div><div class="prog"><i id="s2-prog"></i></div><div class="cal-vals" id="s2-vals"></div></div>
        </div>
      </div>

      <div class="su-panel" id="su-cam">
        <div class="su-main" style="flex-direction:row;gap:20px">
          <div class="cam-box"><video id="su-video" autoplay muted playsinline></video></div>
          <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;text-align:left;max-width:360px">
            <div class="big">Raise your RIGHT hand</div>
            <div class="cnt">Only the right hand, open, in front of the camera, for a few seconds. This tells the kiosk how its camera sees left and right, so Let's Talk knows which glove belongs to which hand on screen.</div>
            <div class="su-msg" id="su-c-msg" role="status"></div>
          </div>
        </div>
      </div>

      <div class="su-panel" id="su-imu">
        <div class="su-main">
          <div class="big">Which hand has the sensor box (IMU)?</div>
          <div class="cnt">The small board with the MPU6050 / GY-521.</div>
          <div class="pick"><button type="button" class="btn sec" id="su-imu-L">Left hand</button><button type="button" class="btn sec" id="su-imu-R">Right hand</button></div>
        </div>
      </div>

      <div class="su-panel" id="su-save">
        <div class="su-main">
          <div class="big">Save the setup on the glove</div>
          <table class="sum"><tbody id="su-sum"></tbody></table>
          <div class="su-msg" id="su-s-msg" role="status"></div>
        </div>
      </div>

      <div class="su-foot">
        <div style="flex:1"></div>
        <button type="button" class="btn sec" id="su-retry" hidden>Retry</button>
        <button type="button" class="btn sec" id="su-skip" hidden>Skip</button>
        <button type="button" class="btn pri" id="su-next" style="width:200px" disabled>Next</button>
        <button type="button" class="btn pri" id="su-savebtn" style="width:220px" hidden>Save on glove</button>
      </div>
    </div>
  </div>

  <script src="js/lib/mediapipe/hands.js"></script>
  <script src="js/gesture-data.js"></script>
  <script src="js/glove.js"></script>
  <script src="js/virtual-keyboard.js" defer></script>
  <script>
  (function () {
    'use strict';
    var A = window.SKAccount;
    if (!A.isAdmin()) return;
    var G = window.SKGlove;
    var NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    var HAND_NAME = { L: 'LEFT', R: 'RIGHT' };
    var $ = function (id) { return document.getElementById(id); };
    var screen = 'settings';

    A.renderAccount($('acct'), { menu: false });

    // ── sections ──
    document.querySelectorAll('.st-nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.st-nav button').forEach(function (x) { x.classList.toggle('on', x === b); });
        document.querySelectorAll('.st-sec').forEach(function (s) { s.classList.toggle('on', s.id === 'sec-' + b.dataset.sec); });
      });
    });

    function show(name) {
      screen = name;
      $('screen-settings').classList.toggle('on', name === 'settings');
      $('screen-setup').classList.toggle('on', name === 'setup');
      $('back-btn').innerHTML = name === 'settings' ? '&#8592; Home' : '&#8592; Cancel';
      $('bar-title').textContent = name === 'settings' ? 'SETTINGS' : 'SET UP GLOVE';
    }
    $('back-btn').addEventListener('click', function () {
      if (screen === 'setup') { leaveSetup(); return; }
      location.href = 'index.html';
    });

    // ── finger bars: two hands ──
    ['L', 'R'].forEach(function (h) {
      $('g-fingers-' + h).innerHTML = NAMES.map(function (n, i) {
        return '<div class="fg"><div class="trk" id="trk' + h + i + '"><i id="bar' + h + i + '"></i></div><b id="val' + h + i + '">–</b><span>' + n + '</span><span id="raw' + h + i + '">–</span></div>';
      }).join('');
    });

    function fmtTime(iso) {
      var d = new Date(iso);
      if (isNaN(d)) return '';
      var today = new Date().toDateString() === d.toDateString();
      return (today ? 'today ' : d.toLocaleDateString() + ' ') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    function oldFirmware() { var h = G.info(); return !!(h && /^1\./.test(String(h.fw))); }
    function setupText() {
      var s = G.configState(), c = G.config();
      if (oldFirmware()) return 'old firmware: flash sk_glove 2.0';
      if (s === 'ok' && c) return c.cal ? 'setup saved on glove ' + fmtTime(c.cal.at) : 'fingers found, not calibrated';
      if (s === 'damaged') return 'setup on glove is damaged: run Set up glove again';
      if (s === 'none') return 'not set up';
      return 'reading setup…';
    }

    function renderStatus() {
      var s = G.status();
      var sim = G.isSimulator();
      var connected = s === 'connected';
      var dot = $('g-dot');
      dot.className = 'dot' + (connected ? ' ok' : s === 'reconnecting' || s === 'connecting' ? ' warn' : s === 'unsupported' ? ' bad' : '');
      var title, sub;
      if (s === 'unsupported') { title = 'Glove not available in this browser'; sub = 'Turn on the simulator below to test without hardware.'; }
      else if (s === 'connecting') { title = 'Connecting…'; sub = 'Opening the glove\'s USB port.'; }
      else if (s === 'reconnecting') { title = 'Glove disconnected — reconnecting…'; sub = 'The cable was unplugged. Plug it back in; it reconnects by itself.'; }
      else if (connected) {
        title = sim ? 'Simulator connected' : 'Glove connected';
        var h = G.info();
        var parts = h ? [h.device, 'firmware ' + h.fw, (h.channels || h.fingers || '?') + (h.channels ? ' channels' : ' fingers'),
          'IMU ' + (h.imu ? 'yes' + (h.i2c ? ' (' + h.i2c + ')' : '') : 'no')] : ['waiting for hello…'];
        parts.push(G.stats().linesPerSec + ' readings/s');
        if (h) parts.push(setupText());
        sub = parts.join(' · ');
      } else { title = 'Glove not connected'; sub = 'Plug the gloves into a USB port, then tap Connect. The kiosk remembers them next time.'; }
      $('g-title').textContent = title;
      $('g-sub').textContent = sub;
      $('g-connect').hidden = connected;
      $('g-connect').disabled = s === 'unsupported' || s === 'connecting';
      $('g-setup').hidden = !connected;
      $('g-setup').disabled = !G.info() || oldFirmware();
      $('g-disconnect').hidden = !connected;
      $('g-unsupported').hidden = !(s === 'unsupported' || (!sim && !('serial' in navigator && window.isSecureContext)));
      $('g-oldfw').hidden = !(connected && oldFirmware());
      $('g-simcard').hidden = connected;
      $('g-placeholder').hidden = connected;
      $('g-live').hidden = !connected;
      var cfg = G.config();
      $('g-hands').hidden = !cfg;
      $('g-notset').hidden = !!cfg;
      if (cfg) {
        ['L', 'R'].forEach(function (h) {
          cfg.map[h].forEach(function (c, i) { $('trk' + h + i).classList.toggle('off', c === null); });
        });
        $('imu-hand').textContent = cfg.imuHand ? 'On the ' + (cfg.imuHand === 'L' ? 'left' : 'right') + ' hand' : 'Hand not set';
      }
      document.querySelectorAll('[data-sim]').forEach(function (b) { b.setAttribute('aria-checked', sim ? 'true' : 'false'); });
    }

    function renderData(d) {
      if (!d) return;
      if (d.hands) {
        ['L', 'R'].forEach(function (h) {
          d.hands[h].norm.forEach(function (v, i) {
            $('bar' + h + i).style.height = v === null ? '0' : Math.round(v * 100) + '%';
            $('val' + h + i).textContent = v === null ? '–' : v.toFixed(2);
            var raw = d.hands[h].raw[i];
            $('raw' + h + i).textContent = raw === null ? '–' : raw;
          });
        });
      }
      var imu = d.imu;
      $('g-imu').hidden = !imu;
      $('g-imu-none').hidden = !!imu;
      if (imu) {
        var deg = 180 / Math.PI;
        $('imu-tx').textContent = Math.round(Math.atan2(imu.ay, imu.az) * deg) + '°';
        $('imu-ty').textContent = Math.round(Math.atan2(-imu.ax, Math.hypot(imu.ay, imu.az)) * deg) + '°';
        $('imu-turn').textContent = Math.round(imu.gz) + '°/s';
      }
    }
    // bars at most every animation frame (30 lines/s, cheap on the Pi)
    var pendingData = null;
    G.on('data', function (d) {
      if (su.collect) su.collect(d);
      if (pendingData === null) requestAnimationFrame(function () { renderData(pendingData); pendingData = null; });
      pendingData = d;
    });
    G.on('status', function () {
      renderStatus();
      if (screen === 'setup' && G.status() !== 'connected') failSetup('The glove disconnected. Plug it back in, then start Set up glove again.');
    });
    G.on('hello', renderStatus);
    G.on('config', function () { renderStatus(); renderCfg(); });

    $('g-connect').addEventListener('click', function () { G.connect().then(renderStatus); });
    $('g-disconnect').addEventListener('click', function () { G.disconnect().then(renderStatus); });
    document.querySelectorAll('[data-sim]').forEach(function (b) {
      b.addEventListener('click', function () {
        var on = !G.isSimulator();
        G.simulator(on).then(function () { renderStatus(); if (on) G.connect().then(renderStatus); });
      });
    });

    // ════════ Set up glove ════════
    var ORDER = [];   // the 10 finger steps: right thumb..pinky, then left thumb..pinky
    ['R', 'L'].forEach(function (h) { NAMES.forEach(function (_, i) { ORDER.push({ h: h, i: i }); }); });
    var REST_MS = 1000, BEND_MS = 2000, MOVE_MIN = 150, CLEAR = 2, CAL_READY_MS = 1000, CAL_REC_MS = 3000;
    var CAM_SCORE = 0.8, CAM_FRAMES = 5, CAM_WAIT_MS = 5000;
    var su = { collect: null };   // collect(d): the running step's sample sink
    var suTimer = null;

    function median(list) { var s = list.slice().sort(function (a, b) { return a - b; }); return s.length ? s[Math.floor(s.length / 2)] : null; }
    function fingerLabel(h, i) { return h + ' ' + NAMES[i].toLowerCase(); }
    function stopTimers() { clearInterval(suTimer); suTimer = null; su.collect = null; }

    function openSetup() {
      stopTimers();
      su.map = { L: [null, null, null, null, null], R: [null, null, null, null, null] };
      su.skipped = {};
      su.cal = null;
      su.cam = null;
      su.camSkipped = false;
      su.imuHand = null;
      su.k = 0;
      show('setup');
      gotoStep('fingers');
    }
    function leaveSetup() {
      stopTimers();
      stopCamera();
      show('settings');
      renderStatus();
    }
    function failSetup(msg) {
      stopTimers();
      stopCamera();
      ['su-f-msg', 'su-c-msg', 'su-s-msg'].forEach(function (id) { $(id).className = 'su-msg'; $(id).textContent = msg; });
      $('su-next').disabled = true;
      $('su-retry').hidden = true;
      $('su-skip').hidden = true;
    }
    function hasImu() { var h = G.info(); return !!(h && h.imu); }
    function gotoStep(name) {
      stopTimers();
      if (name !== 'cam') stopCamera();
      su.step = name;
      var order = ['fingers', 'cal', 'cam', 'imu', 'save'];
      var at = order.indexOf(name);
      document.querySelectorAll('#su-steps span').forEach(function (s) {
        var k = order.indexOf(s.dataset.step);
        s.className = k === at ? 'on' : k < at ? 'done' : '';
        if (s.dataset.step === 'imu') s.hidden = !hasImu();
      });
      document.querySelectorAll('.su-panel').forEach(function (p) { p.classList.toggle('on', p.id === 'su-' + name); });
      $('su-retry').hidden = true;
      $('su-skip').hidden = true;
      $('su-next').hidden = name === 'save';
      $('su-next').disabled = true;
      $('su-savebtn').hidden = name !== 'save';
      if (name === 'fingers') { renderChips(); runFinger(); }
      else if (name === 'cal') startCal();
      else if (name === 'cam') startCamStep();
      else if (name === 'imu') renderImuPick();
      else if (name === 'save') renderSummary();
    }
    function nextStep() {
      if (su.step === 'fingers') gotoStep('cal');
      else if (su.step === 'cal') gotoStep('cam');
      else if (su.step === 'cam') gotoStep(hasImu() ? 'imu' : 'save');
      else if (su.step === 'imu') gotoStep('save');
    }
    $('g-setup').addEventListener('click', openSetup);
    $('su-next').addEventListener('click', nextStep);
    $('su-retry').addEventListener('click', function () {
      if (su.step === 'fingers') runFinger();
      else if (su.step === 'cal') startCal();
      else if (su.step === 'cam') startCamStep();
    });
    $('su-skip').addEventListener('click', function () {
      if (su.step === 'fingers') {
        var f = ORDER[su.k];
        su.skipped[f.h + f.i] = true;
        su.k++;
        renderChips();
        runFinger();
      } else if (su.step === 'cam') {
        su.cam = null;
        su.camSkipped = true;
        stopCamera();
        $('su-c-msg').className = 'su-msg';
        $('su-c-msg').textContent = 'Skipped: without this step Let\'s Talk will not use the glove.';
        $('su-skip').hidden = true;
        $('su-retry').hidden = false;
        $('su-next').disabled = false;
      }
    });

    // ── 1. Fingers: 1 s rest (baseline = median per channel), 2 s bending (largest change wins) ──
    function renderChips() {
      $('su-f-chips').innerHTML = ORDER.map(function (f, k) {
        var c = su.map[f.h][f.i];
        var cls = c !== null ? 'found' : su.skipped[f.h + f.i] ? 'skip' : '';
        if (su.step === 'fingers' && k === su.k) cls += ' now';
        return '<div class="chip ' + cls + '"><span>' + fingerLabel(f.h, f.i) + '</span><span>' +
          (c !== null ? 'C' + c : su.skipped[f.h + f.i] ? 'skipped' : '–') + '</span></div>';
      }).join('');
    }
    function runFinger() {
      stopTimers();
      $('su-retry').hidden = true;
      $('su-skip').hidden = true;
      if (su.k >= ORDER.length) {
        $('su-f-phase').textContent = 'ALL FINGERS DONE';
        $('su-f-title').textContent = 'All 10 fingers checked';
        $('su-f-prog').style.width = '100%';
        $('su-f-prog').className = 'done';
        var found = ORDER.filter(function (f) { return su.map[f.h][f.i] !== null; }).length;
        $('su-f-msg').className = found ? 'su-msg ok' : 'su-msg';
        $('su-f-msg').textContent = found ? found + ' of 10 fingers found. Tap Next to calibrate.' : 'No finger was found: check the wiring (Debug shows all 16 channels), then start again.';
        $('su-next').disabled = !found;
        renderChips();
        return;
      }
      var f = ORDER[su.k];
      $('su-f-title').textContent = 'Bend your ' + HAND_NAME[f.h] + ' ' + NAMES[f.i].toLowerCase();
      $('su-f-msg').textContent = '';
      $('su-f-prog').style.width = '0';
      $('su-f-prog').className = '';
      $('su-f-phase').textContent = 'REST · KEEP STILL';
      renderChips();
      var rest = [], bend = [];
      var t0 = Date.now();
      su.collect = function (d) { (Date.now() - t0 < REST_MS ? rest : bend).push(d.ch); };
      suTimer = setInterval(function () {
        var t = Date.now() - t0;
        if (t >= REST_MS) $('su-f-phase').textContent = 'BEND NOW · BEND AND STRAIGHTEN IT';
        $('su-f-prog').style.width = Math.min(100, t / (REST_MS + BEND_MS) * 100) + '%';
        if (t < REST_MS + BEND_MS) return;
        stopTimers();
        judgeFinger(f, rest, bend);
      }, 50);
    }
    function judgeFinger(f, rest, bend) {
      $('su-f-phase').textContent = '';
      if (rest.length < 5 || bend.length < 10) return fingerProblem('No glove data (' + (rest.length + bend.length) + ' readings). Check the glove is connected, then Retry.');
      // move = the largest distance from the resting median while bending, minus how much the channel
      // already wandered at rest, so an unconnected (floating) mux channel's noise never wins.
      // The winner must also move at least CLEAR x as much as any other channel (one finger only).
      var best = -1, bestMove = 0, second = -1, secondMove = 0;
      for (var c = 0; c < G.CHANNELS; c++) {
        var restVals = rest.map(function (r) { return r[c]; });
        var base = median(restVals);
        var noise = Math.max.apply(null, restVals) - Math.min.apply(null, restVals);
        var move = 0;
        bend.forEach(function (r) { move = Math.max(move, Math.abs(r[c] - base)); });
        move -= noise;
        if (move > bestMove) { second = best; secondMove = bestMove; bestMove = move; best = c; }
        else if (move > secondMove) { secondMove = move; second = c; }
      }
      if (bestMove <= MOVE_MIN) {
        return fingerProblem('No sensor moved (largest change ' + Math.round(bestMove) + ', needs more than ' + MOVE_MIN + '). Check this finger\'s wire, then Retry, or Skip it.');
      }
      if (bestMove < CLEAR * secondMove) {
        return fingerProblem('C' + best + ' and C' + second + ' moved about the same (' + Math.round(bestMove) + ' / ' + Math.round(secondMove) + '). Keep the other fingers still, then Retry.');
      }
      var owner = null;
      ORDER.forEach(function (o) { if (su.map[o.h][o.i] === best) owner = o; });
      if (owner) {
        return fingerProblem('C' + best + ' is already ' + fingerLabel(owner.h, owner.i) + '. Bend only the ' + HAND_NAME[f.h] + ' ' + NAMES[f.i].toLowerCase() + ', then Retry.');
      }
      su.map[f.h][f.i] = best;
      delete su.skipped[f.h + f.i];
      $('su-f-prog').className = 'done';
      $('su-f-msg').className = 'su-msg ok';
      $('su-f-msg').textContent = 'Found: C' + best + ' (change ' + Math.round(bestMove) + ').';
      renderChips();
      su.k++;
      suTimer = setTimeout(function () { suTimer = null; runFinger(); }, 700);
    }
    function fingerProblem(msg) {
      $('su-f-msg').className = 'su-msg';
      $('su-f-msg').textContent = msg;
      $('su-retry').hidden = false;
      $('su-skip').hidden = false;
    }

    // ── 2. Calibrate both hands: 1 s ready, 3 s open, 1 s ready, 3 s fists; median per channel ──
    function startCal() {
      stopTimers();
      su.cal = null;
      su.calVals = { open: null, fist: null };
      $('su-retry').hidden = true;
      ['1', '2'].forEach(function (k) { $('s' + k + '-prog').style.width = '0'; $('s' + k + '-prog').className = ''; $('s' + k + '-vals').textContent = ''; });
      runCal(1);
    }
    function calLine(vals) {
      return ['L', 'R'].map(function (h) {
        return h + ': ' + su.map[h].map(function (c) { return c === null ? '–' : vals[c]; }).join(' · ');
      }).join('<br>');
    }
    function runCal(n) {
      var lbl = $('s' + n + '-lbl'), prog = $('s' + n + '-prog');
      $('cal-open').classList.toggle('on', n === 1);
      $('cal-fist').classList.toggle('on', n === 2);
      lbl.textContent = 'STEP ' + n + ' · GET READY…';
      var t0 = Date.now(), samples = null;
      suTimer = setInterval(function () {
        var t = Date.now() - t0;
        if (t < CAL_READY_MS) return;
        if (!samples) { samples = []; su.collect = function (d) { samples.push(d.ch); }; lbl.textContent = 'STEP ' + n + ' · RECORDING…'; }
        prog.style.width = Math.min(100, (t - CAL_READY_MS) / CAL_REC_MS * 100) + '%';
        if (t < CAL_READY_MS + CAL_REC_MS) return;
        stopTimers();
        if (samples.length < 10) {
          lbl.textContent = 'STEP ' + n;
          $('su-retry').hidden = false;
          $('s' + n + '-vals').textContent = 'No glove data (' + samples.length + ' readings). Check the glove is connected, then Retry.';
          return;
        }
        var med = [];
        for (var c = 0; c < G.CHANNELS; c++) med.push(median(samples.map(function (s) { return s[c]; })));
        su.calVals[n === 1 ? 'open' : 'fist'] = med;
        prog.className = 'done';
        lbl.textContent = 'STEP ' + n + ' · DONE ✓';
        $('s' + n + '-vals').innerHTML = calLine(med) + '<br>(' + samples.length + ' readings)';
        if (n === 1) { runCal(2); return; }
        $('cal-fist').classList.remove('on');
        var cal = { at: new Date().toISOString() }, flat = [];
        ['L', 'R'].forEach(function (h) {
          cal[h] = { open: [], fist: [] };
          su.map[h].forEach(function (c, i) {
            var o = c === null ? 0 : su.calVals.open[c], fi = c === null ? 0 : su.calVals.fist[c];
            cal[h].open.push(o);
            cal[h].fist.push(fi);
            if (c !== null && Math.abs(fi - o) < 50) flat.push(fingerLabel(h, i));
          });
        });
        su.cal = cal;
        $('su-retry').hidden = false;
        $('s2-vals').innerHTML += flat.length ? '<br><b style="color:var(--red)">Open and fist almost the same for ' + flat.join(', ') + ': that finger will be ignored. Retry, or check its sensor.</b>' : '';
        $('su-next').disabled = false;
      }, 50);
    }

    // ── 3. Camera: MediaPipe's handedness label for the RIGHT hand on this kiosk's camera ──
    // Same pipeline as Let's Talk (js/gesture-data.js), so the label means the same thing there.
    var camStream = null, camOff = null;
    function stopCamera() {
      if (camOff) { camOff(); camOff = null; }
      try { if (window.GestureDataRecorder) window.GestureDataRecorder.pauseHandLoop(); } catch (e) { /* not started */ }
      if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
      $('su-video').srcObject = null;
    }
    function camMsg(text, ok) { $('su-c-msg').className = ok ? 'su-msg ok' : 'su-msg'; $('su-c-msg').textContent = text; }
    function camFeed(results) {
      if (su.step !== 'cam' || su.cam) return;
      var hs = (results && results.multiHandedness) || [];
      if (hs.length !== 1) return;
      var lab = hs[0].label, score = hs[0].score;
      if ((lab !== 'Left' && lab !== 'Right') || !(score >= CAM_SCORE)) return;
      if (!su.camFirstAt) su.camFirstAt = Date.now();
      su.camVotes[lab]++;
      if (su.camVotes.Left + su.camVotes.Right < CAM_FRAMES) return;
      var label = su.camVotes.Left > su.camVotes.Right ? 'Left' : 'Right';
      su.cam = { mirror: label === 'Left' };
      stopTimers();
      stopCamera();
      camMsg('Your right hand is seen as "' + label + '" on this camera: ' + (su.cam.mirror ? 'mirror on' : 'mirror off') + '. Tap Next.', true);
      $('su-retry').hidden = false;
      $('su-skip').hidden = true;
      $('su-next').disabled = false;
    }
    window.__skGloveSetup = { camFeed: camFeed };   // tests: hand results without a real hand
    function startCamStep() {
      stopTimers();
      stopCamera();
      su.cam = null;
      su.camSkipped = false;
      su.camVotes = { Left: 0, Right: 0 };
      su.camFirstAt = 0;
      $('su-retry').hidden = true;
      $('su-skip').hidden = false;
      $('su-next').disabled = true;
      camMsg('Starting the camera…', true);
      var started = Date.now();
      suTimer = setInterval(function () {
        if (su.cam) { stopTimers(); return; }
        var since = su.camFirstAt || started;
        if (Date.now() - since < CAM_WAIT_MS + (su.camFirstAt ? 0 : 10000)) return;   // 10 s to start + 5 s to decide
        stopTimers();
        stopCamera();
        camMsg('No clear right hand seen. Raise only the right hand, open, then Retry. Or Skip.', false);
        $('su-retry').hidden = false;
      }, 200);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.GestureDataRecorder) {
        camMsg('The camera cannot be used on this page. Skip this step, or open Settings on http://localhost.', false);
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        .then(function (stream) {
          if (su.step !== 'cam') { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
          camStream = stream;
          var v = $('su-video');
          v.srcObject = stream;
          return v.play().catch(function () { /* autoplay muted */ }).then(function () {
            return window.GestureDataRecorder.setupMediaPipe(v);
          }).then(function (ok) {
            if (!ok || su.step !== 'cam' || !camStream) return;
            window.GestureDataRecorder.resumeHandLoop();
            camOff = window.GestureDataRecorder.onHandResults(camFeed);
            camMsg('Camera on. Raise your RIGHT hand.', true);
          });
        })
        .catch(function (e) {
          camMsg('Camera not available (' + (e && e.name ? e.name : e) + '). Check the camera, then Retry, or Skip.', false);
          $('su-retry').hidden = false;
        });
    }

    // ── 4. IMU hand ──
    function renderImuPick() {
      ['L', 'R'].forEach(function (h) { $('su-imu-' + h).classList.toggle('on', su.imuHand === h); });
      $('su-next').disabled = !su.imuHand;
    }
    ['L', 'R'].forEach(function (h) {
      $('su-imu-' + h).addEventListener('click', function () { su.imuHand = h; renderImuPick(); });
    });

    // ── 5. Save on the glove ──
    function buildConfig() {
      var old = G.config();
      return { v: 1, map: su.map, cal: su.cal, cam: su.cam, imuHand: hasImu() ? su.imuHand : null,
        w: old && typeof old.w === 'number' ? old.w : G.DEFAULT_W };
    }
    function renderSummary() {
      var c = buildConfig();
      var rows = [];
      ['R', 'L'].forEach(function (h) {
        rows.push([HAND_NAME[h] + ' hand', c.map[h].map(function (ch, i) { return NAMES[i] + ' ' + (ch === null ? '–' : 'C' + ch); }).join(' · ')]);
      });
      rows.push(['Calibration', c.cal ? 'open + fist recorded ' + fmtTime(c.cal.at) : 'missing']);
      rows.push(['Camera', c.cam ? (c.cam.mirror ? 'mirror on' : 'mirror off') : 'skipped (Let\'s Talk will not use the glove)']);
      if (hasImu()) rows.push(['IMU', c.imuHand === 'L' ? 'left hand' : c.imuHand === 'R' ? 'right hand' : 'not set']);
      $('su-sum').innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('');
      $('su-s-msg').textContent = '';
      $('su-savebtn').disabled = !c.cal;
    }
    $('su-savebtn').addEventListener('click', function () {
      $('su-savebtn').disabled = true;
      $('su-s-msg').className = 'su-msg ok';
      $('su-s-msg').textContent = 'Saving on the glove…';
      G.saveConfig(buildConfig()).then(function () {
        leaveSetup();
      }).catch(function (e) {
        $('su-s-msg').className = 'su-msg';
        $('su-s-msg').textContent = (e && e.message ? e.message : String(e)) + ' — tap Save on glove to try again.';
        $('su-savebtn').disabled = false;
      });
    });

    // ── debug panel ──
    $('dbg-toggle').addEventListener('click', function () {
      var open = !$('dbg').classList.contains('open');
      $('dbg').classList.toggle('open', open);
      $('dbg-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
      $('dbg-caret').innerHTML = open ? '&#9662;' : '&#9656;';
      if (open) { renderConsole(); renderCounters(); renderCfg(); $('dbg').scrollIntoView({ block: 'start' }); }
    });

    var CONSOLE_MAX = 200;
    var paused = false, clearedAt = 0, consoleDirty = true;
    function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }
    function stamp(ms) { var d = new Date(ms); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
    function renderConsole() {
      if (!$('dbg').classList.contains('open') || paused || !consoleDirty) return;
      consoleDirty = false;
      var lines = G.log().filter(function (e) { return e.at >= clearedAt; }).slice(-CONSOLE_MAX);
      var el = $('console');
      el.innerHTML = lines.map(function (e) {
        var cls = e.dir === 'out' ? 'out' : e.ok ? '' : 'badl';
        var text = (e.dir === 'out' ? '> ' : '') + esc(e.line) + (e.ok ? '' : '   ✖ ' + esc(e.error));
        return '<div class="' + cls + '"><span class="ts">' + stamp(e.at) + '</span> ' + text + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }
    function renderCfg() {
      var c = G.config(), s = G.configState();
      $('d-cfg').textContent = c ? JSON.stringify(c) : s === 'damaged' ? 'damaged (not valid): run Set up glove again' : s === 'none' ? 'none' : '–';
      $('d-cfgclear').disabled = G.status() !== 'connected' || s === 'none';
    }
    G.on('raw', function () { consoleDirty = true; });
    $('d-pause').addEventListener('click', function () {
      paused = !paused;
      $('d-pause').textContent = paused ? 'Resume' : 'Pause';
      consoleDirty = true;
      renderConsole();
    });
    $('d-clear').addEventListener('click', function () { clearedAt = Date.now(); consoleDirty = true; $('console').innerHTML = ''; });
    $('d-hello').addEventListener('click', function () { G.send('hello'); });
    $('d-ping').addEventListener('click', function () { $('d-rtt').textContent = 'round trip …'; G.ping(); });
    G.on('pong', function (p) { $('d-rtt').textContent = 'round trip ' + p.rtt + ' ms'; });
    $('d-send').addEventListener('click', function () {
      var v = $('d-line').value.trim();
      if (v) G.send(v);
    });
    $('d-line').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('d-send').click(); });
    $('d-mmreset').addEventListener('click', function () { G.resetMinMax(); renderCounters(); });
    $('d-cfgclear').addEventListener('click', function () {
      $('d-cfgclear').disabled = true;
      G.clearConfig().catch(function (e) { $('d-cfg').textContent = 'Not cleared: ' + (e && e.message ? e.message : e); }).then(renderCfg);
    });
    $('d-download').addEventListener('click', function () {
      var text = G.log().map(function (e) {
        return new Date(e.at).toISOString() + ' ' + (e.dir === 'out' ? '> ' : '< ') + e.line + (e.ok ? '' : '   [BAD: ' + e.error + ']');
      }).join('\n') + '\n';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = 'glove-log-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });

    function usedBy() {
      var by = {}, c = G.config();
      if (!c) return by;
      ['L', 'R'].forEach(function (h) { c.map[h].forEach(function (ch, i) { if (ch !== null) by[ch] = fingerLabel(h, i); }); });
      return by;
    }
    function ago(ms) { return ms === null ? '–' : ms < 10000 ? ms + ' ms' : Math.round(ms / 1000) + ' s'; }
    function renderCounters() {
      var s = G.stats();
      $('c-lps').textContent = s.linesPerSec;
      $('c-lines').textContent = s.lines;
      $('c-bad').textContent = s.bad;
      $('c-age').textContent = ago(s.lastDataAgeMs);
      $('c-hello').textContent = ago(s.sinceHelloMs);
      $('c-rec').textContent = s.reconnects;
      var now = G.latest(), by = usedBy();
      var rows = '';
      for (var c = 0; c < G.CHANNELS; c++) {
        var mn = s.min[c], mx = s.max[c];
        rows += '<tr' + (by[c] ? ' class="used"' : '') + '><td>C' + c + '</td><td>' + (by[c] || '–') + '</td><td>' + (mn === null ? '–' : mn) + '</td><td>' +
          (mx === null ? '–' : mx) + '</td><td>' + (mn === null ? '–' : mx - mn) + '</td><td>' + (now ? now.ch[c] : '–') + '</td></tr>';
      }
      $('mm').innerHTML = rows;
      // hints (docs/system/GLOVE.md "Debugger hints")
      var hints = [];
      if (G.status() === 'connected') {
        if (s.connectedMs > 3000 && !G.info()) hints.push('No hello from the glove: firmware not sending hello, or wrong baud rate (must be 115200).');
        if (oldFirmware()) hints.push('Old firmware (1.x): flash sk_glove 2.0 (tools/glove-firmware/README.md).');
        if (G.configState() === 'damaged') hints.push('The setup stored on the glove is damaged: run Set up glove again.');
        if (s.connectedMs > 3000 && s.linesPerSec < 10) hints.push('Only ' + s.linesPerSec + ' lines/s: check the firmware delay (should be ~33 ms).');
        if (s.recent.length >= 30) {
          Object.keys(by).forEach(function (ch) {
            [0, 4095].forEach(function (v) {
              if (s.recent.every(function (r) { return r[ch] === v; })) hints.push('C' + ch + ' (' + by[ch] + '): always ' + v + ': sensor not connected / check the voltage divider.');
            });
          });
          for (var k = 0; k < G.CHANNELS; k++) {
            if (by[k] && s.min[k] !== null && s.max[k] - s.min[k] < 20 && s.data > 300) hints.push('C' + k + ' (' + by[k] + ') never changes: check that finger\'s sensor and wire.');
          }
        }
        if (s.lastBadAgeMs !== null && s.lastBadAgeMs < 5000) hints.push('Bad lines (last: ' + s.lastBad + '): check the firmware prints one JSON object per line.');
      }
      $('hints').innerHTML = hints.length
        ? hints.map(function (h) { return '<div class="hint">' + esc(h) + '</div>'; }).join('')
        : (G.status() === 'connected' ? '<div class="hint ok">No problems seen.</div>' : '');
    }
    setInterval(function () {
      if ($('dbg').classList.contains('open')) { renderCounters(); renderConsole(); renderCfg(); }
      if (G.status() === 'connected' && screen === 'settings') renderStatus();   // readings/s in the device line
    }, 500);

    renderStatus();
    G.autoReconnect().then(renderStatus);
  })();
  </script>
</body>
</html>
```

- [ ] **Step 5: Run the check**

Run: `node tests/glove/settings-check.mjs --shots /tmp/glove-shots` (see "Test environment")
Expected: 34 `PASS` lines, `ALL CHECKS PASSED`, exit code 0. Look at `/tmp/glove-shots/glove-hw-*.png`: nothing overlaps, the finger labels under the bars are readable.

- [ ] **Step 6: Run Task 1's check again** (the page and the module together must not have changed it)

Run: `node tests/glove/glove-core-check.mjs`
Expected: `ALL CHECKS PASSED`.

- [ ] **Step 7: Commit**

```bash
git add settings.html tests/glove/settings-check.mjs tests/glove/no-db-router.php
git commit -m "settings: two gloves, Set up glove (fingers, calibrate, camera, IMU, save on glove), 16-channel debug"
```

---

### Task 4: Docs, report, push, laptop copy

**Files:**
- Modify (full rewrite): `docs/system/GLOVE.md`
- Modify: `docs/system/UI.md` (Part 5, from `## Part 5: Settings` to the end of that part)
- Modify: `docs/system/PI-SETUP.md` (the two glove checklist items)
- Create: `docs/reports/2026-10-21-glove-hw-final.md`, `docs/reports/img/glove-hw-1-not-connected.png` … `glove-hw-9-two-hands.png` (from Task 3's `--shots`)

**Interfaces:**
- Consumes: Tasks 1-3 as built and their measured check output.
- Produces: the docs the owner and Phase 2 read.

- [ ] **Step 1: Replace `docs/system/GLOVE.md`**

````markdown
# GLOVE.md — optional wired data gloves (protocol v2, glove-hw phase, 2026-10-21)

Two gloves (left and right) with 10 flex sensors on a CD74HC4067 16-channel mux, one ESP32, an optional MPU6050,
on one USB cable to the Pi (or the laptop while testing). Hardware and decisions:
`docs/superpowers/specs/2026-10-21-glove-hardware-design.md`. Protocol v1 (5 fingers on GPIO 32-36, glove-serial
phase 2026-10-20) is replaced; a v1 glove is reported as "old firmware".

What exists:
- the protocol (this file);
- `js/glove.js` (`window.SKGlove`);
- Settings -> Glove with Set up glove and the debugger (`settings.html`);
- the firmware (`tools/glove-firmware/sk_glove/`).

**Recognition does not use the glove yet** (Phase 2 of the design). Future code reads it through
`window.SKGlove` (below), and only when `SKGlove.ready()`.

Everything that reads or writes glove lines follows this file: the firmware, `js/glove.js` and its simulator.

## Hardware (as the owner's diagram)

| | |
|---|---|
| Mux select | S0 GPIO 14, S1 GPIO 27, S2 GPIO 26, S3 GPIO 25 |
| Mux output | SIG -> GPIO 34 (ADC1); EN -> GND; VCC 3V3 with 0.1 µF |
| Sensors | FS1-FS10 on C0-C9 (the diagram; Set up glove finds the real channels). Each: 3V3 - sensor - C-pin - R - GND, so a reading **drops** when the finger bends |
| IMU | MPU6050 / GY-521 on I2C SDA 21 / SCL 22 (the firmware also tries 22 / 21) |
| Power | USB only. The diagram's 18650 + TP4056 + SW1 are not used: SW1 OFF while USB is plugged in |

## Link

| | |
|---|---|
| Transport | USB serial (the ESP32's USB-UART bridge), **115200 baud**, 8N1 |
| Framing | one JSON object per line, UTF-8, ending in `\n` (a `\r` before it is ignored) |
| Rate | about **30 data lines per second** (one every ~33 ms) |
| Browser | Web Serial (`navigator.serial`), Chromium / Chrome only |
| Secure context | Web Serial exists only in a secure context. **`http://localhost` counts (the kiosk), a LAN address such as `http://192.168.1.20/SKR/` does not**, and neither does Firefox. The page then shows "This browser can't use the glove." |
| Pi | `tools/pi/pi-setup.sh` sets the Chromium policy `SerialAllowAllPortsForUrls: ["http://localhost"]` (no port picker) and adds the kiosk user to `dialout` |

## Glove -> page

**Hello**, sent once on boot and again whenever the page sends `hello`:

```json
{"type":"hello","device":"sk-glove","fw":"2.0","channels":16,"imu":true,"i2c":"21/22","hasCfg":true}
```

- `imu`: `false` when no MPU6050 answered at boot (on either pin order); `i2c` is the order that worked, SDA/SCL.
- `hasCfg`: a setup is stored on the glove. The hello never carries the setup itself, so a damaged stored setup
  cannot break it. After a hello with `hasCfg: true` the page sends `cfg-get`.

**Data**, about 30 per second:

```json
{"t":123456,"ch":[3290,3310,3305,1320,3275,3301,3288,3296,3310,3279,41,38,29,44,35,40]}
{"t":123489,"ch":[...16 values...],"imu":{"ax":0.02,"ay":-0.21,"az":0.97,"gx":1.5,"gy":-0.4,"gz":31.0}}
```

- `t`: the glove's `millis()`, an integer that only grows (it restarts at 0 on reboot).
- `ch`: **16 integers, raw ADC 0-4095** (12-bit), mux channels C0-C15 in order. The firmware never says which
  channel is which finger; the setup does. Unused channels read whatever their pin floats to.
- `imu` (only when the hello said `imu: true`): `ax ay az` in **g**, `gx gy gz` in **degrees per second**, at most
  2 decimals each.

**Answers:**

```json
{"type":"pong","t":123500}
{"type":"cfg","cfg":{...the stored setup, verbatim...}}
{"type":"cfg","cfg":null}
{"type":"cfg-ok"}
{"type":"cfg-error","why":"too long"}
```

## Page -> glove

One line each, ending in `\n`:

| Line | Answer |
|---|---|
| `hello` | the hello line again |
| `ping` | `{"type":"pong","t":<millis>}` (the page measures the round trip) |
| `cfg-get` | `{"type":"cfg","cfg":<stored setup or null>}` |
| `cfg-set <json>` | stores `<json>` in flash (survives unplugging) -> `cfg-ok`; `cfg-error` with `why`: `empty`, `too long` (over 1,000 characters), `not a JSON object`, `line break inside`, `flash write failed` |
| `cfg-clear` | removes the stored setup -> `cfg-ok` |

Anything else is ignored by the firmware. The firmware stores `cfg-set` text **verbatim** (it only checks the
length and the outer `{ }`); the page validates the setup before sending it and after reading it back.

## The setup (stored on the glove)

```json
{"v":1,
 "map":{"L":[5,6,7,8,9],"R":[0,1,2,3,4]},
 "cal":{"L":{"open":[3290,3301,3288,3296,3310],"fist":[1300,1302,1298,1299,1301]},
        "R":{"open":[...5],"fist":[...5]},"at":"2026-10-21T12:00:00.000Z"},
 "cam":{"mirror":true},
 "imuHand":"R",
 "w":0.3}
```

| Key | |
|---|---|
| `v` | 1 |
| `map.L` / `map.R` | the mux channel (0-15) of each finger, thumb -> pinky; `null` for a finger Set up glove skipped |
| `cal` | open and fist values per finger (median of 3 s each), and when; `null` before calibration. A skipped finger has 0 / 0 |
| `cam.mirror` | `true` when MediaPipe labels the wearer's **right** hand "Left" on this kiosk's camera; `null` when the camera step was skipped |
| `imuHand` | the hand with the MPU6050, or `null` |
| `w` | glove strength for the Phase 2 re-ranking, 0-1, default 0.3 |

`SKGlove.validateConfig(c)` is the rule: anything else (wrong version, a channel outside 0-15, a 6th finger, a
value outside 0-4095, `cal` without `at`, `w` outside 0-1, ...) is not valid. A stored setup that is not valid
JSON or not valid is reported as **damaged** ("run Set up glove again").

## Bad lines

A line that is not valid JSON, or valid JSON that is none of the lines above:
- is **counted** ("bad lines");
- is shown **in red** in the debugger console with the reason, e.g. "not JSON: Unexpected end of JSON input",
  "ch must be 16 integers 0-4095", "old firmware (5 fingers): flash sk_glove 2.0";
- **never** stops the reader or throws into the page. Empty lines are skipped and not counted.

## Values the page derives (`js/glove.js`)

- **Per finger** (only with a setup): `raw` = the mapped channel's value; `norm` = `(raw - open) / (fist - open)`,
  clamped to 0..1 (0 = open hand, 1 = fist), then a moving average of the last 3 readings. It works whichever way
  the divider is wired.
  - No calibration yet: `raw / 4095`.
  - A finger with no channel: `raw` and `norm` are `null`.
  - A finger whose open and fist are less than 50 apart: `norm` is `null` (ignored, not 0).
- **IMU on the page**: tilt X = `atan2(ay, az)`, tilt Y = `atan2(-ax, hypot(ay, az))` (degrees), turn = `gz`.

## `window.SKGlove`

| Member | |
|---|---|
| `CHANNELS`, `FINGERS`, `HANDS`, `DEFAULT_W` | 16, thumb..pinky, `['L','R']`, 0.3 |
| `isSupported()` | Web Serial present (or the simulator is on) |
| `status()` | `'unsupported'` / `'disconnected'` / `'connecting'` / `'connected'` / `'reconnecting'` |
| `connect()` | opens the port picker (`requestPort`, needs a tap), then the port. Simulator mode: starts the simulator |
| `autoReconnect()` | on page load: a port this browser already may use (`getPorts()`) is opened with no prompt |
| `disconnect()` | closes the port (or stops the simulator); no auto-reconnect afterwards |
| `send(line)` / `ping()` | writes one line / sends `ping` (the next pong fires `pong` with `{ rtt }`) |
| `on(event, cb)` | `'status'`, `'data'`, `'hello'`, `'config'`, `'raw'`, `'error'`, `'pong'`; returns an unsubscribe function |
| `latest()` | `{ t, ch: [16], hands: { L: { raw: [5], norm: [5] }, R: {...} } or null, imu, at }`, or null |
| `info()` | the last hello, or null |
| `config()` / `configState()` | the validated setup or null / `'unknown'`, `'none'`, `'ok'`, `'damaged'` |
| `validateConfig(c)` | a clean copy of a valid setup, or null |
| `saveConfig(c)` / `clearConfig()` | `cfg-set` / `cfg-clear`; resolve on `cfg-ok`, reject on `cfg-error`, a 2 s timeout or when not connected |
| `ready()` | connected **and** a setup with a calibration: the one test other pages use |
| `stats()` / `resetMinMax()` / `log()` | debugger counters, per-channel min/max (16), the last 2,000 lines |
| `simulator(on)` / `isSimulator()` / `simSetBend(ch, bend)` | the simulator source; hold a channel at a bend 0..1 (`null` releases) |

**Unplugged:** the status goes to `'reconnecting'`, the setup is forgotten until the next hello, `getPorts()` is
retried every 3 s, and the same glove plugged in again goes back to `'connected'` with no prompt (the reconnect
count goes up); its hello and `cfg-get` bring the setup back.

**Simulator** (the "Use simulator" switch, or `?glove=sim`): produces firmware 2.0's lines (`"fw":"2.0-sim"`):
C0-C4 = right thumb..pinky, C5-C9 = left thumb..pinky (about 3300 straight, about 1300 bent, a small idle wobble),
C10-C15 low noise, an IMU, one bad line about every 5 s. It answers `hello`, `ping`, `cfg-get`, `cfg-set`,
`cfg-clear`; its "flash" is `localStorage` `sk_glove_sim_cfg`, so a setup survives a reload. The switch is stored per
kiosk (`sk_glove_sim`).

## Set up glove (Settings -> Glove)

Full screen, in this order; Cancel leaves without saving:
1. **Fingers** — right thumb..pinky, then left thumb..pinky. Each: 1 s rest, then 2 s bending. Per channel,
   move = the largest distance from its resting median while bending, minus how much it wandered at rest. The
   channel with the largest move wins if move > 150 **and** it is at least 2x the next channel's; otherwise
   "No sensor moved" / "moved about the same" with Retry / Skip. A channel already given to another finger is
   refused ("C0 is already R thumb").
2. **Calibrate** — both hands open 3 s, both fists 3 s (1 s get-ready before each); median per channel.
3. **Camera** — "Raise your RIGHT hand": the same MediaPipe pipeline as Let's Talk (`js/gesture-data.js`); 5 frames
   with exactly one hand and a handedness score >= 0.8 decide `cam.mirror`. Skippable (then Phase 2 never uses the
   glove).
4. **IMU** (only when the hello says `imu: true`) — which hand has the sensor box.
5. **Save on glove** — `saveConfig()`; on `cfg-ok` back to Settings.

## Debugger hints (Settings -> Glove -> Debug)

| Condition | Hint |
|---|---|
| connected, no hello after 3 s | "No hello from the glove: firmware not sending hello, or wrong baud rate (must be 115200)." |
| hello `fw` 1.x | "Old firmware (1.x): flash sk_glove 2.0 (tools/glove-firmware/README.md)." |
| setup damaged | "The setup stored on the glove is damaged: run Set up glove again." |
| connected for 3 s and fewer than 10 lines/s | "Only N lines/s: check the firmware delay (should be ~33 ms)." |
| a mapped channel at 0 or 4095 for its last 30 readings | "C<n> (<finger>): always <value>: sensor not connected / check the voltage divider." |
| a mapped channel's min/max range under 20 after 300 data lines | "C<n> (<finger>) never changes: check that finger's sensor and wire." |
| bad lines in the last 5 s | "Bad lines (last: ...): check the firmware prints one JSON object per line." |

The Debug panel also shows the **16-channel table** (channel, used by, min, max, range, now), the **setup stored on
the glove** (JSON) and **Clear setup on glove**.

## Files

- `js/glove.js` — the module above (no libraries).
- `settings.html` — Admin -> Settings (General / Voice / Glove), admin only, linked from the admin menu.
- `tools/glove-firmware/sk_glove/sk_glove.ino`, `tools/glove-firmware/README.md` — firmware 2.0, wiring, first upload.
- `tests/glove/glove-core-check.mjs` (node, no browser), `tests/glove/settings-check.mjs` (headless Chrome, simulator),
  `tests/glove/no-db-router.php` (runs the browser check without MySQL).
````

- [ ] **Step 2: Replace UI.md Part 5** — the section that starts `## Part 5: Settings (glove-serial phase, 2026-10-20)` (it is the last part of the file) becomes:

```markdown
## Part 5: Settings (glove-serial phase 2026-10-20; two gloves and Set up glove, glove-hw phase 2026-10-21)

`settings.html`: Admin -> Settings, admin only (`SKAccount.adminPage()`), the last item of the admin menu
(`js/sk-account.js`). Sections General · Voice · Glove (General and Voice are placeholders). Glove:
- status with the device line from the hello (`sk-glove · firmware 2.0 · 16 channels · IMU yes (21/22) · 30
  readings/s · setup saved on glove today …` / `not set up` / `setup on glove is damaged…` / `old firmware…`);
- Connect / Set up glove / Disconnect;
- LEFT HAND and RIGHT HAND, 5 bars each (0-1, name, raw), striped for a finger with no channel; "Not set up yet"
  instead of the bars before Set up glove; the IMU (with its hand);
- Use simulator;
- **Set up glove**, full screen: 1 Fingers (10 steps, chips "R thumb C0"), 2 Calibrate (both hands open / two
  fists), 3 Camera (raise the right hand; MediaPipe's handedness -> mirror on/off; Skip), 4 IMU (Left / Right hand,
  only with an IMU), 5 Save on glove (summary). Cancel leaves without saving;
- a collapsible Debug panel: raw console, counters, commands, Download log, the 16-channel table (used by, min,
  max, range, now), the setup stored on the glove (JSON) with Clear setup on glove, hints.

Only the section's own column scrolls; the page itself does not at 1024x600 (Set up glove fits without
scrolling). Everything goes through `window.SKGlove` (`js/glove.js`); the protocol, the setup and the API are in
`docs/system/GLOVE.md`. No glove UI outside Settings; recognition does not use the glove yet. Checks:
`node tests/glove/glove-core-check.mjs` (no browser) and `node tests/glove/settings-check.mjs` (simulator,
headless Chrome).
```

- [ ] **Step 3: PI-SETUP.md glove lines** — replace exactly:

```markdown
   - [ ] **Glove simulator:** log in as admin -> name chip -> Settings -> Glove -> Use simulator: the bars move;
     Debug shows about 30 lines/s.
   - [ ] **Glove (if plugged):** Connect glove lists the ESP32, or it connects by itself thanks to the policy.
     `ls /dev/ttyUSB* /dev/ttyACM*` shows it.
```

with:

```markdown
   - [ ] **Glove simulator:** log in as admin -> name chip -> Settings -> Glove -> Use simulator: "Not set up yet"
     (the simulator's setup lives in each browser); Debug shows about 30 lines/s.
   - [ ] **Glove (if plugged):** it connects by itself thanks to the policy (no port picker) and shows
     "setup saved on glove …": the setup made on the laptop comes from the glove, so **no Set up glove on the
     Pi** (run it again only if the camera differs: its step 3 is about this kiosk's camera).
     `ls /dev/ttyUSB* /dev/ttyACM*` shows it.
```

- [ ] **Step 4: Copy the screenshots**

```bash
mkdir -p docs/reports/img && cp /tmp/glove-shots/glove-hw-*.png docs/reports/img/
```

- [ ] **Step 5: Write `docs/reports/2026-10-21-glove-hw-final.md`** with exactly these parts, every number copied from the runs (none estimated):
  1. Header: `Phase: glove-hw (Phase 1: hardware bring-up)` / `Date: 2026-10-21` / `Status: DONE` / `Decision needed from owner: none; run the OWNER CHECKLIST with the real gloves, then say go for Phase 2.`
  2. "What was built": the file map table above, one line each.
  3. "Checks run here": the full PASS output of both checks (counts), the screenshots table, and the compile result of Task 2 Step 3 (or "not compiled here" with the reason).
  4. "Not checked here": the real gloves, the real camera's handedness, the firmware on a board, the Pi.
  5. "OWNER CHECKLIST (laptop, real gloves)": (1) SW1 OFF; USB data cable; COM port in Device Manager (driver if not). (2) Arduino IDE: install esp32 board package, ESP32 Dev Module, Upload `sk_glove.ino`. (3) Serial Monitor 115200: hello with `"fw":"2.0"`; bend each finger: one of the first 10 numbers drops by hundreds; note any finger that does not. Close the Serial Monitor. (4) Ctrl+F5, Settings -> Glove -> Connect glove: "16 channels · IMU yes/no · ~30 readings/s · not set up". (5) Set up glove: all 10 fingers found (write down any "No sensor moved" / "moved about the same"), calibrate, camera (raise the right hand), IMU hand, Save on glove. (6) Bars: each finger 0 open, ~1 fist, on the right hand. (7) Unplug / plug: reconnects with no prompt, setup still there. (8) If anything fails: Debug -> Download log, send the file.

- [ ] **Step 6: Commit and push**

```bash
git add docs/system/GLOVE.md docs/system/UI.md docs/system/PI-SETUP.md docs/reports/2026-10-21-glove-hw-final.md docs/reports/img/glove-hw-*.png docs/superpowers/plans/2026-10-21-glove-hw-phase1.md docs/superpowers/specs/2026-10-21-glove-hardware-design.md
git commit -m "docs: glove-hw phase 1 — GLOVE.md protocol v2, UI.md Part 5, PI-SETUP, report"
git push origin glove-hw
```

- [ ] **Step 7: Copy the changed files to the owner's laptop** (`C:\xampp\htdocs\SKR`, not a git checkout): every file in `git diff --name-only origin/pi-fixes..glove-hw`, written with the device file tools; then tell the owner to press Ctrl+F5.
