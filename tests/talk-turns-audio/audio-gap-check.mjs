// Gapless sign audio (talk-turns-audio, 2026-10-19 owner ask): js/sign-audio.js plays a signed message's
// recordings as one sentence. Playwright Chromium at 1024x600 on talk.html, js/sign-audio.js driven
// directly with a 4-word message (hello, thank_you, where, bathroom), each with an mp3 recording:
//   1  gap between words, BEFORE (js/sign-audio.js before the gapless change, commit aee82a2^ or
//      SK_AUDIO_BEFORE_REF, served by interception: one <audio>
//      per clip, loaded when its turn comes) vs AFTER (the working copy: all clips fetched + decoded in
//      parallel, scheduled on one AudioContext timeline) — cold (first play) and warm (5 replays)
//   2  after: scheduled gaps are GAP_S (read from js/sign-audio.js), every clip has a 15 ms fade in/out, the clips are fetched once
//      (decoded buffers cached for the page), decoding starts before the first clip plays
//   3  a word without a recording in the middle: clips before it, then the voice, then the rest
//      (same rate for every voice word)
//   4  a clip that cannot be decoded plays through <audio>; the others stay scheduled
//   5  stop() stops every scheduled source at once; one message at a time
//   6  0 console errors
// The gap is measured twice: from the playback events (what the code does) and as AUDIBLE silence:
// whatever each path sends to the speakers is also fed to a level meter on one clock (the old path:
// each <audio> element; the new path: a tap on the AudioContext's destination), and
// the silence between the 4 sounding words is timed (level below 1 % of full scale).
// (The old path's elements are routed through a MediaElementSource for this; their timing is unchanged.) The audible number
// includes the mp3 files' own encoder padding and each element's start-up time.
// The mp3 files are made here with ffmpeg (tones with an envelope, 0.45-0.80 s, mono 44.1 kHz) into a
// temporary folder and served by interception; nothing is written to saved_gestures/. thank_you is not a
// sign in the repo's data, so signs.php's answer gets it added. The browser voice is a recording stand-in.
// Needs: the site at SK_BASE (default http://localhost/SKR/), ffmpeg (SK_FFMPEG, default "ffmpeg"), Playwright.
// --throttle N: Chromium's CPU throttling (CDP Emulation.setCPUThrottlingRate) for both pages, a rough
// stand-in for a slower device such as the Pi 4 (not a Pi measurement).
// Run: node tests/talk-turns-audio/audio-gap-check.mjs [--throttle 4]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const FFMPEG = process.env.SK_FFMPEG || 'ffmpeg';
const thAt = process.argv.indexOf('--throttle');
const THROTTLE = thAt > 0 ? Number(process.argv[thAt + 1]) : 1;
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  return createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const { chromium } = await loadPlaywright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -- ' + String(detail).slice(0, 600) : ''}`);
}
const stats = (a) => { const s = a.slice().sort((x, y) => x - y); return { n: s.length, min: +s[0].toFixed(1), median: +s[s.length >> 1].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };

// ── the clips ──
const WORDS = [['hello', 'Hello', 330, 0.55], ['thank_you', 'Thank you', 262, 0.80], ['where', 'Where', 392, 0.45], ['bathroom', 'Bathroom', 294, 0.70]];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-audio-gap-'));
const CLIP = {};
for (const [key, , hz, dur] of WORDS) {
  const out = path.join(tmp, key + '.mp3');
  const r = spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${dur}`, '-af', `volume=0.6,afade=t=in:d=0.03,afade=t=out:st=${dur - 0.05}:d=0.05`, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', out]);
  if (r.status !== 0) { console.log('FAIL  ffmpeg: ' + r.stderr); process.exit(1); }
  CLIP[key] = fs.readFileSync(out);
}
const BAD = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000, 7)]);   // an "mp3" that does not decode
const BEFORE_REF = process.env.SK_AUDIO_BEFORE_REF || 'aee82a2^';
const OLD_JS = spawnSync('git', ['show', BEFORE_REF + ':js/sign-audio.js'], { cwd: repo }).stdout.toString();
if (!/new Audio\(url\)/.test(OLD_JS) || /decodeAudioData/.test(OLD_JS)) { console.log(`FAIL  ${BEFORE_REF}:js/sign-audio.js is not the pre-change version`); process.exit(1); }
// The gap under test: the one constant in the working copy's js/sign-audio.js.
const GAP_MS = Math.round(Number(/var GAP_S = ([0-9.]+);/.exec(fs.readFileSync(path.join(repo, 'js', 'sign-audio.js'), 'utf8'))[1]) * 1000);

const INIT = `(() => {
  window.__ev = []; window.__utter = []; window.__fetches = [];
  const now = () => performance.now();
  const fake = {
    getVoices() { return [{ lang: 'en-US', name: 'Stand-in' }]; }, addEventListener() {}, removeEventListener() {},
    speak(u) { window.__ev.push({ k: 'voice', text: u.text, rate: u.rate, t: now() }); window.__utter.push(u); setTimeout(() => { window.__ev.push({ k: 'voiceEnd', t: now() }); u.onend && u.onend(); }, 300); },
    cancel() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get() { return fake; } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this, src = this.src;
    window.__ev.push({ k: 'htmlPlay', src, t: now() });
    el.addEventListener('playing', () => window.__ev.push({ k: 'htmlPlaying', src, t: now() }), { once: true });
    el.addEventListener('ended', () => window.__ev.push({ k: 'htmlEnded', src, t: now() }), { once: true });
    return play.apply(this, arguments);
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when) {
    const c = this.context;
    window.__ev.push({ k: 'srcStart', when, dur: this.buffer.duration, ctxNow: c.currentTime, t: now() });
    this.addEventListener('ended', () => window.__ev.push({ k: 'srcEnded', when, t: now(), ctxNow: c.currentTime }));
    return start.apply(this, arguments);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function () { window.__ev.push({ k: 'srcStop', t: now() }); return stop.apply(this, arguments); };
  const ramp = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.linearRampToValueAtTime = function (v, t) { window.__ev.push({ k: 'ramp', v, at: t }); return ramp.apply(this, arguments); };
  // ── audible level meter (one clock per page) ──
  window.__level = [];
  let meterCtx = null, meterIn = null;
  function meter(c) {
    if (meterIn && meterCtx === c) return meterIn;
    meterCtx = c;
    const sp = c.createScriptProcessor(1024, 1, 1), mute = c.createGain();
    mute.gain.value = 0;
    mute.__mute = true;                                       // its own path to the speakers is not metered
    sp.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0), sr = c.sampleRate;
      for (let i = 0; i < d.length; i += 128) {
        let m = 0; for (let j = i; j < i + 128; j++) m = Math.max(m, Math.abs(d[j]));
        window.__level.push({ t: e.playbackTime + i / sr, peak: m });
      }
    };
    sp.connect(mute); mute.connect(c.destination);
    meterIn = c.createGain(); meterIn.connect(sp);
    return meterIn;
  }
  window.__meter = meter;
  window.__meterNow = () => (meterCtx ? meterCtx.currentTime : 0);
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest) {
    const r = connect.apply(this, arguments);
    if (dest instanceof AudioDestinationNode && this instanceof GainNode && this !== meterIn && !this.__mute) connect.call(this, meter(this.context));
    return r;
  };
  const playM = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      if (!window.__htmlMeterCtx) window.__htmlMeterCtx = new AudioContext();
      const c = window.__htmlMeterCtx;
      // the element's sound goes through this context: to the speakers as before, and to the meter
      const src = c.createMediaElementSource(this);
      connect.call(src, c.destination);
      connect.call(src, meter(c));
    } catch (e) { window.__meterErr = String(e); }
    return playM.apply(this, arguments);
  };
  const f = window.fetch;
  window.fetch = function (u) { if (/audio_/.test(String(u))) window.__fetches.push({ u: String(u), t: now() }); return f.apply(this, arguments); };
})();`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function page(useOld, { badKey = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  await ctx.addInitScript(INIT);
  if (useOld) await ctx.route('**/js/sign-audio.js', (r) => r.fulfill({ contentType: 'application/javascript', body: OLD_JS }));
  await ctx.route('**/saved_gestures/*/audio_en.mp3*', (r) => {
    const key = /saved_gestures\/([^/]+)\//.exec(r.request().url())[1];
    r.fulfill({ contentType: 'audio/mpeg', body: key === badKey ? BAD : CLIP[key] });
  });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push((useOld ? 'old: ' : 'new: ') + m.text()); });
  p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
  if (THROTTLE > 1) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await p.goto(BASE + 'talk.html');
  await p.waitForFunction(() => window.SignAudio, null, { timeout: 120000 });
  await p.mouse.click(512, 560);   // the first tap (who-first screen, empty area): unlocks audio
  return { ctx, p };
}
const ITEMS = WORDS.map(([key, text]) => ({ key, text }));
const AUDIO = Object.fromEntries(WORDS.map(([key]) => [key, { en: `saved_gestures/${key}/audio_en.mp3?v=1`, fil: null }]));
// Plays a message in the page; -> the event log of that play, times relative to the play() call.
async function playOnce(p, items = ITEMS, audio = AUDIO) {
  return p.evaluate(async ({ items, audio }) => {
    document.dispatchEvent(new Event('pointerdown'));      // re-arms talk.html's 2-minute idle timer, as a tap does
    window.__ev.length = 0;
    const t0 = performance.now();
    await window.SignAudio.play(items, 'en', audio);
    return { t0, ev: window.__ev.map((e) => ({ ...e, t: e.t - t0 })) };
  }, { items, audio });
}
function oldGaps(ev) {   // wall clock: next clip starts sounding - previous clip ended
  const playing = ev.filter((e) => e.k === 'htmlPlaying'), ended = ev.filter((e) => e.k === 'htmlEnded');
  return { gaps: playing.slice(1).map((e, i) => e.t - ended[i].t), first: playing[0] && playing[0].t };
}
function newGaps(ev) {
  const st = ev.filter((e) => e.k === 'srcStart'), en = ev.filter((e) => e.k === 'srcEnded');
  const sched = st.slice(1).map((e, i) => (e.when - (st[i].when + st[i].dur)) * 1000);
  // wall clock from the ended events: end[i+1] - end[i] - dur[i+1] = the silence before clip i+1
  const wall = en.slice(1).map((e, i) => e.t - en[i].t - st[i + 1].dur * 1000);
  const first = st[0] && st[0].t + (st[0].when - st[0].ctxNow) * 1000;   // when the first clip starts sounding
  return { sched, wall, first, n: st.length };
}

// Audible silences between sounding words from the level log of one play (t in seconds on the meter clock).
function audible(level) {
  const on = level.map((l) => l.peak > 0.01);
  const segs = [];
  let start = null;
  level.forEach((l, i) => {
    if (on[i] && start === null) start = l.t;
    if (!on[i] && start !== null) { segs.push([start, l.t]); start = null; }
  });
  if (start !== null) segs.push([start, level[level.length - 1].t]);
  const merged = [];
  segs.forEach((sg) => { const last = merged[merged.length - 1]; if (last && sg[0] - last[1] < 0.01) last[1] = sg[1]; else merged.push(sg.slice()); });
  return { words: merged.length, gaps: merged.slice(1).map((sg, i) => (sg[0] - merged[i][1]) * 1000) };
}
async function playMetered(p) {
  const r = await p.evaluate(async ({ items, audio }) => {
    document.dispatchEvent(new Event('pointerdown'));
    // Only this play is measured: the previous play's last blocks can still arrive late (a busy or
    // throttled main thread), so wait for them, then keep only blocks from this play's start on.
    await new Promise((res) => setTimeout(res, 600));
    const from = window.__meterNow();
    window.__level.length = 0;
    await window.SignAudio.play(items, 'en', audio);
    await new Promise((res) => setTimeout(res, 300));      // the meter's last blocks
    return { level: window.__level.filter((l) => l.t >= from), err: window.__meterErr || null };
  }, { items: ITEMS, audio: AUDIO });
  return { ...audible(r.level), err: r.err };
}

let report = {};
try {
  // ── 1. before ──
  const O = await page(true);
  const oldCold = oldGaps((await playOnce(O.p)).ev);
  const oldWarm = [];
  let oldFirstWarm = [];
  for (let i = 0; i < 5; i++) { const g = oldGaps((await playOnce(O.p)).ev); oldWarm.push(...g.gaps); oldFirstWarm.push(g.first); }
  const oldAud = [];
  for (let i = 0; i < 5; i++) oldAud.push(await playMetered(O.p));
  await O.ctx.close();
  check('before: 4 clips played through <audio>, one after another', oldCold.gaps.length === 3, J(oldCold));
  // information only (the old code is measured, not tested): a run can hear a dropout inside a word
  const oldDropouts = oldAud.filter((a) => a.words !== 4).length;
  check('before: the meter hears the words (' + oldDropouts + ' of 5 runs with a dropout inside a word)', oldAud.every((a) => a.words >= 4), J(oldAud));

  // ── 1/2. after ──
  const N = await page(false);
  const r0 = await playOnce(N.p);
  const newCold = newGaps(r0.ev);
  const fetchedCold = await N.p.evaluate(() => window.__fetches.length);
  const newWarm = { sched: [], wall: [] };
  const newFirstWarm = [];
  for (let i = 0; i < 5; i++) { const g = newGaps((await playOnce(N.p)).ev); newWarm.sched.push(...g.sched); newWarm.wall.push(...g.wall); newFirstWarm.push(g.first); }
  const fetchedAll = await N.p.evaluate(() => window.__fetches.length);
  const newAud = [];
  for (let i = 0; i < 5; i++) newAud.push(await playMetered(N.p));
  check('after: the meter hears 4 words', newAud.every((a) => a.words === 4), J(newAud));
  check('after: 4 clips scheduled on the AudioContext, no <audio>', newCold.n === 4 && !r0.ev.some((e) => e.k === 'htmlPlay'), J(r0.ev.map((e) => e.k)));
  check(`after: scheduled gaps are ${GAP_MS} ms (GAP_S)`, newCold.sched.concat(newWarm.sched).every((g) => Math.abs(g - GAP_MS) < 0.5), J(newCold.sched));
  const ramps = r0.ev.filter((e) => e.k === 'ramp');
  const starts = r0.ev.filter((e) => e.k === 'srcStart');
  check('after: each clip fades in to 1 and out to 0 over 15 ms', ramps.length === 8 && starts.every((s, i) => Math.abs(ramps[2 * i].at - s.when - 0.015) < 1e-6 && ramps[2 * i].v === 1 && Math.abs(ramps[2 * i + 1].at - s.when - s.dur) < 1e-6 && ramps[2 * i + 1].v === 0), J(ramps.slice(0, 4)));
  const fetchTimes = r0.ev.length && (await N.p.evaluate(() => window.__fetches.slice(0, 4).map((f) => f.t)));
  check('after: the 4 clips are fetched in parallel before the first one plays, and only once for 6 plays', fetchedCold === 4 && fetchedAll === 4 && Math.max(...fetchTimes) - Math.min(...fetchTimes) < 50, J({ fetchedCold, fetchedAll, fetchTimes }));
  report.gaps = {
    before: { cold: stats(oldCold.gaps), warm: stats(oldWarm), firstSoundMs: { cold: +oldCold.first.toFixed(1), warm: stats(oldFirstWarm) } },
    audibleSilenceMs: { before: stats(oldAud.flatMap((a) => a.gaps)), after: stats(newAud.flatMap((a) => a.gaps)) },
    after: { scheduled: stats(newCold.sched.concat(newWarm.sched)), wallCold: stats(newCold.wall), wallWarm: stats(newWarm.wall), firstSoundMs: { cold: +newCold.first.toFixed(1), warm: stats(newFirstWarm) } },
  };
  // The audible silence (audio-thread clock) is the measure; the event times (main thread) are reported
  // only, they arrive late when the CPU is busy or throttled.
  check(`after: the audible silence between words is ${GAP_MS}-${GAP_MS + 30} ms (the gap + fades + mp3 padding), every run 4 words`,
    newAud.every((a) => a.words === 4) && newAud.flatMap((a) => a.gaps).every((g) => g >= GAP_MS && g <= GAP_MS + 30), J(report.gaps.audibleSilenceMs));
  report.gaps.before.dropoutRuns = oldDropouts;

  // ── 3. a word without a recording in the middle ──
  const mixed = [{ key: 'hello', text: 'Hello' }, { key: 'thank_you', text: 'Thank you' }, { key: 'my_name', text: 'My name' }, { key: 'where', text: 'Where' }, { key: 'nope', text: 'is' }, { key: 'bathroom', text: 'Bathroom' }];
  const m = await playOnce(N.p, mixed);
  const order = m.ev.filter((e) => ['srcStart', 'voice'].includes(e.k)).map((e) => e.k === 'voice' ? 'voice:' + e.text : 'clip');
  check('mixed: clip clip, voice "My name", clip, voice "is", clip — in order', J(order) === J(['clip', 'clip', 'voice:My name', 'clip', 'voice:is', 'clip']), J(order));
  const voices = m.ev.filter((e) => e.k === 'voice');
  check('mixed: every voice word at the same rate', voices.every((v) => v.rate === voices[0].rate) && voices[0].rate > 0, J(voices.map((v) => v.rate)));
  const firstRunEnd = m.ev.filter((e) => e.k === 'srcEnded')[1];
  check('mixed: the voice starts only after the clips before it have ended', voices[0].t >= firstRunEnd.t, J({ voice: voices[0].t, ended: firstRunEnd.t }));

  // ── 5. stop() and one message at a time ──
  const s = await N.p.evaluate(async ({ items, audio }) => {
    window.__ev.length = 0;
    let ended = 0;
    const done = window.SignAudio.play(items, 'en', audio, { onEnd: () => ended++ });
    await new Promise((r) => setTimeout(r, 300));          // the first clip is sounding, 3 more scheduled
    const scheduled = window.__ev.filter((e) => e.k === 'srcStart').length;
    window.SignAudio.stop();
    const stops = window.__ev.filter((e) => e.k === 'srcStop').length;
    const playingAfter = window.SignAudio.isPlaying();
    await done;
    await new Promise((r) => setTimeout(r, 2500));
    const started = window.__ev.filter((e) => e.k === 'srcEnded').length;
    // a second message stops the first
    window.__ev.length = 0;
    let firstEnd = 0;
    window.SignAudio.play(items, 'en', audio, { onEnd: () => firstEnd++ });
    await new Promise((r) => setTimeout(r, 200));
    await window.SignAudio.play([{ key: 'where', text: 'Where' }], 'en', audio);
    return { scheduled, stops, playingAfter, ended, started, firstEnd };
  }, { items: ITEMS, audio: AUDIO });
  check('stop(): all 4 scheduled sources stopped at once, onEnd once, not playing', s.scheduled === 4 && s.stops === 4 && !s.playingAfter && s.ended === 1, J(s));
  check('one message at a time: a new message stops the previous one', s.firstEnd === 1, J(s));
  await N.ctx.close();

  // ── 4. a clip that cannot be decoded ──
  const B = await page(false, { badKey: 'where' });
  const b = await playOnce(B.p);
  const kinds = b.ev.filter((e) => ['srcStart', 'htmlPlay'].includes(e.k)).map((e) => e.k === 'htmlPlay' ? 'audio:' + e.src.split('/').slice(-2)[0] : 'clip');
  check('a clip that does not decode plays through <audio>, the rest stay scheduled, in order', J(kinds) === J(['clip', 'clip', 'audio:where', 'clip']), J(kinds));
  await B.ctx.close();

  check('0 console errors', errors.length === 0, J(errors));
  console.log('\nMEASURED (CPU throttle ' + THROTTLE + 'x) ' + J(report.gaps));
} catch (e) {
  failures++;
  console.log('FAIL  check aborted: ' + (e && e.stack || e));
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
