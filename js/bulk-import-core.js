// js/bulk-import-core.js
// The pure part of bulk-import.html (docs/reports/2026-10-13-bulk-import-step1.md): file-name
// parsing, the strings the video / sample ids are hashed from, per-repetition summaries, the best
// repetition and its Holistic window, the avatar candidate clip, sign mapping, review status,
// projected model rows, default-signer assignment and the sample-count imbalance warning.
// Pure: no DOM, no fetch, no crypto, no clock. Attaches window.BulkImportCore, and module.exports
// under node.
(function () {
  'use strict';

  var SETS = ['ESL', 'FSL', 'BOTH'];
  var VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', '3gp'];
  var SIGNER_RE = /^P(0[1-9]|[1-9][0-9])$/i;
  // <SET>_<label>_<SIGNER>.<ext>; the label is everything between the first "_" and the last "_".
  var NAME_RE = /^(ESL|FSL|BOTH)_(.+)_(P(?:0[1-9]|[1-9][0-9]))\.([a-z0-9]+)$/i;
  var REQUIRED_REPS = 3;       // GestureCaptureCore.CAPTURE.REQUIRED_REPS (js/capture-core.js:15)
  var MAX_ROWS_PER_REP = 30;   // MAX_ROWS_PER_RAW_SAMPLE (js/gesture-data.js:4)
  var REST_MS = 1000;           // GestureCaptureCore.CAPTURE.REST_MS (js/capture-core.js:11)
  var BAD_NAME = 'bad file name';

  // obj[key] for a plain data object: only its own keys ("constructor" is a valid sign key).
  function own(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  }
  function upper(v) { return String(v === undefined || v === null ? '' : v).toUpperCase(); }

  // Same rule as cleanLabel() in js/gesture-data.js:112-119 (and clean_label() in sign_meta.php).
  function cleanLabel(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/^[_-]+|[_-]+$/g, '');
  }

  // "ESL_how_are_you_P01.mp4" -> {ok:true, set:'ESL', label:'how_are_you', key:'how_are_you',
  // signer:'P01', ext:'mp4'}. Anything else -> {ok:false, reason:'bad file name'}; never guessed.
  function parseName(fileName) {
    var m = NAME_RE.exec(String(fileName || ''));
    if (!m) return { ok: false, reason: BAD_NAME };
    var ext = m[4].toLowerCase();
    var key = cleanLabel(m[2]);
    if (VIDEO_EXT.indexOf(ext) < 0 || !key) return { ok: false, reason: BAD_NAME };
    return { ok: true, set: m[1].toUpperCase(), label: m[2], key: key, signer: m[3].toUpperCase(), ext: ext };
  }

  // The strings to hash (SHA-256, first 32 hex chars): the cache identity of a video file, and the
  // identity of one saved sample (file + repetition). file: {name, size, lastModified}.
  function videoIdSource(file) { return file.name + '|' + file.size + '|' + file.lastModified; }
  function importIdSource(file, repIndex) { return file.name + '|' + file.size + '|' + repIndex; }

  // handsResult: {frames:[{t, hands:[...]}]} of VideoLandmarks.extractVideoLandmarks; seg: the
  // result of GestureCaptureCore.segmentFrames on those frames. One line per repetition; the frames
  // of a rep are the ones the live capture saves (js/gesture-capture-ui.js:613).
  function summarizeReps(handsResult, seg) {
    var frames = (handsResult && handsResult.frames) || [];
    return ((seg && seg.reps) || []).map(function (rep) {
      var mine = frames.slice(rep.startFrame, rep.endFrame + 1);
      var hand = 0, two = 0;
      mine.forEach(function (f) {
        var n = f && Array.isArray(f.hands) ? f.hands.length : 0;
        if (n > 0) hand++;
        if (n > 1) two++;
      });
      return {
        index: rep.index, startMs: rep.startMs, endMs: rep.endMs,
        frames: mine.length, handFrames: hand, twoHandFrames: two, rows: Math.min(MAX_ROWS_PER_REP, hand)
      };
    });
  }

  // reps: summarizeReps() output. The sign needs 2 hands when frames with 2 hands are at least half
  // of all rep frames; the best rep has the most frames with every needed hand (ties: the earlier
  // one). Its window runs from the middle of the rest before it to the middle of the rest after it
  // (the rest before the first rep is 0..startMs, the rest after the last one endMs..durationMs).
  // Two exceptions for the LAST closed rep: without a finite durationMs its window ends at its own
  // endMs; and when seg (the segmentFrames result) is not ok, whatever the reason, signing the
  // segmenter never closed may follow it (a rep still open at the end of the video is not closed:
  // js/capture-core.js:134), so its window ends REST_MS after it (the segmenter only closes a rep
  // after REST_MS without a hand) and never reaches into that signing.
  // -> {index, windowStartMs, windowEndMs} or null when there is no rep.
  function pickBestRep(reps, durationMs, seg) {
    if (!Array.isArray(reps) || !reps.length) return null;
    var list = reps.slice().sort(function (a, b) { return a.startMs - b.startMs; });
    var all = 0, two = 0;
    list.forEach(function (r) { all += r.frames; two += r.twoHandFrames; });
    var needTwo = two > 0 && two * 2 >= all;
    var best = 0, bestScore = -1;
    list.forEach(function (r, i) {
      var score = needTwo ? r.twoHandFrames : r.handFrames;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    var rep = list[best];
    var before = best > 0 ? list[best - 1].endMs : 0;
    var hasEnd = typeof durationMs === 'number' && isFinite(durationMs);
    var end;
    if (best < list.length - 1) {
      end = (rep.endMs + list[best + 1].startMs) / 2;
    } else if (!hasEnd) {
      end = rep.endMs;
    } else if (seg && !seg.ok) {
      end = Math.min(durationMs, rep.endMs + REST_MS);
    } else {
      end = (rep.endMs + Math.max(durationMs, rep.endMs)) / 2;
    }
    return { index: rep.index, windowStartMs: Math.round((before + rep.startMs) / 2), windowEndMs: Math.round(end) };
  }

  // opts: {key, signer, holistic:{frames, fps, video, firstFrame}, AvatarClip, createdAt}.
  // holistic is AvatarExtract's result for the best rep's window: frames[0] is grid frame
  // firstFrame of the whole video, so the clip's trim times are offset by it.
  // createdAt (an ISO time) is required: without it AvatarClip.buildClip would read the clock.
  // -> {ok:true, clip} (a valid sk_avatar_clip_v1) or {ok:false, reason}; never throws on a
  // missing part.
  function buildCandidate(opts) {
    opts = opts || {};
    var Clip = opts.AvatarClip;
    var h = opts.holistic;
    if (!Clip) return { ok: false, reason: 'AvatarClip missing' };
    if (!opts.createdAt) return { ok: false, reason: 'createdAt missing' };
    if (!h) return { ok: false, reason: 'holistic result missing' };
    if (!h.video) return { ok: false, reason: 'video size missing' };
    var frames = Array.isArray(h.frames) ? h.frames : [];
    if (!frames.length) return { ok: false, reason: 'no frames' };
    var found = Clip.autoTrim(frames);
    var trim = found ? { start: found.start, end: found.end, auto: true } : { start: 0, end: frames.length - 1, auto: false };
    if (trim.end - trim.start + 1 > Clip.MAX_FRAMES) return { ok: false, reason: 'too long' };
    var clip = Clip.buildClip({
      key: opts.key, fps: h.fps, video: h.video, frames: frames, trim: trim,
      signer: opts.signer, createdAt: opts.createdAt
    });
    var first = h.firstFrame || 0;
    clip.trim.startMs = Math.round((first + trim.start) * 1000 / h.fps);
    clip.trim.endMs = Math.round((first + trim.end) * 1000 / h.fps);
    var v = Clip.validateClip(clip);
    return v.ok ? { ok: true, clip: clip } : { ok: false, reason: v.error };
  }

  // sign_draft_text() of php/api/sign_meta.php: "kamusta_ka" -> "Kamusta ka".
  function draftText(key) {
    var text = String(key || '').replace(/_/g, ' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // parsed: parseName() output; signs: {key: {set, ...}} (the existing signs).
  // -> {status:'ok', existing} | {status:'problem', reason, existing?} | {status:'new', textEn, textFil}
  // (a text the set does not use is null).
  function mapRow(parsed, signs) {
    if (!parsed || !parsed.ok) return { status: 'problem', reason: (parsed && parsed.reason) || BAD_NAME };
    var existing = own(signs, parsed.key);
    var set = upper(parsed.set);
    if (!existing) {
      var draft = draftText(parsed.key);
      return { status: 'new', textEn: set === 'FSL' ? null : draft, textFil: set === 'ESL' ? null : draft };
    }
    if (upper(existing.set) === set) return { status: 'ok', existing: existing };
    return { status: 'problem', reason: 'exists as ' + upper(existing.set), existing: existing };
  }

  var SEG_REASONS = {
    'no-rest': 'no rest before the first sign (hands out of view for 1 s)',
    'rep-too-long': 'a repetition is longer than 20 s',
    'recording-too-long': 'the video is longer than 90 s'
  };

  // meta: a cached video's meta ({seg:{ok, reason, repsFound}, reps:[...]}).
  // -> {status:'ok', importable:true} for exactly 3 reps, else {status:'problem', reason, importable}
  // where importable says the reps that were found can still be imported.
  function rowStatus(meta) {
    var seg = (meta && meta.seg) || {};
    var reps = (meta && meta.reps) || [];
    var found = typeof seg.repsFound === 'number' ? seg.repsFound : reps.length;
    if (seg.ok && reps.length === REQUIRED_REPS) return { status: 'ok', importable: true };
    var reason = own(SEG_REASONS, seg.reason);
    if (!reason) {
      reason = seg.reason === 'too-many-reps' && found <= REQUIRED_REPS
        ? 'more than ' + REQUIRED_REPS + ' repetitions'
        : 'found ' + found + ' repetition' + (found === 1 ? '' : 's') + ', need ' + REQUIRED_REPS;
    }
    return { status: 'problem', reason: reason, importable: found > 0 };
  }

  // currentRowsByModel: {ESL:n, FSL:n}; plannedReps: [{set, rows}] (one per rep to import).
  // A BOTH sign is in both models; an entry with an unknown set or without a finite row count is
  // ignored. -> {ESL:n, FSL:n}
  function projectRows(currentRowsByModel, plannedReps) {
    var cur = currentRowsByModel || {};
    var out = { ESL: cur.ESL || 0, FSL: cur.FSL || 0 };
    (plannedReps || []).forEach(function (rep) {
      var set = upper(rep && rep.set);
      if (SETS.indexOf(set) < 0 || typeof rep.rows !== 'number' || !isFinite(rep.rows)) return;
      if (set !== 'FSL') out.ESL += rep.rows;
      if (set !== 'ESL') out.FSL += rep.rows;
    });
    return out;
  }

  // opts: {signs:{key:{set,avatar,...}}, candidates:{key:[{signer,set,...}]}, picks:{key:{signer,by}},
  //        order:[default signer, ...fallbacks], keepHand}.
  // -> {assign:{key:signer}, summary:{bySigner:{signer:n}, fallback:[{key,signer}], noClip:[key],
  //     leftAlone:[key], notImported:[key], setDiffers:[{key,signer,set}]}}, keys in sorted order.
  // A sign is picked by hand when it HAS a clip and either picks[key].by === 'hand' or there is no
  // picks entry (made on Avatar clips from a video / JSON); a pick by hand left behind for a sign
  // without a clip does not count. leftAlone = signs whose clip is not replaced.
  // A candidate made from a video of another set than the sign's (an ESL video for a sign that
  // exists as FSL) is never used: for a listed signer it is reported in setDiffers ({key, signer,
  // set: the candidate's}) and the next signer in the list is tried. A sign left without a usable
  // candidate that way is not also listed under noClip. A candidate (or a sign) whose set is not
  // known is usable.
  function assignDefaults(opts) {
    opts = opts || {};
    var signs = opts.signs || {}, candidates = opts.candidates || {}, picks = opts.picks || {};
    var order = opts.order || [];
    var assign = {};
    var summary = { bySigner: {}, fallback: [], noClip: [], leftAlone: [], notImported: [], setDiffers: [] };
    var seen = {};
    Object.keys(signs).concat(Object.keys(candidates)).forEach(function (k) { seen[k] = true; });
    Object.keys(seen).sort().forEach(function (key) {
      var sign = own(signs, key);
      var list = own(candidates, key) || [];
      if (!sign) { if (list.length) summary.notImported.push(key); return; }
      var pick = own(picks, key);
      var byHand = pick ? pick.by === 'hand' && !!sign.avatar : !!sign.avatar;
      if (byHand && opts.keepHand) { summary.leftAlone.push(key); return; }
      var signer = null, differs = 0;
      for (var i = 0; i < order.length && !signer; i++) {
        for (var j = 0; j < list.length && !signer; j++) {
          if (list[j].signer !== order[i]) continue;
          if (candidateUsable(list[j], sign)) signer = order[i];
          else { differs++; summary.setDiffers.push({ key: key, signer: order[i], set: upper(list[j].set) }); }
        }
      }
      if (!signer) {
        if (sign.avatar) summary.leftAlone.push(key);
        else if (!differs) summary.noClip.push(key);
        return;
      }
      assign[key] = signer;
      summary.bySigner[signer] = (summary.bySigner[signer] || 0) + 1;
      if (signer !== order[0]) summary.fallback.push({ key: key, signer: signer });
    });
    return { assign: assign, summary: summary };
  }

  // May this candidate ({signer, set, ...}) become the avatar clip of this sign ({set, ...})?
  // Not when both sets are known and differ (strictly: an ESL video is not a clip for a BOTH sign
  // either, exactly as the Review step refuses its samples: "exists as BOTH").
  function candidateUsable(candidate, sign) {
    var a = upper(candidate && candidate.set), b = upper(sign && sign.set);
    return SETS.indexOf(a) < 0 || SETS.indexOf(b) < 0 || a === b;
  }

  // ── Dynamic rep split (2026-10-16, js/bulk-rep-split.js) ──
  // Cache meta version 2: hands.json holds every frame of the video (not only the reps' frames),
  // so a split can be redone from the cache, and meta.split holds the split (js/bulk-rep-split.js).
  var META_VERSION = 2;
  var LEGACY_REPS_MAX = 5;     // a v1 import could have saved reps 1..n (more than 3 on too-many-reps)

  // meta: a cached video's meta; splitVersion: BulkRepSplit.SPLIT.VERSION.
  // -> 'none' (not cached) | 'old' (v1: only the reps' frames are cached, so the video is read
  // again) | 'resplit' (v2 split with other thresholds: redone from the cached frames) | 'current'.
  function cacheState(meta, splitVersion) {
    if (!meta) return 'none';
    if (meta.v !== META_VERSION) return 'old';
    return meta.split && meta.split.version === splitVersion ? 'current' : 'resplit';
  }

  // The string a v2 sample id is hashed from: the rep's place in the video is part of it, so a
  // different split of the same video gives different samples (and the old ones can be replaced),
  // while the same split gives the same ids again (a re-import adds nothing). A rep identical to a
  // rep the v1 importer saved (legacyReps: the v1 meta's reps, same index, start and end) keeps
  // that sample's v1 id. file: {name, size}; rep: {index, startMs, endMs}.
  function importIdSourceV2(file, rep, legacyReps) {
    var same = (legacyReps || []).some(function (r) {
      return r && r.index === rep.index && r.startMs === rep.startMs && r.endMs === rep.endMs;
    });
    if (same) return importIdSource(file, rep.index);
    return file.name + '|' + file.size + '|' + rep.index + '|' + rep.startMs + '-' + rep.endMs;
  }

  // meta (v2) -> {status:'ok', importable:true} for 3 reps the splitter is sure of, else
  // {status:'problem', reason (the splitter's reasons), importable (a rep was found)}.
  function splitStatus(meta) {
    var split = (meta && meta.split) || {};
    var reps = (meta && meta.reps) || [];
    if (split.ok && reps.length === REQUIRED_REPS) return { status: 'ok', importable: true };
    var reasons = Array.isArray(split.reasons) ? split.reasons : [];
    var reason = reasons.length ? reasons.join('; ')
      : 'found ' + reps.length + ' repetition' + (reps.length === 1 ? '' : 's') + ', need ' + REQUIRED_REPS;
    return { status: 'problem', reason: reason, importable: reps.length > 0 };
  }

  // The compile rule's row count for one sign (KnnCompile.selectSignRows, js/knn-compile.js): rows
  // per sample in, rows the model keeps out. Samples with no rows do not count; at most `budget`
  // rows in all, else each sample keeps max(minRowsPerSample, floor(budget / samples)) rows.
  // rule: KnnCompile.DEFAULT_RULE (its budget and minRowsPerSample are the defaults here).
  function budgetRows(rowCounts, rule) {
    var budget = rule && rule.budget > 0 ? rule.budget : 90;
    var minRows = rule && rule.minRowsPerSample > 0 ? rule.minRowsPerSample : 3;
    var list = (rowCounts || []).filter(function (n) { return typeof n === 'number' && n > 0; });
    var total = list.reduce(function (s, n) { return s + n; }, 0);
    if (total <= budget) return total;
    var k = Math.max(minRows, Math.floor(budget / list.length));
    return list.reduce(function (s, n) { return s + Math.min(n, k); }, 0);
  }

  // sampleCounts: {key: samples}. -> {median, low:[keys with fewer than half the median], sorted}
  function imbalance(sampleCounts) {
    var keys = Object.keys(sampleCounts || {}).sort();
    if (!keys.length) return { median: 0, low: [] };
    var s = keys.map(function (k) { return sampleCounts[k]; }).sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    var median = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    return { median: median, low: keys.filter(function (k) { return sampleCounts[k] < median / 2; }) };
  }

  var api = {
    VIDEO_EXT: VIDEO_EXT,
    SIGNER_RE: SIGNER_RE,
    REQUIRED_REPS: REQUIRED_REPS,
    REST_MS: REST_MS,
    MAX_ROWS_PER_REP: MAX_ROWS_PER_REP,
    META_VERSION: META_VERSION,
    LEGACY_REPS_MAX: LEGACY_REPS_MAX,
    cacheState: cacheState,
    importIdSourceV2: importIdSourceV2,
    splitStatus: splitStatus,
    budgetRows: budgetRows,
    cleanLabel: cleanLabel,
    parseName: parseName,
    videoIdSource: videoIdSource,
    importIdSource: importIdSource,
    summarizeReps: summarizeReps,
    pickBestRep: pickBestRep,
    buildCandidate: buildCandidate,
    draftText: draftText,
    mapRow: mapRow,
    rowStatus: rowStatus,
    projectRows: projectRows,
    assignDefaults: assignDefaults,
    candidateUsable: candidateUsable,
    imbalance: imbalance
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BulkImportCore = api;
})();
