// seq-recognition phase (2026-11-15): whole-sign recognition in Let's Talk and Train Gestures, Playwright Chromium
// at 1024x600 with a fake camera (no real hand: recorded samples' frames are pushed through SeqLive._push).
//   - the whole-sign model loads; one recorded sign -> exactly one word; the same sign again after the hands went
//     down -> a second word; a 3-frame flash -> nothing; Undo; the "stop" sign sends the message
//   - ?seq=off -> no whole-sign model, the page still reaches the live camera
//   - the Guide screen and the Sign screen: no scroll at 1024x600
//   - Train Gestures: the model loads there and showSeqResult() fills the Step 3 display
//   - php/api/compile_seq_model.php: accepts the shipped file, refuses a wrong language / a cut file / GET
//   - 0 console errors
// Needs recorded samples (they are git-ignored): SK_SAMPLES=<saved_gestures folder>. Without it the sample steps
// are skipped (and say so).
// Run (server at SK_BASE, default http://localhost/SKR/; for the endpoint check start it with SK_MODELS_DIR set to
// an empty folder so the tracked files are not rewritten):  node tests/seq/talk-seq-check.mjs [--shots <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const SAMPLES = process.env.SK_SAMPLES || null;
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
const SIGNS = {};
for (const k of fs.readdirSync(path.join(ROOT, 'saved_gestures'))) {
  const f = path.join(ROOT, 'saved_gestures', k, 'sign.json');
  if (!fs.existsSync(f)) continue;
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  SIGNS[k] = { set: s.set, textEn: s.textEn, textFil: s.textFil, category: 'word', samples: 1, avatar: false, audio: { en: null, fil: null } };
}
function sample(label, i = 0) {
  const d = path.join(SAMPLES, label);
  const f = fs.readdirSync(d).filter((x) => /^sample_.*\.json$/.test(x)).sort()[i];
  return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).frames;
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await ctx.route('**/php/api/signs.php', (route) => route.fulfill({ contentType: 'application/json', body: J({ success: true, signs: SIGNS }) }));
// no MySQL where this check was written: the sample listing answers "no samples" instead of a 500
await ctx.route('**/php/api/save_gesture.php?summary=1*', (route) => route.fulfill({ contentType: 'application/json', body: J({ success: true, gestures: {}, signs: SIGNS, categories: { ESL: {}, FSL: {} } }) }));
await ctx.route('**/php/api/save_conversation.php', (route) => route.fulfill({ contentType: 'application/json', body: J({ success: true, conversation_id: 1 }) }));
const errors = [];
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name) }); } };
const noScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= 1024 && document.documentElement.scrollHeight <= 600);
async function toGuide(url) {
  await p.goto(url);
  await p.click('#card-sign');
  await p.waitForFunction(() => !document.getElementById('guide-start-btn').disabled, null, { timeout: 180000 });
}
async function toSign(url) {
  await toGuide(url);
  await p.click('#guide-start-btn');
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
}
const recording = () => p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 60000 });
// Pushes one recorded sign (its frames, then the hands gone) in one go, on a clock ahead of the camera's own
// (empty) frames so the two never mix. cut: only the first N frames.
const play = (frames, cut) => p.evaluate(({ frames, cut }) => {
  window.__seqT = Math.max(performance.now(), window.__seqT || 0) + 2000;
  const t0 = window.__seqT;
  let last = t0;
  (cut ? frames.slice(0, cut) : frames).forEach((f) => {
    last = t0 + f.t;
    SeqLive._push({ t: last, hands: (f.hands || []).filter((h) => h && h.landmarks && h.landmarks.length >= 21) });
  });
  SeqLive._push({ t: last + 450, hands: [] });
  window.__seqT = last + 450;
}, { frames, cut: cut || 0 });
const draft = () => p.evaluate(() => TalkSigning.getDraft());

try {
  // 1. Guide + model
  await toGuide(BASE + 'talk.html');
  const guide = await p.evaluate(() => {
    const b = document.getElementById('guide-start-btn').getBoundingClientRect();
    const items = Array.from(document.querySelectorAll('.guide-item')).map((e) => e.getBoundingClientRect());
    return { btnBottom: Math.round(b.bottom), lastItemBottom: Math.round(items[items.length - 1].bottom), btnTop: Math.round(b.top),
      text: document.querySelectorAll('.guide-item')[1].textContent.replace(/\s+/g, ' ').trim() };
  });
  // (the list scrolls inside its own box when it is longer than the screen, as before this phase)
  check('Guide: the Start button is on screen, no page scroll (1024x600)', guide.btnBottom <= 600 && await noScroll(), J(guide));
  check('Guide: step 2 says to lower or stop the hand', /ibaba ang kamay o ihinto/.test(guide.text), guide.text);
  await shot('seq-1-guide.png');
  const model = await p.evaluate(() => { const m = SeqLive.model(); return m ? { rows: m.rowLabel.length, labels: m.labels.length, lang: m.header.lang } : null; });
  check('the whole-sign model is loaded before the Guide opens (ESL)', !!model && model.lang === 'ESL' && model.rows > 0 && model.labels >= 2, J(model));

  await p.click('#guide-start-btn');
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
  await recording();
  check('Sign screen: whole-sign recognition is on, no scroll', await p.evaluate(() => SeqLive.active()) && await noScroll());
  const lines = await p.evaluate(() => ({ loaded: !!window.HandOverlay, running: window.HandOverlay && HandOverlay.running(), idle: GestureDataRecorder.setLoopOptions({}).idleRatio }));
  check('Sign screen: smooth hand lines loaded, not drawing with no hand in view; idle 0.6', lines.loaded && !lines.running && lines.idle === 0.6, J(lines));

  if (!SAMPLES) {
    console.log('SKIP the recorded-sign steps: set SK_SAMPLES=<saved_gestures folder with samples>');
  } else {
    const ty = SIGNS.thank_you.textEn, gd = SIGNS.good.textEn;
    await play(sample('thank_you', 0));
    let d = await draft();
    check('one recorded "thank you" -> exactly one word', J(d.keys) === J(['thank_you']) && d.words[0] === ty, J(d));
    check('the caption shows the sign', await p.evaluate(() => document.getElementById('signing-caption').textContent) === ty);
    await sleep(2500);
    check('the caption still shows the sign 2.5 s later (it stays until the next answer)', await p.evaluate(() => document.getElementById('signing-caption').textContent) === ty);
    await play(sample('thank_you', 1));
    d = await draft();
    check('the same sign again after the hands went down -> a second word', J(d.keys) === J(['thank_you', 'thank_you']), J(d));
    await play(sample('good', 0), 3);
    d = await draft();
    check('a 3-frame flash of a hand -> nothing added', d.keys.length === 2, J(d));
    await play(sample('good', 0));
    d = await draft();
    check('another sign -> a third word', J(d.keys) === J(['thank_you', 'thank_you', 'good']) && d.words[2] === gd, J(d));
    await shot('seq-2-sign.png');
    check('Sign screen with a sentence: no scroll', await noScroll());
    await p.click('#signing-undo-btn');
    d = await draft();
    check('Undo removes the last sign', J(d.keys) === J(['thank_you', 'thank_you']), J(d));
    await play(sample('stop', 0));
    await sleep(500);
    const sent = await p.evaluate(() => ({ draft: TalkSigning.getDraft().keys.length, thread: document.getElementById('thread').textContent.replace(/\s+/g, ' ') }));
    check('the "stop" sign sends the message (2 words in the thread, sentence empty)', sent.draft === 0 && /thank you/i.test(sent.thread), J(sent).slice(0, 300));
  }

  // 2. ?seq=off: the frame k-NN path, as before
  await toSign(BASE + 'talk.html?seq=off');
  await recording();
  const off = await p.evaluate(() => ({ model: !!SeqLive.model(), active: SeqLive.active(), knn: typeof knnModel === 'object' && !!knnModel && modelTrained }));
  check('?seq=off: no whole-sign model, the frame k-NN model is loaded, the camera is live', !off.model && !off.active && off.knn, J(off));

  // 3. Train Gestures
  await p.goto(BASE + 'gesture-training.html');
  await p.waitForFunction(() => window.SeqLive && SeqLive.model(), null, { timeout: 120000 }).catch(() => {});
  const tg = await p.evaluate(() => {
    const m = SeqLive.model();
    if (!m) return null;
    currentStep = 3;
    showSeqResult({ type: 'sign', label: 'thank_you', ratio: 0.4, second: 'good', frames: 30, ms: 2000, reason: 'gone', fromHold: false }, false);
    const a = { res: document.getElementById('livePredResult').textContent, cls: document.getElementById('livePredResult').className, bar: document.getElementById('confBar').style.width };
    showSeqResult({ type: 'unsure', label: 'thank_you', ratio: 0.95, second: 'good', frames: 30, ms: 2000, reason: 'gone', fromHold: false }, false);
    const b = { res: document.getElementById('livePredResult').textContent, cls: document.getElementById('livePredResult').className, bar: document.getElementById('confBar').style.width };
    return { rows: m.rowLabel.length, a, b };
  });
  check('Train Gestures: the whole-sign model loads with the k-NN model', !!tg && tg.rows > 0, J(tg));
  check('Train Gestures Step 3: a clear sign is shown as detected, 60%', !!tg && /detected/.test(tg.a.cls) && tg.a.bar === '60%' && !/Not sure/.test(tg.a.res), J(tg && tg.a));
  check('Train Gestures Step 3: an unclear sign is shown as "Not sure"', !!tg && !/detected/.test(tg.b.cls) && /^Not sure/.test(tg.b.res) && tg.b.bar === '5%', J(tg && tg.b));

  // 4. The Compile endpoint
  const bytes = fs.readFileSync(path.join(ROOT, 'models', 'seq_ESL.bin'));
  const post = async (lang, body, method = 'POST') => {
    const r = await fetch(BASE + 'php/api/compile_seq_model.php?lang=' + lang, method === 'POST' ? { method, headers: { 'Content-Type': 'application/octet-stream' }, body } : { method });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  if (!process.env.SK_MODELS_DIR) {
    console.log('SKIP the accepting endpoint step: start the server with SK_MODELS_DIR=<empty folder> and pass the same value here');
  } else {
    const ok = await post('ESL', bytes);
    const written = path.join(process.env.SK_MODELS_DIR, 'seq_ESL.bin');
    check('compile_seq_model.php: the ESL file is accepted and written byte for byte', ok.status === 200 && ok.json && ok.json.success === true && ok.json.bytes === bytes.length
      && fs.existsSync(written) && fs.readFileSync(written).equals(bytes), J(ok));
  }
  const wrongLang = await post('FSL', bytes);
  check('compile_seq_model.php: an ESL file sent as FSL is refused (400)', wrongLang.status === 400 && wrongLang.json && wrongLang.json.success === false, J(wrongLang));
  const cut = await post('ESL', bytes.subarray(0, bytes.length - 4));
  check('compile_seq_model.php: a cut file is refused (400)', cut.status === 400 && /bytes, but its header needs/.test(cut.json && cut.json.error), J(cut));
  const junk = await post('ESL', Buffer.from('hello there, not a model'));
  check('compile_seq_model.php: a file that is not a model is refused (400)', junk.status === 400, J(junk));
  const get = await post('ESL', null, 'GET');
  check('compile_seq_model.php: GET is refused (405)', get.status === 405, J(get));

  check('0 console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
