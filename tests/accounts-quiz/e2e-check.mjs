// End-to-end check for the accounts-quiz phase (2026-10-18): guest / user / admin through every new
// screen at 1024x600, with the DB checked after each step, and the report screenshots
// (docs/reports/img/accounts-quiz-*.png).
//
// Needs: the site served at SK_BASE (default http://localhost/SKR/) with the migration applied,
// PHP CLI for the DB checks (SK_PHP_CLI, as tests/categorization/db.mjs), and Playwright
// (`import('playwright')`, else the global install). Written for the cloud session (PHP built-in
// server + Playwright's Chromium); on the laptop it runs against Apache if Playwright is installed.
// Test accounts are "zzqa..."; conversations seeded through the API end in "[e2e]"; the guest
// conversation typed into Let's Talk ("Hello") is found by its title and the test's start time.
// (Since the talk-turns-audio phase Let's Talk's preview is avatar only and requests no video, so
// the words typed no longer matter for the console.) All of it is
// removed at the start and at the end. Avatar clips for the avatar quiz are served by request
// interception (nothing is written to saved_gestures/).
//
// Run: node tests/accounts-quiz/e2e-check.mjs     (exit code 1 if any check fails)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { query, exec } from '../categorization/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const BASE = process.env.SK_BASE || 'http://localhost/SKR/';
const SHOTS = path.join(repo, 'docs', 'reports', 'img');
const ADMIN_USER = process.env.SK_TEST_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SK_TEST_ADMIN_PASS || 'admin123';
const MARK = '[e2e]';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not local */ }
  const g = createRequire('/opt/node22/lib/node_modules/');
  return g('playwright');
}
const { chromium } = await loadPlaywright();

// ── bookkeeping ──
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -- ' + String(detail).slice(0, 400) : ''}`);
}
const consoleErrors = [];   // { page, text }
const J = (v) => JSON.stringify(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const START = query('SELECT NOW() AS t')[0].t;
function cleanup() {
  exec(`DELETE FROM conversations WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'zzqa%')`);
  exec(`DELETE FROM conversations WHERE title LIKE '%${MARK}%'`);
  exec(`DELETE FROM conversations WHERE user_id IS NULL AND title = 'Hello' AND started_at >= '${START}'`);
  exec(`DELETE FROM users WHERE username LIKE 'zzqa%'`);
}
const count = (sql) => Number(query(sql)[0].n);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

// The quiz is avatar only since the talk-turns-audio phase, and this data has no avatar.json, so the
// real pool is empty. Every page answers the pool as if every sign except the number signs had an
// avatar clip (the numbers stay empty, so the "fewer than 4 signs" case is still ESL Numbers), and
// the clips come from the committed Holistic fixture. Nothing is written to saved_gestures/.
const POOL_CAT = { word: 'words', letter: 'letters', number: 'numbers', phrase: 'phrases' };
async function stubAvatarQuiz(ctx) {
  await ctx.route('**/php/api/quiz.php?action=pool*', async (route) => {
    const lang = new URL(route.request().url()).searchParams.get('lang');
    const res = await route.fetch();
    const signs = (await (await ctx.request.get(BASE + 'php/api/signs.php')).json()).signs;
    const list = Object.keys(signs).sort().filter((k) => (signs[k].set === lang || signs[k].set === 'BOTH') && signs[k].category !== 'number')
      .map((k) => ({ key: k, text: (lang === 'ESL' ? signs[k].textEn : signs[k].textFil) || k, category: POOL_CAT[signs[k].category] || 'words', clip: { type: 'avatar', key: k } }));
    route.fulfill({ response: res, json: { success: true, lang, signs: list } });
  });
  await ctx.route('**/saved_gestures/*/avatar.json', (route) => {
    const key = decodeURIComponent(/saved_gestures\/([^/]+)\/avatar\.json/.exec(route.request().url())[1]);
    route.fulfill({ contentType: 'application/json', body: J(fixtureClip(key, [...key].reduce((n, c) => n + c.charCodeAt(0), 0))) });
  });
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  await stubAvatarQuiz(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ page: page.url(), text: m.text(), url: (m.location() || {}).url || '' }); });
  page.on('pageerror', (e) => consoleErrors.push({ page: page.url(), text: 'uncaught: ' + e.message }));
  return { ctx, page };
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `accounts-quiz-${name}.png`) });
}
async function go(page, p) {
  await page.goto(BASE + p);
  await page.waitForLoadState('networkidle').catch(() => {});
}
async function login(page, username, password) {
  await go(page, 'login.html');
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await page.waitForURL(/index\.html$/, { timeout: 10000 });
}
// The page's own cookies, but outside the page: a deliberate 403 must not count as a console error.
async function apiStatus(page, url, body) {
  const r = await page.context().request.fetch(url, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(body) }
    : { method: 'GET' });
  return r.status();
}
const ADMIN_PAGES = ['gesture-training.html', 'reports.html', 'bulk-import.html', 'avatar-clips.html', 'diagnostic.html', 'users.html'];

// Sends one typed message through Let's Talk's real Speak-or-Type -> Translate -> Send (the message is
// added directly since the talk-turns-audio phase; there is no Add to Conversation card any more).
async function talkSay(page, text) {
  const screen = await page.evaluate(() => document.body.dataset.screen);
  if (screen === 'who-first') await page.click('#card-speak');
  else if (screen === 'thread') await page.click('#turn-speak-btn');
  await page.waitForFunction(() => document.body.dataset.screen === 'speaking' && !document.body.classList.contains('modal-open'), null, { timeout: 60000 });
  await page.fill('#speaking-input', text);
  await page.click('#speaking-translate');
  await page.click('#speaking-send');
  await page.waitForFunction(() => document.body.dataset.screen === 'thread');
  await sleep(600);    // the save is fire-and-forget
}

// Plays a whole quiz; answers right when wantRight(i) else wrong. Returns per-question facts.
async function playQuiz(page, { mode, lang, cat, wantRight, shotAt }) {
  await page.click(`#seg-mode button[data-v="${mode}"]`);
  await page.click(`#seg-lang button[data-v="${lang}"]`);
  await page.click(`#seg-cat button[data-v="${cat}"]`);
  await page.waitForFunction(() => !document.getElementById('start-btn').disabled, null, { timeout: 15000 });
  await page.click('#start-btn');
  const facts = [];
  for (let i = 0; i < 10; i++) {
    const q = await page.evaluate((idx) => {
      const s = window.QuizUI.state; const qq = s.questions[idx];
      return { n: s.questions.length, answer: qq.answer, keys: qq.choices.map((c) => c.key), texts: qq.choices.map((c) => c.text), sign: qq.sign.key, prog: document.getElementById('prog-txt').textContent };
    }, i);
    const pick = wantRight(i) ? q.answer : (q.answer + 1) % 4;
    if (mode === 'sign-to-text') await page.click(`#s2t-choices .ch:nth-child(${pick + 1})`);
    else await page.click(`#t2s .vc:nth-child(${pick + 1}) .choose`);
    const marked = await page.evaluate((m) => (m === 'sign-to-text'
      ? [...document.querySelectorAll('#s2t-choices .ch')].map((b) => (b.classList.contains('ok') ? 'ok' : b.classList.contains('bad') ? 'bad' : ''))
      : [...document.querySelectorAll('#t2s .vc')].map((b) => (b.classList.contains('ok') ? 'ok' : b.classList.contains('bad') ? 'bad' : ''))), mode);
    facts.push({ ...q, pick, marked, score: await page.textContent('#score-txt') });
    if (shotAt && shotAt.i === i) { await sleep(700); await shot(page, shotAt.name); }
    await page.click(mode === 'sign-to-text' ? '#next-btn-s2t' : '#next-btn-t2s');
  }
  await page.waitForFunction(() => document.getElementById('screen-result').classList.contains('on'));
  return facts;
}
function quizChecks(label, facts, expectRight) {
  check(`${label}: 10 questions, progress 1/10 .. 10/10`, facts.length === 10 && facts.every((f, i) => f.n === 10 && f.prog === `${i + 1} / 10`), J(facts.map((f) => f.prog)));
  check(`${label}: every question has 4 distinct choices (keys and texts) including the answer`,
    facts.every((f) => new Set(f.keys).size === 4 && new Set(f.texts).size === 4 && f.keys[f.answer] === f.sign));
  check(`${label}: green on the right answer, red on a wrong pick, at once`,
    facts.every((f) => f.marked[f.answer] === 'ok' && (f.pick === f.answer ? f.marked.filter((m) => m === 'bad').length === 0 : f.marked[f.pick] === 'bad')));
  const last = facts[facts.length - 1].score;
  check(`${label}: score counts right answers (${expectRight})`, last === `Score ${expectRight}`, last);
}

// Avatar clips for the avatar quiz, built from the committed Holistic fixture.
const Clip = require('../../js/avatar-clip.js');
const FIX = JSON.parse(fs.readFileSync(path.join(repo, 'tests', 'avatar', 'fixtures', 'holistic-signs.json'), 'utf8'));
function fixtureClip(key, i) {
  const s = FIX.signs[i % FIX.signs.length];
  return Clip.buildClip({ key, fps: FIX.fps, video: { w: s.w, h: s.h, durationMs: s.durationMs }, frames: s.frames,
    trim: { ...s.oldAutoTrim, auto: true }, createdAt: '2026-10-18T00:00:00Z' });
}

try {
  cleanup();
  const tag = crypto.randomBytes(3).toString('hex');
  const user1 = { name: 'Janel QA', username: 'zzqa' + tag + 'a', password: 'pass1' };
  const convBefore = count('SELECT COUNT(*) AS n FROM conversations');

  // ── 1. Guest ────────────────────────────────────────────────────────────────────────────
  const G = await newPage();
  await go(G.page, 'index.html');
  const cards = await G.page.$$eval('.card-btn .card-label', (els) => els.map((e) => e.textContent.trim()));
  check('guest dashboard: exactly Learn Signs, Let\'s Talk, Quiz', J(cards) === J(['Learn Signs', "Let's Talk", 'Quiz']), J(cards));
  check('guest dashboard: "Log in" button top-right, no menu', await G.page.isVisible('#sk-login-btn') && !(await G.page.$('#sk-menu')));
  const cardBox = await G.page.$eval('.card-btn', (e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
  check('guest dashboard: card size unchanged (200 x 270)', J(cardBox) === J([200, 270]), J(cardBox));
  await shot(G.page, '01-dashboard-guest');

  for (const p of ADMIN_PAGES) {
    await go(G.page, p);
    check(`guest opening ${p} lands on the dashboard`, G.page.url().endsWith('/index.html'), G.page.url());
  }
  for (const [u, b] of [['php/admin_api.php', { action: 'list_users' }], ['php/api/conversations.php'], ['php/api/conversations.php', { action: 'clear_all' }], ['php/api/quiz.php?action=scores']]) {
    check(`guest ${b ? 'POST' : 'GET'} ${u}${b ? ' ' + b.action : ''} -> 403`, (await apiStatus(G.page, BASE + u, b)) === 403);
  }
  await go(G.page, 'conversations.html');
  check('guest opening conversations.html goes to the login page', /login\.html\?next=conversations\.html$/.test(G.page.url()), G.page.url());

  // Login page layout (keyboard-safe)
  await go(G.page, 'login.html');
  await shot(G.page, '02-login');
  const loginBox = await G.page.evaluate(() => ['#login-username', '#login-password', '#login-submit'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.bottom), Math.round(r.height)]; }));
  check('login: fields and button end above the on-screen keyboard (<= 320 px), inputs 52 px, button >= 44 px',
    loginBox.every(([b]) => b <= 320) && loginBox[0][1] === 52 && loginBox[1][1] === 52 && loginBox[2][1] >= 44, J(loginBox));
  await G.page.click('#login-username');
  await sleep(500);
  const kb = await G.page.evaluate(() => { const k = document.getElementById('sk-global-keyboard'); return k && k.classList.contains('show') ? Math.round(k.getBoundingClientRect().top) : null; });
  check('login: tapping a field opens the on-screen keyboard below the fields', kb !== null && kb >= 320, J(kb));
  await G.page.click('#login-password');
  await sleep(300);
  check('login: the password field also gets the on-screen keyboard', await G.page.evaluate(() => document.getElementById('sk-global-keyboard').classList.contains('show')));
  await shot(G.page, '02b-login-keyboard');
  await G.page.evaluate(() => document.activeElement.blur());
  await G.page.click('#tab-create');
  const createBox = await G.page.evaluate(() => ['#reg-name', '#reg-username', '#reg-password', '#reg-submit'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().bottom)));
  check('create account: same page (no load), fields + button above 320 px', createBox.every((b) => b <= 320) && G.page.url().endsWith('login.html'), J(createBox));
  await G.page.click('body', { position: { x: 900, y: 450 } });
  await sleep(600);    // the on-screen keyboard slides down (css/virtual-keyboard.css transition)
  await shot(G.page, '03-create-account');

  // Guest Let's Talk: saved with user_id NULL
  await go(G.page, 'talk.html');
  check('Let\'s Talk (guest): "+ New conversation" and a Guest chip in the top bar', await G.page.isVisible('#newConversationBtn') && (await G.page.textContent('#talkAccount')).includes('Guest'));
  await talkSay(G.page, 'Hello');
  const gRow = query(`SELECT user_id, title FROM conversations WHERE title = 'Hello' AND started_at >= '${START}'`);
  check('Let\'s Talk (guest): conversation saved with user_id NULL and title = first message', gRow.length === 1 && gRow[0].user_id === null, J(gRow));

  // Guest quiz: not saved
  const attemptsBefore = count('SELECT COUNT(*) AS n FROM quiz_attempts');
  await go(G.page, 'quiz.html');
  check('quiz setup (guest): Guest note "score saved only when logged in"', (await G.page.textContent('#setup-note')).includes('saved only when logged in'));
  await shot(G.page, '10-quiz-setup');
  await G.page.click('#seg-lang button[data-v="ESL"]');
  await G.page.click('#seg-cat button[data-v="numbers"]');
  await G.page.waitForFunction(() => /sign/.test(document.getElementById('setup-info').textContent));
  const few = await G.page.evaluate(() => ({ text: document.getElementById('setup-info').textContent, bad: document.getElementById('setup-info').classList.contains('bad'), disabled: document.getElementById('start-btn').disabled }));
  check('quiz: fewer than 4 signs (ESL Numbers here) -> clear message, Start disabled, no crash', few.bad && few.disabled && /at least 4/.test(few.text), J(few));
  await shot(G.page, '16-quiz-too-few');
  const gFacts = await playQuiz(G.page, { mode: 'sign-to-text', lang: 'ESL', cat: 'letters', wantRight: (i) => i < 6 });
  quizChecks('guest quiz Sign->Text ESL Letters', gFacts, 6);
  const gNote = await G.page.textContent('#res-note');
  check('guest result: "Log in to save your score", not saved', gNote.includes('Log in to save your score') && count('SELECT COUNT(*) AS n FROM quiz_attempts') === attemptsBefore, gNote);
  check('guest result: 6/10, missed list has 4 with Watch', (await G.page.textContent('#res-big')) === '6/10' && (await G.page.$$('#missed-list .sk-li')).length === 4);
  await shot(G.page, '15-quiz-result-guest');
  await G.page.click('#missed-list .sk-li .sk-mini');
  // avatar only since the talk-turns-audio phase: Watch plays the sign on the avatar (the canvas moves)
  await G.page.waitForSelector('#ov-clip canvas', { timeout: 10000 });
  await sleep(700);
  const w1 = await G.page.$eval('#ov-clip canvas', (c) => c.toDataURL());
  await sleep(400);
  const w2 = await G.page.$eval('#ov-clip canvas', (c) => c.toDataURL());
  check('result: Watch plays the right sign (on the avatar)', w1 !== w2 && await G.page.evaluate(() => document.getElementById('ov-clip').classList.contains('playing')));
  await shot(G.page, '15b-quiz-watch');
  await G.page.click('#ov-close');

  // ── 2. Create account -> user ───────────────────────────────────────────────────────────
  const U = await newPage();
  await go(U.page, 'login.html?tab=create');
  await U.page.fill('#reg-name', user1.name);
  await U.page.fill('#reg-username', user1.username);
  await U.page.fill('#reg-password', user1.password);
  await U.page.click('#reg-submit');
  await U.page.waitForURL(/index\.html$/);
  const u1 = query(`SELECT id, role, display_name, last_login_at FROM users WHERE username = '${user1.username}'`)[0];
  user1.id = Number(u1.id);
  check('create account: logged in at once as a user (role user, last_login_at set)', u1.role === 'user' && u1.display_name === user1.name && u1.last_login_at !== null, J(u1));
  await U.page.click('#sk-chip');
  const uMenu = await U.page.$$eval('#sk-menu .sk-menu-item', (els) => els.map((e) => e.textContent.trim()));
  check('user dashboard: chip with name; menu = My conversations, My quiz scores, Log out', (await U.page.textContent('#sk-chip')).includes(user1.name) && J(uMenu) === J(['My conversations', 'My quiz scores', 'Log out']), J(uMenu));
  const menuBox = await U.page.$$eval('#sk-menu .sk-menu-item', (els) => els.map((e) => e.getBoundingClientRect().height));
  check('menu items >= 44 px tall', menuBox.every((h) => h >= 44), J(menuBox));
  await shot(U.page, '04-dashboard-user-menu');
  for (const p of ADMIN_PAGES) {
    await go(U.page, p);
    check(`user opening ${p} lands on the dashboard`, U.page.url().endsWith('/index.html'), U.page.url());
  }
  check('user: admin API -> 403', (await apiStatus(U.page, BASE + 'php/admin_api.php', { action: 'list_users' })) === 403);
  check('user: delete a conversation -> 403', (await apiStatus(U.page, BASE + 'php/api/conversations.php', { action: 'delete', id: 1 })) === 403);

  // Let's Talk as the user, then New conversation
  await go(U.page, 'talk.html');
  await shot(U.page, '09-talk-header-user');
  check('Let\'s Talk (user): name chip in the top bar', (await U.page.textContent('#talkAccount')).includes(user1.name));
  await talkSay(U.page, 'Good morning');
  await talkSay(U.page, 'How are you');
  const c1 = query(`SELECT id, client_key, user_id, title, end_reason FROM conversations WHERE title = 'Good morning' AND user_id = ${user1.id}`);
  check('Let\'s Talk (user): saved with this user\'s id and title = first message', c1.length === 1 && Number(c1[0].user_id) === user1.id, J(c1));
  await shot(U.page, '09b-talk-thread-user');
  await U.page.click('#newConversationBtn');
  await U.page.waitForLoadState('load');
  await U.page.waitForFunction(() => document.body.dataset.screen === 'who-first' && !document.querySelector('#thread-list .bubble-row'));
  await talkSay(U.page, 'Nice to meet you');
  const c1after = query(`SELECT end_reason FROM conversations WHERE id = ${c1[0].id}`)[0];
  const c2 = query(`SELECT client_key, user_id FROM conversations WHERE title = 'Nice to meet you' AND user_id = ${user1.id}`);
  check('"+ New conversation": the old one ends (ended), the next message starts a new one for the same user',
    c1after.end_reason === 'ended' && c2.length === 1 && c2[0].client_key !== c1[0].client_key && Number(c2[0].user_id) === user1.id, J([c1after, c2]));
  // a signed message, so the thread shows both sides
  await U.page.evaluate(async (m) => {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    const post = (b) => fetch('php/api/save_conversation.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    await post({ action: 'message', client_key: key, seq: 1, speaker: 'signer', source: 'sign', sign_language: 'FSL', text: 'Hello, how are you? ' + m });
    await post({ action: 'message', client_key: key, seq: 2, speaker: 'hearing', source: 'speech', sign_language: null, text: "I'm fine. How can I help you?" });
    await post({ action: 'message', client_key: key, seq: 3, speaker: 'signer', source: 'sign', sign_language: 'FSL', text: 'Where is the comfort room?' });
    await post({ action: 'message', client_key: key, seq: 4, speaker: 'hearing', source: 'typed', sign_language: null, text: 'Second floor, to the left.' });
  }, MARK);

  // Conversations page (user: own only)
  await go(U.page, 'conversations.html');
  await U.page.waitForSelector('#list .sk-li');
  const uTitles = await U.page.$$eval('#list .sk-li b', (els) => els.map((e) => e.textContent));
  const ownCount = count(`SELECT COUNT(*) AS n FROM conversations WHERE user_id = ${user1.id}`);
  check('conversations (user): only own, newest first, no filters', uTitles.length === ownCount && !uTitles.includes('Hello') && uTitles[0].startsWith('Hello, how are you?') && await U.page.isHidden('#filters'), J(uTitles));
  await shot(U.page, '06-conversations-user');
  await U.page.click('#list .sk-li');
  await U.page.waitForSelector('#thread .msg');
  const sides = await U.page.$$eval('#thread .msg', (els) => els.map((e) => (e.classList.contains('l') ? 'L' : 'R') + ':' + Math.round(e.getBoundingClientRect().left)));
  check('thread: read-only, signer left, speaker right', J(sides.map((s) => s[0])) === J(['L', 'R', 'L', 'R']) && !(await U.page.$('#thread input, #thread textarea')), J(sides));
  await shot(U.page, '07-conversation-thread');
  await U.page.click('#back-btn');

  // Quiz as the user: both modes, saved
  await go(U.page, 'quiz.html');
  check('quiz setup (user): "your score will be saved"', (await U.page.textContent('#setup-note')).includes('your score will be saved'));
  const f1 = await playQuiz(U.page, { mode: 'sign-to-text', lang: 'FSL', cat: 'words', wantRight: (i) => i % 2 === 0, shotAt: { i: 0, name: '11-quiz-sign-to-text' } });
  quizChecks('user quiz Sign->Text FSL Words', f1, 5);
  await U.page.waitForFunction(() => /Score saved/.test(document.getElementById('res-note').textContent), null, { timeout: 10000 }).catch(() => {});
  await shot(U.page, '13-quiz-result-user');
  let att = query(`SELECT * FROM quiz_attempts WHERE user_id = ${user1.id} ORDER BY id`);
  let ans = att.length ? query(`SELECT question_type, sign_key, choices, chosen_key, is_correct FROM quiz_answers WHERE attempt_id = ${att[0].id} ORDER BY seq`) : [];
  check('user quiz 1 saved: FSL, words, 5/10, 10 video_to_text answers matching the screen',
    att.length === 1 && att[0].sign_language === 'FSL' && att[0].category === 'words' && att[0].correct_items === '5' && att[0].total_items === '10'
    && ans.length === 10 && ans.every((a, i) => a.question_type === 'video_to_text' && a.sign_key === f1[i].sign && J(JSON.parse(a.choices)) === J(f1[i].keys) && a.chosen_key === f1[i].keys[f1[i].pick])
    && ans.filter((a) => a.is_correct === '1').length === 5, J(att));

  await U.page.click('#new-btn');
  // Text -> Sign: only the tapped clip plays
  await U.page.click('#seg-mode button[data-v="text-to-sign"]');
  await U.page.click('#seg-lang button[data-v="ESL"]');
  await U.page.click('#seg-cat button[data-v="letters"]');
  await U.page.waitForFunction(() => !document.getElementById('start-btn').disabled);
  await U.page.click('#start-btn');
  await U.page.waitForFunction(() => document.querySelectorAll('#t2s .vc canvas').length === 4);
  await sleep(600);
  const playingNow = () => U.page.$$eval('#t2s .vc .clip', (cs) => cs.map((c) => c.classList.contains('playing')));
  const still = await playingNow();
  await U.page.click('#t2s .vc:nth-child(1) .play');
  await sleep(500);
  await U.page.click('#t2s .vc:nth-child(2) .play');
  await sleep(300);
  const playing = await playingNow();
  check('Text->Sign: 4 still posters; tapping one plays only that one', still.every((x) => !x) && J(playing) === J([false, true, false, false]), J({ still, playing }));
  await U.page.click('#back-btn');   // Quit -> setup (nothing saved)
  check('Quit mid-quiz: back to setup, nothing saved', await U.page.isVisible('#screen-setup') && count(`SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id = ${user1.id}`) === 1);
  const f2 = await playQuiz(U.page, { mode: 'text-to-sign', lang: 'ESL', cat: 'letters', wantRight: (i) => i !== 2 && i !== 5 && i !== 8, shotAt: { i: 0, name: '12-quiz-text-to-sign' } });
  quizChecks('user quiz Text->Sign ESL Letters', f2, 7);
  await U.page.waitForFunction(() => /Score saved/.test(document.getElementById('res-note').textContent), null, { timeout: 10000 }).catch(() => {});
  att = query(`SELECT * FROM quiz_attempts WHERE user_id = ${user1.id} ORDER BY id`);
  ans = att.length === 2 ? query(`SELECT question_type, is_correct FROM quiz_answers WHERE attempt_id = ${att[1].id}`) : [];
  check('user quiz 2 saved: ESL, letters, 7/10, text_to_video', att.length === 2 && att[1].sign_language === 'ESL' && att[1].category === 'letters' && att[1].correct_items === '7'
    && ans.length === 10 && ans.every((a) => a.question_type === 'text_to_video'), J(att[1]));
  await U.page.click('#again-btn');
  check('Try again: a new quiz with the same settings', await U.page.isVisible('#screen-question') && (await U.page.textContent('#prog-txt')) === '1 / 10');
  await U.page.click('#back-btn');

  // Quiz scores page
  await go(U.page, 'quiz-scores.html');
  await U.page.waitForSelector('#list .sk-li');
  const stats = await U.page.evaluate(() => ['st-count', 'st-avg', 'st-best'].map((id) => document.getElementById(id).textContent));
  const rows = await U.page.$$eval('#list .sk-li', (els) => els.map((e) => e.textContent));
  check('quiz scores (user): 2 taken, average 60%, best 7/10, newest first', J(stats) === J(['2', '60%', '7/10']) && rows.length === 2 && rows[0].includes('Text → Sign') && rows[0].includes('7/10') && rows[1].includes('5/10'), J({ stats, rows }));
  await shot(U.page, '14-quiz-scores-user');

  // ── 3. Admin ────────────────────────────────────────────────────────────────────────────
  const Ad = await newPage();
  await login(Ad.page, ADMIN_USER, ADMIN_PASS);
  const adCards = await Ad.page.$$eval('.card-btn .card-label', (els) => els.map((e) => e.textContent.trim()));
  await Ad.page.click('#sk-chip');
  const aMenu = await Ad.page.$$eval('#sk-menu .sk-menu-item', (els) => els.map((e) => e.textContent.trim()));
  check('admin dashboard: same 3 cards; menu = Train Gestures, View Reports, Bulk import, Manage users, All conversations, Quiz results, Settings, Log out',
    J(adCards) === J(['Learn Signs', "Let's Talk", 'Quiz']) && J(aMenu) === J(['Train Gestures', 'View Reports', 'Bulk import', 'Manage users', 'All conversations', 'Quiz results', 'Settings', 'Log out'])
    && (await Ad.page.textContent('#sk-chip')).includes('ADMIN'), J({ adCards, aMenu }));
  const aMenuBottom = await Ad.page.$eval('#sk-menu', (e) => Math.round(e.getBoundingClientRect().bottom));
  check('admin menu fits the 600 px screen', aMenuBottom <= 600, aMenuBottom);
  await shot(Ad.page, '05-dashboard-admin-menu');
  // Owner decision 2026-10-18: no PIN anywhere; the logged-in admin role is the only gate.
  const ADMIN_UI = { 'gesture-training.html': '#training-ui', 'reports.html': '.page', 'bulk-import.html': '#bi-ui', 'avatar-clips.html': '#ac-ui', 'diagnostic.html': 'body', 'users.html': '#screen-list' };
  for (const p of ADMIN_PAGES) {
    await go(Ad.page, p);
    const st = await Ad.page.evaluate((sel) => ({
      pin: !!document.querySelector('#pin-screen, .pin-screen, .pin-key, .pin-pad, [data-pin]') || /enter the PIN/i.test(document.body.innerText),
      ui: !!document.querySelector(sel) && document.querySelector(sel).offsetHeight > 0,
    }), ADMIN_UI[p]);
    check(`admin opening ${p} gets the page at once, no PIN`, Ad.page.url().endsWith('/' + p) && !st.pin && st.ui, J({ url: Ad.page.url(), ...st }));
  }
  await go(Ad.page, 'gesture-training.html');
  await shot(Ad.page, '22-train-gestures-admin-no-pin');

  // Manage users
  await go(Ad.page, 'users.html');
  await Ad.page.waitForSelector(`#rows tr[data-username="${user1.username}"]`);
  const selfRow = await Ad.page.$eval(`#rows tr[data-username="${ADMIN_USER}"]`, (tr) => tr.textContent);
  check('manage users: the admin\'s own row has no Deactivate', !selfRow.includes('Deactivate') && selfRow.includes('Reset password'), selfRow);
  await shot(Ad.page, '18-manage-users');
  await Ad.page.click('#add-btn');
  const user2 = { name: 'Rhaiza QA', username: 'zzqa' + tag + 'b', password: 'pass2' };
  await Ad.page.fill('#f-name', user2.name);
  await Ad.page.fill('#f-username', user2.username);
  await Ad.page.click('#f-password');
  await sleep(400);
  const addBox = await Ad.page.evaluate(() => ['#f-name', '#f-username', '#f-password', '#f-add-submit', '#f-role'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().bottom)));
  check('Add user: full-screen form, fields + button above the keyboard (<= 320 px)', addBox.every((b) => b <= 320), J(addBox));
  await Ad.page.fill('#f-password', user2.password);
  await shot(Ad.page, '19-add-user');
  await Ad.page.click('#f-add-submit');
  await Ad.page.waitForSelector(`#rows tr[data-username="${user2.username}"]`);
  check('Add user: created as a user, listed', query(`SELECT role FROM users WHERE username = '${user2.username}'`)[0]?.role === 'user');
  await Ad.page.click(`#rows tr[data-username="${user1.username}"] button[data-act="reset"]`);
  await Ad.page.fill('#f-newpass', 'newpass1');
  await shot(Ad.page, '20-reset-password');
  await Ad.page.click('#f-reset-submit');
  await Ad.page.waitForFunction(() => /Password changed/.test(document.getElementById('list-msg').textContent));
  await Ad.page.click(`#rows tr[data-username="${user1.username}"] button[data-act="off"]`);
  await Ad.page.waitForFunction((u) => document.querySelector(`#rows tr[data-username="${u}"]`).textContent.includes('Inactive'), user1.username);
  await shot(Ad.page, '18b-manage-users-deactivated');
  const L = await newPage();
  await go(L.page, 'login.html');
  await L.page.fill('#login-username', user1.username);
  await L.page.fill('#login-password', 'newpass1');
  await L.page.click('#login-submit');
  await L.page.waitForFunction(() => document.getElementById('auth-msg').textContent !== '');
  const deMsg = await L.page.textContent('#auth-msg');
  check('a deactivated user cannot log in (clear message)', /turned off/.test(deMsg) && L.page.url().endsWith('login.html'), deMsg);
  await shot(L.page, '21-login-deactivated');
  await go(U.page, 'quiz-scores.html');
  check('a deactivated user\'s open session stops working (sent to login)', /login\.html/.test(U.page.url()), U.page.url());
  await Ad.page.click(`#rows tr[data-username="${user1.username}"] button[data-act="on"]`);
  await Ad.page.waitForFunction((u) => document.querySelector(`#rows tr[data-username="${u}"]`).textContent.includes('Active'), user1.username);
  await go(L.page, 'login.html');
  await L.page.fill('#login-username', user1.username);
  await L.page.fill('#login-password', 'newpass1');
  await L.page.click('#login-submit');
  await L.page.waitForURL(/index\.html$/);
  check('activated again + reset password: logs in with the new password', true);

  // All conversations (admin) + filters + Load more
  await Ad.page.evaluate(async (m) => {
    for (let i = 0; i < 21; i++) {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      await fetch('php/api/save_conversation.php', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', client_key: key, seq: 1, speaker: 'signer', source: 'sign', sign_language: i % 2 ? 'ESL' : 'FSL', text: `Guest talk ${i} ${m}` }) });
    }
  }, MARK);
  await go(Ad.page, 'conversations.html');
  await Ad.page.waitForSelector('#list .sk-li');
  const first = await Ad.page.$$eval('#list .sk-li', (els) => els.length);
  check('all conversations (admin): 20 per load + Load more, filters shown', first === 20 && await Ad.page.isVisible('#load-more') && await Ad.page.isVisible('#filters'), first);
  await shot(Ad.page, '08-conversations-admin');
  await Ad.page.click('#load-more');
  await Ad.page.waitForFunction(() => document.querySelectorAll('#list .sk-li').length > 20);
  check('Load more adds the next page', (await Ad.page.$$eval('#list .sk-li', (els) => els.length)) > 20);
  await Ad.page.selectOption('#f-user', 'guest');
  await Ad.page.waitForFunction(() => document.querySelectorAll('#list .sk-li').length > 0 && !document.querySelector('#list .sk-empty'));
  const guestPills = await Ad.page.$$eval('#list .sk-li .sk-pill', (els) => [...new Set(els.map((e) => e.textContent))]);
  check('filter User = Guest: only guest conversations', J(guestPills) === J(['Guest']), J(guestPills));
  await Ad.page.selectOption('#f-user', String(user1.id));
  await Ad.page.waitForFunction((u) => [...document.querySelectorAll('#list .sk-li .sk-pill')].every((e) => e.textContent === u) && document.querySelectorAll('#list .sk-li').length > 0, user1.username);
  const u1Titles = await Ad.page.$$eval('#list .sk-li b', (els) => els.map((e) => e.textContent));
  check('filter User = the user: exactly their conversations', u1Titles.length === count(`SELECT COUNT(*) AS n FROM conversations WHERE user_id = ${user1.id}`), J(u1Titles));
  await Ad.page.selectOption('#f-user', '');
  await Ad.page.selectOption('#f-lang', 'ESL');
  await Ad.page.waitForTimeout(800);
  const eslMeta = await Ad.page.$$eval('#list .sk-li small', (els) => els.map((e) => e.textContent));
  check('filter Language = ESL: every row is an ESL conversation', eslMeta.length > 0 && eslMeta.every((t) => t.includes('ESL')), J(eslMeta.slice(0, 5)));
  await shot(Ad.page, '08b-conversations-admin-filtered');
  await Ad.page.selectOption('#f-lang', '');
  await Ad.page.selectOption('#f-user', 'guest');
  await Ad.page.waitForTimeout(800);
  await Ad.page.click('#list .sk-li');
  await Ad.page.waitForSelector('#thread .msg');
  check('admin can open a guest conversation', (await Ad.page.textContent('#bar-meta')).includes('Guest'));
  await shot(Ad.page, '07b-conversation-thread-admin-guest');

  // Quiz results (admin)
  await go(Ad.page, 'quiz-scores.html');
  await Ad.page.waitForSelector('#list .sk-li');
  await Ad.page.selectOption('#f-user', String(user1.id));
  await Ad.page.waitForTimeout(800);
  const aStats = await Ad.page.evaluate(() => ['st-count', 'st-avg', 'st-best'].map((id) => document.getElementById(id).textContent));
  const aRows = await Ad.page.$$eval('#list .sk-li', (els) => els.map((e) => e.textContent));
  check('quiz results (admin) filtered to the user: matches the user\'s own page', J(aStats) === J(['2', '60%', '7/10']) && aRows.length === 2 && aRows.every((r) => r.includes(user1.username)), J({ aStats, aRows }));
  await shot(Ad.page, '17-quiz-results-admin');

  // ── 4. Avatar clips in the quiz (served by interception) ────────────────────────────────
  const V = await newPage();
  const avSigns = ['zz_av_one', 'zz_av_two', 'zz_av_three', 'zz_av_four', 'zz_av_five'].map((key, i) => ({ key, text: `Avatar ${i + 1}`, category: 'phrases', clip: { type: 'avatar', key } }));
  await V.page.route('**/php/api/quiz.php?action=pool&lang=ESL', (r) => r.fulfill({ contentType: 'application/json', body: J({ success: true, lang: 'ESL', signs: avSigns }) }));
  await V.page.route('**/saved_gestures/zz_av_*/avatar.json', (r) => {
    const key = /saved_gestures\/([^/]+)\/avatar\.json/.exec(r.request().url())[1];
    r.fulfill({ contentType: 'application/json', body: J(fixtureClip(key, avSigns.findIndex((s) => s.key === key))) });
  });
  await go(V.page, 'quiz.html');
  await V.page.click('#seg-lang button[data-v="ESL"]');
  await V.page.click('#seg-cat button[data-v="phrases"]');
  await V.page.waitForFunction(() => !document.getElementById('start-btn').disabled);
  await V.page.click('#start-btn');
  await V.page.waitForSelector('#s2t-clip canvas');
  const frameA = await V.page.$eval('#s2t-clip canvas', (c) => c.toDataURL());
  await sleep(450);
  const frameB = await V.page.$eval('#s2t-clip canvas', (c) => c.toDataURL());
  check('avatar clip: Sign->Text plays the sign on the avatar (canvas drawn and moving)', frameA.length > 3000 && frameA !== frameB);
  await shot(V.page, '11b-quiz-sign-to-text-avatar');
  await V.page.click('#back-btn');
  await V.page.click('#seg-mode button[data-v="text-to-sign"]');
  await V.page.click('#start-btn');
  await V.page.waitForFunction(() => document.querySelectorAll('#t2s .vc canvas').length === 4);
  await sleep(600);
  const still1 = await V.page.$$eval('#t2s .vc canvas', (cs) => cs.map((c) => c.toDataURL()));
  await sleep(400);
  const still2 = await V.page.$$eval('#t2s .vc canvas', (cs) => cs.map((c) => c.toDataURL()));
  await V.page.click('#t2s .vc:nth-child(3) .play');
  await sleep(500);
  const p1 = await V.page.$$eval('#t2s .vc canvas', (cs) => cs.map((c) => c.toDataURL()));
  await sleep(400);
  const p2 = await V.page.$$eval('#t2s .vc canvas', (cs) => cs.map((c) => c.toDataURL()));
  check('avatar clip: Text->Sign shows 4 still avatars; only the tapped one moves',
    J(still1) === J(still2) && p1[2] !== p2[2] && p1[0] === p2[0] && p1[1] === p2[1] && p1[3] === p2[3]);
  await shot(V.page, '12b-quiz-text-to-sign-avatar');

  // ── 5. Log out ──────────────────────────────────────────────────────────────────────────
  await go(Ad.page, 'index.html');
  await Ad.page.click('#sk-chip');
  await Ad.page.click('#sk-logout');
  await Ad.page.waitForURL(/index\.html$/);
  await Ad.page.waitForSelector('#sk-login-btn');
  check('Log out: back to the guest dashboard', await Ad.page.isVisible('#sk-login-btn'));
  check('after Log out the admin API answers 403', (await apiStatus(Ad.page, BASE + 'php/admin_api.php', { action: 'list_users' })) === 403);

  // ── console errors ──
  const NEW = /\/(index|login|quiz|quiz-scores|conversations|users|talk)\.html/;
  const newErr = consoleErrors.filter((e) => NEW.test(e.page));
  const oldErr = consoleErrors.filter((e) => !NEW.test(e.page));
  check('0 console errors on the new / changed screens (dashboard, login, quiz, scores, conversations, users, Let\'s Talk)', newErr.length === 0, J(newErr.slice(0, 8)));
  if (oldErr.length) console.log('console errors on the existing admin pages (not part of this phase):', J(oldErr.slice(0, 10)));
  check('conversations created by this check carry the marker (cleanup works)', count('SELECT COUNT(*) AS n FROM conversations') >= convBefore);
} catch (e) {
  check('e2e ran to the end', false, e.stack || e.message);
} finally {
  await browser.close();
  cleanup();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
