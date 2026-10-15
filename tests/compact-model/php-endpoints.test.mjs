// Tests for php/api/compile_model.php, php/api/model_status.php and php/api/knn_model_lib.php
// (compact-model phase, Task 3). Spec: .git/sdd/cm-plan.md "Shared definitions".
// Every call runs php-cgi with SK_MODELS_DIR / SK_DATASET_ROOT / SK_CONFIG_DIR pointing at a fresh
// temp folder: the real models/, config/ and saved_gestures/ are never read or written here.
// Pinned numbers come from the frozen fixture listing (./fixtures/), never live data.
//
// Run: node --test --test-concurrency=1 "tests/compact-model/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadFixtureListing, loadToRows, loadKnnCompile, REPO_ROOT } from './fixtures.mjs';

const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';
const PHP_CLI = process.env.SK_PHP_CLI || 'C:\\xampp\\php\\php.exe';
const API_DIR = path.join(REPO_ROOT, 'php', 'api');
const LIB = path.join(API_DIR, 'knn_model_lib.php').replace(/\\/g, '/');

const K = loadKnnCompile();
const listing = loadFixtureListing();
const toRows = loadToRows();
const BUILD_DATE = '2026-10-15T00:00:00.000Z';
const PI_WARNING = 'Build the model on the laptop, then copy models/knn_ESL.bin and models/knn_FSL.bin to the Pi.';
const FIXTURE_FINGERPRINT = {
  ESL: '2b8d5ad23a7538b0e382e9b89a48d37f29659611dfbc56c720ebf623913cc51a',
  FSL: '59deb47275d204786ffe949e9f1f42240d88f561f26a33df2055e818f4ef323f',
};
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// ---------------------------------------------------------------------------------------------
// Sandboxes and PHP calls

const sandboxes = [];
// A fresh temp folder: <base>/dataset (SK_DATASET_ROOT), <base>/models (SK_MODELS_DIR, NOT created:
// compile_model.php must create it), <base>/config (SK_CONFIG_DIR).
function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-cm-php-'));
  sandboxes.push(base);
  const sb = {
    base,
    dataset: path.join(base, 'dataset'),
    models: path.join(base, 'models'),
    config: path.join(base, 'config'),
  };
  fs.mkdirSync(sb.dataset);
  fs.mkdirSync(sb.config);
  return sb;
}
test.after(() => {
  for (const b of sandboxes) fs.rmSync(b, { recursive: true, force: true });
});

const sbEnv = (sb) => ({ SK_MODELS_DIR: sb.models, SK_DATASET_ROOT: sb.dataset, SK_CONFIG_DIR: sb.config });

function callPhp(script, sb, { method = 'GET', body = null, query = '' } = {}) {
  const payload = body === null ? Buffer.alloc(0) : Buffer.from(body);
  const env = {
    ...process.env,
    REDIRECT_STATUS: '1',
    GATEWAY_INTERFACE: 'CGI/1.1',
    REQUEST_METHOD: method,
    SCRIPT_FILENAME: path.join(API_DIR, script),
    SCRIPT_NAME: '/SKR/php/api/' + script,
    QUERY_STRING: query,
    CONTENT_TYPE: 'application/octet-stream',
    CONTENT_LENGTH: String(payload.length),
    ...sbEnv(sb),
  };
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  const head = cut >= 0 ? out.slice(0, cut) : '';
  const text = cut >= 0 ? out.slice(cut + 4) : out;
  const m = /^Status:\s*(\d+)/im.exec(head);
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 or broken output */ }
  return { status: m ? Number(m[1]) : 200, head, text, json };
}
const status = (sb) => {
  const r = callPhp('model_status.php', sb);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json && r.json.success, r.text);
  return r.json;
};
const compile = (sb, lang, bytes, method = 'POST') =>
  callPhp('compile_model.php', sb, { method, body: bytes, query: lang === null ? '' : 'lang=' + lang });

// knn_fingerprint_lines($lang) through the PHP CLI, against the sandbox's dataset.
function phpLines(sb, lang) {
  const code = `require '${LIB}'; echo json_encode(knn_fingerprint_lines('${lang}'));`;
  const r = spawnSync(PHP_CLI, ['-r', code], { env: { ...process.env, ...sbEnv(sb) } });
  assert.equal(r.status, 0, r.stderr.toString());
  return JSON.parse(r.stdout.toString('utf8'));
}

// ---------------------------------------------------------------------------------------------
// Datasets

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

// The frozen fixture listing on disk: saved_gestures/<label>/sign.json for every sign (as
// write_sign_json writes it) and every sample at its listed `file` path (frames left out: the walk
// never reads sample files when sign.json is valid).
function writeFixtureDataset(sb) {
  for (const [label, sign] of Object.entries(listing.signs)) {
    writeJson(path.join(sb.dataset, 'saved_gestures', label, 'sign.json'), {
      key: label, set: sign.set, textEn: sign.textEn, textFil: sign.textFil, updatedAt: '2026-10-15T00:00:00+00:00',
    });
  }
  for (const [label, samples] of Object.entries(listing.gestures)) {
    for (const s of samples) {
      writeJson(path.join(sb.dataset, ...s.file.split('/')), { label, signLanguage: s.signLanguage });
    }
  }
}

// A small hand-made dataset. entries: { folder?, label, set, signJson? (default true), samples (n) }.
// Returns the listing save_gesture.php's GET would give for it (signs[label].set = the set of the
// first folder that has the label, gestures[label] = every sample, in folder order).
function writeSmallDataset(sb, entries) {
  const out = { gestures: {}, signs: {} };
  const order = { saved_gestures: 0, saved_gestures_fsl: 1 };
  const sorted = [...entries].sort((a, b) => order[a.folder || 'saved_gestures'] - order[b.folder || 'saved_gestures']);
  for (const e of sorted) {
    const folder = e.folder || 'saved_gestures';
    const dir = path.join(sb.dataset, folder, e.label);
    fs.mkdirSync(dir, { recursive: true });
    if (e.signJson !== false) {
      writeJson(path.join(dir, 'sign.json'), { key: e.label, set: e.set, textEn: e.label, textFil: e.label });
    }
    if (!out.signs[e.label]) out.signs[e.label] = { set: e.set, textEn: e.label, textFil: e.label };
    out.gestures[e.label] = out.gestures[e.label] || [];
    for (let i = 0; i < (e.samples || 0); i++) {
      const name = 'sample_' + String(1700000000000 + i) + '_' + e.label.slice(0, 6).padEnd(6, 'x') + '.json';
      writeJson(path.join(dir, name), { label: e.label, signLanguage: e.set === 'FSL' ? 'FSL' : 'ESL' });
      out.gestures[e.label].push({ file: folder + '/' + e.label + '/' + name, signLanguage: e.set === 'FSL' ? 'FSL' : 'ESL' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Model files

async function fixtureModel(lang, src = listing) {
  const b = K.buildModel({
    gestures: src.gestures, signs: src.signs, categories: src.categories, lang, toRows, buildDate: BUILD_DATE,
  });
  b.header.fingerprint = await K.sha256Hex(b.fingerprintText);
  return Buffer.from(K.encode(b.header, b.model));
}

// A model file written byte by byte from the plan's layout, with NO header checks (for refusals).
function rawFile(header, { rows = header.rowCount, version = 1, dtype = 1, headerText = null, hl = null } = {}) {
  const hb = Buffer.from(headerText !== null ? headerText : JSON.stringify(header), 'utf8');
  const start = Math.ceil((12 + hb.length) / 4) * 4;
  const buf = Buffer.alloc(start + rows * 126 * 4);
  buf.write('SKKN', 0, 'ascii');
  buf.writeUInt16LE(version, 4);
  buf.writeUInt16LE(dtype, 6);
  buf.writeUInt32LE(hl !== null ? hl : hb.length, 8);
  hb.copy(buf, 12);
  for (let i = start; i < buf.length; i += 4) buf.writeFloatLE(((i / 4) % 97) / 97, i);
  return buf;
}

function smallHeader(lang = 'ESL', extra = {}) {
  return {
    formatVersion: 1, lang, buildDate: BUILD_DATE, builtOn: 'laptop', rule: { ...K.DEFAULT_RULE }, dims: 126,
    dtype: 'f32', fingerprint: sha256(''), sampleCount: 2, rowCount: 3,
    labels: [
      { key: 'a', set: lang, category: null, textEn: 'A', textFil: null, samples: 1, rows: 2 },
      { key: 'b', set: 'BOTH', category: 'word', textEn: 'B', textFil: 'B', samples: 1, rows: 1 },
    ],
    ...extra,
  };
}

const modelFiles = (sb) => (fs.existsSync(sb.models) ? fs.readdirSync(sb.models).sort() : []);

// ---------------------------------------------------------------------------------------------
// Fingerprint parity

test('fingerprint parity: PHP fingerprintNow on the fixture dataset = pinned hex = KnnCompile', async () => {
  const sb = sandbox();
  writeFixtureDataset(sb);
  const st = status(sb);
  for (const lang of ['ESL', 'FSL']) {
    const jsText = K.fingerprintText(listing.gestures, listing.signs, lang);
    const jsHex = await K.sha256Hex(jsText);
    assert.equal(jsHex, FIXTURE_FINGERPRINT[lang], 'JS ' + lang);
    assert.equal(st.models[lang].fingerprintNow, FIXTURE_FINGERPRINT[lang], 'PHP ' + lang);
    const lines = phpLines(sb, lang);
    assert.deepEqual(lines, jsText.split('\n'), 'PHP lines = JS lines, ' + lang);
    // sort($lines, SORT_STRING) is the JS default sort on these lines.
    assert.deepEqual(lines, [...lines].sort(), 'PHP order = JS sort order, ' + lang);
    assert.equal(lines.length, lang === 'ESL' ? 127 : 91);
  }
});

// ---------------------------------------------------------------------------------------------
// Edge datasets

test('edge: no saved_gestures folder at all -> empty fingerprint, both models', () => {
  const sb = sandbox();
  for (const lang of ['ESL', 'FSL']) assert.deepEqual(phpLines(sb, lang), []);
  const st = status(sb);
  assert.equal(st.models.ESL.fingerprintNow, sha256(''));
  assert.equal(st.models.FSL.fingerprintNow, sha256(''));
});

test('edge: sign.json without samples, 25 samples, both folders, FSL-only, start in both', async () => {
  const sb = sandbox();
  const L = writeSmallDataset(sb, [
    { label: 'empty_sign', set: 'BOTH', samples: 0 },
    { label: 'many', set: 'ESL', samples: 25 },
    { label: 'dual', set: 'BOTH', samples: 2 },
    // saved_gestures_fsl copy: no sign.json (would derive FSL), but saved_gestures comes first.
    { folder: 'saved_gestures_fsl', label: 'dual', set: 'FSL', signJson: false, samples: 1 },
    { label: 'fsl_only', set: 'FSL', samples: 2 },
    { label: 'start', set: 'ESL', samples: 1 },
    { label: 'stop', set: 'FSL', samples: 1 },
  ]);
  const esl = phpLines(sb, 'ESL');
  const fsl = phpLines(sb, 'FSL');

  assert.equal(esl.filter((l) => l.startsWith('many|ESL|')).length, 25);
  assert.equal(esl.filter((l) => l.startsWith('empty_sign|')).length, 0);
  assert.deepEqual(esl.filter((l) => l.startsWith('dual|')), [
    'dual|BOTH|saved_gestures/dual/sample_1700000000000_dualxx.json',
    'dual|BOTH|saved_gestures/dual/sample_1700000000001_dualxx.json',
    'dual|BOTH|saved_gestures_fsl/dual/sample_1700000000000_dualxx.json',
  ]);
  assert.deepEqual(fsl.filter((l) => l.startsWith('dual|')), esl.filter((l) => l.startsWith('dual|')));
  assert.equal(esl.filter((l) => l.startsWith('fsl_only|')).length, 0);
  assert.equal(fsl.filter((l) => l.startsWith('fsl_only|FSL|')).length, 2);
  assert.deepEqual(esl.filter((l) => /^(start|stop)\|/.test(l)), [
    'start|ESL|saved_gestures/start/sample_1700000000000_startx.json',
    'stop|FSL|saved_gestures/stop/sample_1700000000000_stopxx.json',
  ]);
  assert.deepEqual(fsl.filter((l) => /^(start|stop)\|/.test(l)), esl.filter((l) => /^(start|stop)\|/.test(l)));
  assert.equal(fsl.filter((l) => l.startsWith('many|')).length, 0);
  assert.equal(esl.length, 25 + 3 + 2);
  assert.equal(fsl.length, 3 + 2 + 2);

  // Same text as KnnCompile on the listing save_gesture.php would give for this disk.
  const st = status(sb);
  for (const [lang, lines] of [['ESL', esl], ['FSL', fsl]]) {
    const jsText = K.fingerprintText(L.gestures, L.signs, lang);
    assert.equal(lines.join('\n'), jsText, lang);
    assert.equal(st.models[lang].fingerprintNow, await K.sha256Hex(jsText), lang);
  }
});

test('edge: a saved_gestures_fsl-only label without sign.json takes derive_sign\'s set', () => {
  const sb = sandbox();
  writeSmallDataset(sb, [
    { folder: 'saved_gestures_fsl', label: 'legacy_fsl', set: 'FSL', signJson: false, samples: 1 },
    { folder: 'saved_gestures', label: 'legacy_esl', set: 'ESL', signJson: false, samples: 1 },
  ]);
  assert.deepEqual(phpLines(sb, 'FSL'), ['legacy_fsl|FSL|saved_gestures_fsl/legacy_fsl/sample_1700000000000_legacy.json']);
  assert.deepEqual(phpLines(sb, 'ESL'), ['legacy_esl|ESL|saved_gestures/legacy_esl/sample_1700000000000_legacy.json']);
});

test('edge: knn_sample_names gives exactly what glob(sample_*.json) gives (case, odd names, a [ in the path)', () => {
  const sb = sandbox();
  const names = ['SAMPLE_A.JSON', 'sample_b.JSON', 'Sample_c.json', 'sample_.json', 'sample_d.json.bak',
    'xsample_e.json', 'sample_f.json', 'sample_g h.json', 'sample_ñ.json', 'sample_i0123.json', 'sign.json'];
  const dirs = [path.join(sb.dataset, 'plain'), path.join(sb.dataset, 'odd[1]')];
  for (const d of dirs) {
    fs.mkdirSync(path.join(d, 'sample_dir.json'), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(d, n), '{}');
  }
  for (const d of dirs) {
    const p = d.replace(/\\/g, '/');
    const code = `require '${LIB}'; $g = array_map('basename', glob('${p}/sample_*.json') ?: []); ` +
      `echo json_encode([$g, knn_sample_names('${p}')]);`;
    const r = spawnSync(PHP_CLI, ['-r', code]);
    assert.equal(r.status, 0, r.stderr.toString());
    const [g, mine] = JSON.parse(r.stdout.toString('utf8'));
    if (d.endsWith('plain')) {
      assert.deepEqual([...g].sort(), ['sample_.json', 'sample_dir.json', 'sample_f.json', 'sample_g h.json',
        'sample_i0123.json', 'sample_ñ.json'].sort());
    }
    assert.deepEqual([...mine].sort(), [...g].sort(), p);
  }
});

// ---------------------------------------------------------------------------------------------
// compile_model.php

test('compile_model: fixture ESL and FSL files are written byte-identical, tmp gone, fields right', async () => {
  const sb = sandbox();
  writeFixtureDataset(sb);
  for (const lang of ['ESL', 'FSL']) {
    const bytes = await fixtureModel(lang);
    const r = compile(sb, lang, bytes);
    assert.equal(r.status, 200, r.text);
    const j = r.json;
    assert.equal(j.success, true);
    assert.equal(j.lang, lang);
    assert.equal(j.bytes, bytes.length);
    assert.equal(j.bytes, lang === 'ESL' ? 1045196 : 723096);
    assert.equal(j.rowCount, lang === 'ESL' ? 2047 : 1414);
    assert.equal(j.labels, lang === 'ESL' ? 122 : 90);
    assert.equal(j.sampleCount, lang === 'ESL' ? 127 : 91);
    assert.equal(j.buildDate, BUILD_DATE);
    assert.equal(j.fingerprint, FIXTURE_FINGERPRINT[lang]);
    assert.equal(j.fingerprintNow, FIXTURE_FINGERPRINT[lang]);
    assert.equal(j.upToDate, true);
    assert.equal(typeof j.mtime, 'number');
    const onDisk = fs.readFileSync(path.join(sb.models, `knn_${lang}.bin`));
    assert.equal(Buffer.compare(onDisk, bytes), 0, 'byte-identical ' + lang);
    // The stored file decodes with the browser decoder.
    assert.equal(K.decode(onDisk).header.rowCount, j.rowCount);
  }
  assert.deepEqual(modelFiles(sb), ['knn_ESL.bin', 'knn_FSL.bin']);
  // K.encode and the plan's byte layout agree (rawFile writes the layout independently).
  const small = smallHeader();
  const dec = K.decode(rawFile(small));
  assert.equal(Buffer.compare(Buffer.from(K.encode(dec.header, dec.model)), rawFile(small)), 0);
});

test('compile_model: upToDate false when the dataset differs from the listing the file was built from', async () => {
  const sb = sandbox();
  writeSmallDataset(sb, [{ label: 'one', set: 'ESL', samples: 1 }]);
  const r = compile(sb, 'ESL', await fixtureModel('ESL'));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.upToDate, false);
  assert.notEqual(r.json.fingerprintNow, r.json.fingerprint);
});

test('compile_model: an empty-dataset file (0 labels, 0 rows) is accepted', async () => {
  const sb = sandbox();
  const empty = { gestures: {}, signs: {}, categories: {} };
  for (const lang of ['ESL', 'FSL']) {
    const bytes = await fixtureModel(lang, empty);
    const r = compile(sb, lang, bytes);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.rowCount, 0);
    assert.equal(r.json.labels, 0);
    assert.equal(r.json.upToDate, true); // empty dataset dir, empty fingerprint on both sides
    assert.equal(Buffer.compare(fs.readFileSync(path.join(sb.models, `knn_${lang}.bin`)), bytes), 0);
  }
  const st = status(sb);
  assert.equal(st.models.ESL.stale, false);
  assert.equal(st.models.ESL.header.labelCount, 0);
});

test('compile_model: every refusal answers 400 and writes nothing', () => {
  const sb = sandbox();
  const good = rawFile(smallHeader());
  assert.equal(K.decode(good).header.rowCount, 3); // the base file is valid
  const flip = (fn) => { const b = Buffer.from(good); fn(b); return b; };
  const cases = {
    'bad magic': [flip((b) => b.write('XKKN', 0, 'ascii')), /bad magic/],
    'version 2': [rawFile(smallHeader(), { version: 2 }), /format version 2/],
    'dtype 2': [rawFile(smallHeader(), { dtype: 2 }), /dtype 2/],
    'lang mismatch': [rawFile(smallHeader('FSL')), /lang is FSL, expected ESL/],
    'truncated body': [good.subarray(0, good.length - 4), /body is/],
    'extra bytes': [Buffer.concat([good, Buffer.alloc(4)]), /body is/],
    'only 8 bytes': [good.subarray(0, 8), /too short/],
    'header length 1': [rawFile(smallHeader(), { hl: 1 }), /out of range/],
    'header too long (4,194,305)': [rawFile(smallHeader(), { hl: 4194305 }), /out of range/],
    'header past the end': [rawFile(smallHeader(), { hl: 4000000 }), /past the end/],
    'header not JSON': [rawFile(null, { rows: 0, headerText: '{"dims":126,' }), /not valid JSON/],
    'header is an array': [rawFile(null, { rows: 0, headerText: '[1,2]' }), /not a JSON object/],
    'header invalid UTF-8': [rawFile(null, { rows: 0, headerText: '{"a":"\uFFFD"}' }).fill(0xff, 18, 19), /not valid JSON/],
    'dims 125': [rawFile(smallHeader('ESL', { dims: 125 })), /dims must be 126/],
    'lang XSL': [rawFile(smallHeader('ESL', { lang: 'XSL' })), /lang must be ESL or FSL/],
    'labels not an array': [rawFile(smallHeader('ESL', { labels: {}, rowCount: 0 }), { rows: 0 }), /labels is not an array/],
    'rows sum mismatch': [rawFile(smallHeader('ESL', { rowCount: 4 })), /add up to 3, rowCount is 4/],
    'rowCount -1': [rawFile(smallHeader('ESL', { rowCount: -1 }), { rows: 0 }), /rowCount is not/],
    'duplicate key': [rawFile(smallHeader('ESL', { labels: [{ key: 'a', rows: 2 }, { key: 'a', rows: 1 }] })), /duplicate label "a"/],
    'empty key': [rawFile(smallHeader('ESL', { labels: [{ key: '', rows: 3 }] })), /label 0 has no key/],
    'key not a string': [rawFile(smallHeader('ESL', { labels: [{ key: 5, rows: 3 }] })), /label 0 has no key/],
    'key __proto__': [rawFile(smallHeader('ESL', { labels: [{ key: '__proto__', rows: 3 }] })), /__proto__/],
    'rows -1': [rawFile(smallHeader('ESL', { labels: [{ key: 'a', rows: -1 }, { key: 'b', rows: 4 }] })), /rows is not/],
    'rows 1.5': [rawFile(smallHeader('ESL', { labels: [{ key: 'a', rows: 1.5 }, { key: 'b', rows: 1.5 }] })), /rows is not/],
    'rows "3"': [rawFile(smallHeader('ESL', { labels: [{ key: 'a', rows: '3' }] })), /rows is not/],
  };
  for (const [name, [bytes, re]] of Object.entries(cases)) {
    // The JS decoder refuses the same file (lang mismatch is the endpoint's own check).
    if (name !== 'lang mismatch') assert.throws(() => K.decode(bytes), /knn model file/, 'JS refuses: ' + name);
    const r = compile(sb, 'ESL', bytes);
    assert.equal(r.status, 400, name + ': ' + r.text);
    assert.equal(r.json.success, false, name);
    assert.match(r.json.error, re, name);
    assert.deepEqual(modelFiles(sb), [], name + ': nothing written');
  }
});

test('compile_model: a refused upload leaves the previous good file untouched', async () => {
  const sb = sandbox();
  const good = rawFile(smallHeader());
  assert.equal(compile(sb, 'ESL', good).status, 200);
  const r = compile(sb, 'ESL', good.subarray(0, good.length - 4));
  assert.equal(r.status, 400);
  assert.deepEqual(modelFiles(sb), ['knn_ESL.bin']);
  assert.equal(Buffer.compare(fs.readFileSync(path.join(sb.models, 'knn_ESL.bin')), good), 0);
  // A second good upload replaces it (rename over an existing file).
  const good2 = rawFile(smallHeader('ESL', { buildDate: '2026-10-16T00:00:00.000Z' }));
  assert.equal(compile(sb, 'ESL', good2).status, 200);
  assert.equal(Buffer.compare(fs.readFileSync(path.join(sb.models, 'knn_ESL.bin')), good2), 0);
  assert.deepEqual(modelFiles(sb), ['knn_ESL.bin']);
});

test('compile_model: method, lang, empty body, size and Pi refusals', () => {
  const sb = sandbox();
  const good = rawFile(smallHeader());
  assert.equal(compile(sb, 'ESL', good, 'OPTIONS').status, 204);
  for (const m of ['GET', 'PUT', 'DELETE']) {
    const r = compile(sb, 'ESL', good, m);
    assert.equal(r.status, 405, m);
    assert.deepEqual(r.json, { success: false, error: 'POST only' });
  }
  for (const lang of [null, 'esl', 'BOTH', '']) {
    const r = compile(sb, lang, good);
    assert.equal(r.status, 400, String(lang));
    assert.equal(r.json.error, 'lang must be ESL or FSL');
  }
  const empty = compile(sb, 'ESL', Buffer.alloc(0));
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /Empty body/);
  const big = compile(sb, 'ESL', Buffer.alloc(33554432 + 1));
  assert.equal(big.status, 413, big.text.slice(0, 300));
  assert.equal(big.json.success, false);
  assert.match(big.head, /Content-Type: application\/json/i);
  assert.deepEqual(modelFiles(sb), []);

  fs.writeFileSync(path.join(sb.config, 'device.txt'), 'pi\n');
  const pi = compile(sb, 'ESL', good);
  assert.equal(pi.status, 403);
  assert.deepEqual(pi.json, { success: false, error: PI_WARNING });
  assert.equal(fs.existsSync(sb.models), false, 'Pi: models dir not even created');
});

// ---------------------------------------------------------------------------------------------
// model_status.php

test('model_status: missing -> fresh -> stale after a new sample -> fresh -> stale after a set change', async () => {
  const sb = sandbox();
  writeFixtureDataset(sb);
  let st = status(sb);
  assert.equal(st.device, 'laptop');
  assert.equal(st.formatVersion, 1);
  for (const lang of ['ESL', 'FSL']) {
    assert.deepEqual(st.models[lang], {
      exists: false, bytes: null, mtime: null, header: null, error: null,
      fingerprintNow: FIXTURE_FINGERPRINT[lang], stale: true, staleReason: 'missing',
    });
  }

  for (const lang of ['ESL', 'FSL']) assert.equal(compile(sb, lang, await fixtureModel(lang)).status, 200);
  st = status(sb);
  for (const lang of ['ESL', 'FSL']) {
    const m = st.models[lang];
    assert.equal(m.exists, true);
    assert.equal(m.bytes, lang === 'ESL' ? 1045196 : 723096);
    assert.equal(m.mtime, Math.floor(fs.statSync(path.join(sb.models, `knn_${lang}.bin`)).mtimeMs / 1000));
    assert.deepEqual(m.header, {
      formatVersion: 1, buildDate: BUILD_DATE, builtOn: 'laptop', rule: { ...K.DEFAULT_RULE },
      rowCount: lang === 'ESL' ? 2047 : 1414, sampleCount: lang === 'ESL' ? 127 : 91,
      labelCount: lang === 'ESL' ? 122 : 90, fingerprint: FIXTURE_FINGERPRINT[lang],
    });
    assert.equal(m.error, null);
    assert.equal(m.stale, false, lang);
    assert.equal(m.staleReason, null);
  }

  // A BOTH sign gets one more sample: both models out of date.
  const both = Object.keys(listing.signs).find((k) => listing.signs[k].set === 'BOTH');
  const extra = path.join(sb.dataset, 'saved_gestures', both, 'sample_1799999999999_abcdef.json');
  writeJson(extra, {});
  st = status(sb);
  assert.deepEqual([st.models.ESL.staleReason, st.models.FSL.staleReason], ['data', 'data']);
  assert.equal(st.models.ESL.stale, true);
  fs.rmSync(extra);
  st = status(sb);
  assert.deepEqual([st.models.ESL.stale, st.models.FSL.stale], [false, false]);

  // An ESL sign becomes BOTH: its ESL lines change (set text) and it joins the FSL model.
  const esl = Object.keys(listing.signs).find((k) => listing.signs[k].set === 'ESL' && k !== 'start' && k !== 'stop');
  const signFile = path.join(sb.dataset, 'saved_gestures', esl, 'sign.json');
  writeJson(signFile, { ...JSON.parse(fs.readFileSync(signFile, 'utf8')), set: 'BOTH' });
  st = status(sb);
  assert.deepEqual([st.models.ESL.staleReason, st.models.FSL.staleReason], ['data', 'data']);
  // Texts are not part of the fingerprint.
  writeJson(signFile, { ...JSON.parse(fs.readFileSync(signFile, 'utf8')), set: 'ESL', textEn: 'Changed' });
  st = status(sb);
  assert.deepEqual([st.models.ESL.stale, st.models.FSL.stale], [false, false]);
});

test('model_status: format (header formatVersion, rule name/version, binary version) and unreadable', () => {
  const sb = sandbox();
  fs.mkdirSync(sb.models);
  const put = (lang, bytes) => fs.writeFileSync(path.join(sb.models, `knn_${lang}.bin`), bytes);
  const check = (bytes, reason, hasHeader, errRe) => {
    put('ESL', bytes);
    const m = status(sb).models.ESL;
    assert.equal(m.exists, true);
    assert.equal(m.stale, reason !== null);
    assert.equal(m.staleReason, reason);
    assert.equal(m.header !== null, hasHeader);
    if (errRe) assert.match(m.error, errRe); else assert.equal(m.error, null);
  };
  check(rawFile(smallHeader('ESL', { formatVersion: 2 })), 'format', true);
  check(rawFile(smallHeader('ESL', { rule: { ...K.DEFAULT_RULE, name: 'all-rows' } })), 'format', true);
  check(rawFile(smallHeader('ESL', { rule: { ...K.DEFAULT_RULE, version: 2 } })), 'format', true);
  check(rawFile(smallHeader('ESL', { rule: undefined })), 'format', true);
  check(rawFile(smallHeader(), { version: 2 }), 'format', false, /format version 2/);
  check(rawFile(smallHeader(), { dtype: 2 }), 'format', false, /dtype 2/);
  check(Buffer.from('hello, not a model'), 'unreadable', false, /bad magic/);
  check(Buffer.alloc(0), 'unreadable', false, /too short/);
  const good = rawFile(smallHeader());
  check(good.subarray(0, good.length - 4), 'unreadable', false, /body is/);
  check(rawFile(smallHeader('ESL', { rowCount: 9 })), 'unreadable', false, /add up to/);
  check(rawFile(null, { rows: 0, headerText: 'nope' }), 'unreadable', false, /not valid JSON/);
  // A valid small file against an empty dataset: fingerprint of '' matches -> fresh.
  check(good, null, true);
  assert.equal(status(sb).models.FSL.staleReason, 'missing');
});

test('model_status: device override (pi, laptop, junk) and the Pi never reports stale', () => {
  const sb = sandbox();
  const dev = path.join(sb.config, 'device.txt');
  const unamePi = (m) => /^(aarch64|arm)/i.test(m);

  let st = status(sb);
  assert.equal(st.deviceSource, 'uname');
  assert.equal(typeof st.machine, 'string');
  assert.equal(st.device, unamePi(st.machine) ? 'pi' : 'laptop');
  assert.equal(st.device, 'laptop', 'this laptop (php_uname m = ' + st.machine + ')');

  fs.writeFileSync(dev, '  PI \r\n');
  st = status(sb);
  assert.deepEqual([st.device, st.deviceSource], ['pi', 'override']);
  for (const lang of ['ESL', 'FSL']) {
    assert.equal(st.models[lang].exists, false);
    assert.equal(st.models[lang].stale, false);
    assert.equal(st.models[lang].staleReason, null);
    assert.equal(st.models[lang].fingerprintNow, sha256(''));
  }
  // Pi with an unreadable file: still not stale, the error is still reported.
  fs.mkdirSync(sb.models);
  fs.writeFileSync(path.join(sb.models, 'knn_ESL.bin'), 'junk');
  st = status(sb);
  assert.equal(st.models.ESL.stale, false);
  assert.equal(st.models.ESL.staleReason, null);
  assert.match(st.models.ESL.error, /too short|bad magic/);

  fs.writeFileSync(dev, 'laptop');
  st = status(sb);
  assert.deepEqual([st.device, st.deviceSource], ['laptop', 'override']);
  assert.equal(st.models.ESL.staleReason, 'unreadable');

  for (const junk of ['raspberry', '', 'pi laptop', 'pi\nlaptop']) {
    fs.writeFileSync(dev, junk);
    st = status(sb);
    assert.equal(st.deviceSource, 'uname', JSON.stringify(junk));
    assert.equal(st.device, 'laptop', JSON.stringify(junk));
  }
});

test('model_status: GET only', () => {
  const sb = sandbox();
  assert.equal(callPhp('model_status.php', sb, { method: 'OPTIONS' }).status, 204);
  const r = callPhp('model_status.php', sb, { method: 'POST', body: 'x' });
  assert.equal(r.status, 405);
  assert.deepEqual(r.json, { success: false, error: 'GET only' });
});

// ---------------------------------------------------------------------------------------------
// Speed: a synthetic dataset of 122 signs x 25 samples (empty {} sample files, the walk never reads
// them). Timed in-process (PHP CLI, the endpoint's own work) and as a whole php-cgi request.

test('model_status: speed on 122 signs x 25 samples', async () => {
  const sb = sandbox();
  for (let s = 0; s < 122; s++) {
    const label = 'sign_' + String(s).padStart(3, '0');
    const set = s % 4 === 0 ? 'ESL' : s % 4 === 1 ? 'FSL' : 'BOTH';
    const dir = path.join(sb.dataset, 'saved_gestures', label);
    writeJson(path.join(dir, 'sign.json'), { key: label, set, textEn: label, textFil: label });
    for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(dir, `sample_i${crypto.randomBytes(16).toString('hex')}.json`), '{}');
  }
  for (const lang of ['ESL', 'FSL']) assert.equal(compile(sb, lang, rawFile(smallHeader(lang))).status, 200);

  const script = path.join(API_DIR, 'model_status.php').replace(/\\/g, '/');
  const code = `$_SERVER['REQUEST_METHOD'] = 'GET'; $t = hrtime(true); ob_start(); include '${script}'; ` +
    `$out = ob_get_clean(); fwrite(STDERR, (string)((hrtime(true) - $t) / 1e6)); echo $out;`;
  const inProc = [];
  for (let i = 0; i < 7; i++) {
    const r = spawnSync(PHP_CLI, ['-r', code], { env: { ...process.env, ...sbEnv(sb) } });
    assert.equal(r.status, 0, r.stderr.toString());
    const j = JSON.parse(r.stdout.toString('utf8'));
    assert.equal(j.models.ESL.staleReason, 'data');
    inProc.push(Number(r.stderr.toString()));
  }
  const whole = [];
  for (let i = 0; i < 7; i++) {
    const t = performance.now();
    status(sb);
    whole.push(performance.now() - t);
  }
  const lines = phpLines(sb, 'ESL').length + phpLines(sb, 'FSL').length;
  assert.equal(lines, 2 * (31 + 60) * 25); // ESL: 31 ESL + 60 BOTH signs; FSL: 31 FSL + 60 BOTH
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(`model_status 122x25 synthetic: in-process median ${med(inProc).toFixed(1)} ms ` +
    `(min ${Math.min(...inProc).toFixed(1)}, max ${Math.max(...inProc).toFixed(1)}); ` +
    `whole php-cgi request median ${med(whole).toFixed(1)} ms`);
  assert.ok(med(inProc) < 1000, 'in-process median under 1 s');
});
