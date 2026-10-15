// Browser check for Task 4 of the sign-texts phase: gesture-training.html Step 1 form (Sign Set
// ESL | FSL | Both, English / Filipino text, derived key), Step 2 "AI model" toggle and the
// Predict text lookup, at exactly 1024x600 (headless Chrome via CDP, tests/video-capture/cdp.mjs).
// Read-only: it never records or saves anything, so it never touches real signs.
//
// Run (Apache + MariaDB up): node tests/sign-texts/step1-check.mjs
import { launchChrome } from '../video-capture/cdp.mjs';

const PAGE_URL = 'http://localhost/SKR/gesture-training.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`); }
}

const MEASURE = `(() => {
  const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, bottom: Math.round(b.bottom * 10) / 10 }; };
  const groups = Array.from(document.querySelectorAll('#gestureDatasetCard > .tr-fgrp')).filter(vis)
    .map((g) => ({ name: (g.querySelector('.tr-flbl') || {}).textContent, ...r(g) }));
  const inputs = ['signTextEn', 'signTextFil'].map((id) => document.getElementById(id)).filter(vis).map((e) => ({ id: e.id, ...r(e) }));
  const controls = Array.from(document.querySelectorAll('#leftStep1 input.tr-input, #leftStep1 label.tr-sign-opt, #leftStep1 button')).filter(vis)
    .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 24), ...r(e) }));
  const back = r(document.querySelector('#leftStep1 .tr-back-to-instr'));
  return { groups, inputs, controlsUnder44: controls.filter((c) => c.h < 44).map((c) => c.id + ':' + c.h),
    nControls: controls.length, back, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    sectionLabelGone: !Array.from(document.querySelectorAll('#leftStep1 .tr-section-lbl')).some((e) => /Gesture Sample Capture/.test(e.textContent)),
    oldInputGone: !document.getElementById('gestureLabelInput') };
})()`;

async function main() {
  const chrome = await launchChrome({ port: 9341 });
  try {
    const ev = (expr) => chrome.evaluate(expr);
    const setSet = (v) => ev(`(() => { const r = document.querySelector('input[name="gestureDatasetType"][value="${v}"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const setText = (id, v) => ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const line = () => ev(`document.getElementById('sampleCountLine').textContent`);
    const recDisabled = () => ev(`document.getElementById('startGestureDataBtn').disabled`);
    const toastAfterRecord = async () => {
      await ev(`(() => { window.__toasts = []; const o = window.showToast; window.showToast = function (m) { window.__toasts.push(String(m)); return o.apply(this, arguments); }; return true; })()`);
      await ev(`document.getElementById('startGestureDataBtn').click(); true`);
      await sleep(150);
      return { toasts: await ev(`window.__toasts.slice()`), mode: await ev(`document.getElementById('gcMode').getAttribute('data-state')`) };
    };

    await chrome.navigate(PAGE_URL);
    for (let i = 0; i < 100; i++) {
      if (await ev(`!!(window.GestureDataRecorder && typeof trPressPin === 'function')`)) break;
      await sleep(150);
    }
    for (const d of '2026') { await ev(`trPressPin('${d}'); true`); await sleep(60); }
    await sleep(500);
    await ev(`showStepContent(1); true`);
    // wait for the startup dataset load (signs state)
    for (let i = 0; i < 600; i++) {
      if (await ev(`Object.keys(GestureDataRecorder.getSigns()).length > 0 && document.getElementById('datasetCount').textContent !== '0 gestures'`)) break;
      await sleep(150);
    }
    await sleep(500);

    console.log('--- layout at 1024x600 ---');
    const meas = {};
    for (const set of ['ESL', 'FSL', 'BOTH']) {
      await setSet(set);
      await sleep(150);
      const m = (meas[set] = await ev(MEASURE));
      console.log(`  ${set}: groups ${JSON.stringify(m.groups.map((g) => [g.name, g.y, g.h]))} inputs ${JSON.stringify(m.inputs.map((i) => [i.id, i.y, i.h, i.bottom]))} back.y ${m.back.y} scroll ${m.scrollWidth}x${m.scrollHeight} controls ${m.nControls}`);
      const names = m.groups.map((g) => g.name);
      const expectNames = set === 'ESL' ? ['Sign Set', 'English text', 'Type'] : set === 'FSL' ? ['Sign Set', 'Filipino text', 'Type'] : ['Sign Set', 'English text', 'Filipino text', 'Type'];
      check(`${set}: shown groups ${expectNames.join(' / ')}`, JSON.stringify(names) === JSON.stringify(expectNames), JSON.stringify(names));
      const ys = m.groups.map((g) => g.y);
      const expectY = set === 'BOTH' ? [68, 151, 234, 317] : [68, 151, 234];
      check(`${set}: group y positions ${expectY.join(', ')}`, JSON.stringify(ys) === JSON.stringify(expectY), JSON.stringify(ys));
      check(`${set}: group heights 69`, m.groups.every((g) => g.h === 69), JSON.stringify(m.groups.map((g) => g.h)));
      check(`${set}: lowest text input ends at y <= 320`, Math.max(...m.inputs.map((i) => i.bottom)) <= 320, JSON.stringify(m.inputs.map((i) => i.bottom)));
      check(`${set}: text inputs 48 px tall`, m.inputs.every((i) => i.h === 48), JSON.stringify(m.inputs.map((i) => i.h)));
      check(`${set}: no page scroll (1024 x 600)`, m.scrollWidth === 1024 && m.scrollHeight === 600, `${m.scrollWidth}x${m.scrollHeight}`);
      check(`${set}: every control >= 44 px tall`, m.controlsUnder44.length === 0, `${m.nControls} controls; under 44: ${JSON.stringify(m.controlsUnder44)}`);
      check(`${set}: section label and #gestureLabelInput removed`, m.sectionLabelGone && m.oldInputGone);
    }
    check('Back to Instructions still starts below the form (y > 317+69)', meas.BOTH.back.y >= 386, `y ${meas.BOTH.back.y}`);

    console.log('--- required fields ---');
    await setSet('ESL'); await setText('signTextEn', ''); await setText('signTextFil', '');
    let t = await toastAfterRecord();
    check('ESL empty -> "Enter the English text first." and no recording mode', t.toasts.includes('Enter the English text first.') && t.mode === 'closed', JSON.stringify(t));
    await setSet('FSL');
    t = await toastAfterRecord();
    check('FSL empty -> "Enter the Filipino text first." and no recording mode', t.toasts.includes('Enter the Filipino text first.') && t.mode === 'closed', JSON.stringify(t));
    await setSet('BOTH');
    t = await toastAfterRecord();
    check('BOTH empty -> English first', t.toasts.includes('Enter the English text first.') && t.mode === 'closed', JSON.stringify(t));
    await setText('signTextEn', 'Zz test');
    t = await toastAfterRecord();
    check('BOTH English only -> "Enter the Filipino text first."', t.toasts.includes('Enter the Filipino text first.') && t.mode === 'closed', JSON.stringify(t));

    console.log('--- key and existing-sign lines ---');
    const signs = await ev(`JSON.parse(JSON.stringify(GestureDataRecorder.getSigns()))`);
    const esl = Object.entries(signs).find(([, s]) => s.set === 'ESL');
    const both = signs.hello;
    await setText('signTextEn', ''); await setText('signTextFil', '');
    await setSet('ESL');
    await setText('signTextEn', 'Hello');
    let l = await line();
    check('ESL "Hello" (existing BOTH sign) -> already exists as Both, Record disabled',
      /^“hello” already exists as Both — change it in View Active Gesture Dataset first\.$/.test(l) && (await recDisabled()) === true, JSON.stringify(l));
    await setSet('BOTH');
    await setText('signTextFil', 'Kumusta');
    l = await line();
    check('BOTH "Hello"+"Kumusta" -> same set: sample line, Record enabled', /^“hello” — \d+ samples? saved/.test(l) && (await recDisabled()) === false, JSON.stringify(l));
    if (esl) {
      await setText('signTextEn', esl[1].textEn); await setText('signTextFil', 'Pang-test');
      l = await line();
      check(`BOTH "${esl[1].textEn}" (existing ESL sign) -> already exists as ESL, Record disabled`,
        l === `“${esl[0]}” already exists as ESL — change it in View Active Gesture Dataset first.` && (await recDisabled()) === true, JSON.stringify(l));
      await setSet('ESL');
      l = await line();
      check('switching the set to ESL clears the conflict and re-enables Record', (await recDisabled()) === false && /^“/.test(l) && !/already exists/.test(l), JSON.stringify(l));
    } else console.log('  (no ESL sign in live data; skipped ESL conflict case)');
    await setSet('ESL'); await setText('signTextEn', 'How are you?');
    check('ESL key keeps no punctuation: "How are you?" -> how_are_you', /^“how_are_you”/.test(await line()), JSON.stringify(await line()));
    await setSet('FSL'); await setText('signTextFil', 'Kumusta ka?');
    check('FSL key comes from the Filipino text', /^“kumusta_ka”/.test(await line()), JSON.stringify(await line()));
    // category: a stored category wins; BOTH how_are_you is "phrase"
    await setSet('BOTH'); await setText('signTextEn', 'How are you');
    const cat = await ev(`document.querySelector('input[name="gestureCategory"]:checked').value`);
    check('stored category auto-selected for an existing sign (how_are_you = phrase)', cat === 'phrase', cat);
    // manual Type tap survives until key or set changes
    await ev(`document.querySelector('input[name="gestureCategory"][value="letter"]').click(); true`);
    await sleep(80);
    check('manual Type tap kept', (await ev(`document.querySelector('input[name="gestureCategory"]:checked').value`)) === 'letter');
    await setText('signTextFil', 'Kamusta ka');
    check('...until a text changes (auto-select again)', (await ev(`document.querySelector('input[name="gestureCategory"]:checked').value`)) === 'phrase');

    console.log('--- Step 2 model toggle ---');
    await setSet('FSL');
    await ev(`showStepInstruction(2); showStepContent(2); true`);
    await sleep(200);
    let s2 = await ev(`({ lang: modelLanguage(), checked: document.querySelector('input[name="trainModelLang"]:checked').value, h: document.querySelector('#trainModelGroup .tr-sign-opt').getBoundingClientRect().height, y: Math.round(document.getElementById('trainModelGroup').getBoundingClientRect().y), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight })`);
    check('Step 1 FSL -> Step 2 toggle defaults to FSL', s2.lang === 'FSL' && s2.checked === 'FSL', JSON.stringify(s2));
    check('Step 2 toggle is 48 px tall; no page scroll', s2.h === 48 && s2.sw === 1024 && s2.sh === 600, JSON.stringify(s2));
    await ev(`showStepInstruction(1); showStepContent(1); true`);
    await setSet('BOTH');
    await ev(`showStepInstruction(2); showStepContent(2); true`);
    await sleep(150);
    s2 = await ev(`({ lang: modelLanguage() })`);
    check('Step 1 Both -> Step 2 toggle defaults to ESL', s2.lang === 'ESL', JSON.stringify(s2));
    await ev(`document.querySelector('input[name="trainModelLang"][value="FSL"]').click(); true`);
    // compact-model phase: the toggle loads models/knn_FSL.bin (KnnModelStore); it used to leave
    // the page untrained until Train was pressed.
    let sw = null;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      sw = await ev(`({ lang: modelLanguage(), trained: modelTrained, next: document.getElementById('step2NextBtn').style.display, status: (document.getElementById('modelStatusLine') || {}).textContent || '' })`);
      if (sw.trained && /^FSL model:|^Model out of date: run Compile$/.test(sw.status)) break;
    }
    check('switching to FSL loads the FSL model file -> trained; status names FSL (or says out of date when the file is stale)', sw.lang === 'FSL' && sw.trained === true && /^FSL model:|^Model out of date: run Compile$/.test(sw.status), JSON.stringify(sw));

    console.log('--- text lookup ---');
    const tx = await ev(`({
      enHello: translateGestureLabel('hello', 'en'), filHello: translateGestureLabel('hello', 'fil'),
      enHow: translateGestureLabel('how_are_you', 'en'), filHow: translateGestureLabel('how_are_you', 'fil'),
      fallback: translateGestureLabel('start', 'en'), unknown: translateGestureLabel('zz_not_a_sign', 'en'),
      predFil: predictDisplayText('how_are_you'),
    })`);
    check('translateGestureLabel uses the sign texts (exact casing)', tx.enHello === 'Hello' && tx.filHello === 'Kamusta' && tx.enHow === 'How are you' && tx.filHow === 'Kamusta ka', JSON.stringify(tx));
    check('start/stop and unknown labels keep the old fallback', tx.fallback === 'Start' && tx.unknown === 'Zz Not A Sign', JSON.stringify(tx));
    check('Predict text follows the AI model toggle (FSL -> Filipino)', tx.predFil === 'Kamusta ka', tx.predFil);
    await ev(`document.querySelector('input[name="trainModelLang"][value="ESL"]').click(); true`);
    check('...and ESL -> English', (await ev(`predictDisplayText('how_are_you')`)) === 'How are you');

    console.log('--- dataset modal Sign Set column ---');
    await ev(`showStepInstruction(1); showStepContent(1); trOpenDatasetModal(); true`);
    await sleep(300);
    const col = await ev(`Array.from(document.querySelectorAll('#datasetModalBody tr')).slice(1, 40).map((tr) => tr.children[2] && tr.children[2].textContent)`);
    check('modal Sign Set column shows ESL/FSL/Both', col.length > 0 && col.every((c) => ['ESL', 'FSL', 'Both'].includes(c)) && col.includes('Both'), JSON.stringify([...new Set(col)]));

    const errs = chrome.getConsoleErrors();
    const exc = chrome.getExceptions();
    check('0 console errors / uncaught exceptions', errs.length === 0 && exc.length === 0, JSON.stringify({ errs: errs.slice(0, 3), exc: exc.slice(0, 2) }));
  } finally {
    await chrome.close();
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
