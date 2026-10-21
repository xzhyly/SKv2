// talk-turns-audio phase (docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md), Let's Talk,
// Learn Signs and Quiz in Playwright Chromium at 1024x600 (fake camera and microphone):
//   A  Speak or Type "hi" (no sign with avatar data): the avatar fingerspells h, i; the avatar fills
//      the area under the top bar, the conversation strip is hidden, the caption highlights the
//      current letter; no .webm / .mp4 / fallback.png is requested.
//   B  "Hello Jose 25 3": hello is a sign, Jose spelled J-O-S-E, 25 spelled 2-5, 3 one number sign,
//      all one continuous avatar run; Replay plays it again. pi-fixes 2026-10-21: Translate = Send —
//      the message is in the conversation as soon as Translate is tapped, no button shows while the
//      avatar signs, then Replay / Done; Done returns to "Whose turn is it?" (no popup). No Edit.
//   C  Sign screen: Send 🔊 (no Translate / Stop & Add). Leaving a turn discards what was not sent
//      (owner change 2026-10-19), both directions: "🗣 Speak or Type" empties the signed sentence and
//      the recognizer buffer (Sign starts empty again); "🤟 Sign instead" empties the typed text,
//      stops the running mic and drops its transcript; Back drops an unsent avatar preview; Back
//      from Sign empties the sentence; + New conversation (no messages yet) empties the field. A
//      language switch inside the turn keeps the sentence. Send adds the message at once, returns to
//      "Whose turn is it?" and speaks it: recorded audio for a sign that has it, the browser voice
//      for the rest (one utterance); 🔊 on the bubble stops / replays it.
//   E  Learn Signs and Quiz request no video either. 0 console errors, no scroll on every screen.
// Recognition is driven the way the live loop reads it (window.knnPredict / extractFeatures /
// GestureDataRecorder.getLatestLandmarks replaced in the page), not changed. Avatar clips are built
// from the committed Holistic fixture and served by request interception, and signs.php's answer is
// rewritten to say which signs have them (nothing is written into saved_gestures/). The browser
// voice is a recording stand-in (the container has no voices).
// Run (server at SK_BASE, default http://localhost/SKR/): node tests/talk-turns-audio/talk-check.mjs [--shots <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  return createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const { chromium } = await loadPlaywright();
const Clip = require('../../js/avatar-clip.js');
const FIX = JSON.parse(fs.readFileSync(path.join(repo, 'tests', 'avatar', 'fixtures', 'holistic-signs.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -- ' + String(detail).slice(0, 500) : ''}`);
}

// Signs that get avatar data here: the letters, the number signs and a few words/phrases.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const WORDS = ['hello', 'my_name', 'how_are_you', 'good_morning'];
const AVATAR = new Set([...LETTERS, ...NUMBERS, ...WORDS]);
const AUDIO = { hello: { en: 'saved_gestures/hello/audio_en.wav?v=1', fil: null } };
function fixtureClip(key) {
  const i = [...AVATAR].indexOf(key);
  const s = FIX.signs[i % FIX.signs.length];
  return Clip.buildClip({ key, fps: FIX.fps, video: { w: s.w, h: s.h, durationMs: s.durationMs }, frames: s.frames,
    trim: { ...s.oldAutoTrim, auto: true }, createdAt: '2026-10-19T00:00:00Z' });
}
// 0.4 s of silence, 8 kHz mono 16-bit.
function wav() {
  const n = 3200, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

// Before any page script: a stand-in browser voice (records utterances, ends after 300 ms), a log of
// media play() calls, and AvatarPlayer instances whose play() records the keys of each run.
const INIT = `(() => {
  window.__utter = []; window.__plays = []; window.__runs = [];
  const fake = {
    speaking: false, _q: [],
    getVoices() { return [{ lang: 'en-US', name: 'Stand-in', default: true }, { lang: 'fil-PH', name: 'Stand-in fil' }]; },
    addEventListener() {}, removeEventListener() {},
    speak(u) { window.__utter.push({ text: u.text, lang: u.lang }); const t = setTimeout(() => { u.onend && u.onend(); }, 300); this._q.push({ u, t }); },
    cancel() { this._q.forEach(({ u, t }) => { clearTimeout(t); }); this._q = []; window.__cancels = (window.__cancels || 0) + 1; },
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get() { return fake; } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { if (this.src && !this.srcObject) window.__plays.push(this.src); return play.apply(this, arguments); };
  // recordings scheduled through Web Audio (js/sign-audio.js since the gapless change): the fetched URL
  // and each AudioBufferSourceNode started
  window.__audioFetches = []; window.__sources = 0;
  const f = window.fetch;
  window.fetch = function (u) { if (/audio_/.test(String(u))) window.__audioFetches.push(String(u)); return f.apply(this, arguments); };
  const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () { window.__sources++; return st.apply(this, arguments); };
  let AP;
  Object.defineProperty(window, 'AvatarPlayer', { configurable: true, get() { return AP; }, set(v) {
    AP = v; const create = v.create;
    v.create = function (o) {
      const p = create(o); const pl = p.play;
      p.play = function (preps, po) { window.__runs.push(preps.map((x) => x.key)); return pl.call(p, preps, po); };
      return p;
    };
  } });
})();`;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await ctx.addInitScript(INIT);
const media = [];   // every request for a video or the old fallback image
const errors = [];
const allReqs = [];  // every request, for the network log printed for "hi"
ctx.on('request', (r) => { allReqs.push(r.url()); if (/\.(webm|mp4)(\?|$)|fallback\.png/i.test(r.url())) media.push(r.url()); });
await ctx.route('**/php/api/signs.php', async (route) => {
  if (route.request().method() !== 'GET') return route.continue();
  const res = await route.fetch();
  const json = await res.json();
  for (const [k, s] of Object.entries(json.signs)) {
    s.avatar = AVATAR.has(k);
    s.audio = AUDIO[k] || { en: null, fil: null };
  }
  route.fulfill({ response: res, json });
});
await ctx.route('**/saved_gestures/*/avatar.json', (route) => {
  const key = decodeURIComponent(/saved_gestures\/([^/]+)\/avatar\.json/.exec(route.request().url())[1]);
  if (!AVATAR.has(key)) return route.fulfill({ status: 404, body: '' });
  route.fulfill({ contentType: 'application/json', body: J(fixtureClip(key)) });
});
await ctx.route('**/saved_gestures/hello/audio_en.wav*', (route) => route.fulfill({ contentType: 'audio/wav', body: wav() }));

const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `talk-audio-after-${name}.png`) }); };
const noScroll = async (where) => {
  const d = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, document.body.scrollWidth, document.body.scrollHeight]);
  check(`${where}: no scroll at 1024x600`, d[0] <= 1024 && d[1] <= 600 && d[2] <= 1024 && d[3] <= 600, J(d));
};
const rect = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), visible: b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' }; }, sel);
const screen = () => p.evaluate(() => document.body.dataset.screen);

try {
  await p.goto(BASE + 'talk.html');
  await p.click('#card-speak');
  await p.waitForFunction(() => document.getElementById('screen-speaking').dataset.wait === '0', null, { timeout: 180000 });
  check('Speak or Type has "🤟 Sign instead"', (await p.textContent('#speak-to-sign-btn')).includes('Sign instead') && (await rect('#speak-to-sign-btn')).visible);
  await shot('3-speak-type');
  await noScroll('Speak or Type');
  // + New conversation with nothing sent yet: back to "Who speaks first?", the typed text is gone.
  // (set without focus: a focused field raises the on-screen keyboard, which hides + New conversation)
  await p.evaluate(() => { const i = document.getElementById('speaking-input'); i.value = 'zz never sent'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#newConversationBtn');
  await sleep(200);
  const nc = { screen: await screen(), field: await p.inputValue('#speaking-input') };
  await p.click('#card-speak');
  await sleep(200);
  check('+ New conversation drops the unsent typed text', nc.screen === 'who-first' && nc.field === '' && (await p.inputValue('#speaking-input')) === '', J(nc));

  // ── A. "hi" -> fingerspelled by the avatar ──
  await p.fill('#speaking-input', 'hi');
  await p.dispatchEvent('#speaking-input', 'input');
  const reqFrom = allReqs.length;
  await p.click('#speaking-translate');
  const atTranslate = await p.evaluate(() => {
    const r = [...document.querySelectorAll('#thread-list .bubble-row.hearing')].pop();
    return { text: r ? r.querySelector('.bubble-text').textContent : null, field: document.getElementById('speaking-input').value,
      playing: document.getElementById('screen-speaking').dataset.playing,
      actions: getComputedStyle(document.querySelector('.speaking-preview-actions')).visibility };
  });
  check('Translate = Send: "hi" is in the conversation at once, field emptied', atTranslate.text === 'hi' && atTranslate.field === '', J(atTranslate));
  check('while the avatar signs: no buttons (Replay / Done hidden)', atTranslate.playing === '1' && atTranslate.actions === 'hidden', J(atTranslate));
  await p.waitForFunction(() => document.querySelectorAll('#speaking-caption .ltr').length === 2, null, { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('#speaking-caption .ltr.on'), null, { timeout: 15000 });
  const capA = await p.evaluate(() => ({ text: document.getElementById('speaking-caption').textContent, sub: document.querySelector('#speaking-caption .cap-sub').textContent, on: document.querySelector('#speaking-caption .ltr.on')?.textContent }));
  check('"hi": caption spells H I with the current letter highlighted', /HI$/.test(capA.text) && /Spelling “hi” \(no sign yet\) · letter [12] of 2/.test(capA.sub), J(capA));
  const frame = await rect('#speaking-sign-frame');
  const canvas = await rect('#speaking-avatar');
  check('avatar fills the area under the top bar (12 px margin)', frame.x === 12 && frame.y === 102 && frame.w === 1000 && frame.h === 486 && canvas.w === 1000 && canvas.h === 486, J({ frame, canvas }));
  check('conversation strip hidden while the avatar plays', !(await rect('#thread'))?.visible, J(await rect('#thread')));
  check('no <video> or <img> in the preview', await p.evaluate(() => document.querySelectorAll('#screen-speaking video, #screen-speaking img').length === 0));
  await shot('4-avatar-spells-hi');
  await p.waitForFunction(() => window.__runs.length >= 1 && !document.querySelector('#speaking-caption .ltr.on'), null, { timeout: 60000 });
  check('"hi": one avatar run h, i', J(await p.evaluate(() => window.__runs)) === J([['h', 'i']]), J(await p.evaluate(() => window.__runs)));
  check('"hi": no .webm / .mp4 / fallback.png requested', media.length === 0, J(media));
  console.log('      network log while "hi" played: ' + J(allReqs.slice(reqFrom).map((u) => u.replace(BASE, ''))));
  await p.waitForFunction(() => document.getElementById('screen-speaking').dataset.playing === '0', null, { timeout: 30000 });
  check('after signing: Replay / Done in the caption bar (no Edit / Send)',
    J(await p.$$eval('.speaking-preview-actions button', (b) => b.map((x) => x.textContent.trim()))) === J(['↻ Replay', 'Done']) &&
    (await p.evaluate(() => getComputedStyle(document.querySelector('.speaking-preview-actions')).visibility)) === 'visible');
  await noScroll('avatar preview');

  // ── B. sign + spelled name + digits + one number sign ──
  await p.click('#speaking-done');
  await sleep(300);
  check('Done: back to "Whose turn is it?"', (await screen()) === 'thread');
  await p.click('#turn-speak-btn');
  await sleep(300);
  await p.fill('#speaking-input', 'Hello Jose 25 3');
  await p.dispatchEvent('#speaking-input', 'input');
  await p.click('#speaking-translate');
  await p.waitForFunction(() => { const l = document.querySelectorAll('#speaking-caption .cap-spell')[0]; return l && l.children[1] && l.children[1].classList.contains('on'); }, null, { timeout: 30000 });
  await shot('4b-avatar-spells-jose');
  await p.waitForFunction(() => window.__runs.length >= 2 && !document.querySelector('#speaking-caption .on'), null, { timeout: 90000 });
  const runB = await p.evaluate(() => window.__runs[1]);
  check('"Hello Jose 25 3": one continuous run hello, j o s e, two five, three', J(runB) === J(['hello', 'j', 'o', 's', 'e', 'two', 'five', 'three']), J(runB));
  const capB = await p.evaluate(() => [...document.querySelectorAll('#speaking-caption .cap-line > span')].map((s) => s.className + ':' + s.textContent));
  check('caption: Hello as a word, JOSE and 25 as letters, 3 as a word', J(capB) === J(['cap-word:Hello', 'cap-spell:JOSE', 'cap-spell:25', 'cap-word:3']), J(capB));
  await p.click('#speaking-replay');
  await p.waitForFunction(() => window.__runs.length >= 3, null, { timeout: 15000 });
  check('Replay plays the sentence again', J(await p.evaluate(() => window.__runs[2])) === J(runB));
  await p.waitForFunction(() => !document.querySelector('#speaking-caption .on'), null, { timeout: 90000 });
  await p.click('#speaking-done', { timeout: 30000 });
  await sleep(300);
  check('Done: no popup, back to "Whose turn is it?"', (await screen()) === 'thread' && !(await p.evaluate(() => document.body.classList.contains('modal-open'))));
  check('the message is in the conversation once (Typed, right side)',
    (await p.$$eval('#thread-list .bubble-row.hearing .bubble-text', (b) => b.filter((x) => x.textContent === 'Hello Jose 25 3').length)) === 1 && await p.evaluate(() => { const r = [...document.querySelectorAll('#thread-list .bubble-row.hearing')].pop(); return r && r.querySelector('.bubble-text').textContent === 'Hello Jose 25 3' && /^Typed · /.test(r.querySelector('.bubble-label').textContent); }));
  check('"✓ Sent" toast', (await p.textContent('#talkToast')).includes('Sent') && (await rect('#talkToast')).visible);
  await shot('5-sent');
  await noScroll('Whose turn is it?');
  // Speak or Type on a later turn (thread strip above), keyboard down and up.
  await p.click('#turn-speak-btn');
  await sleep(400);
  const later = { input: await rect('.speaking-input-row'), sw: await rect('#speak-to-sign-btn') };
  check('later turn: "Sign instead" fits under the input row', later.sw.visible && later.sw.y >= later.input.y + later.input.h && later.sw.y + later.sw.h <= 600, J(later));
  await shot('3b-speak-type-later-turn');
  await p.click('#speaking-input');
  await sleep(500);
  const kb = { sw: await rect('#speak-to-sign-btn'), kb: await rect('.sk-keyboard-wrap') };
  check('keyboard up: "Sign instead" stays above the keyboard', kb.sw.y + kb.sw.h <= kb.kb.y, J(kb));
  await noScroll('Speak or Type, later turn, keyboard up');
  await p.click('.speaking-mic-label').catch(() => {});
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.click('#backBtn');
  await sleep(300);

  // ── C. Sign screen ──
  await p.click('#turn-sign-btn');
  await p.waitForFunction(() => !document.getElementById('guide-start-btn').disabled, null, { timeout: 120000 });
  await p.click('#guide-start-btn');
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
  // Recognition stand-in: what the live loop reads, set to one label at a time.
  await p.evaluate(() => {
    window.__label = null;
    const R = window.GestureDataRecorder;
    const real = R.getLatestLandmarks.bind(R);
    R.getLatestLandmarks = () => (window.__label ? {} : real());
    window.extractFeatures = () => new Array(activeFeatureSize).fill(0);
    window.knnPredict = () => (window.__label ? { label: window.__label, scores: { [window.__label]: 1 } } : null);
  });
  const sign = async (label) => {
    const n = await p.evaluate(() => window.TalkSigning.getDraft().words.length);
    await p.evaluate((l) => { window.__label = l; }, label);
    await p.waitForFunction((k) => window.TalkSigning.getDraft().words.length > k, n, { timeout: 10000 });
    await p.evaluate(() => { window.__label = null; });
    await sleep(500);
  };
  await p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 10000 });
  const btn0 = await p.evaluate(() => { const b = document.getElementById('stop-signing-btn'); return { t: b.textContent, d: b.disabled }; });
  check('recording starts by itself; main button is "Send 🔊", disabled with no word', btn0.t === 'Send 🔊' && btn0.d, J(btn0));
  check('"🗣 Speak or Type" next to Guide', (await p.textContent('#sign-to-speak-btn')).includes('Speak or Type') && (await rect('#sign-to-speak-btn')).visible && (await rect('#chip-guide')).visible);
  await sign('hello');
  await sign('my_name');
  check('signed words build the sentence', J(await p.evaluate(() => window.TalkSigning.getDraft())) === J({ words: ['Hello', 'My name'], keys: ['hello', 'my_name'] }), J(await p.evaluate(() => window.TalkSigning.getDraft())));
  await shot('1-sign');
  await noScroll('Sign');
  // Sign -> Speak or Type: the unsent sentence and the recognizer buffer are discarded.
  await p.evaluate(() => { window.__label = 'hello'; });   // a sign half-recognised (in the filter) when leaving
  await sleep(200);
  await p.click('#sign-to-speak-btn');
  await p.evaluate(() => { window.__label = null; });
  await sleep(300);
  const away = await p.evaluate(() => ({ screen: document.body.dataset.screen, cam: !!document.getElementById('signing-video').srcObject, draft: window.TalkSigning.getDraft(), box: document.getElementById('signing-draft').textContent }));
  check('"🗣 Speak or Type" goes straight to Speak or Type; camera released; the unsent sentence is discarded',
    away.screen === 'speaking' && !away.cam && J(away.draft) === J({ words: [], keys: [] }) && away.box === '', J(away));
  check('Speak or Type opens with an empty field', (await p.inputValue('#speaking-input')) === '');
  // Speak or Type -> Sign: typed text + a running mic with its transcript are discarded.
  await p.evaluate(() => { const i = document.getElementById('speaking-input'); i.value = 'zz typed but not sent'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#speaking-mic-btn');
  const micOn = await p.waitForFunction(() => window.TalkSpeaking.isCapturing(), null, { timeout: 15000 }).then(() => true, () => false);
  // the live transcript as the mic writes it (js/talk-speaking.js: field value + an input event)
  await p.evaluate(() => { const i = document.getElementById('speaking-input'); i.value = 'zz spoken but not sent'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await shot('3c-speak-type-unsent');
  await p.click('#speak-to-sign-btn');
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return document.body.dataset.screen === 'signing' && v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
  const left = await p.evaluate(() => ({ field: document.getElementById('speaking-input').value, busy: window.TalkSpeaking.isBusy(), capturing: window.TalkSpeaking.isCapturing() }));
  check('"🤟 Sign instead": mic was on, is stopped, the typed text and transcript are dropped', micOn && left.field === '' && !left.busy && !left.capturing, J({ micOn, ...left }));
  const back = await p.evaluate(() => ({ draft: document.getElementById('signing-draft').textContent, shown: document.getElementById('signing-draft').classList.contains('show'), btn: document.getElementById('stop-signing-btn').disabled, keys: window.TalkSigning.getDraft().keys }));
  check('back on Sign: it starts empty (Send disabled)', back.draft === '' && !back.shown && back.btn === true && back.keys.length === 0, J(back));
  await shot('1b-sign-empty-after-switch');
  await p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 10000 });
  await sign('hello');
  await sign('my_name');
  await p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 10000 });
  await sign('how_are_you');
  const nUtter = await p.evaluate(() => window.__utter.length);
  await p.click('#stop-signing-btn');
  await sleep(200);
  check('Send 🔊: no popup, back to "Whose turn is it?"', (await screen()) === 'thread' && !(await p.evaluate(() => document.body.classList.contains('modal-open'))));
  const deaf = await p.evaluate(() => { const r = [...document.querySelectorAll('#thread-list .bubble-row.deaf')].pop(); return r && { text: r.querySelector('.bubble-text').textContent, label: r.querySelector('.bubble-label').textContent, playing: r.classList.contains('playing'), btn: !!r.querySelector('button.bubble-speak') }; });
  check('the signed message is added at once ("Signed"), with 🔊, playing', deaf && deaf.text.length > 0 && /^Signed · /.test(deaf.label) && deaf.playing && deaf.btn, J(deaf));
  check('"🔊 Speaking" toast', (await p.textContent('#talkToast')).startsWith('🔊 Speaking'));
  await shot('2-sent-speaking');
  await p.waitForFunction(() => !document.querySelector('#thread-list .bubble-row.playing'), null, { timeout: 20000 });
  const heard = await p.evaluate((n) => ({ plays: window.__plays.filter((s) => /audio_/.test(s)).map((s) => s.replace(location.origin, '')), fetched: window.__audioFetches.slice(), sources: window.__sources, utter: window.__utter.slice(n) }), nUtter);
  // hello's recording is fetched once and scheduled on the AudioContext (no <audio> element), then the voice
  check('auto-speak: hello from its recording (Web Audio), the rest by the voice as one utterance (EN)',
    heard.plays.length === 0 && heard.fetched.length === 1 && /saved_gestures\/hello\/audio_en\.wav\?v=1$/.test(heard.fetched[0]) && heard.sources === 1
    && J(heard.utter) === J([{ text: 'My name How are you', lang: 'en-US' }]), J(heard));
  // 🔊: replay, then stop while playing
  await p.click('#thread-list .bubble-row.deaf:last-child .bubble-speak');
  await p.waitForFunction(() => document.querySelector('#thread-list .bubble-row.deaf:last-child').classList.contains('playing'), null, { timeout: 5000 });
  check('🔊 replays the message', true);
  await p.click('#thread-list .bubble-row.deaf:last-child .bubble-speak');
  await sleep(100);
  check('🔊 while playing stops it', await p.evaluate(() => !document.querySelector('#thread-list .bubble-row.playing') && !document.getElementById('talkToast').classList.contains('show')));
  // the sent sentence is gone from the Sign screen
  await p.click('#turn-sign-btn');
  await p.waitForFunction(() => { const v = document.getElementById('signing-video'); return v.classList.contains('active') && v.videoWidth > 0; }, null, { timeout: 60000 });
  check('after Send the Sign screen starts empty', J(await p.evaluate(() => window.TalkSigning.getDraft().words)) === '[]');
  await p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 10000 });
  await sign('good_morning');
  await p.click('#backBtn');
  await sleep(200);
  check('Back from Sign discards the unsent sentence', J(await p.evaluate(() => window.TalkSigning.getDraft().keys)) === '[]');
  await p.click('#turn-sign-btn');
  await p.waitForFunction(() => document.getElementById('camera-box').classList.contains('recording'), null, { timeout: 10000 });
  check('Sign again starts empty', J(await p.evaluate(() => window.TalkSigning.getDraft().keys)) === '[]');
  await sign('good_morning');
  await p.click('#chip-fsl');
  await p.waitForFunction(() => !document.getElementById('signing-cam-overlay').classList.contains('show'), null, { timeout: 60000 });
  const fil = await p.evaluate(() => window.TalkSigning.getDraft());
  check('switching to FIL inside the turn keeps the sentence, in Filipino', J(fil.keys) === J(['good_morning']) && fil.words[0] !== 'Good Morning', J(fil));
  await p.click('#chip-esl');
  await p.waitForFunction(() => !document.getElementById('signing-cam-overlay').classList.contains('show'), null, { timeout: 60000 });
  // Speak or Type -> Translate -> Back (pi-fixes: Translate = Send): the message stays in the
  // conversation, the preview is dropped and Speak or Type opens empty again.
  await p.click('#backBtn');
  await sleep(200);
  await p.click('#turn-speak-btn');
  await sleep(300);
  await p.fill('#speaking-input', 'hello');
  await p.dispatchEvent('#speaking-input', 'input');
  await p.click('#speaking-translate');
  await p.waitForFunction(() => document.querySelector('#speaking-caption .on'), null, { timeout: 15000 });
  await p.click('#backBtn');
  await sleep(300);
  await p.click('#turn-speak-btn');
  await sleep(300);
  const prev = await p.evaluate(() => ({ state: document.getElementById('screen-speaking').dataset.speaking, field: document.getElementById('speaking-input').value, caption: document.getElementById('speaking-caption').textContent,
    sent: [...document.querySelectorAll('#thread-list .bubble-row.hearing .bubble-text')].pop()?.textContent }));
  check('Back while the avatar signs: the message stays sent, the preview is dropped', prev.sent === 'hello' && prev.state === 'compose' && prev.field === '' && prev.caption === '', J(prev));
  check('0 console errors in Let\'s Talk', errors.length === 0, J(errors));

  // ── E. Learn Signs and Quiz: no video requests ──
  const before = media.length;
  await p.goto(BASE + 'learn-signs.html');
  await sleep(1500);
  await p.goto(BASE + 'quiz.html');
  await p.waitForLoadState('networkidle').catch(() => {});
  await sleep(1000);
  const qinfo = await p.textContent('#setup-info').catch(() => '');
  check('Quiz: no video requested; the pool counts avatar clips', media.length === before && !/video/i.test(qinfo), J({ media: media.slice(before), qinfo }));
  console.log(`      requests in the whole run: ${allReqs.length}, of them .webm / .mp4 / fallback.png: ${media.length}`);
} catch (e) {
  failures++;
  console.log('FAIL  check aborted: ' + (e && e.stack || e));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
