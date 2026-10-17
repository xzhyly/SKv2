// Check for Task 6 of the compact-model phase: Train Gestures (gesture-training.html) Compile,
// model status, Steps 3/4 from the compiled file, Step 1/2 data without frames.
//
// Headless Chrome via CDP (tests/video-capture/cdp.mjs), port 9471, fresh profile, 1024x600,
// Network domain on, fake camera from assets/signs/en/hello.webm. Presses Compile, which writes the
// REAL models/knn_ESL.bin / knn_FSL.bin: both are copied first and restored byte for byte in
// `finally` (tests/compact-model/model-guard.mjs); zz_ probe signs are deleted; config/device.txt
// (the Pi override) is removed afterwards, also on failure.
//   1  page load: ONE save_gesture.php request, with summary=1 and no `frames` key in its answer;
//      model_status.php; HEAD/GET of models/knn_ESL.bin; no full listing; status up to date (ESL, FSL)
//   2  Compile ESL then FSL: one POST each; the written files decode to the rows of a node build over
//      the live dataset (frames read in batches like Compile), fingerprint = model_status.php's
//      fingerprintNow; log lines; Next shown; timed. Expected counts are never pinned: they come from
//      the live summary listing and that node build (the dataset will change).
//   3  stale: an ESL zz probe -> ESL "Model out of date: run Compile", FSL still up to date; a BOTH
//      probe -> both out of date; delete both (the Delete path) -> both up to date again, same fingerprint
//   4  Pi (config/device.txt = pi): Compile disabled, the warning text exact, no out-of-date text,
//      Compile refused without a POST, Steps 3/4 still load the model
//   5  Step 3 Predict with the fake camera predicts a label of the loaded model
//   6  Export Data = { label: rows } of the loaded model (its labels); Load Saved only toasts
//   7  layout at 1024x600 in Step 2 (laptop, and Pi in 4): every control visible, >= 44 px, no
//      overlap, no page scroll; 0 console errors; models/ sha256 unchanged at the end
// Prints PASS/FAIL per check; exit code 1 on any FAIL.
//
// Run (Apache + MariaDB up): node tests/compact-model/training-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../video-capture/cdp.mjs';
import { buildY4m } from '../video-capture/fake-camera.mjs';
import { loadKnnCompile, loadToRows } from './fixtures.mjs';
import { guardModels, modelShas, MODELS_DIR } from './model-guard.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://localhost/SKR/';
const PAGE = BASE + 'gesture-training.html';
const SAVE = BASE + 'php/api/save_gesture.php';
const PORT = 9471;
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const DEVICE_FILE = path.join(CONFIG_DIR, 'device.txt');
const PI_TEXT = 'Build the model on the laptop, then copy models/knn_ESL.bin and models/knn_FSL.bin to the Pi.';
const LOAD_SAVED_TEXT = 'Loading a training file is no longer used: Compile builds the model from the saved samples.';
const P_ESL = 'zz_model_probe', P_BOTH = 'zz_model_both';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail !== undefined && detail !== '' ? ' - ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail !== undefined && detail !== '' ? ' - ' + detail : ''}`); }
}
const post = async (body) => (await fetch(SAVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(body) })).json();
const statusNow = async () => (await fetch(BASE + 'php/api/model_status.php', { cache: 'no-store' })).json();
const probeFrames = (v) => Array.from({ length: 3 }, (_, i) => ({ index: i, timestamp: i, landmarks: Array.from({ length: 126 }, (_, j) => v + j / 1000) }));

// Step 2 layout: every control (toggle labels, buttons) visible, inside the viewport, >= 44x44, and
// no two of them (nor the status line, warning, card, progress, log) overlap.
const LAYOUT = `(() => {
  const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.hidden;
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, right: b.right, bottom: b.bottom }; };
  const name = (e) => e.id || e.className.split(' ')[0] + ':' + e.textContent.trim().slice(0, 16);
  const controls = Array.from(document.querySelectorAll('#leftStep2 label.tr-sign-opt, #leftStep2 button')).filter(vis).map((e) => ({ id: name(e), disabled: !!e.disabled, ...r(e) }));
  const blocks = ['modelStatusLine', 'modelPiWarning', 'step2SummaryCard', 'trainLog'].map((id) => document.getElementById(id)).filter(vis).map((e) => ({ id: e.id, ...r(e) }));
  const prog = document.getElementById('epochBar').closest('.tr-fgrp');
  blocks.push({ id: 'progress', ...r(prog) });
  const all = controls.concat(blocks);
  const overlaps = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5) overlaps.push(a.id + '/' + b.id);
  }
  return { controls, blocks, small: controls.filter((c) => c.h < 44 || c.w < 44).map((c) => c.id + ':' + c.w + 'x' + c.h),
    outside: all.filter((c) => c.x < 0 || c.y < 0 || c.right > innerWidth + 0.5 || c.bottom > innerHeight + 0.5).map((c) => c.id),
    overlaps, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
})()`;

// Expected values from the LIVE dataset (never pinned): the summary listing (no_sync) and a node
// build of both models over the frames read in batches of <= 60 samples, exactly as Compile does.
async function liveExpectations(K) {
  const toRows = loadToRows();
  const get = async (q) => { const r = await fetch(SAVE + q); const j = await r.json(); if (!j.success) throw new Error(`listing ${q}: ${j.error}`); return j; };
  const sum = await get('?no_sync=1&summary=1');
  const keys = Object.keys(sum.gestures).sort();
  const builders = Object.fromEntries(['ESL', 'FSL'].map((lang) => [lang, K.createBuilder({ signs: sum.signs, categories: sum.categories, lang, toRows, buildDate: '2026-01-01T00:00:00.000Z' })]));
  const withSamples = keys.filter((k) => sum.gestures[k].length > 0);
  for (let i = 0; i < withSamples.length;) {
    const batch = []; let n = 0;
    while (i < withSamples.length && (batch.length === 0 || n + sum.gestures[withSamples[i]].length <= 60)) { n += sum.gestures[withSamples[i]].length; batch.push(withSamples[i++]); }
    const part = await get('?no_sync=1&labels=' + batch.join(','));
    for (const k of batch) for (const lang of ['ESL', 'FSL']) builders[lang].addSign(k, part.gestures[k] || []);
  }
  const out = { nSigns: keys.length, nSamples: keys.reduce((a, k) => a + sum.gestures[k].length, 0) };
  for (const lang of ['ESL', 'FSL']) {
    const b = builders[lang].finish();
    const allInModel = keys.filter((k) => K.inModel(lang, k, (sum.signs[k] && sum.signs[k].set) || (sum.gestures[k][0] && sum.gestures[k][0].signLanguage) || 'ESL'));
    out[lang] = { header: b.header, model: b.model, rows: b.header.rowCount, labels: b.header.labels.length, samples: b.header.sampleCount,
      keys: b.header.labels.map((L) => L.key), cardKeys: allInModel,
      fingerprint: await K.sha256Hex(K.fingerprintText(sum.gestures, sum.signs, lang)) };
  }
  return out;
}
const fmt = (n) => n.toLocaleString('en-US');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  const K = loadKnnCompile();
  const decodeFile = (lang) => K.decode(fs.readFileSync(path.join(MODELS_DIR, `knn_${lang}.bin`)));
  if (fs.existsSync(DEVICE_FILE)) throw new Error('config/device.txt exists before the check; remove it first');
  const configDirExisted = fs.existsSync(CONFIG_DIR);
  const committed = { ESL: decodeFile('ESL').header, FSL: decodeFile('FSL').header };
  const LIVE = await liveExpectations(K);
  const status0 = await statusNow();
  console.log(`live dataset: ${LIVE.nSigns} signs, ${LIVE.nSamples} samples; node build ESL ${LIVE.ESL.rows} rows / ${LIVE.ESL.labels} labels / ${LIVE.ESL.samples} samples, FSL ${LIVE.FSL.rows} / ${LIVE.FSL.labels} / ${LIVE.FSL.samples}`);
  console.log(`live model files: ESL ${committed.ESL.rowCount} rows / ${committed.ESL.labels.length} labels (${status0.models.ESL.stale ? 'out of date' : 'up to date'}), FSL ${committed.FSL.rowCount} / ${committed.FSL.labels.length} (${status0.models.FSL.stale ? 'out of date' : 'up to date'})`);
  // The status line expected for the files as they are at the start (before any Compile).
  const startLine = (lang) => status0.models[lang].stale ? /^Model out of date: run Compile$/
    : new RegExp(`^${lang} model: ${fmt(committed[lang].rowCount)} rows, ${committed[lang].labels.length} signs, built .+ — up to date$`);
  const guard = guardModels();
  console.log(`models before: ESL ${guard.before['knn_ESL.bin'].slice(0, 8)}, FSL ${guard.before['knn_FSL.bin'].slice(0, 8)}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'training-check-'));
  const timings = {};
  let chrome = null;
  try {
    await post({ action: 'delete_gesture', label: P_ESL });
    await post({ action: 'delete_gesture', label: P_BOTH });
    const y4m = buildY4m(tmp);
    chrome = await launchChrome({ port: PORT, extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
    await chrome.enableNetwork();
    const ev = (e) => chrome.evaluate(e);
    const waitFor = async (expr, ms = 30000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return Date.now() - t0; await sleep(step); } return -1; };
    const reqs = (from = 0) => chrome.getNetworkRequests().slice(from);
    const line = () => ev(`document.getElementById('modelStatusLine').textContent`);
    const setLang = async (lang) => {
      await ev(`(() => { const r = document.querySelector('input[name="trainModelLang"][value="${lang}"]'); if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
      return waitFor(`modelLanguage() === '${lang}' && !!loadedModel && loadedModel.lang === '${lang}'`, 30000);
    };
    async function openPage() {
      const i0 = chrome.getNetworkRequests().length;
      await chrome.navigate(PAGE);
      await waitFor(`!!(window.GestureDataRecorder && window.KnnModelStore && typeof showStepContent === 'function')`, 20000);
      await ev(`true`);   // no PIN since the accounts-quiz phase (logged in as admin, tests/video-capture/cdp.mjs)
      await waitFor(`!!listingGestures && !!modelStatus && !!loadedModel && document.getElementById('datasetCount').textContent !== '0 gestures'`, 120000, 150);
      await ev(`window.__toasts = []; (() => { const o = window.showToast; window.showToast = function (m) { window.__toasts.push(String(m)); return o.apply(this, arguments); }; })(); true`);
      return i0;
    }
    const upToDate = (lang, rows, labels) => new RegExp(`^${lang} model: ${rows} rows, ${labels} signs, built .+ — up to date$`);

    // ── 1. page load ──
    console.log('=== 1. page load ===');
    const tLoad = Date.now();
    const i0 = await openPage();
    timings.pageLoadMs = Date.now() - tLoad;
    await sleep(800);
    const r1 = reqs(i0);
    const sg = r1.filter((r) => r.url.includes('save_gesture.php'));
    check('1: exactly one save_gesture.php request, with summary=1 (full sync, no no_sync)', sg.length === 1 && /[?&]summary=1/.test(sg[0].url) && !/no_sync/.test(sg[0].url), J(sg.map((r) => r.method + ' ' + r.url.replace(BASE, ''))));
    let summaryBody = null;
    if (sg.length) { const b = await chrome.send('Network.getResponseBody', { requestId: sg[0].requestId }); summaryBody = b.result ? b.result.body : null; }
    const sj = summaryBody ? JSON.parse(summaryBody) : null;
    const nSamples = sj ? Object.values(sj.gestures).reduce((n, a) => n + a.length, 0) : 0;
    timings.summaryBytes = summaryBody ? Buffer.byteLength(summaryBody) : null;
    check(`1: the summary answer has no "frames" key; ${LIVE.nSigns} signs, ${LIVE.nSamples} samples (live) with file/frameCount`, !!sj && !summaryBody.includes('"frames"') && Object.keys(sj.gestures).length === LIVE.nSigns && nSamples === LIVE.nSamples &&
      Object.values(sj.gestures).flat().every((s) => typeof s.file === 'string' && typeof s.frameCount === 'number'), `${timings.summaryBytes} bytes, ${sj && Object.keys(sj.gestures).length} signs, ${nSamples} samples`);
    check('1: model_status.php requested', r1.some((r) => r.url.includes('php/api/model_status.php')));
    const eslReq = r1.filter((r) => r.url.split('?')[0].endsWith('/models/knn_ESL.bin')).map((r) => r.method);
    check('1: models/knn_ESL.bin HEAD + GET (fresh profile), no FSL file request', eslReq.includes('HEAD') && eslReq.includes('GET') && !r1.some((r) => r.url.includes('knn_FSL.bin')), J(eslReq));
    check('1: no full listing (no save_gesture.php without summary=1)', !r1.some((r) => r.url.includes('save_gesture.php') && !/summary=1/.test(r.url)));
    let st = await ev(`({ lang: loadedModel.lang, source: loadedModel.source, labels: activeLabels.length, keys: Object.keys(knnModel).length, trained: modelTrained, size: activeFeatureSize })`);
    check(`1: ESL model loaded from the file (${committed.ESL.labels.length} labels as in the file, 126 features, trained)`, st.lang === 'ESL' && st.labels === committed.ESL.labels.length && st.keys === committed.ESL.labels.length && st.trained && st.size === 126, J(st));
    await ev(`showStepContent(2); true`);
    await sleep(300);
    let l = await line();
    check(`1: status line ESL as model_status says (${status0.models.ESL.stale ? 'out of date' : 'up to date'})`, startLine('ESL').test(l), l);
    const fileKeys = committed.ESL.labels.map((L) => L.key);
    const expNew = LIVE.ESL.cardKeys.filter((k) => !fileKeys.includes(k) && LIVE.ESL.keys.includes(k)).length;
    const someKey = LIVE.ESL.cardKeys.find((k) => fileKeys.includes(k));
    const card = await ev(`({ rows: document.querySelectorAll('#step2SummaryCard .tr-summary-row[data-key]').length, news: document.querySelectorAll('#step2SummaryCard .tr-new-badge').length, one: (document.querySelector('#step2SummaryCard [data-key="${someKey}"]') || {}).textContent })`);
    check(`1: Step 2 card lists the ${LIVE.ESL.cardKeys.length} ESL signs of the listing, rows from the file, ${expNew} NEW badge(s)`, card.rows === LIVE.ESL.cardKeys.length && card.news >= expNew && (!someKey || /\d+ rows$/.test(card.one || '')), J(card));
    check('1: Next shown with a loaded model', await ev(`document.getElementById('step2NextBtn').offsetParent !== null`));
    check('1: initial log explains Compile', /Compile builds the selected model/.test(await ev(`document.getElementById('trainLog').textContent`)));
    const lay = await ev(LAYOUT);
    console.log('  Step 2 layout (laptop): ' + J(lay.controls.map((c) => `${c.id} ${c.w}x${c.h}@${c.y}`)) + ' blocks ' + J(lay.blocks.map((b) => `${b.id} y${b.y} h${b.h}`)));
    check('7: Step 2 laptop: every control >= 44x44, inside 1024x600, no overlap, no page scroll',
      lay.small.length === 0 && lay.outside.length === 0 && lay.overlaps.length === 0 && lay.sw === 1024 && lay.sh === 600 && lay.controls.length >= 5,
      J({ n: lay.controls.length, small: lay.small, outside: lay.outside, overlaps: lay.overlaps, sw: lay.sw, sh: lay.sh }));
    const fslMs = await setLang('FSL');
    l = await line();
    st = await ev(`({ labels: activeLabels.length, start: activeLabels.includes('start'), rows: loadedModel.header.rowCount })`);
    check(`1: FSL toggle loads the FSL file (${committed.FSL.labels.length} labels as in the file) and its status is as model_status says`, fslMs >= 0 && st.labels === committed.FSL.labels.length && st.start === committed.FSL.labels.some((L) => L.key === 'start') && startLine('FSL').test(l), `${l}; ${J(st)}`);
    await setLang('ESL');

    // ── 2. Compile ESL then FSL ──
    console.log('=== 2. Compile ===');
    async function compile(lang) {
      await setLang(lang);
      const n0 = chrome.getNetworkRequests().length;
      await ev(`window.lastCompile = null; document.getElementById('trainBtn').click(); true`);
      const running = await ev(`({ dis: document.getElementById('trainBtn').disabled, radios: [...document.querySelectorAll('input[name="trainModelLang"]')].every((r) => r.disabled) })`);
      const t0 = Date.now();
      await waitFor(`!!window.lastCompile`, 300000, 100);
      const wall = Date.now() - t0;
      await waitFor(`!compileRunning && /up to date|out of date|No model/.test(document.getElementById('modelStatusLine').textContent)`, 20000);
      await sleep(300);
      const out = await ev(`({ last: window.lastCompile, log: document.getElementById('trainLog').textContent, label: document.getElementById('epochLabel').textContent, bar: document.getElementById('epochBar').style.width,
        next: document.getElementById('step2NextBtn').offsetParent !== null, btn: document.getElementById('trainBtn').textContent, dis: document.getElementById('trainBtn').disabled,
        radios: [...document.querySelectorAll('input[name="trainModelLang"]')].some((r) => r.disabled), line: document.getElementById('modelStatusLine').textContent,
        rows: loadedModel && loadedModel.header.rowCount, labels: activeLabels.length, src: loadedModel && loadedModel.source })`);
      const posts = reqs(n0).filter((r) => r.url.includes('compile_model.php'));
      return { ...out, wall, running, posts, reqs: reqs(n0).map((r) => r.url) };
    }
    for (const lang of ['ESL', 'FSL']) {
      const { rows, labels, samples } = LIVE[lang];
      const c = await compile(lang);
      timings['compile' + lang] = { wall: c.wall, page: c.last && c.last.ms, bytes: c.last && c.last.bytes };
      console.log(`  ${lang} Compile: ${c.wall} ms wall, ${c.last && c.last.ms} ms in page; ${J(c.last)}`);
      console.log('  log: ' + J(c.log));
      check(`2: ${lang}: while running the button and the radios are locked`, c.running.dis && c.running.radios, J(c.running));
      check(`2: ${lang}: exactly one POST php/api/compile_model.php?lang=${lang}`, c.posts.length === 1 && c.posts[0].method === 'POST' && c.posts[0].url.endsWith(`compile_model.php?lang=${lang}`), J(c.posts.map((p) => p.method + ' ' + p.url)));
      check(`2: ${lang}: Compile succeeded`, c.last && c.last.ok === true, J(c.last));
      const d = decodeFile(lang);
      check(`2: ${lang}: the written file decodes to ${rows} rows / ${labels} labels / ${samples} samples, rule budget 90`, d.header.rowCount === rows && d.header.labels.length === labels && d.header.sampleCount === samples && d.header.rule.budget === 90, `${d.header.rowCount}/${d.header.labels.length}/${d.header.sampleCount}`);
      const stNow = await statusNow();
      check(`2: ${lang}: fingerprint equals model_status.php's fingerprintNow (and the live listing's)`, d.header.fingerprint === stNow.models[lang].fingerprintNow && d.header.fingerprint === LIVE[lang].fingerprint && stNow.models[lang].stale === false, d.header.fingerprint.slice(0, 16));
      const nodeHeader = { ...LIVE[lang].header, fingerprint: d.header.fingerprint };
      check(`2: ${lang}: rows identical to the node build over the live dataset (same labels, same Float32 values)`, J(d.header.labels) === J(LIVE[lang].header.labels) &&
        J(d.model) === J(K.decode(K.encode(nodeHeader, LIVE[lang].model)).model));
      const batches = (c.last && c.last.batches) || [];
      check(`2: ${lang}: frames read in batches of at most 60 samples (a bigger sign alone)`, batches.length > 0 && batches.every((b) => b.samples <= 60 || b.signs === 1) && batches.reduce((a, b) => a + b.samples, 0) === samples,
        `${batches.length} requests, largest ${Math.max(0, ...batches.map((b) => b.samples))} samples / ${Math.max(0, ...batches.map((b) => b.bytes))} bytes`);
      const reqLabels = c.reqs.filter((u) => u.includes('save_gesture.php'));
      check(`2: ${lang}: Compile's listing requests: one summary=1 (full sync) + the labels= batches, never a full listing`,
        reqLabels.filter((u) => /summary=1/.test(u) && !/no_sync/.test(u)).length === 1 && reqLabels.filter((u) => /no_sync=1&labels=/.test(u)).length === batches.length &&
        reqLabels.every((u) => /summary=1|labels=/.test(u)), `${reqLabels.length} requests`);
      const fsize = fs.statSync(path.join(MODELS_DIR, `knn_${lang}.bin`)).size;
      check(`2: ${lang}: log lists signs, samples, rows, budget, bytes, the file path; completion`,
        c.log.includes(`// ${lang}: ${labels} signs, ${fmt(samples)} samples, ${fmt(rows)} rows (budget 90 rows per sign)`) && c.log.includes('// Signs: ') && /\/\/ Read \d+\/\d+ signs \(request 1 of \d+/.test(c.log) &&
        c.log.includes(`// Wrote models/knn_${lang}.bin: ${fsize.toLocaleString('en-US')} bytes`) && /Compile complete in [\d.]+ s\./.test(c.log), `${fsize} bytes`);
      check(`2: ${lang}: page uses the written file (loaded back, ${rows} rows)`, c.rows === rows && c.labels === labels && c.src === 'network', J({ rows: c.rows, labels: c.labels, src: c.src }));
      check(`2: ${lang}: progress "Complete!", bar 100%, Next shown, button "Compile" enabled, radios unlocked`, /^Complete! — /.test(c.label) && c.bar === '100%' && c.next && c.btn === 'Compile' && !c.dis && !c.radios, J({ label: c.label, bar: c.bar, next: c.next, btn: c.btn, dis: c.dis }));
      check(`2: ${lang}: status line up to date after Compile`, upToDate(lang, rows.toLocaleString('en-US'), labels).test(c.line), c.line);
    }

    // ── 3. stale ──
    console.log('=== 3. stale ===');
    const before3 = await statusNow();
    const made = await post({ frames: probeFrames(0.1), text_en: 'Zz Model Probe', sign_language: 'ESL', category: 'word' });
    check('3: ESL probe saved through save_gesture.php', made.success === true, made.error);
    await ev(`window.reloadDataset()`);
    await setLang('ESL');
    l = await line();
    check('3: ESL probe -> ESL "Model out of date: run Compile"', l === 'Model out of date: run Compile', l);
    const probeRow = await ev(`(document.querySelector('#step2SummaryCard [data-key="${P_ESL}"]') || {}).textContent || null`);
    check('3: Step 2 card: the probe has a NEW badge, "not compiled yet"', !!probeRow && /NEW/.test(probeRow) && /not compiled yet/.test(probeRow), J(probeRow));
    await setLang('FSL');
    l = await line();
    check('3: ESL probe -> FSL still up to date (an ESL sign is not in the FSL model)', upToDate('FSL', fmt(LIVE.FSL.rows), LIVE.FSL.labels).test(l), l);
    const made2 = await post({ frames: probeFrames(0.2), text_en: 'Zz Model Both', text_fil: 'Zz Pareho Model', sign_language: 'BOTH', category: 'word' });
    check('3: BOTH probe saved', made2.success === true, made2.error);
    await ev(`window.reloadDataset()`);
    const both = [];
    for (const lang of ['FSL', 'ESL']) { await setLang(lang); both.push(lang + ': ' + await line()); }
    check('3: BOTH probe -> ESL and FSL both out of date', both.every((x) => x.endsWith(': Model out of date: run Compile')), J(both));
    await ev(`window.confirm = () => true; true`);
    const nStatus0 = chrome.getNetworkRequests().filter((r) => r.url.includes('model_status.php')).length;
    await ev(`deleteGesture('${P_ESL}')`);
    await ev(`deleteGesture('${P_BOTH}')`);
    const nStatus1 = chrome.getNetworkRequests().filter((r) => r.url.includes('model_status.php')).length;
    check('3: each delete refreshes the model status', nStatus1 - nStatus0 >= 2, `${nStatus1 - nStatus0} model_status requests`);
    const after3 = [];
    for (const lang of ['ESL', 'FSL']) { await setLang(lang); after3.push(await line()); }
    check('3: probes deleted -> ESL and FSL up to date again', upToDate('ESL', fmt(LIVE.ESL.rows), LIVE.ESL.labels).test(after3[0]) && upToDate('FSL', fmt(LIVE.FSL.rows), LIVE.FSL.labels).test(after3[1]), J(after3));
    const s3 = await statusNow();
    check('3: same fingerprints as before the probes', ['ESL', 'FSL'].every((g) => s3.models[g].fingerprintNow === before3.models[g].fingerprintNow && s3.models[g].header.fingerprint === s3.models[g].fingerprintNow),
      ['ESL', 'FSL'].map((g) => s3.models[g].fingerprintNow.slice(0, 12)).join(', '));
    check('3: no probe folder left', !fs.existsSync(path.join(REPO_ROOT, 'saved_gestures', P_ESL)) && !fs.existsSync(path.join(REPO_ROOT, 'saved_gestures', P_BOTH)));

    // ── 6. Export Data / Load Saved ──
    console.log('=== 6. Export / Load Saved ===');
    await setLang('ESL');
    const exp = await ev(`(async () => {
      let blob = null; const o = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
      const oc = HTMLAnchorElement.prototype.click; let name = null; HTMLAnchorElement.prototype.click = function () { name = this.download; };
      try { document.getElementById('downloadBtn').click(); } finally { URL.createObjectURL = o; HTMLAnchorElement.prototype.click = oc; }
      const text = blob ? await blob.text() : '';
      const d = text ? JSON.parse(text) : {};
      const keys = Object.keys(d);
      const sameRows = loadedModel.labels.every((k) => JSON.stringify(d[k]) === JSON.stringify(knnModel[k]));
      return { name, nKeys: keys.length, rows: keys.reduce((n, k) => n + d[k].length, 0), dims: keys.every((k) => d[k].every((r) => r.length === 126)), sameRows, bytes: text.length };
    })()`);
    check(`6: Export Data writes siningkamay-training.json = { label: rows } of the loaded ESL model (${LIVE.ESL.labels} labels, ${fmt(LIVE.ESL.rows)} rows)`, exp.name === 'siningkamay-training.json' && exp.nKeys === LIVE.ESL.labels && exp.rows === LIVE.ESL.rows && exp.dims && exp.sameRows, J(exp));
    const ls = await ev(`(() => {
      const before = { keys: Object.keys(knnModel).length, model: knnModel, trained: modelTrained, rows: loadedModel.header.rowCount };
      let inputs = 0; const oc = document.createElement.bind(document); document.createElement = (t, ...a) => { if (String(t).toLowerCase() === 'input') inputs++; return oc(t, ...a); };
      window.__toasts = [];
      try { document.getElementById('loadBtn').click(); } finally { document.createElement = oc; }
      return { toasts: window.__toasts.slice(), inputs, same: knnModel === before.model && Object.keys(knnModel).length === before.keys && modelTrained === before.trained && loadedModel.header.rowCount === before.rows };
    })()`);
    check('6: Load Saved shows the toast, opens no file picker, changes nothing', ls.toasts.length === 1 && ls.toasts[0] === LOAD_SAVED_TEXT && ls.inputs === 0 && ls.same, J(ls));

    // ── 5. Step 3 Predict ──
    console.log('=== 5. Step 3 Predict (fake camera) ===');
    await ev(`trGoToStep(3); showStepContent(3); true`);
    await sleep(600);
    await ev(`window.__preds = []; window.__hr = 0; GestureDataRecorder.onHandResults(() => { window.__hr++; }); (() => { const o = window.knnPredict; window.knnPredict = function (f) { const r = o.apply(this, arguments); if (r) window.__preds.push(r.label); return r; }; })(); document.getElementById('enableCamBtn').click(); true`);
    const camMs = await waitFor(`window.__hr > 5`, 60000, 200);
    await waitFor(`window.__preds.length >= 10`, 20000, 200);
    const pred = await ev(`({ preds: window.__preds.slice(), labels: activeLabels.slice(), shown: document.getElementById('livePredResult').textContent, step: currentStep })`);
    const counts = {}; pred.preds.forEach((p) => { counts[p] = (counts[p] || 0) + 1; });
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    timings.predict = ranked.slice(0, 3);
    check('5: Step 3 predicts labels of the loaded model from the fake camera', camMs >= 0 && pred.preds.length > 0 && pred.preds.every((p) => pred.labels.includes(p)) && pred.shown && pred.shown !== '—',
      `camera ${camMs} ms, ${pred.preds.length} predictions, top ${J(ranked.slice(0, 3))}, shown ${J(pred.shown)}`);
    await ev(`showStepInstruction(1); true`);

    // ── 4. Pi ──
    console.log('=== 4. Pi (config/device.txt = pi) ===');
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_FILE, 'pi\n');
    try {
      await openPage();
      await ev(`showStepContent(2); true`);
      await waitFor(`modelStatus && modelStatus.device === 'pi'`, 10000);
      await sleep(300);
      const pi = await ev(`({ device: modelStatus.device, dis: document.getElementById('trainBtn').disabled, warn: document.getElementById('modelPiWarning').textContent, warnVis: document.getElementById('modelPiWarning').offsetParent !== null,
        line: document.getElementById('modelStatusLine').textContent, step2: document.getElementById('leftStep2').textContent, trained: modelTrained, labels: activeLabels.length,
        next: document.getElementById('step2NextBtn').offsetParent !== null })`);
      check('4: Pi: Compile disabled, warning visible with the exact text', pi.device === 'pi' && pi.dis && pi.warnVis && pi.warn === PI_TEXT, J({ dis: pi.dis, warnVis: pi.warnVis, warn: pi.warn }));
      check('4: Pi: no out-of-date / run Compile text; the status shows the file', !/out of date|run Compile/i.test(pi.line) && new RegExp(`^ESL model: ${reEsc(fmt(LIVE.ESL.rows))} rows, ${LIVE.ESL.labels} signs, built .+$`).test(pi.line) && !/up to date/.test(pi.line), pi.line);
      check(`4: Pi: the model still loads (${LIVE.ESL.labels} labels), Next shown`, pi.trained && pi.labels === LIVE.ESL.labels && pi.next, J({ trained: pi.trained, labels: pi.labels, next: pi.next }));
      const n0 = chrome.getNetworkRequests().length;
      await ev(`window.lastCompile = null; compileModelGuarded()`);
      const refused = await ev(`({ last: window.lastCompile, log: document.getElementById('trainLog').textContent })`);
      check('4: Pi: Compile called anyway is refused with the warning, no POST', refused.last && refused.last.ok === false && refused.last.error === PI_TEXT && !reqs(n0).some((r) => r.url.includes('compile_model.php')), J(refused.last));
      const layPi = await ev(LAYOUT);
      console.log('  Step 2 layout (Pi): ' + J(layPi.controls.map((c) => `${c.id} ${c.w}x${c.h}@${c.y}${c.disabled ? ' disabled' : ''}`)) + ' blocks ' + J(layPi.blocks.map((b) => `${b.id} y${b.y} h${b.h}`)));
      check('7: Step 2 Pi: every control >= 44x44, inside 1024x600, no overlap, no page scroll',
        layPi.small.length === 0 && layPi.outside.length === 0 && layPi.overlaps.length === 0 && layPi.sw === 1024 && layPi.sh === 600 && layPi.blocks.some((b) => b.id === 'modelPiWarning'),
        J({ n: layPi.controls.length, small: layPi.small, outside: layPi.outside, overlaps: layPi.overlaps, sw: layPi.sw, sh: layPi.sh }));
      await setLang('FSL');
      const piF = await line();
      check('4: Pi: FSL toggle loads the FSL file, no out-of-date text', !/out of date|run Compile/i.test(piF) && (await ev(`activeLabels.length`)) === LIVE.FSL.labels, piF);
      await ev(`trGoToStep(4); showStepContent(4); true`);
      await sleep(300);
      check('4: Pi: Step 4 opens with the loaded model', (await ev(`currentStep`)) === 4 && (await ev(`modelTrained`)) === true);
      await ev(`showStepInstruction(1); true`);
    } finally {
      fs.rmSync(DEVICE_FILE, { force: true });
      if (!configDirExisted && fs.existsSync(CONFIG_DIR) && fs.readdirSync(CONFIG_DIR).length === 0) fs.rmdirSync(CONFIG_DIR);
    }
    check('4: config/device.txt removed', !fs.existsSync(DEVICE_FILE));

    // ── 7. console ──
    const errs = chrome.getConsoleErrors(), exc = chrome.getExceptions();
    check('7: 0 console errors, 0 uncaught exceptions', errs.length === 0 && exc.length === 0, J({ errs: errs.slice(0, 3).map((e) => e.text.slice(0, 200)), exc: exc.slice(0, 2) }));
    const foreign = chrome.getNetworkRequests().filter((r) => !/^(http:\/\/localhost\/|data:|blob:|about:)/.test(r.url));
    check('7: every request to localhost', foreign.length === 0, foreign.slice(0, 3).map((r) => r.url).join(', '));
  } catch (e) {
    failures++;
    console.log('  FAIL  run threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    if (chrome) { try { await chrome.close(); } catch {} }
    for (const k of [P_ESL, P_BOTH]) { try { await post({ action: 'delete_gesture', label: k }); } catch {} }
    fs.rmSync(DEVICE_FILE, { force: true });
    if (!configDirExisted && fs.existsSync(CONFIG_DIR) && fs.readdirSync(CONFIG_DIR).length === 0) fs.rmdirSync(CONFIG_DIR);
    fs.rmSync(tmp, { recursive: true, force: true });
    const r = guard.restore();
    console.log('  models: ' + r.line);
    const shas = modelShas();
    check('7: models/ sha256 unchanged at the end', r.ok && shas[0] === guard.before['knn_ESL.bin'] && shas[1] === guard.before['knn_FSL.bin'], shas.map((s) => s && s.slice(0, 8)).join(', '));
    check('cleanup: no zz probe folder, no config/device.txt, no models/*.tmp', ![P_ESL, P_BOTH].some((k) => fs.existsSync(path.join(REPO_ROOT, 'saved_gestures', k))) &&
      !fs.existsSync(DEVICE_FILE) && !fs.readdirSync(MODELS_DIR).some((f) => f.endsWith('.tmp')));
  }
  console.log('\n--- timings ---');
  console.log(J(timings));
  console.log(failures === 0 ? '\nALL PASS (0 failures)' : `\nFAILED (${failures} failures)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
