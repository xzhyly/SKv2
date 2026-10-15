// Tests for tests/compact-model/accuracy.mjs (compact-model phase, Task 2): the fixture run
// reproduces the Step 1 numbers exactly (fixtures/expected-2026-10-15.json, both rules), LOSO on
// a synthetic multi-signer listing, and the "any dataset" edges (0 signs, a model with 1 label,
// a sign with 25 samples).
//
// Run: node --test --test-concurrency=1 "tests/compact-model/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadFixtureListing, loadFixtureVideos, loadExpected, loadToRows } from './fixtures.mjs';
import { runAccuracy, formatReport, parseArgs, finishSet, readSignerFromDisk } from './accuracy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'accuracy.mjs');
const listing = loadFixtureListing();
const videos = loadFixtureVideos();
const expected = loadExpected();
const toRows = loadToRows();

const clone = (x) => JSON.parse(JSON.stringify(x));
const counts = (s) => ({ n: s.n, voteOk: s.voteOk, frames: s.frames, frameOk: s.frameOk });
const byCat = (bc) => Object.fromEntries(Object.keys(bc).sort().map((k) => [k, counts(bc[k])]));

// A v2 frame (flat 126 numbers) as a v3 frame { t, hands }: hand 1 = values 0..62, hand 2 =
// 63..125 when not all zero.
function v2FrameToV3(row, t) {
  const hand = (vals, label) => ({
    label,
    score: 1,
    landmarks: Array.from({ length: 21 }, (_, i) => ({ x: vals[3 * i], y: vals[3 * i + 1], z: vals[3 * i + 2] })),
  });
  const hands = [hand(row.slice(0, 63), 'Right')];
  if (row.slice(63).some((v) => v !== 0)) hands.push(hand(row.slice(63), 'Left'));
  return { t, hands };
}
function asV3(sample, signer, tag) {
  const isV3 = sample.frames.some((f) => Array.isArray(f && f.hands));
  const frames = isV3 ? clone(sample.frames) : sample.frames.map((f, i) => v2FrameToV3(f, i * 66));
  const out = { ...clone(sample), frames, frameCount: frames.length, file: sample.file.replace('.json', `_${tag}.json`) };
  if (signer) out.signer = signer;
  return out;
}
const sign = (set) => ({ set, textEn: null, textFil: null });

test('fixture run reproduces expected-2026-10-15.json exactly (current and budget)', { timeout: 30 * 60 * 1000 }, async () => {
  // reuse: false -> the budget models are predicted on their own, not copied from the current
  // rule's predictions when the rows are identical (the CLI default).
  const res = await runAccuracy({ listing, videos, source: 'fixture', reuse: false });
  for (const name of ['T1 ESL', 'T2', 'T2 FSL', 'T2r']) assert.equal(res.sets[name].reused, undefined);
  console.log(formatReport(res).split('\n').filter((l) => l.startsWith('Timings')).join('\n'));
  const map = { t1: 'T1 ESL', t2: 'T2', t2fsl: 'T2 FSL', t2r: 'T2r' };
  for (const [rule, exp] of [['current', expected.current], ['budget', expected.budget90]]) {
    assert.equal(res.models.ESL[rule].rows, exp.rowsESL, `${rule} rows ESL`);
    assert.equal(res.models.FSL[rule].rows, exp.rowsFSL, `${rule} rows FSL`);
    assert.equal(res.sets.T2r.rowsVid[rule], exp.rowsVid, `${rule} rows from videos (T2r)`);
    for (const [k, name] of Object.entries(map)) {
      const got = res.sets[name].results[rule];
      assert.deepEqual(counts(got), counts(exp[k]), `${rule} ${name} counts`);
      assert.deepEqual(byCat(got.byCat), byCat(exp[k].byCat), `${rule} ${name} per category`);
      assert.equal(got.missing.queries, 0, `${rule} ${name}: no sign missing`);
      assert.equal(got.noRows, 0, `${rule} ${name}: no empty query`);
    }
    const t3 = res.sets['T3 ESL'].results[rule];
    assert.deepEqual(t3, exp.t3, `${rule} T3 top-3 per repetition`);
    assert.deepEqual(t3.map((r) => r.top[0][0]), ['n', 'n', 'n'], `${rule} T3 top-1 labels`);
  }
  assert.equal(res.sets['T3 ESL'].segmentation.ok, true);
  assert.equal(res.sets['T3 ESL'].segmentation.reps.length, 3);
  // Today's data: the budget never bites, so the 2-point rule holds with a 0.0 difference.
  for (const name of Object.values(map)) assert.equal(res.sets[name].voteDelta, 0, `${name} vote delta`);
  for (const name of ['T2', 'T2 FSL', 'T2r']) assert.equal(res.sets[name].twoPointRule, 'ok');
  assert.match(res.sets['T1 ESL'].twoPointRule, /^n\/a/);
  // The fixture has no signer field anywhere: LOSO is skipped with a clear note, not run.
  assert.equal(res.sets['LOSO ESL'].skipped, true);
  assert.match(res.sets['LOSO ESL'].note, /0 signers/);
});

test('LOSO on a synthetic 3-signer listing: per-signer queries, a sign missing from the model', async () => {
  const g = listing.gestures;
  const syn = { success: true, datasetRoot: 'saved_gestures', gestures: {}, signs: {}, categories: { ESL: {}, FSL: {} } };
  const add = (label, samples) => {
    syn.gestures[label] = samples;
    syn.signs[label] = sign('ESL');
    syn.categories.ESL[label] = listing.categories.ESL[label];
  };
  // hi / yow: the fixture's 6 v3 samples, one per signer.
  add('hi', g.hi.map((s, i) => asV3(s, ['P01', 'P02', 'P03'][i], 'h' + i)));
  add('yow', g.yow.map((s, i) => asV3(s, ['P01', 'P02', 'P03'][i], 'y' + i)));
  // a / b / c: v2 samples converted to v3 frames. c is signed only by P03.
  add('a', [asV3(g.a[0], 'P01', 'p1'), asV3(g.a[0], 'P02', 'p2')]);
  add('b', [asV3(g.b[0], 'P01', 'p1'), asV3(g.b[0], 'P03', 'p3')]);
  add('c', [asV3(g.c[0], 'P03', 'p3')]);
  // d: a v2 sample without a signer: in every model, never a query.
  add('d', [clone(g.d[0])]);

  const logs = [];
  const res = await runAccuracy({ listing: syn, videos: null, sets: ['LOSO'], progressMs: 0, log: (l) => logs.push(l) });
  const report = formatReport(res);
  assert.deepEqual(res.dataset.signers, ['P01', 'P02', 'P03']);
  const s = res.sets['LOSO ESL'];
  assert.ok(!s.skipped, s.note);
  assert.deepEqual(s.signers, ['P01', 'P02', 'P03']);
  assert.equal(s.unsignedSamples, 1);
  for (const rule of ['current', 'budget']) {
    assert.equal(s.groups.P01[rule].n, 4, `${rule} P01 queries`);
    assert.equal(s.groups.P02[rule].n, 3, `${rule} P02 queries`);
    assert.equal(s.groups.P03[rule].n, 3, `${rule} P03 scored queries (c is missing)`);
    assert.equal(s.groups.P03[rule].missing.queries, 1);
    assert.deepEqual(s.groups.P03[rule].missing.labels, ['c']);
    assert.ok(s.groups.P03[rule].missing.frames > 0);
    assert.equal(s.groups.P01[rule].missing.queries, 0);
    assert.equal(s.results[rule].n, 10);
    assert.deepEqual(s.results[rule].missing, { queries: 1, frames: s.results[rule].missing.frames, labels: ['c'] });
    assert.ok(s.results[rule].missing.frames > 0);
    // no query of `d` (no signer) anywhere
    assert.ok(!Object.keys(s.results[rule].voteConf).some((k) => k.startsWith('d ->')));
  }
  assert.match(report, /sign missing from model: 1 query .*labels: c/);
  assert.match(report, /LOSO ESL per held-out signer/);
  assert.match(report, /P03 .*sign missing from model: 1 query \(c\)/);
  // Planned work before the set, progress with elapsed + ETA while predicting (progressMs 0 = after
  // every frame).
  assert.ok(logs.some((l) => /LOSO ESL: 3 job\(s\), 11 queries, \d+ query frames; model rows current \d+-\d+, budget \d+-\d+; [\d,]+ frame x row comparisons planned/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /LOSO ESL \[current\]: [\d.]+% of planned work, elapsed \d+ s, ETA \d+ s/.test(l)), logs.join('\n'));
  // FSL model is empty here: reported, not a crash.
  assert.equal(res.models.FSL.usable, false);
  assert.equal(res.sets['LOSO FSL'].skipped, true);
  assert.match(res.sets['LOSO FSL'].note, /not usable \(0 labels/);
});

test('0-sign listing and a sign folder with no samples: "no data", exit 0', async () => {
  const empty = { success: true, datasetRoot: 'saved_gestures', gestures: {}, signs: {}, categories: { ESL: {}, FSL: {} } };
  const r0 = await runAccuracy({ listing: empty, videos });
  assert.equal(r0.noData, true);
  assert.match(formatReport(r0), /no data/);
  const r1 = await runAccuracy({ listing: { ...empty, gestures: { x: [] }, signs: { x: sign('ESL') } }, videos });
  assert.equal(r1.noData, true);
  assert.match(formatReport(r1), /no data \(1 sign, 0 samples\)/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-acc-'));
  try {
    const file = path.join(tmp, 'empty.json');
    fs.writeFileSync(file, JSON.stringify(empty));
    const p = spawnSync(process.execPath, [SCRIPT, '--listing', file], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /no data/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a model with 1 label is "not usable"; the other language still runs', async () => {
  const g = listing.gestures;
  const L = { success: true, datasetRoot: 'saved_gestures', gestures: {}, signs: {}, categories: { ESL: {}, FSL: {} } };
  L.gestures.a = [clone(g.a[0])]; L.signs.a = sign('ESL'); L.categories.ESL.a = 'letter';
  L.gestures.b = [clone(g.b[0]), asV3(g.b[0], null, 'x')]; L.signs.b = sign('FSL'); L.categories.FSL.b = 'letter';
  L.gestures.c = [clone(g.c[0]), asV3(g.c[0], null, 'x')]; L.signs.c = sign('FSL'); L.categories.FSL.c = 'letter';
  const res = await runAccuracy({ listing: L, videos, sets: ['T1', 'T2', 'T2r', 'T3'] });
  const report = formatReport(res);
  assert.equal(res.models.ESL.usable, false);
  assert.equal(res.models.ESL.current.labels, 1);
  assert.match(report, /ESL model not usable \(1 label; needs at least 2\)/);
  for (const name of ['T1 ESL', 'T2', 'T2r', 'T3 ESL']) assert.equal(res.sets[name].skipped, true, name);
  assert.equal(res.models.FSL.usable, true);
  assert.equal(res.sets['T1 FSL'].results.current.n, 4); // b x2, c x2
  assert.equal(res.sets['T2 FSL'].results.current.n, 2); // the en videos of b and c
  assert.equal(res.sets['T3 FSL'].results.current.length, 3);
});

test('a sign with 25 samples: the budget bites (3 rows per sample), T1 runs, 1-sample signs are skipped', async () => {
  const g = listing.gestures;
  const L = { success: true, datasetRoot: 'saved_gestures', gestures: {}, signs: {}, categories: { ESL: {}, FSL: {} } };
  L.gestures.hi = Array.from({ length: 25 }, (_, i) => asV3(g.hi[i % 3], null, 'r' + i));
  L.gestures.a = [clone(g.a[0])];
  L.gestures.b = [clone(g.b[0])];
  for (const k of ['hi', 'a', 'b']) { L.signs[k] = sign('ESL'); L.categories.ESL[k] = k === 'hi' ? 'word' : 'letter'; }
  const res = await runAccuracy({ listing: L, videos: null, sets: ['T1'] });
  const n = (s) => toRows(s).length;
  const hiRows = L.gestures.hi.map(n);
  assert.ok(hiRows.reduce((x, y) => x + y, 0) > 90, 'the sign is over budget');
  const other = n(L.gestures.a[0]) + n(L.gestures.b[0]);
  assert.equal(res.models.ESL.current.rows, hiRows.reduce((x, y) => x + y, 0) + other);
  // floor(90 / 25) = 3 < minRowsPerSample 3 -> k = 3 per sample
  assert.equal(res.models.ESL.budget.rows, hiRows.reduce((x, y) => x + Math.min(3, y), 0) + other);
  const t1 = res.sets['T1 ESL'];
  assert.equal(t1.jobs, 25);
  assert.equal(t1.results.current.n, 25);
  assert.equal(t1.results.budget.n, 25);
  assert.equal(t1.twoPointRule === 'ok' || t1.twoPointRule === 'LOSES MORE THAN 2 POINTS', true);
  assert.equal(res.sets['T2'], undefined); // not requested
});

test('parseArgs: options and refusals', () => {
  assert.deepEqual(parseArgs([]), { mode: 'fixture', sets: null, budget: null, json: null, signers: null, queryRows: null, reuse: true });
  const o = parseArgs(['--live', '--budget', '120', '--sets', 'T1,LOSO', '--signers', 'P01,P02', '--query-rows', '10', '--no-reuse', '--json', 'x.json']);
  assert.equal(o.mode, 'live'); assert.equal(o.budget, 120); assert.deepEqual(o.sets, ['T1', 'LOSO']);
  assert.deepEqual(o.signers, ['P01', 'P02']); assert.equal(o.queryRows, 10); assert.equal(o.reuse, false); assert.equal(o.json, 'x.json');
  assert.equal(parseArgs(['--listing', 'a.json.gz']).listingFile, 'a.json.gz');
  assert.throws(() => parseArgs(['--budget', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--sets', 'T9']), /unknown set/);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['--listing']), /needs a value/);
});

test('readSignerFromDisk: reads only saved_gestures[_fsl]/**/sample_*.json, refuses everything else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-signer-'));
  const sib = root + '-old'; // sibling folder whose name starts with the root's name
  try {
    const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put('saved_gestures/hi/sample_1.json', JSON.stringify({ label: 'hi', signer: 'P07', frames: [] }));
    put('saved_gestures_fsl/hi/sample_2.json', JSON.stringify({ signer: 'P12', frames: [] }));
    put('saved_gestures/hi/sample_bad.json', '{"signer":"P07", not json');
    put('saved_gestures/hi/sample_p00.json', JSON.stringify({ signer: 'P00' }));
    put('saved_gestures/hi/sample_num.json', JSON.stringify({ signer: 7 }));
    put('saved_gestures/hi/sign.json', JSON.stringify({ signer: 'P01' }));
    put('php/sample_3.json', JSON.stringify({ signer: 'P01' }));
    fs.mkdirSync(path.join(root, 'saved_gestures/hi/sample_dir.json'), { recursive: true });
    fs.mkdirSync(path.join(sib, 'saved_gestures/hi'), { recursive: true });
    fs.writeFileSync(path.join(sib, 'saved_gestures/hi/sample_4.json'), JSON.stringify({ signer: 'P01' }));
    const read = (file) => readSignerFromDisk({ file }, root);

    assert.equal(read('saved_gestures/hi/sample_1.json'), 'P07');
    assert.equal(read('saved_gestures_fsl/hi/sample_2.json'), 'P12');
    // sibling-prefix path, '..', absolute path, other folder, non-sample file, directory
    assert.equal(read(`../${path.basename(sib)}/saved_gestures/hi/sample_4.json`), null);
    assert.equal(read('saved_gestures/../php/sample_3.json'), null);
    assert.equal(read('saved_gestures/hi/../../php/sample_3.json'), null);
    assert.equal(read(path.join(root, 'saved_gestures/hi/sample_1.json')), null);
    assert.equal(read('php/sample_3.json'), null);
    assert.equal(read('saved_gestures/hi/sign.json'), null);
    assert.equal(read('saved_gestures/hi/sample_dir.json'), null);
    assert.equal(read('saved_gestures'), null);
    // missing, invalid JSON, bad signer values, odd input
    assert.equal(read('saved_gestures/hi/sample_missing.json'), null);
    assert.equal(read('saved_gestures/hi/sample_bad.json'), null);
    assert.equal(read('saved_gestures/hi/sample_p00.json'), null);
    assert.equal(read('saved_gestures/hi/sample_num.json'), null);
    assert.equal(readSignerFromDisk(null, root), null);
    assert.equal(readSignerFromDisk({ file: 42 }, root), null);
    assert.equal(readSignerFromDisk({ file: '' }, root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sib, { recursive: true, force: true });
  }
});

test('finishSet: the 2-point flag fires on a > 2 point loss; n/a below 20 queries or with no budget queries', () => {
  const sc = (n, voteOk) => ({ n, voteOk, frames: n, frameOk: voteOk });
  const flag = (c, b) => finishSet({ results: { current: c, budget: b } });
  let s = flag(sc(100, 90), sc(100, 87));
  assert.equal(s.twoPointRule, 'LOSES MORE THAN 2 POINTS');
  assert.equal(s.voteDelta.toFixed(1), '-3.0');
  assert.equal(flag(sc(100, 90), sc(100, 88)).twoPointRule, 'ok'); // exactly -2.0 is not "more than 2"
  assert.equal(flag(sc(100, 90), sc(100, 95)).twoPointRule, 'ok');
  assert.match(flag(sc(19, 19), sc(19, 0)).twoPointRule, /^n\/a \(19 < 20 queries\)/);
  s = flag(sc(30, 30), sc(0, 0));
  assert.equal(s.voteDelta, null);
  assert.equal(s.twoPointRule, 'n/a (budget rule has no scored queries)');
});

test('CLI runs when started through the C:/xampp/htdocs/SKR junction', (t) => {
  const junction = 'C:/xampp/htdocs/SKR/tests/compact-model/accuracy.mjs';
  if (!fs.existsSync(junction)) { t.skip('no XAMPP junction on this machine'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-acc-'));
  try {
    const file = path.join(tmp, 'empty.json');
    fs.writeFileSync(file, JSON.stringify({ success: true, gestures: {}, signs: {}, categories: { ESL: {}, FSL: {} } }));
    const p = spawnSync(process.execPath, [junction, '--listing', file], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /no data/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
