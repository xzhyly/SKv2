import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { callEndpoint, cleanupProbe, ffmpegRuns, fixtureFrames, fixtureVideo, sampleFiles, videoPath, repo, LABEL } from './harness.mjs';

const log = path.join(os.tmpdir(), 'sk-ffmpeg-calls.log');
const save = (extra = {}, env = {}) => callEndpoint({ logFile: log, extraEnv: env,
  body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3), video_base64: fixtureVideo(), ...extra } });

beforeEach(() => { cleanupProbe(); fs.rmSync(log, { force: true }); });
after(() => cleanupProbe());

test('first sample of a new word transcodes once and writes <label>.mp4', () => {
  const r = save();
  assert.equal(r.success, true);
  assert.equal(ffmpegRuns(log), 1);
  assert.ok(fs.statSync(videoPath('mp4')).size > 0);
  assert.equal(r.videoAsset, `assets/signs/en/${LABEL}.mp4`);
});

test('samples 2-5 of the same word do not run ffmpeg and do not touch the clip', () => {
  save();
  const before = fs.statSync(videoPath('mp4'));
  for (let n = 2; n <= 5; n++) {
    const r = save();
    assert.equal(r.success, true);
    assert.equal(r.videoSkipped, true, `sample ${n} must report videoSkipped`);
    assert.equal(r.labelSampleCount, n);
  }
  assert.equal(ffmpegRuns(log), 1, 'exactly one ffmpeg run across five saves');
  const after = fs.statSync(videoPath('mp4'));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('landmarks are saved on every sample, skipped video or not', () => {
  for (let n = 1; n <= 5; n++) assert.equal(save().frameCount, 3);
  const files = sampleFiles();
  assert.equal(files.length, 5);
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(repo, 'saved_gestures', LABEL, f), 'utf8'));
    assert.equal(j.frames.length, 3);
  }
});

test('gestures[label].length grows by one per save (dataset GET)', () => {
  const count = () => (callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false }).gestures[LABEL] || []).length;
  assert.equal(count(), 0);
  save(); assert.equal(count(), 1);
  save(); assert.equal(count(), 2);
});

test('backward compat: a word that already has <label>.mp4 is not re-transcoded', () => {
  save({ video_base64: undefined });                     // legacy word: samples exist, no video from this run
  fs.copyFileSync(path.join(path.dirname(videoPath('mp4')), 'help.webm'), videoPath('mp4')); // pre-existing clip
  const r = save();
  assert.equal(r.videoSkipped, true);
  assert.equal(ffmpegRuns(log), 0);
});

test('backward compat: a word that only has <label>.webm counts as having a video', () => {
  save({ video_base64: undefined });
  fs.copyFileSync(path.join(path.dirname(videoPath('mp4')), 'help.webm'), videoPath('webm'));
  assert.equal(save().videoSkipped, true);
  assert.equal(ffmpegRuns(log), 0);
  assert.equal(fs.existsSync(videoPath('mp4')), false);
});

test('delete then re-record: the first sample after a delete transcodes again (no stale clip)', () => {
  save();
  callEndpoint({ body: { action: 'delete_gesture', label: LABEL }, stub: false }); // leaves the .mp4 behind, as today
  fs.rmSync(log, { force: true });
  const r = save();
  assert.equal(r.videoSkipped, false);
  assert.equal(ffmpegRuns(log), 1);
});

test('fallback: ffmpeg failing still saves a raw .webm, and the next sample skips', () => {
  const first = save({}, { SK_STUB_FAIL: '1' });
  assert.equal(first.success, true);
  assert.equal(first.videoAsset, `assets/signs/en/${LABEL}.webm`);
  assert.ok(fs.statSync(videoPath('webm')).size > 0);
  assert.equal(fs.existsSync(videoPath('mp4')), false);
  const runsAfterFirst = ffmpegRuns(log);
  const second = save({}, { SK_STUB_FAIL: '1' });
  assert.equal(second.videoSkipped, true);
  assert.equal(ffmpegRuns(log), runsAfterFirst, 'no further ffmpeg attempt on sample 2');
});
