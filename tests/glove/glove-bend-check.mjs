// glove-hw Phase 2: js/glove-bend.js on the real ESL model (models/knn_ESL.bin) and on hand-made rows, in node.
// Bend from landmarks (fist-like signs high, open-hand signs low), the distance rules (one-hand rows, slot
// order, null fingers), and rerank (top 5 only, never below 0, input untouched, glove decides a close call).
// Run: node tests/glove/glove-bend-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const B = require(path.join(ROOT, 'js/glove-bend.js'));
const K = require(path.join(ROOT, 'js/knn-compile.js'));
const J = JSON.stringify;
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  ' + detail));
  if (!ok) failed++;
}
const buf = fs.readFileSync(path.join(ROOT, 'models/knn_ESL.bin'));
const { model } = K.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// median bend per finger over a label's slot-0 rows
const labelBend = (l) => [0, 1, 2, 3, 4].map((f) => median(model[l].map((r) => B.bendOfSlot(r, 0)).filter(Boolean).map((b) => b[f])));
const fingersMean = (b) => (b[1] + b[2] + b[3] + b[4]) / 4;
const r2 = (b) => b.map((v) => +v.toFixed(2));

// 1. bend from the model's own landmarks
const fist = ['s', 'a', 'e', 'm'].map((l) => [l, labelBend(l)]);
const open = ['b', '5'].map((l) => [l, labelBend(l)]);
console.log('  measured median bends (thumb..pinky):', J(Object.fromEntries([...fist, ...open].map(([l, b]) => [l, r2(b)]))));
check('fist-like signs (s, a, e, m): fingers mean bend > 0.5', fist.every(([, b]) => fingersMean(b) > 0.5), J(fist.map(([l, b]) => [l, fingersMean(b).toFixed(2)])));
check('open-hand signs (b, 5): fingers mean bend < 0.25', open.every(([, b]) => fingersMean(b) < 0.25), J(open.map(([l, b]) => [l, fingersMean(b).toFixed(2)])));
check('every bend of every row is in 0..1 or the slot is empty (null)', Object.values(model).every((rows) => rows.every((r) => {
  const rb = B.rowBends(r);
  return [rb.a, rb.b].every((x) => x === null || (x.length === 5 && x.every((v) => v >= 0 && v <= 1)));
})));
const someRow = model.s[0];
check('rowBends is cached per row (same object back)', B.rowBends(someRow) === B.rowBends(someRow));
const mirrored = someRow.map((v, i) => (i % 3 === 0 ? -v : v));
check('x-mirror does not change the bend', J(r2(B.bendOfSlot(mirrored, 0))) === J(r2(B.bendOfSlot(someRow, 0))));

// 2. distance rules on hand-made row bends
const OPEN = [0, 0, 0, 0, 0], FIST = [1, 1, 1, 1, 1];
check('one glove vs a one-hand row', B.rowDistance({ a: FIST, b: null }, [FIST]) === 0 && B.rowDistance({ a: FIST, b: null }, [OPEN]) === 1);
check('one glove vs a two-hand row: the closer slot counts', B.rowDistance({ a: OPEN, b: FIST }, [FIST]) === 0);
check('two gloves: both slot orders tried', B.rowDistance({ a: OPEN, b: FIST }, [FIST, OPEN]) === 0);
check('two gloves vs a one-hand row: the better-matching glove counts', B.rowDistance({ a: FIST, b: null }, [OPEN, FIST]) === 0);
check('null glove fingers are skipped', B.rowDistance({ a: FIST, b: null }, [[1, null, null, null, 0]]) === 0.5);
check('nothing to compare -> null', B.rowDistance({ a: null, b: null }, [FIST]) === null && B.rowDistance({ a: FIST, b: null }, [[null, null, null, null, null]]) === null);

// 3. rerank
const sGlove = labelBend('s');
const scores = { b: 0.80, s: 0.78, hello: 0.5, c: 0.4, d: 0.3, e: 0.2 };
const before = J(scores);
const rr = B.rerank(scores, model, [sGlove], 0.3);
check('rerank: with the glove bent like "s", "s" overtakes "b" (camera alone: b 0.80 > s 0.78)', rr.scores.s > rr.scores.b, J({ s: rr.scores.s, b: rr.scores.b, dist: rr.dist }));
check('rerank: the input scores are not changed', J(scores) === before);
check('rerank: only the top 5 labels are touched', rr.scores.e === 0.2 && !('e' in rr.dist) && Object.keys(rr.dist).length <= 5, J(rr.dist));
check('rerank: no score below 0', Object.values(B.rerank(scores, model, [OPEN], 1).scores).every((v) => v >= 0));
check('rerank: w = 0 or no gloves -> unchanged', J(B.rerank(scores, model, [sGlove], 0).scores) === before && J(B.rerank(scores, model, [], 0.3).scores) === before);

// 4. cost: a rerank over 5 labels after the rows are cached
const t0 = process.hrtime.bigint();
for (let i = 0; i < 100; i++) B.rerank(scores, model, [sGlove, OPEN], 0.3);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
console.log(`  rerank, 2 gloves, cached rows: ${ms.toFixed(3)} ms per call (this machine)`);
check('rerank is cheap once cached (< 5 ms per call here)', ms < 5, ms.toFixed(3));

console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
