// Scale check for Compile (compact-model phase, Task 9): Train Gestures' Compile on the owner's
// planned import size. The full listing with frames runs PHP out of memory at ~732 v3 samples
// (.git/sdd/cm-phase-review-1.md), so Compile reads a summary listing and then the frames a batch
// of signs at a time (save_gesture.php?no_sync=1&labels=...). This check proves it at scale.
//
// It writes `zz_scale_###` sign folders straight to disk (set BOTH, sign.json like the real ones)
// with synthetic v3 samples copied from the frozen fixture's v3 `hi` / `yow` samples with jittered
// landmarks (about 46-71 KB each), default 120 signs x 25 samples = 3,000 (--signs N, --samples M).
// Then, in headless Chrome (CDP port 9475, fresh profile, 1024x600), it opens gesture-training.html
// and presses Compile for ESL and FSL. Asserts: success; the written header (every zz sign with the
// budgeted row count, e.g. 75 = 25 x 3 under budget 90; samples; sampleCount = sum of label
// samples); the fingerprint = model_status.php fingerprintNow; no listing request returned more
// than 60 samples (a single sign alone may). Measures: Compile time, the largest response, PHP peak
// memory per batch (php-cgi on the same labels= request with -d memory_limit=128M and an
// auto_prepend shutdown hook that records memory_get_peak_usage(true)), ?summary=1 (full sync and
// no_sync) and model_status.php times, and whether bulk import's own full listing
// (GET save_gesture.php?no_sync=1, its Review step, must not change) still answers.
//
// Cleanup, always (finally): delete_gesture for every zz_scale sign (folders + DB rows), a sweep
// of any zz_scale folder/row left, guardModels().restore(), and the DB counts read at the start
// must be back.
//
// Run (Apache + MariaDB up, nothing else running): node tests/compact-model/scale-check.mjs
//   [--signs 120] [--samples 25]      e.g. --signs 122 --samples 6 = 732 samples
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { launchChrome } from '../video-capture/cdp.mjs';
import { loadFixtureListing, loadKnnCompile, loadToRows, REPO_ROOT } from './fixtures.mjs';
import { guardModels, modelShas } from './model-guard.mjs';
import { sql } from '../sign-texts/api-helper.mjs';
import { PHP_CGI } from '../normalization/clone-helper.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
const N_SIGNS = opt('--signs', 120);
const N_SAMPLES = opt('--samples', 25);
const BASE = 'http://localhost/SKR/';
const SAVE = BASE + 'php/api/save_gesture.php';
const PORT = 9475;
const SAVED = path.join(REPO_ROOT, 'saved_gestures');
const PREFIX = 'zz_scale_';
const BATCH_MAX = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const KB = (n) => Math.round(n / 1024);
const MB = (n) => Math.round(n / 1048576 * 10) / 10;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail !== undefined && detail !== '' ? ' - ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail !== undefined && detail !== '' ? ' - ' + detail : ''}`); }
}
const dbCounts = () => ({ gestures: Number(sql('SELECT COUNT(*) c FROM gestures')[0].c), recordings: Number(sql('SELECT COUNT(*) c FROM gesture_recordings')[0].c) });
const keyOf = (i) => PREFIX + String(i + 1).padStart(3, '0');
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Synthetic v3 sample: a real fixture v3 sample's frames with every landmark x/y jittered.
function makeSample(src, label, i, rand) {
  const frames = src.frames.map((f) => ({ ...f, hands: (f.hands || []).map((h) => ({ ...h,
    landmarks: h.landmarks.map((p) => ({ x: Math.round((p.x + (rand() - 0.5) * 0.006) * 10000) / 10000, y: Math.round((p.y + (rand() - 0.5) * 0.006) * 10000) / 10000, z: p.z })) })) }));
  return { label, createdAt: new Date(Date.UTC(2026, 9, 16, 0, 0, i)).toISOString().replace('.000Z', '+00:00'), frameCount: frames.length,
    format: 'mediapipe_hands_raw_v3', formatVersion: 3, signLanguage: 'ESL', source: 'video-live', repIndex: (i % 3) + 1,
    videoWidth: 480, videoHeight: 360, fps: 15, input: { width: 320, height: 240, contentRect: { x: 0, y: 0, w: 320, h: 240 } }, frames };
}

function deleteViaApi(key) {
  return fetch(SAVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J({ action: 'delete_gesture', label: key }) }).then((r) => r.json()).catch((e) => ({ success: false, error: e.message }));
}
async function sweep() {
  const left = fs.existsSync(SAVED) ? fs.readdirSync(SAVED).filter((d) => d.startsWith(PREFIX)) : [];
  for (const k of left) await deleteViaApi(k);
  for (const k of fs.readdirSync(SAVED).filter((d) => d.startsWith(PREFIX))) fs.rmSync(path.join(SAVED, k), { recursive: true, force: true });
  sql(`DELETE FROM gesture_recordings WHERE gesture_id IN (SELECT id FROM gestures WHERE label LIKE 'zz\\_scale\\_%')`);
  sql(`DELETE FROM gestures WHERE label LIKE 'zz\\_scale\\_%'`);
  return left.length;
}

// php-cgi GET of save_gesture.php with a query, memory_limit 128M, peak memory from a shutdown hook.
function phpPeak(query, hookDir, memoryLimit = '128M') {
  const out = path.join(hookDir, 'peak.txt');
  fs.rmSync(out, { force: true });
  const hook = path.join(hookDir, 'hook.php');
  fs.writeFileSync(hook, `<?php register_shutdown_function(function () { file_put_contents(${J(out.replace(/\\/g, '/'))}, (string)memory_get_peak_usage(true)); });\n`);
  const env = { ...process.env, REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'GET',
    SCRIPT_FILENAME: path.join(REPO_ROOT, 'php', 'api', 'save_gesture.php'), SCRIPT_NAME: '/SKR/php/api/save_gesture.php', QUERY_STRING: query };
  const t0 = Date.now();
  const r = spawnSync(PHP_CGI, ['-d', `memory_limit=${memoryLimit}`, '-d', `auto_prepend_file=${hook}`], { env, maxBuffer: 1024 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const text = r.stdout.toString('utf8');
  const body = text.slice(text.indexOf('\r\n\r\n') + 4);
  let ok = false;
  try { ok = JSON.parse(body).success === true; } catch { ok = false; }
  const peak = fs.existsSync(out) ? Number(fs.readFileSync(out, 'utf8')) : null;
  return { ok, peak, ms, bytes: Buffer.byteLength(body), fatal: /Allowed memory size/.test(body) };
}

async function timeGet(url, n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now(); const r = await fetch(url, { cache: 'no-store' }); const b = await r.text(); out.push({ ms: Date.now() - t0, bytes: Buffer.byteLength(b), status: r.status });
  }
  return { ms: out.map((x) => x.ms), median: median(out.map((x) => x.ms)), bytes: out[0].bytes, status: out[0].status };
}

async function main() {
  const K = loadKnnCompile();
  const toRows = loadToRows();
  const fixture = loadFixtureListing();
  const sources = ['hi', 'yow'].flatMap((k) => fixture.gestures[k]).filter((s) => Array.isArray(s.frames) && s.frames.some((f) => Array.isArray(f.hands)));
  if (sources.length < 2) throw new Error('fixture hi/yow v3 samples not found');
  const swept = await sweep();
  if (swept) console.log(`(removed ${swept} zz_scale sign(s) left by an earlier run)`);
  const countsBefore = dbCounts();
  console.log(`DB before: ${J(countsBefore)}; generating ${N_SIGNS} signs x ${N_SAMPLES} samples = ${N_SIGNS * N_SAMPLES} v3 samples`);
  const guard = guardModels();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-check-'));
  const nums = { signs: N_SIGNS, samples: N_SAMPLES, total: N_SIGNS * N_SAMPLES };
  let chrome = null;
  try {
    // ── dataset on disk ──
    let seed = 12345; const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const expectRows = {};
    let bytes = 0;
    const t0 = Date.now();
    for (let s = 0; s < N_SIGNS; s++) {
      const key = keyOf(s);
      const dir = path.join(SAVED, key);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'sign.json'), JSON.stringify({ key, set: 'BOTH', textEn: `Zz Scale ${s + 1}`, textFil: `Zz Sukat ${s + 1}`, updatedAt: '2026-10-16T00:00:00+00:00' }, null, 4));
      const lists = [];
      for (let i = 0; i < N_SAMPLES; i++) {
        const sample = makeSample(sources[(s + i) % sources.length], key, s * N_SAMPLES + i, rand);
        const text = JSON.stringify(sample);
        bytes += text.length;
        fs.writeFileSync(path.join(dir, `sample_${1790000000000 + s * 1000 + i}_${crypto.createHash('md5').update(key + i).digest('hex').slice(0, 6)}.json`), text);
        lists.push(toRows(sample));
      }
      expectRows[key] = K.selectSignRows(lists).length;
    }
    nums.writeMs = Date.now() - t0;
    nums.avgSampleKB = KB(bytes / nums.total);
    console.log(`wrote ${nums.total} samples, ${MB(bytes)} MB, avg ${nums.avgSampleKB} KB, in ${nums.writeMs} ms; expected rows per zz sign: ${J([...new Set(Object.values(expectRows))])}`);

    // ── listing / status timings on this dataset (the first full sync also inserts the DB rows) ──
    const firstSync = await timeGet(SAVE + '?summary=1', 1);
    nums.firstFullSyncSummaryMs = firstSync.median;
    nums.summaryFullSync = await timeGet(SAVE + '?summary=1');
    nums.summaryNoSync = await timeGet(SAVE + '?no_sync=1&summary=1');
    nums.modelStatus = await timeGet(BASE + 'php/api/model_status.php');
    console.log(`first full-sync ?summary=1 (inserts the DB rows): ${nums.firstFullSyncSummaryMs} ms`);
    console.log(`?summary=1 full sync: ${J(nums.summaryFullSync.ms)} ms, ${nums.summaryFullSync.bytes} bytes; no_sync: ${J(nums.summaryNoSync.ms)} ms; model_status.php: ${J(nums.modelStatus.ms)} ms`);
    check('DB: the full sync added every zz_scale sign and sample', dbCounts().gestures === countsBefore.gestures + N_SIGNS && dbCounts().recordings === countsBefore.recordings + nums.total, J(dbCounts()));

    // bulk import's own Review listing (must not change): does it still answer at this size?
    const t1 = Date.now();
    let bulk;
    try { const r = await fetch(SAVE + '?no_sync=1'); const b = await r.text(); let ok = false; try { ok = JSON.parse(b).success === true; } catch {} bulk = { status: r.status, ok, bytes: Buffer.byteLength(b), fatal: /Allowed memory size/.test(b) }; }
    catch (e) { bulk = { ok: false, error: e.message }; }
    bulk.ms = Date.now() - t1;
    nums.bulkFullListing = bulk;
    console.log(`  INFO  bulk import's full listing (GET ?no_sync=1, Apache memory_limit as php.ini): ${J(bulk)}`);

    // ── Compile in the browser ──
    chrome = await launchChrome({ port: PORT });
    await chrome.enableNetwork();
    const ev = (e) => chrome.evaluate(e);
    const waitFor = async (expr, ms = 30000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return Date.now() - t; await sleep(step); } return -1; };
    const tLoad = Date.now();
    await chrome.navigate(BASE + 'gesture-training.html');
    await waitFor(`!!(window.GestureDataRecorder && window.KnnModelStore && typeof trPressPin === 'function')`, 30000);
    await ev(`pinInput = '2026'; trVerifyPin(); true`);
    const loaded = await waitFor(`!!listingGestures && !!modelStatus && document.getElementById('datasetCount').textContent !== '0 gestures'`, 300000, 300);
    nums.pageLoadMs = Date.now() - tLoad;
    check('page loads the summary listing at this size', loaded >= 0, `${nums.pageLoadMs} ms; ${await ev(`document.getElementById('datasetCount').textContent`)}`);
    await ev(`performance.setResourceTimingBufferSize(10000); performance.clearResourceTimings(); showStepContent(2); true`);

    for (const lang of ['ESL', 'FSL']) {
      await ev(`(() => { const r = document.querySelector('input[name="trainModelLang"][value="${lang}"]'); if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
      await waitFor(`modelLanguage() === '${lang}' && !compileRunning`, 30000);
      await sleep(500);
      const n0 = chrome.getNetworkRequests().length;
      await ev(`performance.clearResourceTimings(); window.lastCompile = null; document.getElementById('trainBtn').click(); true`);
      const tc = Date.now();
      await waitFor(`!!window.lastCompile && !compileRunning`, 900000, 500);
      const wall = Date.now() - tc;
      const last = await ev(`window.lastCompile`);
      const res = await ev(`performance.getEntriesByType('resource').filter((e) => e.name.includes('save_gesture.php')).map((e) => ({ url: e.name, body: e.decodedBodySize, ms: Math.round(e.duration) }))`);
      const reqs = chrome.getNetworkRequests().slice(n0).filter((r) => r.url.includes('save_gesture.php')).map((r) => r.url);
      const labelReqs = reqs.filter((u) => /labels=/.test(u));
      const largest = res.reduce((m, e) => (e.body > m.body ? e : m), { body: 0 });
      const st = await (await fetch(BASE + 'php/api/model_status.php', { cache: 'no-store' })).json();
      const h = K.decode(fs.readFileSync(path.join(REPO_ROOT, 'models', `knn_${lang}.bin`))).header;
      const zz = h.labels.filter((L) => L.key.startsWith(PREFIX));
      const bad = zz.filter((L) => L.rows !== expectRows[L.key] || L.samples !== N_SAMPLES);
      const perBatch = (last && last.batches) || [];
      nums[lang] = { wall, page: last && last.ms, ok: last && last.ok, requests: reqs.length, batches: perBatch.length,
        largestBatchSamples: Math.max(0, ...perBatch.map((b) => b.samples)), largestResponseMB: MB(largest.body), largestResponseMs: largest.ms,
        rows: h.rowCount, labels: h.labels.length, sampleCount: h.sampleCount, fileBytes: fs.statSync(path.join(REPO_ROOT, 'models', `knn_${lang}.bin`)).size };
      console.log(`  ${lang}: ${J(nums[lang])}`);
      check(`${lang}: Compile succeeded`, !!last && last.ok === true, last && (last.error || ''));
      check(`${lang}: every zz_scale sign is in the file with ${[...new Set(Object.values(expectRows))].join('/')} rows and ${N_SAMPLES} samples`, zz.length === N_SIGNS && bad.length === 0, `${zz.length} zz labels; bad ${J(bad.slice(0, 3))}`);
      check(`${lang}: sampleCount = sum of the labels' samples; rowCount = sum of rows`, h.sampleCount === h.labels.reduce((a, L) => a + L.samples, 0) && h.rowCount === h.labels.reduce((a, L) => a + L.rows, 0), `${h.sampleCount} samples, ${h.rowCount} rows`);
      check(`${lang}: fingerprint = model_status.php fingerprintNow, not stale`, h.fingerprint === st.models[lang].fingerprintNow && st.models[lang].stale === false, h.fingerprint.slice(0, 12));
      check(`${lang}: no listing request returned more than ${BATCH_MAX} samples (one bigger sign alone)`, perBatch.length > 0 && perBatch.every((b) => b.samples <= BATCH_MAX || b.signs === 1) && labelReqs.length === perBatch.length,
        `${perBatch.length} batches, largest ${nums[lang].largestBatchSamples} samples, largest response ${nums[lang].largestResponseMB} MB`);
      check(`${lang}: the only frame-less listing is one summary=1; no full listing`, reqs.length === labelReqs.length + 1 && reqs.filter((u) => /summary=1/.test(u)).length === 1, J(reqs.filter((u) => !/labels=/.test(u))));
      nums[lang].labelQueries = labelReqs.map((u) => u.split('?')[1]);
    }
    const errs = chrome.getConsoleErrors(), exc = chrome.getExceptions();
    check('0 console errors / exceptions', errs.length === 0 && exc.length === 0, J({ errs: errs.slice(0, 2), exc: exc.slice(0, 1) }));
    await chrome.close(); chrome = null;

    // ── PHP peak memory per batch (php-cgi, same labels= query, memory_limit 128M) ──
    const peaks = nums.ESL.labelQueries.map((q) => phpPeak(q, tmp));
    nums.phpPeakPerBatch = { batches: peaks.length, maxMB: MB(Math.max(...peaks.map((p) => p.peak || 0))), medianMB: MB(median(peaks.map((p) => p.peak || 0))),
      maxMs: Math.max(...peaks.map((p) => p.ms)), allOk: peaks.every((p) => p.ok), maxResponseMB: MB(Math.max(...peaks.map((p) => p.bytes))) };
    console.log(`  php-cgi per batch (memory_limit=128M): ${J(nums.phpPeakPerBatch)}`);
    check('every batch request succeeds under memory_limit=128M (php-cgi)', nums.phpPeakPerBatch.allOk, J(peaks.filter((p) => !p.ok).slice(0, 2)));
    const full = phpPeak('no_sync=1', tmp, '512M');
    nums.fullListingPhpCgi512 = { ok: full.ok, fatal: full.fatal, peakMB: full.peak ? MB(full.peak) : null, ms: full.ms };
    console.log(`  INFO  php-cgi full listing ?no_sync=1 with memory_limit=512M: ${J(nums.fullListingPhpCgi512)}`);
  } catch (e) {
    failures++;
    console.log('  FAIL  run threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    if (chrome) { try { await chrome.close(); } catch {} }
    console.log('--- cleanup ---');
    const tDel = Date.now();
    const keys = fs.existsSync(SAVED) ? fs.readdirSync(SAVED).filter((d) => d.startsWith(PREFIX)) : [];
    let delOk = 0;
    const delErrors = [];
    for (const k of keys) {
      let j = await deleteViaApi(k);
      if (!(j && j.success)) { delErrors.push(`${k}: ${j && j.error}`); await sleep(500); j = await deleteViaApi(k); }   // one retry (Windows file locks)
      if (j && j.success) delOk++;
    }
    const leftAfterApi = fs.readdirSync(SAVED).filter((d) => d.startsWith(PREFIX)).length;
    await sweep();
    console.log(`  delete_gesture: ${delOk}/${keys.length} ok in ${Date.now() - tDel} ms; folders left after the API: ${leftAfterApi}; first-try errors: ${J(delErrors)}`);
    check('cleanup: every zz_scale sign deleted through delete_gesture', delOk === keys.length && leftAfterApi === 0, `${delOk}/${keys.length}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    const r = guard.restore();
    console.log('  models: ' + r.line);
    const shas = modelShas();
    check('models/ restored byte for byte', r.ok && shas[0] === guard.before['knn_ESL.bin'] && shas[1] === guard.before['knn_FSL.bin'], shas.map((x) => x.slice(0, 8)).join(', '));
    const after = dbCounts();
    check('DB counts back to the start', J(after) === J(countsBefore), `${J(countsBefore)} -> ${J(after)}`);
    check('no zz_scale folder or DB row left', !fs.readdirSync(SAVED).some((d) => d.startsWith(PREFIX)) && Number(sql(`SELECT COUNT(*) c FROM gestures WHERE label LIKE 'zz\\_scale\\_%'`)[0].c) === 0);
  }
  delete nums.ESL?.labelQueries; delete nums.FSL?.labelQueries;
  console.log('\n--- numbers ---');
  console.log(J(nums, null, 1));
  console.log(failures === 0 ? '\nALL PASS (0 failures)' : `\nFAILED (${failures} failures)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
