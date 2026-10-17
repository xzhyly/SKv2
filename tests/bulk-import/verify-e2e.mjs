// Bulk video importer: the phase's end-to-end verification on ONE test folder, measured.
//   Folder: 2 signers x 3 signs (synthetic, from assets/signs/en), one 2-repetition video, one bad
//   file name, one junk file, plus the owner's real video copied as ESL_zz_test_P01.mp4 when it is
//   on this machine. Everything is built in os.tmpdir(); nothing is committed.
//   1  Folder + Extract: problems listed, every video cached, timings printed.
//   2  Review + Import: OK rows imported; samples on disk (v3, video-import, signer, importId) and
//      in the DB; the 2-repetition video and the bad name are not imported.
//   3  Re-import after a reload: 0 new samples.
//   4  Default signer + priority + Apply to all: the summary matches the avatar.json files; a sign
//      picked by hand is untouched; a candidate without a sign is "not imported yet".
//   5  Train Gestures: the samples show in the dataset view; Compile (was Train AI) completes with
//      them (the 90-row per-sign budget applies); Predict runs on a fake camera. The model files
//      Compile writes are backed up first and restored byte for byte.
//   6  No request carries video bytes; no video file written under the repo or C:\xampp; the cache
//      is git-ignored; no kiosk page links to bulk-import.html; 0 console errors.
// Killing the tab mid-extraction, Pause / Resume and the candidate picker have their own checks
// (extract-check.mjs, candidates-panel-check.mjs). Every zz probe is removed at the end.
// Run (Apache + MariaDB up, no other node test running): node tests/bulk-import/verify-e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchChrome } from '../video-capture/cdp.mjs';
import { buildY4m } from '../video-capture/fake-camera.mjs';
import { callApi, cleanZz, dir, samples, sql, liveCounts, saved, signsApi } from '../sign-texts/api-helper.mjs';
import { buildTestFolder, REPO_ROOT, TWO_REPS_KEY, REAL_NAME } from './folder.mjs';
import { ZZ_ONLY } from './avatar-fixture.mjs';
import { guardModels } from '../compact-model/model-guard.mjs';

const BASE = 'http://localhost/SKR/';
const CACHE = path.join(REPO_ROOT, 'bulk_import_cache');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const api = (body) => callApi('bulk_import.php', { body });
const apiGet = (query) => callApi('bulk_import.php', { method: 'GET', query }).json;
const fileHash = (root, keep) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (d !== root || keep(e.name)) walk(p); } else if (d !== root) out.push(path.relative(root, p) + '|' + sha(fs.readFileSync(p))); } };
  walk(root);
  return sha(out.sort().join('\n'));
};
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|3gp|y4m)$/i;
function newVideoFiles(roots, since) {
  const hits = [];
  const walk = (d) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!['.git', 'node_modules', 'SKR'].includes(e.name)) walk(p); continue; }
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.mtimeMs >= since && VIDEO_EXT.test(e.name)) hits.push(p);
    }
  };
  roots.forEach(walk);
  return hits;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-verify-'));
const folder = buildTestFolder(path.join(tmp, 'videos'), { real: true });
const videos = folder.videos.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
const real = videos.find((v) => v.name === REAL_NAME) || null;
const tworeps = videos.find((v) => v.key === TWO_REPS_KEY);
const KEYS = [...new Set(videos.map((v) => v.key))].sort();
const IDS = videos.map((v) => v.id);
const importId = (v, rep) => sha(`${v.name}|${fs.statSync(v.path).size}|${rep}`).slice(0, 32);
const cleanCache = () => {
  for (const id of IDS) api({ action: 'delete_video', id });
  for (const key of KEYS) api({ action: 'delete_candidates', key });
  const picks = {}; KEYS.forEach((k) => { picks[k] = null; });
  api({ action: 'set_picks', picks });
};

cleanZz();
cleanCache();
const t0 = Date.now();
const othersBefore = fileHash(saved, (n) => !n.startsWith('zz_'));
const dbBefore = liveCounts();
const cacheOthersBefore = fs.existsSync(CACHE) ? J(Object.keys(apiGet('action=index').videos).sort()) : '[]';
console.log(`test folder: ${videos.length} videos (${videos.map((v) => v.name).join(', ')}), 1 bad name, 1 junk file${real ? '' : ' — the real video is NOT on this machine'}`);

let c = null, g = null;
// Compile (section 5) writes the real models/knn_<LANG>.bin: backed up here, restored in finally.
const models = guardModels();
try {
  // ══ bulk-import.html (every other host blocked) ══
  c = await launchChrome({ port: 9491, width: 1366, height: 768, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
  const ev = (e) => c.evaluate(e);
  const waitFor = async (expr, ms = 20000, step = 200) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(step); } return false; };
  const S = 'BulkImport.state';
  const click = (id) => ev(`document.getElementById('${id}').click(); 1`);
  const openPage = async () => {
    await c.navigate(BASE + 'bulk-import.html');
    await ev(`location.reload(); 1`);
    await sleep(1500);
    return waitFor(`!!window.BulkImport && document.getElementById('bi-ui').classList.contains('active') && ${S}.engines === 'ready'`, 90000);
  };
  const pickFolder = async () => {
    const doc = await c.send('DOM.getDocument', {});
    const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#bi-folder' });
    await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [folder.dir] });
    return waitFor(`${S}.videos.length === ${videos.length} && !${S}.folder.loading && ${S}.cacheLoaded && /^Found ${videos.length} videos/.test(document.getElementById('bi-status').textContent)`, 20000, 50);
  };
  const openReview = async () => { await click('bi-tab-review'); return waitFor(`${S}.step === 'review' && ${S}.review.status === 'ready'`, 60000, 100); };
  const reviewRows = () => ev(`${S}.review.rows.map(r => ({ name: r.name, kind: r.kind, text: r.text, enabled: r.enabled, checked: r.checked, isNew: r.isNew, key: r.key, signer: r.signer, reps: r.reps, add: r.addReps.length, done: r.doneReps }))`);
  await c.send('Network.enable', { maxPostDataSize: 16 * 1024 * 1024 });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: ZZ_ONLY });   // Apply can only ever see zz_ candidates

  // 1. Folder + Extract
  check('page opened, both extractors ready', await openPage());
  check('folder read', await pickFolder(), await ev(`document.getElementById('bi-status').textContent`));
  const problems = await ev(`${S}.problems.map(p => p.name + ': ' + p.reason)`);
  check('the bad file name is listed as a problem; the junk file is ignored', problems.length === 1 && /^hello_final\.webm: bad file name$/.test(problems[0]) && await ev(`${S}.folder.ignored`) === 1, J(problems));
  await ev(`BulkImport.setRecognitionSigners(['P01', 'P02']); BulkImport.setAvatarSigners(['P01', 'P02']); 1`);
  const tExtract = Date.now();
  await click('bi-tab-extract');
  await click('bi-start');
  const ran = await waitFor(`${S}.run.status === 'done'`, 1800000, 500);
  const run = await ev(`({ counts: ${S}.run.counts, timings: ${S}.timings, rows: ${S}.videos.map(r => ({ name: r.name, status: r.status, timing: r.timing })) })`);
  const index = apiGet('action=index').videos;
  check('extraction finished: every video cached, none failed', ran && run.counts.failed === 0 && videos.every((v) => index[v.id]), `${((Date.now() - tExtract) / 1000).toFixed(1)} s wall, ${J(run.counts)}`);
  check('repetitions found: 3 per normal video, 2 for the 2-repetition one', videos.every((v) => index[v.id].seg.repsFound === (v.reps || 3)), videos.map((v) => `${v.name.replace(/\.\w+$/, '')}=${index[v.id].seg.repsFound}`).join(' '));
  const cands = apiGet('action=candidates').candidates;
  check('an avatar candidate for every sign and signer in the avatar list (best repetition only)', videos.every((v) => (cands[v.key] || []).some((x) => x.signer === v.signer && x.videoId === v.id)),
    KEYS.map((k) => `${k}: ${(cands[k] || []).map((x) => `${x.signer} ${x.frames}f rep${x.repIndex}`).join(', ')}`).join('; '));
  const perFrame = (t) => (t.frames ? (t.ms / t.frames).toFixed(1) : 'n/a');
  console.log(`  timings: Hands ${perFrame(run.timings.hands)} ms/frame over ${run.timings.hands.frames} frames; Holistic ${perFrame(run.timings.holistic)} ms/frame over ${run.timings.holistic.frames} frames`);
  if (real) {
    const rr = run.rows.find((r) => r.name === real.name), m = index[real.id];
    console.log(`  real video: ${m.hands.videoWidth}x${m.hands.videoHeight}, ${m.hands.durationMs} ms; Hands pass ${Math.round(rr.timing.handsMs)} ms (${rr.timing.handsFrames} frames), Holistic on the best repetition ${Math.round(rr.timing.holisticMs)} ms (${rr.timing.holisticFrames} frames); window ${m.bestRep.windowStartMs}-${m.bestRep.windowEndMs} ms`);
    check('the real video: 3 repetitions, a valid candidate', m.seg.ok && m.seg.repsFound === 3 && m.candidate && m.candidate.state === 'ok', J({ reps: m.reps.map((r) => [r.startMs, r.endMs, r.rows]), candidate: m.candidate }));
  }
  check('extraction wrote nothing under saved_gestures', fileHash(saved, (n) => !n.startsWith('zz_')) === othersBefore && fs.readdirSync(saved).filter((d) => d.startsWith('zz_')).length === 0 && liveCounts() === dbBefore);

  // 2. Review + Import
  check('Review opened', await openReview());
  await waitFor(`${S}.review.projection && ${S}.review.projection.knn.status === 'ready'`, 90000, 200);
  const rows = await reviewRows();
  const rowOf = (v) => rows.find((r) => r.name === v.name);
  const normal = videos.filter((v) => v !== tworeps);
  check('Review: normal videos OK + new sign, ticked; the 2-repetition video a problem, not ticked; the bad name a disabled problem',
    normal.every((v) => rowOf(v).kind === 'ok' && rowOf(v).checked && rowOf(v).isNew) && rowOf(tworeps).kind === 'problem' && rowOf(tworeps).enabled && !rowOf(tworeps).checked
    && rows.find((r) => r.name === 'hello_final.webm').kind === 'bad-name' && !rows.find((r) => r.name === 'hello_final.webm').enabled,
    rows.map((r) => `${r.name}: ${r.text}`).join(' | '));
  const proj = await ev(`${S}.review.projection`);
  console.log(`  projection: ESL rows ${proj.current.ESL} + ${proj.added.ESL} = ${proj.projected.ESL}; FSL rows ${proj.current.FSL} + ${proj.added.FSL} = ${proj.projected.FSL}; knnPredict estimate ESL ${proj.knn.current.ESL.toFixed(2)} -> ${proj.knn.projected.ESL.toFixed(2)} ms`);
  const button = await ev(`document.getElementById('bi-import').textContent`);
  check('nothing written before Import', fs.readdirSync(saved).filter((d) => d.startsWith('zz_')).length === 0 && liveCounts() === dbBefore, button);
  await click('bi-import');
  const imported = await waitFor(`${S}.imp.status === 'done' && ${S}.review.status === 'ready'`, 300000, 200);
  const sum = await ev(`BulkImport.lastSummary()`);
  const expectSamples = normal.length * 3;
  check('Import finished: 3 samples per OK video, no duplicates', imported && sum.added === expectSamples && sum.duplicates === 0, `${sum.added} added from ${sum.videos} videos, ${sum.duplicates} duplicates; new signs ${J(sum.newSigns)}`);
  const signKeys = [...new Set(normal.map((v) => v.key))].sort();
  const problemsFound = [];
  for (const v of normal) {
    for (const rep of [1, 2, 3]) {
      const f = path.join(dir(v.key), `sample_i${importId(v, rep)}.json`);
      if (!fs.existsSync(f)) { problemsFound.push(`${v.name} rep ${rep}: missing`); continue; }
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (s.formatVersion !== 3 || s.source !== 'video-import' || s.signer !== v.signer || s.repIndex !== rep || s.importId !== importId(v, rep) || s.label !== v.key || s.fps !== 15) problemsFound.push(`${v.name} rep ${rep}: ${J({ fv: s.formatVersion, source: s.source, signer: s.signer, rep: s.repIndex })}`);
    }
  }
  check('samples on disk: v3, source "video-import", signer, repIndex, importId = hash of name|size|rep', problemsFound.length === 0, problemsFound.join('; ') || signKeys.map((k) => `${k}: ${samples(k).length}`).join(', '));
  const dbRows = sql(`SELECT g.label l, COUNT(r.id) n FROM gestures g JOIN gesture_recordings r ON r.gesture_id = g.id WHERE g.label LIKE 'zz\\_%' GROUP BY g.label`);
  check('the DB follows: one gesture_recordings row per sample', signKeys.every((k) => Number((dbRows.find((r) => r.l === k) || {}).n) === samples(k).length) && dbRows.length === signKeys.length, J(dbRows));
  check('not imported: the 2-repetition video (left unticked)', !fs.existsSync(dir(TWO_REPS_KEY)));
  check('the Compile reminder is shown', /Now run Compile \(Train AI\) on Train Gestures for ESL and for FSL\./.test(await ev(`document.getElementById('bi-step-import').textContent`)));

  // 3. Re-import after a reload
  const samplesBefore = signKeys.map((k) => samples(k).length);
  check('page reopened, same folder', await openPage() && await pickFolder() && await openReview());
  const rows2 = await reviewRows();
  check('re-import: every imported video reads "already imported"; Import offers 0 samples', normal.every((v) => rows2.find((r) => r.name === v.name).kind === 'imported') && await ev(`document.getElementById('bi-import').disabled`), await ev(`document.getElementById('bi-import').textContent`));
  await ev(`BulkImport.import({ ids: ${J(normal.map((v) => v.id))} }); 1`);
  await waitFor(`${S}.imp.status === 'done' && ${S}.review.status === 'ready'`, 300000, 200);
  const sum2 = await ev(`BulkImport.lastSummary()`);
  check('forcing the same POSTs again: 0 new samples, all answered duplicate; disk and DB unchanged', sum2.added === 0 && sum2.duplicates === expectSamples && J(signKeys.map((k) => samples(k).length)) === J(samplesBefore),
    `${sum2.added} added, ${sum2.duplicates} duplicates`);

  // 4. Default signer + priority + Apply to all
  const handKey = 'zz_bulk_three';
  const p2 = apiGet(`action=candidate&key=${handKey}&signer=P02`).candidate;
  const handSave = callApi('avatar_clip.php', { body: { action: 'save', key: handKey, clip: p2.clip } });
  api({ action: 'set_picks', picks: { [handKey]: { signer: 'P02', by: 'hand' } } });
  const handBytes = fs.readFileSync(path.join(dir(handKey), 'avatar.json'));
  check('set-up: one sign picked by hand (P02)', handSave.status === 200);
  await click('bi-tab-avatar');
  await waitFor(`${S}.step === 'avatar' && ${S}.av.status === 'ready'`, 30000);
  await ev(`BulkImport.setAvatarSigners(['P01', 'P02']); BulkImport.setKeepHand(true); 1`);
  await sleep(500);
  await click('bi-av-apply');
  const applied = await waitFor(`${S}.av.run.status === 'done' && ${S}.av.status === 'ready'`, 120000);
  const av = await ev(`BulkImport.lastAvatarSummary()`);
  const expectSet = signKeys.filter((k) => k !== handKey);
  const clipOk = expectSet.every((k) => {
    const f = path.join(dir(k), 'avatar.json');
    if (!fs.existsSync(f)) return false;
    const saved1 = JSON.parse(fs.readFileSync(f, 'utf8')), cand = apiGet(`action=candidate&key=${k}&signer=P01`).candidate.clip;
    return saved1.key === k && saved1.signer === 'P01' && J(saved1.frames) === J(cand.frames);
  });
  check('Apply to all signs finished; the summary matches the avatar.json files', applied && clipOk && av.bySigner.P01 === expectSet.length && !av.bySigner.P02 && J(av.leftAlone) === J([handKey]) && J(av.notImported) === J([TWO_REPS_KEY]) && !av.noClip.some((k) => k.startsWith('zz_')) && (av.failed || []).length === 0,
    J({ bySigner: av.bySigner, fallback: av.fallback, leftAlone: av.leftAlone, notImported: av.notImported, failed: av.failed }) + `; no clip: ${av.noClip.length} signs that have no candidate (none of them a test sign)`);
  check('the hand-picked sign is untouched (avatar.json bytes, pick)', fs.readFileSync(path.join(dir(handKey), 'avatar.json')).equals(handBytes) && apiGet('action=picks').picks[handKey].by === 'hand');
  const picks = apiGet('action=picks').picks;
  check('picks: by "default" with P01 for the applied signs', expectSet.every((k) => picks[k] && picks[k].by === 'default' && picks[k].signer === 'P01'), J(expectSet.map((k) => picks[k])));

  // 6a. network + console of the bulk page
  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  const posts = reqs.filter((r) => r.method === 'POST');
  const byFile = {}; let largest = 0, videoBytes = 0, nonJson = 0;
  for (const r of posts) {
    const body = r.postData !== null ? r.postData : await c.getRequestPostData(r.requestId);
    const name = r.url.split('/').pop(); byFile[name] = (byFile[name] || 0) + 1;
    largest = Math.max(largest, body ? Buffer.byteLength(body) : 0);
    if (!body || body[0] !== '{') nonJson++;
    if (body && /ftyp|moov|mdat|\x1A\x45\xDF\xA3|data:video/i.test(body)) videoBytes++;
  }
  check('every request went to localhost (all other hosts blocked)', foreign.length === 0, `${reqs.length} requests`);
  check('POSTs: JSON only, to bulk_import.php / save_gesture.php / signs.php / avatar_clip.php; none carries video bytes', nonJson === 0 && videoBytes === 0 && Object.keys(byFile).every((f) => ['bulk_import.php', 'save_gesture.php', 'signs.php', 'avatar_clip.php'].includes(f)),
    `${J(byFile)}, largest body ${Math.round(largest / 1024)} KB; the videos are ${Math.round(videos.reduce((a, v) => a + fs.statSync(v.path).size, 0) / 1024)} KB`);
  check('no GET names a video of the folder', !reqs.some((r) => videos.some((v) => r.url.includes(encodeURIComponent(v.name)) || r.url.includes(v.name))));
  const e1 = c.getConsoleErrors().concat(c.getExceptions());
  check('bulk-import.html: 0 console errors', e1.length === 0, J(e1).slice(0, 400));
  await c.close(); c = null;

  // ══ 5. Train Gestures: dataset view, Compile, Predict (fake camera) ══
  const y4m = buildY4m(tmp);
  g = await launchChrome({ port: 9492, extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  const gv = (e) => g.evaluate(e);
  const gWait = async (expr, ms = 20000, step = 250) => { const end = Date.now() + ms; while (Date.now() < end) { if (await gv(expr)) return true; await sleep(step); } return false; };
  await g.navigate(BASE + 'gesture-training.html');
  await sleep(2500);
  await gv(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&/^Next/.test(b.textContent.trim()));b&&b.click();})(); 1`);
  await sleep(1500);
  await gv(`(()=>{trOpenDatasetModal(); const s=document.getElementById('datasetSearch'); s.value='zz '; s.dispatchEvent(new Event('input'));})(); 1`);
  const findRows = `(()=>{const out={};for(const t of ['word','letter','number','phrase']){trSetDatasetTab(t);document.querySelectorAll('tr[data-key]').forEach(r=>{if(r.dataset.key.startsWith('zz_'))out[r.dataset.key]=[...r.children].map(td=>td.textContent.trim());});}return out;})()`;
  await gWait(`Object.keys(${findRows}).length >= ${signKeys.length}`, 60000, 500);
  const ds = await gv(findRows);
  check('dataset view: every imported sign is listed with its sample count and an avatar tick', signKeys.every((k) => ds[k] && ds[k].includes(String(samples(k).length)) && ds[k].includes('✓')), J(ds));
  await gv(`(()=>{const m=document.querySelector('.tr-ds-close, #datasetCloseBtn');m&&m.click(); if (typeof trCloseDatasetModal==='function') trCloseDatasetModal();})(); 1`);
  await gv(`window.reloadDataset ? window.reloadDataset().then(() => true) : true`);
  await gv(`trClickPill(2); showStepContent(2); window.lastCompile = null; document.getElementById('trainBtn').click(); true`);
  let epochLabel = '';
  const tTrain = Date.now();
  while (Date.now() - tTrain < 300000) { if (await gv(`!!window.lastCompile && !compileRunning`)) break; await sleep(500); }
  epochLabel = await gv(`document.getElementById('epochLabel').textContent`);
  check('Compile (ESL) completes', /^Complete!/.test(epochLabel), `${epochLabel} (${Date.now() - tTrain} ms)`);
  // Rows per sign = the cached repetitions' rows (at most 30 per sample) after the per-sign budget
  // (compact-model phase): total <= 90 keeps all, else each sample keeps max(3, floor(90 / n)) rows.
  const cacheLists = (k) => videos.filter((v) => v.key === k && v !== tworeps).flatMap((v) => index[v.id].reps.map((r) => r.rows)).filter((n) => n > 0);
  const cacheRows = (k) => { const l = cacheLists(k); const total = l.reduce((a, b) => a + b, 0); if (total <= 90) return total; const keep = Math.max(3, Math.floor(90 / l.length)); return l.reduce((a, b) => a + Math.min(b, keep), 0); };
  const inModel = await gv(`(()=>{const o={};${J(signKeys)}.forEach(k=>{o[k]=(typeof knnModel!=='undefined'&&knnModel&&knnModel[k])?knnModel[k].length:-1;});return o;})()`);
  check('the compiled model holds the imported signs with the cached repetitions\' rows after the 90-row budget', signKeys.every((k) => inModel[k] === cacheRows(k)),
    J({ model: inModel, expected: Object.fromEntries(signKeys.map((k) => [k, cacheRows(k)])), perSample: Object.fromEntries(signKeys.map((k) => [k, cacheLists(k)])) }));
  await gv(`trGoToStep(3); showStepContent(3); true`);
  await sleep(600);
  await gv(`document.getElementById('enableCamBtn').click(); 1`);
  const seen = {};
  const tPred = Date.now();
  while (Date.now() - tPred < 20000) {
    const p = await gv(`document.getElementById('predLabel') ? document.getElementById('predLabel').textContent : ''`);
    if (p) seen[p] = (seen[p] || 0) + 1;
    await sleep(200);
  }
  const live = await gv(`document.getElementById('livePredResult') ? document.getElementById('livePredResult').textContent : null`);
  const zzTexts = signKeys.map((k) => (signsApi({ method: 'GET' }).json.signs[k] || {}).textEn);
  check('Predict runs on the fake camera (hello clip) and produces output', Object.keys(seen).length > 0 && !!live, `labels shown over 20 s: ${J(seen)}; imported signs' texts: ${J(zzTexts)}`);
  const e2 = g.getConsoleErrors().concat(g.getExceptions());
  check('gesture-training.html: 0 console errors', e2.length === 0, J(e2).slice(0, 400));
  await g.close(); g = null;

  // ══ 6b. disk, git, links ══
  const written = newVideoFiles([REPO_ROOT, 'C:/xampp/htdocs', 'C:/xampp/tmp'], t0);
  check('no video file written under the repo or C:\\xampp', written.length === 0, written.join(', '));
  const ignored = execFileSync('git', ['-C', REPO_ROOT, 'check-ignore', 'bulk_import_cache/videos/x.meta.json', 'bulk_import_cache/candidates/zz/P01.json', 'bulk_import_cache/picks.json']).toString().trim().split(/\r?\n/);
  const status = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--untracked-files=all']).toString();
  check('cache, candidates and picks are git-ignored', ignored.length === 3 && !/bulk_import_cache/.test(status), `${fs.existsSync(CACHE) ? fs.readdirSync(path.join(CACHE, 'videos')).length : 0} files in the cache's videos folder now`);
  const kiosk = ['index.html', 'talk.html', 'gesture-training.html', 'reports.html', 'avatar-clips.html', 'learn-signs.html']
    .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)))
    .concat(fs.readdirSync(path.join(REPO_ROOT, 'js')).filter((f) => f.endsWith('.js') && !f.startsWith('bulk-import')).map((f) => 'js/' + f));
  // a mention inside a // comment is not a link
  const linking = kiosk.filter((f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').split(/\r?\n/).some((l) => /bulk-import\.html/.test(l) && !/^\s*(\/\/|\*|<!--)/.test(l)));
  check('nothing on the kiosk screens (or any other page or script) links to bulk-import.html', linking.length === 0, `${kiosk.length} files searched${linking.length ? ': ' + linking.join(', ') : ''}`);
} finally {
  if (c) await c.close();
  if (g) await g.close();
  const mr = models.restore();
  console.log('models: ' + mr.line);
  check('model files restored byte for byte', mr.ok);
  cleanZz();
  cleanCache();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const left = fs.readdirSync(saved).filter((d) => d.startsWith('zz_'));
check('all zz test signs removed (folders and DB rows); the rest of the dataset is byte-identical', left.length === 0 && liveCounts() === dbBefore && fileHash(saved, (n) => !n.startsWith('zz_')) === othersBefore, `${J(left)} ${liveCounts()}`);
const cacheLeft = fs.existsSync(CACHE) ? Object.keys(apiGet('action=index').videos).sort() : [];
check('this run\'s cache entries, candidates and picks are removed; other cache content untouched', J(cacheLeft) === cacheOthersBefore && KEYS.every((k) => !(apiGet('action=picks').picks || {})[k]) && KEYS.every((k) => !fs.existsSync(path.join(CACHE, 'candidates', k))));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
