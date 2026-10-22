// glove-hw phase (protocol v2, two gloves, setup on the glove), glove-static phase (fixed finger wiring, 3-step setup):
// Settings -> Glove with the simulator, headless Chrome at 1024x600 via tests/video-capture/cdp.mjs (logs in as the
// seeded admin): not connected; simulator: hello v2 + device line, not calibrated, Wiring card, live bars with
// channels; Debug: console + red bad line, counters, ping, 16-channel table with the fixed fingers, Download log;
// Set up glove: 1 Check wiring (outline on the moving bar, 10 / 10), 2 Calibrate (one weak sensor), 3 Save + Test;
// Check fingers alone; reload -> the setup comes back from the glove; old per-glove setups (re-keyed / needs a new
// calibration); Clear setup on glove; layout (no page scroll, controls >= 44 px) on every screen; admin menu;
// 0 console errors.
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

// The fixed wiring (js/glove.js MAP, glove-static phase): right C0-C4, left C9-C5 (thumb..pinky).
const MAP = { R: [0, 1, 2, 3, 4], L: [9, 8, 7, 6, 5] };
const ALL10 = [...MAP.R, ...MAP.L];
const bendAll = (v) => ev(`${J(ALL10)}.forEach((c) => SKGlove.simSetBend(c, ${J(v)})); true`);

try {
  // 1. Not connected (simulator off, nothing stored)
  await c.navigate(BASE + 'settings.html');
  await ev(`['sk_glove_sim','sk_glove_sim_cfg','sk_glove_calibration','sk_glove_bars'].forEach((k) => localStorage.removeItem(k)); true`);
  await c.navigate(BASE + 'settings.html');
  const s1 = await ev(`({ status: SKGlove.status(), title: document.getElementById('g-title').textContent,
    connectVisible: !document.getElementById('g-connect').hidden, simSwitch: !!document.querySelector('[data-sim], #g-simcard'), sim: SKGlove.isSimulator(),
    wiring: !document.getElementById('g-wiring').hidden })`);
  check('not connected: status, title, Connect glove; no "Use simulator" switch anywhere (owner 2026-10-22); no Wiring card',
    ['disconnected', 'unsupported'].includes(s1.status) && /not connected|not available/.test(s1.title) && s1.connectVisible && !s1.simSwitch && !s1.sim && !s1.wiring, J(s1));
  const l1 = await layout();
  check('1024x600: no page scroll, controls >= 44 px', layoutOk(l1), J(l1));
  await shot('glove-static-1-not-connected.png');

  // 2. Simulator (only with ?glove=sim) -> connected by itself on load, hello v2, not calibrated; bars from the fixed wiring
  await c.navigate(BASE + 'settings.html?glove=sim');
  await sleep(1500);
  const s2 = await ev(`({ status: SKGlove.status(), info: SKGlove.info(), sub: document.getElementById('g-sub').textContent,
    live: !document.getElementById('g-live').hidden, hands: !document.getElementById('g-hands').hidden, setupBtn: !document.getElementById('g-setup').hidden,
    wiring: document.getElementById('g-wiring').hidden ? null : document.getElementById('g-wiring').textContent,
    check: !document.getElementById('g-check').hidden && !document.getElementById('g-check').disabled,
    names: [...document.querySelectorAll('#g-fingers-R .fg span:first-of-type')].map((e) => e.textContent) })`);
  check('simulator: connected, hello v2 (16 channels, IMU)', s2.status === 'connected' && s2.info && s2.info.channels === 16 && s2.info.imu === true, J(s2));
  check('device line ends "not calibrated"', /sk-glove · firmware 2\.0-sim · 16 channels · IMU yes \(21\/22\) · \d+ readings\/s · not calibrated/.test(s2.sub), s2.sub);
  check('Wiring card: "Wiring: fixed (C0–C4 right, C5–C9 left)", "not calibrated yet", Check fingers',
    /Wiring: fixed \(C0–C4 right, C5–C9 left\)/.test(s2.wiring || '') && /not calibrated yet/.test(s2.wiring) && s2.check, J(s2.wiring));
  check('live bars shown before any setup, each with its channel', s2.live && s2.hands && s2.setupBtn && J(s2.names) === J(['Thumb C0', 'Index C1', 'Middle C2', 'Ring C3', 'Pinky C4']), J(s2.names));
  const imu = await ev(`['imu-tx','imu-ty','imu-turn'].map((id) => document.getElementById(id).textContent)`);
  check('IMU values shown', /°$/.test(imu[0]) && /°$/.test(imu[1]) && /°\/s$/.test(imu[2]), J(imu));
  await shot('glove-static-2-not-calibrated.png');

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
  check('16-channel table: the finger beside each channel from the fixed wiring (C0 Right thumb, C5 Left pinky, C9 Left thumb), C10-C15 unused',
    d.rows.length === 16 && d.rows[0][0] === 'C0' && d.rows[0][1] === 'Right thumb' && d.rows[5][1] === 'Left pinky' && d.rows[9][1] === 'Left thumb' &&
    d.rows.slice(10).every((r) => r[1] === '–') && d.rows.every((r) => /^\d+$/.test(r[5])), J(d.rows.slice(0, 10).map((r) => r.slice(0, 2))));
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
  await shot('glove-static-3-debug.png');
  await click('#dbg-toggle');

  // 4. Set up glove, step 1 Check wiring: every bar has to move; the bar moving now is outlined
  await click('#g-setup');
  await sleep(300);
  check('Set up glove opens full screen at 1 Check wiring (3 steps), Next disabled, Skip check shown',
    (await text('bar-title')) === 'SET UP GLOVE' && await ev(`document.querySelector('#su-steps span.on').dataset.step === 'check' &&
      document.querySelectorAll('#su-steps span').length === 3 && document.getElementById('su-next').disabled && !document.getElementById('ck-skip').hidden`));
  const cells = await ev(`[...document.querySelectorAll('#ck-grid .g10-row')].map((r) => r.textContent.replace(/[–\d]+$/g, ''))`);
  check('two labelled rows: RIGHT Thumb C0..Pinky C4, LEFT Thumb C9..Pinky C5',
    /^RIGHT.*Thumb C0.*Index C1.*Middle C2.*Ring C3.*Pinky C4/.test(cells[0]) && /^LEFT.*Thumb C9.*Index C8.*Middle C7.*Ring C6.*Pinky C5/.test(cells[1]), J(cells));
  await ev(`SKGlove.simSetBend(7, 1); true`);   // left middle
  await waitFor(`document.getElementById('ck-grid-L2').classList.contains('moving')`, 2000);
  const mv = await ev(`({ moving: [...document.querySelectorAll('#ck-grid .moving')].map((e) => e.id), ok: [...document.querySelectorAll('#ck-grid .ok')].map((e) => e.id) })`);
  check('bending C7 outlines Left middle C7 only, and ticks it', J(mv.moving) === J(['ck-grid-L2']), J(mv));
  await ev(`SKGlove.simSetBend(7, null); true`);
  await waitFor(`document.getElementById('ck-grid-L2').classList.contains('ok')`, 2000);
  const l4 = await layout();
  check('check wiring screen: no page scroll, controls >= 44 px', layoutOk(l4), J(l4));
  await shot('glove-static-4-check.png');
  for (const ch of ALL10) {
    await ev(`SKGlove.simSetBend(${ch}, 1); true`);
    await sleep(250);
    await ev(`SKGlove.simSetBend(${ch}, null); true`);
    await sleep(100);
  }
  await waitFor(`document.getElementById('ck-count').textContent === '10 / 10'`, 3000);
  check('all 10 ticked: "10 / 10", Next enabled', await ev(`document.querySelectorAll('#ck-grid .ok').length === 10 && !document.getElementById('su-next').disabled`),
    await text('ck-count'));

  // 5. Calibrate: open 3 s, fists 3 s; C3 (right ring) barely moves -> weak sensor, Save still allowed
  await click('#su-next');
  await waitFor(`/Make two fists/.test(document.getElementById('cal-title').textContent)`, 7000);
  await ev(`${J(ALL10)}.forEach((c) => SKGlove.simSetBend(c, c === 3 ? 0.03 : 1)); true`);
  await waitFor(`/Calibration done/.test(document.getElementById('cal-title').textContent)`, 7000);
  await bendAll(null);
  const cal = await ev(`({ msg: document.getElementById('cal-msg').textContent, weak: [...document.querySelectorAll('#cal-grid .weak')].map((e) => e.id),
    ok: document.querySelectorAll('#cal-grid .ok').length, next: !document.getElementById('su-next').disabled, redo: !document.getElementById('su-retry').hidden,
    fil: document.getElementById('cal-fil').textContent })`);
  check('calibrate: done, Right ring C3 marked weak by name, the other 9 ok, Next and Redo enabled',
    J(cal.weak) === J(['cal-grid-R3']) && /Weak sensor: Right ring C3/.test(cal.msg) && cal.ok === 9 && cal.next && cal.redo && /Tapos/.test(cal.fil), J(cal));
  const l5 = await layout();
  check('calibrate screen: no page scroll, controls >= 44 px', layoutOk(l5), J(l5));
  await shot('glove-static-5-calibrate.png');

  // 6. Save + Test: live 0-100 %, then Save on the glove
  await click('#su-next');
  await ev(`SKGlove.simSetBend(0, 1); true`);
  await sleep(600);
  const ts = await ev(`[...document.querySelectorAll('#ts-grid .g10-val')].map((e) => e.textContent)`);
  await ev(`SKGlove.simSetBend(0, null); true`);
  check('test view: right thumb bent ~100 %, right index open ~0 %, the weak ring "ignored"',
    parseInt(ts[0]) >= 90 && parseInt(ts[1]) <= 10 && ts[3] === 'ignored', J(ts));
  const l6 = await layout();
  check('save screen: no page scroll, controls >= 44 px', layoutOk(l6), J(l6));
  await shot('glove-static-6-test.png');
  await click('#su-savebtn');
  await waitFor(`/Saved on the glove/.test(document.getElementById('su-s-msg').textContent)`, 4000);
  const saved = await ev(`({ cfg: SKGlove.config(), state: SKGlove.configState(), ready: SKGlove.ready(), btn: document.getElementById('su-savebtn').textContent })`);
  check('Save: stored on the glove (fixed map, calibration, mirror on by default, w 0.3), ready(), button "Done"',
    saved.state === 'ok' && saved.ready && J(saved.cfg.map) === J({ L: MAP.L, R: MAP.R }) && saved.cfg.cal && saved.cfg.cam.mirror === true &&
    saved.cfg.w === 0.3 && /Done/.test(saved.btn), J(saved));
  await click('#su-savebtn');
  await waitFor(`document.getElementById('bar-title').textContent === 'SETTINGS'`, 3000);
  check('Done -> back on Settings: "calibrated, saved on glove today", Calibration: today',
    await ev(`/calibrated, saved on glove today/.test(document.getElementById('g-sub').textContent) && /^Calibration: today/.test(document.getElementById('g-cal').textContent)`),
    await text('g-cal'));
  await ev(`SKGlove.simSetBend(0, 1); true`);
  await sleep(600);
  const bars = await ev(`({ rThumb: parseInt(document.getElementById('barR0').style.height), rIndex: parseInt(document.getElementById('barR1').style.height) })`);
  await ev(`SKGlove.simSetBend(0, null); true`);
  check('bars: right thumb bent reads ~100 %, right index open reads low', bars.rThumb >= 90 && bars.rIndex <= 25, J(bars));
  await shot('glove-static-7-two-hands.png');

  // 7. Let's Talk with the glove: strength saved on the glove, finger-bars switch per kiosk
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
  const l7 = await layout();
  check('settings with the glove set up: no page scroll, controls >= 44 px', layoutOk(l7), J(l7));

  // 8. Check fingers: step 1 alone, Done any time, the calibration untouched
  const before = await ev(`JSON.stringify(SKGlove.config())`);
  await click('#g-check');
  await sleep(300);
  check('Check fingers: "CHECK FINGERS", step bar hidden, no Skip, "Done" enabled at once',
    (await text('bar-title')) === 'CHECK FINGERS' && await ev(`document.getElementById('su-steps').hidden && document.getElementById('ck-skip').hidden &&
      !document.getElementById('su-next').disabled && /Done/.test(document.getElementById('su-next').textContent) && document.getElementById('su-check').classList.contains('on')`));
  await click('#su-next');
  await sleep(200);
  check('Done -> back on Settings, setup unchanged', (await text('bar-title')) === 'SETTINGS' && (await ev(`JSON.stringify(SKGlove.config())`)) === before);

  // 9. Reload: the setup comes back from the glove (the simulator's flash)
  await c.navigate(BASE + 'settings.html?glove=sim');
  await waitFor(`SKGlove.configState() === 'ok'`, 5000);
  check('reload: setup read back from the glove', await ev(`SKGlove.ready() && /calibrated, saved on glove today/.test(document.getElementById('g-sub').textContent)`));
  await click('#dbg-toggle');
  await sleep(700);
  check('Debug: the stored setup as JSON, with the fixed map', /"map":\{"L":\[9,8,7,6,5\],"R":\[0,1,2,3,4\]\}/.test(await text('d-cfg')), await text('d-cfg'));
  await click('#dbg-toggle');

  // 9b. Old setups saved with the per-glove finger map (before the glove-static phase)
  const OLD = { v: 1, map: { L: [5, 6, 7, 8, 9], R: [0, 1, 2, 3, 4] },
    cal: { L: { open: [3300, 3300, 3300, 3300, 3300], fist: [1300, 1300, 1300, 1300, 1300] },
           R: { open: [3300, 3300, 3300, 3300, 3300], fist: [1300, 1300, 1300, 1300, 1300] }, at: '2026-10-21T12:00:00.000Z' },
    cam: { mirror: true }, imuHand: 'R', w: 0.3 };
  await ev(`localStorage.setItem('sk_glove_sim_cfg', ${J(J(OLD))}); true`);
  await c.navigate(BASE + 'settings.html?glove=sim');
  await waitFor(`SKGlove.configState() === 'ok'`, 5000);
  check('old map with every channel: calibration kept, re-keyed ("kept from the old setup"), ready()',
    await ev(`SKGlove.ready() && SKGlove.calibrationFrom() === 'moved' && /kept from the old setup/.test(document.getElementById('g-cal').textContent)`), await text('g-cal'));
  const MISSING = JSON.parse(J(OLD));
  MISSING.map.L[2] = 12;
  await ev(`localStorage.setItem('sk_glove_sim_cfg', ${J(J(MISSING))}); true`);
  await c.navigate(BASE + 'settings.html?glove=sim');
  await waitFor(`SKGlove.configState() === 'ok'`, 5000);
  check('old map without C7: "Calibration needed: the old setup used another wiring", not ready()',
    await ev(`!SKGlove.ready() && /Calibration needed: the old setup used another wiring/.test(document.getElementById('g-cal').textContent)`), await text('g-cal'));
  await shot('glove-static-8-old-setup.png');

  // 10. Clear setup on glove
  await click('#dbg-toggle');
  await click('#d-cfgclear');
  await waitFor(`SKGlove.configState() === 'none'`, 3000);
  check('Clear setup on glove -> not calibrated', await ev(`!SKGlove.ready() && /not calibrated yet/.test(document.getElementById('g-cal').textContent) &&
    document.getElementById('d-cfg').textContent === 'none'`));

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
