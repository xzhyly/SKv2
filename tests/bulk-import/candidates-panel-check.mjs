// avatar-clips.html, the "Candidates (n)" panel (the bulk importer's cached clips of the selected
// sign), end to end in headless Chrome (tests/video-capture/cdp.mjs) at 1024x600, with every
// non-localhost hostname blocked. No extraction runs: the candidates are written straight through
// php/api/bulk_import.php (tests/bulk-import/avatar-fixture.mjs, real clips).
// Fixture (zz_ only): zz_cand_three (candidates P01 P02 P03), zz_cand_other (P01), zz_cand_none,
// and zz_cand_fsl: a sign that exists as FSL with a candidate made from an ESL video (9b: shown
// with its set, Preview works, "Use this" is disabled with the reason).
//   1  The control shows the count; the panel lists the signers with their frames.
//   2  Layout with the panel closed and open: no page scroll, controls >= 44 px, nothing
//      off-screen, no label cut off (the measured boxes are printed).
//   3  Preview plays a candidate on the avatar; the main Preview button stops it.
//   4  "Use this" (P02): avatar.json = P02's candidate, pick by "hand", the tick in the list.
//   5  bulk-import.html, Avatar step, keep-hand on: Apply leaves that sign alone (and sets another).
//   6  The picker again (P03) changes the clip; a sign set by Apply is marked "default".
//   7  Delete removes the pick.
//   8  Import JSON + Save (the owner's prototype sample; skipped when it is not on this machine):
//      Signer "P05" -> a hand pick of P05; Signer "P02" -> the P02 row says "own clip", not "in
//      use"; Signer "Maria" -> the pick is removed; a pick made "default" behind the page's back
//      (the bulk importer in another tab) is removed too by a Save with no signer.
//   9  A sign without candidates: the control is disabled.
//   10 php/api/bulk_import.php failing (HTTP 500 for every request, through an in-page fetch
//      wrapper): the page still works, Save and Delete included, with 0 console errors.
//   11 Let's Talk plays the chosen clip (talk.html is only read).
// Cleanup: every zz_ sign, the zz candidates and picks; nothing else of the cache is touched.
// Run (Apache + MariaDB up, no other node test running): node tests/bulk-import/candidates-panel-check.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { launchChrome } from '../video-capture/cdp.mjs';
import { save, cleanZz, saved } from '../sign-texts/api-helper.mjs';
import { SAMPLE_JSON } from '../avatar/helper.mjs';
import { api, apiGet, picksOnDisk, avatarFile, avatarOnDisk, putCandidate, cleanCacheKeys, othersInCache, othersSaved, usingSample, ZZ_ONLY } from './avatar-fixture.mjs';

const BASE = 'http://localhost/SKR/';
const KEY = 'zz_cand_three', OTHER = 'zz_cand_other', NONE = 'zz_cand_none', FSLK = 'zz_cand_fsl';
const KEYS = [KEY, OTHER, NONE, FSLK];
const HAVE_JSON = fs.existsSync(SAMPLE_JSON);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const zzFolders = () => fs.readdirSync(saved).filter((d) => d.startsWith('zz_')).sort();

// Records every AvatarPlayer.play() of a page, before any page script runs (as tests/avatar/import-check.mjs).
const HOOKS = `(() => {
  let AP;
  Object.defineProperty(window, 'AvatarPlayer', { configurable: true, get() { return AP; }, set(v) {
    AP = v; const create = v.create;
    v.create = function (o) {
      const p = create(o); const play = p.play;
      p.play = function (preps, po) {
        const rec = { keys: preps.map((x) => x.key), frames: preps.map((x) => x.poses.length) };
        (window.__avatarRuns = window.__avatarRuns || []).push(rec);
        return play.call(p, preps, po).then((r) => { rec.done = true; rec.completed = r.completed; return r; });
      };
      return p;
    };
  } });
})();`;

cleanZz();
cleanCacheKeys(KEYS);
const cacheBefore = othersInCache();
const savedBefore = othersSaved();
const made = [save({ sign_language: 'ESL', text_en: 'Zz Cand Three' }), save({ sign_language: 'ESL', text_en: 'Zz Cand Other' }), save({ sign_language: 'ESL', text_en: 'Zz Cand None' })];
const clips = { P01: putCandidate(KEY, 'P01'), P02: putCandidate(KEY, 'P02'), P03: putCandidate(KEY, 'P03') };
const otherClip = putCandidate(OTHER, 'P01');
made.push(save({ label: FSLK, sign_language: 'FSL' }));
const fslClip = putCandidate(FSLK, 'P01', 'ESL');
check('set-up: 4 zz signs; zz_cand_three has candidates P01 P02 P03, zz_cand_other P01, zz_cand_none none, the FSL sign zz_cand_fsl one of an ESL video (' + (usingSample ? 'clips cut from the prototype sample' : 'made-up clips') + ')',
  made.every((r) => r.status === 200) && J(apiGet('action=candidates&key=' + KEY).json.candidates[KEY].map((x) => [x.signer, x.frames])) === J(['P01', 'P02', 'P03'].map((s) => [s, clips[s].frames.length]))
  && new Set(Object.values(clips).map((x) => x.frames.length)).size === 3 && KEYS.every((k) => !fs.existsSync(avatarFile(k))));

const c = await launchChrome({ port: 9484, extraArgs: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ev = (e) => c.evaluate(e);
const waitFor = async (expr, ms = 20000, step = 100) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(step); } return false; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return false; };
const statusText = () => ev(`document.getElementById('ac-status').textContent`);
const statusIs = (re, ms = 15000) => waitFor(`${re}.test(document.getElementById('ac-status').textContent)`, ms);
const click = (id) => ev(`document.getElementById('${id}').click(); 1`);
const pickJson = async (file) => {
  const doc = await c.send('DOM.getDocument', {});
  const node = await c.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#ac-json' });
  await c.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [file.replace(/\//g, '\\')] });
};
const openClips = async () => {
  await c.navigate(BASE + 'avatar-clips.html');
  await ev(`localStorage.removeItem('sk_avatar_signer'); location.reload(); 1`);
  await sleep(2000);
  await waitFor(`document.querySelectorAll('.ac-item').length > 3 && !document.getElementById('ac-view-avatar').disabled`);
  await ev(`document.getElementById('ac-search').value = 'zz cand'; document.getElementById('ac-search').dispatchEvent(new Event('input')); 1`);
  return waitFor(`document.querySelectorAll('.ac-item').length === 4`);
};
const select = async (key, n) => {
  await ev(`document.querySelector('.ac-item[data-key="${key}"]').click(); 1`);
  if (n === undefined) { await sleep(600); return true; }
  return waitFor(`document.getElementById('ac-cands-open').textContent === 'Candidates (${n})'`, 8000);
};
const control = () => ev(`(() => { const b = document.getElementById('ac-cands-open'); return { text: b.textContent, disabled: b.disabled, expanded: b.getAttribute('aria-expanded'), open: !document.getElementById('ac-cands').hidden }; })()`);
const panel = () => ev(`({ title: document.getElementById('ac-cands-title').textContent, rows: [...document.querySelectorAll('#ac-cands .ac-cand')].map(r => [r.dataset.signer, r.querySelector('.ac-cand-frames').textContent, r.querySelector('.ac-cand-mark').textContent, [...r.querySelectorAll('button')].map(b => b.textContent + (b.disabled ? ' (disabled)' : ''))]) })`);
const openPanel = async () => { if (!(await control()).open) await click('ac-cands-open'); return waitFor(`!document.getElementById('ac-cands').hidden && [...document.querySelectorAll('#ac-cands .ac-cand button')].every(b => !b.disabled)`, 15000); };
const rowClick = (signer, act) => ev(`document.querySelector('#ac-cands .ac-cand[data-signer="${signer}"] button[data-act="${act}"]').click(); 1`);
const markIs = (signer, text, ms = 8000) => waitFor(`(document.querySelector('#ac-cands .ac-cand[data-signer="${signer}"] .ac-cand-mark') || {}).textContent === ${J(text)}`, ms);
const tick = (key) => ev(`(document.querySelector('.ac-item[data-key="${key}"] .ac-item-clip') || {}).textContent`);
const sameClip = (key, clip, signer) => { const d = avatarOnDisk(key); return !!d && J(d.frames) === J(clip.frames) && d.signer === signer && d.key === key && d.format === 'sk_avatar_clip_v1'; };
const pickOf = (key) => picksOnDisk()[key];
const LAYOUT = `(() => {
  const vis = (e) => e.offsetParent && !e.closest('[hidden]');
  const small = [...document.querySelectorAll('#ac-ui button, #ac-ui .ac-btn, #ac-ui input:not([type=file]), #ac-ui .ac-handle, #ac-ui a')].filter(e => vis(e) && e.getBoundingClientRect().height < 44).map(e => e.id || e.className || e.tagName);
  const out = [...document.querySelectorAll('#ac-ui *')].filter(e => { const r = e.getBoundingClientRect(); return vis(e) && r.width && (r.right > 1024.5 || r.bottom > 600.5 || r.left < -0.5 || r.top < -0.5); }).map(e => e.id || e.className);
  const labels = ['ac-choose', 'ac-import', 'ac-export', 'ac-preview', 'ac-delete', 'ac-redo', 'ac-save', 'ac-cands-open'].map(id => document.getElementById(id)).concat([...document.querySelectorAll('#ac-cands button')]).filter(vis);
  const clipped = labels.filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => e.id || e.textContent);
  const box = (e) => { if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
  const q = (s) => box(document.querySelector(s));
  const panel = document.getElementById('ac-cands').getBoundingClientRect(), list = document.querySelector('.ac-list-wrap').getBoundingClientRect();
  const inside = [...document.querySelectorAll('#ac-cands .ac-cand, #ac-cands button')].filter(vis).every(e => { const r = e.getBoundingClientRect(); return r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5; });
  return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, small, out, clipped, inside,
    overList: Math.abs(panel.left - list.left) < 1 && Math.abs(panel.top - list.top) < 1 && Math.abs(panel.width - list.width) < 1 && Math.abs(panel.height - list.height) < 1,
    boxes: { list: q('#ac-list'), selected: q('#ac-selected'), candidatesButton: q('#ac-cands-open'), panel: q('#ac-cands'), close: q('#ac-cands-close'), row: q('#ac-cands .ac-cand'),
      rowPreview: q('#ac-cands .ac-cand button[data-act="preview"]'), rowUse: q('#ac-cands .ac-cand button[data-act="use"]'), choose: q('#ac-choose'), signer: q('#ac-signer') } }; })()`;
const layoutOk = (l) => l.sw === 1024 && l.sh === 600 && !l.small.length && !l.out.length && !l.clipped.length;

try {
  await c.enableNetwork();
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOKS });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: ZZ_ONLY });   // bulk-import.html in section 5

  // ── 1. the control and the panel ──
  check('avatar-clips.html opened', await openClips());
  const c0 = await control();
  check('before a sign is picked: "Candidates (0)", disabled, panel closed', c0.text === 'Candidates (0)' && c0.disabled && !c0.open && c0.expanded === 'false', J(c0));
  check('a sign with 3 candidates: the control shows the count and is enabled', await select(KEY, 3) && !(await control()).disabled, J(await control()));
  const closed = await ev(LAYOUT);
  check('1024x600, panel closed: no page scroll, controls >= 44 px, nothing off-screen, no label cut off', layoutOk(closed), J(closed));
  check('the panel opens', await openPanel() && (await control()).expanded === 'true');
  const p1 = await panel();
  check('the panel lists P01, P02, P03 with their frames, Preview and Use this; none is in use yet', p1.title === 'Candidates for "Zz Cand Three"'
    && J(p1.rows) === J(['P01', 'P02', 'P03'].map((s) => [s, clips[s].frames.length + ' frames · ESL', '', ['▶ Preview', 'Use this']])), J(p1));

  // ── 2. layout with the panel open ──
  const open = await ev(LAYOUT);
  check('1024x600, panel open: no page scroll, controls >= 44 px, nothing off-screen, no label cut off; the panel lies exactly over the sign list', layoutOk(open) && open.overList && open.inside
    && open.boxes.row[3] >= 44 && open.boxes.rowPreview[3] >= 44 && open.boxes.rowUse[3] >= 44 && open.boxes.close[3] >= 44 && open.boxes.candidatesButton[3] >= 44, J(open));
  console.log('      boxes [x, y, w, h] closed: ' + J(closed.boxes));
  console.log('      boxes [x, y, w, h] open:   ' + J(open.boxes));

  // ── 3. Preview ──
  await rowClick('P03', 'preview');
  const playing = await waitFor(`(window.__avatarRuns || []).length === 1 && document.getElementById('ac-preview').textContent.includes('Stop')`, 10000);
  const pv = await ev(`({ runs: window.__avatarRuns, stage: document.getElementById('ac-stage').classList.contains('avatar'), main: document.getElementById('ac-preview').textContent, mainDisabled: document.getElementById('ac-preview').disabled,
    row: document.querySelector('#ac-cands .ac-cand[data-signer="P03"] button[data-act="preview"]').textContent, others: document.querySelector('#ac-cands .ac-cand[data-signer="P01"] button[data-act="preview"]').textContent, status: document.getElementById('ac-status').textContent })`);
  check('Preview plays that candidate on the avatar (the stage switches to the avatar; its row and the main Preview show Stop)', playing && pv.runs.length === 1 && pv.runs[0].frames[0] === clips.P03.frames.length && pv.stage && pv.row === '■ Stop' && pv.others === '▶ Preview'
    && !pv.mainDisabled && /^Playing the candidate of P03/.test(pv.status), J({ run: pv.runs && pv.runs[0], main: pv.main, row: pv.row, status: pv.status }));
  await sleep(600);
  await click('ac-preview');
  check('the main Preview button stops it (the clip did not finish), and nothing was saved', await waitFor(`window.__avatarRuns[0].done && document.getElementById('ac-preview').textContent === '▶ Preview' && document.querySelector('#ac-cands .ac-cand[data-signer="P03"] button[data-act="preview"]').textContent === '▶ Preview'`, 5000)
    && await ev(`window.__avatarRuns[0].completed === false && window.__avatarRuns.length === 1`) && !fs.existsSync(avatarFile(KEY)) && c.getNetworkRequests().filter((r) => r.method === 'POST').length === 0);
  await rowClick('P01', 'preview');
  await waitFor(`(window.__avatarRuns || []).length === 2`, 10000);
  await rowClick('P02', 'preview');
  check('another candidate\'s Preview replaces the one playing', await waitFor(`(window.__avatarRuns || []).length === 3 && document.querySelector('#ac-cands .ac-cand[data-signer="P02"] button[data-act="preview"]').textContent === '■ Stop'`, 10000)
    && await ev(`window.__avatarRuns[1].frames[0] === ${clips.P01.frames.length} && window.__avatarRuns[2].frames[0] === ${clips.P02.frames.length} && document.querySelector('#ac-cands .ac-cand[data-signer="P01"] button[data-act="preview"]').textContent === '▶ Preview' && document.getElementById('ac-preview').textContent.includes('Stop')`));
  await rowClick('P02', 'preview');                    // its own button stops it too
  await waitFor(`document.getElementById('ac-preview').textContent === '▶ Preview'`, 5000);

  // ── 4. Use this ──
  await rowClick('P02', 'use');
  check('"Use this" on P02: status "Clip set from P02 (picked by hand)."', await statusIs('/^Clip set from P02 \\(picked by hand\\)\\.$/'), await statusText());
  check('avatar.json is P02\'s candidate clip (frames, signer, key); picks[key] = {signer: P02, by: hand}', sameClip(KEY, clips.P02, 'P02') && pickOf(KEY) && pickOf(KEY).signer === 'P02' && pickOf(KEY).by === 'hand', J(pickOf(KEY)));
  await waitFor(`(document.querySelector('.ac-item[data-key="${KEY}"] .ac-item-clip') || {}).textContent === '✓'`, 8000);
  await markIs('P02', '✓ in use · picked by hand');     // looked up: the saved clip really is P02's candidate
  const p4 = await panel();
  check('the list shows the tick; the panel marks P02 as in use, picked by hand; Export / Delete / Preview are enabled', await tick(KEY) === '✓' && J(p4.rows.map((r) => [r[0], r[2]])) === J([['P01', ''], ['P02', '✓ in use · picked by hand'], ['P03', '']])
    && await ev(`!document.getElementById('ac-export').disabled && !document.getElementById('ac-delete').disabled && !document.getElementById('ac-preview').disabled && /has a clip/.test(document.getElementById('ac-selected').textContent)`), J(p4.rows.map((r) => [r[0], r[2]])));
  const errsA = c.getConsoleErrors().concat(c.getExceptions());

  // ── 5. bulk-import.html: Apply with keep-hand on leaves it alone ──
  await c.navigate(BASE + 'bulk-import.html');
  await waitFor(`!!window.BulkImport && document.getElementById('bi-ui').classList.contains('active') && BulkImport.state.engines !== 'loading' && BulkImport.state.engines !== 'idle'`, 60000);
  await click('bi-tab-avatar');
  await waitFor(`BulkImport.state.av.status === 'ready'`);
  await ev(`BulkImport.setAvatarSigners(['P01']); 1`);
  const rowsB = await ev(`[...document.querySelectorAll('#bi-av-table tbody tr')].filter(tr => tr.dataset.key.indexOf('zz_') === 0).map(tr => [tr.dataset.key, tr.children[2].textContent, tr.children[4].textContent])`);
  const bytesB = sha(fs.readFileSync(avatarFile(KEY)));
  await click('bi-av-apply');
  const applied = await waitFor(`BulkImport.state.av.run.status === 'done' && BulkImport.state.av.status === 'ready'`, 60000);
  const sumB = await ev(`BulkImport.lastAvatarSummary()`);
  check('bulk-import Avatar step, keep-hand on: the sign picked here is "left alone (picked by hand)"; Apply sets the other sign and does not touch it', applied
    && J(rowsB) === J([[FSLK, 'none', 'candidate P01 is ESL, the sign is FSL — not used'], [NONE, 'none', 'no clip'], [OTHER, 'none', 'set to P01'], [KEY, 'P02 by hand', 'left alone (picked by hand)']])
    && !fs.existsSync(avatarFile(FSLK))
    && J(sumB.saved) === J([{ key: OTHER, signer: 'P01' }]) && sumB.leftAlone.includes(KEY) && sha(fs.readFileSync(avatarFile(KEY))) === bytesB && pickOf(KEY).by === 'hand' && pickOf(KEY).signer === 'P02'
    && sameClip(OTHER, otherClip, 'P01') && pickOf(OTHER).by === 'default', J({ rows: rowsB, saved: sumB.saved }));
  const errsB = c.getConsoleErrors().concat(c.getExceptions());

  // ── 6. the picker again ──
  await openClips();
  await select(OTHER, 1);
  await openPanel();
  check('a sign set by "Apply to all signs" is marked "in use · default"', await markIs('P01', '✓ in use · default') && J((await panel()).rows.map((r) => [r[0], r[2]])) === J([['P01', '✓ in use · default']]));
  await select(KEY, 3);
  check('selecting another sign closes the panel', !(await control()).open);
  await openPanel();
  check('reloaded page: P02 is still marked in use, picked by hand', await markIs('P02', '✓ in use · picked by hand') && J((await panel()).rows.map((r) => [r[0], r[2]])) === J([['P01', ''], ['P02', '✓ in use · picked by hand'], ['P03', '']]));
  await rowClick('P03', 'use');
  await statusIs('/^Clip set from P03 \\(picked by hand\\)\\.$/');
  check('"Use this" on P03 changes avatar.json to P03\'s candidate; the pick and the mark follow', sameClip(KEY, clips.P03, 'P03') && pickOf(KEY).signer === 'P03' && pickOf(KEY).by === 'hand'
    && await waitFor(`(document.querySelector('#ac-cands .ac-cand[data-signer="P03"] .ac-cand-mark') || {}).textContent === '✓ in use · picked by hand' && document.querySelector('#ac-cands .ac-cand[data-signer="P02"] .ac-cand-mark').textContent === ''`, 5000), await statusText());
  await click('ac-cands-close');
  check('Close closes the panel; the sign list is back', !(await control()).open && await ev(`document.querySelectorAll('.ac-item').length === 4`));

  // ── 7. Delete removes the pick ──
  await click('ac-delete');
  await click('ac-delete');
  check('Delete: the clip is gone and the pick is removed; the candidates stay', await statusIs('/^The clip was deleted/') && !fs.existsSync(avatarFile(KEY)) && await until(() => pickOf(KEY) === undefined)
    && await waitFor(`document.querySelector('.ac-item[data-key="${KEY}"] .ac-item-clip').textContent === '—'`, 5000) && (await control()).text === 'Candidates (3)', J(pickOf(KEY) || null));

  // ── 8. Save from a JSON records / removes the pick ──
  const importAndSave = async (signer) => {
    await ev(`window.avatarClipsLastImport = null; 1`);
    await pickJson(SAMPLE_JSON);
    if (!(await waitFor(`!!window.avatarClipsLastImport`, 15000))) return false;
    await ev(`(() => { const i = document.getElementById('ac-signer'); i.value = ${J(signer)}; i.dispatchEvent(new Event('input')); document.getElementById('ac-status').textContent = ''; return 1; })()`);
    await click('ac-save');
    return statusIs('/^Saved/');
  };
  if (HAVE_JSON) {
    check('Import JSON + Save with Signer "p05": saved, and a hand pick of P05 is recorded', await importAndSave('p05') && avatarOnDisk(KEY).signer === 'p05' && await until(() => pickOf(KEY) && pickOf(KEY).signer === 'P05' && pickOf(KEY).by === 'hand'), J(pickOf(KEY) || null));
    await openPanel();
    check('... no candidate is marked in use then (the clip is not one of them)', (await panel()).rows.every((r) => r[2] === ''));
    await click('ac-cands-close');
    check('Import JSON + Save with Signer "P02": a hand pick of P02', await importAndSave('P02') && await until(() => pickOf(KEY) && pickOf(KEY).signer === 'P02' && pickOf(KEY).by === 'hand'), J(pickOf(KEY) || null));
    await openPanel();
    check('... the P02 row says "picked by hand (own clip)", not "in use": the saved clip is not P02\'s candidate', await markIs('P02', 'picked by hand (own clip)') && J((await panel()).rows.map((r) => r[2])) === J(['', 'picked by hand (own clip)', '']), J((await panel()).rows.map((r) => r[2])));
    await click('ac-cands-close');
    check('Import JSON + Save with Signer "Maria" (not P01..P99): saved, and the pick is removed', await importAndSave('Maria') && avatarOnDisk(KEY).signer === 'Maria' && await until(() => pickOf(KEY) === undefined), J(pickOf(KEY) || null));
    // behind the page's back (the bulk importer's Apply in another tab): the sign is now "default"
    api({ action: 'set_picks', picks: { [KEY]: { signer: 'P01', by: 'default' } } });
    const stale = await ev(`document.getElementById('ac-cands-open').textContent`);
    check('a pick recorded elsewhere after this page read the picks ("default"): a Save with no signer still removes it (the picks are read again first)', pickOf(KEY).by === 'default' && stale === 'Candidates (3)'
      && await importAndSave('') && !('signer' in avatarOnDisk(KEY) && avatarOnDisk(KEY).signer) && await until(() => pickOf(KEY) === undefined), J(pickOf(KEY) || null));
  } else {
    console.log('SKIP  Import JSON + Save (2 checks): ' + SAMPLE_JSON + ' is not on this machine');
  }

  // ── 9. a sign without candidates ──
  await select(NONE, 0);
  const c9 = await control();
  await click('ac-cands-open');
  check('a sign without candidates: "Candidates (0)", disabled, the panel cannot be opened', c9.text === 'Candidates (0)' && c9.disabled && !(await control()).open, J(c9));

  // ── 9b. a candidate made from a video of another set than the sign's ──
  await select(FSLK, 1);
  await click('ac-cands-open');
  await waitFor(`!document.getElementById('ac-cands').hidden && !document.querySelector('#ac-cands .ac-cand button[data-act="preview"]').disabled`, 15000);
  const blocked = await ev(`(() => { const r = document.querySelector('#ac-cands .ac-cand[data-signer="P01"]'), use = r.querySelector('button[data-act="use"]'), pv = r.querySelector('button[data-act="preview"]');
    return { frames: r.querySelector('.ac-cand-frames').textContent, mark: r.querySelector('.ac-cand-mark').textContent, use: use.disabled, title: use.title, label: use.getAttribute('aria-label'), preview: pv.disabled, selected: document.getElementById('ac-selected').textContent }; })()`);
  const layBlocked = await ev(LAYOUT);
  await ev(`window.__avatarRuns = []; 1`);
  await rowClick('P01', 'preview');
  const playedBlocked = await waitFor(`(window.__avatarRuns || []).length === 1 && window.__avatarRuns[0].frames[0] === ${fslClip.frames.length} && document.getElementById('ac-preview').textContent.includes('Stop')`, 10000);
  await click('ac-preview');
  await waitFor(`document.getElementById('ac-preview').textContent === '▶ Preview'`, 5000);
  await rowClick('P01', 'use');                        // disabled: nothing happens
  await sleep(600);
  check('a candidate of an ESL video for a sign that exists as FSL: its set is shown, Preview plays it, "Use this" is disabled with the reason; nothing is saved', blocked.frames === fslClip.frames.length + ' frames · ESL'
    && blocked.mark === 'made from an ESL video; this sign is FSL — cannot be used' && blocked.use && !blocked.preview && /made from an ESL video; this sign is FSL/.test(blocked.title) && /cannot be used/.test(blocked.label) && /\(FSL\)/.test(blocked.selected)
    && playedBlocked && !fs.existsSync(avatarFile(FSLK)) && !pickOf(FSLK) && layoutOk(layBlocked), J({ ...blocked, row: layBlocked.boxes.row }));
  await click('ac-cands-close');

  // ── 10. the endpoint failing ──
  const errsC = c.getConsoleErrors().concat(c.getExceptions());
  await ev(`(() => { const real = window.fetch; window.__bulkFailed = 0;
    window.fetch = function (url) { if (String(url).indexOf('bulk_import.php') >= 0) { window.__bulkFailed++; return Promise.resolve(new Response('<h1>Internal Server Error</h1>', { status: 500 })); } return real.apply(this, arguments); }; return 1; })()`);
  await select(KEY);
  const c10 = await control();
  const st10 = await ev(`({ text: document.getElementById('ac-status').textContent, error: document.getElementById('ac-status').classList.contains('error'), json: document.getElementById('ac-json').disabled, failed: window.__bulkFailed })`);
  check('bulk_import.php answering 500: the sign is selected as usual, "Candidates (0)" disabled, no error shown', c10.text === 'Candidates (0)' && c10.disabled && !st10.error && !st10.json && st10.failed >= 1 && /^(This sign has a clip|Choose a video)/.test(st10.text), J(st10));
  if (HAVE_JSON) {
    const pickBefore = J(pickOf(KEY) || null);
    check('... Save still works; the status line says the choice could not be recorded', await importAndSave('P06') && avatarOnDisk(KEY).signer === 'P06' && await statusIs('/^Saved: .* The choice could not be recorded as picked by hand\\.$/', 8000)
      && !(await ev(`document.getElementById('ac-status').classList.contains('error')`)) && J(pickOf(KEY) || null) === pickBefore, await statusText());
  } else {
    putCandidate(KEY, 'P01');
  }
  if (fs.existsSync(avatarFile(KEY))) {
    await click('ac-delete');
    await click('ac-delete');
    check('... Delete still works', await statusIs('/^The clip was deleted/') && !fs.existsSync(avatarFile(KEY)) && !(await ev(`document.getElementById('ac-status').classList.contains('error')`)), await statusText());
  }
  const warns = (await ev(`window.__bulkFailed`));
  const errsD = c.getConsoleErrors().concat(c.getExceptions());
  check('avatar-clips.html: 0 console errors, also with the endpoint failing (' + warns + ' requests answered 500)', errsA.length === 0 && errsD.length === errsB.length && errsC.length === errsB.length, J(errsD).slice(0, 400));
  check('bulk-import.html: 0 console errors', errsB.length === errsA.length, J(errsB).slice(0, 400));

  // ── 11. Let's Talk plays the chosen clip ──
  await openClips();                                   // a fresh page: the endpoint answers again
  await select(KEY, 3);
  await openPanel();
  await rowClick('P01', 'use');
  check('the clip is chosen again (P01)', await statusIs('/^Clip set from P01 \\(picked by hand\\)\\.$/') && sameClip(KEY, clips.P01, 'P01'), await statusText());
  const errsE = c.getConsoleErrors().concat(c.getExceptions());
  await c.navigate(BASE + 'talk.html');
  check('talk.html: loading queue settled', await waitFor(`!!(window.TalkLoader && TalkLoader.isSettled())`, 120000, 250));
  await ev(`showScreen('speaking'); 1`);
  await sleep(1500);
  await ev(`(() => { window.__vids = 0; const f = document.getElementById('speaking-sign-frame'); new MutationObserver(() => { window.__vids = Math.max(window.__vids, f.querySelectorAll('video[src]').length); }).observe(f, { childList: true, subtree: true, attributes: true });
    const i = document.getElementById('speaking-input'); i.value = 'zz cand three'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`);
  await sleep(200);
  await ev(`document.getElementById('speaking-translate').click(); 1`);
  await waitFor(`(window.__avatarRuns || []).length === 1 && window.__avatarRuns[0].done`, 60000, 250);
  const run = await ev(`({ runs: window.__avatarRuns, vids: window.__vids })`);
  check('Let\'s Talk plays the chosen clip on the avatar (one run, that key, P01\'s frame count, no video)', run.runs && run.runs.length === 1 && J(run.runs[0].keys) === J([KEY]) && run.runs[0].completed && run.runs[0].frames[0] === clips.P01.frames.length && run.vids === 0, J(run));
  const errsF = c.getConsoleErrors().concat(c.getExceptions());
  check('talk.html: 0 console errors', errsF.length === errsE.length && errsE.length === errsD.length, J(errsF).slice(0, 400));

  // ── network ──
  const reqs = c.getNetworkRequests().filter((r) => /^https?:/.test(r.url));
  const foreign = reqs.filter((r) => new URL(r.url).hostname !== 'localhost');
  check('every request went to localhost (all other hosts blocked)', foreign.length === 0, `${reqs.length} requests, ${foreign.length} elsewhere`);
  check('nothing else of the cache and no other sign (saved_gestures, every non-zz file) was touched', othersInCache() === cacheBefore && othersSaved() === savedBefore);
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
