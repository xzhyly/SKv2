// Check for Task 4 of the compact-model phase: js/knn-model-store.js (window.KnnModelStore) in a
// real headless Chrome against Apache (http://localhost/SKR/), with real HEAD/GET, real ETags and
// a real IndexedDB.
//
// Builds model files in node from the FROZEN fixture (tests/compact-model/fixtures/, never live
// saved_gestures/) with js/knn-compile.js buildModel + encode, writes them into a temp folder
// tests/compact-model/.tmp-store-* (served by Apache through the repo junction; deleted at the end,
// also on failure; nothing is written to models/), and drives tests/compact-model/store.page.html
// over CDP (tests/video-capture/cdp.mjs) with opts.url pointing into that folder and a dbName of
// its own, so a real kiosk cache (sining_kamay_models) is never touched.
//
// Checks (brief .git/sdd/cm-task-4-brief.md, numbered as there; extras marked X):
//   X0 a bad lang rejects without any request
//    1 cold ESL load: one HEAD + one GET, source network, 2,047 rows / 122 labels, rows equal
//      (Math.fround) to the node-built model, entry stored
//    2 reload + load: exactly one HEAD, no GET, source cache, same model
//    3 FSL too: 1,414 rows / 90 labels, both entries stored; reload: both from cache
//    4 replaced ESL file (one label dropped) -> network, the new model, entry replaced
//    5 corrupt file (bad magic; truncated) with a stored copy -> cache-fallback, stored model,
//      exactly one console.warn each, stored copy not overwritten
//    6 404 with a stored copy -> cache-fallback; without one -> rejects with a clear message
//    7 corrupt stored entry + good file -> network, entry replaced (next load: cache)
//    8 empty-dataset model (0 labels) loads, labels []
//   X1 server without ETag (.htaccess FileETag None): Content-Length + Last-Modified are compared
//   X2 IndexedDB throwing: network-only, exactly one console.warn, info().available false
//   X3 no opts.url: the request goes to the page-relative models/knn_<LANG>.bin (read only)
//    9 no request to any URL except the model files and the page's own files
//   10 cold and warm load ms for the fixture ESL file, 3 runs each (printed)
//   11 0 console errors and 0 uncaught exceptions; warnings counted against the expected number
//
// Run: node tests/compact-model/store-check.mjs   (non-zero exit on any FAIL)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../video-capture/cdp.mjs';
import { loadFixtureListing, loadToRows, loadKnnCompile } from './fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9401; // not 9333 (the video-capture checks' default)
const ORIGIN = 'http://localhost';
const PAGE_URL = `${ORIGIN}/SKR/tests/compact-model/store.page.html`;
const BUILD_DATE = '2026-10-15T00:00:00.000Z';

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`);
  }
}

const K = loadKnnCompile();
const toRows = loadToRows();
const listing = loadFixtureListing();

async function buildFile(lang, src) {
  const b = K.buildModel({
    gestures: src.gestures,
    signs: src.signs,
    categories: src.categories,
    lang,
    toRows,
    buildDate: BUILD_DATE,
  });
  b.header.fingerprint = await K.sha256Hex(b.fingerprintText);
  return { built: b, buf: Buffer.from(K.encode(b.header, b.model)) };
}

// Every page row value must be exactly the Float32 of the node-built value, in header order.
function rowsMatch(pageRows, built) {
  const keys = built.header.labels.map((L) => L.key);
  if (pageRows.length !== keys.length) return `label count ${pageRows.length} != ${keys.length}`;
  for (let i = 0; i < keys.length; i++) {
    const want = built.model[keys[i]];
    const got = pageRows[i];
    if (got.length !== want.length) return `label ${keys[i]}: ${got.length} rows != ${want.length}`;
    for (let r = 0; r < want.length; r++) {
      if (got[r].length !== 126) return `label ${keys[i]} row ${r}: ${got[r].length} values`;
      for (let j = 0; j < 126; j++) {
        if (got[r][j] !== Math.fround(want[r][j])) return `label ${keys[i]} row ${r} value ${j}: ${got[r][j]} != ${Math.fround(want[r][j])}`;
      }
    }
  }
  return null;
}

async function main() {
  console.log('--- building model files from the frozen fixture ---');
  const esl = await buildFile('ESL', listing);
  const fsl = await buildFile('FSL', listing);
  // A different valid ESL file: the first label (sorted) dropped from the listing.
  const dropped = Object.keys(listing.gestures).sort().find((k) => k !== 'start' && k !== 'stop');
  const variantGestures = { ...listing.gestures };
  delete variantGestures[dropped];
  const variant = await buildFile('ESL', { ...listing, gestures: variantGestures });
  const empty = await buildFile('ESL', { gestures: {}, signs: {}, categories: {} });
  const badMagic = Buffer.from(esl.buf);
  badMagic.write('XXXX', 0, 'latin1');
  const truncated = esl.buf.subarray(0, Math.floor(esl.buf.length / 2));
  console.log(`  ESL ${esl.buf.length} bytes (${esl.built.header.rowCount} rows / ${esl.built.header.labels.length} labels)`);
  console.log(`  FSL ${fsl.buf.length} bytes (${fsl.built.header.rowCount} rows / ${fsl.built.header.labels.length} labels)`);
  console.log(`  ESL without "${dropped}": ${variant.buf.length} bytes (${variant.built.header.labels.length} labels)`);
  console.log(`  empty ESL: ${empty.buf.length} bytes (${empty.built.header.labels.length} labels)`);

  const tmpDir = mkdtempSync(path.join(__dirname, '.tmp-store-'));
  const tmpUrl = `tests/compact-model/${path.basename(tmpDir)}`; // page-relative (base /SKR/)
  const tmpAbs = `${ORIGIN}/SKR/${tmpUrl}/`;
  const file = (name) => path.join(tmpDir, name);
  const ESL_URL = `${tmpUrl}/knn_ESL.bin`;
  const FSL_URL = `${tmpUrl}/knn_FSL.bin`;
  const runId = `${process.pid}_${Date.now()}`;
  const DB = `sk_store_check_${runId}`;
  const dbNames = [DB];
  writeFileSync(file('knn_ESL.bin'), esl.buf);
  writeFileSync(file('knn_FSL.bin'), fsl.buf);
  mkdirSync(file('empty'));
  writeFileSync(file('empty/knn_ESL.bin'), empty.buf);
  mkdirSync(file('noetag'));
  writeFileSync(file('noetag/.htaccess'), 'FileETag None\n');
  writeFileSync(file('noetag/knn_ESL.bin'), esl.buf);

  let chrome = null;
  let expectedWarns = 0;
  let seenWarns = 0;
  try {
    chrome = await launchChrome({ port: PORT });
    await chrome.enableNetwork();
    await chrome.navigate(PAGE_URL);

    const ev = (expr) => chrome.evaluate(expr);
    const J = JSON.stringify;
    const load = (lang, url, db = DB, withRows = false) => ev(`window.runLoad(${J(lang)}, ${J(url)}, ${J(db)}, ${J(withRows)})`);
    const info = (db = DB) => ev(`window.storedInfo(${J(db)})`);
    const reqMark = () => chrome.getNetworkRequests().length;
    const reqsSince = (mark, url) =>
      chrome
        .getNetworkRequests()
        .slice(mark)
        .filter((r) => !url || r.url === ORIGIN + '/SKR/' + url)
        .map((r) => r.method);
    // Warnings since the last call; asserts the number this step expects.
    async function warnsIs(n, label, mustMatch) {
      const w = await ev('window.takeWarns()');
      seenWarns += w.length;
      expectedWarns += n;
      const okText = !mustMatch || w.every((t) => mustMatch.test(t));
      check(`${label}: ${n} console.warn`, w.length === n && okText, w.length ? J(w) : '');
      return w;
    }
    async function reload() {
      await chrome.navigate(PAGE_URL);
      const ready = await ev('!!(window.KnnModelStore && window.KnnCompile && window.runLoad)');
      if (!ready) throw new Error('store.page.html did not load its scripts');
    }

    console.log('\n--- X0 bad lang ---');
    let m = reqMark();
    let r = await load('XYZ', ESL_URL);
    check('load("XYZ") rejects', !r.ok && /lang must be ESL or FSL/.test(r.error), r.error);
    check('no request made', reqsSince(m).length === 0, J(reqsSince(m)));
    await warnsIs(0, 'X0');

    console.log('\n--- 1 cold ESL load ---');
    m = reqMark();
    r = await load('ESL', ESL_URL, DB, true);
    check('loaded', r.ok, r.error);
    check('one HEAD + one GET to the file', J(reqsSince(m, ESL_URL)) === J(['HEAD', 'GET']), J(reqsSince(m, ESL_URL)));
    check('source network', r.source === 'network', r.source);
    check('2,047 rows / 122 labels', r.rowCount === 2047 && r.modelRowCount === 2047 && r.labels.length === 122, `${r.rowCount}/${r.modelRowCount}/${r.labels && r.labels.length}`);
    check('labels in header order', J(r.labels) === J(esl.built.header.labels.map((L) => L.key)));
    check('rows are plain Arrays of 126', r.rowsArePlainArrays === true);
    const mm1 = rowsMatch(r.rows, esl.built);
    check('rows === Math.fround(node-built rows)', mm1 === null, mm1);
    check('bytes = file size', r.bytes === esl.buf.length, `${r.bytes}`);
    let inf = await info();
    check('IndexedDB has the ESL entry', inf.available && inf.ESL && inf.ESL.bytes === esl.buf.length && inf.ESL.length === esl.buf.length && !!inf.ESL.etag && !!inf.ESL.savedAt, J(inf.ESL));
    check('etag returned = etag stored', r.etag === inf.ESL.etag, r.etag);
    check('no FSL entry yet', inf.FSL === null);
    const eslEtag1 = r.etag;
    const firstPageMs = [Math.round(r.ms)];
    await warnsIs(0, '1');

    console.log('\n--- 2 reload, warm ESL load ---');
    await reload();
    m = reqMark();
    r = await load('ESL', ESL_URL, DB, true);
    check('loaded', r.ok, r.error);
    check('exactly one HEAD, no GET', J(reqsSince(m, ESL_URL)) === J(['HEAD']), J(reqsSince(m, ESL_URL)));
    check('source cache', r.source === 'cache', r.source);
    const mm2 = rowsMatch(r.rows, esl.built);
    check('same model (rows === Math.fround(node-built))', mm2 === null && r.labels.length === 122, mm2);
    check('same etag (W/ prefix aside)', String(r.etag).replace(/^W\//, '') === String(eslEtag1).replace(/^W\//, ''), `${eslEtag1} -> ${r.etag}`);
    firstPageMs.push(Math.round(r.ms));
    await warnsIs(0, '2');

    console.log('\n--- 3 FSL too ---');
    m = reqMark();
    r = await load('FSL', FSL_URL, DB, true);
    check('FSL loaded from network', r.ok && r.source === 'network', r.error || r.source);
    check('one HEAD + one GET to the FSL file', J(reqsSince(m, FSL_URL)) === J(['HEAD', 'GET']), J(reqsSince(m, FSL_URL)));
    check('1,414 rows / 90 labels', r.rowCount === 1414 && r.labels.length === 90, `${r.rowCount}/${r.labels && r.labels.length}`);
    const mm3 = rowsMatch(r.rows, fsl.built);
    check('FSL rows === Math.fround(node-built rows)', mm3 === null, mm3);
    inf = await info();
    check('both entries stored', inf.ESL && inf.FSL && inf.ESL.bytes === esl.buf.length && inf.FSL.bytes === fsl.buf.length, J(inf));
    await reload();
    m = reqMark();
    const rE = await load('ESL', ESL_URL);
    const rF = await load('FSL', FSL_URL);
    check('after reload ESL from cache', rE.ok && rE.source === 'cache' && rE.labels.length === 122, rE.error || rE.source);
    check('after reload FSL from cache', rF.ok && rF.source === 'cache' && rF.labels.length === 90, rF.error || rF.source);
    check('only one HEAD each, no GET', J(reqsSince(m, ESL_URL)) === J(['HEAD']) && J(reqsSince(m, FSL_URL)) === J(['HEAD']), J(reqsSince(m)));
    await warnsIs(0, '3');

    console.log('\n--- 4 replaced ESL file ---');
    writeFileSync(file('knn_ESL.bin'), variant.buf);
    m = reqMark();
    r = await load('ESL', ESL_URL, DB, true);
    check('downloaded (network)', r.ok && r.source === 'network', r.error || r.source);
    check('one HEAD + one GET', J(reqsSince(m, ESL_URL)) === J(['HEAD', 'GET']), J(reqsSince(m, ESL_URL)));
    check(`new model: 121 labels, "${dropped}" gone`, r.labels.length === 121 && !r.labels.includes(dropped), `${r.labels.length}`);
    const mm4 = rowsMatch(r.rows, variant.built);
    check('rows === Math.fround(new node-built rows)', mm4 === null, mm4);
    inf = await info();
    check('entry replaced (new size, new etag)', inf.ESL.bytes === variant.buf.length && inf.ESL.etag !== eslEtag1 && inf.ESL.etag === r.etag, J(inf.ESL));
    let variantEntry = inf.ESL;
    await warnsIs(0, '4');
    // Apache marks the ETag weak (W/"...") while the file is less than a second old and strong
    // later; the store must treat both as the same file (no second download).
    const storedWeak = String(variantEntry.etag).startsWith('W/');
    await reload(); // >= 1.5 s later (cdp.mjs navigate)
    const later = await fetch(ORIGIN + '/SKR/' + ESL_URL, { method: 'HEAD' });
    const laterEtag = later.headers.get('etag');
    m = reqMark();
    r = await load('ESL', ESL_URL);
    check('later load (ETag weak then strong, same file): cache, one HEAD', r.ok && r.source === 'cache' && J(reqsSince(m, ESL_URL)) === J(['HEAD']), `${r.error || r.source}; stored ${variantEntry.etag}, now ${laterEtag}`);
    console.log(`  info  weak->strong ETag path ${storedWeak && !String(laterEtag).startsWith('W/') ? 'exercised' : 'NOT exercised this run (timing)'}`);
    await warnsIs(0, '4 later');

    console.log('\n--- 5 corrupt file with a stored copy ---');
    for (const [name, buf, re] of [
      ['bad magic', badMagic, /bad magic/],
      ['truncated', truncated, /body is \d+ bytes|runs past the end/],
    ]) {
      writeFileSync(file('knn_ESL.bin'), buf);
      m = reqMark();
      r = await load('ESL', ESL_URL);
      check(`${name}: cache-fallback`, r.ok && r.source === 'cache-fallback', r.error || r.source);
      check(`${name}: HEAD + GET made`, J(reqsSince(m, ESL_URL)) === J(['HEAD', 'GET']), J(reqsSince(m, ESL_URL)));
      check(`${name}: the stored model (121 labels)`, r.labels.length === 121 && r.etag === variantEntry.etag, `${r.labels.length}`);
      await warnsIs(1, `5 ${name}`, re);
      inf = await info();
      check(`${name}: stored copy not overwritten`, J(inf.ESL) === J(variantEntry), J(inf.ESL));
    }

    console.log('\n--- 6 file deleted (404) ---');
    unlinkSync(file('knn_ESL.bin'));
    m = reqMark();
    r = await load('ESL', ESL_URL);
    check('with stored copy: cache-fallback', r.ok && r.source === 'cache-fallback' && r.labels.length === 121, r.error || r.source);
    check('only the HEAD (no GET after a failed HEAD)', J(reqsSince(m, ESL_URL)) === J(['HEAD']), J(reqsSince(m, ESL_URL)));
    await warnsIs(1, '6 with stored copy', /404/);
    const removed = await ev(`window.removeStored('ESL', ${J(DB)})`);
    inf = await info();
    check('remove() deleted the ESL entry, FSL kept', removed === true && inf.ESL === null && inf.FSL !== null, J(inf));
    r = await load('ESL', ESL_URL);
    check('without stored copy: rejects', !r.ok, r.source);
    check('rejection says what failed', /ESL model unavailable: HEAD .*knn_ESL\.bin returned 404; no stored copy/.test(r.error || ''), r.error);
    await warnsIs(0, '6 without stored copy');

    console.log('\n--- 7 corrupt stored entry + good file ---');
    writeFileSync(file('knn_ESL.bin'), esl.buf);
    r = await load('ESL', ESL_URL);
    check('good file stored (network)', r.ok && r.source === 'network', r.error || r.source);
    const etagBefore = await ev(`window.corruptStored('ESL', ${J(DB)}, 64)`);
    inf = await info();
    check('stored buffer corrupted (64 bytes, same etag)', inf.ESL.bytes === 64 && inf.ESL.etag === etagBefore);
    m = reqMark();
    r = await load('ESL', ESL_URL, DB, true);
    check('source network', r.ok && r.source === 'network', r.error || r.source);
    check('HEAD (matched the corrupt copy) then GET', J(reqsSince(m, ESL_URL)) === J(['HEAD', 'GET']), J(reqsSince(m, ESL_URL)));
    check('model correct', r.labels.length === 122 && rowsMatch(r.rows, esl.built) === null);
    await warnsIs(1, '7', /does not decode/);
    inf = await info();
    check('entry replaced', inf.ESL.bytes === esl.buf.length, J(inf.ESL));
    r = await load('ESL', ESL_URL);
    check('next load from cache', r.ok && r.source === 'cache', r.error || r.source);
    await warnsIs(0, '7 next load');

    console.log('\n--- 8 empty-dataset model ---');
    const DB_EMPTY = `sk_store_check_empty_${runId}`;
    dbNames.push(DB_EMPTY);
    r = await load('ESL', `${tmpUrl}/empty/knn_ESL.bin`, DB_EMPTY);
    check('loads without throwing, labels []', r.ok && J(r.labels) === '[]' && r.rowCount === 0 && r.source === 'network', r.error || J(r.labels));
    r = await load('ESL', `${tmpUrl}/empty/knn_ESL.bin`, DB_EMPTY);
    check('again from cache, labels []', r.ok && r.source === 'cache' && J(r.labels) === '[]', r.error || r.source);
    await warnsIs(0, '8');

    console.log('\n--- X1 server without ETag ---');
    const NOETAG_URL = `${tmpUrl}/noetag/knn_ESL.bin`;
    const head = await fetch(ORIGIN + '/SKR/' + NOETAG_URL, { method: 'HEAD' });
    const hasEtag = head.headers.get('etag');
    const hasLm = head.headers.get('last-modified');
    check('Apache honours the .htaccess (no ETag, has Last-Modified)', head.ok && !hasEtag && !!hasLm, `etag=${hasEtag} last-modified=${hasLm}`);
    const DB_NOETAG = `sk_store_check_noetag_${runId}`;
    dbNames.push(DB_NOETAG);
    m = reqMark();
    r = await load('ESL', NOETAG_URL, DB_NOETAG);
    check('cold: network', r.ok && r.source === 'network' && r.etag === null, r.error || r.source);
    inf = await info(DB_NOETAG);
    check('stored with lastModified and length, etag null', inf.ESL && inf.ESL.etag === null && inf.ESL.lastModified === hasLm && inf.ESL.length === esl.buf.length, J(inf.ESL));
    await reload();
    m = reqMark();
    r = await load('ESL', NOETAG_URL, DB_NOETAG);
    check('warm: cache with one HEAD only', r.ok && r.source === 'cache' && J(reqsSince(m, NOETAG_URL)) === J(['HEAD']), (r.error || r.source) + ' ' + J(reqsSince(m, NOETAG_URL)));
    writeFileSync(file('noetag/knn_ESL.bin'), variant.buf);
    m = reqMark();
    r = await load('ESL', NOETAG_URL, DB_NOETAG);
    check('replaced file: network, new model', r.ok && r.source === 'network' && r.labels.length === 121 && J(reqsSince(m, NOETAG_URL)) === J(['HEAD', 'GET']), (r.error || r.source) + ' ' + J(reqsSince(m, NOETAG_URL)));
    await warnsIs(0, 'X1');

    console.log('\n--- X2 IndexedDB throwing ---');
    check('window.indexedDB now throws', (await ev('window.breakIndexedDB()')) === true);
    m = reqMark();
    r = await load('ESL', ESL_URL, DB, true);
    check('loads network-only', r.ok && r.source === 'network' && r.labels.length === 122 && rowsMatch(r.rows, esl.built) === null, r.error || r.source);
    check('HEAD + GET', J(reqsSince(m, ESL_URL)) === J(['HEAD', 'GET']), J(reqsSince(m, ESL_URL)));
    await warnsIs(1, 'X2 load', /IndexedDB open failed/);
    inf = await info();
    check('info() resolves with available: false', inf.available === false && inf.ESL === null, J(inf));
    await warnsIs(1, 'X2 info', /IndexedDB open failed/);
    check('indexedDB restored', (await ev('window.restoreIndexedDB()')) === true);
    inf = await info();
    check('stored entries untouched by the network-only load', inf.available && inf.ESL && inf.ESL.bytes === esl.buf.length);
    await warnsIs(0, 'X2 after restore');

    console.log('\n--- X3 default url (no opts.url) ---');
    const DB_DEFAULT = `sk_store_check_default_${runId}`;
    dbNames.push(DB_DEFAULT);
    m = reqMark();
    r = await load('FSL', null, DB_DEFAULT);
    const defReqs = chrome.getNetworkRequests().slice(m).map((q) => q.url);
    check('requested only /SKR/models/knn_FSL.bin', defReqs.length >= 1 && defReqs.every((u) => u === `${ORIGIN}/SKR/models/knn_FSL.bin`), J(defReqs));
    console.log(`  info  default-url load result: ${r.ok ? 'loaded, source ' + r.source : 'rejected: ' + r.error}`);
    await ev('window.takeWarns()'); // a real models/ file may or may not exist; not counted

    console.log('\n--- 10 timings (fixture ESL file, this machine, shared with parallel work) ---');
    const DB_T = `sk_store_check_timing_${runId}`;
    dbNames.push(DB_T);
    const cold = [];
    const warm = [];
    for (let i = 0; i < 3; i++) {
      await ev(`window.removeStored('ESL', ${J(DB_T)})`);
      const c = await load('ESL', ESL_URL, DB_T);
      const w = await load('ESL', ESL_URL, DB_T);
      check(`run ${i + 1}: cold network, warm cache`, c.ok && c.source === 'network' && w.ok && w.source === 'cache', `${c.source}/${w.source}`);
      cold.push(Math.round(c.ms));
      warm.push(Math.round(w.ms));
    }
    console.log(`  cold (HEAD + GET + decode + store) ms: ${cold.join(', ')}`);
    console.log(`  warm (HEAD + IndexedDB read + decode) ms: ${warm.join(', ')}`);
    console.log(`  first load in a fresh page (check 1 cold incl. rows copy-out, check 2 warm): ${firstPageMs.join(', ')} ms`);
    await warnsIs(0, '10');

    console.log('\n--- 9 requests ---');
    const allowed = new Set([
      PAGE_URL,
      `${ORIGIN}/SKR/js/knn-compile.js`,
      `${ORIGIN}/SKR/js/knn-model-store.js`,
      `${ORIGIN}/SKR/models/knn_FSL.bin`, // X3 only
    ]);
    const all = chrome.getNetworkRequests();
    const other = all.filter((q) => !allowed.has(q.url) && !q.url.startsWith(tmpAbs));
    check('no request outside the page, its two scripts and the model files', other.length === 0, other.length ? J(other.map((q) => q.method + ' ' + q.url)) : `${all.length} requests`);
    check('every request was HEAD or GET', all.every((q) => q.method === 'HEAD' || q.method === 'GET'));

    console.log('\n--- 11 console ---');
    const errors = chrome.getConsoleErrors();
    const exceptions = chrome.getExceptions();
    check('0 console errors', errors.length === 0, J(errors));
    check('0 uncaught exceptions', exceptions.length === 0, J(exceptions));
    check(`console.warn count ${seenWarns} = expected ${expectedWarns}`, seenWarns === expectedWarns);
  } catch (e) {
    failures++;
    console.log(`  FAIL  check aborted: ${e && e.stack ? e.stack : e}`);
  } finally {
    if (chrome) {
      for (const db of dbNames) {
        try {
          await chrome.evaluate(`window.deleteDb(${JSON.stringify(db)})`);
        } catch {}
      }
      await chrome.close();
    }
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exitCode = failures ? 1 : 0;
}

main();
