// Sining Kamay - compact recognition model: which signs go in each k-NN model, the per-sign row
// budget, the fingerprint of the samples a model was built from, and the binary model file
// `models/knn_<LANG>.bin` (encode/decode). Spec: .git/sdd/cm-plan.md "Shared definitions".
//
// Plain script, no DOM access: attaches window.KnnCompile in the browser and sets module.exports
// under node (same pattern as js/capture-core.js). It does not load js/gesture-data.js: the caller
// passes GestureDataRecorder.recordingToFeatureRows in as `toRows`.
(function () {
  'use strict';

  var FORMAT_VERSION = 1;
  var DIMS = 126;
  var DTYPE_F32 = 1; // the only dtype this version writes or reads
  var MAGIC = 'SKKN';
  var MIN_HEADER_BYTES = 2;
  var MAX_HEADER_BYTES = 4194304;

  var DEFAULT_RULE = Object.freeze({
    name: 'sign-budget',
    version: 1,
    budget: 90,
    maxRowsPerSample: 30, // descriptive: recordingToFeatureRows already caps v3 at 30, v2 is as stored
    minRowsPerSample: 3,
    spacing: 'even',
  });

  function fail(msg) {
    throw new Error('knn model file: ' + msg);
  }

  // A sign's set, exactly as recordingsToTrainingRows (js/gesture-data.js:785-797) decides it:
  // the listing's signs[label].set, else the sample's own signLanguage, else 'ESL'.
  function own(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  }

  function sampleSet(signs, label, sample) {
    var sign = own(signs, label);
    return (sign && sign.set) || (sample && sample.signLanguage) || 'ESL';
  }

  // Membership (plan, Q4): ESL model = ESL + BOTH, FSL model = FSL + BOTH, start/stop in both.
  function inModel(lang, label, set) {
    return set === lang || set === 'BOTH' || label === 'start' || label === 'stop';
  }

  // k evenly spaced indices of 0..len-1, first and last included (same formula as
  // recordingToFeatureRows' v3 subsampling). len <= k -> every index.
  function evenIdx(len, k) {
    var out = [];
    var i;
    if (len <= k) {
      for (i = 0; i < len; i++) out.push(i);
      return out;
    }
    if (k <= 0) return out;
    if (k === 1) return [0];
    for (i = 0; i < k; i++) out.push(Math.round((i * (len - 1)) / (k - 1)));
    return out;
  }

  function isPositiveInt(v) {
    return typeof v === 'number' && Number.isInteger(v) && v > 0;
  }

  function checkRule(rule) {
    if (!rule || rule.name !== 'sign-budget' || rule.spacing !== 'even' ||
        !isPositiveInt(rule.budget) || !isPositiveInt(rule.minRowsPerSample)) {
      throw new Error('knn compile: unsupported rule ' + JSON.stringify(rule));
    }
  }

  // A feature row the model may hold: an array of 126 finite numbers.
  function isRow(row) {
    if (!row || row.length !== DIMS) return false;
    for (var j = 0; j < DIMS; j++) {
      if (typeof row[j] !== 'number' || !isFinite(row[j])) return false;
    }
    return true;
  }

  // Per-sign budget (plan, Q3). sampleRowLists = one row array per sample of ONE sign. Samples
  // with no rows do not count. If the sign's rows total <= budget they are all kept; otherwise
  // each sample keeps k = max(minRowsPerSample, floor(budget / n)) evenly spaced rows.
  // Returns one flat array, samples in input order, rows in their order.
  function selectSignRows(sampleRowLists, rule) {
    var r = rule || DEFAULT_RULE;
    checkRule(r);
    var lists = (sampleRowLists || []).filter(function (rows) { return rows && rows.length > 0; });
    var total = lists.reduce(function (n, rows) { return n + rows.length; }, 0);
    var out = [];
    if (total <= r.budget) {
      lists.forEach(function (rows) { out.push.apply(out, rows); });
      return out;
    }
    var k = Math.max(r.minRowsPerSample, Math.floor(r.budget / lists.length));
    lists.forEach(function (rows) {
      evenIdx(rows.length, k).forEach(function (i) { out.push(rows[i]); });
    });
    return out;
  }

  // The fingerprint text (plan, decision 7): `label|set|file` for every listed sample file of every
  // label in model `lang` (by set, not by rows: a sample with 0 rows still counts), sorted, '\n'-joined.
  function fingerprintText(gestures, signs, lang) {
    var lines = [];
    Object.keys(gestures || {}).forEach(function (label) {
      (gestures[label] || []).forEach(function (sample) {
        var set = sampleSet(signs, label, sample);
        if (inModel(lang, label, set)) lines.push(label + '|' + set + '|' + sample.file);
      });
    });
    return lines.sort().join('\n');
  }

  async function sha256Hex(text) {
    var subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) {
      throw new Error('knn compile: crypto.subtle is not available (needs a secure context such as localhost)');
    }
    var digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(function (b) {
      return (b < 16 ? '0' : '') + b.toString(16);
    }).join('');
  }

  function orNull(v) {
    return v === undefined ? null : v;
  }

  // Incremental builder (the one implementation; buildModel below uses it). Signs can be added one
  // at a time, in any order (Train Gestures' Compile reads frames a batch of signs at a time), so the
  // caller can drop each sign's frames after addSign. opts = { signs, categories, lang, toRows,
  // rule, buildDate } as for buildModel (signs/categories: the listing's own maps).
  // addSign(label, samples) keeps only the budget-selected rows; finish() -> { header, model } with
  // labels sorted by key and header.fingerprint null. A label added twice, or addSign after finish,
  // throws.
  function createBuilder(opts) {
    opts = opts || {};
    var signs = opts.signs || {};
    var categories = (opts.categories && opts.categories[opts.lang]) || {};
    var lang = opts.lang;
    var toRows = opts.toRows;
    var rule = Object.assign({}, opts.rule || DEFAULT_RULE);
    var buildDate = opts.buildDate;
    if (lang !== 'ESL' && lang !== 'FSL') throw new Error('knn compile: lang must be ESL or FSL');
    if (typeof toRows !== 'function') throw new Error('knn compile: toRows (recordingToFeatureRows) is required');
    checkRule(rule);

    var added = Object.create(null); // label -> { entry, rows } (null entry: 0 rows, left out)
    var finished = false;

    function addSign(label, samples) {
      if (finished) throw new Error('knn compile: addSign after finish');
      if (typeof label !== 'string') throw new Error('knn compile: label must be a string');
      if (Object.prototype.hasOwnProperty.call(added, label)) throw new Error('knn compile: sign "' + label + '" added twice');
      var set = null;
      var lists = [];
      (samples || []).forEach(function (sample) {
        var s = sampleSet(signs, label, sample);
        if (!inModel(lang, label, s)) return;
        if (set === null) set = s;
        var rows = (toRows(sample) || []).filter(isRow);
        if (rows.length) lists.push(rows);
      });
      if (!lists.length) { added[label] = null; return 0; } // 0 rows: left out of the model

      var rows = selectSignRows(lists, rule);
      var sign = own(signs, label) || {};
      added[label] = {
        rows: rows,
        entry: {
          key: label,
          set: sign.set || set,
          category: orNull(own(categories, label)),
          textEn: orNull(sign.textEn),
          textFil: orNull(sign.textFil),
          samples: lists.length,
          rows: rows.length,
        },
      };
      return rows.length;
    }

    function finish() {
      if (finished) throw new Error('knn compile: finish called twice');
      finished = true;
      var model = {};
      var labels = [];
      var sampleCount = 0;
      var rowCount = 0;
      Object.keys(added).sort().forEach(function (label) {
        var a = added[label];
        if (!a) return;
        model[label] = a.rows;
        labels.push(a.entry);
        sampleCount += a.entry.samples;
        rowCount += a.entry.rows;
      });
      added = null;
      var header = {
        formatVersion: FORMAT_VERSION,
        lang: lang,
        buildDate: buildDate || new Date().toISOString(),
        builtOn: 'laptop',
        rule: rule,
        dims: DIMS,
        dtype: 'f32',
        fingerprint: null,
        sampleCount: sampleCount,
        rowCount: rowCount,
        labels: labels,
      };
      return { header: header, model: model };
    }

    return { addSign: addSign, finish: finish };
  }

  // Builds model `lang` from the save_gesture.php GET listing (gestures/signs/categories as
  // returned). Returns { header, model, fingerprintText }; header.fingerprint is null - the caller
  // hashes fingerprintText (sha256Hex) and sets it before encode().
  function buildModel(opts) {
    var gestures = opts.gestures || {};
    var b = createBuilder(opts);
    Object.keys(gestures).sort().forEach(function (label) {
      b.addSign(label, gestures[label] || []);
    });
    var built = b.finish();
    return { header: built.header, model: built.model, fingerprintText: fingerprintText(gestures, opts.signs || {}, opts.lang) };
  }

  // Header checks shared by encode() and decode(), so encode can never write a file decode refuses.
  function checkHeader(h) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) fail('header is not a JSON object');
    if (h.dims !== DIMS) fail('dims must be ' + DIMS + ', got ' + JSON.stringify(h.dims));
    if (h.lang !== 'ESL' && h.lang !== 'FSL') fail('lang must be ESL or FSL, got ' + JSON.stringify(h.lang));
    if (!Array.isArray(h.labels)) fail('labels is not an array');
    if (!Number.isInteger(h.rowCount) || h.rowCount < 0) fail('rowCount is not a non-negative integer');
    var seen = {};
    var sum = 0;
    h.labels.forEach(function (L, i) {
      if (!L || typeof L.key !== 'string' || L.key === '') fail('label ' + i + ' has no key');
      if (L.key === '__proto__') fail('label key "__proto__" is not allowed');
      if (Object.prototype.hasOwnProperty.call(seen, L.key)) fail('duplicate label "' + L.key + '"');
      seen[L.key] = true;
      if (!Number.isInteger(L.rows) || L.rows < 0) fail('label "' + L.key + '" rows is not a non-negative integer');
      sum += L.rows;
    });
    if (sum !== h.rowCount) fail('label rows add up to ' + sum + ', rowCount is ' + h.rowCount);
  }

  function headerStart(headerBytes) {
    return Math.ceil((12 + headerBytes) / 4) * 4;
  }

  // header + model -> ArrayBuffer (layout: plan "Model file"). Rows are written label by label in
  // header.labels order as little-endian Float32.
  function encode(header, model) {
    checkHeader(header);
    var keys = Object.keys(model || {});
    if (keys.length !== header.labels.length) fail('model has ' + keys.length + ' labels, header has ' + header.labels.length);
    header.labels.forEach(function (L) {
      var rows = model[L.key];
      if (!Array.isArray(rows)) fail('model has no rows for label "' + L.key + '"');
      if (rows.length !== L.rows) fail('label "' + L.key + '" has ' + rows.length + ' rows, header says ' + L.rows);
      rows.forEach(function (row, i) {
        if (!isRow(row)) fail('label "' + L.key + '" row ' + i + ' is not ' + DIMS + ' finite numbers');
      });
    });

    var hb = new TextEncoder().encode(JSON.stringify(header));
    if (hb.length < MIN_HEADER_BYTES || hb.length > MAX_HEADER_BYTES) fail('header is ' + hb.length + ' bytes');
    var start = headerStart(hb.length);
    var buf = new ArrayBuffer(start + header.rowCount * DIMS * 4);
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    for (var m = 0; m < 4; m++) u8[m] = MAGIC.charCodeAt(m);
    dv.setUint16(4, FORMAT_VERSION, true);
    dv.setUint16(6, DTYPE_F32, true);
    dv.setUint32(8, hb.length, true);
    u8.set(hb, 12); // the padding after it is already zero

    var o = start;
    header.labels.forEach(function (L) {
      model[L.key].forEach(function (row) {
        for (var j = 0; j < DIMS; j++, o += 4) dv.setFloat32(o, row[j], true);
      });
    });
    return buf;
  }

  // ArrayBuffer (or a typed-array view of one) -> { header, model } with plain Array rows of 126
  // numbers. Throws "knn model file: ..." for anything this version cannot read.
  function decode(input) {
    var buf = input;
    if (ArrayBuffer.isView(input)) buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    if (Object.prototype.toString.call(buf) !== '[object ArrayBuffer]') fail('not an ArrayBuffer');
    if (buf.byteLength < 12) fail('too short (' + buf.byteLength + ' bytes)');
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    var magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== MAGIC) fail('bad magic ' + JSON.stringify(magic) + ' (not a model file)');
    var version = dv.getUint16(4, true);
    if (version !== FORMAT_VERSION) fail('format version ' + version + ' is not supported (expected ' + FORMAT_VERSION + ')');
    var dtype = dv.getUint16(6, true);
    if (dtype !== DTYPE_F32) fail('dtype ' + dtype + ' is not supported (expected 1 = Float32)');
    var hl = dv.getUint32(8, true);
    if (hl < MIN_HEADER_BYTES || hl > MAX_HEADER_BYTES) fail('header length ' + hl + ' is out of range');
    if (12 + hl > buf.byteLength) fail('header length ' + hl + ' runs past the end of the file');

    var header;
    try {
      header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(12, 12 + hl)));
    } catch (e) {
      fail('header is not valid JSON (' + e.message + ')');
    }
    checkHeader(header);

    var start = headerStart(hl);
    var bodyBytes = buf.byteLength - start;
    if (bodyBytes !== header.rowCount * DIMS * 4) {
      fail('body is ' + bodyBytes + ' bytes, expected ' + (header.rowCount * DIMS * 4) + ' for ' + header.rowCount + ' rows');
    }

    var model = {};
    var o = start;
    header.labels.forEach(function (L) {
      var rows = [];
      for (var r = 0; r < L.rows; r++) {
        var row = new Array(DIMS);
        for (var j = 0; j < DIMS; j++, o += 4) row[j] = dv.getFloat32(o, true);
        rows.push(row);
      }
      model[L.key] = rows;
    });
    return { header: header, model: model };
  }

  var api = {
    FORMAT_VERSION: FORMAT_VERSION,
    DIMS: DIMS,
    DEFAULT_RULE: DEFAULT_RULE,
    inModel: inModel,
    evenIdx: evenIdx,
    selectSignRows: selectSignRows,
    createBuilder: createBuilder,
    buildModel: buildModel,
    fingerprintText: fingerprintText,
    sha256Hex: sha256Hex,
    encode: encode,
    decode: decode,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.KnnCompile = api;
  }
})();
