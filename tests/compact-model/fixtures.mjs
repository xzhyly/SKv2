// Shared helpers for the compact-model tests: read the frozen fixtures in ./fixtures/ (never live
// saved_gestures/, see fixtures/README.md) and load the real js/gesture-data.js under node.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadGestureData } from '../video-capture/load-gesture-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const require = createRequire(import.meta.url);

function readGzJson(name) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES_DIR, name))).toString('utf8'));
}

// The frozen `GET php/api/save_gesture.php?no_sync=1` response: { success, datasetRoot, gestures,
// signs, categories }.
export function loadFixtureListing() {
  return readGzJson('dataset-2026-10-15.json.gz');
}

// { "<sub>__<key>": { durationMs, frames } } - en__<key> (120 sign clips) and real__P_real.
export function loadFixtureVideos() {
  return readGzJson('videos-2026-10-15.json.gz');
}

// The Step 1 numbers pinned on these fixtures.
export function loadExpected() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'expected-2026-10-15.json'), 'utf8'));
}

function gestureDataSource() {
  return fs.readFileSync(path.join(REPO_ROOT, 'js', 'gesture-data.js'), 'utf8');
}

// The real, unchanged GestureDataRecorder.recordingToFeatureRows.
export function loadToRows() {
  return loadGestureData(gestureDataSource()).recordingToFeatureRows;
}

// A fresh GestureDataRecorder whose fetch returns `listing` for the save_gesture.php GET, already
// loaded through its own loadSavedGestureDataset (so its state.signs/categories are the listing's,
// exactly as on a kiosk page). Returns { G, gestures }. The fetch stub is installed by appending one line to the source:
// load-gesture-data.mjs's context fetch always rejects and it does not expose the context.
export async function loadGestureDataWithListing(listing) {
  const G = loadGestureData(
    gestureDataSource() +
      '\n;window.GestureDataRecorder.__setTestFetch = function (f) { globalThis.fetch = f; };\n'
  );
  G.__setTestFetch(async () => ({ ok: true, status: 200, json: async () => listing }));
  const gestures = await G.loadSavedGestureDataset(true);
  return { G, gestures };
}

// js/knn-compile.js under node (module.exports).
export function loadKnnCompile() {
  return require(path.join(REPO_ROOT, 'js', 'knn-compile.js'));
}

// The kiosk's own cosineSimilarity + knnPredict text (js/sign-to-text-ui.js, between
// `function cosineSimilarity` and `async function autoTrainForTranslate`), unchanged, behind a model setter.
export function makeKioskKnn() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'js', 'sign-to-text-ui.js'), 'utf8').split('\n');
  const a = src.findIndex((l) => l.startsWith('function cosineSimilarity'));
  const b = src.findIndex((l, i) => i > a && l.startsWith('async function autoTrainForTranslate'));
  if (a < 0 || b < 0) throw new Error('knnPredict text not found in js/sign-to-text-ui.js');
  const text = src.slice(a, b).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(text + '\nlet knnModel = null;\nreturn { set(m) { knnModel = m; }, predict: knnPredict };')();
}
