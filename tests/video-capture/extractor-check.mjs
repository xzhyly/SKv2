// Check for Task 4 (video-based gesture capture): js/video-landmarks.js's
// extractVideoLandmarks() + js/gesture-data.js's createVideoDetector()/onHandResults().
//
// Drives tests/video-capture/extractor.page.html over headless Chrome via CDP
// (tests/video-capture/cdp.mjs). Builds a synthetic MediaRecorder WebM in-page (3 plays of
// assets/signs/en/hello.webm with 1.5s black gaps at 320x240, same recipe as
// .git/sdd/spike.html's makeRecording), then produces a no-cues/no-duration copy with
// ffmpeg.exe -c copy in a temporary folder under tests/video-capture/ (deleted at the end,
// never committed, nothing written under assets/). Verifies, for BOTH files:
//   - frames.length === Math.ceil(duration * 15)
//   - durationMs is finite
//   - two runs on the same file give identical frames (deep-equal)
//   - a run with inputWidth:640/inputHeight:480 works and reports input.width 640
//   - the result, passed through GestureCaptureCore.segmentFrames, is ok with 3 reps
//   - an aborted run rejects with AbortError
//   - the live loop resumes after release() (hands.send is called again)
//   - total processing ms for one run
//   - (fix round 1) onProgress is called exactly frames.length times, and `done` never
//     exceeds `total`
//   - (fix round 1) the ffmpeg no-cues copy really exercises extractVideoLandmarks' Infinity-
//     duration branch (probed independently via window.probeDuration())
// and asserts 0 console errors (MediaPipe's own info/warning logs are not errors).
//
// Run: node tests/video-capture/extractor-check.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FFMPEG = path.join(REPO_ROOT, 'ffmpeg.exe');
const PAGE_URL = 'http://localhost/SKR/tests/video-capture/extractor.page.html';
const CLIP_URL = '/SKR/assets/signs/en/hello.webm';

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}${detail ? ' - ' + detail : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`);
  }
}

function deepEqualFrames(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const tmpDir = mkdtempSync(path.join(__dirname, '.tmp-extractor-'));
  let chrome = null;
  try {
    chrome = await launchChrome();
    await chrome.navigate(PAGE_URL);

    console.log('--- setup ---');
    const setupResult = await chrome.evaluate(`window.setupMp(${JSON.stringify(CLIP_URL)})`);
    check('MediaPipe set up on hidden #videoFeed', setupResult && setupResult.ok === true);

    console.log('--- building synthetic recording ---');
    const recMeta = await chrome.evaluate(`window.makeRecording(${JSON.stringify(CLIP_URL)}, 1500, 30)`);
    console.log(`  recording built: ${recMeta.bytes} bytes, source clip duration ${recMeta.clipDuration}s`);

    const inBase64 = await chrome.evaluate('window.recBlobBase64()');
    const inPath = path.join(tmpDir, 'in.webm');
    writeFileSync(inPath, Buffer.from(inBase64, 'base64'));

    console.log('--- producing no-cues/no-duration copy via ffmpeg -c copy ---');
    const outPath = path.join(tmpDir, 'out.webm');
    const stdout = execFileSync(FFMPEG, ['-y', '-i', inPath, '-c', 'copy', '-f', 'webm', 'pipe:1'], {
      maxBuffer: 1024 * 1024 * 64,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    writeFileSync(outPath, stdout);
    console.log(`  out.webm: ${stdout.length} bytes`);

    const outUrl = `http://localhost/SKR/tests/video-capture/${path.basename(tmpDir)}/out.webm`;

    const files = [
      {
        name: 'in.webm (original MediaRecorder output)',
        load: `window.loadBlobFromUrl(${JSON.stringify(`http://localhost/SKR/tests/video-capture/${path.basename(tmpDir)}/in.webm`)})`,
        expectInfiniteDuration: false,
      },
      {
        name: 'out.webm (ffmpeg -c copy, no cues/duration)',
        load: `window.loadBlobFromUrl(${JSON.stringify(outUrl)})`,
        expectInfiniteDuration: true,
      },
    ];

    for (const file of files) {
      console.log(`\n--- ${file.name} ---`);
      const bytes = await chrome.evaluate(file.load);
      console.log(`  loaded ${bytes} bytes into window.recBlob`);

      const probe = await chrome.evaluate('window.probeDuration()');
      console.log(`  probed raw duration: isInfinite=${probe.isInfinite} raw=${probe.durationRaw}`);
      if (file.expectInfiniteDuration) {
        check(
          'this file really exercises the Infinity-duration branch',
          probe.isInfinite === true,
          `probe=${JSON.stringify(probe)}`
        );
      }

      const run1 = await chrome.evaluate('window.runExtract({})');
      check('run 1 succeeded', run1.ok === true, run1.ok ? '' : `${run1.errorName}: ${run1.errorMessage}`);
      if (!run1.ok) continue;

      const durationMs = run1.result.durationMs;
      check('durationMs is finite', Number.isFinite(durationMs), `durationMs=${durationMs}`);

      const expectedFrames = Math.ceil((durationMs / 1000) * 15);
      check(
        'frames.length === Math.ceil(duration*15)',
        run1.result.frames.length === expectedFrames,
        `frames=${run1.result.frames.length} expected=${expectedFrames} durationMs=${durationMs}`
      );

      const maxDone = Math.max(...run1.progressCalls.map((p) => p[0]));
      const progressTotal = run1.progressCalls.length ? run1.progressCalls[0][1] : -1;
      check(
        'onProgress called exactly frames.length times',
        run1.progressCalls.length === run1.result.frames.length,
        `progressCalls=${run1.progressCalls.length} frames=${run1.result.frames.length}`
      );
      check(
        'onProgress `done` never exceeds `total`',
        maxDone <= progressTotal,
        `maxDone=${maxDone} total=${progressTotal}`
      );

      console.log(`  total processing ms (run 1, 320x240): ${run1.totalMs}`);

      const run2 = await chrome.evaluate('window.runExtract({})');
      check('run 2 succeeded', run2.ok === true);
      check(
        'two runs on the same file give identical frames (deep-equal)',
        run2.ok && deepEqualFrames(run1.result.frames, run2.result.frames)
      );

      const run640 = await chrome.evaluate('window.runExtract({ inputWidth: 640, inputHeight: 480 })');
      check('run with inputWidth 640/inputHeight 480 succeeded', run640.ok === true);
      check(
        'result reports input.width 640',
        run640.ok && run640.result.input.width === 640 && run640.result.input.height === 480,
        run640.ok ? `input=${JSON.stringify(run640.result.input)}` : ''
      );

      const seg = await chrome.evaluate(`window.checkSegmentation(${JSON.stringify(run1.result)})`);
      check('segmentFrames(result) is ok with 3 reps', seg.ok === true && seg.repsCount === 3, JSON.stringify(seg));

      const abortAfter = Math.max(3, Math.round(expectedFrames / 4));
      const aborted = await chrome.evaluate(`window.runExtract({ abortAfterFrames: ${abortAfter} })`);
      check(
        'aborted run rejects with AbortError',
        aborted.ok === false && aborted.errorName === 'AbortError',
        JSON.stringify({ ok: aborted.ok, errorName: aborted.errorName })
      );
    }

    console.log('\n--- live loop resumes after release() ---');
    const sendCountBefore = await chrome.evaluate('window.getSendCount()');
    const sendCountAfterWait = await chrome.evaluate('window.waitAndGetSendCount(400)');
    check(
      'hands.send() is called again after the last release()',
      sendCountAfterWait > sendCountBefore,
      `before=${sendCountBefore} after400ms=${sendCountAfterWait}`
    );

    console.log('\n--- console errors ---');
    const consoleErrors = chrome.getConsoleErrors();
    const exceptions = chrome.getExceptions();
    check('0 console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors));
    check('0 uncaught exceptions', exceptions.length === 0, JSON.stringify(exceptions));

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    if (chrome) await chrome.close();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('CHECK CRASHED:', err);
  process.exitCode = 1;
});
