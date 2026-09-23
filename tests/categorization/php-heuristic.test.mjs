// Tests for php/api/gesture_category.php's pure heuristic functions.
// Runs PHP CLI, requiring the file fresh and calling gesture_category()/valid_gesture_category()
// over the frozen fixture plus documented edge cases. No DB, no side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const PHP = process.env.SK_PHP_CLI || 'C:\\xampp\\php\\php.exe';
const TARGET = path.join(repo, 'php', 'api', 'gesture_category.php');
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'labels-2026-09-23.json'), 'utf8'));

function runPhp(code) {
  const script = `require ${JSON.stringify(TARGET)}; ${code}`;
  const r = spawnSync(PHP, ['-r', script], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('PHP failed: ' + r.stderr + r.stdout);
  }
  return r.stdout;
}

function categorize(labels) {
  const php = `
    $labels = json_decode(${JSON.stringify(JSON.stringify(labels))}, true);
    $out = [];
    foreach ($labels as $l) { $out[] = gesture_category($l); }
    echo json_encode($out);
  `;
  return JSON.parse(runPhp(php));
}

function countBy(cats) {
  const counts = { word: 0, letter: 0, number: 0, phrase: 0 };
  for (const c of cats) counts[c] = (counts[c] || 0) + 1;
  return counts;
}

test('ESL fixture distribution matches the frozen measurement', () => {
  const cats = categorize(fixture.ESL);
  assert.deepEqual(countBy(cats), { word: 67, letter: 26, number: 10, phrase: 17 });
});

test('FSL fixture distribution matches the frozen measurement', () => {
  const cats = categorize(fixture.FSL);
  assert.deepEqual(countBy(cats), { word: 50, letter: 0, number: 10, phrase: 29 });
});

test('gesture_category edge cases', () => {
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
  const labels = Object.keys(cases);
  const cats = categorize(labels);
  labels.forEach((l, i) => {
    assert.equal(cats[i], cases[l], `label ${JSON.stringify(l)} should be ${cases[l]}, got ${cats[i]}`);
  });
});

test('GESTURE_CATEGORIES constant has the four categories in order', () => {
  const out = runPhp('echo json_encode(GESTURE_CATEGORIES);');
  assert.deepEqual(JSON.parse(out), ['word', 'letter', 'number', 'phrase']);
});

test('valid_gesture_category trims/lowercases and validates', () => {
  const php = `
    var_dump(valid_gesture_category('Phrase '));
    var_dump(valid_gesture_category('verb'));
    var_dump(valid_gesture_category(null));
  `;
  const out = runPhp(php);
  assert.match(out, /string\(6\) "phrase"/);
  assert.match(out, /NULL/);
  // three var_dumps: phrase (string), verb (NULL), null (NULL)
  const nullCount = (out.match(/NULL/g) || []).length;
  assert.equal(nullCount, 2);
});
