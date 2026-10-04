// Unit tests (node:vm, no DOM) for the sign-texts additions to js/gesture-data.js:
// signs state / getSignText, recordingsToTrainingRows using signs[key].set, the one-time
// model-schema reset, and saveGestureSample's text_en/text_fil + BOTH + 409 error properties.
// SIGN_TEXTS_SOURCE=<path> loads another copy of the file (used to show the tests fail on HEAD).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(process.env.SIGN_TEXTS_SOURCE || path.join(here, '..', '..', 'js', 'gesture-data.js'), 'utf8');

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _keys: () => [...m.keys()].sort(),
  };
}

function load({ storage = fakeStorage(), fetchImpl } = {}) {
  const window = {};
  const document = {
    readyState: 'complete',
    createElement: () => ({ getContext: () => ({}), style: {} }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: { appendChild() {} },
  };
  const ctx = {
    window, document, location: { search: '', protocol: 'http:' }, navigator: {},
    localStorage: storage, console, setTimeout, clearTimeout, URLSearchParams,
    fetch: fetchImpl || (() => Promise.reject(new Error('network disabled in test'))),
    Array, Object, Math, Number, String, Boolean, JSON, Promise, Error,
  };
  ctx.self = window; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'js/gesture-data.js' });
  return window.GestureDataRecorder;
}

const plain = (v) => JSON.parse(JSON.stringify(v)); // vm objects are cross-realm: normalise before deepEqual
const frame = (v) => ({ landmarks: Array.from({ length: 21 }, () => ({ x: v, y: v, z: v })) });
const sample = (lang) => ({ file: 's.json', label: 'x', frameCount: 1, signLanguage: lang, frames: [frame(0.1)] });
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });

test('recordingsToTrainingRows: row signLanguage comes from signs[key].set', async () => {
  const g = load({ fetchImpl: async () => jsonRes(200, {
    success: true, gestures: { how_are_you: [sample('ESL')], water: [sample('ESL')] }, categories: {},
    signs: { how_are_you: { set: 'BOTH', textEn: 'How are you', textFil: 'Kamusta ka' }, water: { set: 'ESL', textEn: 'Water', textFil: null } },
  }) });
  const gestures = await g.loadSavedGestureDataset();
  const rows = g.recordingsToTrainingRows(gestures);
  assert.equal(rows.find((r) => r.label === 'how_are_you').signLanguage, 'BOTH');
  assert.equal(rows.find((r) => r.label === 'water').signLanguage, 'ESL');
});

test('recordingsToTrainingRows: falls back to the sample signLanguage with no signs entry', () => {
  const g = load();
  const rows = g.recordingsToTrainingRows({ legacy: [sample('FSL')], plain: [{ frames: [frame(0.2)] }] });
  assert.equal(rows.find((r) => r.label === 'legacy').signLanguage, 'FSL');
  assert.equal(rows.find((r) => r.label === 'plain').signLanguage, 'ESL');
  assert.deepEqual(plain(Object.keys(rows[0]).sort()), ['features', 'label', 'signLanguage']);
});

test('getSignText: en / fil / null', async () => {
  const g = load({ fetchImpl: async () => jsonRes(200, {
    success: true, gestures: {}, categories: {},
    signs: { hi: { set: 'ESL', textEn: 'Hi!', textFil: null }, kain: { set: 'FSL', textEn: '', textFil: 'Kain na?' } },
  }) });
  await g.loadSavedGestureDataset();
  assert.equal(g.getSignText('hi', 'en'), 'Hi!');
  assert.equal(g.getSignText('hi', 'fil'), null);
  assert.equal(g.getSignText('kain', 'fil'), 'Kain na?');
  assert.equal(g.getSignText('kain', 'en'), null);
  assert.equal(g.getSignText('hi'), 'Hi!');
  assert.equal(g.getSignText('nope', 'en'), null);
  assert.deepEqual(plain(Object.keys(g.getSigns()).sort()), ['hi', 'kain']);
});

test('loadSigns merges signs.php into the state and never throws', async () => {
  let url;
  const g = load({ fetchImpl: async (u) => { url = u; return jsonRes(200, { success: true, signs: { a: { set: 'BOTH', textEn: 'A', textFil: 'Ay', category: 'word' } } }); } });
  assert.equal(await g.loadSigns(), true);
  assert.match(url, /php\/api\/signs\.php$/);
  assert.deepEqual(plain(g.getSigns().a), { set: 'BOTH', textEn: 'A', textFil: 'Ay' });
  const bad = load();
  assert.equal(await bad.loadSigns(), false);
  const badJson = load({ fetchImpl: async () => jsonRes(500, { success: false, error: 'x' }) });
  assert.equal(await badJson.loadSigns(), false);
});

test('model-schema reset removes exactly the six keys once and sets the flag', () => {
  const six = ['sining_kamay_knn_ESL', 'sining_kamay_knn_FSL', 'sining_kamay_labels_ESL', 'sining_kamay_labels_FSL', 'sining_kamay_trained_labels_ESL', 'sining_kamay_trained_labels_FSL'];
  const st = fakeStorage(Object.fromEntries([...six, 'other_key', 'sining_kamay_pin'].map((k) => [k, 'v'])));
  load({ storage: st });
  assert.deepEqual(st._keys(), ['other_key', 'sining_kamay_model_schema', 'sining_kamay_pin']);
  assert.equal(st.getItem('sining_kamay_model_schema'), '2');
  // second load: a model trained since must survive
  st.setItem('sining_kamay_knn_ESL', 'trained');
  load({ storage: st });
  assert.equal(st.getItem('sining_kamay_knn_ESL'), 'trained');
});

test('model-schema reset survives blocked storage', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => load({ storage: broken }));
});

test('saveGestureSample sends text_en / text_fil and sign_language BOTH', async () => {
  let body;
  const g = load({ fetchImpl: async (u, init) => { body = JSON.parse(init.body); return jsonRes(200, { success: true, label: 'how_are_you', set: 'BOTH' }); } });
  const res = await g.saveGestureSample('How are you?', [], 'BOTH', null, null, 'phrase', { formatVersion: 3, textEn: 'How are you?', textFil: 'Kumusta ka?', bogus: 1 });
  assert.equal(res.success, true);
  assert.equal(body.sign_language, 'BOTH');
  assert.equal(body.label, 'how_are_you');
  assert.equal(body.text_en, 'How are you?');
  assert.equal(body.text_fil, 'Kumusta ka?');
  assert.equal(body.formatVersion, 3);
  assert.equal(body.category, 'phrase');
  assert.equal('bogus' in body, false);
});

test('saveGestureSample: unknown set -> ESL; texts omitted when not strings', async () => {
  let body;
  const g = load({ fetchImpl: async (u, init) => { body = JSON.parse(init.body); return jsonRes(200, { success: true }); } });
  await g.saveGestureSample('a', [], 'weird', null, null, null, { textEn: null });
  assert.equal(body.sign_language, 'ESL');
  assert.equal('text_en' in body, false);
  assert.equal('text_fil' in body, false);
  await g.saveGestureSample('a', [], 'FSL', null, null, null, { textFil: 'Aa' });
  assert.equal(body.sign_language, 'FSL');
  assert.equal(body.text_fil, 'Aa');
});

test('saveGestureSample 409 throws with message, status and existingSet', async () => {
  const g = load({ fetchImpl: async () => jsonRes(409, { success: false, error: '"hi" already exists as ESL', existingSet: 'ESL' }) });
  await assert.rejects(
    () => g.saveGestureSample('hi', [], 'FSL', null, null, null, { textFil: 'Hi' }),
    (e) => e instanceof Error && e.message === '"hi" already exists as ESL' && e.status === 409 && e.existingSet === 'ESL'
  );
});
