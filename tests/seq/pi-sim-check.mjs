// seq-recognition phase, Pi round (2026-11-15): two measurements, Playwright Chromium at 1024x600, fake camera.
// A. Hand lines (js/hand-overlay.js): a moving hand is fed as MediaPipe answers at 5 a second, each taken 120 ms
//    before it arrives (the Pi's case); at every drawn frame the lines are compared with where the hand really is.
//    Old way (lines only where the last answer was) against the new one. Pixels on a 640x480 picture.
// B. Let's Talk Sign screen for 15 s each with: whole-sign on / off (?seq=off), idle 0 / 0.6 (?idle=): how late
//    a timer runs (what a touch waits for), detections a second, share of time MediaPipe held the page.
// This container runs MediaPipe much slower than a laptop (about 1 s a frame), so B shows the direction, not
//    the Pi's numbers. Run (server at SK_BASE): node tests/seq/pi-sim-check.mjs [--only A|B]
import { createRequire } from 'node:module';
const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  return createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await ctx.route('**/php/api/signs.php', (r) => r.fulfill({ contentType: 'application/json', body: '{"success":true,"signs":{}}' }));
await ctx.route('**/php/api/save_gesture.php?summary=1*', (r) => r.fulfill({ contentType: 'application/json', body: '{"success":true,"gestures":{},"signs":{},"categories":{"ESL":{},"FSL":{}}}' }));
const p = await ctx.newPage();
let failed = 0;
const check = (name, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? '  ' + d : '')); if (!ok) failed++; };

if (!only || only === 'A') {
  // scen 'circle': a circle every 3 s; 'stop': a sweep across 60 % of the picture in 0.8 s, then still 1 s.
  const trial = async (scen) => {
    await p.goto(BASE + 'js/hand-overlay.js');   // any same-origin page
    await p.setContent('<video id="v" style="width:640px;height:480px"></video><canvas id="c"></canvas>');
    await p.addScriptTag({ url: BASE + 'js/hand-overlay.js' });
    return p.evaluate(async (scen) => {
      const W = 640, H = 480, ANS_MS = 200, LAT = 120;   // 5 answers a second, each 120 ms old when it arrives
      const truth = scen === 'circle' ? (t) => { const a = 2 * Math.PI * t / 3000; return { x: 0.5 + 0.25 * Math.cos(a), y: 0.5 + 0.25 * Math.sin(a) }; }
        : (t) => { const f = Math.min(1, (t % 1800) / 800); return { x: 0.2 + 0.6 * f * f * (3 - 2 * f), y: 0.5 }; };
      const hand = (c) => Array.from({ length: 21 }, () => ({ x: c.x, y: c.y, z: 0 }));
      const cv = document.getElementById('c'), v = document.getElementById('v');
      Object.defineProperty(v, 'videoWidth', { value: 320 }); Object.defineProperty(v, 'videoHeight', { value: 240 });
      window.showSkeleton = true;
      const errNew = [], errOld = [];
      let last = null, prev = null, pS = null, pO = null, jumpNew = 0, jumpOld = 0, over = 0, draws = 0;
      const t0 = performance.now();
      const feeder = setInterval(() => {
        const cap = performance.now() - LAT;
        last = truth(cap - t0);
        HandOverlay.feed({ multiHandLandmarks: [hand(last)], multiHandedness: [{ label: 'Right' }] }, cap, cv, v);
      }, ANS_MS);
      await new Promise((done) => {
        const tick = () => {
          const now = performance.now();
          const s = HandOverlay._shown()[0];
          if (s && now - t0 > 1000 && s[0] !== prev) {
            prev = s[0]; draws++;
            const tr = truth(now - t0);
            errNew.push(Math.hypot((s[0] - tr.x) * W, (s[1] - tr.y) * H));
            errOld.push(Math.hypot((last.x - tr.x) * W, (last.y - tr.y) * H));
            if (pS) { jumpNew = Math.max(jumpNew, Math.hypot((s[0] - pS[0]) * W, (s[1] - pS[1]) * H)); jumpOld = Math.max(jumpOld, Math.hypot((last.x - pO.x) * W, (last.y - pO.y) * H)); }
            pS = [s[0], s[1]]; pO = last;
            if (scen === 'stop') over = Math.max(over, (s[0] - 0.8) * W);
          }
          if (now - t0 < 7000) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame(tick);
      });
      clearInterval(feeder);
      const st = HandOverlay.getStats();
      await new Promise((r) => setTimeout(r, 250));
      const during = HandOverlay._shown().length;
      await new Promise((r) => setTimeout(r, 400));
      const after = HandOverlay._shown().length, running = HandOverlay.running();
      const q = (a, k) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(k * (b.length - 1))]; };
      return { drawFps: draws / 6, drawMs: st.drawMs, newMed: q(errNew, 0.5), oldMed: q(errOld, 0.5), jumpNew, jumpOld, over, during, after, running };
    }, scen);
  };
  const c = await trial('circle'), s = await trial('stop');
  console.log(`A. lines: ${c.drawFps.toFixed(1)} drawn frames/s from 5 answers/s, ${c.drawMs.toFixed(2)} ms a frame`);
  console.log(`   circle: distance from the real hand (px, 640x480) median new ${c.newMed.toFixed(0)} / old ${c.oldMed.toFixed(0)}; biggest step between two drawn frames new ${c.jumpNew.toFixed(0)} / old ${c.jumpOld.toFixed(0)}`);
  console.log(`   sweep then stop: runs past the stop by ${s.over.toFixed(0)} px`);
  check('the lines are drawn at least 20 times a second from 5 answers', c.drawFps >= 20, c.drawFps.toFixed(1));
  check('circle: the lines are closer to the real hand than the old way (median)', c.newMed < c.oldMed, `${c.newMed.toFixed(0)} vs ${c.oldMed.toFixed(0)}`);
  check('circle: the biggest step between drawn frames is under 70 % of the old jump', c.jumpNew < c.jumpOld * 0.7, `${c.jumpNew.toFixed(0)} vs ${c.jumpOld.toFixed(0)}`);
  check('sweep then stop: the lines run past the stop by less than 50 px', s.over < 50, s.over.toFixed(0));
  check('a missed answer keeps the hand 250 ms, then it is gone and the loop stops', c.during === 1 && c.after === 0 && !c.running, JSON.stringify(c));
}

if (!only || only === 'B') {
  const run = async (q) => {
    await p.goto(BASE + 'talk.html' + q);
    await p.click('#card-sign');
    await p.waitForFunction(() => !document.getElementById('guide-start-btn').disabled, null, { timeout: 180000 });
    await p.click('#guide-start-btn');
    await p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 90000 });
    return p.evaluate(async () => {
      GestureDataRecorder.getLoopStats();
      const late = [];
      await new Promise((done) => {
        const t0 = performance.now();
        const one = () => {
          const want = performance.now() + 50;
          setTimeout(() => { late.push(performance.now() - want); if (performance.now() - t0 < 15000) one(); else done(); }, 50);
        };
        one();
      });
      const st = GestureDataRecorder.getLoopStats();
      const b = late.slice().sort((x, y) => x - y);
      return { p50: b[Math.floor(b.length / 2)], p95: b[Math.floor(b.length * 0.95)], detectFps: st.detectFps, detectMs: st.detectMs, busy: st.busy, seq: !!(window.SeqLive && SeqLive.active()) };
    });
  };
  const rows = [];
  for (const q of ['?idle=0&seq=off', '?idle=0', '?idle=0.6']) {
    const r = await run(q);
    rows.push([q, r]);
    console.log(`B. talk.html${q}: timer late p50 ${r.p50.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms; detect ${r.detectFps.toFixed(2)}/s at ${r.detectMs.toFixed(0)} ms; MediaPipe busy ${(r.busy * 100).toFixed(0)} %; whole-sign ${r.seq}`);
  }
  const [off, on, idle] = rows.map((x) => x[1]);
  check('whole-sign on costs no more than 10 % extra timer delay (p95) against off', on.p95 <= off.p95 * 1.1 + 5, `${on.p95.toFixed(0)} vs ${off.p95.toFixed(0)} ms`);
  check('idle 0.6 lowers MediaPipe\'s share of the time', idle.busy < on.busy, `${(idle.busy * 100).toFixed(0)} % vs ${(on.busy * 100).toFixed(0)} %`);
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
