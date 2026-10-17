// Browser check for Task 5 of the sign-texts phase: the "View Active Gesture Dataset" modal on
// gesture-training.html (English | Filipino | Set | Samples | Edit | Delete table, search over key
// and both texts, edit panel that changes a sign's set and texts without re-recording), at exactly
// 1024x600 (headless Chrome via CDP, tests/video-capture/cdp.mjs), logged in as admin (no PIN since 2026-10-18).
//
// It creates ONE zz-prefixed probe sign ("Zz Edit Probe" -> key zz_edit_probe) through
// php/api/save_gesture.php, edits only that probe, and deletes it at the end (delete_gesture).
// Real (non-zz) signs are never edited or deleted.
//
// Run (Apache + MariaDB up): node tests/sign-texts/dataset-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchChrome } from '../video-capture/cdp.mjs';

const BASE = 'http://localhost/SKR/';
const PAGE_URL = BASE + 'gesture-training.html';
const KEY = 'zz_edit_probe';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`); }
}
const post = async (file, body) => (await fetch(BASE + 'php/api/' + file, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const get = async (file) => (await fetch(BASE + 'php/api/' + file)).json();
const frames = Array.from({ length: 3 }, (_, i) => ({ index: i, timestamp: i, landmarks: Array(126).fill(0.1) }));
const probeDir = path.join(REPO, 'saved_gestures', KEY);
const sampleHashes = () => fs.existsSync(probeDir)
  ? fs.readdirSync(probeDir).filter((f) => /^sample_.*\.json$/.test(f)).sort().map((f) => f + ':' + createHash('sha1').update(fs.readFileSync(path.join(probeDir, f))).digest('hex')).join('|')
  : '';

const R = `const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, bottom: Math.round(b.bottom * 10) / 10 }; };
  const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';`;

async function main() {
  // clean any leftover probe from an aborted run (zz only)
  await post('save_gesture.php', { action: 'delete_gesture', label: KEY });
  const made = await post('save_gesture.php', { frames, text_en: 'Zz Edit Probe', sign_language: 'ESL', category: 'word' });
  if (!made.success) throw new Error('probe save failed: ' + JSON.stringify(made));
  const hashBefore = sampleHashes();
  console.log(`probe ${KEY} saved; sample files: ${hashBefore.split('|').length}`);

  const chrome = await launchChrome({ port: 9342 });
  let deleted = false;
  try {
    const ev = (expr) => chrome.evaluate(expr);
    const waitFor = async (expr, n = 100) => { for (let i = 0; i < n; i++) { if (await ev(expr)) return true; await sleep(100); } return false; };
    const search = (q) => ev(`(() => { const s = document.getElementById('datasetSearch'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const rows = () => ev(`Array.from(document.querySelectorAll('#datasetModalBody tbody tr')).map((tr) => Array.from(tr.cells).map((c) => c.textContent))`);
    const setText = (id, v) => ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const pickSet = (v) => ev(`(() => { const r = document.querySelector('input[name="dsEditSet"][value="${v}"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const waitRows = async (pred, n = 80) => { for (let i = 0; i < n; i++) { const r = await rows(); if (pred(r)) return r; await sleep(100); } return rows(); };
    const toasts = () => ev(`window.__toasts.slice()`);
    const openModal = async () => { await ev(`trOpenDatasetModal(); true`); await sleep(350); };
    const editFromRow = async () => { await ev(`document.querySelector('#datasetModalBody tr[data-key="${KEY}"] .tr-ds-editbtn').click(); true`); await sleep(150); };
    const save = async () => { await ev(`document.getElementById('dsEditSave').click(); true`); await sleep(150); };
    let reloadsSeen = 0;
    const waitSaved = async () => { const ok = await waitFor(`window.__toasts.includes('Saved.') && window.__reloaded > ${reloadsSeen} && !document.getElementById('datasetEditPanel').offsetParent`, 150); reloadsSeen = await ev(`window.__reloaded`); await ev(`window.__toasts = []; true`); return ok; };

    await chrome.navigate(PAGE_URL);
    check('page ready', await waitFor(`!!(window.GestureDataRecorder && typeof showStepContent === 'function')`, 150));
    await sleep(500);
    await ev(`showStepContent(1); true`);
    check('startup dataset load sees the probe', await waitFor(`!!GestureDataRecorder.getSigns().${KEY} && document.getElementById('datasetCount').textContent !== '0 gestures'`, 600));
    await sleep(400);
    await ev(`window.__toasts = []; (() => { const o = window.showToast; window.showToast = function (m) { window.__toasts.push(String(m)); return o.apply(this, arguments); }; })(); window.__reloaded = 0; (() => { const o = window.reloadDataset; window.reloadDataset = async function () { const r = await o.apply(this, arguments); window.__reloaded++; return r; }; })(); window.__ms = 0; (() => { const f = window.fetch; window.fetch = function (u) { if (String(u).includes('model_status.php')) window.__ms++; return f.apply(this, arguments); }; })(); true`);

    console.log('--- table at 1024x600 ---');
    await openModal();
    const card = await ev(`(() => { ${R} return { card: r(document.querySelector('#datasetModal .tr-modal-card')), header: r(document.querySelector('#datasetModal .tr-modal-header')), headers: Array.from(document.querySelectorAll('#datasetModalBody th')).map((t) => t.textContent) }; })()`);
    console.log('  card', JSON.stringify(card.card), 'header h', card.header.h);
    check('card width 960 at 1024 wide', card.card.w === 960, `${card.card.w}`);
    check('columns English text | Filipino text | Set | Samples | Edit | Delete', JSON.stringify(card.headers) === JSON.stringify(['English text', 'Filipino text', 'Set', 'Samples', 'Edit', 'Delete']), JSON.stringify(card.headers));
    const tabCounts = await ev(`Array.from(document.querySelectorAll('#datasetTabs .tr-ds-count')).map((e) => Number(e.textContent))`);
    const signCount = await ev(`Object.keys(GestureDataRecorder.getSigns()).length`);
    check('tab counts sum to number of signs', tabCounts.reduce((a, b) => a + b, 0) === signCount, `${JSON.stringify(tabCounts)} = ${signCount}`);
    const noSearch = await ev(`(() => { ${R} const trs = Array.from(document.querySelectorAll('#datasetModalBody tbody tr')); const body = document.getElementById('datasetModalBody'); return { rows: trs.length, minRow: Math.min(...trs.map((t) => r(t).h)), body: r(body), scrolls: body.scrollHeight > body.clientHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }; })()`);
    console.log('  words tab', JSON.stringify(noSearch));
    check('rows >= 44 px tall', noSearch.minRow >= 44, `min ${noSearch.minRow}`);
    check('table body scrolls inside modal; page does not (1024x600)', noSearch.sw === 1024 && noSearch.sh === 600, `${noSearch.sw}x${noSearch.sh}; body scrolls: ${noSearch.scrolls}`);

    console.log('--- search + row ---');
    await search('zz edit');
    let rs = await rows();
    check('search "zz edit" -> 1 row, Filipino "—", ESL', rs.length === 1 && rs[0][0] === 'Zz Edit Probe' && rs[0][1] === '—' && rs[0][2] === 'ESL' && rs[0][3] === '1', JSON.stringify(rs));
    await search('ZZ_EDIT');
    check('search matches the key, case-insensitive', (await rows()).length === 1);
    await search('nonexistent-qqq');
    check('no match -> "No matches"', (await rows()).length === 1 && (await rows())[0][0] === 'No matches');
    await search('zz edit');
    const btns = await ev(`(() => { ${R} return Array.from(document.querySelectorAll('#datasetModalBody tr[data-key="${KEY}"] button')).map((b) => ({ t: b.textContent, ...r(b) })); })()`);
    console.log('  row buttons', JSON.stringify(btns));
    check('Edit and Delete buttons >= 44x44', btns.length === 2 && btns.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(btns.map((b) => [b.t, b.w, b.h])));

    console.log('--- edit panel (no keyboard) ---');
    await editFromRow();
    const p1 = await ev(`(() => { ${R} const vs = (id) => vis(document.getElementById(id)); return {
      title: document.getElementById('datasetModalTitle').textContent, type: document.getElementById('dsEditType').textContent,
      tabsHidden: !vs('datasetTabs'), searchHidden: !vs('datasetSearch'), tableHidden: !vs('datasetModalBody'), panel: vs('datasetEditPanel'),
      en: vs('dsEditEn'), fil: vs('dsEditFil'), enVal: document.getElementById('dsEditEn').value,
      checked: document.querySelector('input[name="dsEditSet"]:checked').value }; })()`);
    check('header "Edit sign — key: zz_edit_probe · 1 sample"', p1.title === `Edit sign — key: ${KEY} · 1 sample`, p1.title);
    check('table, tabs and search hidden; panel shown', p1.tabsHidden && p1.searchHidden && p1.tableHidden && p1.panel);
    check('ESL: English shown & prefilled, Filipino hidden, Type: Word', p1.en && !p1.fil && p1.enVal === 'Zz Edit Probe' && p1.checked === 'ESL' && p1.type === 'Type: Word', JSON.stringify(p1));
    // Cancel returns to the table on same tab/search; nothing sent
    await ev(`window.__fetches = []; (() => { const o = window.fetch; window.fetch = function (u) { window.__fetches.push(String(u)); return o.apply(this, arguments); }; })(); true`);
    await ev(`document.getElementById('dsEditCancel').click(); true`);
    await sleep(100);
    const afterCancel = await ev(`({ q: document.getElementById('datasetSearch').value, rows: document.querySelectorAll('#datasetModalBody tbody tr').length, fetches: window.__fetches.length, title: document.getElementById('datasetModalTitle').textContent })`);
    check('Cancel -> table, same search, nothing sent', afterCancel.q === 'zz edit' && afterCancel.rows === 1 && afterCancel.fetches === 0 && /Active Gesture Dataset/.test(afterCancel.title), JSON.stringify(afterCancel));

    console.log('--- validation ---');
    await editFromRow();
    await setText('dsEditEn', '   ');
    await save();
    check('empty English -> "Enter the English text." inside panel', (await ev(`document.getElementById('dsEditMsg').textContent`)) === 'Enter the English text.' && (await ev(`window.__fetches.length`)) === 0);
    await setText('dsEditEn', 'Zz Edit Probe');
    await pickSet('BOTH');
    await setText('dsEditFil', '');
    await save();
    check('Both with empty Filipino -> "Enter the Filipino text."', (await ev(`document.getElementById('dsEditMsg').textContent`)) === 'Enter the Filipino text.');

    console.log('--- keyboard-open edit panel at 1024x600 ---');
    const kbMeasure = (focusId) => ev(`(async () => {
      ${R}
      const el = document.getElementById(${JSON.stringify(focusId)}); el.focus();
      if (!document.body.classList.contains('keyboard-active')) el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 500));
      const card = document.querySelector('#datasetModal .tr-modal-card'), panel = document.getElementById('datasetEditPanel');
      const cb = card.getBoundingClientRect(), kb = document.getElementById('sk-global-keyboard').getBoundingClientRect();
      const save = document.getElementById('dsEditSave'), cancel = document.getElementById('dsEditCancel');
      const sb = save.getBoundingClientRect(), mid = document.elementFromPoint(sb.x + sb.width / 2, sb.y + sb.height / 2);
      const inputs = ['dsEditEn', 'dsEditFil'].map((id) => document.getElementById(id)).filter(vis).map((e) => ({ id: e.id, ...r(e) }));
      return { kbActive: document.body.classList.contains('keyboard-active'), card: r(card), kbTop: Math.round(kb.top), panel: r(panel),
        panelScrolls: panel.scrollHeight > panel.clientHeight, cardScrolls: card.scrollHeight > card.clientHeight,
        inputs, save: r(save), cancel: r(cancel), saveReachable: mid === save, header: r(document.querySelector('#datasetModal .tr-modal-header')),
        cardBottomVsKb: Math.round((kb.top - cb.bottom) * 10) / 10, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
    })()`);
    await pickSet('BOTH');
    for (const id of ['dsEditEn', 'dsEditFil']) {
      const k = await kbMeasure(id);
      console.log(`  Both, focus ${id}:`, JSON.stringify(k));
      check(`keyboard open (${id}): card y=${k.card.y} h=${k.card.h} ends above keyboard (${k.kbTop})`, k.kbActive && k.card.bottom <= k.kbTop && k.card.y >= 0, `bottom ${k.card.bottom} vs kb ${k.kbTop}`);
      check(`keyboard open (${id}): nothing clipped or scrolled in panel/card`, !k.panelScrolls && !k.cardScrolls && k.panel.bottom <= k.card.bottom && k.save.bottom <= k.card.bottom, `panel ${k.panel.h}, scrollsP ${k.panelScrolls}, scrollsC ${k.cardScrolls}`);
      check(`keyboard open (${id}): inputs and buttons 48 px; Save reachable`, k.inputs.length === 2 && k.inputs.every((i) => i.h === 48) && k.save.h === 48 && k.cancel.h === 48 && k.saveReachable, JSON.stringify([k.inputs.map((i) => i.h), k.save.h, k.cancel.h, k.saveReachable]));
      check(`keyboard open (${id}): no page scroll`, k.sw === 1024 && k.sh === 600, `${k.sw}x${k.sh}`);
    }
    // hide keyboard again
    await ev(`document.activeElement && document.activeElement.blur(); document.querySelectorAll('.sk-key.ctrl').forEach((b) => { if (b.textContent === 'Hide') b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }); true`);
    await sleep(300);
    const noKbPanel = await ev(`(() => { ${R} return { card: r(document.querySelector('#datasetModal .tr-modal-card')), panel: r(document.getElementById('datasetEditPanel')), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }; })()`);
    console.log('  Both, no keyboard:', JSON.stringify(noKbPanel));
    check('edit panel without keyboard: no page scroll', noKbPanel.sw === 1024 && noKbPanel.sh === 600);

    console.log('--- save ESL -> Both ---');
    // Compact-model phase: the edit no longer clears a localStorage model cache; reloadDataset()
    // refreshes the model status instead. Membership changes show as out of date per language.
    const stBefore = await ev(`({ ms: window.__ms, esl: modelStatus && modelStatus.models.ESL.stale, fsl: modelStatus && modelStatus.models.FSL.stale })`);
    await setText('dsEditFil', 'Zz Pagsubok?');
    await save();
    check('Save -> toast "Saved." and back to table', await waitSaved(), JSON.stringify(await toasts()));
    rs = await rows();
    check('row shows both texts and "Both"; same tab/search kept', rs.length === 1 && rs[0][0] === 'Zz Edit Probe' && rs[0][1] === 'Zz Pagsubok?' && rs[0][2] === 'Both', JSON.stringify(rs));
    const st1 = await ev(`({ ms: window.__ms, esl: modelStatus.models.ESL.stale, fsl: modelStatus.models.FSL.stale, fslWhy: modelStatus.models.FSL.staleReason })`);
    check('ESL->Both: model status refreshed; FSL now out of date (membership changed), ESL still out of date (the probe is in it)', st1.ms > stBefore.ms && stBefore.fsl === false && stBefore.esl === true && st1.fsl === true && st1.fslWhy === 'data' && st1.esl === true, JSON.stringify({ stBefore, st1 }));
    let sg = await get('signs.php');
    const sign1 = (sg.signs && (Array.isArray(sg.signs) ? sg.signs.find((s) => s.key === KEY || s.label === KEY) : sg.signs[KEY])) || null;
    check('signs.php GET: Both, both texts', sign1 && sign1.set === 'BOTH' && sign1.textEn === 'Zz Edit Probe' && sign1.textFil === 'Zz Pagsubok?', JSON.stringify(sign1));
    check('sample file bytes unchanged', sampleHashes() === hashBefore);
    check('sign.json on disk says BOTH', JSON.parse(fs.readFileSync(path.join(probeDir, 'sign.json'), 'utf8')).set === 'BOTH');

    console.log('--- reload page: still Both; full-sync GET ---');
    await chrome.navigate(PAGE_URL);
    await waitFor(`!!(window.GestureDataRecorder && typeof showStepContent === 'function')`, 150);
    await sleep(500);
    await ev(`showStepContent(1); true`);
    await waitFor(`!!GestureDataRecorder.getSigns().${KEY} && document.getElementById('datasetCount').textContent !== '0 gestures'`, 600);
    await sleep(400);
    await ev(`window.__toasts = []; (() => { const o = window.showToast; window.showToast = function (m) { window.__toasts.push(String(m)); return o.apply(this, arguments); }; })(); window.__reloaded = 0; (() => { const o = window.reloadDataset; window.reloadDataset = async function () { const r = await o.apply(this, arguments); window.__reloaded++; return r; }; })(); window.__ms = 0; (() => { const f = window.fetch; window.fetch = function (u) { if (String(u).includes('model_status.php')) window.__ms++; return f.apply(this, arguments); }; })(); true`);
    reloadsSeen = 0;
    await openModal(); await search('zz edit');
    rs = await rows();
    check('after page reload the row is still Both with both texts', rs.length === 1 && rs[0][2] === 'Both' && rs[0][1] === 'Zz Pagsubok?', JSON.stringify(rs));
    await get('save_gesture.php');   // full disk->DB sync
    sg = await get('signs.php');
    const sign2 = Array.isArray(sg.signs) ? sg.signs.find((s) => s.key === KEY || s.label === KEY) : sg.signs[KEY];
    check('after a full-sync save_gesture.php GET it is still Both', sign2 && sign2.set === 'BOTH' && sign2.textFil === 'Zz Pagsubok?', JSON.stringify(sign2));

    console.log('--- Both -> ESL keeps hidden text stored ---');
    await editFromRow();
    check('Both prefilled with stored texts', (await ev(`document.getElementById('dsEditFil').value`)) === 'Zz Pagsubok?' && (await ev(`document.getElementById('dsEditEn').value`)) === 'Zz Edit Probe');
    const ms2 = await ev(`window.__ms`);
    await pickSet('ESL');
    check('set ESL hides the Filipino field', !(await ev(`document.getElementById('dsEditFilGroup').offsetParent !== null`)));
    await save();
    check('Save -> "Saved."', await waitSaved(), JSON.stringify(await toasts()));
    rs = await rows();
    check('row shows "—" for Filipino and "ESL"', rs.length === 1 && rs[0][1] === '—' && rs[0][2] === 'ESL', JSON.stringify(rs));
    sg = await get('signs.php');
    const sign3 = Array.isArray(sg.signs) ? sg.signs.find((s) => s.key === KEY || s.label === KEY) : sg.signs[KEY];
    check('signs.php GET: ESL but textFil still stored', sign3 && sign3.set === 'ESL' && sign3.textFil === 'Zz Pagsubok?', JSON.stringify(sign3));
    const st2 = await ev(`({ ms: window.__ms, esl: modelStatus.models.ESL.stale, fsl: modelStatus.models.FSL.stale })`);
    check('Both->ESL: model status refreshed; FSL up to date again (probe left the FSL model), ESL out of date', st2.ms > ms2 && st2.fsl === false && st2.esl === true, JSON.stringify(st2));
    // text-only edit: status refreshed, nothing changes (texts are not in the fingerprint)
    const ms3 = await ev(`window.__ms`);
    await editFromRow();
    await setText('dsEditEn', 'Zz Edit Probe');
    await save(); check('text-only Save -> "Saved."', await waitSaved());
    const st3 = await ev(`({ ms: window.__ms, esl: modelStatus.models.ESL.stale, fsl: modelStatus.models.FSL.stale })`);
    check('text-only edit: model status refreshed, FSL still up to date, ESL still out of date', st3.ms > ms3 && st3.fsl === false && st3.esl === true, JSON.stringify(st3));

    console.log('--- HTML injection ---');
    await editFromRow();
    await pickSet('BOTH');
    await setText('dsEditFil', '<b>x</b>');
    await save(); check('Save -> "Saved." (injection text)', await waitSaved());
    const inj = await ev(`(() => { const tr = document.querySelector('#datasetModalBody tr[data-key="${KEY}"]'); return { text: tr.cells[1].textContent, hasB: !!tr.querySelector('b'), html: tr.cells[1].innerHTML }; })()`);
    check('<b>x</b> renders literally (no element)', inj.text === '<b>x</b>' && !inj.hasB, JSON.stringify(inj));
    // delete confirm text for a BOTH sign
    const confirmText = await ev(`(async () => { let msg = ''; const oc = window.confirm; window.confirm = (m) => { msg = m; return false; }; await deleteGesture('${KEY}'); window.confirm = oc; return msg; })()`);
    check('delete confirm uses display text + " (ESL and FSL)" for Both', confirmText.includes('"Zz Edit Probe" (ESL and FSL)'), confirmText);

    console.log('--- cleanup: delete probe via the modal Delete path ---');
    await ev(`window.confirm = () => true; true`);
    await ev(`document.querySelector('#datasetModalBody tr[data-key="${KEY}"] .tr-ds-del').click(); true`);
    rs = await waitRows((r) => r.length === 1 && r[0][0] === 'No matches', 400);   // delete re-fetches with the full disk sync (~12 s)
    check('probe row gone from the table', rs.length === 1 && rs[0][0] === 'No matches', JSON.stringify(rs));
    sg = await get('signs.php');
    const gone = Array.isArray(sg.signs) ? !sg.signs.some((s) => s.key === KEY || s.label === KEY) : !(KEY in sg.signs);
    deleted = gone && !fs.existsSync(probeDir);
    check('probe deleted (signs.php and disk)', deleted);

    const errs = chrome.getConsoleErrors();
    const exc = chrome.getExceptions();
    check('0 console errors / uncaught exceptions', errs.length === 0 && exc.length === 0, JSON.stringify({ errs: errs.slice(0, 3), exc: exc.slice(0, 2) }));
  } finally {
    await chrome.close();
    if (!deleted) { await post('save_gesture.php', { action: 'delete_gesture', label: KEY }); }
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
