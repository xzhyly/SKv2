// php/api/bulk_import.php (the bulk importer's cache: files only, no DB) under php-cgi
// (tests/sign-texts/api-helper.mjs). Works in the real bulk_import_cache/ folder with random video
// ids and zz_-prefixed keys only; removes exactly what it created (never the folder's other
// content) and leaves every non-zz_ entry of picks.json as it was.
// Run: node --test --test-concurrency=1 tests/bulk-import/cache-endpoint.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { callApi, repo } from '../sign-texts/api-helper.mjs';
import { PHP_CGI } from '../normalization/clone-helper.mjs';

const cache = path.join(repo, 'bulk_import_cache');
const videosDir = path.join(cache, 'videos');
const candidatesDir = path.join(cache, 'candidates');
const picksFile = path.join(cache, 'picks.json');
const lockFile = path.join(cache, 'picks.lock');

const get = (query) => callApi('bulk_import.php', { method: 'GET', query });
const post = (body, extra = {}) => callApi('bulk_import.php', { body, ...extra });
const newId = () => crypto.randomBytes(16).toString('hex');
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/;

const ID_A = newId(), ID_B = newId();
const IDS = [ID_A, ID_B];
// KEY_DIGIT ends in a digit, nothing more: a bare numeric key ("1", which PHP would turn into a
// list index) cannot be tested here, because every key a test writes must start with zz_.
const KEY = 'zz_bulk_probe', KEY2 = 'zz_bulk_probe-2', KEY_DIGIT = 'zz_1';
const KEY_BAD = 'zz_bulk_corrupt';
const PAR = Array.from({ length: 20 }, (_, i) => 'zz_par_' + i);
const KEYS = [KEY, KEY2, KEY_DIGIT, KEY_BAD, 'zz_bulk_none'];

const meta = (id, extra = {}) => ({
  v: 1, id, file: { name: 'ESL_zz bulk probe_P01.mp4', size: 12345, lastModified: 1760000000000, relPath: 'a/b/ESL_zz bulk probe_P01.mp4' },
  parsed: { set: 'ESL', label: 'zz bulk probe', key: KEY, signer: 'P01' },
  hands: { videoWidth: 1080, videoHeight: 1920, fps: 15, durationMs: 9000, input: {}, frameCount: 135, handFrames: 90, ms: 4100.5 },
  seg: { ok: true, reason: null, repsFound: 3 },
  reps: [{ index: 0, startMs: 500, endMs: 2500, frames: 30, handFrames: 30, twoHandFrames: 0, rows: 30 }],
  bestRep: { index: 0, windowStartMs: 250, windowEndMs: 2800 }, candidate: null, savedAt: '2026-10-13T00:00:00.000Z', ...extra,
});
const hands = (id, n = 2) => ({
  id, meta: { videoWidth: 1080, videoHeight: 1920, fps: 15, input: {} },
  reps: [{ index: 0, frames: Array.from({ length: n }, (_, i) => ({ index: i, timestamp: i * 66.7, hands: [], landmarks: Array(126).fill(0.123456789) })) }],
});
const clip = (key, signer, n = 3, extra = {}) => ({
  format: 'sk_avatar_clip_v1', key, fps: 25, video: { w: 1080, h: 1920 }, trim: { startMs: 0, endMs: 80 }, signer,
  poseIdx: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
  frames: Array.from({ length: n }, () => [Array.from({ length: 11 }, () => [0.5, 0.5, 0, 1]), null, null]), ...extra,
});
// A POST through its own php-cgi process, not waited for (callApi is synchronous): for bursts.
function postAsync(body) {
  const payload = Buffer.from(JSON.stringify(body));
  const env = { ...process.env, REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'POST',
    SCRIPT_FILENAME: path.join(repo, 'php', 'api', 'bulk_import.php'), SCRIPT_NAME: '/SKR/php/api/bulk_import.php',
    QUERY_STRING: '', CONTENT_TYPE: 'application/json', CONTENT_LENGTH: String(payload.length) };
  return new Promise((resolve, reject) => {
    const child = spawn(PHP_CGI, [], { env });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', () => {
      const out = Buffer.concat(chunks).toString('utf8');
      const cut = out.indexOf('\r\n\r\n');
      const m = /^Status:\s*(\d+)/im.exec(out.slice(0, cut));
      resolve({ status: m ? Number(m[1]) : 200, json: JSON.parse(out.slice(cut + 4)) });
    });
    child.stdin.end(payload);
  });
}
const candidate = (key, signer, extra = {}) => ({ action: 'put_candidate', key, signer, set: 'ESL', videoId: ID_A, repIndex: 1, clip: clip(key, signer), ...extra });

// Recursive listing of the cache (relative paths), to prove a rejected request wrote nothing.
function tree(dir = cache, base = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory()
    ? [base + e.name + '/', ...tree(path.join(dir, e.name), base + e.name + '/')] : [base + e.name]).sort();
}
const realPicks = () => {
  if (!fs.existsSync(picksFile)) return null;
  const all = JSON.parse(fs.readFileSync(picksFile, 'utf8'));
  return Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('zz_')));
};

// What existed before the run: only what this suite added is removed afterwards.
const existed = { cache: fs.existsSync(cache), videos: fs.existsSync(videosDir), candidates: fs.existsSync(candidatesDir), picks: fs.existsSync(picksFile), lock: fs.existsSync(lockFile) };
const picksBefore = realPicks();
const treeBefore = tree().filter((f) => !/(^|\/)zz_/.test(f));

function cleanup() {
  for (const id of IDS) post({ action: 'delete_video', id });
  for (const key of KEYS) post({ action: 'delete_candidates', key });
  if (fs.existsSync(picksFile)) {
    const zz = Object.keys(JSON.parse(fs.readFileSync(picksFile, 'utf8'))).filter((k) => k.startsWith('zz_'));
    if (zz.length) post({ action: 'set_picks', picks: Object.fromEntries(zz.map((k) => [k, null])) });
    if (!existed.picks && fs.readFileSync(picksFile, 'utf8') === '{}') fs.unlinkSync(picksFile);
  }
  if (!existed.lock && fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  // Folders this run created are removed only when empty (rmdir, never recursive).
  for (const [was, dir] of [[existed.candidates, candidatesDir], [existed.videos, videosDir], [existed.cache, cache]]) {
    if (!was && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}
before(cleanup);
after(() => {
  cleanup();
  assert.deepEqual(realPicks(), picksBefore);                               // the owner's picks untouched
  assert.deepEqual(tree().filter((f) => !/(^|\/)zz_/.test(f)), treeBefore);   // nothing left behind
});

test('the cache folder is git-ignored', () => {
  const r = spawnSync('git', ['check-ignore', '-q', 'bulk_import_cache/x'], { cwd: repo });
  assert.equal(r.status, 0);
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'bulk_import_cache/videos/a.meta.json'], { cwd: repo }).status, 0);
});

test('GET actions answer with empty results before anything of ours is stored', () => {
  const index = get('action=index');
  assert.equal(index.status, 200);
  assert.equal(index.json.success, true);
  assert.equal(Array.isArray(index.json.videos), false);                    // {} even when empty
  assert.equal(typeof index.json.videos, 'object');
  assert.equal(ID_A in index.json.videos, false);
  const cands = get('action=candidates');
  assert.equal(cands.status, 200);
  assert.equal(Array.isArray(cands.json.candidates), false);
  assert.equal(KEY in cands.json.candidates, false);
  const picks = get('action=picks');
  assert.equal(picks.status, 200);
  assert.equal(Array.isArray(picks.json.picks), false);
  assert.deepEqual(Object.fromEntries(Object.entries(picks.json.picks).filter(([k]) => !k.startsWith('zz_'))), picksBefore ?? {});
  assert.equal(get('action=hands&id=' + ID_A).status, 404);
  assert.equal(get(`action=candidate&key=${KEY}&signer=P01`).status, 404);
  assert.deepEqual(get('action=candidates&key=' + KEY).json.candidates, { [KEY]: [] });
});

test('put_video stores meta + hands; index and hands give them back unchanged', () => {
  const r = post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: hands(ID_A) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual({ success: r.json.success, id: r.json.id, hands: r.json.hands }, { success: true, id: ID_A, hands: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(videosDir, ID_A + '.meta.json'), 'utf8')), meta(ID_A));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(videosDir, ID_A + '.hands.json'), 'utf8')), hands(ID_A));
  assert.equal(fs.readFileSync(path.join(videosDir, ID_A + '.hands.json'), 'utf8').includes('"input":{}'), true);   // {} stays {}
  assert.deepEqual(fs.readdirSync(videosDir).filter((f) => f.includes('.tmp-')), []);

  assert.deepEqual(get('action=index').json.videos[ID_A], meta(ID_A));
  const h = get('action=hands&id=' + ID_A);
  assert.equal(h.status, 200);
  assert.equal(h.json.success, true);
  const { success, ...content } = h.json;
  assert.deepEqual(content, hands(ID_A));
  // a stored "success" field cannot mask the real one
  assert.equal(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: { ...hands(ID_A), success: false } }).status, 200);
  assert.deepEqual(get('action=hands&id=' + ID_A).json, { success: true, ...hands(ID_A) });
  assert.equal(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: hands(ID_A) }).status, 200);

  // meta only (the Holistic step updating meta.candidate): the hands file is kept
  const updated = meta(ID_A, { candidate: { state: 'ok', signer: 'P01', frames: 40, repIndex: 0, ms: 900 } });
  const r2 = post({ action: 'put_video', id: ID_A, meta: updated });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.hands, false);
  assert.deepEqual(get('action=index').json.videos[ID_A], updated);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(videosDir, ID_A + '.hands.json'), 'utf8')), hands(ID_A));

  // a second video, meta only: listed by index, no hands
  assert.equal(post({ action: 'put_video', id: ID_B, meta: meta(ID_B, { seg: { ok: false, reason: 'no hands', repsFound: 0 } }) }).status, 200);
  const videos = get('action=index').json.videos;
  assert.equal(videos[ID_B].seg.repsFound, 0);
  assert.equal(videos[ID_A].candidate.state, 'ok');
  assert.equal(get('action=hands&id=' + ID_B).status, 404);
});

test('index ignores hands files, temp files and foreign names', () => {
  const stray = path.join(videosDir, 'zz_stray.meta.json');
  const tmp = path.join(videosDir, ID_B + '.meta.json.tmp-zz_test');
  fs.writeFileSync(stray, '{"v":1}');
  fs.writeFileSync(tmp, '{"v":1}');
  try {
    const ids = Object.keys(get('action=index').json.videos);
    assert.equal(ids.every((id) => /^[0-9a-f]{32}$/.test(id)), true);
    assert.equal(ids.filter((id) => IDS.includes(id)).length, 2);
  } finally {
    fs.unlinkSync(stray);
    fs.unlinkSync(tmp);
  }
});

test('put_candidate stores the clip; candidates lists by signer; candidate returns it', () => {
  const r = post(candidate(KEY, 'P03', { clip: clip(KEY, 'P03', 5) }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual({ key: r.json.key, signer: r.json.signer, set: r.json.set, frames: r.json.frames }, { key: KEY, signer: 'P03', set: 'ESL', frames: 5 });
  assert.equal(post(candidate(KEY, 'P01', { repIndex: 0, set: 'FSL' })).status, 200);
  assert.equal(post(candidate(KEY, 'P12', { videoId: ID_B, repIndex: 2, set: 'BOTH', clip: clip(KEY, 'P12', 1) })).status, 200);
  assert.equal(post(candidate(KEY2, 'P99')).status, 200);
  assert.deepEqual(fs.readdirSync(path.join(candidatesDir, KEY)).sort(),
    ['P01.info.json', 'P01.json', 'P03.info.json', 'P03.json', 'P12.info.json', 'P12.json']);
  const info = JSON.parse(fs.readFileSync(path.join(candidatesDir, KEY, 'P03.info.json'), 'utf8'));
  assert.deepEqual(Object.keys(info).sort(), ['frames', 'repIndex', 'savedAt', 'set', 'signer', 'videoId']);
  assert.deepEqual([info.signer, info.set, info.frames, info.videoId, info.repIndex], ['P03', 'ESL', 5, ID_A, 1]);
  // the set of the video the clip was made from: in the clip file, in the summary, in both answers
  assert.equal(JSON.parse(fs.readFileSync(path.join(candidatesDir, KEY, 'P01.json'), 'utf8')).set, 'FSL');

  const all = get('action=candidates').json.candidates;
  assert.deepEqual(all[KEY].map((c) => [c.signer, c.frames, c.videoId, c.repIndex]),
    [['P01', 3, ID_A, 0], ['P03', 5, ID_A, 1], ['P12', 1, ID_B, 2]]);
  assert.equal(all[KEY].every((c) => ISO.test(c.savedAt)), true);
  assert.deepEqual(Object.keys(all[KEY][0]).sort(), ['frames', 'repIndex', 'savedAt', 'set', 'signer', 'videoId']);
  assert.deepEqual(all[KEY].map((c) => [c.signer, c.set]), [['P01', 'FSL'], ['P03', 'ESL'], ['P12', 'BOTH']]);
  assert.equal(get(`action=candidate&key=${KEY}&signer=P01`).json.candidate.set, 'FSL');
  assert.deepEqual(all[KEY2].map((c) => c.signer), ['P99']);
  // &key= lists one sign only
  const oneKey = get('action=candidates&key=' + KEY);
  assert.equal(oneKey.status, 200);
  assert.deepEqual(oneKey.json.candidates, { [KEY]: all[KEY] });
  assert.deepEqual(get('action=candidates&key=zz_bulk_none').json.candidates, { zz_bulk_none: [] });

  const one = get(`action=candidate&key=${KEY}&signer=P03`);
  assert.equal(one.status, 200);
  assert.deepEqual(Object.keys(one.json.candidate).sort(), ['clip', 'repIndex', 'savedAt', 'set', 'videoId']);
  assert.equal(one.json.candidate.set, 'ESL');
  assert.deepEqual(one.json.candidate.clip, clip(KEY, 'P03', 5));
  assert.equal(one.json.candidate.videoId, ID_A);
  assert.equal(one.json.candidate.repIndex, 1);
  assert.equal(one.json.candidate.savedAt, all[KEY][1].savedAt);

  // saving again replaces that signer's candidate only
  assert.equal(post(candidate(KEY, 'P03', { clip: clip(KEY, 'P03', 2) })).json.frames, 2);
  assert.deepEqual(get('action=candidates').json.candidates[KEY].map((c) => c.frames), [3, 2, 1]);
  assert.equal(get(`action=candidate&key=${KEY}&signer=P02`).status, 404);
  assert.equal(get(`action=candidate&key=zz_bulk_none&signer=P01`).status, 404);

  // a candidate stored without a set (no such file is ever written now): answered with set null
  const dir = path.join(candidatesDir, KEY);
  for (const name of ['P12.json', 'P12.info.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    delete data.set;
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  }
  assert.equal(get('action=candidates&key=' + KEY).json.candidates[KEY].find((c) => c.signer === 'P12').set, null);
  assert.equal(get(`action=candidate&key=${KEY}&signer=P12`).json.candidate.set, null);
  assert.equal(post(candidate(KEY, 'P12', { videoId: ID_B, repIndex: 2, set: 'BOTH', clip: clip(KEY, 'P12', 1) })).status, 200);
});

test('the candidates listing reads only the summaries, never a clip file', () => {
  assert.equal(post(candidate(KEY_BAD, 'P05', { clip: clip(KEY_BAD, 'P05', 4) })).status, 200);
  assert.equal(post(candidate(KEY_BAD, 'P06')).status, 200);
  const clipFile = path.join(candidatesDir, KEY_BAD, 'P05.json');
  fs.writeFileSync(clipFile, '{ not json');                                  // a clip the listing must not open
  fs.unlinkSync(path.join(candidatesDir, KEY_BAD, 'P06.json'));              // and one that is gone
  for (const q of ['action=candidates', 'action=candidates&key=' + KEY_BAD]) {
    const r = get(q);
    assert.equal(r.status, 200, q);
    assert.deepEqual(r.json.candidates[KEY_BAD].map((c) => [c.signer, c.frames, c.videoId, c.repIndex]), [['P05', 4, ID_A, 1], ['P06', 3, ID_A, 1]]);
  }
  const bad = get(`action=candidate&key=${KEY_BAD}&signer=P05`);
  assert.equal(bad.status, 500);
  assert.equal(bad.json.success, false);
  assert.equal(get(`action=candidate&key=${KEY_BAD}&signer=P06`).status, 404);
  // a clip file without its summary is not listed
  fs.unlinkSync(path.join(candidatesDir, KEY_BAD, 'P05.info.json'));
  assert.deepEqual(get('action=candidates&key=' + KEY_BAD).json.candidates[KEY_BAD].map((c) => c.signer), ['P06']);
  // delete_candidates removes both kinds (P05: clip only, P06: summary only) and the folder
  const d = post({ action: 'delete_candidates', key: KEY_BAD });
  assert.equal(d.status, 200);
  assert.equal(d.json.deleted, 2);
  assert.equal(fs.existsSync(path.join(candidatesDir, KEY_BAD)), false);
  assert.equal(KEY_BAD in get('action=candidates').json.candidates, false);
});

test('set_picks merges, replaces, removes with null, and stamps `at`', () => {
  const r = post({ action: 'set_picks', picks: { [KEY]: { signer: 'P01', by: 'default', extra: 'dropped' }, [KEY2]: { signer: 'P99', by: 'hand' } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json.picks[KEY]).sort(), ['at', 'by', 'signer']);
  assert.equal(ISO.test(r.json.picks[KEY].at), true);
  let picks = get('action=picks').json.picks;
  assert.deepEqual([picks[KEY].signer, picks[KEY].by, picks[KEY2].signer, picks[KEY2].by], ['P01', 'default', 'P99', 'hand']);
  assert.deepEqual(JSON.parse(fs.readFileSync(picksFile, 'utf8')), picks);

  // merge: one key replaced, one added, the third untouched
  const keptAt = picks[KEY2].at;
  assert.equal(post({ action: 'set_picks', picks: { [KEY]: { signer: 'P03', by: 'hand' }, [KEY_DIGIT]: { signer: 'P12', by: 'default' } } }).status, 200);
  picks = get('action=picks').json.picks;
  assert.deepEqual([picks[KEY].signer, picks[KEY].by], ['P03', 'hand']);
  assert.deepEqual(picks[KEY2], { signer: 'P99', by: 'hand', at: keptAt });
  assert.equal(picks[KEY_DIGIT].signer, 'P12');

  // null removes; removing a key that is not there is fine; an empty change set changes nothing
  assert.equal(post({ action: 'set_picks', picks: { [KEY]: null, zz_bulk_none: null } }).status, 200);
  picks = get('action=picks').json.picks;
  assert.equal(KEY in picks, false);
  assert.equal(KEY2 in picks, true);
  const raw = fs.readFileSync(picksFile, 'utf8');
  assert.equal(post({ action: 'set_picks', picks: {} }).status, 200);
  assert.equal(fs.readFileSync(picksFile, 'utf8'), raw);
  assert.deepEqual(realPicks(), picksBefore ?? {});                         // nothing but zz_ keys changed
  assert.deepEqual(fs.readdirSync(cache).filter((f) => f.includes('.tmp-')), []);
});

test('set_picks keeps every key of a burst of simultaneous requests', async () => {
  const signerOf = (i) => 'P' + String(i + 1).padStart(2, '0');
  const results = await Promise.all(PAR.map((key, i) => postAsync({ action: 'set_picks', picks: { [key]: { signer: signerOf(i), by: 'default' } } })));
  assert.deepEqual(results.map((r) => r.status), PAR.map(() => 200));
  const picks = get('action=picks').json.picks;
  assert.deepEqual(PAR.filter((k) => !(k in picks)), []);
  assert.deepEqual(PAR.map((k) => picks[k].signer), PAR.map((_, i) => signerOf(i)));
  assert.equal(KEY2 in picks, true);                                         // earlier keys survive
  assert.deepEqual(realPicks(), picksBefore ?? {});
  // removing them in a second burst loses nothing either
  const removed = await Promise.all(PAR.map((key) => postAsync({ action: 'set_picks', picks: { [key]: null } })));
  assert.deepEqual(removed.map((r) => r.status), PAR.map(() => 200));
  const left = get('action=picks').json.picks;
  assert.deepEqual(PAR.filter((k) => k in left), []);
  assert.equal(KEY2 in left, true);
  assert.deepEqual(fs.readdirSync(cache).filter((f) => f.includes('.tmp-')), []);
});

test('an empty set_picks writes nothing and creates nothing', () => {
  const beforeTree = tree();
  const stat = fs.statSync(picksFile).mtimeMs;
  const r = post({ action: 'set_picks', picks: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.picks, get('action=picks').json.picks);
  assert.deepEqual(tree(), beforeTree);
  assert.equal(fs.statSync(picksFile).mtimeMs, stat);
});

test('validation: nothing is written for a rejected request', () => {
  const beforeTree = tree();
  const beforePicks = fs.readFileSync(picksFile, 'utf8');
  const beforeMeta = fs.readFileSync(path.join(videosDir, ID_A + '.meta.json'), 'utf8');
  const is = (r, status, what) => assert.equal(r.status, status, what + ' -> ' + JSON.stringify(r.json));

  // ids
  for (const id of ['', 'abc', '../x', ID_A.toUpperCase(), ID_A + '0', ID_A.slice(1), 'g'.repeat(32), ID_A + '\n', '../../php/api/' + 'a'.repeat(18), 5, null, [ID_A]]) {
    is(post({ action: 'put_video', id, meta: meta(ID_A) }), 400, 'put_video id ' + JSON.stringify(id));
    is(post({ action: 'delete_video', id }), 400, 'delete_video id ' + JSON.stringify(id));
    is(post(candidate(KEY, 'P01', { videoId: id })), 400, 'put_candidate videoId ' + JSON.stringify(id));
  }
  for (const id of ['', 'abc', '..%2Fx', ID_A.toUpperCase(), ID_A + '0']) is(get('action=hands&id=' + id), 400, 'hands id ' + id);
  is(get('action=hands'), 400, 'hands without id');

  // keys
  for (const key of ['', '../x', 'A b', 'ZZ_UP', 'zz_a/b', 'zz_a\\b', '_zz_x', 'zz_x_', '..', 'zz_é', 7, null]) {
    is(post(candidate(key, 'P01')), 400, 'put_candidate key ' + JSON.stringify(key));
    is(post({ action: 'delete_candidates', key }), 400, 'delete_candidates key ' + JSON.stringify(key));
  }
  // Windows device names and over-long keys: 400 with a clean JSON body (callApi JSON.parses the
  // whole body, so a PHP warning printed ahead of it would throw here)
  const long = 'zz_' + 'a'.repeat(98);
  assert.equal(post({ action: 'delete_candidates', key: long.slice(0, 100) }).status, 200);   // 100 is still allowed
  for (const key of ['nul', 'con', 'prn', 'aux', 'com1', 'com9', 'lpt1', 'lpt9', long]) {
    for (const r of [post(candidate(key, 'P01')), post({ action: 'delete_candidates', key }),
      post({ action: 'set_picks', picks: { [key]: { signer: 'P01', by: 'hand' } } }), post({ action: 'set_picks', picks: { [key]: null } }),
      get(`action=candidate&key=${key}&signer=P01`), get('action=candidates&key=' + key)]) {
      is(r, 400, 'key ' + key);
      assert.deepEqual(r.json, { success: false, error: 'Invalid key' });
    }
  }
  for (const key of ['..%2Fx', 'A%20b', 'ZZ_UP', '']) is(get('action=candidates&key=' + key), 400, 'candidates key ' + key);
  for (const key of ['../x', 'A b', 'ZZ_UP', '..']) is(post({ action: 'set_picks', picks: { [key]: { signer: 'P01', by: 'hand' } } }), 400, 'set_picks key ' + key);
  for (const key of ['', '..%2Fx', 'A%20b', 'ZZ_UP']) is(get(`action=candidate&key=${key}&signer=P01`), 400, 'candidate key ' + key);

  // signers
  for (const signer of ['P00', 'P100', 'p01', 'P1', 'X01', '01', '', '../P01', 'P01.json', 1, null]) {
    is(post(candidate(KEY, signer)), 400, 'put_candidate signer ' + JSON.stringify(signer));
    is(post({ action: 'set_picks', picks: { [KEY]: { signer, by: 'hand' } } }), 400, 'set_picks signer ' + JSON.stringify(signer));
  }
  for (const signer of ['P00', 'P100', 'p01', '', '..%2FP01']) is(get(`action=candidate&key=${KEY}&signer=${signer}`), 400, 'candidate signer ' + signer);

  // the set of a candidate: required, and one of ESL | FSL | BOTH exactly
  for (const set of [undefined, null, '', 'esl', 'Both', 'ASL', 'ESL ', 1, ['ESL'], { set: 'ESL' }]) {
    const r = post(candidate(KEY, 'P01', { set }));
    is(r, 400, 'put_candidate set ' + JSON.stringify(set));
    assert.equal(r.json.error, 'set must be ESL, FSL or BOTH');
  }

  // put_video / put_candidate / set_picks shapes
  is(post({ action: 'put_video', id: ID_A }), 400, 'no meta');
  is(post({ action: 'put_video', id: ID_A, meta: [1] }), 400, 'meta list');
  is(post({ action: 'put_video', id: ID_A, meta: 'x' }), 400, 'meta string');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_B) }), 400, 'meta of another id');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A, { id: undefined }) }), 400, 'meta without id');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A, { id: null }) }), 400, 'meta with a null id');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: { ...hands(ID_A), id: undefined } }), 400, 'hands without id');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: {} }), 400, 'empty hands');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: [] }), 400, 'hands list');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), hands: hands(ID_B) }), 400, 'hands of another id');
  for (const bad of [null, 'x', [], clip(KEY, 'P01', 3, { format: undefined }), clip(KEY, 'P01', 3, { format: 'sk_avatar_clip_v2' }),
    clip(KEY, 'P01', 3, { frames: undefined }), clip(KEY, 'P01', 0), clip(KEY, 'P01', 3, { frames: {} }), clip(KEY, 'P01', 3, { frames: { 0: [] } }), clip(KEY, 'P01', 3, { frames: 'x' })]) {
    is(post(candidate(KEY, 'P01', { clip: bad })), 400, 'clip ' + JSON.stringify(bad).slice(0, 60));
  }
  for (const repIndex of [-1, 1.5, '1', null]) is(post(candidate(KEY, 'P01', { repIndex })), 400, 'repIndex ' + JSON.stringify(repIndex));
  is(post({ action: 'set_picks' }), 400, 'no picks');
  is(post({ action: 'set_picks', picks: [] }), 400, 'picks list');
  for (const pick of [{ signer: 'P01' }, { signer: 'P01', by: 'auto' }, { by: 'hand' }, 'P01', 1, [], false]) {
    is(post({ action: 'set_picks', picks: { [KEY]: pick } }), 400, 'pick ' + JSON.stringify(pick));
  }
  // one bad entry rejects the whole request (the good entry is not applied)
  is(post({ action: 'set_picks', picks: { [KEY]: { signer: 'P01', by: 'hand' }, zz_other: { signer: 'P00', by: 'hand' } } }), 400, 'mixed picks');

  // actions, methods, bodies
  is(post({ action: 'nope' }), 400, 'unknown POST action');
  is(post({ action: 'nope', id: '../x', key: '../x' }), 400, 'unknown POST action with bad fields');
  is(post({ id: ID_A }), 400, 'no action');
  is(get('action=nope'), 400, 'unknown GET action');
  is(get(''), 400, 'GET without action');
  is(callApi('bulk_import.php', { rawBody: 'not json' }), 400, 'not JSON');
  is(callApi('bulk_import.php', { rawBody: '[1]' }), 400, 'JSON list');
  is(callApi('bulk_import.php', {}), 400, 'empty body');
  for (const a of ['put_video', 'put_candidate', 'delete_video', 'delete_candidates', 'set_picks']) is(get('action=' + a + '&id=' + ID_A + '&key=' + KEY), 405, 'GET ' + a);
  for (const a of ['index', 'hands', 'candidates', 'candidate', 'picks']) is(post({ action: a, id: ID_A }), 405, 'POST ' + a);
  for (const method of ['PUT', 'DELETE', 'PATCH']) is(callApi('bulk_import.php', { method, body: { action: 'delete_video', id: ID_A }, query: 'action=index' }), 405, method);

  // size limits: 1 MB for everything but put_video, 8 MB for put_video
  const pad = (n) => 'x'.repeat(n);
  is(post({ action: 'set_picks', picks: { [KEY]: { signer: 'P01', by: 'hand' } }, pad: pad(1048600) }), 413, 'set_picks > 1 MB');
  is(post(candidate(KEY, 'P02', { pad: pad(1048600) })), 413, 'put_candidate > 1 MB');
  is(post({ action: 'delete_video', id: ID_A, pad: pad(1048600) }), 413, 'delete_video > 1 MB');
  is(post({ action: 'delete_candidates', key: KEY, pad: pad(1048600) }), 413, 'delete_candidates > 1 MB');
  is(post({ action: 'put_video', id: ID_A, meta: meta(ID_A), pad: pad(8388700) }), 413, 'put_video > 8 MB');
  is(post({ action: 'put_video', id: ID_B, meta: meta(ID_B, { pad: pad(2 * 1048576) }) }), 200, 'put_video of 2 MB is accepted');
  is(post({ action: 'put_video', id: ID_B, meta: meta(ID_B) }), 200, 'put back');

  assert.deepEqual(tree(), beforeTree);
  assert.equal(fs.readFileSync(picksFile, 'utf8'), beforePicks);
  assert.equal(fs.readFileSync(path.join(videosDir, ID_A + '.meta.json'), 'utf8'), beforeMeta);
  assert.equal(fs.existsSync(path.join(repo, 'x.meta.json')), false);
  assert.equal(fs.existsSync(path.join(repo, 'bulk_import_cache', 'x.json')), false);
});

test('delete_candidates removes one sign\'s candidates; delete_video removes both files', () => {
  const r = post({ action: 'delete_candidates', key: KEY });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.deleted, 3);
  assert.equal(fs.existsSync(path.join(candidatesDir, KEY)), false);
  assert.equal(KEY in get('action=candidates').json.candidates, false);
  assert.equal(KEY2 in get('action=candidates').json.candidates, true);          // the other sign is kept
  assert.equal(get(`action=candidate&key=${KEY}&signer=P01`).status, 404);
  assert.equal(post({ action: 'delete_candidates', key: KEY }).json.deleted, 0);
  assert.equal(post({ action: 'delete_candidates', key: KEY2 }).json.deleted, 1);

  assert.equal(fs.existsSync(path.join(videosDir, ID_A + '.meta.json')), true);
  assert.equal(fs.existsSync(path.join(videosDir, ID_A + '.hands.json')), true);
  const d = post({ action: 'delete_video', id: ID_A });
  assert.equal(d.status, 200);
  assert.equal(d.json.deleted, true);
  assert.equal(fs.existsSync(path.join(videosDir, ID_A + '.meta.json')), false);
  assert.equal(fs.existsSync(path.join(videosDir, ID_A + '.hands.json')), false);
  assert.equal(ID_A in get('action=index').json.videos, false);
  assert.equal(ID_B in get('action=index').json.videos, true);                   // the other video is kept
  assert.equal(get('action=hands&id=' + ID_A).status, 404);
  assert.equal(post({ action: 'delete_video', id: ID_A }).json.deleted, false);
  assert.equal(post({ action: 'delete_video', id: ID_B }).json.deleted, true);
});
