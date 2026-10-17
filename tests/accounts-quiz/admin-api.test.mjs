// php/admin_api.php (accounts-quiz phase): admin-only (403 for a guest or a user), Manage users
// actions, no delete, an admin cannot deactivate itself. Also checks the other admin-only reads
// (conversations.php list/delete, quiz.php all scores) give 403 to a guest.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { adminApi, auth, makeUser, zzName, cleanupAccounts, userRow, adminCookie, callPhp } from './helper.mjs';

// The person's own mistakes are HTTP 200 + {success:false, code}; only "not an admin" is 403.
const refused = (r, code) => r.status === 200 && r.json.success === false && r.json.code === code;
const loginOk = (username, password) => auth({ action: 'login', username, password }).json.success === true;

before(cleanupAccounts);
after(cleanupAccounts);

test('guest and user get 403 for every admin action; requester_id is not trusted', () => {
  const u = makeUser();
  const adminId = auth({ action: 'me' }, adminCookie()).json.user.id;
  for (const action of ['list_users', 'create_user', 'reset_password', 'set_active', 'get_gestures', 'get_stats']) {
    assert.equal(adminApi({ action }).status, 403, `guest ${action}`);
    assert.equal(adminApi({ action }, u.cookie).status, 403, `user ${action}`);
    assert.equal(adminApi({ action, requester_id: adminId }, u.cookie).status, 403, `user + requester_id ${action}`);
  }
});

test('other admin APIs answer 403 to a guest', () => {
  assert.equal(callPhp({ script: 'conversations.php', method: 'GET' }).status, 403);
  assert.equal(callPhp({ script: 'conversations.php', method: 'POST', body: { action: 'clear_all' } }).status, 403);
  assert.equal(callPhp({ script: 'quiz.php', method: 'GET', query: 'action=scores' }).status, 403);
});

test('list_users: name, username, role, status, last login; marks the admin itself', () => {
  const u = makeUser('Listed Person');
  const r = adminApi({ action: 'list_users' }, adminCookie());
  assert.equal(r.status, 200);
  const row = r.json.users.find((x) => x.username === u.username);
  assert.deepEqual(Object.keys(row).sort(), ['created_at', 'display_name', 'id', 'is_active', 'is_me', 'last_login_at', 'role', 'username']);
  assert.equal(row.display_name, 'Listed Person');
  assert.equal(row.role, 'user');
  assert.equal(row.is_active, true);
  assert.equal(r.json.users.filter((x) => x.is_me).length, 1);
  assert.equal(r.json.users.find((x) => x.is_me).role, 'admin');
});

test('create_user: user or admin role; the new account can log in', () => {
  const username = zzName();
  const r = adminApi({ action: 'create_user', display_name: 'New Admin', username, password: 'pass1', role: 'admin' }, adminCookie());
  assert.equal(r.status, 200, r.raw);
  assert.equal(userRow(username).role, 'admin');
  assert.ok(loginOk(username, 'pass1'));
  const dup = adminApi({ action: 'create_user', display_name: 'X', username, password: 'pass1', role: 'user' }, adminCookie());
  assert.ok(refused(dup, 'taken'), dup.raw);
  const shortPw = adminApi({ action: 'create_user', display_name: 'X', username: zzName(), password: '123' }, adminCookie());
  assert.ok(refused(shortPw, 'invalid'), shortPw.raw);
});

test('reset_password: the old password stops working, the new one works', () => {
  const u = makeUser();
  const r = adminApi({ action: 'reset_password', id: u.id, password: 'fresh9' }, adminCookie());
  assert.equal(r.status, 200, r.raw);
  assert.equal(loginOk(u.username, u.password), false);
  assert.ok(loginOk(u.username, 'fresh9'));
  assert.ok(refused(adminApi({ action: 'reset_password', id: u.id, password: 'abc' }, adminCookie()), 'invalid'));
  assert.ok(refused(adminApi({ action: 'reset_password', id: 999999999, password: 'abcd' }, adminCookie()), 'not_found'));
});

test('set_active: deactivate blocks login, activate allows it again; no self-deactivation', () => {
  const u = makeUser();
  assert.equal(adminApi({ action: 'set_active', id: u.id, active: false }, adminCookie()).status, 200);
  assert.equal(userRow(u.username).is_active, '0');
  assert.equal(auth({ action: 'login', username: u.username, password: u.password }).json.code, 'inactive');
  assert.equal(adminApi({ action: 'set_active', id: u.id, active: true }, adminCookie()).status, 200);
  assert.ok(loginOk(u.username, u.password));

  const adminId = auth({ action: 'me' }, adminCookie()).json.user.id;
  const self = adminApi({ action: 'set_active', id: adminId, active: false }, adminCookie());
  assert.ok(refused(self, 'self'), self.raw);
  assert.match(self.json.message, /own account/);
});

test('there is no delete: delete_user / update_user are unknown actions', () => {
  const u = makeUser();
  for (const action of ['delete_user', 'update_user', 'delete_gesture', 'clear_gestures']) {
    const r = adminApi({ action, id: u.id }, adminCookie());
    assert.ok(refused(r, 'unknown_action'), action);
  }
  assert.ok(userRow(u.username), 'the user still exists');
});
