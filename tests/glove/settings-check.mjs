// glove-serial phase: Settings -> Glove with the simulator (docs/system/GLOVE.md), headless Chrome
// at 1024x600 via tests/video-capture/cdp.mjs (logs in as the seeded admin):
//   connect (simulator), bars move, calibrate 2 x 3 s + Save (stored), Debug: console lines + a red
//   bad line, counters update, ping round trip, Download log (.txt with timestamps), min/max, no page
//   scroll, controls >= 44 px, 0 console errors. Also: the admin menu lists Settings.
// Run (server at SK_BASE, default http://localhost/SKR/): node tests/glove/settings-check.mjs [--shots <dir>]
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

const c = await launchChrome({ port: 9341 });
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-glove-dl-'));
await c.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(() =>
  c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }));
const ev = (x) => c.evaluate(x);
const click = (sel) => ev(`document.querySelector(${J(sel)}).click()`);
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

try {
  // 1. Not connected (simulator off): the wireframe's screen 1
  await c.navigate(BASE + 'settings.html');
  await ev(`localStorage.removeItem('sk_glove_sim'); localStorage.removeItem('sk_glove_calibration'); true`);
  await c.navigate(BASE + 'settings.html');
  const s1 = await ev(`({ status: SKGlove.status(), title: document.getElementById('g-title').textContent,
    connectVisible: !document.getElementById('g-connect').hidden, sim: document.querySelector('[data-sim]').getAttribute('aria-checked') })`);
  check('not connected: status, title, Connect glove, simulator off',
    ['disconnected', 'unsupported'].includes(s1.status) && /not connected|not available/.test(s1.title) && s1.connectVisible && s1.sim === 'false', J(s1));
  const l1 = await layout();
  check('1024x600: no page scroll, controls >= 44 px', l1.sw === 1024 && l1.sh === 600 && !l1.small.length, J(l1));
  await shot('glove-1-not-connected.png');

  // 2. Simulator on -> connected, hello, bars move
  await click('#g-simcard [data-sim]');
  await sleep(1500);
  const s2 = await ev(`({ status: SKGlove.status(), info: SKGlove.info(), sub: document.getElementById('g-sub').textContent,
    live: !document.getElementById('g-live').hidden, h0: document.getElementById('bar1').style.height })`);
  check('simulator: connected, hello parsed (sk-glove, 5 fingers, IMU)',
    s2.status === 'connected' && s2.info && s2.info.device === 'sk-glove' && s2.info.fingers === 5 && s2.info.imu === true && s2.live, J(s2));
  check('device line from the hello', /sk-glove · firmware 1\.0-sim · 5 fingers · IMU yes · \d+ readings\/s · not calibrated/.test(s2.sub), s2.sub);
  await sleep(800);
  const h1 = await ev(`[0,1,2,3,4].map((i) => document.getElementById('bar' + i).style.height)`);
  await sleep(800);
  const h2 = await ev(`[0,1,2,3,4].map((i) => document.getElementById('bar' + i).style.height)`);
  const raw = await ev(`[0,1,2,3,4].map((i) => document.getElementById('raw' + i).textContent)`);
  check('bars move (heights change over 0.8 s), raw values shown', J(h1) !== J(h2) && raw.every((t) => /· \d{3,4}$/.test(t)), J({ h1, h2, raw }));
  const imu = await ev(`['imu-tx','imu-ty','imu-turn'].map((id) => document.getElementById(id).textContent)`);
  check('IMU values shown', /°$/.test(imu[0]) && /°$/.test(imu[1]) && /°\/s$/.test(imu[2]), J(imu));
  await shot('glove-2-connected.png');

  // 3. Calibrate: 1 s ready + 3 s open + 1 s ready + 3 s fist, then Save
  await click('#g-calibrate');
  await sleep(500);
  const title = await ev(`document.getElementById('bar-title').textContent`);
  check('Calibrate opens full screen ("CALIBRATE GLOVE")', title === 'CALIBRATE GLOVE', title);
  await sleep(5500);
  await shot('glove-3-calibrate.png');
  await sleep(3500);
  const cal = await ev(`({ save: !document.getElementById('cal-save').disabled, msg: document.getElementById('cal-msg').textContent,
    s1: document.getElementById('s1-lbl').textContent, s2: document.getElementById('s2-lbl').textContent })`);
  check('both steps recorded, Save enabled', cal.save && /DONE/.test(cal.s1) && /DONE/.test(cal.s2), J(cal));
  const l3 = await layout();
  check('calibrate screen: no page scroll, controls >= 44 px', l3.sw === 1024 && l3.sh === 600 && !l3.small.length, J(l3));
  await click('#cal-save');
  await sleep(600);
  const stored = await ev(`SKGlove.calibration.get()`);
  const back = await ev(`({ title: document.getElementById('bar-title').textContent, sub: document.getElementById('g-sub').textContent })`);
  check('Save stores open/fist (5 each) on this kiosk and returns to Settings',
    stored && stored.open.length === 5 && stored.fist.length === 5 && back.title === 'SETTINGS' && /calibrated today/.test(back.sub), J({ stored, back }));
  const norm = await ev(`SKGlove.latest().norm`);
  check('normalized values stay in 0..1 after calibration', norm.every((v) => v >= 0 && v <= 1), J(norm));

  // 4. Debug panel
  await click('#dbg-toggle');
  await ev(`SKGlove._feed('this is not json\\n'); true`);   // a bad line now, besides the simulator's own
  await sleep(1200);
  const d = await ev(`({ lines: document.querySelectorAll('#console > div').length,
    bad: [...document.querySelectorAll('#console .badl')].map((e) => e.textContent).slice(-1)[0] || null,
    badColor: (document.querySelector('#console .badl') && getComputedStyle(document.querySelector('#console .badl')).color) || null,
    lps: +document.getElementById('c-lps').textContent, total: +document.getElementById('c-lines').textContent,
    badCount: +document.getElementById('c-bad').textContent, age: document.getElementById('c-age').textContent,
    hello: document.getElementById('c-hello').textContent })`);
  check('console shows lines (<= 200) and a red bad line with its parse error',
    d.lines > 20 && d.lines <= 200 && /this is not json\s+✖ not JSON/.test(d.bad || '') && d.badColor === 'rgb(255, 138, 128)', J(d));
  check('counters: ~30 lines/s, totals, bad >= 1, last data age, since hello',
    d.lps >= 25 && d.lps <= 35 && d.total > 100 && d.badCount >= 1 && /ms$/.test(d.age) && d.hello !== '–', J(d));
  await sleep(1100);
  const total2 = +(await ev(`document.getElementById('c-lines').textContent`));
  check('counters update', total2 > d.total, `${d.total} -> ${total2}`);
  await click('#d-ping');
  await sleep(300);
  const rtt = await ev(`document.getElementById('d-rtt').textContent`);
  check('Send "ping" shows the round trip', /^round trip \d+ ms$/.test(rtt), rtt);
  await click('#d-hello');
  await sleep(800);   // the console re-renders every 500 ms
  const sentHello = await ev(`[...document.querySelectorAll('#console .out')].some((e) => /> hello$/.test(e.textContent))`);
  check('Send "hello" is logged as sent', sentHello);
  await click('#d-pause');
  const frozen = await ev(`document.querySelectorAll('#console > div').length && document.getElementById('console').lastElementChild.textContent`);
  await sleep(800);
  const stillFrozen = await ev(`document.getElementById('console').lastElementChild.textContent`);
  await click('#d-pause');
  check('Pause freezes the console, Resume continues', frozen === stillFrozen);
  const mm = await ev(`[...document.querySelectorAll('#mm tr')].map((r) => [...r.children].map((td) => td.textContent))`);
  check('min/max per finger', mm.length === 5 && mm.every((r) => /^\d+$/.test(r[1]) && /^\d+$/.test(r[2]) && +r[3] > 0), J(mm));
  const hints = await ev(`[...document.querySelectorAll('#hints .hint')].map((h) => h.textContent)`);
  check('hints: bad lines reported, no false alarms', hints.some((h) => /^Bad lines/.test(h)) && !hints.some((h) => /No hello|lines\/s|always/.test(h)), J(hints));
  await shot('glove-4-debug.png');
  const l4 = await layout();
  check('debug open: no page scroll (the section scrolls), controls >= 44 px', l4.sw === 1024 && l4.sh === 600 && !l4.small.length, J(l4));

  // Download log
  await click('#d-download');
  let file = null;
  for (let i = 0; i < 30 && !file; i++) { await sleep(200); file = fs.readdirSync(downloads).find((f) => /^glove-log-.*\.txt$/.test(f)); }
  const text = file ? fs.readFileSync(path.join(downloads, file), 'utf8') : '';
  const lines = text.trim().split('\n');
  check('Download log: a .txt of timestamped lines (<= 2,000), incl. the hello and the bad line',
    !!file && lines.length > 100 && lines.length <= 2000 && /^\d{4}-\d\d-\d\dT\S+Z < \{"type":"hello"/m.test(text) && /\[BAD: not JSON/.test(text), J({ file, lines: lines.length, first: lines[0] }));

  // Hints with a broken glove: a finger stuck at 4095
  await click('#g-disconnect');
  await ev(`SKGlove.simulator(false)`);
  const stuck = await ev(`(() => { for (let i = 0; i < 30; i++) SKGlove._feed('{"t":' + i + ',"f":[4095,2000,2000,2000,2000]}\\n'); return SKGlove.stats().recent.length; })()`);
  check('parser accepts lines while disconnected (raw feed) without errors', stuck === 30, String(stuck));

  // Unplugged / reconnect is hardware only; the status texts exist:
  check('admin menu lists Settings', await (async () => {
    await c.navigate(BASE + 'index.html');
    return ev(`(() => { document.querySelector('#acct .sk-chip, .sk-chip')?.click(); return [...document.querySelectorAll('.sk-menu-item')].some((a) => a.getAttribute('href') === 'settings.html' && /Settings/.test(a.textContent)); })()`);
  })());
  const menuFit = await ev(`(() => { const m = document.querySelector('.sk-menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { bottom: Math.round(r.bottom) }; })()`);
  check('admin menu fits on the 600 px screen', menuFit && menuFit.bottom <= 600, J(menuFit));
  await shot('glove-5-admin-menu.png');

  const errs = c.getConsoleErrors().concat(c.getExceptions());
  check('0 console errors', errs.length === 0, J(errs).slice(0, 400));
} finally {
  await c.close();
  fs.rmSync(downloads, { recursive: true, force: true });
}
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
