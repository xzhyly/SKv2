// Unit tests (node:vm) for Task 6 of the sign-texts phase: Let's Talk reads the sign texts.
//   - js/sign-to-text-ui.js translateGestureLabel prefers GestureDataRecorder.getSignText
//   - the compiled model (js/knn-compile.js) accepts BOTH signs for either model (this test moved
//     here from the retired mergeSavedGestureSamples, compact-model phase)
//   - js/sign-to-text-ui.js autoTrainForTranslate loads the model through KnnModelStore only
//   - js/sign-player.js registers signs.php texts in the right language maps (signs with avatar
//     data only since the talk-turns-audio phase; everything else is fingerspelled by the avatar)
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
// Avatar only since the talk-turns-audio phase: what a text plays is read from SignPlayer.plan()
// (sign key per word, else fingerspelling units), and play() is checked to create no media element
// and to request nothing but signs.php (the avatar clips load through the store, faked here).
function loadPlayer(signsPayload) {
  const log = { created: [], fetched: [], loads: [], runs: [] };
  const el = () => {
    const kids = [];
    return { kids, children: kids, className: '', textContent: '', appendChild(c) { kids.push(c); return c; },
      classList: { add() {}, remove() {} } };
  };
  const document = { createElement(tag) { log.created.push(tag); return el(); }, createTextNode: (t) => ({ t }) };
  const window = {};
  const ctx = {
    window, document, console, Promise, Object, Array, String, JSON, Error, RegExp, Math, Number,
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    fetch: async (url) => { log.fetched.push(url); return { ok: true, json: async () => signsPayload }; },
  };
  vm.createContext(ctx);
  vm.runInContext(read('sign-player.js'), ctx);
  const caption = el();
  const avatarPlayer = { play: async (preps, o) => { log.runs.push(preps.map((p) => p.key)); preps.forEach((_, k) => o.onWord(k)); return { completed: true }; }, cancel() {} };
  const store = { load: async (key) => { log.loads.push(key); return { key }; } };
  const player = (lang) => window.SignPlayer.create({ caption, getLanguage: () => lang, avatar: { store, getPlayer: () => avatarPlayer } });
  return { SignPlayer: window.SignPlayer, player, log };
}

const sign = (o) => ({ samples: 1, assetPath: null, audio: { en: null, fil: null }, ...o });
const PAYLOAD = {
  success: true,
  signs: {
    zz_both: sign({ set: 'BOTH', textEn: 'Zz Both!', textFil: 'Zz Ba', category: 'phrase', avatar: true }),
    zz_eslonly: sign({ set: 'ESL', textEn: 'Zz Eslonly', textFil: 'Hidden Fil', category: 'word', avatar: true }),
    zz_noclip: sign({ set: 'BOTH', textEn: 'Zz Noclip', textFil: 'Zz Walang', category: 'word', avatar: false }),
    h: sign({ set: 'ESL', textEn: 'H', textFil: null, category: 'letter', avatar: true }),
    i: sign({ set: 'ESL', textEn: 'I', textFil: null, category: 'letter', avatar: true }),
    z: sign({ set: 'ESL', textEn: 'Z', textFil: null, category: 'letter', avatar: true }),
    two: sign({ set: 'BOTH', textEn: 'Two', textFil: 'Dalawa', category: 'number', avatar: true }),
    five: sign({ set: 'BOTH', textEn: 'Five', textFil: 'Lima', category: 'number', avatar: true }),
    ten: sign({ set: 'BOTH', textEn: 'Ten', textFil: 'Sampu', category: 'number', avatar: true }),
  },
};
// plan() -> 'key' for a sign, 'spell:a.b.?' for fingerspelling (? = a character with no sign)
async function planOf(payload, lang, text) {
  const h = loadPlayer(payload);
  await h.SignPlayer.registerCustomGestures();
  return plain(h.SignPlayer.plan(text, lang)).map((w) => w.kind === 'sign' ? w.units[0].key : 'spell:' + w.units.map((u) => u.key || '?').join('.'));
}

test('registerCustomGestures fetches php/api/signs.php once and resolves to the signs', async () => {
  const h = loadPlayer(PAYLOAD);
  const a = await h.SignPlayer.registerCustomGestures();
  await h.SignPlayer.registerCustomGestures();
  assert.deepEqual(h.log.fetched, ['php/api/signs.php']);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(PAYLOAD.signs).sort());
});

test('BOTH sign with avatar data: its text plays the sign in both languages', async () => {
  assert.deepEqual(await planOf(PAYLOAD, 'en-US', 'zz both'), ['zz_both']);
  assert.deepEqual(await planOf(PAYLOAD, 'fil-PH', 'zz ba'), ['zz_both']);
});

test('ESL-only sign: English text resolves, Filipino text is fingerspelled', async () => {
  assert.deepEqual(await planOf(PAYLOAD, 'en-US', 'zz eslonly'), ['zz_eslonly']);
  assert.deepEqual(await planOf(PAYLOAD, 'fil-PH', 'hidden'), ['spell:h.i.?.?.?.?']);
});

test('a sign without avatar data is fingerspelled (letters without a clip stay caption-only)', async () => {
  assert.deepEqual(await planOf(PAYLOAD, 'en-US', 'zz noclip'), ['spell:z.z', 'spell:?.?.?.?.i.?']);
});

test('numbers: 1-10 is one number sign, others digit by digit, 0 has no sign', async () => {
  assert.deepEqual(await planOf(PAYLOAD, 'en-US', '10 25 2 205'), ['ten', 'spell:two.five', 'two', 'spell:two.?.five']);
});

test('the key with spaces is still registered for the sign language map', async () => {
  const payload = { success: true, signs: { zz_k_one: sign({ set: 'ESL', textEn: 'Different Words', textFil: null, avatar: true }) } };
  assert.deepEqual(await planOf(payload, 'en-US', 'zz k one'), ['zz_k_one']);
});

test('texts with "?" resolve with and without the "?" in the right maps', async () => {
  const payload = { success: true, signs: { zz_q_key: sign({ set: 'BOTH', textEn: 'Zz How are you?', textFil: 'Zz Kumusta ka?', avatar: true }) } };
  for (const t of ['zz how are you', 'zz how are you?']) assert.deepEqual(await planOf(payload, 'en-US', t), ['zz_q_key'], t);
  for (const t of ['zz kumusta ka', 'zz kumusta ka?']) assert.deepEqual(await planOf(payload, 'fil-PH', t), ['zz_q_key'], t);
  const esl = { success: true, signs: { zz_q_esl: sign({ set: 'ESL', textEn: 'Zz Only En?', textFil: 'Zz Hidden Fil?', avatar: true }) } };
  assert.ok(!(await planOf(esl, 'fil-PH', 'zz hidden fil')).includes('zz_q_esl'));
});

test('play(): one avatar run for the whole sentence, no media element, nothing fetched but signs.php', async () => {
  const h = loadPlayer(PAYLOAD);
  await h.player('en-US').play('Zz Both hi 25 0');
  assert.deepEqual(plain(h.log.runs), [['zz_both', 'h', 'i', 'two', 'five']]);
  assert.deepEqual(plain(h.log.loads), ['zz_both', 'h', 'i', 'two', 'five']);
  assert.deepEqual(plain(h.log.fetched), ['php/api/signs.php']);
  assert.ok(!h.log.created.some((t) => t === 'video' || t === 'img'), JSON.stringify(h.log.created));
});

test('the old video path is gone from sign-player.js (no word -> .webm map, no assets/signs, no fallback.png)', () => {
  const code = read('sign-player.js').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\.webm|\.mp4|assets\/signs|fallback\.png|<video|createElement\('video'\)/.test(code));
});

test('cross-language lookup: selected language first, then the other one, then numbers, then spelling', async () => {
  const payload = { success: true, signs: {
    ...PAYLOAD.signs,
    zz_good: sign({ set: 'BOTH', textEn: 'Zz Good', textFil: 'Mabuti', avatar: true }),
    zz_fine: sign({ set: 'BOTH', textEn: 'Zz I am fine', textFil: 'Mabuti ako', avatar: true }),
    zz_hi: sign({ set: 'BOTH', textEn: 'Hello', textFil: 'Kumusta', avatar: true }),
    zz_same_en: sign({ set: 'ESL', textEn: 'Zz Same', textFil: null, avatar: true }),
    zz_same_fil: sign({ set: 'FSL', textEn: null, textFil: 'Zz Same', avatar: true }),
  } };
  assert.deepEqual(await planOf(payload, 'en-US', 'mabuti'), ['zz_good']);
  assert.deepEqual(await planOf(payload, 'fil-PH', 'hello'), ['zz_hi']);
  // longest phrase first across both maps: "mabuti ako" (FIL) beats "mabuti" in EN mode
  assert.deepEqual(await planOf(payload, 'en-US', 'hello mabuti ako'), ['zz_hi', 'zz_fine']);
  assert.deepEqual(await planOf(payload, 'en-US', 'zz i am fine'), ['zz_fine']);
  // the same text in both maps: the selected language wins
  assert.deepEqual(await planOf(payload, 'en-US', 'zz same'), ['zz_same_en']);
  assert.deepEqual(await planOf(payload, 'fil-PH', 'zz same'), ['zz_same_fil']);
  // an ESL-only text now resolves in FIL mode too; an unknown word is still spelled
  assert.deepEqual(await planOf(PAYLOAD, 'fil-PH', 'zz eslonly'), ['zz_eslonly']);
  assert.deepEqual(await planOf(payload, 'en-US', 'hiz'), ['spell:h.i.z']);
});
