// tools/seq_eval/eval.mjs — measures js/seq-features.js on a folder of saved samples (laptop / any machine with node).
//   node tools/seq_eval/eval.mjs <saved_gestures folder> [--fps N]
// Two tests, the vectors built by the same code the kiosk runs:
//   same signers  : 5 folds, whole videos held out (all repetitions of one imported video, or one live sample)
//   new signer    : every sample of one signer held out (signers with 100+ samples), trained on everyone else
// Prints % correct, per category, and what the "sure enough" rule (ratio < threshold) accepts.
// --fps N: the held-out samples are thinned to about N frames per second first (the Pi detects fewer frames).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SF = require('../../js/seq-features.js');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/seq_eval/eval.mjs <saved_gestures folder> [--fps N]'); process.exit(2); }
const fpsAt = process.argv.indexOf('--fps');
const FPS = fpsAt > 0 ? Number(process.argv[fpsAt + 1]) : 0;
const cat = (l) => (/^\d+$/.test(l) ? 'number' : l.length === 1 ? 'letter' : l.includes('_') ? 'phrase' : 'word');
function thin(frames) {
  if (!FPS) return frames;
  const out = []; let next = -Infinity;
  for (const f of frames) { if (f.t >= next) { out.push(f); next = f.t + 1000 / FPS; } }
  return out;
}

const S = [];
for (const label of fs.readdirSync(dir).sort()) {
  const d = path.join(dir, label);
  if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d).filter((x) => /^sample_.*\.json$/.test(x)).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    const o = { w: (j.input && j.input.width) || 320, h: (j.input && j.input.height) || 240 };
    const v = SF.vector(j.frames, o), m = SF.vector(j.frames, { ...o, mirror: true });
    const q = SF.vector(thin(j.frames), o);
    if (!v) continue;
    S.push({ label, signer: j.signer || 'LIVE', group: j.importId || label + '/' + f, v, m, q });
  }
}
console.log(`${S.length} samples, ${new Set(S.map((s) => s.label)).size} signs` + (FPS ? `, held-out samples thinned to ${FPS} fps` : ''));

function model(train) {
  const labels = [...new Set(train.map((s) => s.label))].sort(); const idx = Object.fromEntries(labels.map((l, i) => [l, i]));
  const D = SF.DIMS, n = train.length * 2, mu = new Float32Array(D), sd = new Float32Array(D), rows = new Float32Array(n * D), rowLabel = new Uint16Array(n);
  const vs = train.flatMap((s) => [s.v, s.m]);
  for (const v of vs) for (let d = 0; d < D; d++) mu[d] += v[d] / n;
  for (const v of vs) for (let d = 0; d < D; d++) sd[d] += (v[d] - mu[d]) ** 2 / n;
  for (let d = 0; d < D; d++) sd[d] = Math.sqrt(sd[d]) + 1e-6;
  vs.forEach((v, i) => { rowLabel[i] = idx[train[i >> 1].label]; for (let d = 0; d < D; d++) rows[i * D + d] = (v[d] - mu[d]) / sd[d]; });
  return { labels, rowLabel, mu, sd, rows };
}
function run(name, folds) {
  const rec = [];
  for (const [test, train] of folds) {
    const M = model(train); const have = new Set(M.labels);
    for (const s of test) {
      if (!have.has(s.label) || !s.q) continue;
      const r = SF.classify(M, s.q);
      rec.push({ c: cat(s.label), ok: r.label === s.label, ratio: r.ratio });
    }
  }
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '-');
  const by = (c) => { const x = rec.filter((r) => r.c === c); return `${c} ${pct(x.filter((r) => r.ok).length, x.length)} (${x.length})`; };
  console.log(`\n${name}: ${pct(rec.filter((r) => r.ok).length, rec.length)} % correct of ${rec.length}   ` + ['letter', 'number', 'word', 'phrase'].map(by).join(' · '));
  for (const thr of [0.95, 0.9, 0.85, 0.8]) {
    const acc = rec.filter((r) => r.ratio < thr);
    console.log(`  ratio < ${thr}: answers ${pct(acc.length, rec.length)} % of signs, ${pct(acc.filter((r) => r.ok).length, acc.length)} % of those answers correct, wrong answer shown ${pct(acc.filter((r) => !r.ok).length, rec.length)} %`);
  }
}
// same signers: whole videos held out, 5 folds (deterministic order)
const groups = [...new Set(S.map((s) => s.group))].sort();
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
const foldOf = Object.fromEntries(groups.map((g, i) => [g, i % 5]));
run('Same signers (other videos held out, 5 folds)', [0, 1, 2, 3, 4].map((k) => [S.filter((s) => foldOf[s.group] === k), S.filter((s) => foldOf[s.group] !== k)]));
const signers = Object.entries(S.reduce((a, s) => ((a[s.signer] = (a[s.signer] || 0) + 1), a), {})).filter(([sg, n]) => n >= 100 && sg !== 'LIVE').map(([sg]) => sg).sort();
run(`New signer (${signers.join(', ')} held out in turn)`, signers.map((sg) => [S.filter((s) => s.signer === sg), S.filter((s) => s.signer !== sg)]));
