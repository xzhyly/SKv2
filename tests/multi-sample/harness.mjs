import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..');
export const LABEL = 'zz_multisample_probe';
const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';
const ENDPOINT = path.join(repo, 'php', 'api', 'save_gesture.php');

export function fixtureVideo() {
  const p = path.join(repo, 'assets', 'signs', 'en', 'help.webm'); // real 74 KB stock clip
  return 'data:video/webm;base64,' + fs.readFileSync(p).toString('base64');
}
export function fixtureFrames(n = 3) {
  return Array.from({ length: n }, (_, i) => ({ index: i, timestamp: i, landmarks: Array(126).fill(0.1) }));
}

// Runs save_gesture.php under php-cgi exactly as Apache would, optionally with the ffmpeg shim first on PATH.
export function callEndpoint({ method = 'POST', body = null, query = '', stub = true, logFile = null, extraEnv = {} } = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const env = { ...process.env, ...extraEnv,
    REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: method,
    SCRIPT_FILENAME: ENDPOINT, SCRIPT_NAME: '/SKR/php/api/save_gesture.php',
    QUERY_STRING: query, CONTENT_TYPE: 'application/json', CONTENT_LENGTH: String(payload.length) };
  if (stub) {
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = path.join(here, 'ffmpeg-stub') + ';' + (env[pathKey] || '');
    env.SK_FFMPEG_LOG = logFile || path.join(here, 'ffmpeg-calls.log');
    env.SK_REAL_FFMPEG = path.join(repo, 'ffmpeg.exe');
  }
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 256 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  return JSON.parse(cut >= 0 ? out.slice(cut + 4) : out);
}

export function ffmpegRuns(logFile) {
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0;
}

export function cleanupProbe() {
  callEndpoint({ body: { action: 'delete_gesture', label: LABEL }, stub: false });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm'])
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${LABEL}.${ext}`), { force: true });
}

export function sampleFiles() {
  const dir = path.join(repo, 'saved_gestures', LABEL);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^sample_.*\.json$/.test(f)) : [];
}
export const videoPath = ext => path.join(repo, 'assets', 'signs', 'en', `${LABEL}.${ext}`);
