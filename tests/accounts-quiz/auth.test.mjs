// php/auth.php (accounts-quiz phase): Create account, Log in, Log out, who am I.
// Live DB via php-cgi: SK_PHP_CGI / SK_PHP_CLI as for tests/conversations.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { auth, makeUser, zzName, cleanupAccounts, userRow, exec, adminCookie } from './helper.mjs';

before(cleanupAccounts);
after(cleanupAccounts);

const me = (cookie) => auth({ action: 'me' }, cookie).json.user;

test('Create account: role user, display name kept, logged in at once, last_login_at set', () => {
  const u = makeUser('Janel Q');
  const row = userRow(u.username);
  assert.equal(row.role, 'user');
  assert.equal(row.display_name, 'Janel Q');
  assert.equal(row.email, null);
  assert.equal(row.is_active, '1');
  assert.notEqual(row.last_login_at, null);
  assert.ok(row.password_hash.startsWith('$2y$'), 'bcrypt hash');
  assert.deepEqual(me(u.cookie), { id: u.id, username: u.username, display_name: 'Janel Q', role: 'user' });
});

test('Create account ignores a role sent by the client', () => {
  const username = zzName();
  const r = auth({ action: 'register', display_name: 'Sneaky', username, password: 'abcd', role: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(userRow(username).role, 'user');
});

test('Create account validation: password min 4, username letters/numbers, all fields, taken username', () => {
  // A refusal the person caused is HTTP 200 + {success:false, code} (no console error in the page).
  const refused = (r, code) => r.status === 200 && r.json.success === false && r.json.code === code && r.cookie === null;
  const short = auth({ action: 'register', display_name: 'A', username: zzName(), password: 'abc' });
  assert.ok(refused(short, 'invalid'), short.raw);
  assert.match(short.json.message, /at least 4/);
  const bad = auth({ action: 'register', display_name: 'A', username: 'zz qa!', password: 'abcd' });
  assert.ok(refused(bad, 'invalid'), bad.raw);
  const missing = auth({ action: 'register', display_name: '', username: zzName(), password: 'abcd' });
  assert.ok(refused(missing, 'missing'), missing.raw);
  const u = makeUser();
  const dup = auth({ action: 'register', display_name: 'B', username: u.username.toUpperCase(), password: 'abcd' });
  assert.ok(refused(dup, 'taken'), 'usernames are unique regardless of case: ' + dup.raw);
});

test('Log in: right password -> session + last_login_at; wrong password -> refused, no session', () => {
  const u = makeUser();
  exec(`UPDATE users SET last_login_at = NULL WHERE id = ${u.id}`);
  const ok = auth({ action: 'login', username: u.username, password: u.password });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.username, u.username);
  assert.ok(ok.cookie);
  assert.notEqual(userRow(u.username).last_login_at, null);
  assert.equal(me(ok.cookie).id, u.id);

  const bad = auth({ action: 'login', username: u.username, password: 'nope' });
  assert.equal(bad.status, 200);
  assert.deepEqual([bad.json.success, bad.json.code], [false, 'wrong_password']);
  assert.equal(bad.json.message, 'Wrong username or password.');
  assert.equal(bad.cookie, null);
});

test('A deactivated user cannot log in, and an open session stops working', () => {
  const u = makeUser();
  exec(`UPDATE users SET is_active = 0 WHERE id = ${u.id}`);
  const r = auth({ action: 'login', username: u.username, password: u.password });
  assert.deepEqual([r.status, r.json.success, r.json.code, r.cookie], [200, false, 'inactive', null]);
  assert.match(r.json.message, /turned off/);
  assert.equal(me(u.cookie), null, 'the session from before is no longer a user');
});

test('Log out ends the session', () => {
  const u = makeUser();
  assert.equal(me(u.cookie).id, u.id);
  const r = auth({ action: 'logout' }, u.cookie);
  assert.equal(r.status, 200);
  assert.equal(me(u.cookie), null);
});

test('The seeded admin logs in on the same endpoint (admin / admin123 unless overridden)', () => {
  const cookie = adminCookie();
  assert.equal(me(cookie).role, 'admin');
});

test('A guest is nobody', () => {
  assert.equal(me(''), null);
});
