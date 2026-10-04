// Browser check for Task 6 of the sign-texts phase: talk.html (?devqueue) at exactly 1024x600
// (headless Chrome via CDP, tests/video-capture/cdp.mjs). Checks that the loading queue finishes
// with 0 console errors, that sign texts are loaded and used by translateGestureLabel, that the
// FSL / ESL k-NN models are built from FSL+BOTH / ESL+BOTH signs, and that text-to-sign resolves
// "how are you" (EN) and "kamusta ka" (FIL) to a playable asset. No camera is simulated here.
//
// Run (Apache + MariaDB up): node tests/sign-texts/talk-check.mjs
import { launchChrome } from '../video-capture/cdp.mjs';

const BASE = 'http://localhost/SKR/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`); }
}

async function main() {
  const chrome = await launchChrome({ port: 9346 });
  try {
    const ev = (expr) => chrome.evaluate(expr);
    await chrome.navigate(BASE + 'talk.html?devqueue');
    let settled = false;
    const t0 = Date.now();
    for (let i = 0; i < 600 && !settled; i++) {
      settled = await ev(`!!(window.TalkLoader && TalkLoader.isSettled())`).catch(() => false);
      if (!settled) await sleep(200);
    }
    check('loading queue settled', settled, `${Date.now() - t0} ms`);
    const items = await ev(`TalkLoader.getItems()`);
    console.log('  queue: ' + items.map((s) => `${s.id}=${s.status}${s.ms !== null ? '(' + s.ms + 'ms)' : ''}`).join(', '));
    check('every queue item done', items.every((s) => s.status === 'done'), JSON.stringify(items.filter((s) => s.status !== 'done')));
    check('queue still has 5 items (gestures stays one item)', items.length === 5, String(items.length));
    check('devqueue overlay present', await ev(`!!document.getElementById('dev-queue-overlay')`));
    const vp = await ev(`[innerWidth, innerHeight]`);
    check('viewport 1024x600', vp[0] === 1024 && vp[1] === 600, vp.join('x'));

    console.log('--- sign texts ---');
    const t = await ev(`({ en: GestureDataRecorder.getSignText('how_are_you', 'en'), fil: GestureDataRecorder.getSignText('how_are_you', 'fil'),
      tEn: translateGestureLabel('how_are_you', 'en'), tFil: translateGestureLabel('how_are_you', 'fil'),
      signs: Object.keys(GestureDataRecorder.getSigns()).length })`);
    console.log('  ' + JSON.stringify(t));
    check("getSignText('how_are_you','en') === 'How are you'", t.en === 'How are you', t.en);
    check("getSignText('how_are_you','fil') === 'Kamusta ka'", t.fil === 'Kamusta ka', t.fil);
    check("translateGestureLabel en/fil give the same", t.tEn === 'How are you' && t.tFil === 'Kamusta ka', `${t.tEn} / ${t.tFil}`);

    console.log('--- k-NN models ---');
    const loadModel = (lang) => ev(`(async () => {
      signLang = ${JSON.stringify(lang)}; modelTrained = false; knnModel = null; savedGestureSamplesMerged = false; lastLoadedLanguage = null;
      const ok = await autoTrainForTranslate();
      return { ok, labels: Object.keys(knnModel || {}), modelTrained };
    })()`);
    const esl = await loadModel('en');
    console.log(`  ESL model: ok=${esl.ok}, ${esl.labels.length} labels`);
    check('ESL model loads', esl.ok && esl.labels.length > 2);
    check("ESL model has 'how_are_you' (BOTH)", esl.labels.includes('how_are_you'));
    check("ESL model has 'a' (ESL-only)", esl.labels.includes('a'));
    const fsl = await loadModel('fil');
    console.log(`  FSL model: ok=${fsl.ok}, ${fsl.labels.length} labels`);
    check('FSL model loads', fsl.ok && fsl.labels.length > 2);
    check("FSL model has 'how_are_you' (BOTH)", fsl.labels.includes('how_are_you'));
    check("FSL model has no old Tagalog key 'kamusta_ka'", !fsl.labels.includes('kamusta_ka'));
    const signs = await ev(`(() => { const s = GestureDataRecorder.getSigns(); return Object.fromEntries(Object.keys(s).map((k) => [k, s[k].set])); })()`);
    const eslOnly = Object.keys(signs).filter((k) => signs[k] === 'ESL');
    check('no ESL-only sign is in the FSL model', eslOnly.every((k) => !fsl.labels.includes(k) || k === 'start' || k === 'stop'), eslOnly.filter((k) => fsl.labels.includes(k)).join(','));
    await loadModel('en'); // leave the page on ESL, as on a fresh load

    console.log('--- text-to-sign ---');
    await ev(`SignPlayer.registerCustomGestures()`);
    // Play the text through a real SignPlayer on an offscreen container and record the shown media.
    const play = (lang, text) => ev(`(async () => {
      const c = document.createElement('div'); c.style.cssText = 'position:fixed;left:-9999px;width:200px;height:200px'; document.body.appendChild(c);
      const lbl = document.createElement('span'); document.body.appendChild(lbl);
      const p = SignPlayer.create({ container: c, wordLabel: lbl, getLanguage: () => ${JSON.stringify(lang)} });
      const seen = [];
      const mo = new MutationObserver(() => { c.querySelectorAll('video').forEach((v) => { const s = v.getAttribute('src'); if (s && !seen.includes(s)) seen.push(s); }); });
      mo.observe(c, { childList: true, subtree: true });
      await Promise.race([p.play(${JSON.stringify(text)}), new Promise((r) => setTimeout(r, 15000))]);
      mo.disconnect(); p.cancel(); c.remove(); lbl.remove();
      return seen;
    })()`);
    for (const [lang, text, expect] of [['en-US', 'how are you', 'assets/signs/en/how_are_you.webm'], ['fil-PH', 'kamusta ka', null]]) {
      const seen = await play(lang, text);
      console.log(`  ${lang} "${text}" -> ${JSON.stringify(seen)}`);
      check(`${lang} "${text}" plays exactly one clip (no fingerspelling)`, seen.length === 1, `${seen.length}`);
      if (seen[0]) {
        if (expect) check('asset path as expected', seen[0] === expect, seen[0]);
        const res = await fetch(BASE + seen[0], { method: 'HEAD' });
        check(`asset ${seen[0]} returns 200`, res.status === 200, String(res.status));
      }
    }

    console.log('--- console ---');
    const errs = chrome.getConsoleErrors();
    check('0 console errors', errs.length === 0, errs.map((e) => e.text.slice(0, 120)).join(' | '));
    check('0 uncaught exceptions', chrome.getExceptions().length === 0, chrome.getExceptions().join(' | ').slice(0, 200));
  } finally {
    await chrome.close();
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
