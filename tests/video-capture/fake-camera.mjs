// Shared fake-camera builder for the headless checks (e2e.mjs, screenshots.mjs): a 320x240, 30fps
// .y4m made with the repo-root ffmpeg.exe - 2s black, assets/signs/en/hello.webm letterboxed,
// 1.5s black, the clip, 1.5s black, the clip, 3s black (three reps for the segmenter to find).
// Chromium plays it on a loop through --use-file-for-fake-video-capture.
// buildWebm() makes the same kind of recording as a fixed VP8 .webm file, for extractor-check.mjs.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(REPO_ROOT, 'ffmpeg.exe');
const CLIP = path.join(REPO_ROOT, 'assets', 'signs', 'en', 'hello.webm');

// Task 6's exact recipe: 2s black, clip letterboxed, 1.5s black, clip, 1.5s black, clip, 3s black.
export function buildY4m(dir) {
  const out = path.join(dir, 'fake-cam.y4m');
  const lb =
    'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';
  const black = (d) => `color=c=black:s=320x240:r=30:d=${d},format=yuv420p,setsar=1`;
  const filter = [
    `${black(2)}[b0]`,
    `[0:v]${lb},split=3[c1][c2][c3]`,
    `${black(1.5)}[b1]`,
    `${black(1.5)}[b2]`,
    `${black(3)}[b3]`,
    '[b0][c1][b1][c2][b2][c3][b3]concat=n=7:v=1:a=0[out]',
  ].join(';');
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', CLIP,
    '-filter_complex', filter,
    '-map', '[out]',
    '-pix_fmt', 'yuv420p',
    out,
  ]);
  return out;
}

// extractor-check.mjs's recording: 1.5s black, the clip, 1.5s black, the clip, 1.5s black, the
// clip, 1.5s black at 320x240, 30fps, VP8 (the codec MediaRecorder writes on the capture screen).
// Built by ffmpeg from fixed inputs with one encoder thread, so its length and frames do not depend
// on machine load (the in-page MediaRecorder recording it replaces did: 16.7-20.5 s, see
// docs/reports/2026-09-26-video-capture-final.md).
export function buildWebm(dir, name = 'in.webm') {
  const out = path.join(dir, name);
  const lb =
    'scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p';
  const black = (d) => `color=c=black:s=320x240:r=30:d=${d},format=yuv420p,setsar=1`;
  const filter = [
    `${black(1.5)}[b0]`,
    `[0:v]${lb},split=3[c1][c2][c3]`,
    `${black(1.5)}[b1]`,
    `${black(1.5)}[b2]`,
    `${black(1.5)}[b3]`,
    '[b0][c1][b1][c2][b2][c3][b3]concat=n=7:v=1:a=0[out]',
  ].join(';');
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', CLIP,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:v', 'libvpx', '-b:v', '1M', '-crf', '10', '-g', '30', '-threads', '1', '-pix_fmt', 'yuv420p',
    '-fflags', '+bitexact', '-flags:v', '+bitexact',
    out,
  ]);
  return out;
}
