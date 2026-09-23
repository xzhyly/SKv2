// Parity test: js/gesture-category.js's GestureCategory.guess() must return exactly what
// php/api/gesture_category.php's gesture_category() returns, for every label. Also checks the
// JS distribution over the frozen fixture matches "The heuristic" section of the plan.
//
// js/gesture-category.js is a plain <script> for the browser (no module system), so it is
// loaded here with node:vm against a minimal sandbox instead of require()'d.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const PHP = process.env.SK_PHP_CLI || 'C:\\xampp\\php\\php.exe';
const PHP_TARGET = path.join(repo, 'php', 'api', 'gesture_category.php');
const JS_TARGET = path.join(repo, 'js', 'gesture-category.js');
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'labels-2026-09-23.json'), 'utf8'));

function loadGestureCategory() {
  if (!fs.existsSync(JS_TARGET)) {
    throw new Error(`missing ${JS_TARGET}`);
  }
  const src = fs.readFileSync(JS_TARGET, 'utf8');
  const sandbox = { module: undefined, window: undefined, globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: JS_TARGET });
  const GestureCategory = sandbox.window ? sandbox.window.GestureCategory : sandbox.GestureCategory;
  if (!GestureCategory || typeof GestureCategory.guess !== 'function') {
    throw new Error('js/gesture-category.js did not define window.GestureCategory.guess');
  }
  return GestureCategory;
}

function phpCategorize(labels) {
  const script = `
    require ${JSON.stringify(PHP_TARGET)};
    $labels = json_decode(${JSON.stringify(JSON.stringify(labels))}, true);
    $out = [];
    foreach ($labels as $l) { $out[] = gesture_category($l); }
    echo json_encode($out);
  `;
  const r = spawnSync(PHP, ['-r', script], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('PHP failed: ' + r.stderr + r.stdout);
  }
  return JSON.parse(r.stdout);
}

function countBy(cats) {
  const counts = { word: 0, letter: 0, number: 0, phrase: 0 };
  for (const c of cats) counts[c] = (counts[c] || 0) + 1;
  return counts;
}

function onDiskLabels() {
  const dirs = [
    ['saved_gestures', 'ESL'],
    ['saved_gestures_fsl', 'FSL'],
  ];
  const labels = [];
  for (const [dir] of dirs) {
    const full = path.join(repo, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isDirectory()) labels.push(entry.name);
    }
  }
  return labels;
}

test('JS guess() matches PHP gesture_category() for the frozen ESL/FSL fixture', () => {
  const GestureCategory = loadGestureCategory();
  const allLabels = [...fixture.ESL, ...fixture.FSL];
  const phpCats = phpCategorize(allLabels);
  allLabels.forEach((label, i) => {
    assert.equal(GestureCategory.guess(label), phpCats[i], `label ${JSON.stringify(label)}`);
  });
});

test('JS guess() matches PHP gesture_category() for every label folder currently on disk', () => {
  const GestureCategory = loadGestureCategory();
  const labels = onDiskLabels();
  assert.ok(labels.length > 0, 'expected at least one on-disk label folder');
  const phpCats = phpCategorize(labels);
  labels.forEach((label, i) => {
    assert.equal(GestureCategory.guess(label), phpCats[i], `label ${JSON.stringify(label)}`);
  });
});

test('JS guess() matches PHP gesture_category() for the Task 1 edge cases', () => {
  const GestureCategory = loadGestureCategory();
  const cases = {
    '': 'word',
    '7': 'number',
    '42': 'number',
    'a': 'letter',
    'z': 'letter',
    'ab': 'word',
    'nag-aantok': 'word',
    'how_are_you': 'phrase',
    'one_more': 'phrase',
    'isa': 'number',
    'sampu': 'number',
  };
  Object.entries(cases).forEach(([label, expected]) => {
    assert.equal(GestureCategory.guess(label), expected, `label ${JSON.stringify(label)}`);
  });
});

test('ESL fixture distribution via JS guess() matches the frozen measurement', () => {
  const GestureCategory = loadGestureCategory();
  const cats = fixture.ESL.map((l) => GestureCategory.guess(l));
  assert.deepEqual(countBy(cats), { word: 67, letter: 26, number: 10, phrase: 17 });
});

test('FSL fixture distribution via JS guess() matches the frozen measurement', () => {
  const GestureCategory = loadGestureCategory();
  const cats = fixture.FSL.map((l) => GestureCategory.guess(l));
  assert.deepEqual(countBy(cats), { word: 50, letter: 0, number: 10, phrase: 29 });
});

test('CATEGORIES constant has the four categories in order', () => {
  const GestureCategory = loadGestureCategory();
  // Array.from: CATEGORIES is a vm-sandbox-realm array; its prototype differs from this
  // realm's Array.prototype, which trips assert's reference-equality check on nested objects.
  assert.deepEqual(Array.from(GestureCategory.CATEGORIES), ['word', 'letter', 'number', 'phrase']);
});
