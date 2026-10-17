// talk.html signing screen layout at 1024x600, side by side (docs/design/talk-camera-wireframe.html,
// owner 2026-10-18, layout only): the camera on the left at its own aspect ratio (videoWidth /
// videoHeight), the full height under the top bar, object-fit: contain (nothing cropped), mirrored, the
// landmark canvas on the same box; the live status a small chip on the video. The right column stacks
// the signed sentence (>= 24 px bold, whole lines, newest word highlighted orange, newest kept when
// longer, textContent = words joined by spaces), EN|FIL (52 px), the main action (60 px) and Guide
// (52 px), full width. No scroll. Checked on the first turn, on a later turn (96 px thread strip above)
// and with a 16:9 camera ratio (simulated).
//
// Needs the site at SK_BASE (default http://localhost/SKR/) and Playwright (`import('playwright')`, else
// the global install). Uses Chromium's fake camera (320x240). --shots <dir> writes the screenshots
// (talk-side-after-*.png). Run: node tests/accounts-quiz/talk-layout-check.mjs
import { createRequire } from 'node:module';

const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  return createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const { chromium } = await loadPlaywright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -- ' + String(detail).slice(0, 400) : ''}`);
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await browser.newContext({ viewport: { width: 1024, height: 600 } })).newPage();
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
const SENT = ['Dont know', '17', '10', 'hello', 'thank you', 'where', 'bathroom', 'please', 'help', 'good morning', 'my name', 'friend'];

async function live() {
  await p.waitForFunction(() => document.body.dataset.screen === 'signing', null, { timeout: 30000 });
  if (await p.evaluate(() => document.getElementById('screen-signing').dataset.signing === 'guide')) {
    await p.waitForFunction(() => !document.getElementById('guide-start-btn').disabled, null, { timeout: 120000 });
    await p.click('#guide-start-btn');
  }
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
  await sleep(1500);
}
// Shows a sentence (through the page's own renderDraft) and a status, as while recording. The fake
// camera has no hand, so the live loop would keep writing "Show your sign": it is paused for this.
async function fill(n) {
  await p.evaluate((words) => {
    document.getElementById('camera-box').classList.add('recording');
    const el = document.getElementById('signing-draft');
    window.TalkSigning.renderDraft(el, words);
    el.classList.add('show');
    if (window.GestureDataRecorder && window.GestureDataRecorder.pauseHandLoop) window.GestureDataRecorder.pauseHandLoop();
  }, SENT.slice(0, n));
  await sleep(300);
  await p.evaluate(() => { document.getElementById('signing-caption').textContent = 'Stabilizing…'; });
}
function measure() {
  return p.evaluate(() => {
    const rect = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const v = document.getElementById('signing-video');
    const d = document.getElementById('signing-draft');
    const cs = getComputedStyle(d);
    const clip = d.querySelector('.signing-draft-clip');
    const newest = d.querySelector('.draft-word.newest');
    const nb = newest && newest.getBoundingClientRect();
    const db = d.getBoundingClientRect();
    // the picture inside the video element (object-fit: contain)
    const vb = v.getBoundingClientRect();
    const k = Math.min(vb.width / v.videoWidth, vb.height / v.videoHeight);
    return {
      box: rect('#camera-box'), video: rect('#signing-video'), canvas: rect('#tlCanvas1'), side: rect('.signing-side'),
      picture: { w: Math.round(v.videoWidth * k), h: Math.round(v.videoHeight * k) }, vw: v.videoWidth, vh: v.videoHeight,
      draft: rect('#signing-draft'), lang: rect('.lang-toggle'), main: rect('#stop-signing-btn'), guide: rect('#chip-guide'),
      chip: rect('.signing-caption-pill'), chipFont: getComputedStyle(document.getElementById('signing-caption')).fontSize,
      fit: getComputedStyle(v).objectFit, mirror: getComputedStyle(v).transform,
      font: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), bg: cs.backgroundColor, lineH: parseFloat(cs.lineHeight),
      clipH: clip ? clip.getBoundingClientRect().height : 0, clipMax: clip ? parseFloat(getComputedStyle(clip).maxHeight) : 0,
      text: d.textContent, newest: newest ? newest.textContent : null, newestColor: newest ? getComputedStyle(newest).color : null,
      newestVisible: !!nb && nb.top >= db.top && nb.bottom <= db.bottom,
      scroll: [document.documentElement.scrollHeight, document.documentElement.scrollWidth],
    };
  });
}
const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
function checkLayout(label, m, words, top) {
  const H = 600 - 12 - top;
  check(`${label}: camera on the left, full height under the bar (${top}..588), at the camera's ratio ${m.vw}:${m.vh}`,
    m.box.x === 12 && m.box.y === top && m.box.h === H && Math.abs(m.box.w - H * m.vw / m.vh) <= 1, J(m.box));
  check(`${label}: object-fit contain, mirrored, the whole picture shown (no crop, no bars)`,
    same(m.video, m.box) && m.fit === 'contain' && m.mirror === 'matrix(-1, 0, 0, 1, 0, 0)' && Math.abs(m.picture.w - m.box.w) <= 1 && Math.abs(m.picture.h - m.box.h) <= 1, J({ video: m.video, picture: m.picture }));
  check(`${label}: landmark canvas on the same box as the picture`, same(m.canvas, m.box), J(m.canvas));
  check(`${label}: right column from camera + 14 px to 1012, top to 588`, m.side.x === m.box.right + 14 && m.side.right === 1012 && m.side.y === top && m.side.bottom === 588, J(m.side));
  check(`${label}: EN|FIL 52, main action 60, Guide 52 px, full column width, stacked under the sentence`,
    m.lang.h === 52 && m.main.h === 60 && m.guide.h === 52 && [m.lang, m.main, m.guide, m.draft].every((r) => r.w === m.side.w)
    && m.draft.bottom < m.lang.y && m.lang.bottom < m.main.y && m.main.bottom < m.guide.y && m.guide.bottom === 588, J({ draft: m.draft, lang: m.lang, main: m.main, guide: m.guide }));
  check(`${label}: sentence >= 24 px bold, white box`, m.font >= 24 && m.weight >= 700 && m.bg === 'rgb(255, 255, 255)', J({ font: m.font, weight: m.weight, bg: m.bg }));
  check(`${label}: sentence wraps over whole lines (>= 4), clip a multiple of the line height`,
    m.clipMax >= 4 * m.lineH - 0.5 && Math.abs(m.clipMax / m.lineH - Math.round(m.clipMax / m.lineH)) < 0.01 && m.clipH <= m.clipMax + 0.5, J({ clipMax: m.clipMax, lineH: m.lineH, clipH: m.clipH }));
  check(`${label}: newest word highlighted orange and visible`, m.newest === words[words.length - 1] && m.newestColor === 'rgb(234, 106, 10)' && m.newestVisible, J({ newest: m.newest, color: m.newestColor }));
  check(`${label}: textContent is the words joined by spaces`, m.text === words.join(' '), m.text);
  check(`${label}: status is a small chip on the video`, m.chip.x >= m.box.x && m.chip.y >= m.box.y && m.chip.bottom <= m.box.bottom && parseFloat(m.chipFont) <= 16 && m.chip.h <= 32, J({ chip: m.chip, font: m.chipFont }));
  check(`${label}: fits 1024x600, no scroll`, J(m.scroll) === J([600, 1024]), J(m.scroll));
}
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/talk-side-after-${name}.png` }); };

try {
  await p.goto(BASE + 'talk.html');
  await sleep(1000);
  await p.click('#card-sign');
  await live();
  const m0 = await measure();
  check('empty: muted hint in the sentence box; camera 648x486 for the 4:3 camera', m0.box.w === 648 && m0.box.h === 486 && m0.draft.h > 4 * m0.lineH, J({ box: m0.box, draft: m0.draft }));
  await shot('1-live');
  await fill(3);
  checkLayout('first turn, 3 words', await measure(), SENT.slice(0, 3), 102);
  await shot('2-sentence');
  await fill(12);
  checkLayout('first turn, 12 words', await measure(), SENT, 102);
  await shot('3-long-sentence');
  const many = SENT.concat(SENT, SENT, ['last']);
  await p.evaluate((w) => { const el = document.getElementById('signing-draft'); window.TalkSigning.renderDraft(el, w); }, many);
  checkLayout('first turn, 37 words (longer than the box)', await measure(), many, 102);
  // a 16:9 camera (simulated: the page sets --cam-ar from videoWidth/videoHeight): the right column keeps >= 300 px,
  // the picture letterboxes inside the panel (contain: never cropped)
  await p.evaluate(() => document.getElementById('camera-box').style.setProperty('--cam-ar', '16 / 9'));
  await sleep(200);
  const w = await measure();
  check('16:9 camera: right column still >= 300 px, panel full height, no scroll', w.side.w >= 300 && w.box.h === 486 && w.box.right + 14 === w.side.x && J(w.scroll) === J([600, 1024]), J({ box: w.box, side: w.side }));
  await shot('6-wide-camera-simulated');
  await p.evaluate(() => { const v = document.getElementById('signing-video'); document.getElementById('camera-box').style.setProperty('--cam-ar', v.videoWidth + ' / ' + v.videoHeight); });
  await sleep(200);
  await shot('5-overflow');

  // a later turn: one message in the thread, so the 96 px strip sits above the camera
  await p.evaluate(() => { document.getElementById('camera-box').classList.remove('recording'); if (window.GestureDataRecorder && window.GestureDataRecorder.resumeHandLoop) window.GestureDataRecorder.resumeHandLoop(); });
  await p.click('#backBtn');
  await p.click('#card-speak');
  await p.waitForFunction(() => document.body.dataset.screen === 'speaking' && !document.body.classList.contains('modal-open'), null, { timeout: 60000 });
  await p.fill('#speaking-input', 'Hello');
  await p.click('#speaking-translate');
  await p.click('#speaking-send');
  await p.waitForSelector('.confirm-add-btn', { state: 'visible' });
  await p.click('.confirm-add-btn');
  await p.waitForFunction(() => document.body.dataset.screen === 'thread');
  await p.click('#turn-sign-btn');
  await live();
  await fill(3);
  checkLayout('later turn (thread strip above), 3 words', await measure(), SENT.slice(0, 3), 198);
  await shot('4-second-turn');
  check('0 console errors', errors.length === 0, J(errors));
} catch (e) {
  check('check ran to the end', false, e.stack || e.message);
} finally {
  await browser.close();
}
console.log(failures ? `FAILED (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
