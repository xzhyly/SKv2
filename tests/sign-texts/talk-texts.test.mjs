// Unit tests (node:vm) for Task 6 of the sign-texts phase: Let's Talk reads the sign texts.
//   - js/sign-to-text-ui.js translateGestureLabel prefers GestureDataRecorder.getSignText
//   - the compiled model (js/knn-compile.js) accepts BOTH signs for either model (this test moved
//     here from the retired mergeSavedGestureSamples, compact-model phase)
//   - js/sign-to-text-ui.js autoTrainForTranslate loads the model through KnnModelStore only
//   - js/sign-player.js registers signs.php texts in the right language maps and plays an
//     assets/-relative path as-is (observed through a fake <video>, so no new export is needed)
// SIGN_TEXTS_ROOT=<dir> loads another copy of js/ (used to show the tests fail on HEAD).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SIGN_TEXTS_ROOT || path.join(here, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
const KnnCompile = createRequire(import.meta.url)(path.join(ROOT, 'js', 'knn-compile.js'));
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm objects are cross-realm

// ── sign-to-text-ui.js ──
function loadUi({ recorder, store, lang = 'en', log = { fetched: [], logs: [], warns: [] } } = {}) {
  const stubEl = () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, querySelector: () => null });
  const fetch = async (u) => { log.fetched.push(String(u)); throw new Error('fetch must not be called'); };
  const window = { addEventListener() {}, GestureDataRecorder: recorder, KnnModelStore: store, fetch,
    loadGestureDatasetForTraining: async () => { log.fetched.push('loadGestureDatasetForTraining'); return []; } };
  const quiet = { ...console, log: (...a) => log.logs.push(a.join(' ')), warn: (...a) => log.warns.push(a.map(String).join(' ')) };
  const ctx = {
    window, console: quiet, fetch, setTimeout, clearTimeout, performance: { now: () => 0 },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: stubEl, readyState: 'complete', body: stubEl() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, location: { search: '' }, URLSearchParams,
    Array, Object, Math, Number, String, Boolean, JSON, Promise, Error, RegExp, Set, Map,
  };
  ctx.globalThis = ctx;
  ctx.GestureDataRecorder = recorder; // in a browser window is the global object
  vm.createContext(ctx);
  vm.runInContext(read('sign-to-text-ui.js') + '\n;globalThis.__t = { translateGestureLabel, autoTrainForTranslate, setLang(l){ signLang = l; },' +
    ' reset(){ modelTrained = false; knnModel = null; }, get: () => ({ knnModel, activeLabels, modelTrained, activeFeatureSize }) };', ctx);
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

test('compiled model membership: ESL takes ESL+BOTH, FSL takes FSL+BOTH, start/stop always', () => {
  // The same four rows the retired mergeSavedGestureSamples test used, as a listing.
  const rows = [
    { label: 'a_esl', features: 1, signLanguage: 'ESL' },
    { label: 'b_both', features: 2, signLanguage: 'BOTH' },
    { label: 'c_fsl', features: 3, signLanguage: 'FSL' },
    { label: 'start', features: 4, signLanguage: 'FSL' },
  ];
  const gestures = {};
  rows.forEach((r) => { gestures[r.label] = [{ file: r.label + '.json', signLanguage: r.signLanguage, rows: [new Array(126).fill(r.features)] }]; });
  const toRows = (sample) => sample.rows;
  for (const r of rows) {
    assert.equal(KnnCompile.inModel('ESL', r.label, r.signLanguage), r.label !== 'c_fsl', 'ESL ' + r.label);
    assert.equal(KnnCompile.inModel('FSL', r.label, r.signLanguage), r.label !== 'a_esl', 'FSL ' + r.label);
  }
  assert.equal(KnnCompile.inModel('ESL', 'stop', 'FSL'), true);
  assert.equal(KnnCompile.inModel('FSL', 'stop', 'ESL'), true);
  const esl = KnnCompile.buildModel({ gestures, signs: {}, lang: 'ESL', toRows });
  assert.deepEqual(Object.keys(esl.model).sort(), ['a_esl', 'b_both', 'start']);
  assert.deepEqual(esl.header.labels.map((l) => l.key), ['a_esl', 'b_both', 'start']);
  const fsl = KnnCompile.buildModel({ gestures, signs: {}, lang: 'FSL', toRows });
  assert.deepEqual(Object.keys(fsl.model).sort(), ['b_both', 'c_fsl', 'start']);
  // 'stop' has no samples here, so it is in neither file (the old in-memory model kept an empty
  // 'stop' key, which knnPredict scored 0); with a sample it is in both.
  gestures.stop = [{ file: 'stop.json', signLanguage: 'ESL', rows: [new Array(126).fill(5)] }];
  assert.ok('stop' in KnnCompile.buildModel({ gestures, signs: {}, lang: 'FSL', toRows }).model);
  assert.ok('stop' in KnnCompile.buildModel({ gestures, signs: {}, lang: 'ESL', toRows }).model);
});

// A stub KnnModelStore: load(lang) resolves the model given for that language (or rejects).
function stubStore(byLang) {
  const calls = [];
  return {
    calls,
    load: async (lang) => {
      calls.push(lang);
      const m = byLang[lang];
      if (!m || m instanceof Error) throw (m || new Error('no model for ' + lang));
      const labels = Object.keys(m);
      return {
        header: { lang, rowCount: labels.reduce((n, k) => n + m[k].length, 0), labels: labels.map((k) => ({ key: k, set: 'BOTH', textEn: k + ' en', textFil: k + ' fil' })) },
        model: m, labels, source: 'network', bytes: 1, etag: '"x"',
      };
    },
  };
}
const row = (v) => new Array(126).fill(v);

test('autoTrainForTranslate loads ESL for en and FSL for fil through KnnModelStore, never fetch', async () => {
  const ESL = { a: [row(1)], hello: [row(2), row(3)], start: [row(4)] };
  const FSL = { kain: [row(5)], start: [row(4)] };
  const store = stubStore({ ESL, FSL });
  const signCalls = [];
  const recorder = { getSignText: () => null, setModelSigns: (l) => signCalls.push(plain(l)) };
  const log = { fetched: [], logs: [], warns: [] };
  const ui = loadUi({ recorder, store, lang: 'en', log });
  assert.equal(await ui.autoTrainForTranslate(), true);
  let st = ui.get();
  assert.equal(st.knnModel, ESL);
  assert.deepEqual(plain(st.activeLabels), ['a', 'hello', 'start']);
  assert.equal(st.modelTrained, true);
  assert.equal(st.activeFeatureSize, 126);
  assert.deepEqual(signCalls[0].map((l) => l.key), ['a', 'hello', 'start']);
  assert.ok(log.logs.includes('[KNN] ESL model: 4 rows, 3 labels (network)'), JSON.stringify(log.logs));
  // already trained: no second load
  assert.equal(await ui.autoTrainForTranslate(), true);
  assert.deepEqual(store.calls, ['ESL']);
  // switch to Filipino the way talk-signing.js does
  ui.setLang('fil'); ui.reset();
  assert.equal(await ui.autoTrainForTranslate(), true);
  st = ui.get();
  assert.equal(st.knnModel, FSL);
  assert.deepEqual(plain(st.activeLabels), ['kain', 'start']);
  assert.deepEqual(store.calls, ['ESL', 'FSL']);
  assert.equal(signCalls.length, 2);
  assert.deepEqual(log.fetched, []);
  assert.deepEqual(log.warns, []);
});

test('autoTrainForTranslate returns false for a rejected load, a 1-label model and no store', async () => {
  const log = { fetched: [], logs: [], warns: [] };
  const rejected = loadUi({ store: stubStore({ ESL: new Error('[KnnModelStore] ESL model unavailable: HEAD failed; no stored copy') }), log });
  assert.equal(await rejected.autoTrainForTranslate(), false);
  assert.equal(rejected.get().modelTrained, false);
  assert.ok(log.warns.some((w) => w.includes('ESL model unavailable')), JSON.stringify(log.warns));

  const one = loadUi({ store: stubStore({ FSL: { start: [row(1)] } }), lang: 'fil', log, recorder: {} });
  assert.equal(await one.autoTrainForTranslate(), false);
  assert.equal(one.get().modelTrained, false);
  assert.deepEqual(plain(one.get().activeLabels), ['start']);

  const none = loadUi({ log });
  assert.equal(await none.autoTrainForTranslate(), false);
  assert.ok(log.warns.some((w) => w.includes('knn-model-store.js is not loaded')), JSON.stringify(log.warns));
  assert.deepEqual(log.fetched, []);
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

test('texts with "?" resolve with and without the "?" in the right maps', async () => {
  const payload = { success: true, signs: { zz_q_key: { set: 'BOTH', textEn: 'Zz How are you?', textFil: 'Zz Kumusta ka?', assetPath: 'assets/signs/en/zz_q_key.webm', samples: 1 } } };
  for (const t of ['zz how are you', 'zz how are you?']) {
    const en = await playOne(payload, 'en-US', t);
    assert.ok(en.includes('assets/signs/en/zz_q_key.webm'), t + ' ' + JSON.stringify(en));
  }
  for (const t of ['zz kumusta ka', 'zz kumusta ka?']) {
    const fil = await playOne(payload, 'fil-PH', t);
    assert.ok(fil.includes('assets/signs/en/zz_q_key.webm'), t + ' ' + JSON.stringify(fil));
  }
  const esl = { success: true, signs: { zz_q_esl: { set: 'ESL', textEn: 'Zz Only En?', textFil: 'Zz Hidden Fil?', assetPath: 'assets/signs/en/zz_q_esl.webm', samples: 1 } } };
  const fil = await playOne(esl, 'fil-PH', 'zz hidden fil');
  assert.ok(!fil.includes('assets/signs/en/zz_q_esl.webm'), JSON.stringify(fil));
});
