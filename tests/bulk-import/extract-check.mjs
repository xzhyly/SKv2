// bulk-import.html, steps Folder and Extract (2026-10-13), end to end in headless Chrome
// (tests/video-capture/cdp.mjs) at 1366x768, with every non-localhost hostname blocked.
// The folder is tests/bulk-import/folder.mjs's: 7 synthetic zz_ videos (2 signers x 3 signs, one
// 2-repetition video), one bad file name, one junk file; built in an os.tmpdir() folder and given
// to the folder input with DOM.setFileInputFiles (the folder's own path: a webkitdirectory input
// ignores a list of file paths; webkitRelativePath is then "videos/<name>", as for a person).
//   1  opens without a PIN (admin login, accounts-quiz phase); parse results, counts, default signer lists, queue order, video ids; layout.
//   2  Full run with the avatar list [P01]: every video cached (meta + hands shape, reps 3 / 2),
//      candidates exactly for P01, a P02 video has candidate null; progress, ETA and preview shown.
//   3  Reload, same folder: nothing is extracted, in a fraction of the first run's time.
//   4  P02 added to the avatar list: only the Holistic step runs, for P02's videos; no hands file
//      and no P01 meta is rewritten.
//   5  Kill mid-extraction (the page is navigated away during video 3), reopen: the videos that
//      were finished are skipped, the rest is extracted. Both signers are avatar signers here and
//      the preview is ON for P01's videos and OFF for P02's (the same recordings under another
//      name), video by video: the speed comparison, interleaved because the machine's speed drifts.
//   6  Pause during the Hands pass (the video is dropped), Resume, Pause during the Holistic pass
//      (the cached Hands result is kept), Resume (only the candidate step runs).
//   6b A cache that cannot be read stops Start; a failed put_video / put_candidate pauses the
//      queue and Resume completes it without redoing a cached Hands pass; Start + Pause at once.
//   6c Edge-case folder: a video with no repetition; two files of one sign by one signer.
//   6d Hostile file names are shown as text.   6e A failed Holistic init offers Retry.
//   7  Without WebAssembly SIMD: the page says so and Start stays disabled.
//   8  Network (localhost only, no video bytes in any body), no video file written under the repo
//      or C:\xampp\tmp, saved_gestures untouched, the rest of the cache untouched, 0 console errors.
// Cleanup: the cache videos and candidates of this folder (by id / zz_ key) and the temp folder.
// `--shots=<folder>` saves screenshots of the two steps there (not under the repo by default).
// `--real` also puts the owner's real video in the folder as ESL_zz_test_P01.mp4 (when present).
// Run (Apache up, no other node test running): node tests/bulk-import/extract-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { launchChrome } from '../video-capture/cdp.mjs';
import { callApi } from '../sign-texts/api-helper.mjs';
import { buildTestFolder, buildExtrasFolder, REPO_ROOT, TWO_REPS_KEY } from './folder.mjs';

const require = createRequire(import.meta.url);
const Clip = require('../../js/avatar-clip.js');
const Core = require('../../js/bulk-import-core.js');

const PAGE = 'http://localhost/SKR/bulk-import.html';
const REAL = process.argv.includes('--real');
const SHOTS = (process.argv.find((a) => a.startsWith('--shots=')) || '').slice(8);   // optional: a folder for screenshots
const CACHE = path.join(REPO_ROOT, 'bulk_import_cache');
const SAVED = path.join(REPO_ROOT, 'saved_gestures');
const XAMPP_TMP = 'C:/xampp/tmp';
const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|m4v|3gp|y4m)$/i;
const MAX_BODY = 3 * 1024 * 1024;         // a sane bound for one video's landmark JSON
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

const api = (body) => callApi('bulk_import.php', { body });
const apiGet = (query) => callApi('bulk_import.php', { method: 'GET', query });
const index = () => apiGet('action=index').json.videos;
const metaFile = (id) => path.join(CACHE, 'videos', id + '.meta.json');
const handsFile = (id) => path.join(CACHE, 'videos', id + '.hands.json');
const fileSig = (f) => (fs.existsSync(f) ? `${fs.statSync(f).size}:${fs.statSync(f).mtimeMs}:${crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')}` : 'missing');

// Every file under root as "relative path|size|mtime" (skip: directory names not walked).
function listing(root, { only = null, skip = [] } = {}) {
  const out = [];
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.includes(e.name)) walk(p); continue; }
      if (only && !only.test(e.name)) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      out.push(`${path.relative(root, p)}|${st.size}|${st.mtimeMs}`);
    }
  };
  walk(root);
  return out.sort();
}
const hash = (list) => crypto.createHash('sha256').update(list.join('\n')).digest('hex');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-import-'));
const folder = buildTestFolder(path.join(tmp, 'videos'), { real: REAL });
const videos = folder.videos;                       // sorted by name: the extraction order
const IDS = videos.map((v) => v.id);
const KEYS = folder.keys;
const extras = buildExtrasFolder(path.join(tmp, 'extras'));   // the edge cases of section 6c
const ALL_IDS = IDS.concat(extras.videos.map((v) => v.id)), ALL_KEYS = KEYS.concat(extras.keys);
const synthetic = videos.filter((v) => !v.real);
const byName = (name) => videos.find((v) => v.name === name);
const mine = (rel) => ALL_IDS.some((id) => rel.includes(id)) || ALL_KEYS.some((k) => rel.split(path.sep).includes(k));
const cacheOthers = () => listing(CACHE).filter((l) => !mine(l.split('|')[0]) && !/picks\.lock/.test(l));
const cleanCache = () => {
  for (const id of ALL_IDS) api({ action: 'delete_video', id });
  for (const key of ALL_KEYS) api({ action: 'delete_candidates', key });
};

// before anything runs
cleanCache();                                       // leftovers of a crashed earlier run of this check
const savedBefore = hash(listing(SAVED));
const repoVideosBefore = listing(REPO_ROOT, { only: VIDEO_RE, skip: ['.git', 'node_modules'] });
const xamppTmpBefore = listing(XAMPP_TMP);
const cacheOthersBefore = cacheOthers();

const c = await launchChrome({ port: 9481, width: 1366, height: 768, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const ev = (e) => c.evaluate(e);
const waitFor = async (expr, ms = 20000, step = 200) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(step); } return false; };
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
const statusText = () => ev(`document.getElementById('bi-status').textContent`);
const S = 'BulkImport.state';
const click = (id) => ev(`document.getElementById('${id}').click(); 1`);
const pickFolder = async (dir = folder.dir) => {
  const doc = await c.send('DOM.getDocument', {});
  const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#bi-folder' });
  await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [dir] });
  return waitFor(`${S}.folder.files > 0 && !${S}.folder.loading && ${S}.cacheLoaded`, 15000);
};
// Reloads the page (it used to set the PIN unlock flag; since the accounts-quiz phase the page opens for a
// logged-in admin, which tests/video-capture/cdp.mjs logs in before the first admin page).
const UNLOCK = `location.reload(); 1`;
const openPage = async () => {
  await c.navigate(PAGE);
  await ev(UNLOCK);
  await sleep(1500);
  return waitFor(`!!window.BulkImport && document.getElementById('bi-ui').classList.contains('active') && ${S}.engines === 'ready'`, 60000);
};
const rows = () => ev(`${S}.videos.map(r => ({ name: r.name, id: r.id, status: r.status, error: r.error, cached: r.cached, did: r.did, timing: r.timing, progress: r.progress }))`);
const run = () => ev(`(() => { const r = ${S}.run; return { status: r.status, index: r.index, counts: r.counts, elapsedMs: r.elapsedMs, etaMs: r.etaMs, rate: r.rate, current: r.current && { name: r.current.name, status: r.current.status, progress: r.current.progress } }; })()`);
const buttons = () => ev(`({ start: document.getElementById('bi-start').disabled, pause: document.getElementById('bi-pause').disabled, resume: document.getElementById('bi-resume').disabled })`);
// Is something drawn on the preview (anything that is not the empty stage's colour)?
const previewDrawn = () => ev(`(() => { const cv = document.getElementById('bi-preview'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== 26 || d[i + 1] !== 37 || d[i + 2] !== 64) n++; return n; })()`);
const setAvatarBox = (signer, on) => ev(`(() => { const b = document.querySelector('#bi-avatar input[data-signer="${signer}"]'); if (b.checked !== ${on}) b.click(); return 1; })()`);
// Start (or Resume) was pressed: poll until the queue is done; returns what was seen on the way.
const watchRun = async (ms = 900000) => {
  const seen = { etaDashFirst: null, etaShown: false, previewMax: 0, counts: new Set(), files: new Set(), rateShown: false };
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await ev(`({ status: ${S}.run.status, done: ${S}.run.work.videos, eta: document.getElementById('bi-eta').textContent, rate: document.getElementById('bi-rate').textContent,
      count: document.getElementById('bi-run-count').textContent, file: document.getElementById('bi-run-file').textContent, progress: document.getElementById('bi-progress').value })`);
    if (s.status === 'done') return seen;
    if (seen.etaDashFirst === null && s.done === 0) seen.etaDashFirst = s.eta === '—';
    if (s.done > 0 && /^\d+:\d\d$/.test(s.eta)) seen.etaShown = true;
    if (s.done > 0 && /s per video s$/.test(s.rate)) seen.rateShown = true;
    seen.counts.add(s.count); seen.files.add(s.file);
    seen.previewMax = Math.max(seen.previewMax, await previewDrawn());
    if (s.done > 0 && seen.previewMax > 50 && !seen.shot) { seen.shot = true; await shot(`bulk-extract-${Date.now()}.png`); }
    await sleep(400);
  }
  return null;
};
const msPerFrame = (list, key) => {
  const ms = list.reduce((a, r) => a + r.timing[key + 'Ms'], 0), n = list.reduce((a, r) => a + r.timing[key + 'Frames'], 0);
  return { ms: Math.round(ms), frames: n, per: n ? Math.round(ms / n * 10) / 10 : null };
};
const report = [];
// In the page: preview ON for P01's videos, OFF for P02's, set as each video starts; when a video
// ends, what the preview canvas holds and the video's timing are recorded in window.__ab.
const AB = `(() => { window.__ab = []; document.addEventListener('bulkimport:row', (e) => {
  const row = ${S}.videos.find(r => r.id === e.detail.id);
  if (e.detail.status === 'started') { BulkImport.setPreview(row.parsed.signer === 'P01'); return; }
  const cv = document.getElementById('bi-preview'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== 26 || d[i + 1] !== 37 || d[i + 2] !== 64) n++;
  window.__ab.push({ name: row.name, status: row.status, preview: ${S}.preview, drawn: n, timing: row.timing });
}); return 1; })()`;

try {
  await c.send('Network.enable', { maxPostDataSize: 16 * 1024 * 1024 });   // POST bodies inline in the log

  // ── 1. Admin login (no PIN), folder, signer lists ──
  await c.navigate(PAGE);
  check('admin: the page opens at once, no PIN pad', await ev(`!document.getElementById('pin-screen') && !document.querySelector('[data-pin]') && document.getElementById('bi-ui').classList.contains('active')`));
  check('"Back" goes to gesture-training.html', await ev(`document.querySelector('.bi-back').getAttribute('href') === 'gesture-training.html'`));
  await ev(UNLOCK);
  await sleep(1500);
  check('extractors ready (Holistic initialised before setupMediaPipe)', await waitFor(`${S}.engines === 'ready'`, 60000), await ev(`${S}.engines + ' / simd ' + ${S}.simd + ' / ' + ${S}.engineError`));
  check('Start is disabled before a folder is chosen', (await buttons()).start);
  check('step bar: Folder, Extract, Review, Import, Avatar; a panel for each, all built',
    await ev(`JSON.stringify([...document.querySelectorAll('.bi-step')].map(b => b.dataset.step)) === '["folder","extract","review","import","avatar"]' && ['review','import','avatar'].every(s => document.getElementById('bi-step-' + s).children.length > 0)`));

  check('folder read', await pickFolder(), await statusText());
  const st = await ev(`(() => { const s = ${S}; return { videos: s.videos.map(r => ({ name: r.name, relPath: r.relPath, id: r.id, key: r.parsed.key, set: r.parsed.set, signer: r.parsed.signer, cached: r.cached, status: r.status })),
    problems: s.problems, ignored: s.folder.ignored, signs: s.signs, signers: s.signers, rec: s.recognitionSigners, av: s.avatarSigners,
    dom: ['videos','signs','signers','problems','cached'].map(k => document.getElementById('bi-n-' + k).textContent),
    problemRows: [...document.querySelectorAll('#bi-problems tbody tr')].map(tr => [...tr.children].map(td => td.textContent)),
    videoRows: document.querySelectorAll('#bi-videos tbody tr').length, folderName: document.getElementById('bi-folder-name').textContent, signersShown: !document.getElementById('bi-signers').hidden }; })()`);
  check('videos parsed, in file-name order', J(st.videos.map((v) => v.name)) === J(videos.map((v) => v.name)) && st.videos.every((v) => { const e = byName(v.name); return v.key === e.key && v.set === e.set && v.signer === e.signer; }), `${st.videos.length} videos`);
  check('video ids = first 32 hex of SHA-256(name|size|lastModified)', st.videos.every((v) => v.id === byName(v.name).id), st.videos[0].id);
  check('the bad file name is listed as a problem, never guessed', st.problems.length === 1 && st.problems[0].name === 'hello_final.webm' && st.problems[0].reason === 'bad file name' && J(st.problemRows) === J([['videos/hello_final.webm', 'bad file name']]) && st.problems[0].relPath === 'videos/hello_final.webm', J(st.problems));
  check('junk (desktop.ini) ignored silently', st.ignored === 1 && !J(st.problemRows).includes('desktop.ini') && !st.videos.some((v) => v.name === 'desktop.ini'));
  check('counts shown: videos, signs, signers, problems, already extracted', J(st.dom) === J([videos.length, KEYS.length, 2, 1, 0].map(String)) && st.videoRows === videos.length && st.folderName === 'videos · ' + folder.files.length + ' files (1 ignored)', J(st.dom) + ' ' + st.folderName);
  check('default lists: recognition = first 2 signers, avatar = first 3 found', st.signersShown && J(st.rec) === J(['P01', 'P02']) && J(st.av) === J(['P01', 'P02']) && J(st.signers) === J(['P01', 'P02']), `recognition ${J(st.rec)}, avatar ${J(st.av)}`);
  check('nothing cached yet: every video "waiting"', st.videos.every((v) => !v.cached && v.status === 'pending'));

  // avatar list: order + remembered
  await ev(`document.querySelector('.bi-move[data-signer="P02"][data-by="-1"]').click(); 1`);
  const moved = await ev(`({ av: ${S}.avatarSigners, role: document.querySelector('.bi-order-row[data-signer="P02"] .bi-order-role').textContent, ls: localStorage.getItem('sk_bulk_avatar_signers') })`);
  check('avatar list: "move up" makes P02 the default signer; remembered in localStorage', J(moved.av) === J(['P02', 'P01']) && moved.role === 'default signer' && moved.ls === J(['P02', 'P01']), J(moved));
  await ev(`document.querySelector('.bi-move[data-signer="P01"][data-by="-1"]').click(); 1`);
  await setAvatarBox('P02', false);
  const lists = await ev(`({ av: ${S}.avatarSigners, rec: ${S}.recognitionSigners, lsAv: localStorage.getItem('sk_bulk_avatar_signers'), lsRec: localStorage.getItem('sk_bulk_recognition_signers'), role: document.querySelector('.bi-order-row[data-signer="P02"] .bi-order-role').textContent })`);
  check('avatar list set to [P01] for the first run', J(lists.av) === J(['P01']) && lists.lsAv === J(['P01']) && lists.lsRec === J(['P01', 'P02']) && lists.role === 'not used', J(lists));

  // layout at 1366 and 1280 wide, both built steps
  const LAYOUT = (w) => `(() => { const out = [...document.querySelectorAll('#bi-ui *')].filter(e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width && !e.closest('.bi-scroll') && !e.classList.contains('bi-offscreen') && r.right > ${w} + 0.5; }).map(e => e.id || e.className);
    const inner = [...document.querySelectorAll('.bi-scroll')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).length;
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, out, inner }; })()`;
  const layouts = {};
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const step of ['folder', 'extract']) {
      await click('bi-tab-' + step);
      await sleep(150);
      layouts[`${w}/${step}`] = { w, h, ...(await ev(LAYOUT(w))) };
    }
  }
  check('no horizontal scroll at 1366 and at 1280 wide (Folder and Extract)', Object.values(layouts).every((l) => l.sw === l.w && l.sh === l.h && !l.out.length && !l.inner), J(layouts));
  await click('bi-tab-folder');
  await shot('bulk-folder.png');
  await click('bi-to-extract');
  check('"Next: Extract" opens the Extract step', await ev(`${S}.step === 'extract' && document.getElementById('bi-step-extract').classList.contains('active') && !document.getElementById('bi-step-folder').classList.contains('active')`));

  // ── 2. Full run, avatar list [P01] ──
  const b0 = await buttons();
  check('ready: Start enabled, Pause and Resume disabled', !b0.start && b0.pause && b0.resume, J(b0));
  let t0 = Date.now();
  await click('bi-start');
  const seen1 = await watchRun();
  const firstRunMs = Date.now() - t0;
  const rows1 = await rows();
  const run1 = await run();
  check('first run finished: every video extracted, none failed', !!seen1 && rows1.every((r) => r.status === 'done') && run1.counts.done === videos.length && run1.counts.failed === 0 && run1.counts.hands === videos.length,
    `${(firstRunMs / 1000).toFixed(1)} s, counts ${J(run1.counts)}; ${J(rows1.filter((r) => r.status !== 'done').map((r) => [r.name, r.status, r.error]))}`);
  check('while running: "Video i of n", the current file name, ETA "—" until one video is done then a time, the speed, a drawn preview',
    seen1 && seen1.etaDashFirst === true && seen1.etaShown && seen1.rateShown && seen1.previewMax > 50 && seen1.counts.has(`Video 1 of ${videos.length}`) && seen1.counts.has(`Video ${videos.length} of ${videos.length}`) && videos.every((v) => seen1.files.has(v.name)),
    seen1 ? `ETA "—" first: ${seen1.etaDashFirst}, ETA time later: ${seen1.etaShown}, speed: ${seen1.rateShown}, preview pixels drawn (sampled): ${seen1.previewMax}, counts seen: ${seen1.counts.size}, files seen: ${seen1.files.size - 1}` : 'timed out');
  const idx1 = index();
  check('cache index has every videoId', IDS.every((id) => idx1[id]));
  const META_KEYS = ['v', 'id', 'file', 'parsed', 'hands', 'seg', 'reps', 'bestRep', 'candidate', 'savedAt'];
  const shapeProblems = [];
  for (const v of videos) {
    const m = idx1[v.id];
    if (!m) { shapeProblems.push(v.name + ': not cached'); continue; }
    const st0 = fs.statSync(v.path);
    const bad = (why) => shapeProblems.push(v.name + ': ' + why);
    if (J(Object.keys(m)) !== J(META_KEYS)) bad('keys ' + J(Object.keys(m)));
    if (m.v !== 1 || m.id !== v.id) bad('v/id');
    if (J(m.file) !== J({ name: v.name, size: st0.size, lastModified: Math.round(st0.mtimeMs), relPath: 'videos/' + v.name })) bad('file ' + J(m.file));
    if (J(m.parsed) !== J({ set: v.set, label: v.key, key: v.key, signer: v.signer })) bad('parsed ' + J(m.parsed));
    if (J(Object.keys(m.hands)) !== J(['videoWidth', 'videoHeight', 'fps', 'durationMs', 'input', 'frameCount', 'handFrames', 'ms'])) bad('hands keys ' + J(Object.keys(m.hands)));
    if (m.hands.fps !== 15 || !(m.hands.ms > 0) || m.hands.frameCount !== Math.ceil(m.hands.durationMs / 1000 * 15) || !(m.hands.handFrames > 0) || !m.hands.input.contentRect) bad('hands ' + J(m.hands));
    if (J(Object.keys(m.seg)) !== J(['ok', 'reason', 'repsFound'])) bad('seg ' + J(m.seg));
    if (!m.reps.every((r) => J(Object.keys(r)) === J(['index', 'startMs', 'endMs', 'frames', 'handFrames', 'twoHandFrames', 'rows']) && r.rows === Math.min(30, r.handFrames))) bad('reps ' + J(m.reps));
    if (m.reps.length && J(m.bestRep) !== J(Core.pickBestRep(m.reps, m.hands.durationMs, m.seg))) bad('bestRep ' + J(m.bestRep));
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.savedAt)) bad('savedAt ' + m.savedAt);
    if (J(JSON.parse(fs.readFileSync(metaFile(v.id), 'utf8'))) !== J(m)) bad('meta file differs from the index');
  }
  check('meta.json of every video has the contract\'s shape', shapeProblems.length === 0, shapeProblems.join('; ').slice(0, 600));
  check('repetitions found: 3 for the normal videos, 2 for the 2-repetition one',
    synthetic.every((v) => { const m = idx1[v.id]; return m && m.seg.repsFound === v.reps && m.reps.length === v.reps && m.seg.ok === (v.reps === 3) && m.seg.reason === (v.reps === 3 ? null : 'too-few-reps'); }),
    videos.map((v) => `${v.name.replace(/^ESL_zz_|\.\w+$/g, '')}: ${idx1[v.id] ? idx1[v.id].seg.repsFound : '?'}`).join(', '));
  const tableReps = await ev(`[...document.querySelectorAll('#bi-videos tbody tr')].map(tr => [tr.children[0].textContent, tr.children[1].textContent, tr.children[2].textContent, tr.children[3].textContent, tr.children[4].textContent, tr.children[5].textContent, tr.children[6].textContent])`);
  check('result table: file, sign, set, signer, reps, status, candidate per video',
    tableReps.length === videos.length && tableReps.every((t) => { const v = byName(t[0].replace('videos/', '')), m = idx1[v.id]; return t[1] === v.key && t[2] === v.set && t[3] === v.signer && t[4] === String(m.seg.repsFound) && t[5] === 'done' && (v.signer === 'P01' ? /^\d+ frames \(rep \d\)$/.test(t[6]) : t[6] === '—'); }),
    J(tableReps[0]) + ' … ' + J(tableReps[1]));
  const handsProblems = [];
  let handsBytes = 0;
  for (const v of videos) {
    const m = idx1[v.id];
    const h = fs.existsSync(handsFile(v.id)) ? JSON.parse(fs.readFileSync(handsFile(v.id), 'utf8')) : null;
    const bad = (why) => handsProblems.push(v.name + ': ' + why);
    if (!h) { bad('no hands.json'); continue; }
    handsBytes += fs.statSync(handsFile(v.id)).size;
    if (J(Object.keys(h)) !== J(['id', 'meta', 'reps']) || h.id !== v.id) bad('keys');
    if (J(h.meta) !== J({ videoWidth: m.hands.videoWidth, videoHeight: m.hands.videoHeight, fps: m.hands.fps, input: m.hands.input })) bad('meta ' + J(h.meta));
    if (h.reps.length !== m.reps.length) { bad('rep count'); continue; }
    h.reps.forEach((rep, i) => {
      const s = m.reps[i], f = rep.frames;
      const withHand = f.filter((x) => x.hands.length > 0).length;
      if (rep.index !== s.index || f.length !== s.frames || withHand !== s.handFrames || f[0].t !== s.startMs || f[f.length - 1].t !== s.endMs || !f[0].hands.length || !f[f.length - 1].hands.length
        || !f.every((x) => typeof x.t === 'number' && x.hands.every((hd) => hd.landmarks.length === 21 && typeof hd.label === 'string' && typeof hd.landmarks[0].x === 'number'))) bad('rep ' + rep.index);
    });
    if (J(apiGet('action=hands&id=' + v.id).json.reps) !== J(h.reps)) bad('GET hands differs');
  }
  check('hands.json of every video holds each repetition\'s v3 frames (first and last frame with a hand)', handsProblems.length === 0, handsProblems.join('; ').slice(0, 600) || `${Math.round(handsBytes / 1024)} KB for ${videos.length} videos`);
  const cands1 = apiGet('action=candidates').json.candidates;
  const mineCands = (all) => Object.fromEntries(KEYS.map((k) => [k, (all[k] || []).map((x) => x.signer).sort()]));
  const expect1 = Object.fromEntries(KEYS.map((k) => [k, videos.some((v) => v.key === k && v.signer === 'P01') ? ['P01'] : []]));
  check('candidates exist exactly for the avatar-list signer (P01)', J(mineCands(cands1)) === J(expect1), J(mineCands(cands1)));
  const candProblems = [];
  const checkCandidate = (v) => {
    const m = index()[v.id];
    const r = apiGet(`action=candidate&key=${v.key}&signer=${v.signer}`);
    const cand = r.json.candidate;
    const bad = (why) => candProblems.push(`${v.name}: ${why}`);
    if (r.status !== 200 || !cand) return bad('no candidate (' + r.status + ')');
    const val = Clip.validateClip(cand.clip);
    if (!val.ok) bad('validateClip: ' + val.error);
    if (cand.clip.signer !== v.signer || cand.clip.key !== v.key || cand.videoId !== v.id) bad(`signer ${cand.clip.signer}, key ${cand.clip.key}`);
    const c0 = m.candidate;
    if (!c0 || c0.state !== 'ok' || c0.signer !== v.signer || c0.frames !== cand.clip.frames.length || c0.repIndex !== m.bestRep.index || cand.repIndex !== m.bestRep.index || !(c0.ms > 0)) bad('meta.candidate ' + J(c0));
    if (!cand.clip.frames.some((f) => f[0])) bad('no pose in any frame');
    if (!(cand.clip.trim.startMs >= m.bestRep.windowStartMs - 40 && cand.clip.trim.endMs <= m.bestRep.windowEndMs + 40)) bad(`trim ${J(cand.clip.trim)} outside the window ${J(m.bestRep)}`);
    return cand;
  };
  const p01 = synthetic.filter((v) => v.signer === 'P01'), p02 = synthetic.filter((v) => v.signer === 'P02');
  const clips1 = p01.map(checkCandidate);
  check('each P01 candidate: valid sk_avatar_clip_v1, signer set, key = the sign key, inside the best repetition\'s window', candProblems.length === 0,
    candProblems.join('; ').slice(0, 600) || clips1.map((x) => `${x.clip.key}: ${x.clip.frames.length} frames, rep ${x.repIndex}`).join('; '));
  check('a non-avatar signer\'s meta.candidate is null', p02.every((v) => idx1[v.id].candidate === null));
  check('the 2-repetition video still gets a candidate from its best repetition', (cands1[TWO_REPS_KEY] || []).length === 1 && idx1[byName(`ESL_${TWO_REPS_KEY}_P01.webm`).id].candidate.state === 'ok');
  if (folder.realVideo) {
    const m = idx1[byName('ESL_zz_test_P01.mp4').id];
    check('the real video (ESL_zz_test_P01.mp4) was extracted and cached', !!m && m.hands.frameCount > 0, m ? `${m.hands.videoWidth}x${m.hands.videoHeight}, ${m.hands.durationMs} ms, reps ${m.seg.repsFound} (${m.seg.reason || 'ok'}), candidate ${J(m.candidate)}` : 'missing');
  }
  const on = { hands: msPerFrame(rows1, 'hands'), holistic: msPerFrame(rows1.filter((r) => r.timing.holisticFrames), 'holistic') };
  report.push(`run 2 (preview ON, ${videos.length} videos): Hands ${on.hands.per} ms/frame (${on.hands.frames} frames, ${on.hands.ms} ms); Holistic ${on.holistic.per} ms/frame (${on.holistic.frames} frames, ${on.holistic.ms} ms)`);
  const videoMs = videos.reduce((a, v) => a + idx1[v.id].hands.durationMs, 0);
  report.push(`run 2: ${(firstRunMs / 1000).toFixed(1)} s wall for ${(videoMs / 1000).toFixed(1)} s of video = ${(firstRunMs / videoMs).toFixed(2)} s per video second; Hands pass alone ${(on.hands.ms / videoMs).toFixed(2)}x the video length`);

  // ── 3. Reload, same folder: nothing to do ──
  const sigs = () => Object.fromEntries(IDS.flatMap((id) => [[id + '.meta', fileSig(metaFile(id))], [id + '.hands', fileSig(handsFile(id))]]));
  const sigs1 = sigs();
  check('page reopened, extractors ready', await openPage());
  check('same folder chosen again', await pickFolder());
  const st3 = await ev(`({ cached: ${S}.videos.filter(r => r.cached).length, statuses: ${S}.videos.map(r => r.status), av: ${S}.avatarSigners, rec: ${S}.recognitionSigners, dom: document.getElementById('bi-n-cached').textContent, cells: [...document.querySelectorAll('#bi-videos td.bi-st')].map(td => td.textContent) })`);
  check('every video marked "already extracted"; the signer lists were remembered', st3.cached === videos.length && st3.statuses.every((s) => s === 'cached') && st3.dom === String(videos.length) && st3.cells.every((t) => t === 'already extracted') && J(st3.av) === J(['P01']) && J(st3.rec) === J(['P01', 'P02']), J({ cached: st3.cached, av: st3.av }));
  const posts3 = c.getNetworkRequests().filter((r) => r.method === 'POST').length;
  t0 = Date.now();
  await click('bi-start');
  await waitFor(`${S}.run.status === 'done'`, 60000, 50);
  const secondRunMs = Date.now() - t0;
  const run3 = await run();
  check('second run: 0 videos extracted, all skipped, no POST, cache files untouched', run3.counts.hands === 0 && run3.counts.holistic === 0 && run3.counts.done === 0 && run3.counts.skipped === videos.length && c.getNetworkRequests().filter((r) => r.method === 'POST').length === posts3 && J(sigs()) === J(sigs1), J(run3.counts));
  check('second run takes well under the first run\'s time', secondRunMs < firstRunMs / 10, `${secondRunMs} ms vs ${firstRunMs} ms`);

  // ── 4. P02 added to the avatar list later: only the Holistic step, for P02's videos ──
  await click('bi-tab-folder');
  await setAvatarBox('P02', true);
  const plan4 = await ev(`({ av: ${S}.avatarSigners, plan: ${S}.videos.map(r => BulkImport.planWork(r)), cells: [...document.querySelectorAll('#bi-videos td.bi-cand')].map(td => td.textContent) })`);
  check('P02 ticked: fallback 1; its videos need the candidate step only', J(plan4.av) === J(['P01', 'P02']) && J(plan4.plan) === J(videos.map((v) => (v.signer === 'P02' ? 'candidate' : 'skip'))) && videos.every((v, i) => v.signer !== 'P02' || plan4.cells[i] === 'not yet'), J(plan4.plan));
  await click('bi-tab-extract');
  await click('bi-start');
  check('third run finished', !!(await watchRun()));
  const rows4 = await rows(), run4 = await run(), idx4 = index(), sigs4 = sigs();
  check('only the Holistic step ran, for P02\'s videos (Hands: 0 videos)', run4.counts.hands === 0 && run4.counts.holistic === p02.length && run4.counts.done === p02.length && run4.counts.skipped === videos.length - p02.length
    && rows4.every((r) => (byName(r.name).signer === 'P02' ? r.did && !r.did.hands && r.did.holistic && r.timing.handsFrames === 0 && r.timing.holisticFrames > 0 : r.did === null)), J(run4.counts));
  check('no hands.json rewritten; P01 metas untouched; P02 metas keep hands.ms and savedAt', IDS.every((id) => sigs4[id + '.hands'] === sigs1[id + '.hands'])
    && videos.every((v) => (v.signer === 'P02' ? sigs4[v.id + '.meta'] !== sigs1[v.id + '.meta'] && idx4[v.id].hands.ms === idx1[v.id].hands.ms && idx4[v.id].savedAt === idx1[v.id].savedAt && J({ ...idx4[v.id], candidate: null }) === J(idx1[v.id]) : sigs4[v.id + '.meta'] === sigs1[v.id + '.meta'])));
  const clips4 = p02.map(checkCandidate);
  const cands4 = mineCands(apiGet('action=candidates').json.candidates);
  check('candidates for P02 now exist and are valid; P01\'s are still there', candProblems.length === 0 && KEYS.every((k) => J(cands4[k]) === J(videos.filter((v) => v.key === k).map((v) => v.signer).sort())),
    candProblems.join('; ').slice(0, 400) || J(cands4) + '; ' + clips4.map((x) => `${x.clip.key}/${x.clip.signer}: ${x.clip.frames.length} frames`).join('; '));
  check('status cell says "done (avatar clip only)"', await ev(`[...document.querySelectorAll('#bi-videos td.bi-st')].filter(td => td.textContent === 'done (avatar clip only)').length`) === p02.length);

  // ── 5. Kill mid-extraction; preview ON / OFF video by video (the comparison) ──
  cleanCache();
  check('cache cleared for the kill test', IDS.every((id) => !index()[id]));
  await openPage();
  await pickFolder();
  await click('bi-preview-on');
  check('fresh folder: nothing cached; the preview checkbox switches the preview off', await ev(`${S}.videos.every(r => !r.cached) && ${S}.preview === false && !document.getElementById('bi-preview-on').checked`));
  await ev(AB);
  await click('bi-start');
  const reached = await waitFor(`${S}.run.index === 2 && ${S}.run.current && ${S}.run.current.status === 'hands' && ${S}.run.current.progress > 0.3`, 300000, 100);
  const before = await run();
  const ab = await ev(`window.__ab`);
  await c.navigate('about:blank');                  // the tab is gone mid-video
  const idxKill = index();
  check('killed while video 3 was in progress: videos 1 and 2 are cached, nothing else', reached && IDS.every((id, i) => !!idxKill[id] === (i < 2)) && !fs.existsSync(handsFile(IDS[2])), `at ${J(before.current)}; cached: ${IDS.filter((id) => idxKill[id]).length}`);
  await openPage();
  await pickFolder();
  await ev(AB);
  const st5 = await ev(`({ cached: ${S}.videos.map(r => r.cached), plan: ${S}.videos.map(r => BulkImport.planWork(r)) })`);
  check('reopened: the 2 finished videos are marked extracted, the rest is still to do', J(st5.cached) === J(IDS.map((_, i) => i < 2)) && J(st5.plan) === J(IDS.map((_, i) => (i < 2 ? 'skip' : 'full'))), J(st5.plan));
  await click('bi-start');
  const seen5 = await watchRun();
  const rows5 = await rows(), run5 = await run(), idx5 = index();
  check('after the kill: finished videos skipped, the rest extracted, cache complete', !!seen5 && run5.counts.skipped === 2 && run5.counts.hands === videos.length - 2 && run5.counts.failed === 0 && IDS.every((id) => idx5[id]) && rows5.every((r, i) => r.status === (i < 2 ? 'skipped' : 'done')), J(run5.counts));
  ab.push(...(await ev(`window.__ab`)));
  const abOn = ab.filter((r) => r.preview && byName(r.name).signer === 'P01' && byName(r.name).key !== TWO_REPS_KEY && !byName(r.name).real), abOff = ab.filter((r) => !r.preview && byName(r.name).signer === 'P02');
  check('preview ON for the P01 videos draws the frames, OFF for the P02 videos draws nothing; every video ran both passes', ab.length === videos.length && abOn.length === abOff.length && abOn.length === p02.length && ab.every((r) => r.status === 'done' && r.timing.handsFrames > 0 && r.timing.holisticFrames > 0 && (r.preview ? r.drawn > 50 : r.drawn === 0)),
    J(ab.map((r) => [r.name.replace(/^ESL_zz_bulk_|\.webm$/g, ''), r.preview ? 'on' : 'off', r.drawn])));
  for (const [label, list] of [['ON  (P01 copies)', abOn], ['OFF (P02 copies)', abOff]]) {
    const h = msPerFrame(list, 'hands'), o = msPerFrame(list, 'holistic');
    report.push(`run 5, same recordings interleaved — preview ${label}: Hands ${h.per} ms/frame (${h.frames} frames), Holistic ${o.per} ms/frame (${o.frames} frames)`);
  }
  report.push('run 5 per video (Hands ms/frame, Holistic ms/frame): ' + ab.map((r) => `${r.name.replace(/^ESL_zz_bulk_|\.webm$/g, '')} ${r.preview ? 'on' : 'off'} ${(r.timing.handsMs / r.timing.handsFrames).toFixed(0)}/${(r.timing.holisticMs / r.timing.holisticFrames).toFixed(0)}`).join(', '));
  const sameBytes = (v) => fs.existsSync(handsFile(v.id)) && crypto.createHash('sha1').update(fs.readFileSync(handsFile(v.id))).digest('hex') === sigs1[v.id + '.hands'].split(':')[2];
  check('extracted again: the same repetitions as in the first run', videos.every((v) => idx5[v.id].seg.repsFound === idx1[v.id].seg.repsFound && idx5[v.id].hands.frameCount === idx1[v.id].hands.frameCount),
    `hands.json byte-identical to the first run for ${videos.filter(sameBytes).length} of ${videos.length} videos (not required)`);

  // ── 6. Pause / Resume ──
  const target = videos[0];
  api({ action: 'delete_video', id: target.id });
  await ev(`BulkImport.refreshCache().then(() => 1)`);
  check('one video removed from the cache: it is the only one to do', J(await ev(`${S}.videos.map(r => BulkImport.planWork(r))`)) === J(videos.map((v) => (v === target ? 'full' : 'skip'))));
  const doneBefore = await ev(`${S}.timings.hands.videos`);
  await click('bi-start');
  await waitFor(`${S}.run.current && ${S}.run.current.status === 'hands' && ${S}.run.current.progress > 0.4`, 120000, 50);
  await click('bi-pause');
  await waitFor(`${S}.run.status === 'paused' && !${S}.run.current`, 20000, 50);
  await sleep(300);
  const p1 = { run: await run(), row: (await rows())[0], b: await buttons(), cached: !!index()[target.id], status: await statusText(), videos: await ev(`${S}.timings.hands.videos`) };
  check('Pause during the Hands pass: the video is dropped (not cached), Resume is offered', p1.run.status === 'paused' && p1.row.status === 'pending' && p1.row.progress === 0 && !p1.cached && p1.b.start && p1.b.pause && !p1.b.resume && p1.videos === doneBefore && /^Paused/.test(p1.status), J({ row: p1.row.status, buttons: p1.b }));
  await click('bi-resume');
  await waitFor(`${S}.run.current && ${S}.run.current.status === 'holistic' && ${S}.run.current.progress > 0.4`, 120000, 50);
  await click('bi-pause');
  await waitFor(`${S}.run.status === 'paused' && !${S}.run.current`, 20000, 50);
  await sleep(300);
  const handsSig6 = fileSig(handsFile(target.id));
  const p2 = { row: (await rows())[0], meta: index()[target.id], hands: fs.existsSync(handsFile(target.id)), src: await ev(`document.getElementById('bi-video').getAttribute('src')`), plan: await ev(`BulkImport.planWork(${S}.videos[0])`), counts: (await run()).counts };
  check('Pause during the Holistic pass: the Hands result is already cached (candidate null) and is kept; the video element is released', p2.row.status === 'cached' && p2.row.cached && !!p2.meta && p2.meta.candidate === null && p2.meta.seg.repsFound === 3 && p2.hands && !p2.src && p2.plan === 'candidate' && p2.counts.hands === 1 && p2.counts.holistic === 0,
    J({ row: p2.row.status, plan: p2.plan, candidate: p2.meta && p2.meta.candidate, counts: p2.counts }));
  await click('bi-resume');
  check('run finished after Resume', !!(await watchRun(300000)));
  const rows6 = await rows(), run6 = await run(), idx6 = index();
  const m6 = idx6[target.id];
  check('Resume ran only the candidate step (hands.json unchanged, Hands not redone); the final cache is complete', run6.counts.hands === 1 && run6.counts.holistic === 1 && run6.counts.failed === 0 && rows6[0].status === 'done' && !!m6 && J(rows6[0].did) === J({ hands: false, holistic: true }) && rows6[0].timing.handsFrames === 0
    && fileSig(handsFile(target.id)) === handsSig6 && m6.savedAt === p2.meta.savedAt && m6.hands.frameCount === idx1[target.id].hands.frameCount && m6.candidate && m6.candidate.state === 'ok' && await ev(`${S}.timings.hands.videos`) === doneBefore + 1
    && IDS.every((id) => idx6[id] && fs.existsSync(handsFile(id))), J(run6.counts) + ', did ' + J(rows6[0].did));

  // ── 6b. A dead cache ──
  // In the page: the next fetch that matches is answered as if the server were gone (rejected) or
  // broken (HTTP 500), once. Nothing reaches Apache for it.
  await ev(`(() => { const real = window.fetch; window.__trap = null; window.__trapped = [];
    window.fetch = function (url, o) { const t = window.__trap; const body = (o && o.body) || '';
      if (t && (t.index ? String(url).indexOf('action=index') >= 0 : body.indexOf('"action":"' + t.action + '"') >= 0)) {
        window.__trap = null; window.__trapped.push(t.index ? 'index' : t.action);
        return t.http ? Promise.resolve(new Response(JSON.stringify({ success: false, error: 'zz server error' }), { status: t.http })) : Promise.reject(new TypeError('Failed to fetch'));
      }
      return real.apply(this, arguments); }; return 1; })()`);
  api({ action: 'delete_video', id: target.id });
  api({ action: 'delete_candidates', key: target.key });
  const postsBefore = c.getNetworkRequests().filter((r) => r.method === 'POST').length;
  await ev(`window.__trap = { index: true }; 1`);
  await click('bi-start');
  await waitFor(`${S}.run.status === 'idle' && /could not be read/.test(document.getElementById('bi-status').textContent)`, 10000, 50);
  const d0 = { run: await run(), msg: await statusText(), b: await buttons(), loaded: await ev(`${S}.cacheLoaded`), err: await ev(`document.getElementById('bi-status').classList.contains('error')`) };
  check('Start with a cache that cannot be read: nothing is extracted, a clear status, Start offered again', d0.run.status === 'idle' && d0.loaded === false && d0.err && !d0.b.start && /^The cache could not be read: .*Check that Apache is running, then press Start\.$/.test(d0.msg) && c.getNetworkRequests().filter((r) => r.method === 'POST').length === postsBefore, d0.msg);
  await ev(`window.__trap = { action: 'put_video' }; 1`);
  await click('bi-start');
  await waitFor(`${S}.run.status === 'paused' && !${S}.run.current`, 300000, 100);
  const d1 = { run: await run(), row: (await rows())[0], msg: await statusText(), b: await buttons(), cached: !!index()[target.id], err: await ev(`document.getElementById('bi-status').classList.contains('error')`) };
  check('put_video fails (no answer): the queue pauses with a clear status instead of moving on; the row is not failed', d1.run.status === 'paused' && d1.run.index === 0 && d1.run.counts.failed === 0 && d1.row.status === 'pending' && !d1.cached && d1.err && !d1.b.resume
    && /^The cache could not be written: .*Check that Apache is running, then Resume\.$/.test(d1.msg), d1.msg);
  await ev(`window.__trap = { action: 'put_candidate', http: 500 }; 1`);
  await click('bi-resume');
  await waitFor(`${S}.run.status === 'paused' && !${S}.run.current && window.__trapped.length === 3`, 300000, 100);
  const handsSigB = fileSig(handsFile(target.id));
  const d2 = { run: await run(), row: (await rows())[0], msg: await statusText(), meta: index()[target.id], cand: apiGet(`action=candidate&key=${target.key}&signer=P01`).status };
  check('Resume redoes the video; put_candidate fails (HTTP 500): paused again, the Hands result stays cached with candidate null, no candidate file', d2.run.status === 'paused' && d2.run.counts.hands === 1 && d2.run.counts.failed === 0 && d2.row.status === 'cached' && !!d2.meta && d2.meta.candidate === null && d2.cand === 404
    && /^The cache could not be written: zz server error\. Check that Apache is running, then Resume\.$/.test(d2.msg), d2.msg);
  await click('bi-resume');
  check('run finished after the second Resume', !!(await watchRun(300000)));
  const d3 = { run: await run(), row: (await rows())[0], meta: index()[target.id], trapped: await ev(`window.__trapped`) };
  check('Resume completes it with the Hands pass not redone (hands.json unchanged)', d3.run.counts.hands === 1 && d3.run.counts.holistic === 1 && d3.run.counts.failed === 0 && d3.row.status === 'done' && J(d3.row.did) === J({ hands: false, holistic: true }) && fileSig(handsFile(target.id)) === handsSigB
    && d3.meta.candidate && d3.meta.candidate.state === 'ok' && apiGet(`action=candidate&key=${target.key}&signer=P01`).json.candidate.videoId === target.id && J(d3.trapped) === J(['index', 'put_video', 'put_candidate']), J(d3.run.counts));
  // The candidate carries the SET of its video (a clip of an ESL video is never offered to an FSL sign).
  const candPosts = c.getNetworkRequests().filter((r) => r.method === 'POST' && /^\{"action":"put_candidate"/.test(r.postData || '')).map((r) => JSON.parse(r.postData));
  const storedCand = apiGet(`action=candidate&key=${target.key}&signer=P01`).json.candidate;
  check('every put_candidate carries the video\'s set (ESL here); it is stored with the candidate and listed', candPosts.length > 0 && candPosts.every((b) => b.set === 'ESL' && b.key.startsWith('zz_')) && storedCand.set === 'ESL'
    && apiGet('action=candidates&key=' + target.key).json.candidates[target.key].every((x) => x.set === 'ESL'), `${candPosts.length} put_candidate POSTs`);
  // The Holistic step itself fails (AvatarClip.packFrame, which the extractor calls per frame, throws).
  api({ action: 'delete_video', id: target.id });
  await ev(`(() => { window.__pack = AvatarClip.packFrame; AvatarClip.packFrame = function () { throw new Error('zz holistic broke'); }; return 1; })()`);
  await click('bi-start');
  await waitFor(`${S}.run.status === 'done'`, 300000, 100);
  await ev(`AvatarClip.packFrame = window.__pack; 1`);
  const f1 = { run: await run(), row: (await rows())[0], meta: index()[target.id], cell: await ev(`document.querySelector('#bi-videos tbody tr td.bi-st').textContent`), plan: await ev(`BulkImport.planWork(${S}.videos[0])`), msg: await statusText() };
  const handsSigF = fileSig(handsFile(target.id));
  check('a Holistic failure keeps the cached Hands result: the row reads "avatar clip failed: … (recognition data kept)" and the queue goes on', f1.run.counts.failed === 1 && f1.run.counts.hands === 1 && f1.row.status === 'failed' && f1.row.cached && !!f1.meta && f1.meta.candidate === null
    && f1.cell === 'avatar clip failed: zz holistic broke (recognition data kept)' && f1.plan === 'candidate' && /1 failed/.test(f1.msg), f1.cell);
  await click('bi-start');
  check('run finished after the Holistic failure', !!(await watchRun(300000)));
  const f2 = { run: await run(), row: (await rows())[0], meta: index()[target.id] };
  check('the next Start retries only the candidate step for it', f2.run.counts.hands === 0 && f2.run.counts.holistic === 1 && f2.run.counts.failed === 0 && f2.row.status === 'done' && f2.meta.candidate.state === 'ok' && fileSig(handsFile(target.id)) === handsSigF, J(f2.run.counts));
  await ev(`BulkImport.start(); BulkImport.pause(); 1`);
  await sleep(800);
  const sp = { run: await run(), b: await buttons() };
  await click('bi-resume');
  await waitFor(`${S}.run.status === 'done'`, 20000, 50);
  const sp2 = await run();
  check('Start then Pause in the same tick stays paused; Resume then runs the pass', sp.run.status === 'paused' && !sp.run.current && !sp.b.resume && sp.b.start && sp2.status === 'done' && sp2.counts.skipped === videos.length && sp2.counts.done === 0, J(sp.run.status) + ' -> ' + J(sp2.counts));

  // ── 6c. Edge-case folder ──
  // (the previous folder already satisfies pickFolder's wait: wait for THIS folder to be read)
  check('edge-case folder read', await pickFolder(extras.dir) && await waitFor(`${S}.videos.length === ${extras.videos.length} && !${S}.folder.loading && /^Found ${extras.videos.length} videos/.test(document.getElementById('bi-status').textContent)`, 15000, 50), await statusText());
  const x0 = await ev(`({ names: ${S}.videos.map(r => r.name), owns: ${S}.videos.map(r => r.ownsCandidate), dupOf: ${S}.videos.map(r => r.dupOf), av: ${S}.avatarSigners, cells: [...document.querySelectorAll('#bi-videos td.bi-cand')].map(td => td.textContent), signs: ${S}.signs })`);
  const iFirst = extras.videos.indexOf(extras.dupFirst), iSecond = extras.videos.indexOf(extras.dupSecond), iNone = extras.videos.indexOf(extras.none);
  check('two files of one sign by one signer: the first in file-name order owns the avatar candidate, the other says so in its row', J(x0.names) === J(extras.videos.map((v) => v.name)) && iFirst < iSecond && x0.owns[iFirst] === true && x0.owns[iSecond] === false && x0.dupOf[iSecond] === extras.dupFirst.name && x0.dupOf[iFirst] === null
    && J(x0.av) === J(['P01']) && J(x0.signs) === J(['zz_bulk_dup', 'zz_bulk_none', 'zz_bulk_take']) && x0.cells[iFirst] === 'not yet' && x0.cells[iSecond] === `none: ${extras.dupFirst.name} makes the clip of this sign and signer`, J(x0.cells));
  await click('bi-start');
  check('edge-case run finished', !!(await watchRun(300000)));
  const xi = index(), xr = await rows(), xrun = await run();
  const xc = await ev(`[...document.querySelectorAll('#bi-videos tbody tr')].map(tr => [tr.children[4].textContent, tr.children[5].textContent, tr.children[6].textContent])`);
  const mNone = xi[extras.none.id], mA = xi[extras.dupFirst.id], mB = xi[extras.dupSecond.id];
  const hNone = fs.existsSync(handsFile(extras.none.id)) ? JSON.parse(fs.readFileSync(handsFile(extras.none.id), 'utf8')) : null;
  check('a video with no repetition is cached: seg not ok, 0 reps, bestRep null, candidate none "no repetition found"', xrun.counts.failed === 0 && !!mNone && mNone.seg.ok === false && mNone.seg.repsFound === 0 && mNone.reps.length === 0 && mNone.bestRep === null && mNone.hands.handFrames === 0 && mNone.hands.frameCount > 0
    && mNone.candidate && mNone.candidate.state === 'none' && mNone.candidate.reason === 'no repetition found' && mNone.candidate.repIndex === null && hNone && Array.isArray(hNone.reps) && hNone.reps.length === 0 && xr[iNone].status === 'done'
    && J(xc[iNone]) === J(['0', 'done', 'none: no repetition found']) && Core.rowStatus(mNone).importable === false && apiGet(`action=candidate&key=${extras.none.key}&signer=P01`).status === 404,
    mNone ? `seg ${J(mNone.seg)}, candidate ${J(mNone.candidate)}, row ${J(xc[iNone])}` : 'not cached');
  const dupCand = apiGet(`action=candidate&key=${extras.dupFirst.key}&signer=P01`);
  check('duplicate sign+signer: both are cached with their repetitions; only the first made the candidate; nothing is stored for the later one (candidate null), its row says why and it has no work left', !!mA && !!mB && mA.seg.repsFound === 3 && mB.seg.repsFound === 3 && fs.existsSync(handsFile(extras.dupFirst.id)) && fs.existsSync(handsFile(extras.dupSecond.id))
    && mA.candidate.state === 'ok' && mB.candidate === null && dupCand.status === 200 && dupCand.json.candidate.videoId === extras.dupFirst.id && Clip.validateClip(dupCand.json.candidate.clip).ok
    && xr[iSecond].did.hands && !xr[iSecond].did.holistic && xc[iSecond][2] === `none: ${extras.dupFirst.name} makes the clip of this sign and signer` && xrun.counts.hands === 5 && xrun.counts.holistic === 2
    && await ev(`BulkImport.planWork(${S}.videos[${iSecond}])`) === 'skip',
    mA && mB ? `first ${J(mA.candidate)}; second ${J(mB.candidate)}; counts ${J(xrun.counts)}` : 'not cached');
  const iT1 = extras.videos.indexOf(extras.takeFirst), iT2 = extras.videos.indexOf(extras.takeSecond);
  const mT1 = xi[extras.takeFirst.id], mT2 = xi[extras.takeSecond.id];
  const takeCand = apiGet(`action=candidate&key=${extras.takeFirst.key}&signer=P01`);
  check('duplicate sign+signer whose FIRST file has no repetition: the second file makes the candidate', iT1 < iT2 && x0.owns[iT1] === true && x0.owns[iT2] === false && !!mT1 && !!mT2 && mT1.seg.repsFound === 0 && mT1.candidate && mT1.candidate.state === 'none' && mT1.candidate.reason === 'no repetition found'
    && mT2.seg.repsFound === 3 && mT2.candidate && mT2.candidate.state === 'ok' && takeCand.status === 200 && takeCand.json.candidate.videoId === extras.takeSecond.id && Clip.validateClip(takeCand.json.candidate.clip).ok
    && xr[iT2].did.hands && xr[iT2].did.holistic && /^\d+ frames \(rep \d\)$/.test(xc[iT2][2]) && xc[iT1][2] === 'none: no repetition found',
    mT1 && mT2 ? `first ${J(mT1.candidate)}; second ${J(mT2.candidate)}; candidate videoId ${takeCand.json.candidate && takeCand.json.candidate.videoId === extras.takeSecond.id ? 'the second file' : '?'}` : 'not cached');

  // A stored candidate is its own witness: when candidates/<key>/<SIGNER>.json comes from another
  // video (here it is rewritten with the second file's id), a meta that still says "ok" no longer
  // owns the clip. The row says so; the meta is not rewritten.
  const metaSigA = fileSig(metaFile(extras.dupFirst.id));
  api({ action: 'put_candidate', key: extras.dupFirst.key, signer: 'P01', set: 'ESL', videoId: extras.dupSecond.id, repIndex: dupCand.json.candidate.repIndex, clip: dupCand.json.candidate.clip });
  await ev(`BulkImport.refreshCache().then(() => 1)`);
  const taken = await ev(`({ cell: document.querySelectorAll('#bi-videos tbody tr')[${iFirst}].children[6].textContent, warn: document.querySelectorAll('#bi-videos tbody tr')[${iFirst}].children[6].classList.contains('bi-warn'), other: document.querySelectorAll('#bi-videos tbody tr')[${iSecond}].children[6].textContent, owners: ${S}.clipOwners.zz_bulk_dup })`);
  check('a video whose stored clip now comes from another video is shown as not owning it any more (the candidate file\'s videoId is trusted, its own meta is not rewritten)', taken.cell === `replaced: ${extras.dupSecond.name} now makes the clip of this sign and signer` && taken.warn && J(taken.owners) === J({ P01: extras.dupSecond.id })
    && fileSig(metaFile(extras.dupFirst.id)) === metaSigA && index()[extras.dupFirst.id].candidate.state === 'ok', taken.cell);

  // ── 6d. Hostile file names (Windows cannot hold "<" in a name: File objects through setFolder) ──
  const HOSTILE = ['ESL_zz_bulk<img src=x onerror="window.__xss=1">_P01.webm', 'ESL_zz_x_P01<img src=x onerror="window.__xss=2">.webm', '<b>bold<b><script>window.__xss=3<script>.txt'];
  await ev(`BulkImport.setFolder(${J(HOSTILE)}.map(n => new File(['x'], n))).then(() => 1)`);
  await sleep(600);
  const hx = await ev(`({ xss: window.__xss, injected: document.querySelectorAll('#bi-ui img, #bi-ui td b, #bi-ui td script, #bi-status img').length, videos: [...document.querySelectorAll('#bi-videos tbody tr')].map(tr => [tr.children[0].textContent, tr.children[1].textContent]),
    problems: [...document.querySelectorAll('#bi-problems tbody tr')].map(tr => tr.children[0].textContent), status: document.getElementById('bi-status').innerHTML, key: ${S}.videos[0] && ${S}.videos[0].parsed.key })`);
  check('hostile file names are shown as literal text (no element is created, no script runs)', hx.xss === undefined && hx.injected === 0 && J(hx.videos) === J([[HOSTILE[0], hx.key]]) && /^[a-z0-9_-]+$/.test(hx.key) && J(hx.problems.slice().sort()) === J([HOSTILE[1], HOSTILE[2]].sort()) && !/<img|<b>/.test(hx.status), J({ key: hx.key, problems: hx.problems.length }));

  // ── 6e. Holistic init fails once: Retry ──
  await c.navigate(PAGE);
  // The extractors start on DOMContentLoaded (no PIN to wait for since the accounts-quiz phase), so the
  // failing init is put in place before the page's scripts run.
  const failInit = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { const make = AvatarExtract.createExtractor; let n = 0; AvatarExtract.createExtractor = function () { const x = make(); if (n++ === 0) x.init = () => Promise.reject(new Error('zz holistic init failed')); return x; }; }, { capture: true });` });
  await ev(`location.reload(); 1`);
  await sleep(1500);
  await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: failInit.result.identifier });
  await waitFor(`${S}.engines === 'failed'`, 20000, 50);
  const r0 = { engines: await ev(`${S}.engines`), msg: await statusText(), retry: await ev(`!document.getElementById('bi-retry').hidden && document.getElementById('bi-retry').offsetHeight > 0`), handsSetUp: await ev(`!!window._simdOverrideApplied`), b: await buttons() };
  await click('bi-retry');
  const retried = await waitFor(`${S}.engines === 'ready'`, 60000, 100);
  const r1 = { retryHidden: await ev(`document.getElementById('bi-retry').hidden`), handsSetUp: await ev(`!!window._simdOverrideApplied`), msg: await statusText(), err: await ev(`${S}.engineError`) };
  check('Holistic init fails: the error and a Retry button are shown and Hands is NOT set up; Retry loads both extractors', r0.engines === 'failed' && /could not be loaded: zz holistic init failed/.test(r0.msg) && r0.retry && r0.handsSetUp === false && r0.b.start && retried && r1.retryHidden && r1.handsSetUp === true && r1.err === null, J(r0) + ' -> ' + J(r1));

  const errors = c.getConsoleErrors().concat(c.getExceptions());
  check('0 console errors', errors.length === 0, J(errors).slice(0, 600));

  // ── 7. No WebAssembly SIMD ──
  const noSimd = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const v = WebAssembly.validate; WebAssembly.validate = function (b) { const a = new Uint8Array(b.buffer || b); if (a.length < 64 && Array.prototype.indexOf.call(a, 253) >= 0) return false; return v.call(WebAssembly, b); }; })();` });
  await c.navigate(PAGE);
  await ev(UNLOCK);
  await sleep(1500);
  await waitFor(`!!window.BulkImport && document.getElementById('bi-ui').classList.contains('active')`, 10000);
  await pickFolder();
  const ns = { simd: await ev(`${S}.simd`), engines: await ev(`${S}.engines`), b: await buttons(), msg: await statusText(), err: await ev(`document.getElementById('bi-status').classList.contains('error')`), videos: await ev(`${S}.videos.length`) };
  await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noSimd.result.identifier });
  check('without WebAssembly SIMD: "must be run on the laptop\'s Chrome", Start disabled, the folder is still parsed', ns.simd === false && ns.engines === 'idle' && ns.b.start && ns.b.resume && ns.videos === videos.length && ns.err && /must be run on the laptop's Chrome/.test(ns.msg), ns.msg);

  // ── 8. Network and disk ──
  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  check('every request went to localhost (all other hosts blocked)', reqs.length > 0 && foreign.length === 0, `${reqs.length} requests, ${foreign.length} elsewhere`);
  const posts = reqs.filter((r) => r.method !== 'GET');
  const bodyProblems = [];
  let maxBody = 0, actions = {};
  for (const r of posts) {
    const body = r.postData !== null ? r.postData : r.hasPostData ? await c.getRequestPostData(r.requestId) : '';
    if (!/\/php\/api\/bulk_import\.php$/.test(r.url)) bodyProblems.push('POST to ' + r.url);
    if (body === null) { bodyProblems.push('body not available'); continue; }
    maxBody = Math.max(maxBody, body.length);
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { bodyProblems.push('not JSON'); }
    if (parsed) actions[parsed.action] = (actions[parsed.action] || 0) + 1;
    // video container magic, raw or base64: MP4 "ftyp" (ZnR5c), WebM/Matroska EBML 1A 45 DF A3 (GkXfo)
    if (/ftyp|ZnR5c|\u001aE\u00df\u00a3|GkXfo|data:video|video_base64|video_path|"blob"/.test(body)) bodyProblems.push('video bytes in a ' + (parsed && parsed.action) + ' body');
    if (body.length > MAX_BODY) bodyProblems.push('body of ' + body.length + ' bytes');
  }
  check('every POST is JSON to php/api/bulk_import.php; none carries video bytes or is larger than landmark JSON can be', posts.length > 0 && bodyProblems.length === 0 && J(Object.keys(actions).sort()) === J(['put_candidate', 'put_video']),
    bodyProblems.join('; ').slice(0, 400) || `${posts.length} POSTs ${J(actions)}, largest body ${Math.round(maxBody / 1024)} KB (the videos are ${Math.round(videos.reduce((a, v) => a + fs.statSync(v.path).size, 0) / videos.length / 1024)} KB each on average)`);
  const gets = reqs.filter((r) => r.method === 'GET');
  const odd = gets.map((r) => new URL(r.url).pathname).filter((p) => (!p.startsWith('/SKR/') && p !== '/favicon.ico') || VIDEO_RE.test(p));   // /favicon.ico: the browser's own request
  check('no GET asks for a video or anything outside /SKR/', odd.length === 0, `${gets.length} GETs` + (odd.length ? ': ' + J([...new Set(odd)]).slice(0, 300) : ''));
  const repoVideosAfter = listing(REPO_ROOT, { only: VIDEO_RE, skip: ['.git', 'node_modules'] });
  check('no video file was created (or changed) under the repo', J(repoVideosAfter) === J(repoVideosBefore), `${repoVideosAfter.length} video files before and after`);
  const xamppTmpAfter = listing(XAMPP_TMP);
  const newTmp = xamppTmpAfter.filter((l) => !xamppTmpBefore.includes(l));
  check('no video file was created under C:\\xampp\\tmp', !newTmp.some((l) => VIDEO_RE.test(l.split('|')[0])) && !newTmp.some((l) => Number(l.split('|')[1]) > 100000), `${newTmp.length} new/changed entries: ${J(newTmp.map((l) => l.split('|')[0])).slice(0, 200)}`);
  check('nothing was written under saved_gestures/ (listing hash unchanged)', hash(listing(SAVED)) === savedBefore, savedBefore.slice(0, 16));
} finally {
  await c.close();
  cleanCache();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const left = fs.existsSync(CACHE) ? listing(CACHE).filter((l) => mine(l.split('|')[0])) : [];
check('cleanup: this check\'s cache videos and candidates are gone, the temp folder is removed', left.length === 0 && !fs.existsSync(tmp), J(left).slice(0, 300));
check('the rest of the cache (anything not made by this check) is untouched', J(cacheOthers()) === J(cacheOthersBefore), `${cacheOthersBefore.length} other files`);
console.log('\nTimings:');
for (const line of report) console.log('  ' + line);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
