// Check for Task 5 of the compact-model phase: the kiosk (talk.html, Let's Talk) loads its k-NN
// model from the compiled files models/knn_<LANG>.bin through js/knn-model-store.js (IndexedDB
// cache), and never requests php/api/save_gesture.php.
//
// Headless Chrome via CDP (tests/video-capture/cdp.mjs), port 9431, a fresh profile per run,
// 1024x600, Network domain enabled. Reads the real models/knn_ESL.bin / knn_FSL.bin (never
// writes them). Each run (3 by default, KIOSK_RUNS=<n>) does:
//   e0 before any talk.html load: old localStorage model keys (six, about 1.2M characters) and
//      schema "2" set on the same origin
//   a  cold load: "gestures" item done; one HEAD + one GET of models/knn_ESL.bin; no
//      save_gesture.php; item ms, model GET bytes (resource timing), signs.php ms/bytes
//   e  after that one load: the six old keys are gone, schema is "3", other keys kept
//   b  reload: one HEAD, no GET (IndexedDB), source cache; item ms
//   c  switch to FSL as talk-check.mjs does: the live FSL file's labels, one FSL GET; back to
//      ESL: cache, no GET; reload: ESL and FSL both from IndexedDB, no GET at all
//   d  recognition: d1 live, fake camera fed from assets/signs/en/hello.webm (TalkSigning.enter(),
//      then knnPredict on the live landmarks); d2 knnPredict in the page on the rows of the
//      frozen fixture video en__hello (tests/compact-model/fixtures/), 'hello' must win the vote.
//      d1/d2 run only when 'hello' is in the live ESL model (else SKIP lines).
// Expected rows/labels are read from the live models/knn_ESL.bin and knn_FSL.bin headers at start
// (decoded in node with js/knn-compile.js), never pinned, so the check survives a new dataset.
//   f  0 console errors, 0 uncaught exceptions, every request to localhost
// Prints PASS/FAIL per check and a timing table; exit code 1 on any FAIL.
//
// Run (Apache up; MariaDB for signs.php): node tests/compact-model/kiosk-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../video-capture/cdp.mjs';
import { buildY4m } from '../video-capture/fake-camera.mjs';
import { loadFixtureVideos, loadKnnCompile } from './fixtures.mjs';

const BASE = 'http://localhost/SKR/';
const PORT = 9431;
const RUNS = Math.max(1, parseInt(process.env.KIOSK_RUNS || '3', 10));
const OLD_KEYS = ['sining_kamay_knn_ESL', 'sining_kamay_knn_FSL', 'sining_kamay_labels_ESL', 'sining_kamay_labels_FSL',
  'sining_kamay_trained_labels_ESL', 'sining_kamay_trained_labels_FSL'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail !== undefined && detail !== '' ? ' - ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail !== undefined && detail !== '' ? ' - ' + detail : ''}`); }
}

// Runs before any page script on every document: a bigger resource-timing buffer and a copy of
// every "[KNN] ..." console.log line (so the check can read the model source of each load).
const PRELUDE = `
  try { performance.setResourceTimingBufferSize(5000); } catch (e) {}
  window.__knnLog = [];
  (function () {
    var orig = console.log;
    console.log = function () {
      try { var s = Array.prototype.map.call(arguments, String).join(' '); if (s.indexOf('[KNN]') === 0) window.__knnLog.push(s); } catch (e) {}
      return orig.apply(console, arguments);
    };
  })();
`;

const isModel = (lang) => (r) => r.url.split('?')[0].endsWith('/models/knn_' + lang + '.bin');
const count = (reqs, lang, method) => reqs.filter((r) => isModel(lang)(r) && r.method === method).length;

// The live model files, decoded once at start: { ESL: { rows, labels, keys, hasStart }, FSL: ... }.
const LIVE = {};
const modelLine = (lang, source) => `[KNN] ${lang} model: ${LIVE[lang].rows} rows, ${LIVE[lang].labels} labels (${source})`;

async function runOnce(run, y4m, helloFrames) {
  console.log(`\n=== run ${run} (fresh profile) ===`);
  const t = {};
  const chrome = await launchChrome({
    port: PORT,
    extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
  });
  try {
    await chrome.enableNetwork();
    await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
    const ev = (expr) => chrome.evaluate(expr);
    const reqsSince = (i) => chrome.getNetworkRequests().slice(i);
    async function waitSettled(ms = 180000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await ev(`!!(window.TalkLoader && TalkLoader.isSettled())`).catch(() => false)) return true;
        await sleep(100);
      }
      return false;
    }
    const gesturesItem = () => ev(`TalkLoader.getItems().filter((s) => s.id === 'gestures')[0]`);
    const resource = (needle) => ev(`performance.getEntriesByType('resource').filter((e) => e.name.indexOf(${JSON.stringify(needle)}) >= 0)
      .map((e) => ({ name: e.name, ms: Math.round(e.duration), transfer: e.transferSize, body: e.encodedBodySize }))`);

    // e0: old keys on the same origin before talk.html ever loads (a plain text document).
    await chrome.navigate(BASE + 'js/knn-compile.js');
    await ev(`(() => { const big = 'x'.repeat(200000); ${JSON.stringify(OLD_KEYS)}.forEach((k) => localStorage.setItem(k, big));
      localStorage.setItem('sining_kamay_model_schema', '2'); localStorage.setItem('sining_kamay_show_skeleton', 'true'); return true; })()`);
    const before = await ev(`${JSON.stringify(OLD_KEYS)}.reduce((n, k) => n + (localStorage.getItem(k) || '').length, 0)`);

    // a: cold load
    let i0 = chrome.getNetworkRequests().length;
    await chrome.navigate(BASE + 'talk.html');
    check('a: loading queue settled (cold)', await waitSettled());
    let g = await gesturesItem();
    t.cold = g.ms;
    check('a: "gestures" item done', g.status === 'done', `${g.status}, ${g.ms} ms`);
    let reqs = reqsSince(i0);
    check('a: one HEAD + one GET of models/knn_ESL.bin', count(reqs, 'ESL', 'HEAD') === 1 && count(reqs, 'ESL', 'GET') === 1,
      `HEAD ${count(reqs, 'ESL', 'HEAD')}, GET ${count(reqs, 'ESL', 'GET')}`);
    check('a: no models/knn_FSL.bin request', reqs.filter(isModel('FSL')).length === 0);
    check('a: no request to save_gesture.php', !reqs.some((r) => r.url.includes('save_gesture.php')));
    const modelRes = await resource('models/knn_ESL.bin');
    const getRes = modelRes.filter((e) => e.body > 0);
    t.coldBytes = getRes.length ? getRes[0].body : null;
    t.coldGetMs = getRes.length ? getRes[0].ms : null;
    const signsRes = await resource('php/api/signs.php');
    t.signsMs = signsRes.length ? signsRes[0].ms : null;
    t.signsBytes = signsRes.length ? signsRes[0].body : null;
    console.log(`  model GET ${t.coldBytes} bytes in ${t.coldGetMs} ms; signs.php ${t.signsBytes} bytes in ${t.signsMs} ms`);
    check('a: model GET bytes = file size', t.coldBytes === fs.statSync(path.join('models', 'knn_ESL.bin')).size, String(t.coldBytes));
    let log = await ev(`window.__knnLog.slice()`);
    check(`a: ${modelLine('ESL', 'network')}`, log.includes(modelLine('ESL', 'network')), JSON.stringify(log));
    const st = await ev(`({ labels: activeLabels.length, trained: modelTrained, size: activeFeatureSize, keys: Object.keys(knnModel || {}).length,
      text: GestureDataRecorder.getSignText('how_are_you', 'en') })`);
    check(`a: model state (${LIVE.ESL.labels} labels as in the file, trained, 126 features)`, st.labels === LIVE.ESL.labels && st.keys === LIVE.ESL.labels && st.trained === (LIVE.ESL.labels >= 2) && st.size === 126, JSON.stringify(st));

    // e: the old keys are gone after this one load
    const ls = await ev(`({ left: ${JSON.stringify(OLD_KEYS)}.filter((k) => localStorage.getItem(k) !== null), schema: localStorage.getItem('sining_kamay_model_schema'),
      other: localStorage.getItem('sining_kamay_show_skeleton') })`);
    check('e: the six old localStorage model keys are gone', ls.left.length === 0, `${before} characters before; left: ${ls.left.join(',')}`);
    check('e: schema flag is "3", other keys kept', ls.schema === '3' && ls.other === 'true', JSON.stringify(ls));

    // b: reload -> IndexedDB
    i0 = chrome.getNetworkRequests().length;
    await chrome.navigate(BASE + 'talk.html');
    check('b: loading queue settled (reload)', await waitSettled());
    g = await gesturesItem();
    t.warm = g.ms;
    reqs = reqsSince(i0);
    check('b: one HEAD, no GET of models/knn_ESL.bin', count(reqs, 'ESL', 'HEAD') === 1 && count(reqs, 'ESL', 'GET') === 0,
      `HEAD ${count(reqs, 'ESL', 'HEAD')}, GET ${count(reqs, 'ESL', 'GET')}; item ${g.status} ${g.ms} ms`);
    check('b: no request to save_gesture.php', !reqs.some((r) => r.url.includes('save_gesture.php')));
    log = await ev(`window.__knnLog.slice()`);
    check('b: source cache', log.includes(modelLine('ESL', 'cache')), JSON.stringify(log));

    // c: switch to FSL and back, as talk-check.mjs does
    const switchTo = (lang) => ev(`(async () => {
      signLang = ${JSON.stringify(lang)}; modelTrained = false; knnModel = null;
      const n = window.__knnLog.length; const t0 = performance.now();
      const ok = await autoTrainForTranslate();
      return { ok, ms: Math.round(performance.now() - t0), labels: activeLabels.slice(), keys: Object.keys(knnModel || {}).length, log: window.__knnLog.slice(n) };
    })()`);
    i0 = chrome.getNetworkRequests().length;
    const fsl = await switchTo('fil');
    t.fsl = fsl.ms;
    reqs = reqsSince(i0);
    check(`c: FSL model ${LIVE.FSL.labels} labels as in the file, start present iff in the file`, fsl.ok === (LIVE.FSL.labels >= 2) && fsl.labels.length === LIVE.FSL.labels && fsl.keys === LIVE.FSL.labels && fsl.labels.includes('start') === LIVE.FSL.hasStart, `${fsl.labels.length} labels, ${fsl.ms} ms`);
    check('c: FSL HEAD + GET once', count(reqs, 'FSL', 'HEAD') === 1 && count(reqs, 'FSL', 'GET') === 1, `HEAD ${count(reqs, 'FSL', 'HEAD')}, GET ${count(reqs, 'FSL', 'GET')}`);
    check(`c: FSL source network, ${LIVE.FSL.rows} rows`, fsl.log.includes(modelLine('FSL', 'network')), JSON.stringify(fsl.log));
    i0 = chrome.getNetworkRequests().length;
    const back = await switchTo('en');
    t.back = back.ms;
    reqs = reqsSince(i0);
    check('c: back to ESL: cache, no GET', back.labels.length === LIVE.ESL.labels && count(reqs, 'ESL', 'GET') === 0 && count(reqs, 'ESL', 'HEAD') === 1 &&
      back.log.includes(modelLine('ESL', 'cache')), `${back.ms} ms; ${JSON.stringify(back.log)}`);
    const info = await ev(`KnnModelStore.info().then((x) => ({ available: x.available, ESL: x.ESL && x.ESL.bytes, FSL: x.FSL && x.FSL.bytes }))`);
    check('c: both files stored in IndexedDB', info.available && info.ESL > 0 && info.FSL > 0, JSON.stringify(info));
    i0 = chrome.getNetworkRequests().length;
    await chrome.navigate(BASE + 'talk.html');
    check('c: loading queue settled (reload 2)', await waitSettled());
    const fsl2 = await switchTo('fil');
    t.fslCache = fsl2.ms;
    const esl2 = await switchTo('en');
    reqs = reqsSince(i0);
    log = await ev(`window.__knnLog.slice()`);
    check('c: reload: ESL and FSL from IndexedDB, no GET at all',
      reqs.filter((r) => (isModel('ESL')(r) || isModel('FSL')(r)) && r.method === 'GET').length === 0 &&
      log.filter((s) => s.endsWith('(cache)')).length === 3 && fsl2.labels.length === LIVE.FSL.labels && esl2.labels.length === LIVE.ESL.labels,
      `FSL ${fsl2.ms} ms, ESL ${esl2.ms} ms; ${JSON.stringify(log)}`);
    check('c: no request to save_gesture.php', !reqs.some((r) => r.url.includes('save_gesture.php')));

    // d1/d2 need the sign 'hello' in the live ESL model (the fake camera and the fixture video sign it).
    if (!LIVE.ESL.keys.includes('hello')) {
      console.log("  SKIP  d1: 'hello' is not in the live ESL model");
      console.log("  SKIP  d2: 'hello' is not in the live ESL model");
      t.liveTop = 'skipped'; t.fixtureVote = 'skipped';
    } else {
    // d1: live recognition from the fake camera (hello.webm, letterboxed, looping)
    await ev(`(TalkSigning.enter(), true)`);
    const live = await ev(`(async () => {
      const v = document.getElementById('signing-video'); const seen = {}; let hands = 0, preds = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 25000 && preds < 40) {
        await new Promise((r) => setTimeout(r, 100));
        if (!GestureDataRecorder.getLatestLandmarks()) continue;
        hands++;
        const f = extractFeatures(v);
        if (!Array.isArray(f) || f.length !== 126) continue;
        const p = knnPredict(f);
        if (p && p.label) { preds++; seen[p.label] = (seen[p.label] || 0) + 1; }
      }
      TalkSigning.leave();
      return { hands, preds, seen, ms: Math.round(performance.now() - t0) };
    })()`);
    const top = Object.entries(live.seen).sort((a, b) => b[1] - a[1]);
    t.liveTop = top.length ? `${top[0][0]} ${top[0][1]}/${live.preds}` : 'none';
    check('d1: live fake camera: knnPredict returned a label at least once', live.preds > 0,
      `${live.hands} hand ticks, ${live.preds} predictions in ${live.ms} ms; ${JSON.stringify(top.slice(0, 5))}`);

    // d2: rows of the frozen fixture video en__hello, knnPredict in the page, majority vote
    const vote = await ev(`(() => {
      const rows = GestureDataRecorder.recordingToFeatureRows({ frames: ${JSON.stringify(helloFrames)} });
      const votes = {};
      rows.forEach((r) => { const p = knnPredict(r); if (p) votes[p.label] = (votes[p.label] || 0) + 1; });
      return { rows: rows.length, votes };
    })()`);
    const ranked = Object.entries(vote.votes).sort((a, b) => b[1] - a[1]);
    t.fixtureVote = ranked.length ? `${ranked[0][0]} ${ranked[0][1]}/${vote.rows}` : 'none';
    check('d2: fixture en__hello rows: hello wins the vote', ranked.length > 0 && ranked[0][0] === 'hello', `${vote.rows} rows; ${JSON.stringify(ranked.slice(0, 4))}`);
    }

    // f: console and network
    const errs = chrome.getConsoleErrors();
    check('f: 0 console errors', errs.length === 0, errs.map((e) => e.text.slice(0, 160)).join(' | '));
    check('f: 0 uncaught exceptions', chrome.getExceptions().length === 0, chrome.getExceptions().join(' | ').slice(0, 300));
    const all = chrome.getNetworkRequests();
    const foreign = all.filter((r) => !/^(http:\/\/localhost\/|data:|blob:|about:)/.test(r.url));
    check('f: every request is to localhost', foreign.length === 0, `${all.length} requests; foreign: ${foreign.map((r) => r.url).slice(0, 5).join(', ')}`);
    check('f: no request to save_gesture.php in the whole run', !all.some((r) => r.url.includes('save_gesture.php')));
    const modelReqs = all.filter((r) => isModel('ESL')(r) || isModel('FSL')(r)).map((r) => `${r.method} ${r.url.replace(BASE, '')}`);
    t.modelReqs = modelReqs;
    const php = [...new Set(all.filter((r) => r.url.includes('/php/')).map((r) => r.url.replace(BASE, '').split('?')[0]))];
    console.log(`  model requests in order: ${modelReqs.join(', ')}`);
    console.log(`  php endpoints requested: ${php.join(', ') || 'none'}`);
    console.log(`  total requests: ${all.length}`);
    t.php = php;
  } finally {
    await chrome.close();
  }
  return t;
}

async function main() {
  const sha = () => ['ESL', 'FSL'].map((l) => crypto.createHash('sha256').update(fs.readFileSync(path.join('models', `knn_${l}.bin`))).digest('hex'));
  const shaBefore = sha();
  const K = loadKnnCompile();
  for (const lang of ['ESL', 'FSL']) {
    const buf = fs.readFileSync(path.join('models', `knn_${lang}.bin`));
    const h = K.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)).header;
    const keys = h.labels.map((L) => L.key);
    LIVE[lang] = { rows: h.rowCount, labels: keys.length, keys, hasStart: keys.includes('start') };
  }
  console.log(`live models/: ESL ${LIVE.ESL.rows} rows / ${LIVE.ESL.labels} labels, FSL ${LIVE.FSL.rows} rows / ${LIVE.FSL.labels} labels`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-check-'));
  const results = [];
  try {
    const y4m = buildY4m(tmp);
    const helloFrames = loadFixtureVideos()['en__hello'].frames;
    for (let r = 1; r <= RUNS; r++) results.push(await runOnce(r, y4m, helloFrames));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const shaAfter = sha();
  check('model files untouched (sha256)', JSON.stringify(shaBefore) === JSON.stringify(shaAfter), JSON.stringify(shaAfter));

  console.log('\n--- timings (ms; "gestures" item = TalkLoader item, includes signs.php in parallel) ---');
  console.log('run | cold item | GET bytes | GET ms | signs.php ms/bytes | warm item | FSL switch (network) | ESL back (cache) | FSL after reload (cache) | live top | fixture vote');
  results.forEach((t, i) => console.log(`${i + 1} | ${t.cold} | ${t.coldBytes} | ${t.coldGetMs} | ${t.signsMs}/${t.signsBytes} | ${t.warm} | ${t.fsl} | ${t.back} | ${t.fslCache} | ${t.liveTop} | ${t.fixtureVote}`));
  console.log(failures === 0 ? '\nALL PASS (0 failures)' : `\nFAILED (${failures} failures)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
main().catch((e) => { console.error(e); process.exitCode = 2; });
