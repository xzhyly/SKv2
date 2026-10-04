// php-cgi caller for php/api/*.php plus zz-probe cleanup helpers (live DB; zz-prefixed probes only).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PHP_CGI, repo, queryDb, LIVE_DB } from '../normalization/clone-helper.mjs';

export { repo };
export const saved = path.join(repo, 'saved_gestures');
export const savedFsl = path.join(repo, 'saved_gestures_fsl');

export function callApi(script, { method = 'POST', body = null, rawBody = null, query = '' } = {}) {
  const payload = rawBody !== null ? Buffer.from(rawBody) : body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const env = { ...process.env, REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: method,
    SCRIPT_FILENAME: path.join(repo, 'php', 'api', script), SCRIPT_NAME: '/SKR/php/api/' + script,
    QUERY_STRING: query, CONTENT_TYPE: 'application/json', CONTENT_LENGTH: String(payload.length) };
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 256 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  const head = cut >= 0 ? out.slice(0, cut) : '';
  const m = /^Status:\s*(\d+)/im.exec(head);
  const text = cut >= 0 ? out.slice(cut + 4) : out;
  return { status: m ? Number(m[1]) : 200, json: JSON.parse(text) };
}
export const saveApi = (opts) => callApi('save_gesture.php', opts);
export const signsApi = (opts) => callApi('signs.php', opts);

export function frames(n = 2) {
  return Array.from({ length: n }, (_, i) => ({ index: i, timestamp: i, landmarks: Array(126).fill(0.1) }));
}
export const save = (extra) => saveApi({ body: { frames: frames(), ...extra } });

export const sql = (q) => queryDb(LIVE_DB, q);
export const row = (key) => sql(`SELECT * FROM gestures WHERE label = '${key}'`)[0];
export const dir = (key) => path.join(saved, key);
export const samples = (key) => fs.existsSync(dir(key)) ? fs.readdirSync(dir(key)).filter(f => /^sample_.*\.json$/.test(f)).sort() : [];
export const signJson = (key) => JSON.parse(fs.readFileSync(path.join(dir(key), 'sign.json'), 'utf8'));

// Removes every zz_* folder/row this suite may have left (never anything else).
export function cleanZz() {
  for (const root of [saved, savedFsl]) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) if (d.startsWith('zz_')) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
  sql(`DELETE FROM gesture_recordings WHERE gesture_id IN (SELECT id FROM gestures WHERE label LIKE 'zz\\_%')`);
  sql(`DELETE FROM gestures WHERE label LIKE 'zz\\_%'`);
}
export function liveCounts() {
  const g = sql(`SELECT sign_language s, COUNT(*) c FROM gestures GROUP BY sign_language`);
  const r = sql(`SELECT COUNT(*) c FROM gesture_recordings`)[0].c;
  return JSON.stringify({ g: g.sort((a, b) => a.s.localeCompare(b.s)), r });
}
