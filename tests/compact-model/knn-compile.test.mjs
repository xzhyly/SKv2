// Tests for js/knn-compile.js (compact-model phase, Task 1): membership, the per-sign budget,
// the fingerprint, and the models/knn_<LANG>.bin encode/decode. Spec: .git/sdd/cm-plan.md
// "Shared definitions". Numbers pinned here come from the frozen fixtures in ./fixtures/, never
// from live saved_gestures/.
//
// Run: node --test --test-concurrency=1 "tests/compact-model/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFixtureListing,
  loadFixtureVideos,
  loadExpected,
  loadToRows,
  loadKnnCompile,
  loadGestureDataWithListing,
  makeKioskKnn,
} from './fixtures.mjs';

const K = loadKnnCompile();
const listing = loadFixtureListing();
const toRows = loadToRows();
const expected = loadExpected();
const BUILD_DATE = '2026-10-15T00:00:00.000Z';

// Pinned on the fixture (Task 3's PHP fingerprint must give the same hex).
const FIXTURE_FINGERPRINT = {
  ESL: '2b8d5ad23a7538b0e382e9b89a48d37f29659611dfbc56c720ebf623913cc51a',
  FSL: '59deb47275d204786ffe949e9f1f42240d88f561f26a33df2055e818f4ef323f',
};

// gesture-data.js runs in a node:vm context, so its arrays have another realm's prototype;
// copy them into this realm before deepStrictEqual.
const plain = (rows) => rows.map((r) => Array.from(r));

function build(lang, src = listing, rule) {
  return K.buildModel({
    gestures: src.gestures,
    signs: src.signs,
    categories: src.categories,
    lang,
    toRows,
    rule,
    buildDate: BUILD_DATE,
  });
}

async function buildWithFingerprint(lang, src = listing) {
  const b = build(lang, src);
  b.header.fingerprint = await K.sha256Hex(b.fingerprintText);
  return b;
}

// The kiosk model as talk.html built it before this phase (HEAD b61c665): recordingsToTrainingRows
// (after loadSavedGestureDataset set state.signs), the language filter of
// js/sign-to-text-ui.js:115-123 at HEAD b61c665, then the "non-empty 126-long rows" rebuild of :149-155
// (that code no longer exists).
function kioskModel(rows, targetLang) {
  const trainData = { start: [], stop: [] };
  rows.forEach(({ label, features, signLanguage }) => {
    const itemLang = signLanguage || 'ESL';
    if (itemLang === targetLang || itemLang === 'BOTH' || (label === 'start' || label === 'stop')) {
      if (!trainData[label]) trainData[label] = [];
      trainData[label].push(features);
    }
  });
  const knn = {};
  for (const label in trainData) {
    const allFrames = trainData[label].filter((f) => Array.isArray(f) && f.length === 126);
    if (allFrames.length > 0) knn[label] = allFrames;
  }
  return knn;
}

// ---- fixture: rows, labels, membership -------------------------------------------------

test('fixture: ESL 2,047 rows / 122 labels, FSL 1,414 rows / 90 labels, start in both', () => {
  const esl = build('ESL');
  const fsl = build('FSL');
  assert.equal(esl.header.rowCount, 2047);
  assert.equal(esl.header.labels.length, 122);
  assert.equal(fsl.header.rowCount, 1414);
  assert.equal(fsl.header.labels.length, 90);
  assert.equal(esl.header.rowCount, expected.budget90.rowsESL);
  assert.equal(fsl.header.rowCount, expected.budget90.rowsFSL);
  assert.ok(esl.model.start && fsl.model.start, 'start is in both models');
  // labels sorted by key, model keys in the same order
  const keys = esl.header.labels.map((L) => L.key);
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(Object.keys(esl.model), keys);
  assert.equal(esl.header.sampleCount, 127);
  assert.equal(fsl.header.sampleCount, 91);
});

test('fixture: rows identical (same order per label) to the model today\'s kiosk builds', async () => {
  const { G, gestures } = await loadGestureDataWithListing(listing);
  const trainingRows = G.recordingsToTrainingRows(gestures);
  for (const lang of ['ESL', 'FSL']) {
    const kiosk = kioskModel(trainingRows, lang);
    const { model } = build(lang);
    assert.deepEqual(Object.keys(model).sort(), Object.keys(kiosk).sort(), `${lang} labels`);
    for (const label of Object.keys(kiosk)) {
      assert.deepStrictEqual(plain(model[label]), plain(kiosk[label]), `${lang} ${label}`);
    }
  }
});

test('fixture membership matches docs/system/ML.md: ESL = all 122, FSL = 89 BOTH + start', () => {
  const all = Object.keys(listing.gestures).sort();
  const both = all.filter((k) => listing.signs[k].set === 'BOTH');
  assert.equal(all.length, 122);
  assert.equal(both.length, 89);
  assert.deepEqual(build('ESL').header.labels.map((L) => L.key), all);
  assert.deepEqual(build('FSL').header.labels.map((L) => L.key), [...both, 'start'].sort());
  assert.equal(listing.signs.start.set, 'ESL');
});

test('inModel: ESL/FSL/BOTH and the start/stop exception', () => {
  assert.equal(K.inModel('ESL', 'a', 'ESL'), true);
  assert.equal(K.inModel('ESL', 'a', 'FSL'), false);
  assert.equal(K.inModel('ESL', 'a', 'BOTH'), true);
  assert.equal(K.inModel('FSL', 'a', 'ESL'), false);
  assert.equal(K.inModel('FSL', 'a', 'FSL'), true);
  assert.equal(K.inModel('FSL', 'start', 'ESL'), true);
  assert.equal(K.inModel('FSL', 'stop', 'ESL'), true);
  assert.equal(K.inModel('ESL', 'stop', 'FSL'), true);
});

test('createBuilder: signs added in batches, in any order, equal buildModel (ESL and FSL)', () => {
  for (const lang of ['ESL', 'FSL']) {
    const whole = build(lang);
    const b = K.createBuilder({ signs: listing.signs, categories: listing.categories, lang, toRows, buildDate: BUILD_DATE });
    const keys = Object.keys(listing.gestures).reverse();   // not sorted: finish() sorts
    for (let i = 0; i < keys.length; i += 17) {
      keys.slice(i, i + 17).forEach((k) => b.addSign(k, listing.gestures[k]));
    }
    const got = b.finish();
    assert.deepStrictEqual(got.header, whole.header, lang + ' header');
    assert.deepStrictEqual(Object.keys(got.model), Object.keys(whole.model), lang + ' label order');
    for (const k of Object.keys(whole.model)) assert.deepStrictEqual(plain(got.model[k]), plain(whole.model[k]), lang + ' rows of ' + k);
    assert.equal(Buffer.compare(Buffer.from(K.encode(got.header, got.model)), Buffer.from(K.encode(whole.header, whole.model))), 0, lang + ' encoded bytes');
  }
  const b = K.createBuilder({ signs: listing.signs, categories: listing.categories, lang: 'ESL', toRows });
  b.addSign('hello', listing.gestures.hello);
  assert.throws(() => b.addSign('hello', listing.gestures.hello), /added twice/);
  b.finish();
  assert.throws(() => b.addSign('a', listing.gestures.a), /after finish/);
  assert.throws(() => K.createBuilder({ lang: 'XSL', toRows }), /lang must be ESL or FSL/);
  assert.throws(() => K.createBuilder({ lang: 'ESL' }), /toRows/);
});

test('header fields', () => {
  const { header } = build('FSL');
  assert.equal(header.formatVersion, 1);
  assert.equal(header.lang, 'FSL');
  assert.equal(header.buildDate, BUILD_DATE);
  assert.equal(header.builtOn, 'laptop');
  assert.deepEqual(header.rule, { ...K.DEFAULT_RULE });
  assert.equal(header.dims, 126);
  assert.equal(header.dtype, 'f32');
  assert.equal(header.fingerprint, null);
  const start = header.labels.find((L) => L.key === 'start');
  assert.deepEqual(Object.keys(start), ['key', 'set', 'category', 'textEn', 'textFil', 'samples', 'rows']);
  assert.equal(start.set, 'ESL');
  assert.equal(start.textEn, 'Start');
  assert.equal(start.textFil, null);
  const hello = header.labels.find((L) => L.key === 'hello');
  if (hello) assert.equal(hello.category, listing.categories.FSL.hello ?? null);
  assert.ok(Object.isFrozen(K.DEFAULT_RULE));
  assert.equal(K.FORMAT_VERSION, 1);
  assert.equal(K.DIMS, 126);
});

// ---- encode / decode ---------------------------------------------------------------------

test('encode -> decode round trip on the fixture: header equal, values = Math.fround(input)', async () => {
  for (const lang of ['ESL', 'FSL']) {
    const b = await buildWithFingerprint(lang);
    const buf = K.encode(b.header, b.model);
    const d = K.decode(buf);
    assert.deepStrictEqual(d.header, JSON.parse(JSON.stringify(b.header)));
    assert.deepEqual(Object.keys(d.model), Object.keys(b.model));
    let values = 0;
    let bad = 0;
    for (const label of Object.keys(b.model)) {
      assert.equal(d.model[label].length, b.model[label].length);
      d.model[label].forEach((row, i) => {
        assert.ok(Array.isArray(row) && row.length === 126, 'decoded rows are plain Arrays of 126');
        for (let j = 0; j < 126; j++, values++) if (row[j] !== Math.fround(b.model[label][i][j])) bad++;
      });
    }
    assert.equal(bad, 0);
    assert.equal(values, b.header.rowCount * 126);
    // body starts on a multiple of 4 and holds exactly rowCount * 126 Float32
    const hl = new DataView(buf).getUint32(8, true);
    assert.equal(buf.byteLength, Math.ceil((12 + hl) / 4) * 4 + b.header.rowCount * 126 * 4);
    console.log(`  ${lang}: ${buf.byteLength} bytes encoded (${b.header.rowCount} rows, header ${hl} bytes)`);
  }
});

test('decode accepts a Node Buffer / Uint8Array view, not only an ArrayBuffer', async () => {
  const b = await buildWithFingerprint('FSL');
  const buf = K.encode(b.header, b.model);
  const padded = new Uint8Array(buf.byteLength + 3);
  padded.set(new Uint8Array(buf), 3);
  const d = K.decode(padded.subarray(3));
  assert.equal(d.header.rowCount, 1414);
});

test('kiosk knnPredict: same top-1 on the decoded ESL model as on the double model, 5,010 queries', () => {
  const b = build('ESL');
  const decoded = K.decode(K.encode(b.header, b.model)).model;
  const handRows = (frames) =>
    frames.filter((f) => f && Array.isArray(f.hands) && f.hands.length > 0).map((f) => toRows({ frames: [f] })[0]);
  const NUM = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
  const queries = [];
  const videos = loadFixtureVideos();
  for (const name of Object.keys(videos).filter((n) => n.startsWith('en__'))) {
    const raw = name.slice(4);
    const key = NUM[raw] || raw;
    if (b.model[key]) queries.push(...handRows(videos[name].frames));
  }
  for (const label of Object.keys(listing.gestures)) {
    for (const s of listing.gestures[label]) {
      const isV3 = (s.frames || []).some((f) => f && Array.isArray(f.hands));
      queries.push(...(isV3 ? handRows(s.frames) : toRows(s)));
    }
  }
  assert.equal(queries.length, expected.queriesForFloat32Check);
  assert.equal(queries.length, 5010);

  const knn = makeKioskKnn();
  knn.set(b.model);
  const ref = queries.map((q) => knn.predict(q).label);
  knn.set(decoded);
  let same = 0;
  queries.forEach((q, i) => { if (knn.predict(q).label === ref[i]) same++; });
  assert.equal(same, 5010);
});

test('encode refuses a model that does not match its header', async () => {
  const b = build('FSL');
  const row = b.model.start[0];
  const one = (rows) => ({
    header: { ...b.header, rowCount: rows.length, labels: [{ ...b.header.labels[0], key: 'x', rows: rows.length }] },
    model: { x: rows },
  });
  let t = one([Array(125).fill(0)]);
  assert.throws(() => K.encode(t.header, t.model), /^Error: knn model file: label "x" row 0 is not 126/);
  t = one([[...row.slice(0, 125), NaN]]);
  assert.throws(() => K.encode(t.header, t.model), /row 0 is not 126 finite numbers/);
  t = one([row]);
  t.header.labels[0].rows = 2;
  t.header.rowCount = 2;
  assert.throws(() => K.encode(t.header, t.model), /has 1 rows, header says 2/);
  t = one([row]);
  t.header.rowCount = 5;
  assert.throws(() => K.encode(t.header, t.model), /label rows add up to 1, rowCount is 5/);
  t = one([row]);
  t.model.y = [row];
  assert.throws(() => K.encode(t.header, t.model), /model has 2 labels, header has 1/);
});

// ---- decoder refusals --------------------------------------------------------------------

// A raw file, no validation: `header` is an object or a raw string; `rows` Float32 rows.
function rawFile(header, { rows = 0, magic = 'SKKN', version = 1, dtype = 1, hl, extra = 0 } = {}) {
  const hb = new TextEncoder().encode(typeof header === 'string' ? header : JSON.stringify(header));
  const start = Math.ceil((12 + hb.length) / 4) * 4;
  const buf = new ArrayBuffer(start + rows * 126 * 4 + extra);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) u8[i] = magic.charCodeAt(i);
  dv.setUint16(4, version, true);
  dv.setUint16(6, dtype, true);
  dv.setUint32(8, hl === undefined ? hb.length : hl, true);
  u8.set(hb, 12);
  return buf;
}

const goodHeader = () => ({
  formatVersion: 1, lang: 'ESL', buildDate: BUILD_DATE, builtOn: 'laptop', rule: { ...K.DEFAULT_RULE },
  dims: 126, dtype: 'f32', fingerprint: null, sampleCount: 2, rowCount: 3,
  labels: [{ key: 'a', rows: 2 }, { key: 'b', rows: 1 }],
});

test('decoder: the hand-made good file decodes (control for the refusals below)', () => {
  const d = K.decode(rawFile(goodHeader(), { rows: 3 }));
  assert.deepEqual(Object.keys(d.model), ['a', 'b']);
  assert.equal(d.model.a.length, 2);
});

test('decoder refusals: each throws "knn model file: ..."', () => {
  const refuse = (buf, re) => assert.throws(() => K.decode(buf), (e) => e instanceof Error && /^knn model file: /.test(e.message) && re.test(e.message));
  const h = (patch) => Object.assign(goodHeader(), patch);
  refuse(rawFile(goodHeader(), { rows: 3, magic: 'SKKM' }), /bad magic/);
  refuse(rawFile(goodHeader(), { rows: 3, version: 2 }), /format version 2/);
  refuse(rawFile(goodHeader(), { rows: 3, dtype: 3 }), /dtype 3/);
  refuse(rawFile(goodHeader(), { rows: 3, hl: 1 }), /header length 1 is out of range/);
  refuse(rawFile(goodHeader(), { rows: 3, hl: 4194305 }), /header length 4194305 is out of range/);
  refuse(rawFile(goodHeader(), { rows: 0, hl: 4194304 }), /runs past the end/);
  refuse(rawFile('{"lang": "ESL", oops'), /header is not valid JSON/);
  refuse(rawFile(h({ dims: 63 }), { rows: 3 }), /dims must be 126/);
  refuse(rawFile(h({ lang: 'BOTH' }), { rows: 3 }), /lang must be ESL or FSL/);
  refuse(rawFile(h({ labels: { a: 2 } }), { rows: 3 }), /labels is not an array/);
  refuse(rawFile(h({ labels: [{ rows: 2 }, { key: 'b', rows: 1 }] }), { rows: 3 }), /label 0 has no key/);
  refuse(rawFile(h({ labels: [{ key: '', rows: 2 }, { key: 'b', rows: 1 }] }), { rows: 3 }), /label 0 has no key/);
  refuse(rawFile(h({ labels: [{ key: 7, rows: 2 }, { key: 'b', rows: 1 }] }), { rows: 3 }), /label 0 has no key/);
  refuse(rawFile(h({ labels: [{ key: 'a', rows: 2 }, { key: 'a', rows: 1 }] }), { rows: 3 }), /duplicate label "a"/);
  refuse(rawFile(h({ labels: [{ key: 'a', rows: -1 }, { key: 'b', rows: 4 }] }), { rows: 3 }), /"a" rows is not a non-negative integer/);
  refuse(rawFile(h({ labels: [{ key: 'a', rows: 1.5 }, { key: 'b', rows: 1.5 }] }), { rows: 3 }), /"a" rows is not a non-negative integer/);
  refuse(rawFile(h({ labels: [{ key: 'a', rows: '2' }, { key: 'b', rows: 1 }] }), { rows: 3 }), /"a" rows is not a non-negative integer/);
  refuse(rawFile(h({ rowCount: 4 }), { rows: 4 }), /label rows add up to 3, rowCount is 4/);
  refuse(rawFile(goodHeader(), { rows: 2 }), /body is \d+ bytes, expected 1512 for 3 rows/);
  refuse(rawFile(goodHeader(), { rows: 3, extra: 4 }), /body is \d+ bytes, expected 1512/);
  refuse(new ArrayBuffer(8), /too short/);
  assert.throws(() => K.decode('SKKN'), /^Error: knn model file: not an ArrayBuffer/);
});

// ---- the per-sign budget -----------------------------------------------------------------

// rows tagged so the selection is visible: row(s, i)[0] = s, [1] = i
const row = (s, i) => { const r = Array(126).fill(0.5); r[0] = s; r[1] = i; return r; };
const sample = (s, n) => Array.from({ length: n }, (_, i) => row(s, i));
const tags = (rows) => rows.map((r) => `${r[0]}:${r[1]}`);

test('evenIdx: all indices when len <= k, else rounded even spacing with both ends', () => {
  assert.deepEqual(K.evenIdx(2, 3), [0, 1]);
  assert.deepEqual(K.evenIdx(3, 3), [0, 1, 2]);
  assert.deepEqual(K.evenIdx(30, 3), [0, 15, 29]); // round(14.5) = 15
  assert.deepEqual(K.evenIdx(30, 12), [0, 3, 5, 8, 11, 13, 16, 18, 21, 24, 26, 29]);
  assert.deepEqual(K.evenIdx(0, 3), []);
});

test('budget 90: 1 x 30 and 3 x 30 unchanged', () => {
  const one = [sample(0, 30)];
  assert.deepEqual(tags(K.selectSignRows(one, K.DEFAULT_RULE)), tags(one.flat()));
  const three = [sample(0, 30), sample(1, 30), sample(2, 30)];
  const out = K.selectSignRows(three, K.DEFAULT_RULE);
  assert.equal(out.length, 90);
  assert.deepEqual(tags(out), tags(three.flat()));
  assert.equal(out[0], three[0][0], 'rows are the same objects, not copies');
});

test('budget 90: 7 x 30 -> 7 x 12 = 84, evenly spaced per sample', () => {
  const lists = Array.from({ length: 7 }, (_, s) => sample(s, 30));
  const out = K.selectSignRows(lists, K.DEFAULT_RULE);
  assert.equal(out.length, 84);
  const idx = K.evenIdx(30, 12);
  assert.deepEqual(tags(out), lists.flatMap((_, s) => idx.map((i) => `${s}:${i}`)));
});

test('budget 90: 25 x 30 -> 25 x 3 = 75 (the minimum of 3 per sample)', () => {
  const lists = Array.from({ length: 25 }, (_, s) => sample(s, 30));
  const out = K.selectSignRows(lists, K.DEFAULT_RULE);
  assert.equal(out.length, 75);
  assert.deepEqual(tags(out.slice(0, 3)), ['0:0', '0:15', '0:29']);
});

test('budget 90: a 2-row sample mixed with 30-row ones keeps both rows; empty samples do not count', () => {
  // 4 samples with rows (2 + 3 x 30 = 92 > 90) -> k = floor(90 / 4) = 22; the 2-row sample keeps 2
  const lists = [sample(0, 30), sample(1, 2), [], sample(2, 30), sample(3, 30)];
  const out = K.selectSignRows(lists, K.DEFAULT_RULE);
  assert.equal(out.length, 22 + 2 + 22 + 22);
  assert.deepEqual(tags(out.filter((r) => r[0] === 1)), ['1:0', '1:1']);
  // 2 + 2 x 30 = 62 <= 90: everything kept
  assert.equal(K.selectSignRows([sample(0, 30), sample(1, 2), sample(2, 30)], K.DEFAULT_RULE).length, 62);
});

test('budget 120: 3 x 30 and 4 x 30 unchanged, 7 x 30 -> 7 x 17 = 119', () => {
  const rule = { ...K.DEFAULT_RULE, budget: 120 };
  assert.equal(K.selectSignRows(Array.from({ length: 4 }, (_, s) => sample(s, 30)), rule).length, 120);
  assert.equal(K.selectSignRows(Array.from({ length: 7 }, (_, s) => sample(s, 30)), rule).length, 119);
  // and the rule used is written into the header
  const src = { gestures: { x: Array.from({ length: 7 }, (_, s) => ({ file: `saved_gestures/x/sample_${s}.json`, frames: sample(s, 30) })) }, signs: { x: { set: 'ESL' } }, categories: { ESL: {}, FSL: {} } };
  const b = build('ESL', src, rule);
  assert.equal(b.header.rule.budget, 120);
  assert.equal(b.header.rowCount, 119);
});

test('selectSignRows refuses an unknown rule', () => {
  assert.throws(() => K.selectSignRows([sample(0, 3)], { ...K.DEFAULT_RULE, spacing: 'fps' }), /unsupported rule/);
  assert.throws(() => K.selectSignRows([sample(0, 3)], { ...K.DEFAULT_RULE, budget: 0 }), /unsupported rule/);
});

// ---- edge datasets -----------------------------------------------------------------------

const v2 = (label, s, n) => ({ file: `saved_gestures/${label}/sample_${s}.json`, label, signLanguage: 'ESL', frames: sample(s, n) });
const empty = () => ({ gestures: {}, signs: {}, categories: { ESL: {}, FSL: {} } });

test('edge: empty listing -> a valid file with 0 labels / 0 rows that decodes', async () => {
  for (const lang of ['ESL', 'FSL']) {
    const b = await buildWithFingerprint(lang, empty());
    assert.equal(b.fingerprintText, '');
    assert.equal(b.header.rowCount, 0);
    assert.equal(b.header.sampleCount, 0);
    const d = K.decode(K.encode(b.header, b.model));
    assert.deepEqual(d.header.labels, []);
    assert.deepEqual(d.model, {});
  }
});

test('edge: a sign folder with sign.json and no samples is left out and not in the fingerprint', () => {
  const src = empty();
  src.gestures = { a: [v2('a', 1, 5)], x: [] };
  src.signs = { a: { set: 'ESL' }, x: { set: 'BOTH', textEn: 'X', textFil: 'X' } };
  const b = build('ESL', src);
  assert.deepEqual(b.header.labels.map((L) => L.key), ['a']);
  assert.equal(b.fingerprintText, 'a|ESL|saved_gestures/a/sample_1.json');
});

test('edge: a v3 sample with no hand frames gives 0 rows, is not counted, but its file is in the fingerprint', () => {
  const src = empty();
  const noHands = { file: 'saved_gestures/a/sample_9.json', label: 'a', signLanguage: 'ESL', frames: [{ t: 0, hands: [] }, { t: 66, hands: [] }] };
  src.gestures = { a: [v2('a', 1, 5), noHands], z: [{ ...noHands, file: 'saved_gestures/z/sample_8.json', label: 'z' }] };
  src.signs = { a: { set: 'ESL' }, z: { set: 'ESL' } };
  const b = build('ESL', src);
  assert.deepEqual(b.header.labels.map((L) => [L.key, L.samples, L.rows]), [['a', 1, 5]]);
  assert.equal(b.header.sampleCount, 1);
  assert.equal(b.fingerprintText, [
    'a|ESL|saved_gestures/a/sample_1.json',
    'a|ESL|saved_gestures/a/sample_9.json',
    'z|ESL|saved_gestures/z/sample_8.json',
  ].join('\n'));
});

test('edge: a sign with 1 sample, and one with 24+ samples (25 x 30 -> 75 rows)', () => {
  const src = empty();
  src.gestures = { one: [v2('one', 0, 7)], many: Array.from({ length: 25 }, (_, s) => v2('many', s, 30)) };
  src.signs = { one: { set: 'BOTH' }, many: { set: 'BOTH' } };
  const b = build('FSL', src);
  assert.deepEqual(b.header.labels.map((L) => [L.key, L.samples, L.rows]), [['many', 25, 75], ['one', 1, 7]]);
  assert.equal(K.decode(K.encode(b.header, b.model)).header.rowCount, 82);
});

test('edge: no signs entry -> the sample\'s signLanguage, then ESL (as recordingsToTrainingRows)', () => {
  const src = empty();
  src.gestures = { f: [{ ...v2('f', 1, 2), signLanguage: 'FSL' }], e: [{ ...v2('e', 2, 2), signLanguage: undefined }] };
  assert.deepEqual(build('FSL', src).header.labels.map((L) => [L.key, L.set]), [['f', 'FSL']]);
  assert.deepEqual(build('ESL', src).header.labels.map((L) => [L.key, L.set]), [['e', 'ESL']]);
});

test('edge: rows that are not 126 finite numbers are dropped', () => {
  const src = empty();
  const s = v2('a', 1, 3);
  s.frames.push(Array(63).fill(0.1).concat([NaN], Array(62).fill(0.1)));
  src.gestures = { a: [s] };
  src.signs = { a: { set: 'ESL' } };
  assert.equal(build('ESL', src).header.rowCount, 3);
});

// ---- fingerprint -------------------------------------------------------------------------

test('fingerprint: exact hex on the fixture (ESL / FSL)', async () => {
  for (const lang of ['ESL', 'FSL']) {
    const b = await buildWithFingerprint(lang);
    console.log(`  ${lang} fingerprint ${b.header.fingerprint} (${b.fingerprintText.split('\n').length} lines)`);
    assert.equal(b.header.fingerprint, FIXTURE_FINGERPRINT[lang]);
    assert.equal(b.fingerprintText, K.fingerprintText(listing.gestures, listing.signs, lang));
  }
  const lines = K.fingerprintText(listing.gestures, listing.signs, 'ESL').split('\n');
  assert.equal(lines.length, 127);
  assert.ok(lines.includes('start|ESL|' + listing.gestures.start[0].file));
  assert.match(await K.sha256Hex(''), /^e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855$/);
});

test('fingerprint: stable under listing order; changes on add/remove/set; not on category/text', async () => {
  const fp = (src, lang = 'ESL') => K.sha256Hex(K.fingerprintText(src.gestures, src.signs, lang));
  const clone = () => JSON.parse(JSON.stringify(listing));
  const base = await fp(listing);

  const reordered = clone();
  reordered.gestures = Object.fromEntries(Object.keys(listing.gestures).reverse().map((k) => [k, [...listing.gestures[k]].reverse()]));
  assert.equal(await fp(reordered), base);

  const added = clone();
  added.gestures.hello = [...(added.gestures.hello || []), { file: 'saved_gestures/hello/sample_1799999999999_abcdef.json', frames: [] }];
  assert.notEqual(await fp(added), base);

  const removed = clone();
  const someLabel = Object.keys(removed.gestures).find((k) => removed.gestures[k].length > 1);
  removed.gestures[someLabel].pop();
  assert.notEqual(await fp(removed), base);

  const setChanged = clone();
  const eslOnly = Object.keys(setChanged.signs).find((k) => setChanged.signs[k].set === 'ESL' && k !== 'start');
  setChanged.signs[eslOnly].set = 'BOTH';
  assert.notEqual(await fp(setChanged), base, 'ESL: line text changes');
  assert.notEqual(await fp(setChanged, 'FSL'), await fp(listing, 'FSL'), 'FSL: sign joins the model');

  const cosmetic = clone();
  for (const k of Object.keys(cosmetic.signs)) { cosmetic.signs[k].textEn = 'changed'; cosmetic.signs[k].textFil = 'binago'; }
  for (const k of Object.keys(cosmetic.categories.ESL)) cosmetic.categories.ESL[k] = 'phrase';
  assert.equal(await fp(cosmetic), base);
});
