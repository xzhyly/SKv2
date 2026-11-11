// touch-ux (2026-11-12): Let's Talk's conversation on the 7" touchscreen, and no text selection on the kiosk
// pages. Playwright Chromium at 1024x600:
//   thread scrollbar 18 px; after 14 messages the newest bubble is fully visible; it stays at the newest after
//   going to another screen and back and after the list changes size; scrolled up -> "↓ Latest" shows, a new
//   message still goes to the end, tapping "↓ Latest" goes to the end; body user-select none on every kiosk
//   page, text inside fields; the long-press / right-click menu is blocked outside fields; 0 console errors.
// Run (server at SK_BASE, default http://localhost/SKR/): node tests/touch-ux/touch-check.mjs [--shots <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  return createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const { chromium } = await loadPlaywright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  ' + String(detail).slice(0, 500)));
  if (!ok) failed++;
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
const errors = [];
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
const shot = async (n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n) }); } };
const state = () => p.evaluate(() => {
  const l = document.getElementById('thread-list');
  const rows = l.querySelectorAll('.bubble-row');
  const last = rows[rows.length - 1];
  const lr = l.getBoundingClientRect(), br = last ? last.getBoundingClientRect() : null;
  return { top: Math.round(l.scrollTop), max: l.scrollHeight - l.clientHeight, h: l.clientHeight,
    lastVisible: !!br && br.bottom <= lr.bottom + 1 && br.top >= lr.top - 1, latest: !document.getElementById('thread-latest').hidden };
});
const add = (n, from = 'hearing') => p.evaluate(({ n, from }) => {
  for (let i = 0; i < n; i++) addMessage({ from, source: from === 'hearing' ? 'typed' : 'sign', text: 'Message ' + Math.random().toString(36).slice(2, 8) + ' ' + 'word '.repeat(i % 4 * 6) });
}, { n, from });

try {
  await p.goto(BASE + 'talk.html');
  await p.evaluate(() => showScreen('thread'));
  await sleep(300);
  const sb = await p.evaluate(() => { const l = document.getElementById('thread-list'); return l.offsetWidth - l.clientWidth; });
  check('thread scrollbar is 18 px wide (was 6)', sb === 18, sb);

  await add(14);
  await sleep(300);
  let s = await state();
  check('14 messages: at the end, the newest bubble fully visible, no "↓ Latest"', s.max > 0 && s.top >= s.max - 1 && s.lastVisible && !s.latest, J(s));
  await shot('touch-1-thread-end.png');

  // another screen (the thread collapses to a strip) and back
  await p.evaluate(() => showScreen('speaking'));
  await sleep(300);
  await add(1);
  await sleep(200);
  const strip = await state();
  check('on Speak or Type (collapsed strip): a new message is at the end there too', strip.top >= strip.max - 1 && strip.lastVisible, J(strip));
  await p.evaluate(() => showScreen('thread'));
  await sleep(400);
  s = await state();
  check('back to the conversation: still at the newest', s.top >= s.max - 1 && s.lastVisible && !s.latest, J(s));

  // a bubble grows after it was added (size change while following)
  await p.evaluate(() => { const rows = document.querySelectorAll('#thread-list .bubble-text'); rows[rows.length - 1].textContent += ' ' + 'longer '.repeat(60); });
  await sleep(300);
  s = await state();
  check('the newest bubble grows: still at the end', s.top >= s.max - 1 && s.lastVisible, J(s));

  // the user scrolls up to read
  await p.evaluate(() => { const l = document.getElementById('thread-list'); l.scrollTop = 0; });
  await sleep(300);
  s = await state();
  check('scrolled up: "↓ Latest" shows, not yanked down', s.top === 0 && s.latest, J(s));
  const lb = await p.evaluate(() => { const b = document.getElementById('thread-latest').getBoundingClientRect(); return { h: Math.round(b.height), r: Math.round(b.right) }; });
  check('"↓ Latest" >= 44 px tall, clear of the scrollbar', lb.h >= 44 && lb.r <= 1024 - 18, J(lb));
  await shot('touch-2-latest.png');
  await p.click('#thread-latest');
  await sleep(300);
  s = await state();
  check('tap "↓ Latest": at the end, button gone', s.top >= s.max - 1 && s.lastVisible && !s.latest, J(s));
  await p.evaluate(() => { document.getElementById('thread-list').scrollTop = 0; });
  await sleep(200);
  await add(1, 'deaf');
  await sleep(300);
  s = await state();
  check('scrolled up, then a new message is sent: goes to the end', s.top >= s.max - 1 && s.lastVisible && !s.latest, J(s));

  // finger drag scrolls
  check('the list scrolls with a vertical finger drag (touch-action pan-y)', await p.evaluate(() => getComputedStyle(document.getElementById('thread-list')).touchAction === 'pan-y'));

  // no selection, no long-press menu
  const pages = ['index.html', 'talk.html', 'learn-signs.html', 'quiz.html', 'quiz-scores.html', 'login.html', 'conversations.html',
    'settings.html', 'gesture-training.html', 'users.html', 'reports.html'];
  const sel = [];
  for (const pg of pages) {
    await p.goto(BASE + pg);
    await sleep(500);
    sel.push(await p.evaluate((pg) => {
      const field = document.querySelector('input[type="text"], input:not([type]), input[type="password"], textarea');
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      const blocked = !document.body.dispatchEvent(ev);
      return { pg: location.pathname.split('/').pop(), body: getComputedStyle(document.body).userSelect,
        field: field ? getComputedStyle(field).userSelect : null, menuBlocked: blocked };
    }, pg));
  }
  check('every kiosk page: body user-select none, fields text, long-press menu blocked',
    sel.every((x) => x.body === 'none' && (x.field === null || x.field === 'text') && x.menuBlocked), J(sel));
  await p.goto(BASE + 'talk.html');
  await p.evaluate(() => showScreen('speaking'));
  await sleep(300);
  const sp = await p.evaluate(() => {
    const i = document.getElementById('speaking-input');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    return { sel: getComputedStyle(i).userSelect, menuBlocked: !i.dispatchEvent(ev) };
  });
  check('Speak or Type field: text selectable, its menu not blocked (paste / caret still work)', sp.sel === 'text' && !sp.menuBlocked, J(sp));
  await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('.who-first-card') || document.body); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await sleep(100);
  check('a selection started outside a field is dropped', await p.evaluate(() => getSelection().isCollapsed));

  { const real = errors.filter((e) => !/status of 500|Failed to load resource|Unexpected end of JSON input/.test(e));   // quiz-scores / conversations without MySQL
    check('0 console errors (apart from the database pages failing on a machine without MySQL)', real.length === 0, J(real)); }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
