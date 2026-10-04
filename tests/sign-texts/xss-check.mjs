// Browser check: a sign text containing markup renders literally (no element, no script run) through
// the Step 4 output paths of gesture-training.html. No sign is saved; getSignText is faked in-page.
// Run (Apache up): node tests/sign-texts/xss-check.mjs
import { launchChrome } from '../video-capture/cdp.mjs';
const PAYLOAD = '<img src=x onerror=window.__xss=1>';
let failures = 0;
const check = (l, c, d) => { if (!c) failures++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? ' - ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const chrome = await launchChrome({ port: 9347 });
  try {
    const ev = (e) => chrome.evaluate(e);
    await chrome.navigate('http://localhost/SKR/gesture-training.html');
    for (let i = 0; i < 100; i++) { if (await ev(`typeof renderTranslation === 'function' && !!window.GestureDataRecorder`)) break; await sleep(150); }
    await ev(`window.__xss = 0; GestureDataRecorder.getSignText = () => ${JSON.stringify(PAYLOAD)}; true`);
    await ev(`translatedWords = [{type:'custom', label:'zz_probe'}]; renderTranslation(); true`);
    await sleep(200);
    const r = await ev(`({ hist: document.getElementById('tlHistory').textContent, big: document.getElementById('tlBigOutput').textContent,
      imgs: document.querySelectorAll('#tlHistory img, #tlBigOutput img').length, xss: window.__xss })`);
    check('renderTranslation shows the payload literally', r.hist.includes(PAYLOAD) && r.big.includes(PAYLOAD), JSON.stringify(r));
    check('no <img> element created, window.__xss unset', r.imgs === 0 && !r.xss);
    await ev(`customWords = [${JSON.stringify(PAYLOAD)}]; renderWordChips(); true`);
    await sleep(200);
    const c = await ev(`({ imgs: document.querySelectorAll('#wordChips img').length, txt: document.getElementById('wordChips').textContent, xss: window.__xss })`);
    check('word chip shows payload literally, no element', c.imgs === 0 && c.txt.includes(PAYLOAD) && !c.xss, JSON.stringify(c));
    // The sentence path (prediction loop): same template strings via escapeHtml.
    const s = await ev(`(() => { const h = document.getElementById('tlHistory'); const w = [${JSON.stringify(PAYLOAD)}];
      h.innerHTML = w.map(x => '<span class="tl-word">' + escapeHtml(x) + '</span>').join(' ');
      h.innerHTML = '<span class="tl-word">' + escapeHtml(formulateSmartSentence(w, 'en')) + '</span>';
      return { imgs: h.querySelectorAll('img').length, txt: h.textContent.includes(${JSON.stringify(PAYLOAD)}), xss: window.__xss }; })()`);
    check('formulateSmartSentence output escaped', s.imgs === 0 && s.txt && !s.xss, JSON.stringify(s));
    const errs = chrome.getConsoleErrors(), exc = chrome.getExceptions();
    check('0 console errors / exceptions', errs.length === 0 && exc.length === 0, JSON.stringify({ errs: errs.slice(0, 3), exc: exc.slice(0, 2) }));
  } finally { await chrome.close(); }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
