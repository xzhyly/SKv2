// js/avatar-extract.js's opts.range (bulk video importer, 2026-10-13), headless Chrome via
// tests/video-capture/cdp.mjs, on tests/bulk-import/extract-range.page.html.
// The page replaces MediaPipe Holistic with a FAKE whose landmarks are computed from the pixels of
// the canvas it is sent (the real model varies slightly between runs), so "the full-video output
// is byte-identical to before" can be compared as strings.
//   a  The extractor as it was before opts.range (the newest revision of js/avatar-extract.js in
//      git that has no "opts.range"; read with git show, run as an inline script, never written to
//      disk) and the working-tree one, on the whole video: the same JSON string, the same
//      video.currentTime values in the same order, the same onFrame arguments, the same pictures
//      sent to Holistic, the same result keys (no firstFrame).
//   b  With a range: the frames are that slice of the full run, firstFrame is the first grid
//      index, only in-range times are sought, onFrame counts 0..n-1 of n.
//   c  Edges: a range over everything, the last grid time alone, a range between two grid times,
//      a range past the end, an inverted range; abort rejects with AbortError.
// The test video is fake-camera.mjs's buildWebm() (fixed 12 s 320x240 VP8), built in an
// os.tmpdir() folder that is removed at the end and given to the page through a file input.
// Run (Apache up): node tests/bulk-import/extract-range-check.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../video-capture/cdp.mjs';
import { buildWebm } from '../video-capture/fake-camera.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = 'http://localhost/SKR/tests/bulk-import/extract-range.page.html';
const FILE = 'js/avatar-extract.js';
const FPS = 25;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const J = JSON.stringify;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

// The extractor before opts.range: the newest committed revision without it.
let oldRev = null, oldSource = null;
for (const rev of git('log', '--format=%H', '--', FILE).split(/\s+/).filter(Boolean)) {
  const text = git('show', `${rev}:${FILE}`);
  if (!text.includes('opts.range')) { oldRev = rev; oldSource = text; break; }
}
const newSource = fs.readFileSync(path.join(repo, FILE), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-range-'));
const c = await launchChrome({ port: 9471 });
const ev = (e) => c.evaluate(e);
const run = (name, o = {}) => ev(`window.runExtract(${J(name)}, ${J(o)})`);
const sends = (r) => r.log.filter((l) => l.op === 'send');

try {
  check('a revision of ' + FILE + ' without opts.range found in git; the working file has it', !!oldSource && newSource.includes('opts.range'), oldRev ? oldRev.slice(0, 7) : 'none');
  const video = buildWebm(tmp);
  await c.navigate(PAGE);
  const doc = await c.send('DOM.getDocument', {});
  const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#pick' });
  await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [video] });
  const picked = await ev(`window.takePickedFile()`);
  check('test video given to the page', picked && picked.size === fs.statSync(video).size, J(picked));

  const initOld = await ev(`window.loadExtractor('old', ${J({ source: oldSource })})`);
  const initNew = await ev(`window.loadExtractor('new', ${J({ url: FILE })})`);
  check('both extractors reach the fake Holistic (SIMD supported) with the same set-up calls', initOld.simd && initNew.simd && initOld.fps === FPS && initNew.fps === FPS
    && J(initOld.log.map((l) => l.op)) === J(['new', 'setOptions', 'initialize']) && J(initOld.log) === J(initNew.log), J(initNew.log.map((l) => l.op)));
  check('the page serves the working-tree extractor', (await ev(`fetch(${J(FILE)},{cache:'no-store'}).then(r=>r.text())`)) === newSource);

  // a. whole video, old against new
  const oldFull = await run('old'), newFull = await run('new'), newAgain = await run('new');
  check('full video: old and new both succeed', oldFull.ok && newFull.ok && newAgain.ok, J([oldFull.errorMessage, newFull.errorMessage, newAgain.errorMessage]));
  const full = newFull.ok ? JSON.parse(newFull.json) : { frames: [], video: {} };
  const N = full.frames.length;
  const poses = full.frames.filter((f) => f[0]).length, hands = full.frames.filter((f) => f[1] || f[2]).length;
  const distinct = new Set(full.frames.map((f) => J(f))).size;
  check('the fixture is not trivial: frames with and without a pose, many different frames', poses > 50 && poses < N && hands > 20 && distinct > 50,
    `${N} frames (${full.video.durationMs} ms, ${full.video.w}x${full.video.h}), pose ${poses}, a hand ${hands}, ${distinct} distinct`);
  check('the fake is deterministic: two runs of the new extractor give the same string', newFull.json === newAgain.json && J(sends(newFull)) === J(sends(newAgain)));
  check('full video: JSON.stringify(result) identical, old against new', oldFull.ok && oldFull.json === newFull.json, `${(oldFull.json || '').length} and ${(newFull.json || '').length} characters`);
  check('full video: the same video.currentTime values sought in the same order', J(oldFull.seeks) === J(newFull.seeks) && newFull.seeks.length === N, `${oldFull.seeks.length} and ${newFull.seeks.length} seeks`);
  check('full video: the seeks are the k/25 grid over the whole video', N === Math.ceil(full.video.durationMs / 1000 * FPS) && newFull.seeks.every((t, k) => t === k / FPS || (k === N - 1 && t < k / FPS && t > (k - 1) / FPS)),
    `first ${newFull.seeks.slice(0, 3).join(', ')} … last ${newFull.seeks[N - 1]}`);
  check('full video: the same pictures sent to Holistic in the same order, one reset each', J(oldFull.log) === J(newFull.log) && sends(newFull).length === N && newFull.log.filter((l) => l.op === 'reset').length === 1 && newFull.log[0].op === 'reset');
  check('full video: the same onFrame arguments (index 0..N-1, total N, results, canvas)', J(oldFull.onFrame) === J(newFull.onFrame) && newFull.onFrame.length === N
    && newFull.onFrame.every((a, k) => a[0] === k && a[1] === N && a[2] === true && a[5] === 4), J(newFull.onFrame[N - 1]));
  check('full video: the same result keys, no firstFrame', J(oldFull.keys) === J(['frames', 'fps', 'video']) && J(newFull.keys) === J(oldFull.keys), J(newFull.keys));

  // b. a range
  const ranged = async (range) => { const r = await run('new', { range }); return { r, res: r.ok ? JSON.parse(r.json) : null }; };
  const sliceOk = (res, first, n) => res && res.firstFrame === first && res.frames.length === n && J(res.frames) === J(full.frames.slice(first, first + n))
    && res.fps === full.fps && J(res.video) === J(full.video);
  const START = 3000, END = 7000;
  const ks = []; for (let k = 0; k < N; k++) if (k * 1000 / FPS >= START && k * 1000 / FPS <= END) ks.push(k);
  const b = await ranged({ startMs: START, endMs: END });
  check(`range ${START}..${END} ms: succeeds, keys are frames, fps, video, firstFrame`, b.r.ok && J(b.r.keys) === J(['frames', 'fps', 'video', 'firstFrame']), b.r.ok ? J(b.r.keys) : b.r.errorMessage);
  check('range: firstFrame is the first grid index in the range', b.res && b.res.firstFrame === ks[0] && ks[0] === 75, `firstFrame ${b.res && b.res.firstFrame}, ${b.res && b.res.frames.length} frames (grid ${ks[0]}..${ks[ks.length - 1]})`);
  check('range: frames equal frames[firstFrame + i] of the full run', sliceOk(b.res, ks[0], ks.length) && ks.length === 101);
  check('range: only the in-range grid times were sought, in order', J(b.r.seeks) === J(ks.map((k) => newFull.seeks[k])) && b.r.seeks.every((t) => t * 1000 >= START - 1e-6 && t * 1000 <= END + 1e-6),
    `${b.r.seeks.length} seeks, ${b.r.seeks[0]} … ${b.r.seeks[b.r.seeks.length - 1]} s`);
  check('range: only those pictures were sent to Holistic', J(sends(b.r)) === J(sends(newFull).slice(ks[0], ks[0] + ks.length)) && b.r.log.filter((l) => l.op === 'reset').length === 1);
  check('range: onFrame called n times with index 0..n-1 and total n', b.r.onFrame.length === ks.length && b.r.onFrame.every((a, i) => a[0] === i && a[1] === ks.length && a[2] === true && a[5] === 4), J(b.r.onFrame[b.r.onFrame.length - 1]));

  // c. edges
  for (const range of [{ startMs: 0, endMs: 1e9 }, { startMs: -500, endMs: full.video.durationMs }]) {
    const e = await ranged(range);
    check(`range ${J(range)} (everything): the full run's frames, firstFrame 0`, sliceOk(e.res, 0, N) && J(e.r.seeks) === J(newFull.seeks) && J(e.r.onFrame) === J(newFull.onFrame));
  }
  const lastOnly = await ranged({ startMs: (N - 1) * 1000 / FPS, endMs: 1e9 });
  check('range from the last grid time: that one frame, sought as the full run seeks it', sliceOk(lastOnly.res, N - 1, 1) && J(lastOnly.r.seeks) === J([newFull.seeks[N - 1]]) && J(lastOnly.r.onFrame.map((a) => a.slice(0, 2))) === J([[0, 1]]));
  const oneFrame = await ranged({ startMs: 3000, endMs: 3000 });
  check('range 3000..3000 (both ends inclusive): frame 75 alone', sliceOk(oneFrame.res, 75, 1) && J(oneFrame.r.seeks) === J([3]));
  for (const [label, range] of [['past the end', { startMs: 60000, endMs: 70000 }], ['between two grid times', { startMs: 3010, endMs: 3030 }], ['inverted', { startMs: 7000, endMs: 3000 }]]) {
    const e = await ranged(range);
    check(`range ${label} ${J(range)}: frames [], firstFrame null, nothing sought`, e.res && J(e.res.frames) === '[]' && e.res.firstFrame === null && 'firstFrame' in e.res
      && e.r.seeks.length === 0 && sends(e.r).length === 0 && e.r.onFrame.length === 0 && J(e.res.video) === J(full.video), e.r.ok ? e.r.json : e.r.errorMessage);
  }
  const abortFull = await run('new', { abortAfter: 5 });
  const abortRange = await run('new', { abortAfter: 5, range: { startMs: START, endMs: END } });
  check('abort still rejects with AbortError (whole video, and with a range)', !abortFull.ok && abortFull.errorName === 'AbortError' && abortFull.onFrame.length === 5
    && !abortRange.ok && abortRange.errorName === 'AbortError' && abortRange.onFrame.length === 5, J([abortFull.errorName, abortFull.onFrame.length, abortRange.errorName, abortRange.onFrame.length]));
  const after = await run('new');
  check('after the ranged and aborted runs a full run still gives the same string', after.ok && after.json === newFull.json && J(after.seeks) === J(newFull.seeks));

  const errs = c.getConsoleErrors().concat(c.getExceptions());
  check('0 console errors', errs.length === 0, J(errs).slice(0, 400));
} finally {
  await c.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
check('temp folder removed', !fs.existsSync(tmp));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
