// Tests for js/video-landmarks.js's seekTimes(duration, fps): the pure seek-time grid
// extractVideoLandmarks() walks. Pulled out specifically so the "exactly Math.ceil(d*fps)
// steps, no float-drift off-by-one" property can be checked directly under node, without
// spinning up a browser (fix round 1, review item 1 + "cheap" test item).
//
// js/video-landmarks.js is a plain <script> that also sets module.exports under node (guarded
// by `typeof module !== 'undefined'`, same pattern as js/capture-core.js), so it's loaded
// here with createRequire() rather than import. Its other export, extractVideoLandmarks, is
// DOM-dependent and not exercised here - only the pure grid helper is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { seekTimes } = require('../../js/video-landmarks.js');

const FPS = 15;

test('seekTimes produces exactly Math.ceil(duration*fps) steps for several durations', () => {
  for (const duration of [1, 2, 10, 20, 11.98]) {
    const times = seekTimes(duration, FPS);
    const expected = Math.ceil(duration * FPS);
    assert.equal(times.length, expected, `duration=${duration}`);
  }
});

test('seekTimes(2, 15) gives exactly 30 steps, not 31 (the reviewer-measured float-drift off-by-one)', () => {
  const times = seekTimes(2, 15);
  assert.equal(times.length, 30);
});

test('seekTimes(20, 15) gives exactly 300 steps, not 301', () => {
  const times = seekTimes(20, 15);
  assert.equal(times.length, 300);
});

test('every step is exactly k/fps (no accumulated float drift) and the grid is strictly increasing', () => {
  const times = seekTimes(11.98, FPS);
  times.forEach((t, k) => {
    assert.equal(t, k / FPS, `step ${k}`);
  });
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] > times[i - 1], `step ${i} > step ${i - 1}`);
  }
});

test('first step is always 0', () => {
  assert.equal(seekTimes(5, FPS)[0], 0);
});

test('duration 0 gives zero steps', () => {
  assert.deepEqual(seekTimes(0, FPS), []);
});

test('module exports under node via module.exports (createRequire)', () => {
  assert.equal(typeof seekTimes, 'function');
});
