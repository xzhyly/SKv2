// DEBT 124: the rest -> first sign and last sign -> rest movements stay within the continuity limit
// (60 px per 40 ms, every drawn joint) whatever frame a clip starts or ends on, including a frame
// with no hand; auto-trim starts and ends on frames that have the raised arms' hands.
// Data: tests/avatar/fixtures/holistic-signs.json (committed Holistic output, no fresh run).
// Run: node --test tests/avatar/avatar-edges.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Rig, Clip, Retarget, Timeline, jointsOf, maxJump } from './helper.mjs';

const JUMP_MAX = 60;
const STEP_MS = 2;     // window start resolution: every 40 ms window, not only those on a 40 ms grid
const FX = JSON.parse(readFileSync(new URL('./fixtures/holistic-signs.json', import.meta.url), 'utf8'));
const sign = (video) => FX.signs.find((s) => s.video === video);
const hasHand = (f) => !!(f[1] || f[2]);

function prep(s, start, end) {
  return Retarget.prepare(Clip.buildClip({
    key: 'zz_edge', fps: FX.fps, video: { w: s.w, h: s.h, durationMs: s.durationMs }, frames: s.frames,
    trim: { start, end }, createdAt: '2026-10-14T00:00:00Z',
  }), Rig);
}

// Worst joint movement over any 40 ms window that overlaps transition segment s.
function worstAround(tl, s, step = STEP_MS) {
  let w = 0;
  for (let t = s.t0 - 40; t < s.t1; t += step) {
    w = Math.max(w, maxJump(tl.poseAt(Math.max(0, t)).pose, tl.poseAt(Math.min(tl.duration, t + 40)).pose));
  }
  return w;
}

// The frame right before the first detected hand / right after the last one, and one frame either side.
function edgeCases() {
  const out = [];
  for (const s of FX.signs) {
    const first = s.frames.findIndex(hasHand);
    const last = s.frames.length - 1 - [...s.frames].reverse().findIndex(hasHand);
    const upEnd = Clip.autoTrim(s.frames).end, upStart = Clip.autoTrim(s.frames).start;
    if (first > 0) for (const a of [first - 2, first - 1, first]) if (a >= 0) out.push({ s, start: a, end: upEnd, at: 'start', noHand: !hasHand(s.frames[a]) });
    if (last < s.frames.length - 1) for (const b of [last, last + 1, last + 2]) if (b < s.frames.length) out.push({ s, start: upStart, end: b, at: 'end', noHand: !hasHand(s.frames[b]) });
  }
  return out;
}

test('fixture: hello starts, how_are_you and my_name end, on a frame with no hand at some trim', () => {
  const cases = edgeCases();
  assert.ok(cases.some((c) => c.s.video === 'hello.webm' && c.at === 'start' && c.noHand));
  assert.ok(cases.some((c) => c.s.video === 'how_are_you.webm' && c.at === 'end' && c.noHand));
  // hello's old auto-trim started on the frame just before the hand (the DEBT 124 case)
  const h = sign('hello.webm');
  assert.equal(hasHand(h.frames[h.oldAutoTrim.start]), false);
  assert.equal(hasHand(h.frames[h.oldAutoTrim.start + 1]), true);
});

test('rest -> sign and sign -> rest stay within 60 px per 40 ms when a clip starts/ends on a no-hand frame, one frame earlier and later', () => {
  const rows = [];
  for (const c of edgeCases()) {
    const tl = Timeline.build([prep(c.s, c.start, c.end)], Rig);
    const [inSeg, , outSeg] = tl.segments;
    const wi = worstAround(tl, inSeg), wo = worstAround(tl, outSeg);
    rows.push(`${c.s.video} ${c.start}..${c.end}${c.noHand ? ' (' + c.at + ' no hand)' : ''}: in ${wi.toFixed(1)} / ${Math.round(inSeg.t1 - inSeg.t0)} ms, out ${wo.toFixed(1)} / ${Math.round(outSeg.t1 - outSeg.t0)} ms`);
    assert.ok(wi <= JUMP_MAX, rows.at(-1));
    assert.ok(wo <= JUMP_MAX, rows.at(-1));
    assert.ok(maxJump(tl.poseAt(inSeg.t1 - 1e-6).pose, inSeg.b) <= 0.5 && maxJump(tl.poseAt(outSeg.t0).pose, outSeg.a) <= 0.5);
  }
  console.log('[avatar-edges]\n  ' + rows.join('\n  '));
});

test('every trim start (and every 3rd end, clips of >= 7 frames) keeps both ends within 60 px per 40 ms', () => {
  const rows = [];
  for (const s of FX.signs) {
    let n = 0, max = 0;
    for (let a = 0; a < s.frames.length; a++) {
      for (let b = a + 6; b < s.frames.length; b += 3) {
        const tl = Timeline.build([prep(s, a, b)], Rig);
        const [inSeg, , outSeg] = tl.segments;
        const w = Math.max(worstAround(tl, inSeg, 5), worstAround(tl, outSeg, 5));
        assert.ok(w <= JUMP_MAX, `${s.video} ${a}..${b}: ${w.toFixed(1)}`);
        n++; max = Math.max(max, w);
      }
    }
    rows.push(`${s.video}: ${n} trims, worst ${max.toFixed(1)}`);
  }
  console.log('[avatar-edges] ' + rows.join('; '));
});

test('the 3-sign sentence of talk-avatar-check (old auto-trims) stays within 60 px per 40 ms at every transition', () => {
  const preps = FX.signs.map((s) => prep(s, s.oldAutoTrim.start, s.oldAutoTrim.end));
  const tl = Timeline.build(preps, Rig);
  tl.segments.filter((s) => s.kind !== 'clip').forEach((s) => assert.ok(worstAround(tl, s) <= JUMP_MAX, `${s.kind} ${s.word}`));
  const restJ = jointsOf(Retarget.restPose(Rig));
  assert.deepEqual(jointsOf(tl.poseAt(0).pose), restJ);
  assert.deepEqual(jointsOf(tl.poseAt(tl.duration).pose), restJ);
});

test('clipEdges: hello from the no-hand frame, or one earlier / later, plays from the same frame; nothing skipped on a calm clip', () => {
  const h = sign('hello.webm');
  const entries = [17, 18, 19].map((a) => a + Timeline.clipEdges(prep(h, a, h.oldAutoTrim.end), Rig).entry);
  assert.equal(new Set(entries).size, 1, JSON.stringify(entries));
  assert.ok(hasHand(h.frames[entries[0]]));
  const m = sign('my_name.webm');
  const p = prep(m, m.oldAutoTrim.start, m.oldAutoTrim.end);
  assert.deepEqual(Timeline.clipEdges(p, Rig), { entry: 0, exit: p.poses.length - 1 });
  // never more than half a clip at either end
  const short = prep(h, 17, 23);
  const e = Timeline.clipEdges(short, Rig);
  assert.ok(e.entry <= 3 && e.exit >= 3 && e.entry <= e.exit, JSON.stringify(e));
});

test('a transition the 700 ms cap would make too fast is lengthened to the 60 px limit', () => {
  const rest = Retarget.restPose(Rig);
  const far = Retarget.lerpPose(rest, rest, 0);
  far.arms.forEach((a, i) => { a.au -= (i ? -1 : 1) * 2.6; a.af -= (i ? -1 : 1) * 2.9; });
  const ms = Timeline.transitionMs(rest, far, Timeline.IN_MS, Rig);
  assert.ok(ms > 700, String(ms));
  const ease = (u) => u * u * (3 - 2 * u);
  let w = 0;
  for (let t = 0; t + 40 <= ms; t += STEP_MS) w = Math.max(w, maxJump(Retarget.lerpPose(rest, far, ease(t / ms)), Retarget.lerpPose(rest, far, ease((t + 40) / ms))));
  assert.ok(w <= JUMP_MAX, w.toFixed(1));
});

test('auto-trim starts and ends on frames whose raised arms have their hands; hello no longer depends on the run', () => {
  for (const s of FX.signs) {
    const t = Clip.autoTrim(s.frames);
    assert.ok(Clip.handsReady(s.frames[t.start]) && Clip.handsReady(s.frames[t.end]), s.video);
    assert.ok(t.start >= s.oldAutoTrim.start && t.end <= s.oldAutoTrim.end, s.video);
  }
  const h = sign('hello.webm');
  assert.deepEqual(Clip.autoTrim(h.frames), { start: h.oldAutoTrim.start + 1, end: h.oldAutoTrim.end });
  // the same video with the hand found one frame earlier or one later: the clip starts where the hand is
  for (const shift of [-1, 1]) {
    const f = h.frames.map((x) => x.slice());
    const first = f.findIndex(hasHand);
    if (shift < 0) f[first - 1] = [f[first - 1][0], f[first][1], f[first][2]];
    else f[first] = [f[first][0], null, null];
    const t = Clip.autoTrim(f);
    assert.equal(t.start, f.findIndex((x, i) => i >= h.oldAutoTrim.start - 1 && Clip.handsReady(x)), `shift ${shift}`);
  }
});

test('auto-trim: a raised arm without a hand is skipped, at most 8 frames; no hand at all keeps the raised range', () => {
  const down = [[0.5, 0.2, 0, 1], [0.6, 0.2, 0, 1], [0.4, 0.2, 0, 1], [0.6, 0.5, 0, 1], [0.4, 0.5, 0, 1],
    [0.65, 0.7, 0, 1], [0.35, 0.7, 0, 1], [0.65, 0.95, 0, 1], [0.35, 0.95, 0, 1], [0.6, 1.0, 0, 1], [0.4, 1.0, 0, 1]];
  const up = down.map((p) => p.slice());
  up[Clip.P.wrR] = [0.35, 0.6, 0, 1];                    // arm 0 (signer's right) raised
  const hand = Array.from({ length: 21 }, () => [0.35, 0.6, 0]);
  const noHand = [up, null, null], withHand = [up, null, hand], wrongHand = [up, hand, null];
  const D = [down, null, null];
  assert.deepEqual(Clip.autoTrim([D, noHand, noHand, withHand, withHand, withHand, noHand, D]), { start: 3, end: 5 });
  assert.deepEqual(Clip.autoTrim([D, noHand, wrongHand, withHand, withHand, withHand, withHand, D]), { start: 3, end: 6 });
  // an end moves at most half the raised range
  assert.deepEqual(Clip.autoTrim([D, noHand, wrongHand, withHand, withHand, D]), { start: 1, end: 4 });
  assert.deepEqual(Clip.autoTrim([D, noHand, noHand, noHand, noHand, D]), { start: 1, end: 4 });
  const long = [D, ...Array(10).fill(noHand), ...Array(30).fill(withHand), D];
  assert.deepEqual(Clip.autoTrim(long), { start: 1, end: 40 });   // no hand within 8 frames: unchanged
});
