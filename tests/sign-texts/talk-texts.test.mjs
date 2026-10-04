// Unit tests (node:vm) for Task 6 of the sign-texts phase: Let's Talk reads the sign texts.
//   - js/sign-to-text-ui.js translateGestureLabel prefers GestureDataRecorder.getSignText
//   - js/sign-to-text-ui.js mergeSavedGestureSamples accepts BOTH signs for either model
//   - js/sign-player.js registers signs.php texts in the right language maps and plays an
//     assets/-relative path as-is (observed through a fake <video>, so no new export is needed)
// SIGN_TEXTS_ROOT=<dir> loads another copy of js/ (used to show the tests fail on HEAD).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SIGN_TEXTS_ROOT || path.join(here, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');

// ── sign-to-text-ui.js ──
function loadUi({ recorder, rows = [], lang = 'en' } = {}) {
  const stubEl = () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, querySelector: () => null });
  const window = { addEventListener() {}, GestureDataRecorder: recorder, loadGestureDatasetForTraining: async () => rows };
  const ctx = {
    window, console, setTimeout, clearTimeout, performance: { now: () => 0 },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: stubEl, readyState: 'complete', body: stubEl() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, location: { search: '' }, URLSearchParams,
    Array, Object, Math, Number, String, Boolean, JSON, Promise, Error, RegExp, Set, Map,
  };
  ctx.globalThis = ctx;
  ctx.GestureDataRecorder = recorder; // in a browser window is the global object
  vm.createContext(ctx);
  vm.runInContext(read('sign-to-text-ui.js') + '\n;globalThis.__t = { translateGestureLabel, mergeSavedGestureSamples, setLang(l){ signLang = l; }, trainData: () => trainData };', ctx);
  ctx.__t.setLang(lang);
  return ctx.__t;
}

test('translateGestureLabel returns the sign text when the recorder has one', () => {
  const calls = [];
  const recorder = { getSignText: (k, l) => { calls.push([k, l]); return k === 'how_are_you' ? (l === 'fil' ? 'Kamusta ka' : 'How are you') : null; } };
  const { translateGestureLabel } = loadUi({ recorder });
  assert.equal(translateGestureLabel('how_are_you', 'en'), 'How are you');
  assert.equal(translateGestureLabel('how_are_you', 'fil'), 'Kamusta ka');
  assert.deepEqual(calls[0], ['how_are_you', 'en']);
});

test('translateGestureLabel falls back to the old body when no sign text or no recorder', () => {
  for (const rec of [{ getSignText: () => null }, undefined, {}]) {
    const { translateGestureLabel } = loadUi({ recorder: rec });
    assert.equal(translateGestureLabel('thank_you', 'fil'), 'Salamat');
    assert.equal(translateGestureLabel('thank_you', 'en'), 'Thank you');
    assert.equal(translateGestureLabel('zz_unknown_sign', 'en'), 'Zz Unknown Sign');
  }
});

test('mergeSavedGestureSamples: ESL model takes ESL+BOTH, FSL model takes FSL+BOTH, start/stop always', async () => {
  const rows = [
    { label: 'a_esl', features: [1], signLanguage: 'ESL' },
    { label: 'b_both', features: [2], signLanguage: 'BOTH' },
    { label: 'c_fsl', features: [3], signLanguage: 'FSL' },
    { label: 'start', features: [4], signLanguage: 'FSL' },
  ];
  const esl = loadUi({ rows, lang: 'en' });
  await esl.mergeSavedGestureSamples();
  assert.deepEqual(Object.keys(esl.trainData()).sort(), ['a_esl', 'b_both', 'start', 'stop']);
  const fsl = loadUi({ rows, lang: 'fil' });
  await fsl.mergeSavedGestureSamples();
  assert.deepEqual(Object.keys(fsl.trainData()).sort(), ['b_both', 'c_fsl', 'start', 'stop']);
});

// ── sign-player.js ──
// Fake <video>/<img>: every src that gets set is logged. The first-step probe video (created
// without autoplay) always errors so the asset map decides; displayMedia's video (autoplay set)
// loads and ends at once.
function loadPlayer(signsPayload) {
  const log = { videoSrcs: [], fetched: [] };
  const document = {
    createElement(tag) {
      const v = {
        style: {}, pause() {}, play() { return Promise.resolve(); }, removeAttribute() {},
        load() {
          log.videoSrcs.push(this.src);
          setTimeout(() => {
            if (this.autoplay !== true) { this.onerror && this.onerror(); return; }
            this.onloadedmetadata && this.onloadedmetadata();
            this.onended && this.onended();
          }, 0);
        },
      };
      return v;
    },
  };
  const window = {};
  const ctx = {
    window, document, console, Promise, Object, Array, String, JSON, Error, RegExp, Math,
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    Image: function () {
      const o = { style: {} };
      Object.defineProperty(o, 'src', { set(s) { log.videoSrcs.push(s); setTimeout(() => o.onload && o.onload(), 0); } });
      return o;
    },
    fetch: async (url) => { log.fetched.push(url); return { ok: true, json: async () => signsPayload }; },
  };
  vm.createContext(ctx);
  vm.runInContext(read('sign-player.js'), ctx);
  const container = { querySelectorAll: () => [], appendChild() {}, innerHTML: '' };
  const wordLabel = { textContent: '' };
  const player = (lang) => window.SignPlayer.create({ container, wordLabel, getLanguage: () => lang });
  return { SignPlayer: window.SignPlayer, player, log };
}

const PAYLOAD = {
  success: true,
  signs: {
    zz_both: { set: 'BOTH', textEn: 'Zz Both!', textFil: 'Zz Ba', category: 'phrase', assetPath: 'assets/signs/en/zz_both.webm', samples: 1 },
    zz_eslonly: { set: 'ESL', textEn: 'Zz Eslonly', textFil: 'Hidden Fil', category: 'word', assetPath: 'assets/signs/en/zz_eslonly.webm', samples: 1 },
    zz_noasset: { set: 'BOTH', textEn: 'Zz Noasset', textFil: 'Zz Walang', category: 'word', assetPath: null, samples: 1 },
    zz_stock: { set: 'BOTH', textEn: 'Hello', textFil: 'Kamusta', category: 'word', assetPath: 'assets/signs/en/zz_override.webm', samples: 1 },
  },
};

async function playOne(payload, lang, text) {
  const h = loadPlayer(payload);
  await h.SignPlayer.registerCustomGestures();
  h.log.videoSrcs.length = 0;
  await h.player(lang).play(text);
  return h.log.videoSrcs.slice();
}

test('registerCustomGestures fetches php/api/signs.php, not save_gesture.php', async () => {
  const h = loadPlayer(PAYLOAD);
  await h.SignPlayer.registerCustomGestures();
  assert.deepEqual(h.log.fetched, ['php/api/signs.php']);
});

test('BOTH sign: text registered in both maps and its assets/ path is used as-is', async () => {
  const en = await playOne(PAYLOAD, 'en-US', 'zz both');
  assert.ok(en.includes('assets/signs/en/zz_both.webm'), JSON.stringify(en));
  assert.ok(!en.some((s) => s.includes('/assets/signs/')), JSON.stringify(en));
  const fil = await playOne(PAYLOAD, 'fil-PH', 'zz ba');
  assert.ok(fil.includes('assets/signs/en/zz_both.webm'), JSON.stringify(fil));
  assert.ok(!fil.some((s) => s.includes('/assets/signs/')), JSON.stringify(fil));
});

test('ESL-only sign: English text resolves, Filipino text is not registered', async () => {
  const en = await playOne(PAYLOAD, 'en-US', 'zz eslonly');
  assert.ok(en.includes('assets/signs/en/zz_eslonly.webm'), JSON.stringify(en));
  const fil = await playOne(PAYLOAD, 'fil-PH', 'hidden fil');
  assert.ok(!fil.includes('assets/signs/en/zz_eslonly.webm'), JSON.stringify(fil));
  assert.ok(fil.includes('assets/signs/fil/h.webm'), 'falls through to fingerspelling: ' + JSON.stringify(fil));
});

test('sign without assetPath keeps the old key.webm value', async () => {
  const en = await playOne(PAYLOAD, 'en-US', 'zz noasset');
  assert.ok(en.includes('assets/signs/en/zz_noasset.webm'), JSON.stringify(en));
  const fil = await playOne(PAYLOAD, 'fil-PH', 'zz walang');
  assert.ok(fil.includes('assets/signs/fil/zz_noasset.webm'), JSON.stringify(fil));
});

test('the key with spaces is still registered for the sign language map', async () => {
  const payload = { success: true, signs: { zz_k_one: { set: 'ESL', textEn: 'Different Words', textFil: null, assetPath: null, samples: 1 } } };
  const out = await playOne(payload, 'en-US', 'zz k one');
  assert.ok(out.includes('assets/signs/en/zz_k_one.webm'), JSON.stringify(out));
});

test('stock entries are never overwritten by a sign text', async () => {
  const en = await playOne(PAYLOAD, 'en-US', 'hello');
  assert.ok(en.includes('assets/signs/en/hello.webm'), JSON.stringify(en));
  assert.ok(!en.includes('assets/signs/en/zz_override.webm'), JSON.stringify(en));
});
