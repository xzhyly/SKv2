// talk.html signing screen layout at 1024x600 (owner feedback 2026-10-18, layout only): the camera
// fills its panel (object-fit cover, mirrored) and the panel takes the free height so the screen fills
// 600 px with no scroll; the landmark canvas covers the same box; the sentence has its own white bar
// under the camera (>= 22 px bold, at most two lines, newest word highlighted, newest words kept when
// longer, textContent = words joined by spaces); the live status is a small chip on the video.
// Checked on the first turn and on a later turn (96 px thread strip above).
//
// Needs the site at SK_BASE (default http://localhost/SKR/) and Playwright (`import('playwright')`, else
// the global install). Uses Chromium's fake camera. --shots <dir> writes the screenshots
// (talk-layout-after-*.png). Run: node tests/accounts-quiz/talk-layout-check.mjs
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
    const rect = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
    const v = document.getElementById('signing-video');
    const d = document.getElementById('signing-draft');
    const cs = getComputedStyle(d);
    const newest = d.querySelector('.draft-word.newest');
    const nb = newest && newest.getBoundingClientRect();
    const db = d.getBoundingClientRect();
    return {
      box: rect('#camera-box'), video: rect('#signing-video'), canvas: rect('#tlCanvas1'), draft: rect('#signing-draft'),
      chip: rect('.signing-caption-pill'), chipFont: getComputedStyle(document.getElementById('signing-caption')).fontSize,
      controls: rect('.signing-controls-row'), fit: getComputedStyle(v).objectFit, mirror: getComputedStyle(v).transform,
      canvasFit: getComputedStyle(document.getElementById('tlCanvas1')).objectFit,
      font: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), bg: cs.backgroundColor,
      clipH: d.querySelector('.signing-draft-clip') ? d.querySelector('.signing-draft-clip').getBoundingClientRect().height : 0,
      lineH: parseFloat(cs.lineHeight), text: d.textContent,
      newest: newest ? newest.textContent : null, newestBg: newest ? getComputedStyle(newest).backgroundColor : null,
      newestVisible: !!nb && nb.top >= db.top && nb.bottom <= db.bottom,
      draftInsideVideo: !!document.querySelector('#camera-box #signing-draft'),
      scroll: [document.documentElement.scrollHeight, document.documentElement.scrollWidth],
    };
  });
}
function checkLayout(label, m, words, top) {
  check(`${label}: camera panel from y=${top} to the sentence bar, 760 px wide`, m.box.y === top && m.box.w === 760 && m.draft.y - m.box.bottom === 10, J(m.box));
  check(`${label}: video fills the whole panel (object-fit cover, mirrored)`, J([m.video.x, m.video.y, m.video.w, m.video.h]) === J([m.box.x, m.box.y, m.box.w, m.box.h]) && m.fit === 'cover' && m.mirror === 'matrix(-1, 0, 0, 1, 0, 0)', J(m));
  check(`${label}: landmark canvas covers the same box, object-fit cover`, J([m.canvas.x, m.canvas.y, m.canvas.w, m.canvas.h]) === J([m.box.x, m.box.y, m.box.w, m.box.h]) && m.canvasFit === 'cover', J(m.canvas));
  check(`${label}: page fills 600 px with no scroll (controls end at 588, 12 px margin)`, m.controls.bottom === 588 && J(m.scroll) === J([600, 1024]), J({ controls: m.controls, scroll: m.scroll }));
  check(`${label}: sentence bar under the camera, full width, white, >= 22 px bold, not on the video`, m.draft.w === 760 && m.draft.x === m.box.x && m.font >= 22 && m.weight >= 700 && m.bg === 'rgb(255, 255, 255)' && !m.draftInsideVideo, J(m));
  check(`${label}: at most two lines, newest word highlighted and visible`, m.clipH <= 2 * m.lineH + 0.5 && m.newest === words[words.length - 1] && m.newestBg !== 'rgba(0, 0, 0, 0)' && m.newestVisible, J({ clipH: m.clipH, lineH: m.lineH, newest: m.newest, bg: m.newestBg }));
  check(`${label}: textContent is the words joined by spaces`, m.text === words.join(' '), m.text);
  check(`${label}: status is a small chip on the video`, m.chip.y >= m.box.y && m.chip.bottom <= m.box.bottom && parseFloat(m.chipFont) <= 16 && m.chip.h <= 32, J({ chip: m.chip, font: m.chipFont }));
}
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/talk-layout-after-${name}.png` }); };

try {
  await p.goto(BASE + 'talk.html');
  await sleep(1000);
  await p.click('#card-sign');
  await live();
  const m0 = await measure();
  check('empty bar: 76 px, muted hint, camera does not move when words arrive', m0.draft.h === 76, J(m0.draft));
  await shot('1-live');
  await fill(3);
  checkLayout('first turn, 3 words', await measure(), SENT.slice(0, 3), 102);
  await shot('2-sentence');
  await fill(12);
  checkLayout('first turn, 12 words (two lines)', await measure(), SENT, 102);
  await shot('3-long-sentence');
  const many = SENT.concat(SENT, ['last']);
  await p.evaluate((w) => { const el = document.getElementById('signing-draft'); window.TalkSigning.renderDraft(el, w); }, many);
  checkLayout('first turn, 25 words (longer than two lines)', await measure(), many, 102);
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
