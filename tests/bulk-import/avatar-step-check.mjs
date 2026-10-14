// bulk-import.html, step "Avatar" (default signer + fallbacks -> "Apply to all signs"), end to end
// in headless Chrome (tests/video-capture/cdp.mjs) at 1366x768, with every non-localhost hostname
// blocked. No extraction runs and no folder is chosen: the candidates are written straight through
// php/api/bulk_import.php (tests/bulk-import/avatar-fixture.mjs, real clips).
// Fixture (zz_ only), with the avatar list set to default P01 + fallback P03:
//   zz_av_all     candidates P01 P02 P03                         -> set to P01
//   zz_av_p3      candidate P03 only                             -> fallback P03
//   zz_av_p2      candidate P02 only (not a listed signer)       -> no clip
//   zz_av_bare    no candidate                                   -> no clip
//   zz_av_made    has an avatar.json and NO pick, candidate P01  -> left alone / keep-hand off: P01
//   zz_av_hand    picked by hand (P02), candidates P01 P02       -> left alone / keep-hand off: P01
//   zz_av_hand2   has an avatar.json and no pick, candidate P02  -> left alone, always
//   zz_av_dbonly  a gestures row with no folder, candidate P01   -> Apply fails for it (listed)
//   zz_av_ghost   candidate P01, no sign                         -> not imported yet
//   zz_av_fsl     exists as FSL; candidate P01 made from an ESL video -> never set, listed as
//                 "of another set" (not "no clip"), with keep-hand on and off
// The page under test only ever sees the zz_ candidates (avatar-fixture.mjs ZZ_ONLY): an Apply
// here can never write a clip of a real sign.
//   1 the step with no folder; the signer list is the Folder step's   2 the preview table
//   3 Apply: summary = an independent computation = the avatar.json files; picks; one set_picks
//   4 Apply again: nothing changes     5 keep-hand off, through a forced 5xx + Resume
//   4b a clip picked by hand elsewhere after the table was read: Apply stops and asks to check
//   5b a candidate gone at Apply time (404): the next signer in the list, else "failed"
//   6 Refresh, layout (1366 and 1280 wide)
//   6b a double click on Apply; no answer -> pause -> Resume; set_picks 5xx -> pause -> Resume
//   6c keep-hand on: signs picked by hand while the Apply was paused are left alone
//   7 the Extract button, network, console
// Cleanup: every zz_ sign, the zz candidates and picks; nothing else of the cache is touched.
// Run (Apache + MariaDB up, no other node test running): node tests/bulk-import/avatar-step-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchChrome } from '../video-capture/cdp.mjs';
import { callApi, save, signsApi, cleanZz, dir, sql, saved } from '../sign-texts/api-helper.mjs';
import { api, apiGet, picksOnDisk, avatarFile, avatarOnDisk, makeClip, putCandidate, cleanCacheKeys, othersInCache, othersSaved, usingSample, ZZ_ONLY } from './avatar-fixture.mjs';

const PAGE = 'http://localhost/SKR/bulk-import.html';
const SHOTS = (process.argv.find((a) => a.startsWith('--shots=')) || '').slice(8);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

const SIGNS = ['zz_av_all', 'zz_av_p3', 'zz_av_p2', 'zz_av_bare', 'zz_av_made', 'zz_av_hand', 'zz_av_hand2'];
const CANDS = { zz_av_all: ['P01', 'P02', 'P03'], zz_av_p3: ['P03'], zz_av_p2: ['P02'], zz_av_made: ['P01'], zz_av_hand: ['P01', 'P02'], zz_av_hand2: ['P02'], zz_av_dbonly: ['P01'], zz_av_ghost: ['P01'], zz_av_fsl: ['P01'] };
const FSL_KEY = 'zz_av_fsl';                         // the sign is FSL, every candidate here is of an ESL video
const DIFFERS = 'candidate P01 is ESL, the sign is FSL';
const KEYS = [...new Set(SIGNS.concat(Object.keys(CANDS)))].sort();
const ORDER = ['P01', 'P03'];

const zzFolders = () => fs.readdirSync(saved).filter((d) => d.startsWith('zz_')).sort();

// The assignment, worked out here from what the server says (not with BulkImportCore).
function expected(keepHand) {
  const signs = signsApi({ method: 'GET' }).json.signs;
  const all = apiGet('action=candidates').json.candidates, picks = picksOnDisk();
  const out = { assign: {}, bySigner: {}, fallback: [], noClip: [], leftAlone: [], notImported: [], setDiffers: [] };
  const keys = [...new Set(Object.keys(signs).concat(Object.keys(all).filter((k) => k.startsWith('zz_'))))].sort();
  for (const key of keys) {
    const list = key.startsWith('zz_') && all[key] ? all[key] : [];
    if (!signs[key]) { if (list.length) out.notImported.push(key); continue; }
    const hasClip = !!signs[key].avatar;
    const byHand = picks[key] ? picks[key].by === 'hand' && hasClip : hasClip;
    if (byHand && keepHand) { out.leftAlone.push(key); continue; }
    // a candidate made from a video of another set than the sign's is never used
    const wrong = (s) => list.some((c) => c.signer === s && c.set && c.set !== signs[key].set);
    let signer = null, differs = 0;
    for (const s of ORDER) {
      if (signer || !list.some((c) => c.signer === s)) continue;
      if (wrong(s)) { differs++; out.setDiffers.push({ key, signer: s, set: list.find((c) => c.signer === s).set }); } else signer = s;
    }
    if (!signer) { if (hasClip) out.leftAlone.push(key); else if (!differs) out.noClip.push(key); continue; }
    out.assign[key] = signer;
    out.bySigner[signer] = (out.bySigner[signer] || 0) + 1;
    if (signer !== ORDER[0]) out.fallback.push({ key, signer });
  }
  return out;
}
const sortObj = (o) => J(Object.keys(o).sort().map((k) => [k, o[k]]));

// ── before anything runs ──
cleanZz();
cleanCacheKeys(KEYS);
const savedBefore = othersSaved();
const cacheBefore = othersInCache();
const clips = {};                                    // key -> signer -> the candidate's clip
for (const key of SIGNS) if (save({ label: key, sign_language: 'ESL' }).status !== 200) throw new Error('could not create ' + key);
if (save({ label: FSL_KEY, sign_language: 'FSL' }).status !== 200) throw new Error('could not create ' + FSL_KEY);
sql(`INSERT INTO gestures (label, sign_language, text_en, text_fil, category) VALUES ('zz_av_dbonly', 'ESL', 'Zz av dbonly', NULL, 'word')`);
for (const [key, signers] of Object.entries(CANDS)) { clips[key] = {}; for (const s of signers) clips[key][s] = putCandidate(key, s); }
// the hand-made clips: saved through avatar_clip.php as avatar-clips.html does
const handClip = { zz_av_made: makeClip('zz_av_made', 'P07'), zz_av_hand: makeClip('zz_av_hand', 'P02'), zz_av_hand2: makeClip('zz_av_hand2', 'P09') };
handClip.zz_av_made.signer = 'someone';
for (const [key, clip] of Object.entries(handClip)) if (callApi('avatar_clip.php', { body: { action: 'save', key, clip } }).status !== 200) throw new Error('could not save the clip of ' + key);
api({ action: 'set_picks', picks: { zz_av_hand: { signer: 'P02', by: 'hand' } } });
const handBytes = Object.fromEntries(Object.keys(handClip).map((k) => [k, sha(fs.readFileSync(avatarFile(k)))]));
const handPick = picksOnDisk().zz_av_hand;
const listedSet = signsApi({ method: 'GET' }).json.signs;
check('set-up: 7 zz ESL signs + 1 FSL sign + a gestures row without a folder, 9 candidate keys (all of ESL videos), 3 hand-made clips, 1 hand pick (' + (usingSample ? 'clips cut from the prototype sample' : 'made-up clips') + ')',
  SIGNS.every((k) => listedSet[k]) && listedSet.zz_av_dbonly && !fs.existsSync(dir('zz_av_dbonly')) && !listedSet.zz_av_ghost
  && Object.keys(apiGet('action=candidates').json.candidates).filter((k) => k.startsWith('zz_')).length === 9
  && listedSet[FSL_KEY].set === 'FSL' && apiGet('action=candidates&key=' + FSL_KEY).json.candidates[FSL_KEY][0].set === 'ESL' && fs.existsSync(dir(FSL_KEY))
  && ['zz_av_made', 'zz_av_hand', 'zz_av_hand2'].every((k) => listedSet[k].avatar) && handPick.signer === 'P02' && handPick.by === 'hand' && !picksOnDisk().zz_av_made);

const c = await launchChrome({ port: 9483, width: 1366, height: 768, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const ev = (e) => c.evaluate(e);
const waitFor = async (expr, ms = 20000, step = 100) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(step); } return false; };
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
const S = 'BulkImport.state';
const click = (id) => ev(`document.getElementById('${id}').click(); 1`);
const posts = () => c.getNetworkRequests().filter((r) => r.method === 'POST');
const pickPosts = () => posts().filter((r) => /bulk_import\.php$/.test(r.url) && /"action":"set_picks"/.test(r.postData || '')).length;
const clipPosts = () => posts().filter((r) => /avatar_clip\.php$/.test(r.url)).length;
// The table as shown, the zz rows only: [key, text, clip now, candidates, apply will, kind].
const table = () => ev(`[...document.querySelectorAll('#bi-av-table tbody tr')].filter(tr => tr.dataset.key.indexOf('zz_') === 0).map(tr => [...tr.children].map(td => td.textContent).concat([tr.dataset.kind]))`);
const chips = () => ev(`[...document.querySelectorAll('#bi-av-counts .bi-av-chip')].map(s => s.textContent)`);
const applyDone = () => waitFor(`${S}.av.run.status === 'done' && ${S}.av.status === 'ready' && !${S}.av.starting`, 60000);
// Presses Apply and waits for a NEW finished Apply (the previous one is "done" too).
const applyNew = async (clicks = 1) => {
  const prev = ((await ev(`BulkImport.lastAvatarSummary()`)) || {}).finishedAt || '';
  await ev(`(() => { const b = document.getElementById('bi-av-apply'); for (let i = 0; i < ${clicks}; i++) b.click(); return 1; })()`);
  return waitFor(`(BulkImport.lastAvatarSummary() || {}).finishedAt !== ${J(prev)} && ${S}.av.run.status === 'done' && ${S}.av.status === 'ready' && !${S}.av.starting`, 60000);
};
const note = () => ev(`document.getElementById('bi-av-note').textContent`);
const row = async (key) => (await table()).find((r) => r[0] === key);
const summary = () => ev(`BulkImport.lastAvatarSummary()`);
const sumDom = () => ev(`Object.fromEntries(['signers','fallback','noclip','left','notimported','setdiffers'].map(k => [k, document.getElementById('bi-av-sum-' + k).textContent]).concat([['failed', [...document.querySelectorAll('#bi-av-sum-failed tbody tr')].map(tr => [...tr.children].map(td => td.textContent))], ['shown', !document.getElementById('bi-av-sum-card').hidden]]))`);
// The summary against the expectation and against the files: -> a list of problems.
// opts.assign: signs that got another signer than planned (a candidate gone at Apply time);
// opts.left: signs dropped from the work because they were picked by hand meanwhile.
function problems(sum, exp0, failedKeys, opts = {}) {
  const out = [];
  const left = opts.left || [];
  const assign = { ...exp0.assign, ...(opts.assign || {}) };
  const exp = { ...exp0, leftAlone: exp0.leftAlone.concat(left).sort() };
  const savedKeys = Object.keys(assign).sort().filter((k) => !failedKeys.includes(k) && !left.includes(k));
  const by = {}; savedKeys.forEach((k) => { by[assign[k]] = (by[assign[k]] || 0) + 1; });
  if (sortObj(sum.bySigner) !== sortObj(by)) out.push('bySigner ' + J(sum.bySigner) + ' != ' + J(by));
  if (J(sum.saved) !== J(savedKeys.map((k) => ({ key: k, signer: assign[k] })))) out.push('saved ' + J(sum.saved));
  if (J(sum.fallback) !== J(savedKeys.filter((k) => assign[k] !== ORDER[0]).map((k) => ({ key: k, signer: assign[k] })))) out.push('fallback ' + J(sum.fallback));
  for (const k of ['noClip', 'leftAlone', 'notImported']) if (J(sum[k]) !== J(exp[k])) out.push(k + ' differs: ' + J(sum[k].filter((x) => x.startsWith('zz_'))) + ' != ' + J(exp[k].filter((x) => x.startsWith('zz_'))));
  if (J(sum.failed.map((f) => f.key)) !== J(failedKeys)) out.push('failed ' + J(sum.failed));
  if (J(sum.setDiffers.map((d) => ({ key: d.key, signer: d.signer, set: d.set }))) !== J(exp.setDiffers) || J(exp.setDiffers) !== J([{ key: FSL_KEY, signer: 'P01', set: 'ESL' }])) out.push('setDiffers ' + J(sum.setDiffers));
  if (fs.existsSync(avatarFile(FSL_KEY)) || picksOnDisk()[FSL_KEY]) out.push(FSL_KEY + ': has an avatar.json or a pick');
  // ... and the files: a saved sign holds exactly its candidate's clip
  for (const s of sum.saved) {
    const disk = avatarOnDisk(s.key), cand = clips[s.key] && clips[s.key][s.signer];
    if (!disk || !cand) { out.push(s.key + ': no avatar.json / no candidate'); continue; }
    if (J(disk.frames) !== J(cand.frames) || disk.signer !== s.signer || disk.key !== s.key || disk.format !== 'sk_avatar_clip_v1') out.push(`${s.key}: avatar.json is not ${s.signer}'s candidate (${disk.frames.length} frames, signer ${disk.signer}, key ${disk.key})`);
  }
  for (const k of sum.noClip.concat(sum.notImported, ['zz_av_dbonly'])) if (k.startsWith('zz_') && fs.existsSync(avatarFile(k))) out.push(k + ': has an avatar.json');
  return out;
}

try {
  await c.send('Network.enable', { maxPostDataSize: 16 * 1024 * 1024 });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: ZZ_ONLY });
  await c.navigate(PAGE);
  await ev(`sessionStorage.setItem('sk_train_unlocked', String(Date.now())); localStorage.removeItem('sk_bulk_avatar_signers'); location.reload(); 1`);
  await sleep(1500);
  check('page unlocked; the extractors have settled', await waitFor(`!!window.BulkImport && document.getElementById('bi-ui').classList.contains('active') && ${S}.engines !== 'loading' && ${S}.engines !== 'idle'`, 60000), await ev(`${S}.engines`));

  // ── 1. the step, with no folder chosen ──
  await click('bi-tab-avatar');
  check('Avatar step opened with no folder: signs, candidates and picks read', await waitFor(`${S}.step === 'avatar' && ${S}.av.status === 'ready'`) && await ev(`${S}.videos.length === 0 && ${S}.folder.files === 0`), await ev(`${S}.av.status + ' ' + ${S}.av.error`));
  const lists0 = await ev(`({ cache: ${S}.cacheSigners, av: ${S}.avatarSigners, order: ${S}.avatarOrder, options: [...document.getElementById('bi-av-default').options].map(o => o.value), value: document.getElementById('bi-av-default').value,
    rows: [...document.querySelectorAll('#bi-av-order .bi-order-row')].map(r => [r.dataset.signer, r.querySelector('input').checked, r.querySelector('.bi-order-role').textContent]), keep: document.getElementById('bi-av-keep').checked, keepState: ${S}.av.keepHand })`);
  check('the dropdown and the list offer every signer with a candidate in the cache (P01 P02 P03); "Keep signs I picked by hand" is on',
    J(lists0.cache) === J(['P01', 'P02', 'P03']) && J(lists0.options) === J(lists0.order) && J(lists0.order.slice().sort()) === J(['P01', 'P02', 'P03']) && lists0.value === lists0.av[0] && lists0.rows.length === 3 && lists0.keep && lists0.keepState, J(lists0));
  // default P01 + fallback [P03], through the controls: untick P02, choose P03 then P01 in the dropdown
  await ev(`(() => { const b = document.querySelector('#bi-av-order input[data-signer="P02"]'); if (b.checked) b.click(); return 1; })()`);
  await ev(`(() => { const s = document.getElementById('bi-av-default'); s.value = 'P03'; s.dispatchEvent(new Event('change')); return 1; })()`);
  const viaDropdown = await ev(`${S}.avatarSigners`);
  await ev(`(() => { const s = document.getElementById('bi-av-default'); s.value = 'P01'; s.dispatchEvent(new Event('change')); return 1; })()`);
  const lists1 = await ev(`({ av: ${S}.avatarSigners, value: document.getElementById('bi-av-default').value, ls: localStorage.getItem('sk_bulk_avatar_signers'),
    here: [...document.querySelectorAll('#bi-av-order .bi-order-row')].map(r => [r.dataset.signer, r.querySelector('input').checked, r.querySelector('.bi-order-role').textContent]),
    folder: [...document.querySelectorAll('#bi-avatar .bi-order-row')].map(r => [r.dataset.signer, r.querySelector('input').checked, r.querySelector('.bi-order-role').textContent]) })`);
  check('default P01 + fallback P03 set with the dropdown and the list; it IS the Folder step\'s list (same state, same rows, remembered)',
    J(viaDropdown) === J(['P03', 'P01']) && J(lists1.av) === J(ORDER) && lists1.value === 'P01' && lists1.ls === J(ORDER) && J(lists1.here) === J(lists1.folder)
    && J(lists1.here) === J([['P01', true, 'default signer'], ['P03', true, 'fallback 1'], ['P02', false, 'not used']]), J(lists1));

  // ── 2. the preview, before anything is written ──
  const exp1 = expected(true);
  const t1 = await table(), chips1 = await chips();
  check('preview table (keep-hand on): text, clip now, candidates and what Apply will do, per sign', J(t1) === J([
    ['zz_av_all', 'Zz av all', 'none', 'P01, P02, P03', 'set to P01', 'set'],
    ['zz_av_bare', 'Zz av bare', 'none', '—', 'no clip', 'no-clip'],
    ['zz_av_dbonly', 'Zz av dbonly', 'none', 'P01', 'set to P01', 'set'],
    ['zz_av_fsl', 'Zz av fsl', 'none', 'P01 (ESL, not used)', DIFFERS + ' — not used', 'set-differs'],
    ['zz_av_ghost', '—', '—', 'P01', 'not imported yet', 'not-imported'],
    ['zz_av_hand', 'Zz av hand', 'P02 by hand', 'P01, P02', 'left alone (picked by hand)', 'left-alone'],
    ['zz_av_hand2', 'Zz av hand2', 'by hand (made on Avatar clips)', 'P02', 'left alone (picked by hand)', 'left-alone'],
    ['zz_av_made', 'Zz av made', 'by hand (made on Avatar clips)', 'P01', 'left alone (picked by hand)', 'left-alone'],
    ['zz_av_p2', 'Zz av p2', 'none', 'P02', 'no clip', 'no-clip'],
    ['zz_av_p3', 'Zz av p3', 'none', 'P03', 'fallback P03', 'fallback'],
  ]), J(t1));
  const nAssign1 = Object.keys(exp1.assign).length;
  check('counts above the table = the independent computation over ALL signs', J(chips1) === J([`${nAssign1} signs set (P01 ${exp1.bySigner.P01}, P03 ${exp1.bySigner.P03})`, `${exp1.fallback.length} by a fallback`, `${exp1.noClip.length} no clip`, `${exp1.leftAlone.length} left alone`, `${exp1.notImported.length} not imported yet`, '1 of another set'])
    && J(exp1.assign) === J({ zz_av_all: 'P01', zz_av_dbonly: 'P01', zz_av_p3: 'P03' }) && await ev(`document.querySelectorAll('#bi-av-table tbody tr').length`) === nAssign1 + exp1.noClip.length + exp1.leftAlone.length + exp1.notImported.length + 1 && !exp1.noClip.includes(FSL_KEY), J(chips1));
  check('nothing written yet: no POST, no avatar.json for the signs to set', posts().length === 0 && !fs.existsSync(avatarFile('zz_av_all')) && !fs.existsSync(avatarFile('zz_av_p3')) && !(await ev(`document.getElementById('bi-av-apply').disabled`)));
  await shot('bulk-avatar-preview.png');

  // ── 3. Apply ──
  await click('bi-av-apply');
  check('Apply finished', await applyDone(), await ev(`document.getElementById('bi-av-note').textContent`));
  const s1 = await summary(), p1 = problems(s1, exp1, ['zz_av_dbonly']);
  check('summary = the independent computation = the avatar.json files on disk (frames, signer, key of each chosen candidate)', p1.length === 0 && J(s1.bySigner) === J({ P01: 1, P03: 1 }) && J(s1.fallback) === J([{ key: 'zz_av_p3', signer: 'P03' }]), p1.length ? J(p1) : J({ bySigner: s1.bySigner, fallback: s1.fallback, noClip: s1.noClip.length, leftAlone: s1.leftAlone.length, notImported: s1.notImported }));
  check('a sign the server refuses is listed under "failed" with its reason, the rest went on', s1.failed.length === 1 && s1.failed[0].key === 'zz_av_dbonly' && s1.failed[0].signer === 'P01' && /Sign not found/.test(s1.failed[0].reason), J(s1.failed));
  const d1 = await sumDom();
  check('summary shown: signs per signer, fallbacks, no clip, left alone, not imported yet, failed', d1.shown && d1.signers === 'P01: 1, P03: 1 — 2 signs set.' && d1.fallback === 'zz_av_p3 → P03' && d1.noclip === exp1.noClip.join(', ')
    && d1.left === exp1.leftAlone.join(', ') && d1.notimported === 'zz_av_ghost' && J(d1.failed) === J([['zz_av_dbonly', 'P01', 'Sign not found']]), J({ signers: d1.signers, fallback: d1.fallback, notimported: d1.notimported, failed: d1.failed }));
  check('hand-picked signs: avatar.json bytes unchanged', Object.keys(handBytes).every((k) => sha(fs.readFileSync(avatarFile(k))) === handBytes[k]));
  check('the FSL sign whose only candidate is of an ESL video: not set (no avatar.json, no pick), not under "no clip", listed in the summary', !fs.existsSync(avatarFile(FSL_KEY)) && !picksOnDisk()[FSL_KEY]
    && J(s1.setDiffers) === J([{ key: FSL_KEY, signer: 'P01', set: 'ESL', signSet: 'FSL' }]) && !s1.noClip.includes(FSL_KEY) && !s1.saved.some((x) => x.key === FSL_KEY) && d1.setdiffers === FSL_KEY + ': ' + DIFFERS, d1.setdiffers);
  const picks1 = picksOnDisk();
  check('picks.json: by "default" for the applied signs only; the hand pick untouched; none for a failed sign', picks1.zz_av_all.signer === 'P01' && picks1.zz_av_all.by === 'default' && picks1.zz_av_p3.signer === 'P03' && picks1.zz_av_p3.by === 'default'
    && J(picks1.zz_av_hand) === J(handPick) && J(Object.keys(picks1).filter((k) => k.startsWith('zz_')).sort()) === J(['zz_av_all', 'zz_av_hand', 'zz_av_p3']), J(Object.keys(picks1).filter((k) => k.startsWith('zz_')).map((k) => [k, picks1[k].signer, picks1[k].by])));
  check('one set_picks call for the whole Apply; one avatar_clip.php save per sign to set', pickPosts() === 1 && clipPosts() === 3, `set_picks ${pickPosts()}, avatar_clip.php ${clipPosts()}`);
  const t3 = await table();
  check('the table is read again: the applied signs now show their signer', J(t3.find((r) => r[0] === 'zz_av_all').slice(2)) === J(['P01 (default)', 'P01, P02, P03', 'set to P01', 'set']) && J(t3.find((r) => r[0] === 'zz_av_p3').slice(2)) === J(['P03 (default)', 'P03', 'fallback P03', 'fallback']), J(t3.filter((r) => /all|p3/.test(r[0]))));
  await shot('bulk-avatar-summary.png');

  // ── 4. Apply again: idempotent ──
  const before4 = ['zz_av_all', 'zz_av_p3'].map((k) => J(avatarOnDisk(k).frames));
  check('Apply again finished', await applyNew());
  const s4 = await summary(), p4 = problems(s4, expected(true), ['zz_av_dbonly']);
  check('Apply again: the same summary, the same clips, the hand-picked signs still untouched; one more set_picks', p4.length === 0 && J(s4.bySigner) === J(s1.bySigner) && J(['zz_av_all', 'zz_av_p3'].map((k) => J(avatarOnDisk(k).frames))) === J(before4)
    && Object.keys(handBytes).every((k) => sha(fs.readFileSync(avatarFile(k))) === handBytes[k]) && pickPosts() === 2 && s4.finishedAt !== s1.finishedAt, J(p4));

  // ── 4b. a clip picked by hand elsewhere (avatar-clips.html, another tab) after the table was read ──
  const before4b = { clips: clipPosts(), picks: pickPosts(), bytes: sha(fs.readFileSync(avatarFile('zz_av_p3'))), shown: (await row('zz_av_p3'))[4] };
  api({ action: 'set_picks', picks: { zz_av_p3: { signer: 'P03', by: 'hand' } } });
  await click('bi-av-apply');
  await waitFor(`!${S}.av.starting && ${S}.av.notice !== null`, 15000);
  const st4b = await ev(`({ note: document.getElementById('bi-av-note').textContent, error: document.getElementById('bi-av-note').classList.contains('error'), run: ${S}.av.run.status, apply: document.getElementById('bi-av-apply').disabled })`);
  check('the data changed since the table was read (a hand pick): Apply writes nothing, shows the table again and asks to check it', before4b.shown === 'fallback P03' && st4b.note === 'The signs or the cache changed. Check the table, then press Apply again.' && st4b.error && !st4b.apply
    && clipPosts() === before4b.clips && pickPosts() === before4b.picks && J((await row('zz_av_p3')).slice(2)) === J(['P03 by hand', 'P03', 'left alone (picked by hand)', 'left-alone']), J(st4b));
  const exp4b = expected(true);
  check('Apply pressed again', await applyNew());
  const s4b = await summary(), p4b = problems(s4b, exp4b, ['zz_av_dbonly']);
  check('... then leaves that sign alone: its clip and its hand pick are untouched', p4b.length === 0 && s4b.leftAlone.includes('zz_av_p3') && J(s4b.saved) === J([{ key: 'zz_av_all', signer: 'P01' }]) && sha(fs.readFileSync(avatarFile('zz_av_p3'))) === before4b.bytes
    && picksOnDisk().zz_av_p3.by === 'hand' && pickPosts() === before4b.picks + 1 && await note() === 'Finished: 1 sign set, 1 failed.', J(p4b));

  // ── 5. keep-hand OFF, through a server error ──
  await click('bi-av-keep');
  const exp5 = expected(false);
  const t5 = await table();
  check('keep-hand off: the hand-picked signs are reassigned where a listed signer has a candidate', J(exp5.assign) === J({ zz_av_all: 'P01', zz_av_dbonly: 'P01', zz_av_hand: 'P01', zz_av_made: 'P01', zz_av_p3: 'P03' })
    && J(t5.filter((r) => /hand|made/.test(r[0])).map((r) => [r[0], r[4], r[5]])) === J([['zz_av_hand', 'set to P01', 'set'], ['zz_av_hand2', 'left alone (no clip from the listed signers; keeps its clip)', 'left-alone'], ['zz_av_made', 'set to P01', 'set']]), J(t5.filter((r) => /hand|made/.test(r[0]))));
  // in the page: the 2nd clip save from now on is answered HTTP 500 (once)
  await ev(`(() => { const real = window.fetch; window.__trap = { after: 1 }; window.__seen = 0; window.__trapped = 0;
    window.fetch = function (url, o) { const t = window.__trap;
      if (t && o && o.method === 'POST' && String(url).indexOf('avatar_clip.php') >= 0 && window.__seen++ >= t.after) { window.__trap = null; window.__trapped++;
        return Promise.resolve(new Response(JSON.stringify({ success: false, error: 'zz server error' }), { status: 500 })); }
      return real.apply(this, arguments); }; return 1; })()`);
  const picksBefore5 = pickPosts();
  await click('bi-av-apply');
  await waitFor(`${S}.av.run.status === 'paused'`, 30000, 50);
  const paused = await ev(`({ status: ${S}.av.run.status, index: ${S}.av.run.index, saved: ${S}.av.run.saved.map(s => s.key), note: document.getElementById('bi-av-note').textContent, error: document.getElementById('bi-av-note').classList.contains('error'),
    resume: document.getElementById('bi-av-resume').disabled, apply: document.getElementById('bi-av-apply').disabled, keep: document.getElementById('bi-av-keep').disabled, trapped: window.__trapped })`);
  check('a 5xx answer on a save PAUSES the Apply with a clear message and Resume (1 sign saved so far, no set_picks yet)', paused.status === 'paused' && paused.trapped === 1 && J(paused.saved) === J(['zz_av_all']) && paused.error && !paused.resume && paused.apply && paused.keep
    && /^The server answered with an error \(zz server error\)\. Nothing is lost: Resume tries "zz_av_dbonly" again\.$/.test(paused.note) && pickPosts() === picksBefore5, paused.note);
  await click('bi-av-resume');
  check('Resume completes the Apply', await applyDone());
  const s5 = await summary(), p5 = problems(s5, exp5, ['zz_av_dbonly']);
  check('keep-hand off: summary = the independent computation = the files; zz_av_hand and zz_av_made now hold P01\'s candidate, zz_av_hand2 keeps its clip', p5.length === 0 && J(s5.bySigner) === J({ P01: 3, P03: 1 }) && !s5.keepHand
    && J(avatarOnDisk('zz_av_hand').frames) === J(clips.zz_av_hand.P01.frames) && avatarOnDisk('zz_av_made').signer === 'P01' && sha(fs.readFileSync(avatarFile('zz_av_hand2'))) === handBytes.zz_av_hand2 && s5.leftAlone.includes('zz_av_hand2'), p5.length ? J(p5) : J(s5.bySigner));
  const picks5 = picksOnDisk();
  check('picks: the reassigned signs are now by "default"; exactly one set_picks for this Apply (after the Resume)', picks5.zz_av_hand.signer === 'P01' && picks5.zz_av_hand.by === 'default' && picks5.zz_av_made.by === 'default' && !picks5.zz_av_hand2 && pickPosts() === picksBefore5 + 1, `set_picks total ${pickPosts()}`);

  // ── 5b. a candidate that is gone when Apply asks for it ──
  // in the page: P01's candidate of zz_av_all and of zz_av_made answers 404 (as if deleted meanwhile)
  await ev(`(() => { const real = window.fetch; window.__gone = true; window.__goneSeen = 0;
    window.fetch = function (url, o) { const u = String(url);
      if (window.__gone && /action=candidate&key=(zz_av_all|zz_av_made)&signer=P01$/.test(u)) { window.__goneSeen++;
        return Promise.resolve(new Response(JSON.stringify({ success: false, error: 'No candidate for this sign and signer' }), { status: 404 })); }
      return real.apply(this, arguments); }; return 1; })()`);
  const exp5b = expected(false);
  check('Apply with two candidates gone finished', await applyNew(), await note());
  const s5b = await summary(), p5b = problems(s5b, exp5b, ['zz_av_dbonly', 'zz_av_made'], { assign: { zz_av_all: 'P03' } });
  check('a candidate gone at Apply time (404): the sign gets the next signer in the list that has one (zz_av_all -> P03, listed as a fallback); with none left it is listed under failed', p5b.length === 0 && await ev(`window.__goneSeen`) === 2
    && J(s5b.fallback) === J([{ key: 'zz_av_all', signer: 'P03' }, { key: 'zz_av_p3', signer: 'P03' }]) && J(s5b.failed.map((f) => [f.key, f.reason])) === J([['zz_av_dbonly', 'Sign not found'], ['zz_av_made', 'its candidates are no longer in the cache']])
    && J(avatarOnDisk('zz_av_all').frames) === J(clips.zz_av_all.P03.frames) && picksOnDisk().zz_av_all.signer === 'P03' && picksOnDisk().zz_av_all.by === 'default' && avatarOnDisk('zz_av_made').signer === 'P01', p5b.length ? J(p5b) : J(s5b.failed));
  await ev(`window.__gone = false; 1`);

  // ── 6. Refresh; layout ──
  putCandidate('zz_av_bare', 'P03');
  clips.zz_av_bare = { P03: makeClip('zz_av_bare', 'P03') };
  await click('bi-av-refresh');
  await waitFor(`(() => { const tr = document.querySelector('#bi-av-table tr[data-key="zz_av_bare"]'); return ${S}.av.status === 'ready' && tr && tr.dataset.kind === 'fallback'; })()`, 10000);
  check('Refresh reads the cache again (a candidate added meanwhile shows up)', J((await table()).find((r) => r[0] === 'zz_av_bare')) === J(['zz_av_bare', 'Zz av bare', 'none', 'P03', 'fallback P03', 'fallback']));
  const lay = await ev(`(() => { const p = document.getElementById('bi-step-avatar');
    // the side column scrolls inside itself when its cards are taller than the window (as in every step)
    const out = [...p.querySelectorAll('.bi-col, .bi-card, .bi-btn, select')].filter(e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width && (r.right > 1366.5 || r.left < 0 || (r.bottom > 768.5 && !(e.closest('.bi-col-side') && !e.classList.contains('bi-col')))); }).map(e => e.id || e.className);
    const clipped = ['bi-av-refresh', 'bi-av-apply', 'bi-av-resume', 'bi-av-to-extract'].filter(id => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1; });
    const small = [...p.querySelectorAll('.bi-btn, select')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id);
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, out, clipped, small, note: document.querySelector('#bi-step-avatar #bi-av-to-extract').textContent }; })()`);
  check('1366x768: no page scroll, nothing off-screen, no button label cut off, buttons >= 44 px', lay.sw === 1366 && lay.sh === 768 && !lay.out.length && !lay.clipped.length && !lay.small.length, J(lay));
  await shot('bulk-avatar-layout.png');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const lay2 = await ev(`(() => { const p = document.getElementById('bi-step-avatar');
    const out = [...p.querySelectorAll('.bi-col, .bi-card, .bi-btn, select, table')].filter(e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width && (r.right > 1280.5 || r.left < 0) && !e.closest('.bi-scroll'); }).map(e => e.id || e.className);
    const clipped = ['bi-av-refresh', 'bi-av-apply', 'bi-av-resume', 'bi-av-to-extract'].filter(id => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1; });
    return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, out, clipped, wide: Math.round(p.querySelector('.bi-col-wide').getBoundingClientRect().width) }; })()`);
  check('1280 wide: no horizontal scroll, nothing off-screen, no button label cut off', lay2.sw === 1280 && lay2.sh === 768 && !lay2.out.length && !lay2.clipped.length, J(lay2));
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });

  // ── 6b. a double click; the server gone; set_picks failing (keep-hand still off) ──
  // in the page: the 1st clip save gets no answer at all, the 1st set_picks is answered 500 (once each)
  await ev(`(() => { const real = window.fetch; window.__t6 = { save: true, picks: true }; window.__t6n = 0;
    window.fetch = function (url, o) { const u = String(url), t = window.__t6;
      if (o && o.method === 'POST' && t.save && u.indexOf('avatar_clip.php') >= 0) { t.save = false; window.__t6n++; return Promise.reject(new TypeError('Failed to fetch')); }
      if (o && o.method === 'POST' && t.picks && u.indexOf('bulk_import.php') >= 0) { t.picks = false; window.__t6n++; return Promise.resolve(new Response('{"success":false,"error":"zz picks error"}', { status: 500 })); }
      return real.apply(this, arguments); }; return 1; })()`);
  const exp6b = expected(false), before6b = { clips: clipPosts(), picks: pickPosts() };
  await ev(`(() => { const b = document.getElementById('bi-av-apply'); b.click(); b.click(); return 1; })()`);
  await waitFor(`${S}.av.run.status === 'paused'`, 30000, 50);
  const gone = await ev(`({ note: document.getElementById('bi-av-note').textContent, saved: ${S}.av.run.saved.length, index: ${S}.av.run.index, start: document.getElementById('bi-start').disabled })`);
  check('no answer from the server PAUSES the Apply (nothing saved yet)', /^The server did not answer \(Failed to fetch\)\. Nothing is lost: check that Apache is running, then Resume\.$/.test(gone.note) && gone.saved === 0 && gone.index === 0 && clipPosts() === before6b.clips, gone.note);
  await click('bi-av-resume');
  await waitFor(`${S}.av.run.status === 'paused' && ${S}.av.run.index === ${S}.av.run.keys.length`, 30000, 50);
  const noPicks = await ev(`({ note: document.getElementById('bi-av-note').textContent, saved: ${S}.av.run.saved.map(s => s.key), trapped: window.__t6n })`);
  check('Resume saves every clip; set_picks answering 5xx PAUSES again (the clips are saved, the picks not yet)', /^The clips are saved, but which signer each sign got could not be recorded \(zz picks error\)\. Resume tries again\.$/.test(noPicks.note) && noPicks.trapped === 2
    && J(noPicks.saved) === J(['zz_av_all', 'zz_av_bare', 'zz_av_hand', 'zz_av_made', 'zz_av_p3']) && J(avatarOnDisk('zz_av_all').frames) === J(clips.zz_av_all.P01.frames) && picksOnDisk().zz_av_all.signer === 'P03' && !picksOnDisk().zz_av_bare && pickPosts() === before6b.picks, noPicks.note);
  await click('bi-av-resume');
  check('Resume completes it', await applyDone());
  const s6b = await summary(), p6b = problems(s6b, exp6b, ['zz_av_dbonly']);
  check('a double click on Apply started ONE Apply: one save per sign, exactly one set_picks reached the server; summary = computation = files', p6b.length === 0 && clipPosts() === before6b.clips + 6 && pickPosts() === before6b.picks + 1
    && picksOnDisk().zz_av_all.signer === 'P01' && picksOnDisk().zz_av_bare.signer === 'P03' && picksOnDisk().zz_av_bare.by === 'default', p6b.length ? J(p6b) : `avatar_clip.php +${clipPosts() - before6b.clips}, set_picks +${pickPosts() - before6b.picks}`);

  // ── 6c. keep-hand on: picked by hand while the Apply was paused ──
  await click('bi-av-keep');
  const exp6c = expected(true);
  await ev(`(() => { const real = window.fetch; window.__t7 = true;
    window.fetch = function (url, o) { if (o && o.method === 'POST' && window.__t7 && String(url).indexOf('avatar_clip.php') >= 0) { window.__t7 = false; return Promise.resolve(new Response('{"success":false,"error":"zz server error"}', { status: 500 })); }
      return real.apply(this, arguments); }; return 1; })()`);
  await click('bi-av-apply');
  await waitFor(`${S}.av.run.status === 'paused'`, 30000, 50);
  const keys6c = await ev(`${S}.av.run.keys`);
  // meanwhile, on avatar-clips.html: zz_av_hand is picked by hand from P02; zz_av_made gets an own clip (its pick is removed)
  api({ action: 'set_picks', picks: { zz_av_hand: { signer: 'P02', by: 'hand' }, zz_av_made: null } });
  const bytes6c = ['zz_av_hand', 'zz_av_made'].map((k) => sha(fs.readFileSync(avatarFile(k))));
  await click('bi-av-resume');
  check('Resume (after a 5xx pause) completes', await applyDone());
  const s6c = await summary(), p6c = problems(s6c, exp6c, ['zz_av_dbonly'], { left: ['zz_av_hand', 'zz_av_made'] });
  check('keep-hand on: Resume reads the picks again; the two signs picked by hand during the pause are dropped from the work and reported as left alone', p6c.length === 0 && J(keys6c) === J(['zz_av_all', 'zz_av_bare', 'zz_av_dbonly', 'zz_av_hand', 'zz_av_made', 'zz_av_p3'])
    && J(s6c.saved.map((x) => x.key)) === J(['zz_av_all', 'zz_av_bare', 'zz_av_p3']) && s6c.leftAlone.includes('zz_av_hand') && s6c.leftAlone.includes('zz_av_made')
    && J(['zz_av_hand', 'zz_av_made'].map((k) => sha(fs.readFileSync(avatarFile(k))))) === J(bytes6c) && picksOnDisk().zz_av_hand.by === 'hand' && !picksOnDisk().zz_av_made, p6c.length ? J(p6c) : J(s6c.saved));

  // ── 7. the button to the Extract step ──
  await click('bi-av-to-extract');
  check('"Run the avatar step for signers added to the list" goes to the Extract step', lay.note === 'Run the avatar step for signers added to the list' && await ev(`${S}.step === 'extract' && document.getElementById('bi-step-extract').classList.contains('active')`));

  // everything else untouched; network; console
  check('no other sign and nothing else of the cache was touched', othersSaved() === savedBefore && othersInCache() === cacheBefore);
  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  const kinds = [...new Set(posts().map((r) => r.url.replace(/^.*\/php\/api\//, '')))].sort();
  check('every request went to localhost; the only POSTs are clip saves and set_picks', foreign.length === 0 && J(kinds) === J(['avatar_clip.php', 'bulk_import.php']) && posts().filter((r) => /bulk_import\.php$/.test(r.url)).length === pickPosts(), `${reqs.length} requests, POSTs to ${J(kinds)}`);
  const errs = c.getConsoleErrors().concat(c.getExceptions());
  check('0 console errors', errs.length === 0, J(errs).slice(0, 400));
} finally {
  await c.close();
  cleanZz();
  cleanCacheKeys(KEYS);
}
const leftPicks = Object.keys(picksOnDisk()).filter((k) => k.startsWith('zz_'));
const leftCands = Object.keys(apiGet('action=candidates').json.candidates).filter((k) => k.startsWith('zz_'));
check('cleanup: 0 zz_ folders, 0 zz candidates, 0 zz picks; the rest of the cache as before', zzFolders().length === 0 && leftPicks.length === 0 && leftCands.length === 0 && othersInCache() === cacheBefore, J({ folders: zzFolders(), leftPicks, leftCands }));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
