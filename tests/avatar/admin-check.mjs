// avatar phase, Task 6: avatar-clips.html end to end, with every non-localhost hostname blocked
// (Chrome --host-resolver-rules), at 1024x600, headless Chrome via tests/video-capture/cdp.mjs.
//   1  Train Gestures: the "Avatar clips" button sits next to View Active Gesture Dataset and opens
//      the page; a direct visit opens it too (logged in as admin; no PIN since the accounts-quiz phase).
//   2  Extract the owner's sample my_name_is.mp4 into a zz probe sign (DOM.setFileInputFiles: the
//      file is read by the page, never sent), auto-trim, Preview, Save.
//   3  Network: every request goes to localhost; the only request body is the clip JSON; nothing
//      carries the video. Disk: no new video file anywhere under the repo, htdocs or PHP's temp dir.
//   4  The clip on disk validates, has the trimmed frame count, and the dataset table shows a tick.
//   5  Layout: no page scroll at 1024x600, every control >= 44 px tall; 0 console errors.
//   6  Delete (two taps) removes avatar.json only.
// Skipped (exit 0) if the sample video is not on this machine. Screenshots -> docs/reports/img/.
// Run (Apache + MariaDB up): node tests/avatar/admin-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchChrome } from '../video-capture/cdp.mjs';
import { save, cleanZz, dir, samples, repo } from '../sign-texts/api-helper.mjs';
import { Clip, SAMPLE_MP4, SAMPLE_JSON } from './helper.mjs';

const BASE = 'http://localhost/SKR/';
const KEY = 'zz_avatar_admin';
const IMG = path.join(repo, 'docs', 'reports', 'img');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(SAMPLE_MP4)) {
  console.log('SKIP: ' + SAMPLE_MP4 + ' not present');
  process.exit(0);
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i;
function scan(roots, since) {
  const hits = [];
  const walk = (d) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (['.git', 'node_modules', 'SKR', 'avatar-probe'].includes(e.name)) continue;
        walk(p);
      } else {
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.mtimeMs >= since && (VIDEO_EXT.test(e.name) || st.size >= 1000000)) hits.push(p);
      }
    }
  };
  roots.forEach(walk);
  return hits;
}

cleanZz();
const t0 = Date.now();
const c = await launchChrome({ port: 9431, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(IMG, name), Buffer.from(r.result.data, 'base64')); };
const rect = (sel) => c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]})()`);
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await c.evaluate(expr)) return true; await sleep(250); } return false; };

try {
  fs.mkdirSync(IMG, { recursive: true });
  const saved = save({ sign_language: 'ESL', text_en: 'Zz Avatar Admin' });
  check('probe sign created', saved.status === 200);
  const samplesBefore = samples(KEY).map((f) => fs.readFileSync(path.join(dir(KEY), f), 'utf8'));
  const signBefore = fs.readFileSync(path.join(dir(KEY), 'sign.json'), 'utf8');
  await c.enableNetwork();

  // 1. direct visit -> the page (admin, no PIN); Train Gestures -> button -> the page
  await c.navigate(BASE + 'avatar-clips.html');
  check('direct visit opens the page, no PIN pad', await c.evaluate(`!document.getElementById('pin-screen') && document.getElementById('ac-ui').classList.contains('active')`));
  await c.navigate(BASE + 'gesture-training.html');
  await sleep(2000);
  await c.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&/^Next/.test(b.textContent.trim()));b&&b.click();})()`);
  await sleep(1200);
  const ds = await rect('#viewDatasetBtn'), av = await rect('#avatarClipsBtn');
  check('Avatar clips button next to the dataset button', ds && av && av[1] === ds[1] && av[3] >= 44 && ds[3] >= 44 && av[0] > ds[0] + ds[2] && av[0] + av[2] <= 1000,
    `dataset ${JSON.stringify(ds)}, avatar ${JSON.stringify(av)}`);
  await shot('avatar-train-gestures-button.png');
  await c.evaluate(`document.getElementById('avatarClipsBtn').click()`);
  await sleep(2500);
  check('opened from Train Gestures', await c.evaluate(`location.pathname.endsWith('avatar-clips.html') && document.getElementById('ac-ui').classList.contains('active')`));
  await waitFor(`document.querySelectorAll('.ac-item').length > 100`);
  await c.evaluate(`document.getElementById('ac-search').value='zz avatar'; document.getElementById('ac-search').dispatchEvent(new Event('input'))`);
  await c.evaluate(`document.querySelector('.ac-item[data-key="${KEY}"]').click()`);
  check('sign selected, Choose video enabled', await c.evaluate(`!document.getElementById('ac-file').disabled`));

  // 2. extract
  const doc = await c.send('DOM.getDocument', {});
  const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#ac-file' });
  const startExtract = Date.now();
  await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [SAMPLE_MP4.replace(/\//g, '\\')] });
  await waitFor(`document.getElementById('ac-progress').value > 0.45`, 120000);
  await shot('avatar-clips-extracting.png');
  const done = await waitFor(`!!window.avatarClipsLastExtraction`, 300000);
  const ext = await c.evaluate(`(()=>{const e=window.avatarClipsLastExtraction;return e?{n:e.frames.length,counts:e.counts,trim:e.trim,ms:e.ms,frames:e.frames}:null})()`);
  check('extraction finished', done && ext, ext ? `${ext.n} frames in ${ext.ms} ms (wall ${Date.now() - startExtract} ms), pose ${ext.counts.pose}, rh ${ext.counts.rh}, lh ${ext.counts.lh}` : '');
  const ref = JSON.parse(fs.readFileSync(SAMPLE_JSON, 'utf8'));
  const refCnt = { pose: 0, lh: 0, rh: 0 };
  ref.frames.forEach((f) => { if (f.pose) refCnt.pose++; if (f.lh) refCnt.lh++; if (f.rh) refCnt.rh++; });
  let d = [], dh = [];
  ext.frames.forEach((f, i) => {
    const g = ref.frames[i];
    if (g && g.pose && f[0]) for (let j = 0; j < 11; j++) d.push(Math.hypot(f[0][j][0] - g.pose[j][0], f[0][j][1] - g.pose[j][1]));
    if (g && g.rh && f[2]) for (let j = 0; j < 21; j++) dh.push(Math.hypot(f[2][j][0] - g.rh[j][0], f[2][j][1] - g.rh[j][1]));
  });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check('720-px canvas input agrees with the prototype\'s full-resolution CDN run', ext.n === ref.frames.length && Math.abs(ext.counts.rh - refCnt.rh) <= 5 && mean(d) < 0.03,
    `frames ${ext.n}/${ref.frames.length}; detections pose ${ext.counts.pose}/${refCnt.pose}, rh ${ext.counts.rh}/${refCnt.rh}, lh ${ext.counts.lh}/${refCnt.lh}; pose mean diff ${mean(d).toFixed(4)}, max ${Math.max(...d).toFixed(4)}; right hand mean ${dh.length ? mean(dh).toFixed(4) : 'n/a'}`);
  const auto = Clip.autoTrim(ext.frames);
  check('auto-trim applied', ext.trim.auto && auto && ext.trim.start === auto.start && ext.trim.end === auto.end, JSON.stringify(ext.trim));
  await shot('avatar-clips-extracted.png');

  // preview on the avatar
  await c.evaluate(`document.getElementById('ac-preview').click()`);
  await sleep(2500);
  check('preview plays on the avatar', await c.evaluate(`document.getElementById('ac-stage').classList.contains('avatar') && document.getElementById('ac-preview').textContent.includes('Stop')`));
  await shot('avatar-clips-preview.png');
  await c.evaluate(`document.getElementById('ac-preview').click()`);   // stop

  // layout
  const layout = await c.evaluate(`(()=>{
    const small=[...document.querySelectorAll('#ac-ui button, #ac-ui .ac-btn, #ac-ui input, #ac-ui .ac-handle, #ac-ui a')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.id||e.className||e.tagName);
    const out=[...document.querySelectorAll('#ac-ui *')].filter(e=>{const r=e.getBoundingClientRect();return e.offsetParent&&r.width&&(r.right>1024.5||r.bottom>600.5)}).map(e=>e.id||e.className);
    return {sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, small, out};})()`);
  check('1024x600: no page scroll, controls >= 44 px, nothing off-screen', layout.sw === 1024 && layout.sh === 600 && !layout.small.length && !layout.out.length, JSON.stringify(layout));

  // 3+4. save
  await c.evaluate(`document.getElementById('ac-save').click()`);
  await waitFor(`/^Saved/.test(document.getElementById('ac-status').textContent)`);
  const file = path.join(dir(KEY), 'avatar.json');
  const clip = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  check('clip saved and valid', clip && Clip.validateClip(clip).ok && clip.frames.length === ext.trim.end - ext.trim.start + 1,
    clip ? `${clip.frames.length} frames, ${fs.statSync(file).size} bytes` : 'missing');
  check('clip stores no video name or data', clip && !JSON.stringify(clip).includes('my_name_is') && !('source' in clip));
  check('samples and sign.json untouched', JSON.stringify(samples(KEY).map((f) => fs.readFileSync(path.join(dir(KEY), f), 'utf8'))) === JSON.stringify(samplesBefore)
    && fs.readFileSync(path.join(dir(KEY), 'sign.json'), 'utf8') === signBefore);
  check('list shows the tick', await waitFor(`(document.querySelector('.ac-item[data-key="${KEY}"] .ac-item-clip')||{}).textContent==='✓'`));

  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  const bodies = [];
  for (const r of reqs.filter((x) => x.method === 'POST')) {
    const body = r.postData !== null ? r.postData : await c.getRequestPostData(r.requestId);
    bodies.push({ url: r.url, bytes: body ? Buffer.byteLength(body) : 0, video: !!body && /ftyp|moov|mdat|webm/i.test(body) });
  }
  const clipBytes = fs.statSync(file).size;
  check('every request went to localhost', foreign.length === 0, `${reqs.length} requests, ${foreign.length} elsewhere`);
  check('only the clip JSON was posted; no video bytes', bodies.length === 1 && /avatar_clip\.php$/.test(bodies[0].url) && !bodies[0].video && bodies[0].bytes < clipBytes * 1.5,
    JSON.stringify(bodies) + `, clip ${clipBytes} bytes, video ${fs.statSync(SAMPLE_MP4).size} bytes`);
  check('no request URL names the video', !reqs.some((r) => /my_name_is|\.mp4/i.test(r.url)));
  const newFiles = scan([repo, 'C:/xampp/htdocs', 'C:/xampp/tmp'], t0);
  check('no video file written to disk', newFiles.length === 0, newFiles.join(', '));

  // dataset table column
  await c.navigate(BASE + 'gesture-training.html');
  await sleep(2500);
  await c.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&/^Next/.test(b.textContent.trim()));b&&b.click();})()`);
  await sleep(1500);
  await c.evaluate(`(()=>{trOpenDatasetModal(); const s=document.getElementById('datasetSearch'); s.value='zz avatar'; s.dispatchEvent(new Event('input'));})()`);
  // the dataset loads asynchronously (startup-check measures ~13 s on a cold page): wait for the row
  await waitFor(`(()=>{for(const t of ['word','letter','number','phrase']){trSetDatasetTab(t);if(document.querySelector('tr[data-key="${KEY}"]'))return true;}return false;})()`, 30000);
  await sleep(800);   // let the modal's open animation (a scale transform) finish before measuring
  const tick = await c.evaluate(`(()=>{let r=null;for(const t of ['word','letter','number','phrase']){trSetDatasetTab(t);r=document.querySelector('tr[data-key="${KEY}"]');if(r)break;}return r?{head:[...document.querySelectorAll('.tr-ds-table th')].map(t=>t.textContent),cell:r.querySelector('.tr-ds-avatar').textContent,h:Math.round(r.getBoundingClientRect().height)}:null})()`);
  check('dataset table shows the Avatar column with a tick', tick && tick.head.join('|') === 'English text|Filipino text|Set|Samples|Avatar|Edit|Delete' && tick.cell === '✓' && tick.h >= 44, JSON.stringify(tick));
  await c.evaluate(`(()=>{trSetDatasetTab('word'); const s=document.getElementById('datasetSearch'); s.value=''; s.dispatchEvent(new Event('input'));})()`);
  await sleep(500);
  await shot('avatar-dataset-column.png');

  // 6. delete via the page
  await c.navigate(BASE + 'avatar-clips.html');
  await waitFor(`document.querySelectorAll('.ac-item').length > 100`);
  await c.evaluate(`document.querySelector('.ac-item[data-key="${KEY}"]').click()`);
  await c.evaluate(`document.getElementById('ac-delete').click()`);
  check('first Delete tap only arms it', await c.evaluate(`document.getElementById('ac-delete').classList.contains('confirm')`) && fs.existsSync(file));
  await c.evaluate(`document.getElementById('ac-delete').click()`);
  await waitFor(`/deleted/.test(document.getElementById('ac-status').textContent)`);
  check('second tap deletes avatar.json only', !fs.existsSync(file) && fs.existsSync(path.join(dir(KEY), 'sign.json')) && samples(KEY).length === samplesBefore.length);

  const errors = c.getConsoleErrors(), exc = c.getExceptions();
  check('0 console errors', errors.length === 0 && exc.length === 0, JSON.stringify(errors.concat(exc)).slice(0, 400));
} finally {
  await c.close();
  cleanZz();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
