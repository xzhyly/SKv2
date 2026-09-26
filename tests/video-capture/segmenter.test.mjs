// Tests for js/capture-core.js: the pure, DOM-free hand-presence segmenter used by both the
// live recording UI and the offline video-segmentation pass. js/capture-core.js is a plain
// <script> that also sets module.exports under node (guarded by `typeof module !== 'undefined'`),
// so it's loaded here with createRequire() rather than import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CAPTURE, createSegmenter, segmentFrames } = require('../../js/capture-core.js');

const STEP = 1000 / CAPTURE.PROCESS_FPS; // ~66.667ms, the processing grid step

// Builds a synthetic frame sequence at the 1000/PROCESS_FPS grid from a list of
// { ms, hand } segments (each segment's duration in ms, hand-present or not).
function buildFrames(segments) {
  const bounds = [];
  let acc = 0;
  for (const seg of segments) {
    bounds.push({ start: acc, end: acc + seg.ms, hand: seg.hand });
    acc += seg.ms;
  }
  const total = acc;
  const frames = [];
  for (let i = 0; ; i++) {
    const t = Math.round(i * STEP);
    if (t > total) break;
    let hand = bounds[bounds.length - 1].hand;
    for (const b of bounds) {
      if (t >= b.start && t < b.end) {
        hand = b.hand;
        break;
      }
    }
    if (t === total) hand = bounds[bounds.length - 1].hand;
    frames.push({ t, handPresent: hand });
  }
  return frames;
}

// A standard "clean 3 reps" sequence: 1200ms initial rest, then 3x (2000ms hand, 1200ms gap).
function threeCleanReps() {
  return buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
  ]);
}

function pushAll(seg, frames) {
  for (const f of frames) seg.push(f.t, f.handPresent);
}

test('CAPTURE is frozen and has the exact documented values', () => {
  assert.equal(Object.isFrozen(CAPTURE), true);
  assert.deepEqual(CAPTURE, {
    REST_MS: 1000,
    MIN_REP_MS: 300,
    MAX_REP_MS: 20000,
    NO_HAND_HINT_MS: 10000,
    REQUIRED_REPS: 3,
    PROCESS_FPS: 15,
    STOP_TAIL_MS: 500,
    MAX_FRAMES_PER_REP: 301,
  });
  assert.equal(CAPTURE.MAX_FRAMES_PER_REP, Math.floor(CAPTURE.MAX_REP_MS / (1000 / CAPTURE.PROCESS_FPS)) + 1);
  assert.throws(() => {
    CAPTURE.REST_MS = 5;
  }, TypeError);
});

test('exactly 3 clean reps -> ok with 3 reps, correct start/end/indices', () => {
  const frames = threeCleanReps();
  const result = segmentFrames(frames);
  assert.equal(result.ok, true);
  assert.equal(result.reps.length, 3);
  result.reps.forEach((rep, i) => {
    assert.equal(rep.index, i + 1);
    assert.ok(rep.startMs < rep.endMs, `rep ${i + 1} startMs < endMs`);
    assert.ok(frames[rep.startFrame].handPresent, `rep ${i + 1} startFrame is hand-present`);
    assert.ok(frames[rep.endFrame].handPresent, `rep ${i + 1} endFrame is hand-present`);
    assert.equal(frames[rep.startFrame].t, rep.startMs);
    assert.equal(frames[rep.endFrame].t, rep.endMs);
    const span = rep.endMs - rep.startMs;
    assert.ok(span >= CAPTURE.MIN_REP_MS && span <= CAPTURE.MAX_REP_MS, `rep ${i + 1} span in range`);
  });
  // reps are in time order and non-overlapping
  for (let i = 1; i < result.reps.length; i++) {
    assert.ok(result.reps[i].startMs > result.reps[i - 1].endMs);
  }
});

test('a hand blip under MIN_REP_MS is ignored; still ends up with exactly 3 reps', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false }, // initial rest
    { ms: 100, hand: true }, // blip, < MIN_REP_MS(300)
    { ms: 1200, hand: false }, // closes the blip run (ignored) -> wait-hand
    { ms: 2000, hand: true }, // rep 1
    { ms: 1200, hand: false },
    { ms: 2000, hand: true }, // rep 2
    { ms: 1200, hand: false },
    { ms: 2000, hand: true }, // rep 3
    { ms: 1200, hand: false },
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, true);
  assert.equal(result.reps.length, 3);
  assert.deepEqual(result.reps.map((r) => r.index), [1, 2, 3]);
});

test('a blip is observed live as blip-ignored, same repIndex continues', () => {
  const seg = createSegmenter();
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 100, hand: true },
    { ms: 1200, hand: false },
  ]);
  let sawBlip = false;
  for (const f of frames) {
    const r = seg.push(f.t, f.handPresent);
    if (r.event === 'blip-ignored') {
      sawBlip = true;
      assert.equal(r.repIndex, 1);
      assert.equal(r.phase, 'wait-hand');
    }
  }
  assert.ok(sawBlip, 'expected a blip-ignored event');
  assert.equal(seg.reps().length, 0);
});

test('a no-hand gap shorter than REST_MS inside a rep does not split it', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false }, // initial rest
    { ms: 500, hand: true },
    { ms: 400, hand: false }, // gap < REST_MS(1000): must not close the rep
    { ms: 500, hand: true },
    { ms: 1200, hand: false }, // real close
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-few-reps');
  assert.equal(result.repsFound, 1);
  const rep = result.reps[0];
  // the rep spans from the first hand frame to the LAST hand frame (across the short gap),
  // not just the first 500ms block.
  const firstHandT = 1200;
  const lastHandFrame = [...frames].reverse().find((f) => f.handPresent);
  assert.equal(rep.startMs, firstHandT);
  assert.equal(rep.endMs, lastHandFrame.t);
});

test('a rep longer than MAX_REP_MS fails with rep-too-long', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: CAPTURE.MAX_REP_MS + 500, hand: true },
    { ms: 1200, hand: false },
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rep-too-long');
});

test('rep-too-long is observed live with phase failed and failReason set', () => {
  const seg = createSegmenter();
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: CAPTURE.MAX_REP_MS + 500, hand: true },
  ]);
  let failedEvent = null;
  for (const f of frames) {
    const r = seg.push(f.t, f.handPresent);
    if (r.event === 'rep-too-long') failedEvent = r;
  }
  assert.ok(failedEvent, 'expected a rep-too-long event');
  assert.equal(failedEvent.phase, 'failed');
  assert.equal(seg.state().failReason, 'rep-too-long');
  // failed is terminal: further pushes return it unchanged
  const before = seg.state();
  const r2 = seg.push(before.phaseStartMs + 100000, false);
  assert.equal(r2.phase, 'failed');
  assert.equal(r2.event, null);
});

test('only 2 completed reps -> too-few-reps', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-few-reps');
  assert.equal(result.repsFound, 2);
});

test('4 completed reps -> too-many-reps', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true }, // extra 4th rep, fully closed
    { ms: 1200, hand: false },
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-many-reps');
  assert.equal(result.repsFound, 4);
  assert.equal(result.reps[3].index, 4);
});

test('an open extra rep (past done) with span >= MIN_REP_MS at end-of-stream is too-many-reps', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false }, // -> done
    { ms: 500, hand: true }, // extra rep starts, span 500ms >= MIN_REP_MS, never closes
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-many-reps');
  assert.equal(result.repsFound, 3);
});

test('an open extra rep (past done) with span < MIN_REP_MS at end-of-stream does not count as too-many', () => {
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 1200, hand: false }, // -> done
    { ms: 50, hand: true }, // tiny extra blip, span < MIN_REP_MS
  ]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, true);
  assert.equal(result.reps.length, 3);
});

test('hands present from the start and never lowered -> no-rest', () => {
  const frames = buildFrames([{ ms: 5000, hand: true }]);
  const result = segmentFrames(frames);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-rest');
  assert.equal(result.repsFound, 0);
});

test('finish(endMs) closes a rep whose last no-hand frame is < REST_MS from lastHand but endMs is >= REST_MS', () => {
  const seg = createSegmenter();
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 400, hand: false }, // gap < REST_MS at end of stream; rep stays open after these pushes
  ]);
  pushAll(seg, frames);
  const beforeFinish = seg.state();
  assert.equal(beforeFinish.phase, 'rep', 'rep should still be open (gap did not reach REST_MS)');
  const lastT = frames[frames.length - 1].t;
  const endMs = lastT + (CAPTURE.REST_MS - 400) + 50; // pushes gap total past REST_MS
  const r = seg.finish(endMs);
  assert.equal(r.event, 'rep-ended');
  assert.equal(r.phase, 'wait-hand');
  const reps = seg.reps();
  assert.equal(reps.length, 1);
  assert.equal(reps[0].endMs, beforeFinish.lastHandMs);
});

test('finish(endMs) leaves an open rep uncounted when the gap still does not reach REST_MS', () => {
  const seg = createSegmenter();
  const frames = buildFrames([
    { ms: 1200, hand: false },
    { ms: 2000, hand: true },
    { ms: 100, hand: false },
  ]);
  pushAll(seg, frames);
  const lastT = frames[frames.length - 1].t;
  const r = seg.finish(lastT + 50); // still short of REST_MS since lastHand
  assert.equal(r.phase, 'rep');
  assert.equal(r.event, null);
  assert.equal(seg.reps().length, 0);
});

test('live push() one-by-one matches segmentFrames() offline result (parity)', () => {
  const frames = threeCleanReps();

  const seg = createSegmenter();
  pushAll(seg, frames);
  const finishResult = seg.finish(frames[frames.length - 1].t);
  const liveReps = seg.reps();

  const offline = segmentFrames(frames);

  assert.equal(offline.ok, true);
  assert.equal(liveReps.length, offline.reps.length);
  liveReps.forEach((rep, i) => {
    assert.equal(rep.index, offline.reps[i].index);
    assert.equal(rep.startMs, offline.reps[i].startMs);
    assert.equal(rep.endMs, offline.reps[i].endMs);
  });
  assert.equal(finishResult.phase, 'done');
});

test('the REST_MS gap that ends a rep IS the following rest: wait-hand -> rep starts on the very next hand frame', () => {
  const seg = createSegmenter();
  // Initial rest, then rep 1.
  let t = 0;
  let r;
  r = seg.push(t, false);
  t += CAPTURE.REST_MS + 50;
  r = seg.push(t, false); // rest-reached
  assert.equal(r.event, 'rest-reached');
  t += STEP;
  r = seg.push(t, true); // rep-started
  assert.equal(r.event, 'rep-started');
  const repStart = t;
  t += 2000;
  r = seg.push(t, true); // still in rep
  const lastHand = t;
  t += CAPTURE.REST_MS; // gap of exactly REST_MS -> closes rep 1, goes straight to wait-hand
  r = seg.push(t, false);
  assert.equal(r.event, 'rep-ended');
  assert.equal(r.phase, 'wait-hand');
  assert.equal(r.repIndex, 2);
  // The very next frame (only one PROCESS_FPS step later, nowhere near another full REST_MS)
  // being hand-present must start rep 2 immediately - no extra rest wait.
  t += STEP;
  r = seg.push(t, true);
  assert.equal(r.event, 'rep-started');
  assert.equal(r.phase, 'rep');
  assert.equal(r.repIndex, 2);
});

test('state() reports repsDone, phaseStartMs and lastHandMs sensibly through a full run', () => {
  const seg = createSegmenter();
  const frames = threeCleanReps();
  pushAll(seg, frames);
  seg.finish(frames[frames.length - 1].t);
  const st = seg.state();
  assert.equal(st.phase, 'done');
  assert.equal(st.repIndex, CAPTURE.REQUIRED_REPS);
  assert.equal(st.repsDone, CAPTURE.REQUIRED_REPS);
  assert.equal(st.failReason, null);
});

test('an extra rep after done is counted with repIndex REQUIRED_REPS+1', () => {
  const seg = createSegmenter();
  const frames = threeCleanReps();
  pushAll(seg, frames);
  assert.equal(seg.state().phase, 'done');
  const lastT = frames[frames.length - 1].t;
  const extra = buildFrames([{ ms: 2000, hand: true }]).map((f) => ({ t: f.t + lastT, handPresent: f.handPresent }));
  let startedEvent = null;
  for (const f of extra) {
    const r = seg.push(f.t, f.handPresent);
    if (r.event === 'rep-started') startedEvent = r;
  }
  assert.ok(startedEvent);
  assert.equal(startedEvent.repIndex, CAPTURE.REQUIRED_REPS + 1);
  seg.finish(extra[extra.length - 1].t + CAPTURE.REST_MS + 50);
  const reps = seg.reps();
  assert.equal(reps.length, CAPTURE.REQUIRED_REPS + 1);
  assert.equal(reps[3].index, CAPTURE.REQUIRED_REPS + 1);
});

test('module exports under node via module.exports (createRequire)', () => {
  assert.equal(typeof CAPTURE, 'object');
  assert.equal(typeof createSegmenter, 'function');
  assert.equal(typeof segmentFrames, 'function');
});
