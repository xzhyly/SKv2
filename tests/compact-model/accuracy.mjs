// Accuracy script for the compact recognition model (compact-model phase, Task 2). Compares the
// rows the kiosk uses today ("current": recordingToFeatureRows, no budget) with the per-sign
// budget rule ("budget": js/knn-compile.js buildModel/selectSignRows, DEFAULT_RULE or --budget N),
// both scored with the kiosk's own knnPredict text (js/sign-to-text-ui.js, unchanged).
// Spec: .git/sdd/cm-plan.md, .git/sdd/cm-task-2-brief.md; test sets: docs/reports/
// 2026-10-14-compact-model-step1.md section 2.2.
//
// Run (node, from the repo root):
//   node tests/compact-model/accuracy.mjs                 frozen fixtures (default, same as --fixture)
//   node tests/compact-model/accuracy.mjs --live          GET http://localhost/SKR/php/api/save_gesture.php?no_sync=1
//   node tests/compact-model/accuracy.mjs --listing f.json[.gz]   any saved listing
// Options: --budget N (budget rule's per-sign budget, default 90), --json <file> (write everything),
//   --sets T1,T2,T2r,T3,LOSO (default all), --signers P01,P02 (LOSO: only hold out these),
//   --query-rows N (score at most N evenly spaced rows per query; default all rows),
//   --no-reuse (predict the budget model even when its rows are identical to the current model's).
//
// Also an importable module: runAccuracy(), formatReport(), prepareListing().
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  loadFixtureListing,
  loadFixtureVideos,
  loadToRows,
  loadKnnCompile,
  makeKioskKnn,
} from './fixtures.mjs';

const require = createRequire(import.meta.url);
const K = loadKnnCompile();
const Core = require(path.join(REPO_ROOT, 'js', 'capture-core.js'));
const toRows = loadToRows();

export const LIVE_URL = 'http://localhost/SKR/php/api/save_gesture.php?no_sync=1';
export const ALL_SETS = ['T1', 'T2', 'T2r', 'T3', 'LOSO'];
const LANGS = ['ESL', 'FSL'];
const CATS = ['letter', 'number', 'word', 'phrase'];
// Display videos 1..10 are the number signs one..ten (Step 1 report, section 2.2).
const NUM_KEYS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
const REAL_VIDEO = 'real__P_real';

const own = (obj, key) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const isRaw = (sample) => Array.isArray(sample && sample.frames) && sample.frames.some((f) => Array.isArray(f && f.hands));

// The sample's set, exactly as recordingsToTrainingRows (js/gesture-data.js:785-797) and
// KnnCompile decide it: signs[label].set, else the sample's signLanguage, else 'ESL'.
function sampleSet(signs, label, sample) {
  const sign = own(signs, label);
  return (sign && sign.set) || (sample && sample.signLanguage) || 'ESL';
}

// Every hand row of a sample, in order, unsubsampled (v3: one row per hand frame; v2: as stored).
// This is what a query uses; the model side uses recordingToFeatureRows (v3 at most 30 rows).
function allRows(sample) {
  if (!isRaw(sample)) return toRows(sample);
  const out = [];
  for (const f of sample.frames) {
    if (!Array.isArray(f && f.hands) || f.hands.length === 0) continue;
    const r = toRows({ frames: [f] });
    if (r.length === 1) out.push(r[0]);
  }
  return out;
}

// Signer of a v3 sample: the listing's own `signer` field when present; otherwise readSigner(sample)
// (the CLI reads the sample file on disk, because save_gesture.php's listing does not return it).
function signerOf(sample, readSigner) {
  if (!isRaw(sample)) return null;
  if (typeof sample.signer === 'string' && sample.signer) return sample.signer;
  return readSigner ? readSigner(sample) || null : null;
}

// Reads `signer` from the sample file named by the listing's `file` (relative to `root`). Only a
// `sample_*.json` file directly or deeper under <root>/saved_gestures/ or <root>/saved_gestures_fsl/
// is read; anything else (other folders, '..', absolute paths, directories, unreadable or invalid
// JSON) gives null. The value must look like the importer's P01..P99
// (php/api/save_gesture.php:507).
export const SIGNER_RE = /^P(0[1-9]|[1-9][0-9])$/;
export function readSignerFromDisk(sample, root = REPO_ROOT) {
  if (!sample || typeof sample.file !== 'string' || !sample.file) return null;
  if (path.isAbsolute(sample.file)) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, sample.file);
  const allowed = ['saved_gestures', 'saved_gestures_fsl'].some((d) => file.startsWith(path.join(base, d) + path.sep));
  if (!allowed || !/^sample_.*\.json$/.test(path.basename(file))) return null;
  try {
    if (!fs.statSync(file).isFile()) return null;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = json && json.signer;
    return typeof s === 'string' && SIGNER_RE.test(s) ? s : null;
  } catch {
    return null;
  }
}

// listing (the save_gesture.php GET response) -> sample entries with rows computed once.
export function prepareListing(listing, opts = {}) {
  const gestures = (listing && listing.gestures) || {};
  const signs = (listing && listing.signs) || {};
  const categories = (listing && listing.categories) || {};
  const entries = [];
  for (const label of Object.keys(gestures)) {
    (gestures[label] || []).forEach((sample, idx) => {
      const rows = toRows(sample).filter((r) => Array.isArray(r) && r.length === 126); // kiosk filter
      entries.push({
        label,
        idx,
        file: sample.file,
        signLanguage: sample.signLanguage,
        set: sampleSet(signs, label, sample),
        isV3: isRaw(sample),
        signer: signerOf(sample, opts.readSigner),
        rows,
        all: allRows(sample),
      });
    });
  }
  return { gestures, signs, categories, entries, signCount: Object.keys(gestures).length };
}

// Video fixture { "<sub>__<key>": { durationMs, frames } } -> clips keyed by sign label.
function prepareVideos(videos) {
  const clips = [];
  let real = null;
  for (const name of Object.keys(videos || {})) {
    const v = videos[name];
    if (name === REAL_VIDEO) { real = v; continue; }
    if (!name.startsWith('en__')) continue;
    const raw = name.slice(4);
    const label = NUM_KEYS[raw] || raw;
    const sample = { frames: v.frames || [] };
    clips.push({
      label,
      file: 'video:' + name,
      signLanguage: 'ESL',
      set: 'ESL',
      isV3: true,
      signer: null,
      rows: toRows(sample).filter((r) => Array.isArray(r) && r.length === 126), // like a v3 sample
      all: allRows(sample),
    });
  }
  return { clips, real };
}

// ---- rules ---------------------------------------------------------------------------------

// "current": the kiosk model before this phase (HEAD b61c665 js/sign-to-text-ui.js:115-123, 149-155): every row of every
// in-model sample, label by label in listing order. (Pages may order labels differently, e.g.
// js/gesture-training-ui.js:6 before this phase (HEAD b61c665) started trainData with { start: [], stop: [] }, and the compiled file
// is sorted; label order only matters for exact score ties in knnPredict's sort.)
function buildCurrent(items, lang) {
  const model = {};
  let rows = 0;
  for (const e of items) {
    if (!K.inModel(lang, e.label, e.set)) continue;
    for (const r of e.rows) { (model[e.label] ||= []).push(r); rows++; }
  }
  return { model, rows, labels: Object.keys(model).length };
}

// "budget": KnnCompile.buildModel (labels sorted, per-sign budget recomputed on `items`).
function buildBudget(items, lang, rule, listing) {
  const gestures = {};
  for (const e of items) (gestures[e.label] ||= []).push(e);
  const out = K.buildModel({
    gestures,
    signs: listing.signs,
    categories: listing.categories,
    lang,
    toRows: (e) => e.rows,
    rule,
    buildDate: '1970-01-01T00:00:00.000Z',
  });
  return { model: out.model, rows: out.header.rowCount, labels: out.header.labels.length };
}

function sameModel(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    const ra = a[ka[i]];
    const rb = b[kb[i]];
    if (ra.length !== rb.length) return false;
    for (let j = 0; j < ra.length; j++) if (ra[j] !== rb[j]) return false;
  }
  return true;
}

// ---- scoring -------------------------------------------------------------------------------

// Majority of the frame predictions; a tie goes to the label predicted first. Same as Step 1's
// Object.entries(...).sort except for integer-like labels ("1", "2"), which an object would put
// first; a Map keeps first-seen order for every label (no such label exists in the fixture).
function voteOf(preds) {
  const cnt = new Map();
  for (const p of preds) cnt.set(p, (cnt.get(p) || 0) + 1);
  let best;
  let bestN = 0;
  for (const [l, n] of cnt) if (n > bestN) { best = l; bestN = n; }
  return best;
}

function topCounts(preds, k) {
  const cnt = new Map();
  for (const p of preds) cnt.set(p, (cnt.get(p) || 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
}

function emptyScore() {
  return { n: 0, voteOk: 0, frames: 0, frameOk: 0, byCat: {}, conf: {}, voteConf: {},
    missing: { queries: 0, frames: 0, labels: [] }, noRows: 0, notUsable: 0 };
}

// Adds score `b` into `a` (counts, per category, confusions, missing/noRows/notUsable).
function mergeScore(a, b) {
  for (const k of ['n', 'voteOk', 'frames', 'frameOk', 'noRows', 'notUsable']) a[k] += b[k];
  for (const [c, v] of Object.entries(b.byCat)) {
    const t = (a.byCat[c] ||= { frames: 0, frameOk: 0, n: 0, voteOk: 0 });
    for (const k of ['frames', 'frameOk', 'n', 'voteOk']) t[k] += v[k];
  }
  for (const m of ['conf', 'voteConf']) for (const [k, v] of Object.entries(b[m])) a[m][k] = (a[m][k] || 0) + v;
  a.missing.queries += b.missing.queries;
  a.missing.frames += b.missing.frames;
  a.missing.labels = [...new Set([...a.missing.labels, ...b.missing.labels])].sort();
}

function addResults(score, results, catOf) {
  for (const r of results) {
    const c = catOf(r.label);
    const bc = (score.byCat[c] ||= { frames: 0, frameOk: 0, n: 0, voteOk: 0 });
    score.n++; bc.n++;
    if (r.vote === r.label) { score.voteOk++; bc.voteOk++; } else {
      const k = `${r.label} -> ${r.vote}`;
      score.voteConf[k] = (score.voteConf[k] || 0) + 1;
    }
    for (const p of r.preds) {
      score.frames++; bc.frames++;
      if (p === r.label) { score.frameOk++; bc.frameOk++; } else {
        const k = `${r.label} -> ${p}`;
        score.conf[k] = (score.conf[k] || 0) + 1;
      }
    }
  }
}

const pct = (a, b) => (b ? (100 * a) / b : null);
const fmtPct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '-');

// ---- the run -------------------------------------------------------------------------------

export async function runAccuracy(opts = {}) {
  const t0 = Date.now();
  const log = opts.log || (() => {});
  const sets = new Set(opts.sets || ALL_SETS);
  const reuse = opts.reuse !== false;
  const queryRows = opts.queryRows || null;
  const progressMs = opts.progressMs === undefined ? 30000 : opts.progressMs;
  const rule = Object.assign({}, K.DEFAULT_RULE, opts.budget ? { budget: opts.budget } : {});
  const L = prepareListing(opts.listing, { readSigner: opts.readSigner });
  const V = prepareVideos(opts.videos);
  const knn = makeKioskKnn();
  const tPrep = Date.now() - t0;

  const res = {
    source: opts.source || 'listing',
    rule,
    queryRows,
    dataset: summarizeDataset(L),
    categories: L.categories,
    models: {},
    sets: {},
    order: [],
    notes: [],
    timings: { prepareMs: tPrep, sets: {}, totalMs: 0 },
    predictions: 0,
  };
  if (!L.entries.length) {
    res.noData = true;
    res.notes.push(`no data (${L.signCount} sign${L.signCount === 1 ? '' : 's'}, 0 samples)`);
    res.timings.totalMs = Date.now() - t0;
    return res;
  }

  const RULES = [
    { name: 'current', build: (items, lang) => buildCurrent(items, lang) },
    { name: 'budget', build: (items, lang) => buildBudget(items, lang, rule, L) },
  ];
  const catOf = (lang) => (label) => {
    const other = lang === 'ESL' ? 'FSL' : 'ESL';
    return own(L.categories[lang], label) || own(L.categories[other], label) || '(none)';
  };
  const qRows = (rows) => (queryRows ? K.evenIdx(rows.length, queryRows).map((i) => rows[i]) : rows);

  // Full models per language (usability, rows).
  for (const lang of LANGS) {
    const m = {};
    for (const R of RULES) {
      const b = R.build(L.entries, lang);
      m[R.name] = { rows: b.rows, labels: b.labels };
    }
    m.usable = m.current.labels >= 2 && m.budget.labels >= 2;
    if (!m.usable) {
      m.note = `${lang} model not usable (${m.current.labels} label${m.current.labels === 1 ? '' : 's'}; needs at least 2)`;
      res.notes.push(m.note);
    }
    res.models[lang] = m;
  }
  const inLang = (lang) => L.entries.filter((e) => K.inModel(lang, e.label, e.set));
  const labelsIn = (lang) => new Set(inLang(lang).filter((e) => e.rows.length).map((e) => e.label));

  // Runs one test set: jobs = [{ items, lang, queries: [{label, rows, signer?}], group? }].
  // Before predicting it prints the planned work (jobs, query frames, model rows per rule); while
  // predicting it prints progress with elapsed time and an ETA at most every progressMs.
  function runSet(name, lang, jobs, extra = {}) {
    const ts = Date.now();
    const set = { name, lang, results: {}, groups: {}, ...extra };
    const live = (job) => job.queries.filter((q) => q.rows.length);
    // Plan (models are built here only to count their rows; they are rebuilt below).
    const plan = { jobs: jobs.length, queries: 0, queryFrames: 0, rows: {}, work: 0 };
    const jobWork = jobs.map(() => ({}));
    jobs.forEach((job) => { const qs = live(job); plan.queries += qs.length; plan.queryFrames += qs.reduce((n, q) => n + q.rows.length, 0); });
    for (const R of RULES) {
      let min = Infinity;
      let max = 0;
      jobs.forEach((job, ji) => {
        const qs = live(job);
        if (!qs.length) { jobWork[ji][R.name] = 0; return; }
        const b = R.build(job.items, job.lang || lang);
        min = Math.min(min, b.rows); max = Math.max(max, b.rows);
        const frames = b.labels < 2 ? 0 : qs.filter((q) => own(b.model, q.label)).reduce((n, q) => n + q.rows.length, 0);
        jobWork[ji][R.name] = frames * b.rows;
        plan.work += frames * b.rows;
      });
      plan.rows[R.name] = max ? (min === max ? `${max}` : `${min}-${max}`) : '0';
    }
    set.plan = plan;
    log(`  ${name}: ${plan.jobs} job(s), ${plan.queries} queries, ${plan.queryFrames} query frames; model rows current ${plan.rows.current}, budget ${plan.rows.budget}; ${plan.work.toLocaleString('en-US')} frame x row comparisons planned`);
    progress = { name, total: plan.work, done: 0, start: Date.now(), last: Date.now() };

    const cached = []; // per job: current model + predictions, for reuse
    let predCount = 0;
    for (const R of RULES) {
      const score = emptyScore();
      progress.rule = R.name;
      jobs.forEach((job, ji) => {
        const js = emptyScore();
        const queries = job.queries.filter((q) => {
          if (q.rows.length) return true;
          js.noRows++;
          return false;
        });
        if (queries.length) {
          const b = R.build(job.items, job.lang || lang);
          if (b.labels < 2) js.notUsable += queries.length;
          else {
            const present = [];
            for (const q of queries) {
              if (own(b.model, q.label)) present.push(q);
              else { js.missing.queries++; js.missing.frames += q.rows.length; js.missing.labels.push(q.label); }
            }
            let results;
            if (R.name === 'current') {
              results = predict(b.model, present, b.rows);
              cached[ji] = { model: b.model, results };
            } else if (reuse && cached[ji] && sameModel(b.model, cached[ji].model)) {
              results = cached[ji].results;
              progress.done += jobWork[ji].budget;
              set.reused = (set.reused || 0) + 1;
            } else {
              results = predict(b.model, present, b.rows);
            }
            predCount += results.reduce((n, r) => n + r.preds.length, 0);
            addResults(js, results, catOf(lang));
          }
        }
        mergeScore(score, js);
        if (job.group) mergeScore(((set.groups[job.group] ||= {})[R.name] ||= emptyScore()), js);
      });
      set.results[R.name] = score;
    }
    progress = null;
    set.jobs = jobs.length;
    finishSet(set);
    res.sets[name] = set;
    res.order.push(name);
    res.predictions += predCount;
    res.timings.sets[name] = Date.now() - ts;
    log(`  ${name}: done, ${set.results.current.n} scored queries, ${Date.now() - ts} ms${set.reused ? ` (budget model identical to current in ${set.reused}/${jobs.length} job(s): predictions reused)` : ''}`);
    return set;
  }

  let progress = null;
  const fmtDur = (ms) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);
  function predict(model, queries, modelRows) {
    knn.set(model);
    return queries.map((q) => {
      const preds = q.rows.map((r) => {
        const p = knn.predict(r);
        if (progress) {
          progress.done += modelRows;
          const now = Date.now();
          if (now - progress.last >= progressMs) {
            progress.last = now;
            const el = now - progress.start;
            const frac = progress.total ? progress.done / progress.total : 1;
            const eta = frac > 0 ? (el / frac) - el : 0;
            log(`    ${progress.name} [${progress.rule}]: ${(100 * frac).toFixed(1)}% of planned work, elapsed ${fmtDur(el)}, ETA ${fmtDur(eta)}`);
          }
        }
        return p ? p.label : null;
      });
      return { label: q.label, preds, vote: voteOf(preds), signer: q.signer };
    });
  }

  function skipSet(name, lang, note) {
    res.sets[name] = { name, lang, skipped: true, note };
    res.order.push(name);
  }

  // T1 leave-one-repetition-out, per model language.
  if (sets.has('T1')) for (const lang of LANGS) {
    const name = `T1 ${lang}`;
    if (!res.models[lang].usable) { skipSet(name, lang, res.models[lang].note); continue; }
    const items = inLang(lang);
    const byLabel = {};
    items.forEach((e) => (byLabel[e.label] ||= []).push(e));
    const jobs = [];
    for (const label of Object.keys(byLabel)) {
      if (byLabel[label].length < 2) continue;
      for (const held of byLabel[label]) {
        jobs.push({ items: items.filter((e) => e !== held), lang, queries: [{ label, rows: qRows(held.all) }] });
      }
    }
    if (!jobs.length) skipSet(name, lang, 'no sign has 2 or more samples');
    else runSet(name, lang, jobs);
  }

  // T2 / T2 FSL: the display videos' hand frames against today's samples.
  const haveVideos = V.clips.length > 0;
  if (sets.has('T2')) for (const lang of LANGS) {
    const name = lang === 'ESL' ? 'T2' : 'T2 FSL';
    if (!res.models[lang].usable) { skipSet(name, lang, res.models[lang].note); continue; }
    const labels = labelsIn(lang);
    const queries = V.clips.filter((c) => labels.has(c.label) && c.all.length).map((c) => ({ label: c.label, rows: qRows(c.all) }));
    if (!queries.length) skipSet(name, lang, haveVideos ? 'no matching videos' : 'no videos');
    else runSet(name, lang, [{ items: L.entries, lang, queries }]);
  }

  // T2r: models from the videos (extracted like a v3 sample), queries = the listing's samples.
  if (sets.has('T2r')) {
    const name = 'T2r';
    const labels = labelsIn('ESL');
    const items = V.clips.filter((c) => labels.has(c.label) && c.all.length);
    const vidLabels = new Set(items.map((c) => c.label));
    if (!res.models.ESL.usable) skipSet(name, 'ESL', res.models.ESL.note);
    else if (vidLabels.size < 2) skipSet(name, 'ESL', haveVideos ? 'no matching videos' : 'no videos');
    else {
      const queries = L.entries.filter((e) => vidLabels.has(e.label)).map((e) => ({ label: e.label, rows: qRows(e.all) }));
      const vb = {};
      for (const R of RULES) vb[R.name] = R.build(items, 'ESL').rows;
      runSet(name, 'ESL', [{ items, lang: 'ESL', queries }], { rowsVid: vb });
    }
  }

  // T3: the real new-signer video, segmented like the importer; top-3 per repetition, no score.
  if (sets.has('T3')) for (const lang of LANGS) {
    const name = `T3 ${lang}`;
    if (!res.models[lang].usable) { skipSet(name, lang, res.models[lang].note); continue; }
    if (!V.real) { skipSet(name, lang, 'no real video'); continue; }
    const ts = Date.now();
    const frames = V.real.frames || [];
    const seg = Core.segmentFrames(frames.map((f) => ({ t: f.t, handPresent: f.hands.length > 0 })), { endMs: V.real.durationMs });
    const reps = seg.reps.map((r) => allRows({ frames: frames.slice(r.startFrame, r.endFrame + 1) }));
    const set = { name, lang, kind: 'top3', segmentation: { ok: seg.ok, reason: seg.reason || null, reps: seg.reps }, results: {} };
    const built = RULES.map((R) => R.build(L.entries, lang));
    log(`  ${name}: ${reps.length} repetitions, ${reps.reduce((n, r) => n + r.length, 0)} query frames; model rows current ${built[0].rows}, budget ${built[1].rows}`);
    for (const [ri, R] of RULES.entries()) {
      const b = built[ri];
      knn.set(b.model);
      set.results[R.name] = reps.map((rows) => {
        const preds = rows.map((r) => { const p = knn.predict(r); return p ? p.label : null; });
        res.predictions += preds.length;
        return { n: preds.length, top: topCounts(preds, 3) };
      });
    }
    set.same = JSON.stringify(set.results.current) === JSON.stringify(set.results.budget);
    res.sets[name] = set;
    res.order.push(name);
    res.timings.sets[name] = Date.now() - ts;
    log(`  ${name}: done, ${Date.now() - ts} ms`);
  }

  // LOSO leave-one-signer-out, per model language (v3 samples with >= 2 distinct signers).
  if (sets.has('LOSO')) {
    const signers = res.dataset.signers;
    for (const lang of LANGS) {
      const name = `LOSO ${lang}`;
      if (!res.models[lang].usable) { skipSet(name, lang, res.models[lang].note); continue; }
      const items = inLang(lang);
      const here = [...new Set(items.filter((e) => e.signer).map((e) => e.signer))].sort();
      if (signers.length < 2) { skipSet(name, lang, `listing has v3 samples from ${signers.length} signer${signers.length === 1 ? '' : 's'} (needs at least 2)`); continue; }
      if (here.length < 2) { skipSet(name, lang, `${lang} model has samples from ${here.length} signer${here.length === 1 ? '' : 's'} (needs at least 2)`); continue; }
      const held = opts.signers && opts.signers.length ? here.filter((p) => opts.signers.includes(p)) : here;
      if (!held.length) { skipSet(name, lang, 'none of --signers is in this model'); continue; }
      const jobs = held.map((p) => ({
        group: p,
        items: items.filter((e) => e.signer !== p),
        lang,
        queries: items.filter((e) => e.signer === p).map((e) => ({ label: e.label, rows: qRows(e.all), signer: p })),
      }));
      runSet(name, lang, jobs, { signers: held, unsignedSamples: items.filter((e) => !e.signer).length });
    }
  }

  res.timings.totalMs = Date.now() - t0;
  return res;
}

function summarizeDataset(L) {
  const per = {};
  L.entries.forEach((e) => (per[e.label] = (per[e.label] || 0) + 1));
  const counts = Object.keys(L.gestures).map((l) => per[l] || 0).sort((a, b) => a - b);
  const sets = {};
  Object.keys(L.gestures).forEach((l) => {
    const s = (own(L.signs, l) && own(L.signs, l).set) || ((L.gestures[l] || [])[0] && L.gestures[l][0].signLanguage) || 'ESL';
    sets[s] = (sets[s] || 0) + 1;
  });
  return {
    signs: L.signCount,
    samples: L.entries.length,
    v3: L.entries.filter((e) => e.isV3).length,
    withSigner: L.entries.filter((e) => e.signer).length,
    signers: [...new Set(L.entries.filter((e) => e.signer).map((e) => e.signer))].sort(),
    signsBySet: sets,
    samplesPerSign: counts.length ? { min: counts[0], median: counts[Math.floor(counts.length / 2)], max: counts[counts.length - 1], zero: counts.filter((c) => c === 0).length } : null,
  };
}

// Vote-point difference budget - current and the 2-point flag (sets with >= 20 scored queries).
export function finishSet(set) {
  const c = set.results.current;
  const b = set.results.budget;
  set.voteDelta = c.n && b.n ? pct(b.voteOk, b.n) - pct(c.voteOk, c.n) : null;
  set.frameDelta = c.frames && b.frames ? pct(b.frameOk, b.frames) - pct(c.frameOk, c.frames) : null;
  if (c.n < 20) set.twoPointRule = `n/a (${c.n} < 20 queries)`;
  else if (set.voteDelta === null) set.twoPointRule = 'n/a (budget rule has no scored queries)';
  else set.twoPointRule = set.voteDelta < -2 ? 'LOSES MORE THAN 2 POINTS' : 'ok';
  return set;
}

// ---- report --------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function confLines(score, catOf, limit = 10) {
  const out = [];
  const isPhrase = (l) => catOf(l) === 'phrase';
  const pairs = (m) => Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const cap = (list, f) => list.slice(0, limit).map(f).join('; ') + (list.length > limit ? `; ... and ${list.length - limit} more` : '');
  const wv = pairs(score.voteConf);
  const fc = pairs(score.conf);
  const cross = (list) => list.filter(([k]) => { const [a, b] = k.split(' -> '); return isPhrase(a) !== isPhrase(b); });
  out.push(`wrong votes (${wv.reduce((n, [, v]) => n + v, 0)}): ${wv.length ? cap(wv, ([k, v]) => (v > 1 ? `${k} x${v}` : k)) : 'none'}`);
  out.push(`top frame confusions: ${fc.length ? cap(fc, ([k, v]) => `${k} (${v})`) : 'none'}`);
  const cv = cross(wv);
  const cf = cross(fc);
  out.push(`phrase <-> non-phrase: votes ${cv.length ? cap(cv, ([k, v]) => (v > 1 ? `${k} x${v}` : k)) : 'none'}; frames ${cf.length ? cap(cf, ([k, v]) => `${k} (${v})`) : 'none'}`);
  return out;
}

export function formatReport(res) {
  const cats = res.categories || {};
  const lines = [];
  const p = (s = '') => lines.push(s);
  const d = res.dataset;
  p(`Source: ${res.source}`);
  p(`Rules: current (recordingToFeatureRows, no budget) vs budget (${res.rule.name} v${res.rule.version}, budget ${res.rule.budget}, min ${res.rule.minRowsPerSample}/sample, ${res.rule.spacing})${res.queryRows ? `; queries scored on at most ${res.queryRows} evenly spaced rows each` : ''}`);
  if (res.noData) { p('no data'); res.notes.forEach((n) => p(`  ${n}`)); return lines.join('\n'); }
  p(`Data: ${d.signs} signs (${Object.entries(d.signsBySet).map(([k, v]) => `${v} ${k}`).join(', ')}), ${d.samples} samples (${d.v3} v3, ${d.withSigner} with a signer${d.signers.length ? ': ' + d.signers.join(', ') : ''}); samples per sign min ${d.samplesPerSign.min} / median ${d.samplesPerSign.median} / max ${d.samplesPerSign.max}${d.samplesPerSign.zero ? `, ${d.samplesPerSign.zero} sign(s) with no samples` : ''}`);
  for (const lang of LANGS) {
    const m = res.models[lang];
    p(`Model ${lang}: current ${m.current.rows} rows / ${m.current.labels} labels; budget ${m.budget.rows} rows / ${m.budget.labels} labels${m.usable ? '' : '  -- NOT USABLE (fewer than 2 labels)'}`);
  }
  if (res.sets.T2r && res.sets.T2r.rowsVid) p(`Model T2r (from videos): current ${res.sets.T2r.rowsVid.current} rows; budget ${res.sets.T2r.rowsVid.budget} rows`);
  p();
  p(`${pad('Set', 10)} ${pad('Rule', 8)} ${lpad('Queries', 7)} ${lpad('Vote', 13)} ${lpad('Frame', 16)}  ${CATS.map((c) => pad(c + ' vote', 16)).join(' ')}`);
  for (const name of res.order) {
    const s = res.sets[name];
    if (s.skipped) { p(`${pad(name, 10)} skipped: ${s.note}`); continue; }
    if (s.kind === 'top3') continue;
    for (const rn of ['current', 'budget']) {
      const r = s.results[rn];
      const cats = CATS.map((c) => { const b = r.byCat[c]; return pad(b ? `${fmtPct(b.voteOk, b.n)} (${b.voteOk}/${b.n})` : '-', 16); }).join(' ');
      p(`${pad(rn === 'current' ? name : '', 10)} ${pad(rn, 8)} ${lpad(r.n, 7)} ${lpad(`${fmtPct(r.voteOk, r.n)} (${r.voteOk}/${r.n})`, 13)} ${lpad(`${fmtPct(r.frameOk, r.frames)} (${r.frameOk}/${r.frames})`, 16)}  ${cats}`);
    }
    const c = s.results.current;
    const extra = Object.keys(c.byCat).filter((k) => !CATS.includes(k));
    if (extra.length) p(`${pad('', 10)} other categories (current): ${extra.map((k) => `${k} ${c.byCat[k].voteOk}/${c.byCat[k].n}`).join(', ')}`);
    if (c.missing.queries) p(`${pad('', 10)} sign missing from model: ${c.missing.queries} quer${c.missing.queries === 1 ? 'y' : 'ies'} (${c.missing.frames} frames) not scored; labels: ${c.missing.labels.join(', ')}`);
    if (c.noRows) p(`${pad('', 10)} ${c.noRows} quer${c.noRows === 1 ? 'y' : 'ies'} with no hand rows, not scored`);
    if (c.notUsable) p(`${pad('', 10)} ${c.notUsable} quer${c.notUsable === 1 ? 'y' : 'ies'} not scored: the model rebuilt without them had fewer than 2 labels`);
  }
  p();
  p('2-point rule (budget - current, vote points; sets with >= 20 queries):');
  for (const name of res.order) {
    const s = res.sets[name];
    if (s.skipped || s.kind === 'top3') continue;
    const dv = s.voteDelta === null ? '-' : (s.voteDelta >= 0 ? '+' : '') + s.voteDelta.toFixed(1);
    const df = s.frameDelta === null ? '-' : (s.frameDelta >= 0 ? '+' : '') + s.frameDelta.toFixed(1);
    p(`  ${pad(name, 10)} vote ${lpad(dv, 6)}  frame ${lpad(df, 6)}  ${s.twoPointRule}`);
  }
  for (const name of res.order) {
    const s = res.sets[name];
    if (!s.groups || !Object.keys(s.groups).length) continue;
    p();
    p(`${name} per held-out signer (vote; frame):`);
    for (const g of Object.keys(s.groups)) {
      const c = s.groups[g].current || emptyScore();
      const b = s.groups[g].budget || emptyScore();
      p(`  ${pad(g, 6)} queries ${lpad(c.n, 5)}  current ${fmtPct(c.voteOk, c.n)} (${c.voteOk}/${c.n}); ${fmtPct(c.frameOk, c.frames)}   budget ${fmtPct(b.voteOk, b.n)} (${b.voteOk}/${b.n}); ${fmtPct(b.frameOk, b.frames)}${c.missing.queries ? `   sign missing from model: ${c.missing.queries} quer${c.missing.queries === 1 ? 'y' : 'ies'} (${c.missing.labels.join(', ')})` : ''}${c.noRows ? `   no hand rows: ${c.noRows}` : ''}${c.notUsable ? `   not scored (model without ${g} has < 2 labels): ${c.notUsable}` : ''}`);
    }
    if (s.unsignedSamples) p(`  (${s.unsignedSamples} samples without a signer stay in every model and are never queries)`);
  }
  for (const name of res.order) {
    const s = res.sets[name];
    if (s.kind !== 'top3' || s.skipped) continue;
    p();
    p(`${name} (real video, sign unknown; segmentation ${s.segmentation.ok ? 'ok' : 'not ok: ' + s.segmentation.reason}, ${s.segmentation.reps.length} repetitions): top-3 per repetition`);
    for (const rn of ['current', 'budget']) {
      p(`  ${pad(rn, 8)} ${s.results[rn].map((r) => `[${r.n} rows] ${r.top.map(([l, n]) => `${l} ${n}`).join(', ')}`).join('  |  ')}`);
    }
    p(`  ${s.same ? 'same answer under both rules' : 'ANSWERS DIFFER between the rules'}`);
  }
  for (const name of res.order) {
    const s = res.sets[name];
    if (s.skipped || s.kind === 'top3') continue;
    const catOf = (label) => {
      const other = s.lang === 'ESL' ? 'FSL' : 'ESL';
      return own(cats[s.lang], label) || own(cats[other], label) || null;
    };
    p();
    p(`${name} confusions:`);
    for (const rn of ['current', 'budget']) confLines(s.results[rn], catOf).forEach((l) => p(`  ${pad(rn, 8)} ${l}`));
  }
  if (res.notes.length) { p(); res.notes.forEach((n) => p(`Note: ${n}`)); }
  p();
  p(`Timings: prepare ${res.timings.prepareMs} ms; ${Object.entries(res.timings.sets).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(', ')}; ${res.predictions} frame predictions scored; total ${(res.timings.totalMs / 1000).toFixed(1)} s`);
  return lines.join('\n');
}

// ---- CLI -----------------------------------------------------------------------------------

function readListingFile(file) {
  const buf = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
}

export function parseArgs(argv) {
  const o = { mode: 'fixture', sets: null, budget: null, json: null, signers: null, queryRows: null, reuse: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    const posInt = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new Error(`${a} must be a positive integer`); return n; };
    if (a === '--fixture') o.mode = 'fixture';
    else if (a === '--live') o.mode = 'live';
    else if (a === '--listing') { o.mode = 'listing'; o.listingFile = next(); }
    else if (a === '--budget') o.budget = posInt(next());
    else if (a === '--json') o.json = next();
    else if (a === '--sets') {
      o.sets = next().split(',').map((s) => s.trim()).filter(Boolean);
      const bad = o.sets.filter((s) => !ALL_SETS.includes(s));
      if (bad.length) throw new Error(`unknown set(s): ${bad.join(', ')} (known: ${ALL_SETS.join(', ')})`);
    } else if (a === '--signers') o.signers = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--query-rows') o.queryRows = posInt(next());
    else if (a === '--no-reuse') o.reuse = false;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

export async function main(argv) {
  const o = parseArgs(argv);
  let listing;
  let source;
  let readSigner = null;
  if (o.mode === 'fixture') {
    listing = loadFixtureListing();
    source = 'fixture (tests/compact-model/fixtures/dataset-2026-10-15.json.gz + videos-2026-10-15.json.gz)';
  } else if (o.mode === 'live') {
    const r = await fetch(LIVE_URL);
    if (!r.ok) throw new Error(`GET ${LIVE_URL} -> HTTP ${r.status}`);
    listing = await r.json();
    if (!listing || listing.success === false) throw new Error(`GET ${LIVE_URL} did not return a listing`);
    source = `live (${LIVE_URL}); videos: the frozen fixture, matched by sign key; signers: read from the sample files under ${REPO_ROOT}`;
    readSigner = readSignerFromDisk;
  } else {
    listing = readListingFile(o.listingFile);
    source = `listing ${o.listingFile}; videos: the frozen fixture, matched by sign key; signers: the listing's own signer field, else read from THIS machine's sample files under ${REPO_ROOT} (may not be where the listing came from)`;
    readSigner = readSignerFromDisk;
  }
  console.log('Running...');
  const res = await runAccuracy({
    listing,
    videos: loadFixtureVideos(),
    source,
    budget: o.budget,
    sets: o.sets,
    signers: o.signers,
    queryRows: o.queryRows,
    reuse: o.reuse,
    readSigner,
    log: (s) => console.log(s),
  });
  console.log();
  console.log(formatReport(res));
  if (o.json) {
    fs.writeFileSync(o.json, JSON.stringify(res, null, 1));
    console.log(`JSON written to ${o.json}`);
  }
  return res;
}

// Run as a script? Compare real paths, so a start through the C:\xampp\htdocs\SKR junction works.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('accuracy: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
