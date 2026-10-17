// Shared helpers for the accounts-quiz phase's endpoint tests (php-cgi, live DB, like
// tests/conversations). Test accounts are named "zzqa..." (usernames are letters and numbers only,
// so the usual "zz_" prefix is not possible) and are removed, with their conversations and quiz
// attempts, by cleanupAccounts().
import crypto from 'node:crypto';
import { callPhp, loginCookie, adminCookie, PROBE_PREFIX, probeKey } from '../conversations/helper.mjs';
import { query, exec } from '../categorization/db.mjs';

export { callPhp, loginCookie, adminCookie, PROBE_PREFIX, probeKey, query, exec };

export const ZZ = 'zzqa';

export function zzName() {
  return ZZ + crypto.randomBytes(4).toString('hex');
}

export const auth = (body, cookie = '') => callPhp({ script: '../auth.php', body, cookie });
export const adminApi = (body, cookie = '') => callPhp({ script: '../admin_api.php', body, cookie });

// Creates an account through Create account (php/auth.php register) and returns
// { username, password, id, cookie } — the cookie is that account's logged-in session.
export function makeUser(displayName = 'Zz Tester') {
  const username = zzName();
  const password = 'pw' + crypto.randomBytes(3).toString('hex');
  const r = auth({ action: 'register', display_name: displayName, username, password });
  if (r.status !== 200 || !r.json || !r.json.success) throw new Error('register failed: ' + r.raw);
  return { username, password, id: r.json.user.id, cookie: r.cookie };
}

export function cleanupAccounts() {
  exec(`DELETE FROM conversations WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${ZZ}%')`);
  exec(`DELETE FROM conversations WHERE client_key LIKE '${PROBE_PREFIX}%'`);
  exec(`DELETE FROM users WHERE username LIKE '${ZZ}%'`);
}

export function userRow(username) {
  return query(`SELECT * FROM users WHERE username = '${username}'`)[0];
}
