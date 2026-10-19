// avatar phase, Task 7: the avatar in Let's Talk "Speak or Type", headless Chrome at 1024x600.
// Clips: three zz probe signs get clips imported (Import JSON) on avatar-clips.html, built from the
// committed Holistic output of the repo's own sign videos (tests/avatar/fixtures/holistic-signs.json:
// hello.webm, how_are_you.webm, my_name.webm) with the auto-trim of before 2026-10-14, so hello
// starts on the frame just before its hand is found (DEBT 124). No fresh Holistic run: the check
// cannot pass or fail by chance. Every zz probe is removed at the end (step 1 report Q12).
//   1  "zz ava one zz ava two zz ava three" plays as ONE avatar run: one play() with 3 clips,
//      captions in order, 0 <video> created, the canvas never hidden mid-run; blend continuity of
//      that sentence's timeline: every 40 ms window overlapping a transition (5 ms apart) <= 60 px.
//   2  "zz ava one nice": the avatar run, then "nice" fingerspelled (talk-turns-audio phase: avatar
//      only; the letters have no clip in the repo's data, so N I C E show in the caption only), no video.
//   3  A clip that fails to load (file removed after the page registered it) shows its word in the
//      caption only (before talk-turns-audio: played as video).
//   4  Hand tracking: on the signing screen (fake camera, loop running) avatar playback stops
//      Hands.send and the loop resumes after; on Speak or Type 0 sends during playback.
//   5  0 console errors, scrollWidth 1024; Holistic never requested by talk.html.
//   6  Screenshots -> docs/reports/img/avatar-talk-*.png; player frame rate from the run stats.
// Run (Apache + MariaDB up): node tests/avatar/talk-avatar-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchChrome } from '../video-capture/cdp.mjs';
import { buildY4m } from '../video-capture/fake-camera.mjs';
import { save, cleanZz, dir, repo } from '../sign-texts/api-helper.mjs';
import { Clip } from './helper.mjs';

const BASE = 'http://localhost/SKR/';
const IMG = path.join(repo, 'docs', 'reports', 'img');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(repo, 'tests', 'avatar', 'fixtures', 'holistic-signs.json'), 'utf8'));
const PROBES = [
  { key: 'zz_ava_one', text: 'Zz Ava One', video: 'hello.webm' },
  { key: 'zz_ava_two', text: 'Zz Ava Two', video: 'how_are_you.webm' },
  { key: 'zz_ava_three', text: 'Zz Ava Three', video: 'my_name.webm' },
];
const JUMP_MAX = 60;
const results = [];
const report = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

// Wraps window.Hands (send counter) and window.AvatarPlayer (instances + per-play stats) as the
// page defines them, before any page script runs.
const HOOKS = `(() => {
  window.__sends = [];
  let H, AP;
  Object.defineProperty(window, 'Hands', { configurable: true, get() { return H; }, set(v) {
    H = v;
    if (v && v.prototype && v.prototype.send && !v.prototype.__wrapped) {
      const s = v.prototype.send; v.prototype.send = function () { window.__sends.push(performance.now()); return s.apply(this, arguments); };
      v.prototype.__wrapped = true;
    }
  } });
  Object.defineProperty(window, 'AvatarPlayer', { configurable: true, get() { return AP; }, set(v) {
    AP = v; const create = v.create;
    v.create = function (o) {
      const p = create(o); (window.__avatarPlayers = window.__avatarPlayers || []).push(p);
      const play = p.play;
      p.play = function (preps, po) {
        const rec = { keys: preps.map((x) => x.key), t0: performance.now() };
        (window.__avatarRuns = window.__avatarRuns || []).push(rec);
        return play.call(p, preps, po).then((r) => { rec.t1 = performance.now(); rec.completed = r.completed; rec.intervals = r.stats.intervals; rec.drawMs = r.stats.drawMs; rec.duration = r.stats.duration; return r; });
      };
      return p;
    };
  } });
})();`;

let c1 = null, c2 = null, tmp = null;
try {
  cleanZz();
  fs.mkdirSync(IMG, { recursive: true });
  for (const p of PROBES) check(`probe sign ${p.key}`, save({ sign_language: 'ESL', text_en: p.text }).status === 200);

  // ── clips via the admin page (Import JSON of the fixture) ──
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-talk-'));
  c1 = await launchChrome({ port: 9441 });
  const ev1 = (e) => c1.evaluate(e);
  const wait1 = async (e, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev1(e)) return true; await sleep(250); } return false; };
  await c1.navigate(BASE + 'avatar-clips.html');
  await ev1(`location.reload(); 1`);
  await sleep(2500);
  await wait1(`document.querySelectorAll('.ac-item').length > 100`, 20000);
  const docNode = async () => (await c1.send('DOM.getDocument', {})).result.root.nodeId;
  report.clips = [];
  for (const p of PROBES) {
    const s = FIXTURE.signs.find((x) => x.video === p.video);
    const clip = Clip.buildClip({ key: p.key, fps: FIXTURE.fps, video: { w: s.w, h: s.h, durationMs: s.durationMs }, frames: s.frames,
      trim: { ...s.oldAutoTrim, auto: true }, createdAt: '2026-10-14T00:00:00Z' });
    const file = path.join(tmp, p.key + '.avatar.json');
    fs.writeFileSync(file, JSON.stringify(clip));
    await ev1(`window.avatarClipsLastImport = null; document.querySelector('.ac-item[data-key="${p.key}"]').click(); 1`);
    const node = await c1.send('DOM.querySelector', { nodeId: await docNode(), selector: '#ac-json' });
    await c1.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [file] });
    await wait1(`!!window.avatarClipsLastImport`, 20000);
    const e = await ev1(`(()=>{const e=window.avatarClipsLastImport;return {source:e.source,n:e.frames.length,trim:e.trim}})()`);
    await ev1(`document.getElementById('ac-save').click(); 1`);
    await wait1(`/^Saved/.test(document.getElementById('ac-status').textContent)`, 20000);
    const f = path.join(dir(p.key), 'avatar.json');
    const ok = fs.existsSync(f) && J(JSON.parse(fs.readFileSync(f, 'utf8')).frames) === J(clip.frames);
    report.clips.push({ key: p.key, video: p.video, fixtureFrames: s.oldAutoTrim, ...e });
    check(`clip for ${p.key} from the ${p.video} fixture (frames ${s.oldAutoTrim.start}..${s.oldAutoTrim.end})`, ok && e.source === 'clip', J(e));
  }
  check('admin page: 0 console errors', c1.getConsoleErrors().length === 0 && c1.getExceptions().length === 0, J(c1.getConsoleErrors().slice(0, 3)));
  await c1.close(); c1 = null;
  // a 4th probe whose clip disappears after the page registered it (missing-clip fallback)
  check('probe sign zz_ava_four', save({ sign_language: 'ESL', text_en: 'Zz Ava Four' }).status === 200);
  const four = JSON.parse(fs.readFileSync(path.join(dir('zz_ava_one'), 'avatar.json'), 'utf8'));
  four.key = 'zz_ava_four';
  fs.writeFileSync(path.join(dir('zz_ava_four'), 'avatar.json'), JSON.stringify(four));

  // ── talk.html ──
  const y4m = buildY4m(tmp);
  c2 = await launchChrome({ port: 9442, extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  await c2.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOKS });
  await c2.enableNetwork();
  const ev = (e) => c2.evaluate(e);
  const waitFor = async (e, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e)) return true; await sleep(150); } return false; };
  const shot = async (name) => { const r = await c2.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(IMG, name), Buffer.from(r.result.data, 'base64')); };

  await c2.navigate(BASE + 'talk.html');
  check('loading queue settled', await waitFor(`!!(window.TalkLoader && TalkLoader.isSettled())`, 120000));
  check('avatar player created at page load', await waitFor(`(window.__avatarPlayers||[]).length === 1`, 5000));

  // 4a. signing screen: the loop runs, avatar playback pauses it, it resumes after
  await ev(`document.getElementById('card-sign').click(); 1`);
  await waitFor(`!document.getElementById('guide-start-btn').disabled`, 30000);
  await ev(`document.getElementById('guide-start-btn').click(); 1`);
  await waitFor(`document.getElementById('signing-video').classList.contains('active')`, 60000);
  await sleep(2500);
  const hl = await ev(`(async () => {
    const store = AvatarStore.create({});
    const preps = [await store.load('zz_ava_one'), await store.load('zz_ava_two')];
    const before = window.__sends.length; await new Promise((r) => setTimeout(r, 1000)); const ratePerSec = window.__sends.length - before;
    const p = window.__avatarPlayers[0];
    const s0 = window.__sends.length;
    const run = p.play(preps);
    await new Promise((r) => setTimeout(r, 150));
    const s1 = window.__sends.length;                        // at most one send already in flight
    const r = await run;
    // onEnd resumes the loop, whose first send runs synchronously before play() resolves: count
    // only the sends before the player's end time
    const s2 = window.__sends.filter((t) => t < r.stats.endedAt).length;
    await new Promise((res) => setTimeout(res, 1500));
    const s3 = window.__sends.length;
    return { ratePerSec, inFlight: s1 - s0, duringPlay: s2 - s1, afterPlay: s3 - s2, durationMs: Math.round(r.stats.duration), completed: r.completed,
      sendsDuringMs: window.__sends.filter((t) => t >= r.stats.startedAt && t < r.stats.endedAt).map((t) => Math.round(t - r.stats.startedAt)) };
  })()`);
  report.handLoopSigning = hl;
  check('signing screen: hand loop running before playback', hl.ratePerSec > 3, J(hl));
  check('avatar playback stops Hands.send (paused)', hl.duringPlay === 0 && hl.inFlight <= 1, J(hl));
  check('hand loop resumes after playback', hl.afterPlay > 3, J(hl));

  // 1. Speak or Type: the 3-sign sentence
  await ev(`showScreen('speaking'); 1`);
  await sleep(1500);
  await ev(`window.__vids = []; window.__words = []; window.__hidden = [];
    (() => { const c = document.getElementById('speaking-sign-frame'); new MutationObserver(() => { c.querySelectorAll('video').forEach((v) => { const s = v.getAttribute('src'); if (s && !window.__vids.some((x) => x.src === s)) window.__vids.push({ src: s, t: performance.now() }); }); }).observe(c, { childList: true, subtree: true, attributes: true });
      const w = document.getElementById('speaking-caption'); new MutationObserver(() => { const on = w.querySelector('.cap-word.on, .cap-spell.on'); const t = on ? on.textContent : ''; if (t && (!window.__words.length || window.__words[window.__words.length - 1].w !== t)) window.__words.push({ w: t, t: performance.now() }); }).observe(w, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      const a = document.getElementById('speaking-avatar'); new MutationObserver(() => window.__hidden.push({ hidden: a.hidden, t: performance.now() })).observe(a, { attributes: true, attributeFilter: ['hidden'] }); })(); 1`);
  const translate = async (text) => {
    await ev(`(() => { window.__vids.length = 0; window.__words.length = 0; window.__hidden.length = 0; window.__sendsAtStart = window.__sends.length; window.__runsAtStart = (window.__avatarRuns||[]).length;
      const i = document.getElementById('speaking-input'); i.value = ${J(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
    await sleep(200);
    await ev(`document.getElementById('speaking-translate').click(); 1`);
  };
  await translate('zz ava one zz ava two zz ava three');
  await sleep(1800);
  await shot('avatar-talk-playing.png');
  const done1 = await waitFor(`(window.__avatarRuns||[]).length > window.__runsAtStart && window.__avatarRuns[window.__avatarRuns.length-1].t1`, 30000);
  const r1 = await ev(`(() => { const run = window.__avatarRuns[window.__avatarRuns.length-1]; const iv = run.intervals.slice().sort((a,b)=>a-b); const dm = run.drawMs.slice().sort((a,b)=>a-b);
    return { runs: window.__avatarRuns.length - window.__runsAtStart, keys: run.keys, completed: run.completed, durationMs: Math.round(run.duration),
      fps: +(1000 / iv[iv.length >> 1]).toFixed(1), fpsP5: +(1000 / iv[Math.floor(iv.length * 0.95)]).toFixed(1), drawMsMedian: +dm[dm.length >> 1].toFixed(2), drawMsP95: +dm[Math.floor(dm.length * 0.95)].toFixed(2),
      words: window.__words.map((x) => x.w), vids: window.__vids.length, hiddenChanges: window.__hidden.map((h) => h.hidden), sends: window.__sends.length - window.__sendsAtStart }; })()`);
  report.sentence3 = r1;
  check('3-sign sentence: one continuous avatar run with all 3 clips', done1 && r1.runs === 1 && J(r1.keys) === J(['zz_ava_one', 'zz_ava_two', 'zz_ava_three']) && r1.completed, J({ runs: r1.runs, keys: r1.keys, durationMs: r1.durationMs }));
  check('3-sign sentence: captions in order', J(r1.words) === J(['zz ava one', 'zz ava two', 'zz ava three']), J(r1.words));
  check('3-sign sentence: no video played, avatar never hidden mid-run', r1.vids === 0 && !r1.hiddenChanges.includes(true), J({ vids: r1.vids, hidden: r1.hiddenChanges }));
  check('Speak or Type: 0 Hands.send during playback (loop paused, camera off)', r1.sends === 0, String(r1.sends));
  const cont = await ev(`(async () => {
    const store = AvatarStore.create({});
    const preps = await Promise.all(['zz_ava_one','zz_ava_two','zz_ava_three'].map((k) => store.load(k)));
    const tl = AvatarTimeline.build(preps, AvatarRig);
    const pts = (p) => { const j = AvatarRetarget.toJoints(p, AvatarRig); const o = []; j.arms.forEach((a) => o.push(a.S, a.E, a.W, ...a.hand)); return o; };
    const jump = (a, b) => { const x = pts(a), y = pts(b); let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.hypot(x[i].x - y[i].x, x[i].y - y[i].y)); return m; };
    return tl.segments.filter((s) => s.kind !== 'clip').map((s) => { let worst = 0; for (let t = s.t0 - 40; t < s.t1; t += 5) worst = Math.max(worst, jump(tl.poseAt(Math.max(0, t)).pose, tl.poseAt(Math.min(tl.duration, t + 40)).pose));
      return { kind: s.kind, word: s.word, ms: Math.round(s.t1 - s.t0), worstPx40ms: +worst.toFixed(1), startGap: +jump(tl.poseAt(s.t0).pose, s.a).toFixed(2), endGap: +jump(tl.poseAt(s.t1 - 1e-6).pose, s.b).toFixed(2) }; });
  })()`);
  report.continuity = cont;
  check(`blend continuity: every 40 ms window overlapping a transition <= ${JUMP_MAX} px, ends match (<= 0.5 px)`, cont.every((s) => s.worstPx40ms <= JUMP_MAX && s.startGap <= 0.5 && s.endGap <= 0.5), J(cont));
  check('rest pose at both ends', await ev(`(async () => { const s = AvatarStore.create({}); const tl = AvatarTimeline.build([await s.load('zz_ava_one')], AvatarRig);
    const r = JSON.stringify(AvatarRetarget.toJoints(AvatarRetarget.restPose(AvatarRig), AvatarRig)); return JSON.stringify(AvatarRetarget.toJoints(tl.poseAt(0).pose, AvatarRig)) === r && JSON.stringify(AvatarRetarget.toJoints(tl.poseAt(tl.duration).pose, AvatarRig)) === r; })()`));
  await shot('avatar-talk-rest.png');
  const lay = await ev(`(() => { const f = document.getElementById('speaking-sign-frame').getBoundingClientRect(), a = document.getElementById('speaking-avatar').getBoundingClientRect();
    return { frame: [f.x, f.y, f.width, f.height].map(Math.round), avatar: [a.x, a.y, a.width, a.height].map(Math.round), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }; })()`);
  check('panel: avatar fills the 1000x486 area under the top bar, no page scroll', J(lay.frame) === J(lay.avatar) && lay.frame[2] === 1000 && lay.frame[3] === 486 && lay.sw === 1024, J(lay));

  // 2. mixed sentence: avatar run, then fingerspelling (talk-turns-audio: no video)
  await ev(`document.getElementById('speaking-edit').click(); 1`);
  await sleep(300);
  await translate('zz ava one nice');
  const done2 = await waitFor(`window.__words.some((x) => x.w === 'NICE') && !document.querySelector('#speaking-caption .on')`, 20000);
  await sleep(300);
  await shot('avatar-talk-mixed-after.png');
  const r2 = await ev(`(() => { const run = window.__avatarRuns[window.__avatarRuns.length-1]; return { runs: window.__avatarRuns.length - window.__runsAtStart, keys: run.keys, vids: window.__vids.map((v) => v.src), words: window.__words.map((x) => x.w) }; })()`);
  report.mixed = r2;
  check('mixed sentence: avatar run, then "nice" fingerspelled, no video', done2 && r2.runs === 1 && J(r2.keys) === J(['zz_ava_one']) && r2.vids.length === 0, J(r2));
  check('mixed sentence: captions zz ava one then NICE', J(r2.words) === J(['zz ava one', 'NICE']), J(r2.words));

  // 3. missing clip at play time -> the word in the caption only (no video)
  fs.rmSync(path.join(dir('zz_ava_four'), 'avatar.json'));
  await ev(`document.getElementById('speaking-edit').click(); 1`);
  await sleep(300);
  await translate('zz ava four');
  const done3 = await waitFor(`window.__words.some((x) => x.w === 'zz ava four')`, 15000);
  const r3 = await ev(`({ runs: (window.__avatarRuns||[]).length - window.__runsAtStart, vids: window.__vids.map((v) => v.src) })`);
  check('a clip that fails to load shows its word in the caption only, no video', done3 && r3.runs === 0 && r3.vids.length === 0, J(r3));
  await ev(`document.getElementById('speaking-edit').click(); 1`);

  // 5. errors, Holistic, frame rate
  const errors = c2.getConsoleErrors(), exc = c2.getExceptions();
  check('talk.html: 0 console errors', errors.length === 0 && exc.length === 0, J(errors.concat(exc)).slice(0, 400));
  const reqs = c2.getNetworkRequests().map((r) => r.url);
  check('talk.html never requests Holistic', !reqs.some((u) => /holistic/i.test(u)));
  report.pngRequests = reqs.filter((u) => /assets\/avatar\//.test(u)).length;
  report.clipRequests = reqs.filter((u) => /avatar\.json/.test(u)).map((u) => u.replace(BASE, ''));
  check('4 avatar PNGs loaded once', report.pngRequests === 4, String(report.pngRequests));
  console.log('\nplayer on this laptop (headless Chrome, 560x260, capped at 30 fps): ' + J({ fps: r1.fps, fpsP5: r1.fpsP5, drawMsMedian: r1.drawMsMedian, drawMsP95: r1.drawMsP95 }));
  console.log('REPORT ' + J(report));
} finally {
  if (c1) await c1.close();
  if (c2) await c2.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  cleanZz();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
