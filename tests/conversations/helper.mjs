// Generic PHP-CGI test harness for php/api/<script> endpoints, modeled on
// tests/multi-sample/harness.mjs:1-37 (same REDIRECT_STATUS/SCRIPT_FILENAME approach), but not
// hard-wired to one script. Also carries the conversations-specific probe-key + cleanup helpers.
//
// Note on probe keys: the global "zz prefix" convention (docs/system/DEBT.md / conv-global.md)
// cannot be applied literally here, because save_conversation.php's client_key must match
// /^[0-9a-f]{32}$/ (hex only) and 'z' is not a hex digit — a literal "zz..." key would always be
// rejected as a bad-key-format case, which defeats the point of a probe key. Instead probe keys
// use the hex-valid, still visually-distinctive prefix "dead" (all of d/e/a/d are valid hex
// digits), and cleanup matches on that prefix instead of 'zz%'. See conv-task-2-report.md.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from '../categorization/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..');
const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';

// Runs php/api/<script> under php-cgi exactly as Apache would.
// body: a JS value to JSON.stringify and send as the request body.
// raw: a literal string to send as-is instead (used for invalid-JSON tests) — takes precedence
// over body when both are omitted/undefined this stays empty (no body, e.g. for GET).
export function callPhp({ script, method = 'POST', body, raw, query = '' } = {}) {
  const payload = raw !== undefined
    ? Buffer.from(raw, 'utf8')
    : (body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0));
  const scriptPath = path.join(repo, 'php', 'api', script);
  const env = {
    ...process.env,
    REDIRECT_STATUS: '1',
    GATEWAY_INTERFACE: 'CGI/1.1',
    REQUEST_METHOD: method,
    SCRIPT_FILENAME: scriptPath,
    SCRIPT_NAME: `/SKR/php/api/${script}`,
    QUERY_STRING: query,
    CONTENT_TYPE: 'application/json',
    CONTENT_LENGTH: String(payload.length),
  };
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  const headerPart = cut >= 0 ? out.slice(0, cut) : '';
  const bodyPart = cut >= 0 ? out.slice(cut + 4) : out;
  const statusMatch = headerPart.match(/^Status:\s*(\d+)/mi);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
  let json = null;
  try { json = JSON.parse(bodyPart); } catch { json = null; }
  return { status, json, raw: bodyPart, stderr: r.stderr.toString('utf8') };
}

// Hex-valid probe client_key: "dead" + 28 random hex chars = 32 chars total, matches
// /^[0-9a-f]{32}$/ and is trivially greppable/cleanable.
export function probeKey() {
  return ('dead' + crypto.randomBytes(14).toString('hex')).slice(0, 32);
}

export function cleanupProbes() {
  exec("DELETE FROM conversations WHERE client_key LIKE 'dead%'");
}
