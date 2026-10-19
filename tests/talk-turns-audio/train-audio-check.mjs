// talk-turns-audio phase, Train Gestures -> sign details -> Audio (docs/design/sign-audio-wireframe.html
// screen 1), Playwright Chromium at 1024x600, logged in as admin, fake microphone:
//   1  the sign list has an Audio column (🔊 EN · FIL / —); a letter's details show English only
//   2  Record (MediaRecorder) -> REC + Stop -> a new take with ▶ / Save / Discard -> Save writes
//      saved_gestures/<key>/audio_fil.webm; Upload a WAV -> audio_en.wav; the list shows 🔊 EN · FIL
//   3  ▶ plays the saved file; ✕ deletes it (only that language)
//   4  a guest is sent away from the page and the API answers 403; 0 console errors; no scroll
// Uses the real sign "hello" and removes its audio files again at the end (they did not exist before;
// the check refuses to run if they do). Run: node tests/talk-turns-audio/train-audio-check.mjs [--shots <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
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
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -- ' + String(detail).slice(0, 500) : ''}`);
}
const KEY = 'hello';
const DIR = path.join(repo, 'saved_gestures', KEY);
const audioFiles = () => fs.readdirSync(DIR).filter((f) => f.startsWith('audio_')).sort();
const others = () => Object.fromEntries(fs.readdirSync(DIR).filter((f) => !f.startsWith('audio_')).map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]));
if (audioFiles().length) { console.log(`FAIL  ${KEY} already has audio files: ${audioFiles()} (not touching them)`); process.exit(1); }
const before = others();
function wav() {
  const n = 4000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 4)), 44 + i * 2);
  return b;
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await ctx.addInitScript(() => {
  window.__plays = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays.push(this.src); return play.apply(this, arguments); };
});
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push('uncaught: ' + e.message));
p.on('dialog', (d) => d.accept());
const missing = [];
p.on('response', (r) => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `talk-audio-after-${name}.png`) }); };
const rowText = (lang) => p.evaluate((l) => document.querySelector(`#dsEditAudio .tr-aud-row[data-lang="${l}"]`)?.textContent || null, lang);
const listCell = (key) => p.evaluate((k) => { const tr = document.querySelector(`#datasetModalBody tr[data-key="${k}"]`); return tr ? tr.cells[5].textContent : null; }, key);
const tmpWav = path.join(repo, 'tests', 'talk-turns-audio', '.tmp-hello.wav');

try {
  // guest: page and API closed
  await p.goto(BASE + 'gesture-training.html');
  await sleep(800);
  check('a guest is sent away from Train Gestures', !/gesture-training/.test(p.url()), p.url());
  const guestApi = await p.evaluate(async () => (await fetch('php/api/sign_audio.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: 'hello', lang: 'en' }) })).status);
  check('sign_audio.php answers 403 to a guest', guestApi === 403, guestApi);
  errors.length = 0;   // that 403 was asked for
  missing.length = 0;

  await p.goto(BASE + 'login.html');
  await p.fill('#login-username', process.env.SK_TEST_ADMIN_USER || 'admin');
  await p.fill('#login-password', process.env.SK_TEST_ADMIN_PASS || 'admin123');
  await p.click('#login-submit');
  await sleep(1200);
  await p.goto(BASE + 'gesture-training.html');
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForFunction(() => document.getElementById('datasetCount').textContent !== '0 gestures', null, { timeout: 30000 });
  await p.evaluate(() => trOpenDatasetModal());
  await sleep(500);
  const head = await p.$$eval('.tr-ds-table th', (t) => t.map((x) => x.textContent));
  check('sign list has an Audio column', head[5] === 'Audio', J(head));
  check('hello: no audio yet (—)', (await listCell(KEY)) === '—', await listCell(KEY));

  // letter: English only
  await p.click('#datasetTabs button:nth-child(2)');
  await sleep(200);
  await p.evaluate(() => trOpenDatasetEdit('a'));
  await sleep(300);
  const letterLangs = await p.$$eval('#dsEditAudio .tr-aud-row', (r) => r.map((x) => x.dataset.lang));
  check('a letter shows English audio only', J(letterLangs) === J(['en']) && (await p.textContent('#dsEditAudio')).includes('Letters: English only'), J(letterLangs));
  await p.click('#dsEditCancel');

  await p.evaluate((k) => trOpenDatasetEdit(k), KEY);
  await sleep(300);
  check('hello (Both): English and Filipino rows, both "— no audio"', /— no audio/.test(await rowText('en')) && /— no audio/.test(await rowText('fil')), J([await rowText('en'), await rowText('fil')]));
  const card = await p.evaluate(() => { const b = document.querySelector('#datasetModal .tr-modal-card').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; });
  check('sign details with the Audio section fit the 600 px screen', card.top >= 0 && card.bottom <= 600, J(card));
  await shot('7-train-details');

  // record Filipino with the (fake) microphone
  await p.click('#dsEditAudio .tr-aud-row[data-lang="fil"] button:has-text("Record")');
  await p.waitForFunction(() => /REC 0:0/.test(document.querySelector('#dsEditAudio .tr-aud-row[data-lang="fil"]').textContent), null, { timeout: 10000 });
  await sleep(1300);
  check('recording: REC timer and ■ Stop', /■ Stop/.test(await rowText('fil')));
  await shot('7b-train-recording');
  await p.click('#dsEditAudio .tr-aud-row[data-lang="fil"] button:has-text("Stop")');
  await p.waitForFunction(() => /New take/.test(document.querySelector('#dsEditAudio .tr-aud-row[data-lang="fil"]').textContent), null, { timeout: 10000 });
  check('a new take shows ▶ / Save / Discard before anything is saved', /▶SaveDiscard/.test((await rowText('fil')).replace(/\s/g, '')) && audioFiles().length === 0, J([await rowText('fil'), audioFiles()]));
  await p.click('#dsEditAudio .tr-aud-row[data-lang="fil"] button[title="Play the new recording"]');
  await sleep(300);
  check('▶ plays the new take (a blob, not uploaded yet)', await p.evaluate(() => window.__plays.some((s) => s.startsWith('blob:'))));
  await shot('7c-train-take');
  await p.click('#dsEditAudio .tr-aud-row[data-lang="fil"] button:has-text("Save")');
  await p.waitForFunction(() => /● (saved|\d)/.test(document.querySelector('#dsEditAudio .tr-aud-row[data-lang="fil"]').textContent), null, { timeout: 10000 });
  check('Save writes saved_gestures/hello/audio_fil.webm', J(audioFiles()) === J(['audio_fil.webm']) && fs.statSync(path.join(DIR, 'audio_fil.webm')).size > 200, J(audioFiles()));

  // upload English
  fs.writeFileSync(tmpWav, wav());
  await p.setInputFiles('#dsEditAudio .tr-aud-row[data-lang="en"] input[type=file]', tmpWav);
  await p.waitForFunction(() => /● (saved|\d)/.test(document.querySelector('#dsEditAudio .tr-aud-row[data-lang="en"]').textContent), null, { timeout: 10000 });
  check('Upload writes saved_gestures/hello/audio_en.wav', J(audioFiles()) === J(['audio_en.wav', 'audio_fil.webm']), J(audioFiles()));
  await sleep(400);
  check('the saved WAV shows its length (0.5 s)', /● 0\.5 s/.test(await rowText('en')), await rowText('en'));
  await p.click('#dsEditAudio .tr-aud-row[data-lang="en"] button[title="Play the saved audio"]');
  await sleep(300);
  check('▶ plays the saved file', await p.evaluate(() => window.__plays.some((s) => /saved_gestures\/hello\/audio_en\.wav\?v=\d+$/.test(s))));
  await shot('7d-train-saved');
  await p.click('#dsEditCancel');
  await p.click('#datasetTabs button:nth-child(1)');
  await sleep(300);
  check('the sign list marks hello 🔊 EN · FIL', (await listCell(KEY)) === '🔊 EN · FIL', await listCell(KEY));
  await p.evaluate(() => { document.getElementById('datasetSearch').value = 'he'; trRenderDatasetView(); });
  await shot('6-train-list');
  await p.evaluate(() => { document.getElementById('datasetSearch').value = ''; trRenderDatasetView(); });
  const signs = await p.evaluate(async () => (await (await fetch('php/api/signs.php')).json()).signs.hello.audio);
  check('signs.php lists both files (Let\'s Talk reads them there)', /audio_en\.wav\?v=/.test(signs.en) && /audio_fil\.webm\?v=/.test(signs.fil), J(signs));

  // delete
  await p.evaluate((k) => trOpenDatasetEdit(k), KEY);
  await sleep(300);
  await p.click('#dsEditAudio .tr-aud-row[data-lang="fil"] button[title="Delete this audio"]');
  await p.waitForFunction(() => /— no audio/.test(document.querySelector('#dsEditAudio .tr-aud-row[data-lang="fil"]').textContent), null, { timeout: 10000 });
  check('✕ deletes only that language', J(audioFiles()) === J(['audio_en.wav']), J(audioFiles()));
  await p.click('#dsEditAudio .tr-aud-row[data-lang="en"] button[title="Delete this audio"]');
  await p.waitForFunction(() => /— no audio/.test(document.querySelector('#dsEditAudio .tr-aud-row[data-lang="en"]').textContent), null, { timeout: 10000 });
  check('both deleted; the sign\'s other files are unchanged', audioFiles().length === 0 && J(others()) === J(before));
  const scroll = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  check('no scroll at 1024x600', scroll[0] <= 1024 && scroll[1] <= 600, J(scroll));
  check('0 console errors', errors.length === 0, J({ errors, missing }));
} catch (e) {
  failures++;
  console.log('FAIL  check aborted: ' + (e && e.stack || e));
} finally {
  for (const f of audioFiles()) fs.rmSync(path.join(DIR, f));
  fs.rmSync(tmpWav, { force: true });
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
