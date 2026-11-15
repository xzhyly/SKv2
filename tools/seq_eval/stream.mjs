// tools/seq_eval/stream.mjs — plays held-out samples one after another through js/seq-recognizer.js, as the camera
// would deliver them (0.8 s without a hand between signs), and counts what the kiosk would have shown per sign.
//   node tools/seq_eval/stream.mjs <saved_gestures folder> [--fps N] [--new-signer] [--drop P]
// --drop P: each frame with a hand loses it with probability P (MediaPipe missing the hand, as on a slow Pi);
// fixed seed, so a run is repeatable.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SF = require('../../js/seq-features.js'); const SR = require('../../js/seq-recognizer.js');
const dir = process.argv[2]; const fpsAt = process.argv.indexOf('--fps'); const FPS = fpsAt > 0 ? Number(process.argv[fpsAt + 1]) : 0;
const NEW = process.argv.includes('--new-signer');
const dropAt = process.argv.indexOf('--drop'); const DROP = dropAt > 0 ? Number(process.argv[dropAt + 1]) : 0;
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const S = [];
for (const label of fs.readdirSync(dir).sort()) {
  const d = path.join(dir, label); if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d).filter((x) => /^sample_.*\.json$/.test(x)).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    S.push({ label, signer: j.signer || 'LIVE', group: j.importId || label + '/' + f, frames: j.frames });
  }
}
function build(train) { const b = SF.createBuilder(process.argv.includes('--whole-only') ? {} : { segments: SR.segmentsOf }); train.forEach((s) => b.addSample(s.label, s)); return b.finish(); }
const groups = [...new Set(S.map((s) => s.group))].sort();
const folds = NEW ? ['P01', 'P03', 'P05'].map((sg) => [S.filter((s) => s.signer === sg), S.filter((s) => s.signer !== sg)])
  : [0, 1, 2, 3, 4].map((k) => { const te = new Set(groups.filter((g, i) => i % 5 === k)); return [S.filter((s) => te.has(s.group)), S.filter((s) => !te.has(s.group))]; });
const c = { n: 0, exact: 0, wrong: 0, none: 0, unsureOnly: 0, extra: 0, still: 0, gone: 0, ignored: {} };
for (const [test, train] of folds) {
  const M = build(train); const have = new Set(M.labels);
  let ev = []; const R = SR.create({ model: M, onEvent: (e) => ev.push(e) });
  let clock = 0;
  for (const s of test) {
    if (!have.has(s.label)) continue;
    ev = [];
    const t0 = s.frames[0].t; let next = -Infinity;
    for (const f of s.frames) { if (FPS && f.t < next) continue; next = f.t + 1000 / FPS; const hs = (f.hands || []).filter((h) => h.landmarks && h.landmarks.length >= 21); R.push({ t: clock + f.t - t0, hands: DROP && hs.length && rnd() < DROP ? [] : hs }); }
    clock += s.frames[s.frames.length - 1].t - t0;
    for (let g = 0; g < 12; g++) { clock += FPS ? 1000 / FPS : 66; R.push({ t: clock, hands: [] }); }
    const signs = ev.filter((e) => e.type === 'sign'); const unsure = ev.filter((e) => e.type === 'unsure');
    c.n++;
    if (signs.length === 1 && signs[0].label === s.label) c.exact++;
    if (signs.some((e) => e.label !== s.label)) c.wrong++;
    if (!signs.length) { c.none++; if (unsure.length) c.unsureOnly++; }
    if (signs.length > 1) c.extra++;
    signs.concat(unsure).forEach((e) => { c[e.reason]++; });
    ev.filter((e) => e.type === 'ignored').forEach((e) => { c.ignored[e.why] = (c.ignored[e.why] || 0) + 1; });
  }
}
const p = (x) => (100 * x / c.n).toFixed(1) + ' %';
console.log(`${NEW ? 'New signer' : 'Same signers'}${FPS ? ', ' + FPS + ' fps' : ''}${DROP ? ', ' + DROP * 100 + ' % of hand frames lost' : ''}: ${c.n} signs played`);
console.log(`  exactly the right word, nothing else : ${p(c.exact)}`);
console.log(`  a wrong word shown                   : ${p(c.wrong)}`);
console.log(`  nothing shown                        : ${p(c.none)}  (of these "not sure": ${p(c.unsureOnly)})`);
console.log(`  more than one word for one sign      : ${p(c.extra)}`);
console.log(`  ended by a hold ${c.still}, by the hands going ${c.gone}; ignored: ${JSON.stringify(c.ignored)}`);
