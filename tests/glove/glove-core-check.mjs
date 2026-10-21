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
