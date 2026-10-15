// Laptop check for tests/compact-model/bench.html (compact-model phase, Task 7).
// Pass 1: builds the ESL and FSL model files from the FROZEN fixture (js/knn-compile.js buildModel +
// encode, as store-check.mjs does; the live models/ change with the dataset), writes them to a temp
// folder tests/compact-model/.tmp-bench-* (served by Apache through the repo junction, deleted at
// the end), opens bench.html?quick&models=<that folder> in headless Chrome, waits for its
// COMPACT_BENCH line, and checks: every field is there, the models have 2,047 (ESL) / 1,414 (FSL)
// rows, each timing used its own knnPredict instance, plain arrays and Float32Array views
// give the same top-1 on every query, 0 console errors / uncaught exceptions, its own database
// sk_bench_models is gone afterwards, and the kiosk database sining_kamay_models was never created
// (a fresh profile has no databases, so any open of it, even read-only, would create it).
// (a fresh profile has no databases, so any open of it, even read-only, would create it), and
// localStorage stays empty.
// Pass 2: bench.html?quick&stopms=1 on the live models/ (the default path the Pi uses): its rows
// must equal the live files' own headers, and the stop rule must skip the second synthetic size.
// Prints the numbers. Laptop timings only; the Pi numbers come from tests/compact-model/pi-bench.sh.
// Run: node tests/compact-model/bench-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../video-capture/cdp.mjs';
import { loadFixtureListing, loadToRows, loadKnnCompile, REPO_ROOT } from './fixtures.mjs';

const PORT = 9461;
const BASE = 'http://localhost/SKR/tests/compact-model/bench.html?quick';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_ROWS = { ESL: 2047, FSL: 1414 };
const TIMEOUT_MS = 300000;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Frozen-fixture model files (2,047 / 1,414 rows), written to a temp folder.
const K = loadKnnCompile();
const toRows = loadToRows();
const listing = loadFixtureListing();
const tmpDir = fs.mkdtempSync(path.join(__dirname, '.tmp-bench-'));
const tmpRel = 'tests/compact-model/' + path.basename(tmpDir);
const fixtureBytes = {};
for (const lang of ['ESL', 'FSL']) {
  const b = K.buildModel({ gestures: listing.gestures, signs: listing.signs, categories: listing.categories, lang, toRows,
    buildDate: '2026-10-15T00:00:00.000Z' });
  b.header.fingerprint = await K.sha256Hex(b.fingerprintText);
  const buf = Buffer.from(K.encode(b.header, b.model));
  fs.writeFileSync(path.join(tmpDir, 'knn_' + lang + '.bin'), buf);
  fixtureBytes[lang] = buf.length;
}
console.log(`fixture models in ${tmpRel}: ESL ${fixtureBytes.ESL} bytes, FSL ${fixtureBytes.FSL} bytes`);

const chrome = await launchChrome({ port: PORT });
try {
  await chrome.navigate(BASE + '&models=' + tmpRel);
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < TIMEOUT_MS) {
    done = await chrome.evaluate('!!window.benchDone');
    if (done) break;
    await sleep(500);
  }
  check('bench finished', done, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!done) throw new Error('bench did not finish');

  const page = await chrome.evaluate(`(async () => ({
    line: window.benchLine || null,
    failed: window.benchFailed || null,
    result: window.benchResult || null,
    shown: document.getElementById('out').textContent.length,
    localStorageLength: localStorage.length,
    dbs: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : null
  }))()`);

  check('no COMPACT_BENCH_FAILED', !page.failed, page.failed || '');
  check('console line starts with "COMPACT_BENCH {"', typeof page.line === 'string' && page.line.startsWith('COMPACT_BENCH {'));
  let parsed = null;
  try {
    parsed = JSON.parse(page.line.slice('COMPACT_BENCH '.length));
  } catch {}
  check('console line JSON parses and equals window.benchResult', !!parsed && JSON.stringify(parsed) === JSON.stringify(page.result),
    page.line ? `${page.line.length} chars` : '');
  check('result shown on the page', page.shown > 200);
  const R = parsed || {};

  // Top-level fields.
  for (const k of ['userAgent', 'startedAt', 'compareTo']) check(`field ${k}`, typeof R[k] === 'string' && R[k].length > 0);
  check('field hardwareConcurrency', isNum(R.hardwareConcurrency), String(R.hardwareConcurrency));
  check('field quick = true', R.quick === true);
  check('field modelsDir = the fixture folder', R.modelsDir === tmpRel, String(R.modelsDir));
  check('field totalMs', isNum(R.totalMs), String(R.totalMs));
  for (const k of ['storageBefore', 'storageWithModels']) {
    const s = R[k] || {};
    check(`field ${k} (usage, quota)`, isNum(s.usage) && isNum(s.quota), JSON.stringify(s));
  }
  check('sk_bench_models deleted before and after', R.dbBefore === 'deleted' && R.dbAfter === 'deleted', `${R.dbBefore} / ${R.dbAfter}`);

  // Model load.
  for (const lang of ['ESL', 'FSL']) {
    const L = (R.load || {})[lang] || {};
    check(`load.${lang}: 3 cold + 3 warm timings`, Array.isArray(L.cold) && L.cold.length === 3 && L.cold.every(isNum) &&
      Array.isArray(L.warm) && L.warm.length === 3 && L.warm.every(isNum));
    check(`load.${lang}: bytes, rows, labels`, isNum(L.bytes) && L.bytes > 0 && isNum(L.rows) && isNum(L.labels), `${L.bytes} bytes, ${L.labels} labels`);
    check(`load.${lang}: rows = ${EXPECTED_ROWS[lang]} (frozen fixture)`, L.rows === EXPECTED_ROWS[lang], String(L.rows));
    check(`load.${lang}: bytes = the fixture file's`, L.bytes === fixtureBytes[lang], `${L.bytes} / ${fixtureBytes[lang]}`);
    check(`load.${lang}: every cold load came from the network`, Array.isArray(L.coldSource) && L.coldSource.every((s) => s === 'network'), JSON.stringify(L.coldSource));
    // A warm load is 'network' only if the file changed between the two loads (e.g. Compile ran
    // in parallel, or Apache's weak ETag for a file modified < 1 s earlier): reported, not failed.
    const warmCache = Array.isArray(L.warmSource) && L.warmSource.every((s) => s === 'cache');
    console.log(`${warmCache ? 'PASS' : 'NOTE'}  load.${lang}: every warm load came from the stored copy  (${JSON.stringify(L.warmSource)})`);
  }

  // knnPredict.
  const P = Array.isArray(R.predict) ? R.predict : [];
  const real = (name) => P.find((p) => p.name === name) || {};
  check('predict: ESL real + FSL real + 2 synthetic sizes (quick)', P.length === 4 && !!real('ESL real').name && !!real('FSL real').name,
    P.map((p) => `${p.name}:${p.rows}`).join(', '));
  check('predict: real rows 2,047 / 1,414', real('ESL real').rows === 2047 && real('FSL real').rows === 1414,
    `${real('ESL real').rows} / ${real('FSL real').rows}`);
  check('predict: synthetic sizes 2,047 and 9,164', P.filter((p) => p.name === 'synthetic').map((p) => p.rows).join(',') === '2047,9164');
  for (const p of P) {
    const tag = `predict ${p.name} ${p.rows}`;
    if (p.skipped) {
      check(`${tag}: not skipped on the laptop`, false, p.skipped);
      continue;
    }
    const ok = (s) => s && isNum(s.median) && isNum(s.p90) && isNum(s.max);
    check(`${tag}: plain and f32 median/p90`, ok(p.plain) && ok(p.f32) && p.queries === 60 && p.warmup === 10 && isNum(p.labels));
    check(`${tag}: same top-1 with both array kinds`, p.sameTop1 === true && p.sameTop1Count === 60, `${p.sameTop1Count}/60`);
    check(`${tag}: own knnPredict instance per array kind`, p.instance === 'own per array kind');
  }
  const ran = P.filter((p) => !p.skipped).length;
  check('one fresh knnPredict instance per timing (2 per model run)', R.predictInstances === 2 * ran, `${R.predictInstances} instances, ${ran} model runs`);
  check('definitions.predict says each timing has its own instance', /own freshly compiled knnPredict instance/.test((R.definitions || {}).predict || ''));

  // Console and the kiosk database.
  const errs = chrome.getConsoleErrors();
  const exc = chrome.getExceptions();
  check('0 console errors', errs.length === 0, errs.map((e) => e.text).join(' | ').slice(0, 300));
  check('0 uncaught exceptions', exc.length === 0, exc.join(' | ').slice(0, 300));
  check('indexedDB.databases() available', Array.isArray(page.dbs));
  check('kiosk database sining_kamay_models was not created or touched', Array.isArray(page.dbs) && !page.dbs.includes('sining_kamay_models'), JSON.stringify(page.dbs));
  check('own database sk_bench_models is gone', Array.isArray(page.dbs) && !page.dbs.includes('sk_bench_models'), JSON.stringify(page.dbs));
  check('localStorage is empty after the run (fresh profile)', page.localStorageLength === 0, String(page.localStorageLength));

  // The numbers.
  console.log('');
  console.log(`userAgent: ${R.userAgent}`);
  console.log(`hardwareConcurrency: ${R.hardwareConcurrency}, deviceMemory: ${R.deviceMemory}, total ${R.totalMs} ms`);
  for (const lang of ['ESL', 'FSL']) {
    const L = (R.load || {})[lang] || {};
    console.log(`load ${lang}: ${L.bytes} bytes, ${L.rows} rows, ${L.labels} labels; cold ${JSON.stringify(L.cold)} ms; warm ${JSON.stringify(L.warm)} ms`);
  }
  for (const p of P) {
    if (p.skipped) { console.log(`predict ${p.name.padEnd(9)} ${String(p.rows).padStart(6)} rows: skipped (${p.skipped})`); continue; }
    console.log(`predict ${p.name.padEnd(9)} ${String(p.rows).padStart(6)} rows: plain median ${p.plain.median} p90 ${p.plain.p90} ms | f32 median ${p.f32.median} p90 ${p.f32.p90} ms | same top-1 ${p.sameTop1Count}/60`);
  }
  const sb = R.storageBefore || {}, sw = R.storageWithModels || {};
  console.log(`storage: before ${sb.usageMB} MB used / ${sb.quotaMB} MB quota; with models ${sw.usageMB} MB used / ${sw.quotaMB} MB quota`);

  // Pass 2, live models/ (the default path). The stop rule (what bounds the Pi run): with a 1 ms
  // threshold the first synthetic size's median exceeds it, so the second size must be skipped.
  console.log('');
  const live = {};
  for (const lang of ['ESL', 'FSL']) {
    const buf = fs.readFileSync(path.join(REPO_ROOT, 'models', 'knn_' + lang + '.bin'));
    const h = K.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)).header;
    live[lang] = { rows: h.rowCount, labels: h.labels.length, bytes: buf.length };
  }
  console.log(`live models/: ESL ${live.ESL.rows} rows / ${live.ESL.labels} labels, FSL ${live.FSL.rows} rows / ${live.FSL.labels} labels`);
  await chrome.navigate(BASE + '&stopms=1');
  const t1 = Date.now();
  let done2 = false;
  while (Date.now() - t1 < TIMEOUT_MS) {
    done2 = await chrome.evaluate('!!window.benchDone');
    if (done2) break;
    await sleep(500);
  }
  const S = done2 ? await chrome.evaluate('window.benchResult || null') : null;
  check('pass 2 used models/ and matches the live files (rows, labels, bytes)', !!S && S.modelsDir === 'models' &&
    ['ESL', 'FSL'].every((l) => S.load[l].rows === live[l].rows && S.load[l].labels === live[l].labels && S.load[l].bytes === live[l].bytes),
    S ? ['ESL', 'FSL'].map((l) => `${l} ${S.load[l].rows}/${S.load[l].labels}/${S.load[l].bytes}`).join(', ') : 'no result');
  const syn = S && Array.isArray(S.predict) ? S.predict.filter((p) => p.name === 'synthetic') : [];
  check('stop rule (?stopms=1): first synthetic size runs, the next is skipped',
    !!S && S.stopMs === 1 && syn.length === 2 && !syn[0].skipped && isNum(syn[0].plain && syn[0].plain.median) &&
      typeof syn[1].skipped === 'string' && !syn[1].plain,
    syn.map((p) => `${p.rows}: ${p.skipped ? 'skipped (' + p.skipped + ')' : 'ran'}`).join('; '));
  const errs2 = chrome.getConsoleErrors(), exc2 = chrome.getExceptions();
  check('0 console errors / exceptions after the stop-rule run', errs2.length === 0 && exc2.length === 0);
  const dbs2 = await chrome.evaluate('(async () => (await indexedDB.databases()).map((d) => d.name))()');
  check('still no sining_kamay_models / sk_bench_models after the stop-rule run', !dbs2.includes('sining_kamay_models') && !dbs2.includes('sk_bench_models'), JSON.stringify(dbs2));
  const ls2 = await chrome.evaluate('localStorage.length');
  check('localStorage still empty after the stop-rule run', ls2 === 0, String(ls2));
} catch (e) {
  check('check ran to the end', false, e.message);
} finally {
  await chrome.close();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log('');
console.log(failures ? `FAILED (${failures} failures)` : 'ALL PASS (0 failures)');
if (failures) process.exitCode = 1;
