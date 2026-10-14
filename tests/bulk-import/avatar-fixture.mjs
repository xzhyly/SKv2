// Shared by avatar-step-check.mjs and candidates-panel-check.mjs: real avatar clips to put in the
// bulk importer's cache as candidates WITHOUT running an extraction, and the small cache helpers.
// A clip is cut from the owner's prototype sample when it is on this machine
// (tests/avatar/helper.mjs sampleClip()), otherwise it is a made-up but valid sk_avatar_clip_v1
// (a signer raising and lowering the right hand). Either way it passes AvatarClip.validateClip and
// AvatarRetarget.prepare here, before a test uses it. Each signer gets a different frame count, so
// a test can tell whose clip a sign holds.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Clip, Retarget, Rig, haveSample, sampleClip } from '../avatar/helper.mjs';
import { callApi, repo, saved } from '../sign-texts/api-helper.mjs';

export const CACHE = path.join(repo, 'bulk_import_cache');
export const PICKS_FILE = path.join(CACHE, 'picks.json');
export const api = (body) => callApi('bulk_import.php', { body });
export const apiGet = (query) => callApi('bulk_import.php', { method: 'GET', query });
export const picksOnDisk = () => (fs.existsSync(PICKS_FILE) ? JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8')) : {});
export const avatarFile = (key) => path.join(saved, key, 'avatar.json');
export const avatarOnDisk = (key) => (fs.existsSync(avatarFile(key)) ? JSON.parse(fs.readFileSync(avatarFile(key), 'utf8')) : null);
export const usingSample = haveSample;

const r4 = (v) => Math.round(v * 10000) / 10000;
// 60 frames at 25 fps: the right wrist goes from the hip up to the shoulder and back.
export function syntheticClip() {
  const frames = [];
  for (let i = 0; i < 60; i++) {
    const up = Math.sin(Math.PI * i / 59);                       // 0 .. 1 .. 0
    const wr = { x: 0.36 - 0.04 * up, y: 0.78 - 0.42 * up };
    const pose = [
      [0.5, 0.2, -0.3, 0.99], [0.54, 0.19, -0.1, 0.99], [0.46, 0.19, -0.1, 0.99],   // nose, ears
      [0.62, 0.4, -0.1, 0.99], [0.38, 0.4, -0.1, 0.99],                              // shoulders
      [0.66, 0.6, -0.05, 0.95], [0.33, 0.6 - 0.1 * up, -0.05, 0.95],                 // elbows
      [0.65, 0.78, -0.1, 0.9], [wr.x, wr.y, -0.2, 0.9],                              // wrists
      [0.58, 0.85, 0, 0.9], [0.42, 0.85, 0, 0.9],                                    // hips
    ].map((p) => p.map(r4));
    const hand = [];
    for (let j = 0; j < 21; j++) {
      const finger = j === 0 ? 0 : Math.floor((j - 1) / 4), joint = j === 0 ? 0 : (j - 1) % 4 + 1;
      hand.push([r4(wr.x + (finger - 2) * 0.012 * (joint ? 1 : 0)), r4(wr.y - joint * 0.02), r4(-0.01 * joint)]);
    }
    frames.push([pose, null, hand]);
  }
  return Clip.buildClip({
    key: 'zz_sample', fps: 25, video: { w: 640, h: 480, durationMs: 2400 }, frames,
    trim: { start: 0, end: frames.length - 1, auto: false }, createdAt: '2026-10-14T00:00:00Z',
  });
}
const BASE = JSON.stringify(haveSample ? sampleClip() : syntheticClip());

// The clip of one sign by one signer: P01 the whole base clip, P02 four frames shorter, ...
export function makeClip(key, signer) {
  const clip = JSON.parse(BASE);
  const n = Number(signer.slice(1));
  clip.key = key;
  clip.signer = signer;
  clip.frames = clip.frames.slice(0, clip.frames.length - 4 * (n - 1));
  const v = Clip.validateClip(clip);
  if (!v.ok) throw new Error('fixture clip is not valid: ' + v.error);
  Retarget.prepare(clip, Rig);                                  // throws when it cannot be played
  return clip;
}
export const videoIdFor = (key, signer) => crypto.createHash('sha256').update('zz-fixture|' + key + '|' + signer).digest('hex').slice(0, 32);
// Writes one candidate straight through the endpoint (set: the set of the video it stands for);
// -> the clip that was stored.
export function putCandidate(key, signer, set = 'ESL') {
  const clip = makeClip(key, signer);
  const r = api({ action: 'put_candidate', key, signer, set, videoId: videoIdFor(key, signer), repIndex: 1, clip });
  if (r.status !== 200 || !r.json.success) throw new Error(`put_candidate ${key} ${signer}: ${JSON.stringify(r.json)}`);
  return clip;
}
// Removes the candidates of these zz keys and EVERY zz_ pick (tests/avatar/import-check.mjs saves
// clips with Signer P03 for its own zz probes, which now records picks it does not remove); never
// anything else of the cache.
export function cleanCacheKeys(keys) {
  const picks = {};
  for (const k of Object.keys(picksOnDisk())) if (k.startsWith('zz_')) picks[k] = null;
  // ... and every zz_ candidate folder another check's interrupted run may have left behind
  for (const k of Object.keys(apiGet('action=candidates').json.candidates || {})) if (k.startsWith('zz_')) api({ action: 'delete_candidates', key: k });
  for (const key of keys) {
    if (!key.startsWith('zz_')) throw new Error('not a zz key: ' + key);
    api({ action: 'delete_candidates', key });
    picks[key] = null;
  }
  api({ action: 'set_picks', picks });
}
// What the cache holds for other keys: "relative path|size|sha1" of every candidate file whose
// sign key does not start with zz_, and the non-zz picks.
export function othersInCache() {
  const out = [];
  const root = path.join(CACHE, 'candidates');
  for (const key of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (key.startsWith('zz_')) continue;
    for (const name of fs.readdirSync(path.join(root, key))) {
      const p = path.join(root, key, name);
      out.push(`${key}/${name}|${fs.statSync(p).size}|${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`);
    }
  }
  const picks = picksOnDisk();
  return JSON.stringify({ files: out.sort(), picks: Object.keys(picks).filter((k) => !k.startsWith('zz_')).sort().map((k) => [k, picks[k]]) });
}
// Every non-zz file of saved_gestures as one hash of "relative path|size|sha1": must not change.
export function othersSaved() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (d !== saved || !e.name.startsWith('zz_')) walk(p); continue; }
      out.push(`${path.relative(saved, p)}|${fs.statSync(p).size}|${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(saved);
  return crypto.createHash('sha1').update(out.sort().join('\n')).digest('hex');
}
// In the page, before any page script: the list of ALL candidates (?action=candidates without a
// key) only names zz_ keys. "Apply to all signs" under test can then never write a clip of a real
// sign, whatever the owner's cache holds. Nothing else is changed.
export const ZZ_ONLY = `(() => { const real = window.fetch;
  window.fetch = function (url, o) {
    const u = String(url);
    if (!(o && o.method === 'POST') && /bulk_import\\.php\\?action=candidates$/.test(u)) {
      return real.apply(this, arguments).then((r) => r.json().then((d) => {
        const c = {}; Object.keys(d.candidates || {}).forEach((k) => { if (k.indexOf('zz_') === 0) c[k] = d.candidates[k]; });
        d.candidates = c;
        return new Response(JSON.stringify(d), { status: r.status, headers: { 'Content-Type': 'application/json' } });
      }));
    }
    return real.apply(this, arguments);
  }; })();`;
