// Shared test folder for the bulk importer's browser checks: synthetic videos named for zz_ probe
// signs, built with the repo-root ffmpeg.exe into a folder the CALLER gives (always under
// os.tmpdir(), never under the repo or C:\xampp).
//   ESL_zz_bulk_one_P01.webm, ..._P02.webm      3 repetitions of assets/signs/en/hello.webm
//   ESL_zz_bulk_two_P01.webm, ..._P02.webm      3 repetitions of help.webm
//   ESL_zz_bulk_three_P01.webm, ..._P02.webm    3 repetitions of name.webm
//   ESL_zz_bulk_two_reps_P01.webm               2 repetitions of hello.webm
//   hello_final.webm                            a real video with a bad file name
//   desktop.ini                                 junk, ignored silently
// Each video is 320x240, 30 fps, VP8 (the recipe of tests/video-capture/fake-camera.mjs's
// buildWebm): 1.5 s black, then each repetition followed by 1.5 s black. Every file gets a fixed
// modification time, so its videoId (name|size|lastModified) is the same on every run.
// buildExtrasFolder() makes a second, separate folder for the edge cases (the default one stays
// as it is):
//   ESL_zz_bulk_none_P01.webm                   6 s of black: no repetition at all
//   ESL_zz_bulk_dup!_P01.webm, ESL_zz_bulk_dup_P01.webm   two files of ONE sign ("zz_bulk_dup":
//                                               the "!" is cleaned away) by ONE signer
//   ESL_zz_bulk_take!_P01.webm, ESL_zz_bulk_take_P01.webm  the same, but the FIRST file is 6 s of
//                                               black (no repetition): the second makes the clip
// opts.real: also copy the owner's real video (REAL_DIR/*.mp4, when present) as ESL_zz_test_P01.mp4.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(REPO_ROOT, 'ffmpeg.exe');
const SIGNS_DIR = path.join(REPO_ROOT, 'assets', 'signs', 'en');
export const REAL_DIR = 'C:/Users/ADMIN/Downloads/Avatar/videos';
export const REAL_NAME = 'ESL_zz_test_P01.mp4';
const MTIME = Date.UTC(2026, 9, 13, 0, 0, 0);      // whole seconds: File.lastModified is exact

// The source clip of each probe sign. Verified on this machine (2026-10-13, headless Chrome): the
// Hands pass finds exactly 3 repetitions in each built video and Holistic finds a pose in the
// best repetition's window. good_morning.webm and no.webm pass too (longer videos).
export const CLIPS = { zz_bulk_one: 'hello', zz_bulk_two: 'help', zz_bulk_three: 'name' };
export const SIGNERS = ['P01', 'P02'];
export const TWO_REPS_KEY = 'zz_bulk_two_reps';

// `reps` repetitions of assets/signs/en/<clip>.webm with `gap` seconds of black before, between
// and after them. One encoder thread and bitexact flags: the same bytes on every run.
export function buildRepsWebm(out, clip, reps = 3, gap = 1.5) {
  const lb = 'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';
  const black = (d) => `color=c=black:s=320x240:r=30:d=${d},format=yuv420p,setsar=1`;
  const parts = [`${black(gap)}[b0]`, `[0:v]${lb},split=${reps}${Array.from({ length: reps }, (_, i) => `[c${i + 1}]`).join('')}`];
  let chain = '[b0]';
  for (let i = 1; i <= reps; i++) {
    parts.push(`${black(gap)}[b${i}]`);
    chain += `[c${i}][b${i}]`;
  }
  parts.push(`${chain}concat=n=${reps * 2 + 1}:v=1:a=0[out]`);
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', path.join(SIGNS_DIR, clip + '.webm'),
    '-filter_complex', parts.join(';'),
    '-map', '[out]',
    '-c:v', 'libvpx', '-b:v', '1M', '-crf', '10', '-g', '30', '-threads', '1', '-pix_fmt', 'yuv420p',
    '-fflags', '+bitexact', '-flags:v', '+bitexact',
    out,
  ]);
  return out;
}

// The cache identity js/bulk-import-ui.js gives a file: first 32 hex of SHA-256(name|size|lastModified).
export function videoIdOf(file) {
  const st = fs.statSync(file);
  return crypto.createHash('sha256').update(`${path.basename(file)}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 32);
}

function stamp(file, i) {
  const t = new Date(MTIME + i * 1000);
  fs.utimesSync(file, t, t);
}

// Builds the folder. -> { dir, files: [{ name, path, kind: 'video'|'bad-name'|'junk', set?, key?,
// signer?, reps? (expected repetitions; null = not known, the real video), id? }], videos (the
// 'video' entries, sorted by name = the extraction order), keys, signers, realVideo (bool) }.
export function buildTestFolder(dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  let n = 0;
  const add = (name, kind, extra = {}) => {
    const p = path.join(dir, name);
    stamp(p, n++);
    const entry = { name, path: p, kind, ...extra };
    if (kind === 'video') entry.id = videoIdOf(p);
    files.push(entry);
    return entry;
  };
  for (const [key, clip] of Object.entries(opts.clips || CLIPS)) {
    const first = path.join(dir, `ESL_${key}_${SIGNERS[0]}.webm`);
    buildRepsWebm(first, clip, 3);
    add(path.basename(first), 'video', { set: 'ESL', key, signer: SIGNERS[0], reps: 3, clip });
    for (const signer of SIGNERS.slice(1)) {       // the same recording under another signer's name
      const copy = path.join(dir, `ESL_${key}_${signer}.webm`);
      fs.copyFileSync(first, copy);
      add(path.basename(copy), 'video', { set: 'ESL', key, signer, reps: 3, clip });
    }
  }
  const two = path.join(dir, `ESL_${TWO_REPS_KEY}_${SIGNERS[0]}.webm`);
  buildRepsWebm(two, 'hello', 2);
  add(path.basename(two), 'video', { set: 'ESL', key: TWO_REPS_KEY, signer: SIGNERS[0], reps: 2, clip: 'hello' });
  fs.copyFileSync(two, path.join(dir, 'hello_final.webm'));
  add('hello_final.webm', 'bad-name');
  fs.writeFileSync(path.join(dir, 'desktop.ini'), '[.ShellClassInfo]\r\nIconResource=C:\\Windows\\System32\\shell32.dll,4\r\n');
  add('desktop.ini', 'junk');
  let realVideo = false;
  if (opts.real && fs.existsSync(REAL_DIR)) {
    const mp4 = fs.readdirSync(REAL_DIR).filter((f) => /\.mp4$/i.test(f)).sort()[0];
    if (mp4) {
      fs.copyFileSync(path.join(REAL_DIR, mp4), path.join(dir, REAL_NAME));
      add(REAL_NAME, 'video', { set: 'ESL', key: 'zz_test', signer: 'P01', reps: null, real: true });
      realVideo = true;
    }
  }
  const videos = files.filter((f) => f.kind === 'video').sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    dir, files, videos, realVideo,
    keys: [...new Set(videos.map((v) => v.key))].sort(),
    signers: [...new Set(videos.map((v) => v.signer))].sort(),
  };
}

// `seconds` of black, 320x240 VP8: a video in which no hand is ever seen.
export function buildBlackWebm(out, seconds = 6) {
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=320x240:r=30:d=${seconds}`,
    '-c:v', 'libvpx', '-b:v', '1M', '-crf', '10', '-g', '30', '-threads', '1', '-pix_fmt', 'yuv420p',
    '-fflags', '+bitexact', '-flags:v', '+bitexact',
    out,
  ]);
  return out;
}

export const NONE_KEY = 'zz_bulk_none';
export const DUP_KEY = 'zz_bulk_dup';
export const TAKE_KEY = 'zz_bulk_take';

// The edge-case folder. -> { dir, files, videos (sorted by name), keys, none, dupFirst, dupSecond,
// takeFirst, takeSecond }.
export function buildExtrasFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const make = (name, extra, i) => {
    const p = path.join(dir, name);
    stamp(p, 100 + i);
    return { name, path: p, kind: 'video', set: 'ESL', signer: 'P01', id: videoIdOf(p), ...extra };
  };
  buildBlackWebm(path.join(dir, `ESL_${NONE_KEY}_P01.webm`));
  const none = make(`ESL_${NONE_KEY}_P01.webm`, { key: NONE_KEY, reps: 0 }, 0);
  // "!" sorts before "_": the file with it is the first of the pair in file-name order
  buildRepsWebm(path.join(dir, `ESL_${DUP_KEY}!_P01.webm`), 'hello', 3);
  fs.copyFileSync(path.join(dir, `ESL_${DUP_KEY}!_P01.webm`), path.join(dir, `ESL_${DUP_KEY}_P01.webm`));
  const dupFirst = make(`ESL_${DUP_KEY}!_P01.webm`, { key: DUP_KEY, reps: 3 }, 1);
  const dupSecond = make(`ESL_${DUP_KEY}_P01.webm`, { key: DUP_KEY, reps: 3 }, 2);
  fs.copyFileSync(none.path, path.join(dir, `ESL_${TAKE_KEY}!_P01.webm`));
  fs.copyFileSync(dupSecond.path, path.join(dir, `ESL_${TAKE_KEY}_P01.webm`));
  const takeFirst = make(`ESL_${TAKE_KEY}!_P01.webm`, { key: TAKE_KEY, reps: 0 }, 3);
  const takeSecond = make(`ESL_${TAKE_KEY}_P01.webm`, { key: TAKE_KEY, reps: 3 }, 4);
  const videos = [none, dupFirst, dupSecond, takeFirst, takeSecond].sort((a, b) => (a.name < b.name ? -1 : 1));
  return { dir, files: videos, videos, keys: [DUP_KEY, NONE_KEY, TAKE_KEY], none, dupFirst, dupSecond, takeFirst, takeSecond };
}
