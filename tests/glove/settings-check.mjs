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
  await ev(`['sk_glove_sim','sk_glove_sim_cfg','sk_glove_calibration','sk_glove_bars'].forEach((k) => localStorage.removeItem(k)); true`);
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

  // 8b. Let's Talk with the glove (Phase 2): strength saved on the glove, finger-bars switch per kiosk
  check('"Glove strength" and "Finger bars" shown once set up', await ev(`!document.getElementById('g-assist').hidden &&
    document.getElementById('g-w').textContent === '0.3' && document.getElementById('g-bars').getAttribute('aria-checked') === 'true'`));
  await click('#g-w-plus');
  await waitFor(`/Saved on the glove/.test(document.getElementById('g-w-msg').textContent)`, 3000);
  check('strength + -> 0.4 saved on the glove', await ev(`SKGlove.config().w === 0.4 && JSON.parse(localStorage.getItem('sk_glove_sim_cfg')).w === 0.4 &&
    document.getElementById('g-w').textContent === '0.4'`), await ev(`JSON.stringify(SKGlove.config())`));
  await click('#g-bars');
  check('finger bars switch -> off for this kiosk (sk_glove_bars = 0)', await ev(`localStorage.getItem('sk_glove_bars') === '0' &&
    document.getElementById('g-bars').getAttribute('aria-checked') === 'false'`));
  await click('#g-bars');
  const l8 = await layout();
  check('settings with the glove set up: no page scroll, controls >= 44 px', layoutOk(l8), J(l8));
  await shot('glove-hw-10-assist.png');

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
