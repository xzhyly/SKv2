// bulk-import.html, steps Review and Import (2026-10-14), end to end in headless Chrome
// (tests/video-capture/cdp.mjs) at 1366x768, with every non-localhost hostname blocked.
// The folder is tests/bulk-import/folder.mjs's (7 synthetic zz_ videos, 2 signers, one
// 2-repetition video, one bad file name, one junk file) plus three hand-made copies of one video:
//   ESL_zz_bulk_clash_P01.webm     its sign exists as FSL before the review      -> "exists as FSL"
//   ESL_zz_bulk_late_P01.webm      its sign is made FSL AFTER the review, before Import -> HTTP 409
//   ESL_ZZ_Bulk Niño_P01.webm      label "ZZ_Bulk Niño" -> key "zz_bulk_nio"
// Signs made beforehand (zz_ only): zz_bulk_two (ESL, a custom text, one sample), zz_bulk_clash
// (FSL) and zz_bulk_empty (a gestures row with no sample: the imbalance warning's small sign).
//   1  Review statuses, the filters, the New signs block.      2  Nothing written before Import.
//   3  Projection (rows per model against a count made here, k-NN time).
//   4  Import: the sample files, DB rows, sign.json, edited / draft / kept texts, the 409.
//   5  The samples load like live ones.   6  The model labels cache is dropped.
//   7  The 2-repetition video (through a server error + Resume); a forced re-import: duplicates.
//   8  Reload: "already imported".        9  P02 added to the recognition list: no extraction.
//   10 Summary + imbalance warning.       11 Layout.
//   11b A second folder (BOTH_zz_bulk_both_P01.webm, FSL_zz_bulk_fsl_P01.webm): BOTH / FSL signs end
//      to end; a save whose answer is lost (the request reaches the server, the page sees a network
//      failure) -> Resume -> "duplicate", the sign is still listed as created and its edited text
//      stored; the edited text is stored right after the first sample, so a reload in the middle
//      of the run loses nothing; extraction and import exclude each other.
//   12 Set clash, hostile names.          13 Network, console.
// The projected knnPredict time is compared with the kiosk's REAL function: its text is read from
// js/sign-to-text-ui.js here and run in the page inside a new Function (test only, never a global).
// Cleanup: every zz_ sign (folder + DB rows), this check's cache videos, the temp folder.
// Run (Apache + MariaDB up, no other node test running): node tests/bulk-import/import-flow-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { launchChrome } from '../video-capture/cdp.mjs';
import { callApi, save, signsApi, cleanZz, dir, samples, signJson, sql, row, liveCounts, saved } from '../sign-texts/api-helper.mjs';
import { buildTestFolder, videoIdOf, REPO_ROOT, TWO_REPS_KEY } from './folder.mjs';

const require = createRequire(import.meta.url);
const Core = require('../../js/bulk-import-core.js');

const PAGE = 'http://localhost/SKR/bulk-import.html';
const SHOTS = (process.argv.find((a) => a.startsWith('--shots=')) || '').slice(8);   // optional: a folder for screenshots
const CACHE = path.join(REPO_ROOT, 'bulk_import_cache');
const NOT_USED = 'not used for recognition (result kept in the cache)';
const REMINDER = 'Now run Compile (Train AI) on Train Gestures for ESL and for FSL.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

const api = (body) => callApi('bulk_import.php', { body });
const apiGet = (query) => callApi('bulk_import.php', { method: 'GET', query });
const index = () => apiGet('action=index').json.videos;
const handsFile = (id) => path.join(CACHE, 'videos', id + '.hands.json');
const hands = (v) => JSON.parse(fs.readFileSync(handsFile(v.id), 'utf8'));
const importId = (v, repIndex) => sha(`${v.name}|${fs.statSync(v.path).size}|${repIndex}`).slice(0, 32);
const sampleName = (v, repIndex) => `sample_i${importId(v, repIndex)}.json`;
const handFrames = (frames) => frames.filter((f) => f.hands.length > 0).length;

// Every file under root as "relative path|size|sha1" (zz: only / never the zz_ sign folders).
function contentListing(root, { zz }) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (d !== root || e.name.startsWith('zz_') === zz) walk(p); continue; }
      if (d === root && zz) continue;
      out.push(`${path.relative(root, p)}|${fs.statSync(p).size}|${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out.sort();
}
const hash = (list) => sha(list.join('\n'));
const zzFolders = () => fs.readdirSync(saved).filter((d) => d.startsWith('zz_')).sort();

// ── the folder ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-import-flow-'));
const folder = buildTestFolder(path.join(tmp, 'videos'));
const source = folder.videos.find((v) => v.name === 'ESL_zz_bulk_one_P01.webm');
const copyOf = (name, key, i, d = folder.dir) => {
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, name);
  fs.copyFileSync(source.path, p);
  const t = new Date(Date.UTC(2026, 9, 14, 0, 0, i));
  fs.utimesSync(p, t, t);
  return { name, path: p, kind: 'video', set: name.split('_')[0], key, signer: 'P01', reps: 3, id: videoIdOf(p) };
};
const dirB = path.join(tmp, 'videos2');              // the second folder (section 11b)
const both = copyOf('BOTH_zz_bulk_both_P01.webm', 'zz_bulk_both', 3, dirB);
const fsl = copyOf('FSL_zz_bulk_fsl_P01.webm', 'zz_bulk_fsl', 4, dirB);
const clash = copyOf('ESL_zz_bulk_clash_P01.webm', 'zz_bulk_clash', 0);
const late = copyOf('ESL_zz_bulk_late_P01.webm', 'zz_bulk_late', 1);
const nio = copyOf('ESL_ZZ_Bulk Niño_P01.webm', 'zz_bulk_nio', 2);
const videos = folder.videos.concat([clash, late, nio]).sort((a, b) => (a.name < b.name ? -1 : 1));
const byName = (name) => videos.find((v) => v.name === name);
const one1 = byName('ESL_zz_bulk_one_P01.webm'), one2 = byName('ESL_zz_bulk_one_P02.webm');
const two1 = byName('ESL_zz_bulk_two_P01.webm'), two2 = byName('ESL_zz_bulk_two_P02.webm');
const three1 = byName('ESL_zz_bulk_three_P01.webm'), three2 = byName('ESL_zz_bulk_three_P02.webm');
const tworeps = byName(`ESL_${TWO_REPS_KEY}_P01.webm`);
const IDS = videos.map((v) => v.id).concat([both.id, fsl.id]);
const KEYS = [...new Set(videos.map((v) => v.key))].sort().concat([both.key, fsl.key]);
// The kiosk's cosineSimilarity + knnPredict, as text (js/sign-to-text-ui.js:193-243).
const kioskText = (() => {
  const lines = fs.readFileSync(path.join(REPO_ROOT, 'js', 'sign-to-text-ui.js'), 'utf8').split(/\r?\n/);
  return lines.slice(lines.findIndex((l) => l.startsWith('function cosineSimilarity')), lines.findIndex((l) => l.startsWith('function loadKnnFromCache'))).join('\n');
})();
// The rows each kiosk model holds, counted here from the saved samples: a sign's rows are in the
// ESL model when its set is ESL or BOTH, in the FSL model when FSL or BOTH; "start" and "stop"
// are in both (js/sign-to-text-ui.js:118). -> { rows: {ESL, FSL}, labels: {ESL, FSL} }
const countModels = () => {
  const listing = callApi('save_gesture.php', { method: 'GET', query: 'no_sync=1' }).json;
  const signsNow = signsApi({ method: 'GET' }).json.signs;
  const rows = { ESL: 0, FSL: 0 }, labels = { ESL: 0, FSL: 0 };
  for (const [label, list] of Object.entries(listing.gestures)) {
    const set = (signsNow[label] || listing.signs[label]).set, control = label === 'start' || label === 'stop';
    let n = 0;
    for (const smp of list) n += smp.frames.some((f) => Array.isArray(f && f.hands)) ? Math.min(30, handFrames(smp.frames)) : smp.frames.length;
    if (set !== 'FSL' || control) { rows.ESL += n; if (n) labels.ESL++; }
    if (set !== 'ESL' || control) { rows.FSL += n; if (n) labels.FSL++; }
  }
  return { rows, labels };
};
const cleanCache = () => {
  for (const id of IDS) api({ action: 'delete_video', id });
  for (const key of KEYS) api({ action: 'delete_candidates', key });
};

// ── before anything runs ──
cleanZz();                                           // leftovers of a crashed earlier run
cleanCache();
const othersBefore = hash(contentListing(saved, { zz: false }));
const dbBefore = liveCounts();
const first = save({ label: 'zz_bulk_two', sign_language: 'ESL' });
const custom = signsApi({ body: { action: 'update', key: 'zz_bulk_two', set: 'ESL', textEn: 'Zz custom two' } });
const second = save({ label: 'zz_bulk_clash', sign_language: 'FSL' });
sql(`INSERT INTO gestures (label, sign_language, text_en, text_fil, category) VALUES ('zz_bulk_empty', 'ESL', 'Zz bulk empty', NULL, 'word')`);
check('set-up: zz_bulk_two (ESL, custom text), zz_bulk_clash (FSL) and the sample-less zz_bulk_empty exist', first.status === 200 && custom.status === 200 && second.status === 200
  && signJson('zz_bulk_two').textEn === 'Zz custom two' && signJson('zz_bulk_clash').set === 'FSL' && signsApi({ method: 'GET' }).json.signs.zz_bulk_empty.samples === 0);
const zzBefore = hash(contentListing(saved, { zz: true }));
const dbSetUp = liveCounts();

const c = await launchChrome({ port: 9482, width: 1366, height: 768, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const ev = (e) => c.evaluate(e);
const waitFor = async (expr, ms = 20000, step = 200) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(step); } return false; };
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
const S = 'BulkImport.state';
const click = (id) => ev(`document.getElementById('${id}').click(); 1`);
const pickFolder = async (d = folder.dir, n = videos.length) => {
  const doc = await c.send('DOM.getDocument', {});
  const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#bi-folder' });
  await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [d] });
  return waitFor(`${S}.videos.length === ${n} && !${S}.folder.loading && ${S}.cacheLoaded && /^Found ${n} videos/.test(document.getElementById('bi-status').textContent)`, 15000, 50);
};
const knnReady = () => waitFor(`${S}.review.projection && ${S}.review.projection.knn.status === 'ready'`, 60000, 100);
// The kiosk's real knnPredict, timed in the page on the page's own made-up model of that size
// (median of 9 warm runs, each long enough for the clock). Test only: the text is compiled inside
// a new Function, nothing is added to the page's globals.
const realMs = (labels, rows) => ev(`(async () => { const real = new Function('knnModel', 'features', ${J(kioskText)} + '\\nreturn knnPredict(features);');
  const syn = BulkImport.knnSynthetic(${labels}, ${rows}); for (let i = 0; i < 5; i++) real(syn.model, syn.features);
  let t0 = performance.now(); const out = real(syn.model, syn.features); if (!out || typeof out.label !== 'string') throw new Error('the real knnPredict returned nothing');
  const reps = Math.max(1, Math.min(200, Math.ceil(20 / Math.max(performance.now() - t0, 0.1)))), times = [];
  for (let i = 0; i < 9; i++) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); for (let k = 0; k < reps; k++) real(syn.model, syn.features); times.push((performance.now() - t0) / reps); }
  times.sort((a, b) => a - b); return times[4]; })()`);
const openPage = async () => {
  await c.navigate(PAGE);
  await ev(`sessionStorage.setItem('sk_train_unlocked', String(Date.now())); location.reload(); 1`);
  await sleep(1500);
  return waitFor(`!!window.BulkImport && document.getElementById('bi-ui').classList.contains('active') && ${S}.engines === 'ready'`, 60000);
};
const openReview = async () => {
  await click('bi-tab-review');
  return waitFor(`${S}.step === 'review' && ${S}.review.status === 'ready'`, 30000, 100);
};
const review = () => ev(`(() => { const R = ${S}.review; return { status: R.status, blocked: R.blocked, toImport: R.toImport, projection: R.projection, filter: R.filter,
  rows: R.rows.map(r => ({ id: r.id, name: r.name, kind: r.kind, text: r.text, enabled: r.enabled, checked: r.checked, isNew: r.isNew, newSign: r.newSign, problem: r.problem, key: r.key, label: r.label, set: r.set, signer: r.signer, reps: r.reps, add: r.addReps.length, done: r.doneReps })),
  newSigns: R.newSigns.map(s => ({ key: s.key, set: s.set, textEn: s.textEn, textFil: s.textFil, active: s.active })),
  button: document.getElementById('bi-import').textContent, disabled: document.getElementById('bi-import').disabled, note: document.getElementById('bi-import-note').textContent }; })()`);
// The Review table as shown: [file, sign, set, signer, reps, status text, checkbox checked, checkbox disabled, kind].
const table = () => ev(`[...document.querySelectorAll('#bi-review tbody tr')].map(tr => { const b = tr.querySelector('input'); return [tr.children[1].textContent, tr.children[2].textContent, tr.children[3].textContent, tr.children[4].textContent, tr.children[5].textContent, tr.children[6].textContent, b.checked, b.disabled, tr.dataset.kind]; })`);
const importDone = (ms = 120000) => waitFor(`${S}.imp.status === 'done' && ${S}.review.status === 'ready'`, ms, 100);
const summary = () => ev(`BulkImport.lastSummary()`);
const posts = () => c.getNetworkRequests().filter((r) => r.method === 'POST');
const postsTo = (file) => posts().filter((r) => r.url.endsWith('/php/api/' + file)).length;
const R = (rv, v) => rv.rows.find((r) => r.name === v.name);
const dbPaths = () => sql(`SELECT r.sample_path p FROM gesture_recordings r JOIN gestures g ON g.id = r.gesture_id WHERE g.label LIKE 'zz\\_%'`).map((r) => r.p);
// Checks the saved samples of one imported video; -> a list of problems.
const sampleProblems = (v) => {
  const out = [], h = hands(v), paths = dbPaths();
  for (const rep of h.reps) {
    const f = path.join(dir(v.key), sampleName(v, rep.index));
    if (!fs.existsSync(f)) { out.push(`${v.name} rep ${rep.index}: no ${path.basename(f)}`); continue; }
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const bad = (w) => out.push(`${v.name} rep ${rep.index}: ${w}`);
    if (s.formatVersion !== 3 || s.format !== 'mediapipe_hands_raw_v3') bad('format ' + s.format);
    if (s.source !== 'video-import') bad('source ' + s.source);
    if (s.signer !== v.signer) bad('signer ' + s.signer);
    if (s.repIndex !== rep.index) bad('repIndex ' + s.repIndex);
    if (s.importId !== importId(v, rep.index)) bad('importId ' + s.importId);
    if (s.label !== v.key || s.signLanguage !== (v.set === 'FSL' ? 'FSL' : 'ESL')) bad(`label ${s.label} / ${s.signLanguage}`);
    if (s.fps !== 15 || s.videoWidth !== h.meta.videoWidth || s.videoHeight !== h.meta.videoHeight) bad(`fps ${s.fps}, ${s.videoWidth}x${s.videoHeight}`);
    if (J(s.input) !== J(h.meta.input) || !(s.input.contentRect.w > 0)) bad('input ' + J(s.input));
    if (s.frameCount !== rep.frames.length || J(s.frames) !== J(rep.frames)) bad('frames differ from the cached repetition');
    if (!paths.includes(`saved_gestures/${v.key}/${path.basename(f)}`)) bad('no gesture_recordings row');
  }
  return out;
};
const rowsOf = (v) => hands(v).reps.reduce((a, rep) => a + Math.min(30, handFrames(rep.frames)), 0);

try {
  await c.send('Network.enable', { maxPostDataSize: 16 * 1024 * 1024 });

  // ── 0. Extract (recognition [P01], no avatar signer) ──
  check('page open, extractors ready', await openPage());
  check('folder read', await pickFolder(), await ev(`document.getElementById('bi-status').textContent`));
  await ev(`BulkImport.setRecognitionSigners(['P01']); BulkImport.setAvatarSigners([]); 1`);
  const before0 = await review();
  check('before the extraction: every video row is "not extracted yet", disabled; Import is disabled', before0.rows.filter((r) => r.id).every((r) => (r.name === clash.name ? r.kind === 'not-extracted' || r.kind === 'collision' : r.kind === 'not-extracted') && !r.enabled && !r.checked) && before0.disabled, before0.button + ' / ' + before0.note);
  let t0 = Date.now();
  await click('bi-start');
  const ran = await waitFor(`${S}.run.status === 'done'`, 900000, 500);
  const run0 = await ev(`${S}.run.counts`);
  check('extraction finished: every video cached, no avatar clip made', ran && run0.hands === videos.length && run0.failed === 0 && run0.holistic === 0 && videos.every((v) => index()[v.id] && fs.existsSync(handsFile(v.id))), `${((Date.now() - t0) / 1000).toFixed(1)} s, ${J(run0)}`);
  const idx = index();
  check('the synthetic videos have 3 repetitions, the 2-repetition one 2', videos.every((v) => idx[v.id].seg.repsFound === v.reps), videos.map((v) => idx[v.id].seg.repsFound).join(','));
  const postsAfterExtract = posts().length;

  // ── 1. Review ──
  await ev(`localStorage.setItem('sining_kamay_labels_ESL', 'zz-dummy'); localStorage.setItem('sining_kamay_labels_FSL', 'zz-dummy'); 1`);
  check('Review opened: the signs and the saved samples were read', await openReview(), await ev(`${S}.review.status + ' ' + ${S}.review.error`));
  const rv = await review();
  const tb = await table();
  const T = (v) => tb.find((t) => t[0] === 'videos/' + v.name);
  check('one table row per video, plus the bad file name; file-name order', rv.rows.length === videos.length + 1 && tb.length === rv.rows.length && J(rv.rows.map((r) => r.name)) === J(videos.map((v) => v.name).concat(['hello_final.webm']).sort()) && !rv.rows.some((r) => r.name === 'desktop.ini'), `${tb.length} rows`);
  const badRow = rv.rows.find((r) => r.name === 'hello_final.webm'), badT = tb.find((t) => t[0] === 'videos/hello_final.webm');
  check('the bad file name is a problem row, disabled', badRow.kind === 'bad-name' && badRow.problem && !badRow.enabled && badT[5] === 'bad file name' && badT[7] === true && badT[6] === false, J(badT));
  const r2 = R(rv, tworeps), t2 = T(tworeps);
  check('the 2-repetition video is a problem row: enabled, NOT ticked, "import the 2 repetitions found"', r2.kind === 'problem' && r2.problem && r2.enabled && !r2.checked && r2.add === 2 && t2[4] === '2' && t2[6] === false && t2[7] === false
    && t2[5] === 'found 2 repetitions, need 3' + 'new sign' + 'import the 2 repetitions found', J(t2));
  check('P02 rows: "not used for recognition (result kept in the cache)", disabled, not ticked', [one2, two2, three2].every((v) => { const r = R(rv, v), t = T(v); return r.kind === 'not-used' && !r.enabled && !r.checked && !r.problem && t[5] === NOT_USED && t[7] === true && t[6] === false; }), T(one2)[5]);
  check('normal P01 rows of new signs: OK + "new sign", ticked', [one1, three1, late, nio].every((v) => { const r = R(rv, v), t = T(v); return r.kind === 'ok' && r.isNew && r.newSign && r.enabled && r.checked && r.add === 3 && t[5] === 'OKnew sign' && t[6] === true && t[7] === false; }), J(T(one1)));
  check('a sign that exists with the SAME set: OK, not new', (() => { const r = R(rv, two1), t = T(two1); return r.kind === 'ok' && !r.isNew && !r.newSign && r.checked && t[5] === 'OK' && t[6] === true; })(), J(T(two1)));
  check('a sign that exists with ANOTHER set: "exists as FSL", disabled', (() => { const r = R(rv, clash), t = T(clash); return r.kind === 'collision' && r.problem && !r.enabled && !r.checked && t[5] === 'exists as FSL' && t[7] === true && t[6] === false; })(), J(T(clash)));
  check('label and key are both shown when they differ ("ZZ_Bulk Niño → zz_bulk_nio")', T(nio)[1] === 'ZZ_Bulk Niño → zz_bulk_nio' && T(one1)[1] === 'zz_bulk_one' && T(one1)[2] === 'ESL' && T(one1)[3] === 'P01' && T(one1)[4] === '3', T(nio)[1]);
  const news = await ev(`[...document.querySelectorAll('#bi-new-signs .bi-new-row')].map(r => ({ key: r.dataset.key, set: r.querySelector('.bi-new-set').textContent, fields: [...r.querySelectorAll('input')].map(i => [i.dataset.field, i.value, i.maxLength, i.type]), off: r.classList.contains('off') }))`);
  const NEW = ['zz_bulk_late', 'zz_bulk_nio', 'zz_bulk_one', 'zz_bulk_three', TWO_REPS_KEY];
  check('"New signs": one line per new key with its draft English text (max 255), no Filipino field for an ESL sign; a sign nothing is ticked for is dimmed', !(await ev(`document.getElementById('bi-new-card').hidden`)) && J(news.map((n) => n.key)) === J(NEW)
    && news.every((n) => n.set === 'ESL' && J(n.fields) === J([['textEn', Core.draftText(n.key), 255, 'text']]) && n.off === (n.key === TWO_REPS_KEY)) && Core.draftText('zz_bulk_one') === 'Zz bulk one', J(news.map((n) => n.fields[0][1])));
  const shownFor = async (f) => { await ev(`document.querySelector('.bi-filter[data-filter="${f}"]').click(); 1`); return (await table()).map((t) => t[0].replace('videos/', '')); };
  const fProblems = await shownFor('problems'), fNew = await shownFor('new'), fImport = await shownFor('import');
  const counts = await ev(`[...document.querySelectorAll('.bi-filter')].map(b => b.textContent.trim())`);
  const fAll = await shownFor('all');
  check('filters: Problems / New signs / To import / All show the right rows and counts', J(fProblems) === J([clash.name, tworeps.name, 'hello_final.webm'].sort()) && J(fNew) === J([late, nio, one1, three1, tworeps].map((v) => v.name).sort())
    && J(fImport) === J([late, nio, one1, three1, two1].map((v) => v.name).sort()) && fAll.length === videos.length + 1 && J(counts) === J([`All ${videos.length + 1}`, 'Problems 3', 'New signs 5', 'To import 5']), J(counts));
  check('Import button: "Import 5 videos (15 samples)", enabled', rv.button === 'Import 5 videos (15 samples)' && !rv.disabled && rv.blocked === null && rv.toImport.videos === 5 && rv.toImport.samples === 15, rv.button);
  const setText = (key, value, field = 'textEn') => ev(`(() => { const i = document.querySelector('#bi-new-signs input[data-key="${key}"][data-field="${field}"]'); i.value = ${J(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await setText('zz_bulk_three', '   ');
  const empty = await review();
  await setText('zz_bulk_three', 'Zz bulk three');
  await setText(TWO_REPS_KEY, '');
  const emptyOff = await review();
  await setText(TWO_REPS_KEY, 'Zz bulk two reps');
  const refilled = await review();
  check('an empty text of a sign to be created blocks Import with a message; of a sign nothing is ticked for it does not', empty.disabled && /^Type the English text of "zz_bulk_three"/.test(empty.note) && !emptyOff.disabled && emptyOff.note === '' && !refilled.disabled && refilled.note === '', empty.note);
  await shot('bulk-review.png');

  // ── 2. Nothing written before Import ──
  check('before Import: saved_gestures unchanged (content hash of the zz_ signs made in the set-up and of everything else), DB counts unchanged',
    hash(contentListing(saved, { zz: true })) === zzBefore && hash(contentListing(saved, { zz: false })) === othersBefore && liveCounts() === dbSetUp && J(zzFolders()) === J(['zz_bulk_clash', 'zz_bulk_two']), dbSetUp);
  check('before Import: no POST other than the cache writes of the extraction', posts().length === postsAfterExtract && postsTo('save_gesture.php') === 0 && postsTo('signs.php') === 0, `${postsAfterExtract} POSTs`);

  // ── 3. Projection ──
  const counted = countModels(), mine = counted.rows;
  check('knnPredict estimate measured (off the click path)', await knnReady());
  const P = (await review()).projection;
  check('projection: current rows per model equal a count made here from the saved samples, as the kiosk loads them ("start" / "stop" in both models)', J(P.current) === J(mine) && mine.ESL > 0 && J(P.knn.labels.current) === J(counted.labels), `ESL ${P.current.ESL}, FSL ${P.current.FSL} (here: ${J(mine)}); labels ${J(P.knn.labels.current)}`);
  const addedRows = [late, nio, one1, three1, two1].reduce((a, v) => a + idx[v.id].reps.reduce((x, rep) => x + rep.rows, 0), 0);
  check('projection: added rows = the ticked videos\' repetition rows (ESL signs: the ESL model only)', P.added.ESL === addedRows && P.added.FSL === 0 && P.projected.ESL === mine.ESL + addedRows && P.projected.FSL === mine.FSL && addedRows > 0, `+${P.added.ESL} ESL, +${P.added.FSL} FSL`);
  const k = P.knn;
  const real = { current: await realMs(k.labels.current.ESL, P.current.ESL), projected: await realMs(k.labels.projected.ESL, P.projected.ESL), fsl: await realMs(k.labels.current.FSL, P.current.FSL) };
  const within2 = (page, kiosk) => page > 0 && kiosk > 0 && page / kiosk <= 2 && kiosk / page <= 2;
  const f3 = (x) => x.toFixed(3);
  check('projection: the knnPredict estimate is within a factor of 2 of the kiosk\'s REAL knnPredict timed in this page on a model of the same shape — current and projected', k.status === 'ready' && !k.capped && k.labels.projected.ESL === k.labels.current.ESL + 4 && k.labels.projected.FSL === k.labels.current.FSL
    && within2(k.current.ESL, real.current) && within2(k.projected.ESL, real.projected) && within2(k.current.FSL, real.fsl) && k.projected.FSL === k.current.FSL,
    `ESL now (${P.current.ESL} rows, ${k.labels.current.ESL} labels): page ${f3(k.current.ESL)} ms, real ${f3(real.current)} ms; ESL after (${P.projected.ESL} rows, ${k.labels.projected.ESL} labels): page ${f3(k.projected.ESL)} ms, real ${f3(real.projected)} ms; FSL now (${P.current.FSL} rows): page ${f3(k.current.FSL)} ms, real ${f3(real.fsl)} ms`);
  const big = { page: await ev(`BulkImport.knnTime(300, 24000)`), real: await realMs(300, 24000) };
  const huge = { page: await ev(`BulkImport.knnTime(600, 250000)`), real: await realMs(600, 100000) };
  check('... and for a large model (24,000 rows, 300 labels); above 100,000 rows the model is capped at 100,000 and says so', within2(big.page.ms, big.real) && !big.page.capped && big.page.rows === 24000 && huge.page.capped && huge.page.rows === 100000 && within2(huge.page.ms, huge.real) && huge.page.ms > big.page.ms,
    `24,000 rows: page ${f3(big.page.ms)} ms, real ${f3(big.real)} ms; 100,000 rows (asked 250,000): page ${f3(huge.page.ms)} ms, real ${f3(huge.real)} ms`);
  const projDom = await ev(`({ rows: [...document.querySelectorAll('#bi-projection tbody tr')].map(tr => [...tr.children].map(td => td.textContent)), note: document.querySelector('.bi-proj-note').textContent, kiosk: typeof window.knnPredict })`);
  check('projection box: both models, rows now / added / after, the two times, "estimate, this laptop\'s Chrome", "The Pi is slower."; the kiosk\'s knnPredict is not loaded (and the check\'s copy left no global)', projDom.rows.length === 2 && J(projDom.rows[0].slice(0, 4)) === J(['ESL', String(mine.ESL), '+' + addedRows, String(mine.ESL + addedRows)]) && J(projDom.rows[1].slice(0, 4)) === J(['FSL', String(mine.FSL), '+0', String(mine.FSL)])
    && projDom.rows.every((r) => / ms$/.test(r[4]) && / ms$/.test(r[5])) && /The Pi is slower\./.test(projDom.note) && /estimate, this laptop's Chrome/.test(projDom.note) && projDom.kiosk === 'undefined' && await ev(`document.getElementById('bi-proj-capped').hidden`), J(projDom.rows));
  await ev(`document.querySelector('#bi-review tr[data-id="${tworeps.id}"] input').click(); 1`);
  const ticked = await review();
  const tworepsRows = idx[tworeps.id].reps.reduce((x, rep) => x + rep.rows, 0);
  await ev(`document.querySelector('#bi-review tr[data-id="${tworeps.id}"] input').click(); 1`);
  const unticked = await review();
  check('ticking the 2-repetition video updates the projection and the button; unticking restores them', ticked.projection.added.ESL === addedRows + tworepsRows && ticked.button === 'Import 6 videos (17 samples)' && R(ticked, tworeps).checked && ticked.newSigns.find((s) => s.key === TWO_REPS_KEY).active
    && unticked.projection.added.ESL === addedRows && unticked.button === 'Import 5 videos (15 samples)', ticked.button);
  check('still nothing written (ticking, typing and the projection write nothing)', hash(contentListing(saved, { zz: true })) === zzBefore && liveCounts() === dbSetUp && posts().length === postsAfterExtract);

  // ── 4. Import ──
  await setText('zz_bulk_one', 'Zz bulk one?');
  const lateSign = save({ label: 'zz_bulk_late', sign_language: 'FSL' });   // after the review: the page still thinks it is new
  await click('bi-import');
  const seenImport = await ev(`${S}.step === 'import'`);
  check('Import pressed: the Import step opens and the import finishes', seenImport && await importDone(), await ev(`${S}.imp.status + ' / ' + ${S}.imp.message`));
  const s1 = await summary();
  const imported1 = [nio, one1, three1, two1];
  check('summary numbers: 12 samples added from 4 videos, 0 duplicates, 1 video refused', s1 && s1.added === 12 && s1.duplicates === 0 && s1.videos === 5 && s1.videosSkipped === 1
    && J(s1.signs.map((s) => [s.key, s.set, s.added, s.duplicates, s.total, s.created])) === J([['zz_bulk_late', 'ESL', 0, 0, 1, false], ['zz_bulk_nio', 'ESL', 3, 0, 3, true], ['zz_bulk_one', 'ESL', 3, 0, 3, true], ['zz_bulk_three', 'ESL', 3, 0, 3, true], ['zz_bulk_two', 'ESL', 3, 0, 4, false]]), s1 && J(s1.signs.map((s) => [s.key, s.added, s.total])));
  const problems4 = imported1.flatMap(sampleProblems);
  check('each imported repetition: saved_gestures/<key>/sample_i<importId>.json (importId = SHA-256 of name|size|rep, computed here), v3, source "video-import", signer P01, repIndex, fps 15, input/contentRect, frames = the cached repetition, a gesture_recordings row',
    problems4.length === 0 && lateSign.status === 200, problems4.join('; ').slice(0, 600) || `${imported1.length * 3} samples, e.g. ${sampleName(one1, 1)}`);
  check('sample counts on disk: 3 per new sign, 1 + 3 for the sign that existed; nothing for the refused video or the unticked ones', J(['zz_bulk_one', 'zz_bulk_three', 'zz_bulk_nio', 'zz_bulk_two', 'zz_bulk_late', 'zz_bulk_clash'].map((key) => samples(key).length)) === J([3, 3, 3, 4, 1, 1]) && !fs.existsSync(dir(TWO_REPS_KEY))
    && J(zzFolders()) === J(['zz_bulk_clash', 'zz_bulk_late', 'zz_bulk_nio', 'zz_bulk_one', 'zz_bulk_three', 'zz_bulk_two']), J(zzFolders()));
  const sj = (key) => { const s = signJson(key); return [s.key, s.set, s.textEn, s.textFil]; };
  const dbRow = (key) => { const r = row(key); return r ? [r.label, r.sign_language, r.text_en, r.text_fil] : null; };
  check('new signs: sign.json key = the file\'s label key, set ESL; the edited text is stored (sign.json + DB) and the key did not change', J(sj('zz_bulk_one')) === J(['zz_bulk_one', 'ESL', 'Zz bulk one?', null]) && J(dbRow('zz_bulk_one')) === J(['zz_bulk_one', 'ESL', 'Zz bulk one?', null]) && !fs.existsSync(dir('zz_bulk_one_')), J(sj('zz_bulk_one')));
  check('an untouched new sign has the draft text; "ZZ_Bulk Niño" became the sign zz_bulk_nio', J(sj('zz_bulk_three')) === J(['zz_bulk_three', 'ESL', 'Zz bulk three', null]) && J(dbRow('zz_bulk_three')) === J(['zz_bulk_three', 'ESL', 'Zz bulk three', null]) && J(sj('zz_bulk_nio')) === J(['zz_bulk_nio', 'ESL', 'Zz bulk nio', null]) && J(dbRow('zz_bulk_nio')) === J(['zz_bulk_nio', 'ESL', 'Zz bulk nio', null]), J(sj('zz_bulk_nio')));
  check('the sign that existed kept its set and texts', J(sj('zz_bulk_two')) === J(['zz_bulk_two', 'ESL', 'Zz custom two', null]) && J(dbRow('zz_bulk_two')) === J(['zz_bulk_two', 'ESL', 'Zz custom two', null]), J(sj('zz_bulk_two')));
  check('a sign that became FSL after the review: HTTP 409 -> the video is left with "exists as FSL", the import goes on; the FSL sign is untouched', J(s1.skipped.find((g) => g.reason === 'exists as FSL')) === J({ reason: 'exists as FSL', videos: 2 }) && s1.skippedVideos.some((v) => v.name === late.name && v.reason === 'exists as FSL')
    && J(sj('zz_bulk_late')) === J(['zz_bulk_late', 'FSL', null, 'Zz bulk late']) && samples('zz_bulk_late').length === 1, J(s1.skipped));
  const savePosts = [];
  for (const r of posts().filter((p) => p.url.endsWith('/php/api/save_gesture.php'))) savePosts.push(JSON.parse(r.postData !== null ? r.postData : await c.getRequestPostData(r.requestId)));
  const KEYS_SENT = ['label', 'sign_language', 'frames', 'formatVersion', 'source', 'repIndex', 'videoWidth', 'videoHeight', 'fps', 'input', 'signer', 'importId'];
  check('13 POSTs to save_gesture.php (12 saved + the 409), each with exactly the contract\'s keys and no text; one POST to signs.php, for the edited sign only', savePosts.length === 13 && savePosts.every((b) => J(Object.keys(b)) === J(KEYS_SENT) && b.formatVersion === 3 && b.source === 'video-import' && b.signer === 'P01' && b.sign_language === 'ESL' && /^[0-9a-f]{32}$/.test(b.importId))
    && postsTo('signs.php') === 1 && (() => { const b = JSON.parse(posts().find((p) => p.url.endsWith('/php/api/signs.php')).postData); return J(b) === J({ action: 'update', key: 'zz_bulk_one', set: 'ESL', textEn: 'Zz bulk one?', textFil: null }); })(), `${savePosts.length} sample POSTs, ${postsTo('signs.php')} text POST`);

  // ── 5. The samples load like live ones ──
  const loaded = await ev(`GestureDataRecorder.loadGestureDatasetForTraining(true).then(rows => { const out = {}; rows.forEach(r => { if (r.label.indexOf('zz_') !== 0) return; const o = out[r.label] || (out[r.label] = { rows: 0, bad: 0, set: r.signLanguage }); o.rows++; if (!Array.isArray(r.features) || r.features.length !== 126 || !r.features.some(x => x !== 0)) o.bad++; }); return out; })`);
  const expectRows = { zz_bulk_one: rowsOf(one1), zz_bulk_three: rowsOf(three1), zz_bulk_nio: rowsOf(nio), zz_bulk_two: rowsOf(two1) + 2 };
  check('loadGestureDatasetForTraining(true): each imported sign has sum(min(30, hand frames)) rows of 126 features', Object.entries(expectRows).every(([key, n]) => loaded[key] && loaded[key].rows === n && loaded[key].set === 'ESL') && loaded.zz_bulk_one.bad === 0 && loaded.zz_bulk_three.bad === 0 && loaded.zz_bulk_nio.bad === 0, J(Object.fromEntries(Object.entries(loaded).map(([key, o]) => [key, o.rows]))));
  const rv5 = await review();
  check('the Review now counts those rows: current ESL rows grew by exactly the projected amount', rv5.projection.current.ESL === mine.ESL + addedRows - idx[late.id].reps.reduce((x, rep) => x + rep.rows, 0) + 0 && rv5.projection.current.FSL === mine.FSL + 2, `ESL ${rv5.projection.current.ESL}, FSL ${rv5.projection.current.FSL}`);

  // ── 6. Model caches ──
  const ls = await ev(`[localStorage.getItem('sining_kamay_labels_ESL'), localStorage.getItem('sining_kamay_labels_FSL')]`);
  check('localStorage sining_kamay_labels_ESL was removed (ESL signs were imported); the FSL one was left alone', ls[0] === null && ls[1] === 'zz-dummy' && J(s1.languages) === J(['ESL']), J(ls));
  check('after the import the rows read "already imported" (disabled), the late sign "exists as FSL"; Import is disabled', imported1.every((v) => { const r = R(rv5, v); return r.kind === 'imported' && r.text === 'already imported' && !r.enabled && !r.checked && r.done === 3; })
    && R(rv5, late).kind === 'collision' && R(rv5, tworeps).kind === 'problem' && rv5.disabled && rv5.button === 'Import 0 videos (0 samples)' && rv5.note === 'No video is ticked.', rv5.button);
  const sumDom1 = await ev(`({ total: document.getElementById('bi-sum-total').textContent, signs: [...document.querySelectorAll('#bi-sum-signs tbody tr')].map(tr => [...tr.children].map(td => td.textContent)), fresh: document.getElementById('bi-sum-new').textContent,
    skipped: [...document.querySelectorAll('#bi-sum-skipped tbody tr')].map(tr => [...tr.children].map(td => td.textContent)), remind: !document.getElementById('bi-remind').hidden && document.getElementById('bi-remind').offsetHeight > 0, text: document.getElementById('bi-remind-text').textContent,
    count: document.getElementById('bi-imp-count').textContent, bar: document.getElementById('bi-imp-progress').value, added: document.getElementById('bi-imp-added').textContent, link: document.querySelector('#bi-remind a').getAttribute('href') })`);
  check('summary shown: samples per sign (added, duplicates, total now), new signs created, videos not imported by reason, the Compile reminder; progress "Video 5 of 5"', sumDom1.total === '12 samples added, 0 duplicates skipped, from 4 videos.'
    && J(sumDom1.signs) === J([['zz_bulk_late', 'ESL', '0', '0', '1'], ['zz_bulk_nionew sign', 'ESL', '3', '0', '3'], ['zz_bulk_onenew sign', 'ESL', '3', '0', '3'], ['zz_bulk_threenew sign', 'ESL', '3', '0', '3'], ['zz_bulk_two', 'ESL', '3', '0', '4']])
    && sumDom1.fresh === 'zz_bulk_nio, zz_bulk_one, zz_bulk_three' && J(sumDom1.skipped) === J([['bad file name', '1'], ['exists as FSL', '2'], ['found 2 repetitions, need 3', '1'], ['not used for recognition', '3']])
    && sumDom1.remind && sumDom1.text === REMINDER && sumDom1.link === 'gesture-training.html' && sumDom1.count === 'Video 5 of 5' && sumDom1.bar === 1 && sumDom1.added === '12', J(sumDom1.skipped));
  await shot('bulk-import-summary.png');

  // ── 7. The 2-repetition video, through a server error; then a forced re-import ──
  // In the page: the next POST to save_gesture.php is answered HTTP 500 (once), or not at all.
  await ev(`(() => { const real = window.fetch; window.__trap = null; window.__trapped = 0;
    window.fetch = function (url, o) { const t = window.__trap;
      if (t && o && o.method === 'POST' && String(url).indexOf('save_gesture.php') >= 0 && window.__seen++ >= t.after) { window.__trap = null; window.__trapped++;
        return t.http ? Promise.resolve(new Response(JSON.stringify({ success: false, error: 'zz server error' }), { status: t.http })) : Promise.reject(new TypeError('Failed to fetch')); }
      return real.apply(this, arguments); }; return 1; })()`);
  await click('bi-tab-review');
  await waitFor(`${S}.review.status === 'ready'`, 30000, 100);
  await ev(`document.querySelector('#bi-review tr[data-id="${tworeps.id}"] input').click(); 1`);
  const rv7 = await review();
  await ev(`window.__seen = 0; window.__trap = { after: 1, http: 500 }; 1`);   // the 2nd repetition's POST fails
  await click('bi-import');
  await waitFor(`${S}.imp.status === 'paused'`, 30000, 50);
  const paused = await ev(`({ status: ${S}.imp.status, added: ${S}.imp.added, note: document.getElementById('bi-imp-note').textContent, error: document.getElementById('bi-imp-note').classList.contains('error'), resume: document.getElementById('bi-imp-resume').disabled, pause: document.getElementById('bi-imp-pause').disabled, importBtn: document.getElementById('bi-import').disabled, trapped: window.__trapped })`);
  check('a 5xx answer PAUSES the import with a clear message and a Resume button (1 of 2 repetitions saved so far)', rv7.button === 'Import 1 video (2 samples)' && paused.status === 'paused' && paused.added === 1 && paused.trapped === 1 && paused.error && !paused.resume && paused.pause && paused.importBtn
    && /^The server answered with an error \(zz server error\)\. Nothing is lost: Resume tries this repetition again\.$/.test(paused.note) && samples(TWO_REPS_KEY).length === 1, paused.note);
  await ev(`window.__seen = 0; window.__trap = { after: 0 }; 1`);              // ... and then the server is gone
  await click('bi-imp-resume');
  await waitFor(`window.__trapped === 2 && ${S}.imp.status === 'paused'`, 30000, 50);
  const paused2 = await ev(`({ added: ${S}.imp.added, note: document.getElementById('bi-imp-note').textContent })`);
  await click('bi-imp-resume');
  check('no answer at all pauses it too; Resume then finishes', paused2.added === 1 && /^The server did not answer \(Failed to fetch\)\. Nothing is lost: check that Apache is running, then Resume\.$/.test(paused2.note) && await importDone(), paused2.note);
  const s7 = await summary();
  check('only the 2 repetitions of that video were added (once each, across the pause)', s7.added === 2 && s7.duplicates === 0 && s7.videos === 1 && J(s7.signs.map((s) => [s.key, s.added, s.duplicates, s.total, s.created])) === J([[TWO_REPS_KEY, 2, 0, 2, true]]) && samples(TWO_REPS_KEY).length === 2
    && sampleProblems(tworeps).length === 0 && J(sj(TWO_REPS_KEY)) === J([TWO_REPS_KEY, 'ESL', 'Zz bulk two reps', null]) && J(s7.newSigns) === J([TWO_REPS_KEY]), J(s7.signs) + ' ' + sampleProblems(tworeps).join('; '));
  const allP01 = [nio, one1, three1, two1, tworeps];
  const diskBefore7 = hash(contentListing(saved, { zz: true })), db7 = liveCounts();
  await ev(`BulkImport.import({ ids: ${J(allP01.map((v) => v.id))} }); BulkImport.pauseImport(); 1`);
  await waitFor(`${S}.imp.status === 'paused'`, 10000, 50);
  const paused3 = await ev(`({ note: document.getElementById('bi-imp-note').textContent, error: ${S}.imp.error, dup: ${S}.imp.duplicates, added: ${S}.imp.added })`);
  await ev(`BulkImport.resumeImport(); 1`);
  check('a forced re-import of every imported video (Pause pressed at once, then Resume) finishes', /^Paused\./.test(paused3.note) && !paused3.error && paused3.added === 0 && await importDone(), paused3.note);
  const s7b = await summary();
  check('everything answers "duplicate": 0 added, 14 duplicates; the summary numbers match; disk and DB unchanged', s7b.added === 0 && s7b.duplicates === 14 && s7b.videos === 5 && s7b.videosSkipped === 0 && J(s7b.newSigns) === J([])
    && J(s7b.signs.map((s) => [s.key, s.added, s.duplicates, s.total])) === J([['zz_bulk_nio', 0, 3, 3], ['zz_bulk_one', 0, 3, 3], ['zz_bulk_three', 0, 3, 3], ['zz_bulk_two', 0, 3, 4], [TWO_REPS_KEY, 0, 2, 2]])
    && hash(contentListing(saved, { zz: true })) === diskBefore7 && liveCounts() === db7 && await ev(`document.getElementById('bi-sum-total').textContent`) === '0 samples added, 14 duplicates skipped, from 5 videos.', J(s7b.signs.map((s) => [s.key, s.added, s.duplicates])));

  // ── 8. Reload: already imported ──
  check('page reopened, same folder chosen', await openPage() && await pickFolder());
  check('Review opened again', await openReview());
  const rv8 = await review();
  check('after a reload every imported video reads "already imported" (the 2-repetition one too); Import adds nothing and is disabled', allP01.every((v) => { const r = R(rv8, v); return r.kind === 'imported' && !r.enabled && !r.checked && r.add === 0; }) && R(rv8, tworeps).text === 'already imported (found 2 repetitions, need 3)'
    && rv8.button === 'Import 0 videos (0 samples)' && rv8.disabled && rv8.newSigns.length === 0 && await ev(`document.getElementById('bi-new-card').hidden`) && J(await ev(`${S}.recognitionSigners`)) === J(['P01']), rv8.button);
  await ev(`BulkImport.import({ ids: ${J(allP01.map((v) => v.id))} }); 1`);
  check('forced import after the reload finishes', await importDone());
  const s8 = await summary();
  const again = callApi('save_gesture.php', { body: { label: one1.key, sign_language: 'ESL', frames: hands(one1).reps[0].frames, formatVersion: 3, source: 'video-import', repIndex: 1, signer: 'P01', importId: importId(one1, 1) } });
  check('the same POSTs again: duplicate:true for all 14 (and for one sent from here); sample files and DB rows unchanged', s8.added === 0 && s8.duplicates === 14 && again.status === 200 && again.json.duplicate === true && hash(contentListing(saved, { zz: true })) === diskBefore7 && liveCounts() === db7, `${s8.duplicates} duplicates`);

  // ── 9. P02 added to the recognition list ──
  const cachePosts = postsTo('bulk_import.php');
  const sigs = () => J(videos.map((v) => v.id).map((id) => { const st = fs.statSync(handsFile(id)); return [st.size, st.mtimeMs]; }));
  const sigs9 = sigs();
  await click('bi-tab-review');
  await waitFor(`${S}.review.status === 'ready'`, 30000, 100);
  await ev(`document.querySelector('#bi-recognition input[data-signer="P02"]').click(); 1`);
  await sleep(300);
  const rv9 = await review();
  check('P02 ticked for recognition: its rows become OK and ticked at once, with no extraction (no cache write, hands files untouched); their signs exist now, so none is new', [one2, two2, three2].every((v) => { const r = R(rv9, v); return r.kind === 'ok' && r.enabled && r.checked && !r.isNew && r.add === 3; })
    && rv9.button === 'Import 3 videos (9 samples)' && !rv9.disabled && rv9.newSigns.length === 0 && postsTo('bulk_import.php') === cachePosts && sigs() === sigs9 && await ev(`${S}.run.status`) === 'idle', rv9.button);
  await click('bi-import');
  check('P02 import finished', await importDone());
  const s9 = await summary();
  const problems9 = [one2, two2, three2].flatMap(sampleProblems);
  check('P02\'s samples were added from the cached Hands result and carry signer "P02" (their own importIds)', s9.added === 9 && s9.duplicates === 0 && problems9.length === 0 && J(['zz_bulk_one', 'zz_bulk_two', 'zz_bulk_three'].map((key) => samples(key).length)) === J([6, 7, 6])
    && importId(one2, 1) !== importId(one1, 1) && J(s9.signs.map((s) => [s.key, s.added, s.total, s.created])) === J([['zz_bulk_one', 3, 6, false], ['zz_bulk_three', 3, 6, false], ['zz_bulk_two', 3, 7, false]]) && postsTo('bulk_import.php') === cachePosts
    && J(sj('zz_bulk_one')) === J(['zz_bulk_one', 'ESL', 'Zz bulk one?', null]), problems9.join('; ').slice(0, 400) || J(s9.signs.map((s) => [s.key, s.added, s.total])));

  // ── 10. Summary: per-sign table, imbalance warning, reminder ──
  const signsEnd = signsApi({ method: 'GET' }).json.signs;
  const imb = Core.imbalance(Object.fromEntries(Object.entries(signsEnd).map(([key, s]) => [key, s.samples])));
  const sumDom = await ev(`({ all: [...document.querySelectorAll('#bi-sum-all tbody tr')].map(tr => [tr.dataset.key, tr.children[1].textContent, tr.children[2].textContent, tr.children[3].textContent, tr.classList.contains('low')]),
    line: document.getElementById('bi-sum-imbalance').textContent, warn: document.getElementById('bi-sum-imbalance').classList.contains('bi-warn'), remind: !document.getElementById('bi-remind').hidden && document.getElementById('bi-remind').offsetHeight > 0, text: document.getElementById('bi-remind-text').textContent,
    active: document.getElementById('bi-step-import').classList.contains('active') })`);
  check('summary: a sample-count line for ALL signs, from a fresh signs.php', sumDom.active && sumDom.all.length === Object.keys(signsEnd).length && sumDom.all.every((r) => signsEnd[r[0]] && r[1] === signsEnd[r[0]].set && r[2] === String(signsEnd[r[0]].samples)) && s9.allSigns.length === sumDom.all.length, `${sumDom.all.length} signs, median ${imb.median}`);
  check('imbalance: the signs below half the median are marked — the sample-less zz_bulk_empty is one of them', J(s9.low) === J(imb.low) && s9.median === imb.median && imb.low.includes('zz_bulk_empty') && sumDom.warn && sumDom.line.includes('zz_bulk_empty') && sumDom.line.startsWith('⚠ ')
    && J(sumDom.all.filter((r) => r[4]).map((r) => r[0]).sort()) === J(imb.low) && sumDom.all.filter((r) => r[4]).every((r) => r[3] === '⚠ below half the median') && sumDom.all.filter((r) => !r[4]).every((r) => r[3] === '') && sumDom.all[0][4] === true, sumDom.line.slice(0, 160));
  check('the Compile reminder is shown', sumDom.remind && sumDom.text === REMINDER);

  // ── 11. Layout ──
  const LAYOUT = (w) => `(() => { const out = [...document.querySelectorAll('#bi-ui *')].filter(e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width && !e.closest('.bi-scroll') && !e.closest('.bi-new-list') && !e.classList.contains('bi-offscreen') && !e.classList.contains('bi-sr') && r.right > ${w} + 0.5; }).map(e => e.id || e.className);
    const inner = [...document.querySelectorAll('.bi-scroll, .bi-new-list, .bi-col-side')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.className);
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, out, inner }; })()`;
  await ev(`BulkImport.setRecognitionSigners(['P01']); 1`);   // P02 "not used" again: the longest status text
  const layouts = {};
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const step of ['review', 'import']) {
      await click('bi-tab-' + step);
      await sleep(200);
      if (step === 'review') await waitFor(`${S}.review.status === 'ready'`, 30000, 100);
      layouts[`${w}/${step}`] = { w, h, ...(await ev(LAYOUT(w))) };
      if (w === 1366) await shot(`bulk-${step}-end.png`);
    }
  }
  check('no horizontal scroll at 1366 and at 1280 wide (Review and Import), the page does not scroll', Object.values(layouts).every((l) => l.sw === l.w && l.sh === l.h && !l.out.length && !l.inner.length), J(layouts));

  // ── 11b. A BOTH sign and an FSL sign; a lost answer; a reload mid-run; extraction vs import ──
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  check('second folder read (BOTH_zz_bulk_both_P01.webm, FSL_zz_bulk_fsl_P01.webm)', await pickFolder(dirB, 2), await ev(`document.getElementById('bi-status').textContent`));
  await click('bi-start');
  check('second folder extracted', await waitFor(`${S}.run.status === 'done'`, 300000, 500) && [both, fsl].every((v) => index()[v.id] && index()[v.id].seg.repsFound === 3), J(await ev(`${S}.run.counts`)));
  await ev(`localStorage.setItem('sining_kamay_labels_ESL', 'zz-dummy'); localStorage.setItem('sining_kamay_labels_FSL', 'zz-dummy'); 1`);
  const beforeB = countModels();
  await openReview();
  await knnReady();
  const rvB = await review();
  const newsB = await ev(`[...document.querySelectorAll('#bi-new-signs .bi-new-row')].map(r => ({ key: r.dataset.key, set: r.querySelector('.bi-new-set').textContent, fields: [...r.querySelectorAll('input')].map(i => [i.dataset.field, i.value, i.maxLength]) }))`);
  check('BOTH sign: both draft texts; FSL sign: the Filipino text only', R(rvB, both).kind === 'ok' && R(rvB, both).newSign && R(rvB, both).set === 'BOTH' && R(rvB, fsl).kind === 'ok' && R(rvB, fsl).newSign && R(rvB, fsl).set === 'FSL' && rvB.button === 'Import 2 videos (6 samples)'
    && J(newsB) === J([{ key: 'zz_bulk_both', set: 'BOTH', fields: [['textEn', 'Zz bulk both', 255], ['textFil', 'Zz bulk both', 255]] }, { key: 'zz_bulk_fsl', set: 'FSL', fields: [['textFil', 'Zz bulk fsl', 255]] }]), J(newsB.map((n) => n.fields.map((f) => f[0]))));
  const idxB = index();
  const rowsBoth = idxB[both.id].reps.reduce((x, rep) => x + rep.rows, 0), rowsFsl = idxB[fsl.id].reps.reduce((x, rep) => x + rep.rows, 0);
  const PB = rvB.projection;
  check('projection: the BOTH sign counts in both models, the FSL sign in the FSL model only', J(PB.current) === J(beforeB.rows) && PB.added.ESL === rowsBoth && PB.added.FSL === rowsBoth + rowsFsl && rowsBoth > 0 && rowsFsl > 0
    && PB.knn.labels.projected.ESL === beforeB.labels.ESL + 1 && PB.knn.labels.projected.FSL === beforeB.labels.FSL + 2 && PB.knn.status === 'ready' && PB.knn.projected.FSL > 0, `+${PB.added.ESL} ESL, +${PB.added.FSL} FSL`);
  await setText('zz_bulk_fsl', 'Zz bulk fsl!', 'textFil');
  await setText('zz_bulk_both', 'Zz both!');
  // The page's fetch for the POSTs to save_gesture.php: "lose" sends the request to the server and
  // then fails as a network error would when the answer is lost; "hold" never sends it and waits.
  const TRAP = `(() => { const real = window.fetch; window.__trap = null; window.__n = 0; window.__held = 0;
    window.fetch = function (url, o) { const t = window.__trap;
      if (t && o && o.method === 'POST' && String(url).indexOf('save_gesture.php') >= 0 && window.__n++ === t.at) {
        if (t.lose) return real.apply(this, arguments).then(r => r.text()).then(() => { window.__trap = null; throw new TypeError('Failed to fetch'); });
        window.__held++; return new Promise(() => {}); }
      return real.apply(this, arguments); }; return 1; })()`;
  await ev(TRAP);
  // (b) the FSL video alone; the answer to its first save is lost
  await ev(`document.querySelector('#bi-review tr[data-id="${both.id}"] input').click(); 1`);
  const one = await review();
  await ev(`window.__n = 0; window.__trap = { at: 0, lose: true }; 1`);
  await click('bi-import');
  await waitFor(`${S}.imp.status === 'paused'`, 30000, 50);
  const lost = await ev(`({ added: ${S}.imp.added, dup: ${S}.imp.duplicates, note: document.getElementById('bi-imp-note').textContent, created: ${S}.imp.signs.zz_bulk_fsl.created, start: document.getElementById('bi-start').disabled, folder: document.getElementById('bi-folder').disabled })`);
  check('the answer to the first save is lost: the server has the sample, the page saw a network failure and paused (nothing counted, the text not sent yet)', one.button === 'Import 1 video (3 samples)' && lost.added === 0 && lost.dup === 0 && lost.created === false && /^The server did not answer \(Failed to fetch\)/.test(lost.note)
    && samples('zz_bulk_fsl').length === 1 && signJson('zz_bulk_fsl').textFil === 'Zz bulk fsl' && postsTo('signs.php') === 1, lost.note);
  // extraction <-> import: a paused import has nothing in flight (Start is offered); an import is not resumed while the extraction runs
  await ev(`BulkImport.state.run.status = 'running'; document.dispatchEvent(new CustomEvent('bulkimport:run')); 1`);
  const guard = await ev(`(() => { const d = document.getElementById('bi-imp-resume').disabled; BulkImport.resumeImport(); return { resumeDisabled: d, status: ${S}.imp.status }; })()`);
  await ev(`BulkImport.state.run.status = 'done'; document.dispatchEvent(new CustomEvent('bulkimport:run')); 1`);
  check('a paused import is not resumed while the extraction is running (Resume disabled, resumeImport() refused); while it is paused the extraction may start', !lost.start && !lost.folder && guard.resumeDisabled && guard.status === 'paused' && !(await ev(`document.getElementById('bi-imp-resume').disabled`)), J(guard));
  await click('bi-imp-resume');
  check('Resume finishes the import', await importDone());
  const sB1 = await summary();
  const lsB1 = await ev(`[localStorage.getItem('sining_kamay_labels_ESL'), localStorage.getItem('sining_kamay_labels_FSL')]`);
  const sjB = (key) => { const x = signJson(key); return [x.key, x.set, x.textEn, x.textFil]; };
  const dbB = (key) => { const x = row(key); return x ? [x.label, x.sign_language, x.text_en, x.text_fil] : null; };
  check('after Resume that repetition comes back "duplicate": 2 added + 1 duplicate, 3 samples on disk, and the sign IS listed as created', sB1.added === 2 && sB1.duplicates === 1 && J(sB1.signs.map((x) => [x.key, x.set, x.added, x.duplicates, x.total, x.created, x.textUpdated])) === J([['zz_bulk_fsl', 'FSL', 2, 1, 3, true, true]])
    && J(sB1.newSigns) === J(['zz_bulk_fsl']) && samples('zz_bulk_fsl').length === 3 && sampleProblems(fsl).length === 0 && await ev(`document.getElementById('bi-sum-new').textContent`) === 'zz_bulk_fsl', J(sB1.signs) + sampleProblems(fsl).join('; '));
  check('FSL sign: only the Filipino text, the EDITED one (sign.json + DB), samples with signLanguage FSL; only the FSL labels cache was dropped', J(sjB('zz_bulk_fsl')) === J(['zz_bulk_fsl', 'FSL', null, 'Zz bulk fsl!']) && J(dbB('zz_bulk_fsl')) === J(['zz_bulk_fsl', 'FSL', null, 'Zz bulk fsl!'])
    && samples('zz_bulk_fsl').every((f) => JSON.parse(fs.readFileSync(path.join(dir('zz_bulk_fsl'), f), 'utf8')).signLanguage === 'FSL') && J(lsB1) === J(['zz-dummy', null]) && J(sB1.languages) === J(['FSL']) && postsTo('signs.php') === 2, J(sjB('zz_bulk_fsl')) + ' ' + J(lsB1));
  const afterFsl = countModels();
  check('the FSL sign\'s rows are in the FSL model only', afterFsl.rows.ESL === beforeB.rows.ESL && afterFsl.rows.FSL === beforeB.rows.FSL + rowsFsl && afterFsl.labels.FSL === beforeB.labels.FSL + 1 && J((await review()).projection.current) === J(afterFsl.rows), J(afterFsl.rows));
  // (c) the BOTH video: the second save never returns; the page is reloaded in the middle of the run
  await click('bi-tab-review');
  await waitFor(`${S}.review.status === 'ready'`, 30000, 100);
  await ev(`localStorage.setItem('sining_kamay_labels_FSL', 'zz-dummy'); 1`);
  await ev(`document.querySelector('#bi-review tr[data-id="${both.id}"] input').click(); 1`);   // ticked again
  const two = await review();
  await ev(`window.__n = 0; window.__held = 0; window.__trap = { at: 1 }; 1`);
  await click('bi-import');
  await waitFor(`window.__held === 1`, 30000, 50);
  await sleep(300);
  const mid = await ev(`BulkImport.setFolder([]).then(ok => ({ status: ${S}.imp.status, added: ${S}.imp.added, setFolder: ok, start: document.getElementById('bi-start').disabled, folder: document.getElementById('bi-folder').disabled, videos: ${S}.videos.length,
    started: (BulkImport.start(), ${S}.run.status), importBtn: document.getElementById('bi-import').disabled, ls: [localStorage.getItem('sining_kamay_labels_ESL'), localStorage.getItem('sining_kamay_labels_FSL')] }))`);
  check('while the import is running: Start of the extraction and choosing a folder are refused', two.button === 'Import 1 video (3 samples)' && mid.status === 'running' && mid.added === 1 && mid.setFolder === false && mid.start && mid.folder && mid.videos === 2 && mid.started === 'done' && mid.importBtn, J(mid));
  check('mid-run, after the FIRST sample only: the edited text is already stored (sign.json + DB), both labels caches are already dropped', samples('zz_bulk_both').length === 1 && J(sjB('zz_bulk_both')) === J(['zz_bulk_both', 'BOTH', 'Zz both!', 'Zz bulk both']) && J(dbB('zz_bulk_both')) === J(['zz_bulk_both', 'BOTH', 'Zz both!', 'Zz bulk both']) && J(mid.ls) === J([null, null]), J(sjB('zz_bulk_both')));
  check('the page is reloaded in the middle of the run; same folder, Review', await openPage() && await pickFolder(dirB, 2) && await openReview());
  const rvC = await review();
  check('after the reload: the video shows 1 of 3 repetitions imported, its sign is no longer new, Import offers the 2 that are left', R(rvC, both).kind === 'ok' && R(rvC, both).text === 'OK (1 of 3 repetitions already imported)' && !R(rvC, both).isNew && R(rvC, both).add === 2 && R(rvC, both).checked
    && R(rvC, fsl).kind === 'imported' && rvC.button === 'Import 1 video (2 samples)' && rvC.newSigns.length === 0, R(rvC, both).text);
  await click('bi-import');
  check('import after the reload finishes', await importDone());
  const sB2 = await summary(), afterBoth = countModels();
  check('BOTH sign: 2 more samples and the first one answered "duplicate" (3 in all, signLanguage ESL), both texts with the edited English one kept, rows in BOTH models', sB2.added === 2 && sB2.duplicates === 1 && J(sB2.signs.map((x) => [x.key, x.set, x.added, x.duplicates, x.total, x.created])) === J([['zz_bulk_both', 'BOTH', 2, 1, 3, false]]) && sampleProblems(both).length === 0
    && J(sjB('zz_bulk_both')) === J(['zz_bulk_both', 'BOTH', 'Zz both!', 'Zz bulk both']) && J(dbB('zz_bulk_both')) === J(['zz_bulk_both', 'BOTH', 'Zz both!', 'Zz bulk both']) && J(sB2.languages) === J(['ESL', 'FSL'])
    && afterBoth.rows.ESL === afterFsl.rows.ESL + rowsBoth && afterBoth.rows.FSL === afterFsl.rows.FSL + rowsBoth && afterBoth.labels.ESL === afterFsl.labels.ESL + 1, J(sjB('zz_bulk_both')) + ' ' + J(afterBoth.rows) + sampleProblems(both).join('; '));

  // ── 12. Two files of one NEW sign with different sets; hostile names (File objects) ──
  const FAKE = ['ESL_zz_bulk_sd_P01.webm', 'FSL_zz_bulk_sd_P01.webm', 'FSL_zz_bulk_fil_P01.webm', 'BOTH_zz_bulk_both_P01.webm', 'ESL_zz_bulk<img src=x onerror="window.__xss=1">_P01.webm', '<b>x<b><script>window.__xss=2<script>.txt'];
  await ev(`BulkImport.setFolder(${J(FAKE)}.map(n => new File(['x'], n))).then(() => 1)`);
  await click('bi-tab-review');
  await waitFor(`${S}.review.status === 'ready' && ${S}.review.rows.length === ${FAKE.length}`, 30000, 100);
  const rvF = await review();
  const hx = await ev(`({ xss: window.__xss, injected: document.querySelectorAll('#bi-step-review img, #bi-step-review td b, #bi-step-review script').length, cells: [...document.querySelectorAll('#bi-review tbody tr')].map(tr => tr.children[1].textContent) })`);
  const F = (name) => rvF.rows.find((r) => r.name === name);
  check('two files that would create one new sign with different sets: the first in file-name order defines it, the other is "set differs from <first file>", disabled', F(FAKE[1]).kind === 'set-differs' && F(FAKE[1]).text === 'set differs from ESL_zz_bulk_sd_P01.webm' && !F(FAKE[1]).enabled && F(FAKE[1]).problem
    && F(FAKE[0]).kind === 'not-extracted' && !F(FAKE[0]).enabled && rvF.disabled, F(FAKE[1]).text);
  check('hostile file names are shown as literal text in the Review table (no element is created, no script runs)', hx.xss === undefined && hx.injected === 0 && hx.cells.includes(FAKE[4]) && hx.cells.includes(FAKE[5]) && F(FAKE[5]).kind === 'bad-name', `${hx.cells.length} rows`);
  const drafts = [Core.mapRow(Core.parseName(FAKE[2]), {}), Core.mapRow(Core.parseName(FAKE[3]), {})];
  check('draft texts follow the set: Filipino only for FSL, both for BOTH (BulkImportCore.mapRow, as the New signs block uses)', J(drafts) === J([{ status: 'new', textEn: null, textFil: 'Zz bulk fil' }, { status: 'new', textEn: 'Zz bulk both', textFil: 'Zz bulk both' }]));

  // ── 13. Network and console ──
  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  check('every request went to localhost (all other hosts blocked)', reqs.length > 0 && foreign.length === 0, `${reqs.length} requests, ${foreign.length} elsewhere`);
  const bodyProblems = [], targets = {};
  let maxBody = 0;
  for (const r of reqs.filter((x) => x.method !== 'GET')) {
    const file = new URL(r.url).pathname.replace('/SKR/php/api/', '');
    targets[file] = (targets[file] || 0) + 1;
    const body = r.postData !== null ? r.postData : r.hasPostData ? await c.getRequestPostData(r.requestId) : '';
    if (body === null) { bodyProblems.push('body not available'); continue; }
    maxBody = Math.max(maxBody, body.length);
    try { JSON.parse(body); } catch { bodyProblems.push('not JSON'); }
    if (/ftyp|ZnR5c|\u001aEß£|GkXfo|data:video|video_base64|video_path|"blob"/.test(body)) bodyProblems.push('video bytes in a POST to ' + file);
    if (body.length > 3 * 1024 * 1024) bodyProblems.push('body of ' + body.length + ' bytes');
  }
  check('POSTs go only to bulk_import.php, save_gesture.php and signs.php; all JSON; none carries video bytes', bodyProblems.length === 0 && J(Object.keys(targets).sort()) === J(['bulk_import.php', 'save_gesture.php', 'signs.php']), bodyProblems.join('; ').slice(0, 300) || `${J(targets)}, largest body ${Math.round(maxBody / 1024)} KB`);
  const odd = reqs.filter((r) => r.method === 'GET').map((r) => new URL(r.url).pathname).filter((p) => (!p.startsWith('/SKR/') && p !== '/favicon.ico') || /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i.test(p));
  check('no GET asks for a video or anything outside /SKR/', odd.length === 0, J([...new Set(odd)]).slice(0, 200));
  const errors = c.getConsoleErrors().concat(c.getExceptions());
  check('0 console errors', errors.length === 0, J(errors).slice(0, 600));
} finally {
  await c.close();
  cleanZz();
  cleanCache();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const left = fs.existsSync(CACHE) ? fs.readdirSync(path.join(CACHE, 'videos')).filter((f) => IDS.some((id) => f.includes(id))).concat(KEYS.filter((key) => fs.existsSync(path.join(CACHE, 'candidates', key)))) : [];
check('cleanup: 0 zz_ folders in saved_gestures, 0 zz_ rows in the DB, this check\'s cache videos and the temp folder are gone', zzFolders().length === 0 && Number(sql(`SELECT COUNT(*) c FROM gestures WHERE label LIKE 'zz\\_%'`)[0].c) === 0 && left.length === 0 && !fs.existsSync(tmp), J(zzFolders()) + J(left));
check('every sample file that is not a zz_ probe is byte-identical to before (content hash); DB counts as before', hash(contentListing(saved, { zz: false })) === othersBefore && liveCounts() === dbBefore, othersBefore.slice(0, 16) + ' / ' + dbBefore);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
