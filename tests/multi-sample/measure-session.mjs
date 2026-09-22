import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { callEndpoint, cleanupProbe, ffmpegRuns, fixtureFrames, fixtureVideo, LABEL } from './harness.mjs';

const log = path.join(os.tmpdir(), 'sk-ffmpeg-session.log');
cleanupProbe(); fs.rmSync(log, { force: true });
const ms = [];
for (let i = 1; i <= 5; i++) {
  const t0 = performance.now();
  const r = callEndpoint({ logFile: log, body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3), video_base64: fixtureVideo() } });
  ms.push(Math.round(performance.now() - t0));
  if (!r.success) throw new Error(JSON.stringify(r));
}
console.log(JSON.stringify({ takes: 5, ffmpegRuns: ffmpegRuns(log), endpointMsPerSave: ms, note: 'php-cgi cold start included; dev machine, not the Pi' }));
cleanupProbe();
