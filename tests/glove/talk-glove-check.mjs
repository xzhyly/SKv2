// glove-hw Phase 2 / glove-chip phase: the 🧤 chip on the Let's Talk camera (and the Train Gestures Step 3 button)
// with the glove simulator, Playwright Chromium at 1024x600 with a fake camera:
//   no glove -> no chip; a set-up glove -> "🧤 Gloves" chip in the camera's top-right corner, 44 px, nothing
//   overlapping, the right column exactly as without a glove, no scroll; ON -> white, aria-pressed, green dot, no
//   finger bars, the first-ON hint (3 s, once per conversation); ON but ignored (unsure hand, not worn) -> amber
//   "Camera only", back to ON when used again; apply(): the glove decides a close call ("s" over "b") only with
//   every condition met, and returns the scores unchanged for the wrong hand, an unsure hand, a glove that is not
//   worn, stale data, OFF; unplugged -> chip gone and OFF; a new Sign turn, "+ New conversation" (empty thread) and
//   a reload -> OFF; Settings' simulator switch alone never puts a fake glove into Let's Talk; detection rate with
//   the chip ON vs OFF (measured); Train Gestures Step 3 button; 0 console errors.
// Recognition itself is not driven here (no real hand in the fake camera): apply() is called with the loaded model
// and MediaPipe's handedness for the frame is set through GloveAssist._setHands.
// Run (server at SK_BASE, default http://localhost/SKR/): node tests/glove/talk-glove-check.mjs [--shots <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  return createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const { chromium } = await loadPlaywright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  ' + String(detail).slice(0, 600)));
  if (!ok) failed++;
}

// A set-up glove in the simulator's "flash": right = C0-C4, left = C5-C9, open 3300 / fist 1300, camera not mirrored.
const CFG = {
  v: 1, map: { L: [5, 6, 7, 8, 9], R: [0, 1, 2, 3, 4] },
  cal: { L: { open: [3300, 3300, 3300, 3300, 3300], fist: [1300, 1300, 1300, 1300, 1300] },
         R: { open: [3300, 3300, 3300, 3300, 3300], fist: [1300, 1300, 1300, 1300, 1300] }, at: '2026-10-21T12:00:00.000Z' },
  cam: { mirror: false }, imuHand: 'R', w: 0.3,
};
// signs.php without a database: the repo's own saved_gestures/*/sign.json (the page only needs the texts)
const SIGNS = {};
for (const k of fs.readdirSync(path.join(ROOT, 'saved_gestures'))) {
  const f = path.join(ROOT, 'saved_gestures', k, 'sign.json');
  if (!fs.existsSync(f)) continue;
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  SIGNS[k] = { set: s.set, textEn: s.textEn, textFil: s.textFil, category: 'word', samples: 1, avatar: false, audio: { en: null, fil: null } };
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await ctx.addInitScript(`try { localStorage.setItem('sk_glove_sim_cfg', ${J(J(CFG))}); } catch (e) {}`);
await ctx.route('**/php/api/signs.php', (route) => route.fulfill({ contentType: 'application/json', body: J({ success: true, signs: SIGNS }) }));
const errors = [];
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name) }); } };
const rect = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; }, sel);
const noScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= 1024 && document.documentElement.scrollHeight <= 600);
const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
async function toSign(url) {
  await p.goto(url);
  await p.click('#card-sign');
  await p.waitForFunction(() => !document.getElementById('guide-start-btn').disabled, null, { timeout: 180000 });
  await p.click('#guide-start-btn');
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
  await sleep(500);
}
// the right hand's 5 channels held at these bends (0 straight .. 1 bent), the left hand open
const holdRight = (b) => p.evaluate((b) => { b.forEach((v, i) => SKGlove.simSetBend(i, v)); [5, 6, 7, 8, 9].forEach((c) => SKGlove.simSetBend(c, 0)); }, b);
const S_BEND = [0.73, 0.75, 0.69, 0.67, 0.68];   // the "s" sign's median bends (tests/glove/glove-bend-check.mjs)
const SCORES = { b: 0.80, s: 0.78, hello: 0.5, c: 0.4, d: 0.3 };

try {
  // 1. No glove: no chip, the screen as before
  await toSign(BASE + 'talk.html');
  const none = await p.evaluate(() => ({ hidden: document.getElementById('glove-chip').hidden, status: SKGlove.status() }));
  check('no glove: no 🧤 chip (Settings\' simulator switch is ignored here)', none.hidden && none.status !== 'connected', J(none));
  const SIDE = ['.signing-side-label', '#signing-draft', '#signing-undo-btn', '#signing-clear-btn', '.lang-toggle', '#chip-esl', '#chip-fsl',
    '#stop-signing-btn', '#sign-to-speak-btn', '#chip-guide', '#camera-box', '.signing-caption-pill'];
  const rects = async () => { const o = {}; for (const s of SIDE) o[s] = await rect(s); return o; };
  const before = await rects();

  // 2. Set-up glove (simulator via ?glove=sim): the chip in the camera's top-right corner
  await p.evaluate(() => localStorage.setItem('sk_glove_sim', '1'));   // Settings' switch: still ignored without ?glove=sim
  await toSign(BASE + 'talk.html');
  check('Settings\' simulator switch alone never puts a fake glove into Let\'s Talk', await p.evaluate(() => document.getElementById('glove-chip').hidden && !SKGlove.isSimulator()));
  await toSign(BASE + 'talk.html?glove=sim');
  await p.waitForFunction(() => window.SKGlove.ready(), null, { timeout: 5000 });
  const r = { glove: await rect('#glove-chip'), cam: await rect('#camera-box'), pill: await rect('.signing-caption-pill') };
  const txt = await p.textContent('#glove-chip');
  check('set-up glove: "🧤 Gloves" chip, top-right of the camera, 44 px tall',
    /Gloves/.test(txt) && r.glove.h === 44 && r.glove.w >= 44 && r.glove.y === r.pill.y && r.cam.r - r.glove.r === r.pill.x - r.cam.x, J({ txt, r }));
  check('the chip is inside the camera and overlaps nothing but the video', r.glove.x >= r.cam.x && r.glove.r <= r.cam.r && !overlap(r.glove, r.pill), J(r));
  const after = await rects();
  check('the right column and the camera did not move: identical to the screen without a glove', J(after) === J(before), J({ before, after }));
  check('no scroll at 1024x600', await noScroll());
  await shot('glove-talk-1-off.png');

  // 3. ON: white, aria-pressed, green dot, no bars, the first-ON hint. MediaPipe paused for sections 3-4 (it takes
  // ~1 s of the page's only thread per frame in this container, which would starve the glove simulator's
  // 30 lines/s); resumed for 5.
  await p.evaluate(() => window.GestureDataRecorder.pauseHandLoop());
  await p.click('#glove-chip');
  const on = await p.evaluate(() => { const b = document.getElementById('glove-chip'); const h = document.getElementById('glove-hint');
    return { on: GloveAssist.isOn(), state: GloveAssist.chipState(), pressed: b.getAttribute('aria-pressed'), bg: getComputedStyle(b).backgroundColor,
      dot: getComputedStyle(b.querySelector('.glove-chip-dot')).display, bars: b.querySelectorAll('.glove-bars').length, txt: b.textContent,
      hint: !h.hidden && h.textContent }; });
  check('tap -> ON: white fill, aria-pressed, green dot, "🧤 ON", no finger bars',
    on.on && on.state === 'on' && on.pressed === 'true' && on.bg === 'rgb(255, 255, 255)' && on.dot === 'block' && on.bars === 0 && /ON/.test(on.txt), J(on));
  check('first ON: the hint, in EN while EN is selected', /^Wear both gloves/.test(on.hint || ''), J(on));
  const rh = await rect('#glove-hint');
  check('the hint is inside the camera, under the chips', rh.y > r.glove.b && rh.y > r.pill.b && rh.x >= r.cam.x && rh.r <= r.cam.r, J({ rh, r }));
  check('ON does not move the right column', J(await rects()) === J(before));
  await shot('glove-talk-2-on.png');
  await sleep(3200);
  check('the hint hides by itself after 3 s', await p.evaluate(() => document.getElementById('glove-hint').hidden));
  await p.click('#glove-chip');
  await p.click('#glove-chip');
  check('OFF and ON again in the same conversation: no hint', await p.evaluate(() => GloveAssist.isOn() && document.getElementById('glove-hint').hidden));

  // 4. apply(): only with every condition met
  await holdRight(S_BEND);
  await p.evaluate(() => GloveAssist._setHands([{ label: 'Right', score: 0.95 }]));
  await sleep(300);
  const a1 = await p.evaluate((sc) => { const out = GloveAssist.apply(sc, knnModel); return { out, info: GloveAssist.lastInfo() }; }, SCORES);
  check('apply: right glove bent like "s" -> "s" overtakes "b" (camera alone b 0.80 > s 0.78)', a1.info.used && a1.out.s > a1.out.b, J(a1));
  const a2 = await p.evaluate((sc) => { GloveAssist._setHands([{ label: 'Left', score: 0.95 }]); const out = GloveAssist.apply(sc, knnModel); return { out, info: GloveAssist.lastInfo() }; }, SCORES);
  check('apply: the hand on camera is the LEFT one (open glove) -> "b" stays ahead', a2.info.used && a2.out.b > a2.out.s, J(a2));
  const a3 = await p.evaluate((sc) => { GloveAssist._setHands([{ label: 'Right', score: 0.6 }]); const out = GloveAssist.apply(sc, knnModel); return { same: JSON.stringify(out) === JSON.stringify(sc), info: GloveAssist.lastInfo() }; }, SCORES);
  check('apply: unsure which hand (score 0.6) -> scores unchanged', a3.same && a3.info.why === 'unsure which hand', J(a3));
  await sleep(400);
  const chipUnsure = await p.evaluate(() => { const b = document.getElementById('glove-chip'); return { state: GloveAssist.chipState(), txt: b.textContent,
    border: getComputedStyle(b).borderTopColor, dot: getComputedStyle(b.querySelector('.glove-chip-dot')).backgroundColor }; });
  check('chip: unsure hand -> amber outline and dot, "Camera only"',
    chipUnsure.state === 'idle' && chipUnsure.txt === 'Camera only' && chipUnsure.border === 'rgb(249, 115, 22)' && chipUnsure.dot === 'rgb(249, 115, 22)', J(chipUnsure));
  await shot('glove-talk-3-camera-only.png');
  await p.evaluate(() => GloveAssist._setHands([{ label: 'Right', score: 0.95 }]));
  await sleep(400);
  check('chip: sure hand again -> back to ON by itself', await p.evaluate(() => GloveAssist.chipState() === 'on'));
  await sleep(3500);   // every channel held still for 3.5 s
  const a4 = await p.evaluate((sc) => { const out = GloveAssist.apply(sc, knnModel); return { same: JSON.stringify(out) === JSON.stringify(sc), info: GloveAssist.lastInfo() }; }, SCORES);
  check('apply: no finger moved for 3 s (not worn) -> scores unchanged', a4.same && a4.info.why === 'not worn', J(a4));
  check('chip: not worn -> "Camera only"', await p.evaluate(() => GloveAssist.chipState() === 'idle'));
  await holdRight([0.2, 0.2, 0.2, 0.2, 0.2]);
  await sleep(200);
  await holdRight(S_BEND);
  await sleep(200);
  check('apply: fingers move again -> used again', await p.evaluate((sc) => { GloveAssist.apply(sc, knnModel); return GloveAssist.lastInfo().used; }, SCORES));
  await sleep(300);
  check('chip: fingers move again -> ON', await p.evaluate(() => GloveAssist.chipState() === 'on'));

  // 5. Detection rate with the chip ON vs OFF (fake camera, this container; the Pi is measured on the Pi)
  await p.evaluate(() => window.GestureDataRecorder.resumeHandLoop());
  const rate = async () => { await p.evaluate(() => window.GestureDataRecorder.getLoopStats()); await sleep(5000); return p.evaluate(() => window.GestureDataRecorder.getLoopStats()); };
  const withChip = await rate();
  await p.click('#glove-chip');   // OFF
  const without = await rate();
  console.log(`  detection here: chip ON ${withChip.detectFps.toFixed(1)} fps (${withChip.detectMs.toFixed(0)} ms/frame), OFF ${without.detectFps.toFixed(1)} fps (${without.detectMs.toFixed(0)} ms/frame); video ${withChip.videoFps.toFixed(1)} / ${without.videoFps.toFixed(1)} fps`);
  check('detection rate with the chip ON within 10 % of OFF (here)', withChip.detectFps >= without.detectFps * 0.9, J({ withChip, without }));
  const offScores = await p.evaluate((sc) => JSON.stringify(GloveAssist.apply(sc, knnModel)) === JSON.stringify(sc) && GloveAssist.lastInfo().why === 'off', SCORES);
  check('OFF -> scores unchanged', offScores);

  // 6. Unplugged -> no chip, OFF; back -> chip, still OFF
  await p.click('#glove-chip');
  await p.evaluate(() => SKGlove.disconnect());
  await sleep(200);
  check('glove gone: chip hidden and OFF', await p.evaluate(() => document.getElementById('glove-chip').hidden && !GloveAssist.isOn()));
  await p.evaluate(() => SKGlove.connect());
  await p.waitForFunction(() => window.SKGlove.ready(), null, { timeout: 5000 });
  await sleep(200);
  check('glove back: chip shown, OFF', await p.evaluate(() => !document.getElementById('glove-chip').hidden && !GloveAssist.isOn()));

  // 7. A new Sign turn -> OFF; "+ New conversation" with an empty thread -> OFF and the hint again; a reload -> OFF
  await p.click('#glove-chip');
  await p.click('#sign-to-speak-btn');
  await sleep(300);
  await p.click('#speak-to-sign-btn');
  await sleep(500);
  check('a new Sign turn starts OFF', await p.evaluate(() => !GloveAssist.isOn() && GloveAssist.chipState() === 'off'));
  await p.click('#glove-chip');
  await p.click('#newConversationBtn');
  await sleep(300);
  check('"+ New conversation" (no messages) -> gloves OFF', await p.evaluate(() => !GloveAssist.isOn() && document.body.dataset.screen === 'who-first'));
  await p.click('#card-sign');
  await sleep(500);
  await p.click('#glove-chip');
  check('the new conversation\'s first ON shows the hint again', await p.evaluate(() => !document.getElementById('glove-hint').hidden));
  await p.click('#glove-hint');
  check('a tap hides the hint', await p.evaluate(() => document.getElementById('glove-hint').hidden));
  await toSign(BASE + 'talk.html?glove=sim');
  await p.waitForFunction(() => window.SKGlove.ready(), null, { timeout: 5000 });
  check('a page load starts OFF', await p.evaluate(() => !GloveAssist.isOn() && !document.getElementById('glove-chip').hidden));

  check('Let\'s Talk: 0 console errors', errors.length === 0, J(errors));

  // 8. Train Gestures Step 3 (admin page: needs the admin login; skipped with a note when the page redirects)
  await p.goto(BASE + 'gesture-training.html?glove=sim');
  await sleep(1500);
  if (/gesture-training\.html/.test(p.url())) {
    const gt = await p.evaluate(() => ({ btn: !!document.getElementById('glove-toggle-btn'), assist: !!window.GloveAssist, inStep3: !!document.querySelector('#leftStep3 #glove-toggle-btn') }));
    check('Train Gestures: 🧤 button in the Step 3 panel, GloveAssist loaded', gt.btn && gt.assist && gt.inStep3, J(gt));
  } else {
    console.log('  (Train Gestures not checked: this browser is not logged in as admin -> ' + p.url() + ')');
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
