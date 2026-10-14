// Import / Export JSON on avatar-clips.html (2026-10-13), end to end, with every non-localhost
// hostname blocked (Chrome --host-resolver-rules), at 1024x600, headless Chrome via
// tests/video-capture/cdp.mjs.
//   1  A broken JSON, a JSON of another shape and a recognition sample (sample_*.json) are each
//      rejected with a message; Save stays disabled, nothing is posted, no avatar.json appears.
//   2  Import the owner's prototype sample my_name_is.avatar.json into a zz probe sign
//      (DOM.setFileInputFiles): converted, auto-trimmed, the stage shows the avatar and the
//      "Video + skeleton" tab is disabled; Preview; Save through php/api/avatar_clip.php.
//   3  Export JSON downloads <key>.avatar.json, byte-identical to the saved clip; importing that
//      export into a second zz probe and saving gives the same frames, and fills the Signer field.
//   4  Layout: no page scroll at 1024x600, every control >= 44 px tall; 0 console errors.
//   5  Let's Talk plays the imported clip on the avatar.
//   6  Network: every request goes to localhost; the only request bodies are the two clip saves.
// Skipped (exit 0) if the sample is not on this machine. Screenshots -> docs/reports/img/.
// Every zz probe is removed at the end.
// Run (Apache + MariaDB up): node tests/avatar/import-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchChrome } from '../video-capture/cdp.mjs';
import { save, cleanZz, dir, samples, repo, saved, callApi } from '../sign-texts/api-helper.mjs';
import { Clip, SAMPLE_JSON } from './helper.mjs';

const BASE = 'http://localhost/SKR/';
const KEY = 'zz_avatar_import', KEY2 = 'zz_avatar_reimport';
const IMG = path.join(repo, 'docs', 'reports', 'img');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

if (!fs.existsSync(SAMPLE_JSON)) {
  console.log('SKIP: ' + SAMPLE_JSON + ' not present');
  process.exit(0);
}

// Records every AvatarPlayer.play() of the page (talk.html), before any page script runs.
const HOOKS = `(() => {
  let AP;
  Object.defineProperty(window, 'AvatarPlayer', { configurable: true, get() { return AP; }, set(v) {
    AP = v; const create = v.create;
    v.create = function (o) {
      const p = create(o); const play = p.play;
      p.play = function (preps, po) {
        const rec = { keys: preps.map((x) => x.key), frames: preps.map((x) => x.poses.length) };
        (window.__avatarRuns = window.__avatarRuns || []).push(rec);
        return play.call(p, preps, po).then((r) => { rec.done = true; rec.completed = r.completed; rec.duration = r.stats.duration; rec.draws = r.stats.drawMs.length; return r; });
      };
      return p;
    };
  } });
})();`;

cleanZz();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-import-'));
const downloads = path.join(tmp, 'downloads');
fs.mkdirSync(downloads);
const c = await launchChrome({ port: 9451, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ev = (e) => c.evaluate(e);
const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(IMG, name), Buffer.from(r.result.data, 'base64')); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(200); } return false; };
const statusText = () => ev(`document.getElementById('ac-status').textContent`);
const pick = async (file) => {
  const doc = await c.send('DOM.getDocument', {});
  const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#ac-json' });
  await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [file.replace(/\//g, '\\')] });
};
const posts = () => c.getNetworkRequests().filter((r) => r.method === 'POST');

try {
  fs.mkdirSync(IMG, { recursive: true });
  check('probe signs created', save({ sign_language: 'ESL', text_en: 'Zz Avatar Import' }).status === 200 && save({ sign_language: 'ESL', text_en: 'Zz Avatar Reimport' }).status === 200);
  const samplesBefore = J(samples(KEY).map((f) => fs.readFileSync(path.join(dir(KEY), f), 'utf8')));
  const signBefore = fs.readFileSync(path.join(dir(KEY), 'sign.json'), 'utf8');
  await c.enableNetwork();
  await c.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  await c.navigate(BASE + 'avatar-clips.html');
  await ev(`sessionStorage.setItem('sk_train_unlocked',String(Date.now())); localStorage.removeItem('sk_avatar_signer'); location.reload(); 1`);
  await sleep(2500);
  await waitFor(`document.querySelectorAll('.ac-item').length > 100`);
  check('before a sign is picked: Import JSON and Export JSON disabled', await ev(`document.getElementById('ac-json').disabled && document.getElementById('ac-import').getAttribute('aria-disabled')==='true' && document.getElementById('ac-export').disabled`));
  await ev(`document.getElementById('ac-search').value='zz avatar'; document.getElementById('ac-search').dispatchEvent(new Event('input')); 1`);
  await ev(`document.querySelector('.ac-item[data-key="${KEY}"]').click(); 1`);
  check('sign selected: Import JSON enabled, Export JSON disabled (no clip yet)', await ev(`!document.getElementById('ac-json').disabled && document.getElementById('ac-export').disabled`));
  check('Signer placeholder', await ev(`document.getElementById('ac-signer').placeholder`) === 'Signer ID, e.g. P03');

  // 1. rejected files
  const broken = path.join(tmp, 'broken.json'), other = path.join(tmp, 'other.json');
  fs.writeFileSync(broken, '{"format":"sk_avatar_clip_v1","frames":[[');
  fs.writeFileSync(other, J({ name: 'not a clip', items: [1, 2, 3] }));
  const sampleDir = fs.readdirSync(saved).find((d) => !d.startsWith('zz_') && samples(d).length);
  const sampleFile = path.join(saved, sampleDir, samples(sampleDir)[0]);
  const badClip = path.join(tmp, 'bad-clip.json');
  const conv = Clip.importClip(JSON.parse(fs.readFileSync(SAMPLE_JSON, 'utf8')));
  const bad = JSON.parse(J(Clip.buildClip({ key: 'x', fps: conv.fps, video: conv.video, frames: conv.frames, trim: { start: 0, end: 20 } })));
  bad.frames[3][0] = bad.frames[3][0].slice(0, 5);
  fs.writeFileSync(badClip, J(bad));
  for (const [label, file, re] of [
    ['a broken JSON', broken, /This file is not valid JSON/],
    ['a JSON of another shape', other, /not an avatar clip/],
    ['a recognition sample (' + path.basename(sampleDir) + '/' + path.basename(sampleFile) + ')', sampleFile, /not an avatar clip.*recognition sample/],
    ['a clip that fails the clip validation', badClip, /not valid: frame 3 pose malformed/],
  ]) {
    await ev(`document.getElementById('ac-status').textContent=''; 1`);
    await pick(file);
    await waitFor(`/^Import failed/.test(document.getElementById('ac-status').textContent)`, 8000);
    const msg = await statusText();
    const st = await ev(`({ save: document.getElementById('ac-save').disabled, err: document.getElementById('ac-status').classList.contains('error'), trimEmpty: document.getElementById('ac-trim').classList.contains('empty') })`);
    check(`rejected: ${label}`, re.test(msg) && /Nothing was saved/.test(msg) && st.save && st.err && st.trimEmpty && !fs.existsSync(path.join(dir(KEY), 'avatar.json')) && posts().length === 0, msg);
  }

  // 2. import the prototype sample
  await pick(SAMPLE_JSON);
  check('import finished', await waitFor(`!!window.avatarClipsLastImport`, 15000), await statusText());
  const imp = await ev(`(()=>{const e=window.avatarClipsLastImport;return {name:e.name,source:e.source,n:e.frames.length,counts:e.counts,trim:e.trim,frames:e.frames}})()`);
  const auto = Clip.autoTrim(conv.frames);
  check('converted as the pure module converts it; auto-trim applied', imp.source === 'prototype' && imp.n === conv.frames.length && J(imp.frames) === J(conv.frames) && imp.trim.auto && imp.trim.start === auto.start && imp.trim.end === auto.end,
    `${imp.n} frames, pose ${imp.counts.pose}, rh ${imp.counts.rh}, lh ${imp.counts.lh}, trim ${J(imp.trim)}`);
  const stage = await ev(`({ avatar: document.getElementById('ac-stage').classList.contains('avatar'), videoTabDisabled: document.getElementById('ac-view-video').disabled, avatarPressed: document.getElementById('ac-view-avatar').getAttribute('aria-pressed'),
    trimEmpty: document.getElementById('ac-trim').classList.contains('empty'), label: document.getElementById('ac-trim-label').textContent, save: document.getElementById('ac-save').disabled, redo: document.getElementById('ac-redo').disabled, videoSrc: document.getElementById('ac-video').getAttribute('src') })`);
  check('no video: stage shows the avatar, "Video + skeleton" disabled, trim strip + Save + Redo ready', stage.avatar && stage.videoTabDisabled && stage.avatarPressed === 'true' && !stage.trimEmpty && !stage.save && !stage.redo && !stage.videoSrc, J(stage));
  await ev(`document.getElementById('ac-view-video').click(); 1`);
  check('the disabled video tab does nothing', await ev(`document.getElementById('ac-stage').classList.contains('avatar')`));
  // a trim handle still works (keyboard: one frame right, one frame back)
  await ev(`(()=>{const h=document.getElementById('ac-handle-l'); h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); return 1})()`);
  const moved = await ev(`window.avatarClipsLastImport.trim.start`);
  await ev(`(()=>{const h=document.getElementById('ac-handle-l'); h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); return 1})()`);
  check('trim handles work on an imported clip, the stage stays on the avatar', moved === auto.start + 1 && await ev(`window.avatarClipsLastImport.trim.start`) === auto.start && await ev(`document.getElementById('ac-stage').classList.contains('avatar')`), `start ${auto.start} -> ${moved} -> ${auto.start}`);
  await shot('avatar-import-imported.png');

  await ev(`document.getElementById('ac-preview').click(); 1`);
  await sleep(2500);
  check('preview plays on the avatar', await ev(`document.getElementById('ac-stage').classList.contains('avatar') && document.getElementById('ac-preview').textContent.includes('Stop')`));
  await shot('avatar-import-preview.png');
  await ev(`document.getElementById('ac-preview').click(); 1`);

  // 4. layout (with the imported clip loaded)
  const LAYOUT = `(()=>{
    const small=[...document.querySelectorAll('#ac-ui button, #ac-ui .ac-btn, #ac-ui input:not([type=file]), #ac-ui .ac-handle, #ac-ui a')].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.id||e.className||e.tagName);
    const out=[...document.querySelectorAll('#ac-ui *')].filter(e=>{const r=e.getBoundingClientRect();return e.offsetParent&&r.width&&(r.right>1024.5||r.bottom>600.5)}).map(e=>e.id||e.className);
    const clipped=['ac-choose','ac-import','ac-export','ac-preview','ac-delete','ac-redo','ac-save'].filter(id=>{const e=document.getElementById(id);return e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1});
    const box=(id)=>{const r=document.getElementById(id).getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)};
    return {sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, small, out, clipped,
      choose:box('ac-choose'), import:box('ac-import'), signer:box('ac-signer'), export:box('ac-export'), preview:box('ac-preview'), label:box('ac-trim-label')};})()`;
  const signerFits = await ev(`(()=>{const i=document.getElementById('ac-signer');const g=document.createElement('canvas').getContext('2d');const s=getComputedStyle(i);g.font=s.fontWeight+' '+s.fontSize+' '+s.fontFamily;
    return {text:Math.ceil(g.measureText(i.placeholder).width), room:i.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)}})()`);
  const layout = await ev(LAYOUT);
  check('1024x600: no page scroll, controls >= 44 px, nothing off-screen, no label cut off', layout.sw === 1024 && layout.sh === 600 && !layout.small.length && !layout.out.length && !layout.clipped.length, J(layout));
  check('Signer placeholder fits its field', signerFits.text <= signerFits.room, J(signerFits));

  // save
  await ev(`(()=>{const i=document.getElementById('ac-signer'); i.value='P03'; i.dispatchEvent(new Event('input')); return 1})()`);
  await ev(`document.getElementById('ac-save').click(); 1`);
  await waitFor(`/^Saved/.test(document.getElementById('ac-status').textContent)`);
  const file = path.join(dir(KEY), 'avatar.json');
  const clip = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  check('clip saved through avatar_clip.php and valid', clip && Clip.validateClip(clip).ok && clip.key === KEY && clip.format === 'sk_avatar_clip_v1' && clip.fps === 25 && clip.signer === 'P03'
    && clip.frames.length === auto.end - auto.start + 1 && J(clip.frames) === J(conv.frames.slice(auto.start, auto.end + 1)),
    clip ? `${clip.frames.length} frames, ${fs.statSync(file).size} bytes, trim ${J(clip.trim)}; status: ${await statusText()}` : 'missing');
  check('clip stores no source name', clip && !J(clip).includes('my_name_is') && !('source' in clip));
  check('samples and sign.json untouched', J(samples(KEY).map((f) => fs.readFileSync(path.join(dir(KEY), f), 'utf8'))) === samplesBefore && fs.readFileSync(path.join(dir(KEY), 'sign.json'), 'utf8') === signBefore);
  check('list shows the tick; Export JSON enabled', await waitFor(`(document.querySelector('.ac-item[data-key="${KEY}"] .ac-item-clip')||{}).textContent==='✓' && !document.getElementById('ac-export').disabled`));

  // 3. export, then re-import the export into the second probe
  await ev(`document.getElementById('ac-export').click(); 1`);
  const exported = path.join(downloads, KEY + '.avatar.json');
  for (let i = 0; i < 50 && !fs.existsSync(exported); i++) await sleep(200);
  await sleep(300);
  const names = fs.readdirSync(downloads);
  check('Export JSON downloads <key>.avatar.json, byte-identical to the saved clip', fs.existsSync(exported) && fs.readFileSync(exported).equals(fs.readFileSync(file)), `downloaded: ${J(names)}, ${fs.existsSync(exported) ? fs.statSync(exported).size : 0} bytes`);

  await ev(`document.querySelector('.ac-item[data-key="${KEY2}"]').click(); 1`);
  await ev(`(()=>{window.avatarClipsLastImport=null; const i=document.getElementById('ac-signer'); i.value=''; i.dispatchEvent(new Event('input')); return 1})()`);
  await pick(exported);
  check('re-import finished', await waitFor(`!!window.avatarClipsLastImport`, 15000), await statusText());
  const re = await ev(`(()=>{const e=window.avatarClipsLastImport;return {source:e.source,n:e.frames.length,trim:e.trim,signer:document.getElementById('ac-signer').value,label:document.getElementById('ac-trim-label').textContent}})()`);
  check('re-import: every frame selected, the file\'s signer fills the Signer field', re.source === 'clip' && re.n === clip.frames.length && re.trim.start === 0 && re.trim.end === re.n - 1 && re.signer === 'P03', J(re));
  await ev(`document.getElementById('ac-save').click(); 1`);
  await waitFor(`/^Saved/.test(document.getElementById('ac-status').textContent)`);
  const file2 = path.join(dir(KEY2), 'avatar.json');
  const clip2 = fs.existsSync(file2) ? JSON.parse(fs.readFileSync(file2, 'utf8')) : null;
  let diffs = 0, values = 0;
  if (clip2) clip.frames.forEach((f, i) => f.forEach((part, k) => (part || []).forEach((p, j) => p.forEach((v, m) => { values++; if (!clip2.frames[i] || !clip2.frames[i][k] || clip2.frames[i][k][j][m] !== v) diffs++; }))));
  check('export -> import -> save: same frame count and values; saved under the selected sign, not the file\'s key', clip2 && Clip.validateClip(clip2).ok && clip2.key === KEY2 && clip2.frames.length === clip.frames.length && diffs === 0 && J(clip2.frames) === J(clip.frames)
    && J(clip2.trim) === J({ ...clip.trim, auto: false }) && J(clip2.video) === J(clip.video) && clip2.fps === clip.fps && clip2.signer === 'P03',
    clip2 ? `${clip2.frames.length}/${clip.frames.length} frames, ${values} values compared, ${diffs} different; trim ${J(clip2.trim)} (was ${J(clip.trim)})` : 'missing');

  const errs1 = c.getConsoleErrors().concat(c.getExceptions());
  check('avatar-clips.html: 0 console errors', errs1.length === 0, J(errs1).slice(0, 400));

  // 5. Let's Talk plays the imported clip
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOKS });
  await c.navigate(BASE + 'talk.html');
  check('talk.html: loading queue settled', await waitFor(`!!(window.TalkLoader && TalkLoader.isSettled())`, 120000));
  await ev(`showScreen('speaking'); 1`);
  await sleep(1500);
  await ev(`(() => { window.__vids = 0; const f = document.getElementById('speaking-sign-frame'); new MutationObserver(() => { window.__vids = Math.max(window.__vids, f.querySelectorAll('video[src]').length); }).observe(f, { childList: true, subtree: true, attributes: true });
    const i = document.getElementById('speaking-input'); i.value = 'zz avatar import'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
  await sleep(200);
  await ev(`document.getElementById('speaking-translate').click(); 1`);
  await waitFor(`(window.__avatarRuns||[]).length === 1`, 15000);
  await sleep(1500);
  const mid = await ev(`({ hidden: document.getElementById('speaking-avatar').hidden, word: document.getElementById('speaking-sign-word').textContent })`);
  await shot('avatar-import-talk.png');
  await waitFor(`(window.__avatarRuns||[]).length === 1 && window.__avatarRuns[0].done`, 40000);
  const run = await ev(`({ runs: window.__avatarRuns, vids: window.__vids })`);
  check('Let\'s Talk plays the imported clip on the avatar', run.runs.length === 1 && J(run.runs[0].keys) === J([KEY]) && run.runs[0].completed && run.runs[0].frames[0] === clip.frames.length && run.vids === 0 && !mid.hidden && mid.word === 'ZZ AVATAR IMPORT',
    J({ ...run.runs[0], vids: run.vids, caption: mid.word }));
  const errs2 = c.getConsoleErrors().concat(c.getExceptions());
  check('talk.html: 0 console errors', errs2.length === errs1.length, J(errs2).slice(0, 400));

  // 6. network
  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  check('every request went to localhost (all other hosts blocked)', foreign.length === 0, `${reqs.length} requests, ${foreign.length} elsewhere`);
  const clipPosts = posts().filter((r) => /avatar_clip\.php$/.test(r.url));
  const otherPosts = posts().filter((r) => !/avatar_clip\.php$/.test(r.url) && !/talk\.html/.test(r.url)).map((r) => r.url.replace(BASE, ''));
  check('on avatar-clips.html the only POSTs are the two clip saves', clipPosts.length === 2, `avatar_clip.php ${clipPosts.length}; later, from talk.html: ${J(otherPosts)}`);
} finally {
  await c.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  cleanZz();
  // a Save with Signer "P03" records a hand pick in the bulk importer's cache (2026-10-13): remove ours
  callApi('bulk_import.php', { body: { action: 'set_picks', picks: { [KEY]: null, [KEY2]: null } } });
}
const left = fs.readdirSync(saved).filter((d) => d.startsWith('zz_'));
check('zz probes removed', left.length === 0, J(left));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
