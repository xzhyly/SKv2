// Let's Talk history per account (accounts-quiz phase): save_conversation.php fills user_id (the
// session's user, NULL for a guest) and title (first message, trimmed, 120 chars); conversations.php
// shows a user only their own and an admin everything, with user / language filters and paging.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { callPhp, probeKey, makeUser, cleanupAccounts, adminCookie, query } from './helper.mjs';

before(cleanupAccounts);
after(cleanupAccounts);

function say(key, seq, text, cookie = '', lang = 'FSL') {
  const body = seq % 2
    ? { action: 'message', client_key: key, seq, speaker: 'signer', source: 'sign', sign_language: lang, text }
    : { action: 'message', client_key: key, seq, speaker: 'hearing', source: 'typed', sign_language: null, text };
  const r = callPhp({ script: 'save_conversation.php', body, cookie });
  assert.equal(r.status, 200, r.raw);
}
const row = (key) => query(`SELECT user_id, title FROM conversations WHERE client_key = '${key}'`)[0];
const list = (q, cookie) => callPhp({ script: 'conversations.php', method: 'GET', query: q, cookie });

test('a logged-in user\'s conversation gets their user_id; a guest\'s gets NULL; title = first message', () => {
  const u = makeUser();
  const k1 = probeKey();
  say(k1, 1, '  Hello, how are you?  ', u.cookie);
  say(k1, 2, 'Fine thanks', u.cookie);
  assert.deepEqual(row(k1), { user_id: String(u.id), title: 'Hello, how are you?' });

  const k2 = probeKey();
  say(k2, 1, 'Guest here');
  assert.deepEqual(row(k2), { user_id: null, title: 'Guest here' });
});

test('title is cut to 120 characters (multi-byte text stays whole)', () => {
  const k = probeKey();
  const long = 'Magandang umaga ñ '.repeat(20);
  say(k, 1, long);
  const t = row(k).title;
  assert.equal([...t].length <= 120, true);
  assert.equal(long.trim().startsWith(t), true);
});

test('a user sees only their own conversations, and gets 404 for someone else\'s', () => {
  const a = makeUser();
  const b = makeUser();
  const ka = probeKey(); say(ka, 1, 'mine A', a.cookie);
  const kb = probeKey(); say(kb, 1, 'mine B', b.cookie);
  const kg = probeKey(); say(kg, 1, 'a guest');
  const ra = list('limit=100', a.cookie);
  assert.equal(ra.status, 200);
  assert.ok(ra.json.conversations.length >= 1);
  assert.ok(ra.json.conversations.every((c) => c.user_id === a.id), 'only own rows');
  assert.equal(ra.json.conversations[0].title, 'mine A');
  const idB = Number(query(`SELECT id FROM conversations WHERE client_key = '${kb}'`)[0].id);
  assert.equal(list(`id=${idB}`, a.cookie).status, 404);
  assert.equal(list(`id=${idB}`, b.cookie).status, 200);
  assert.equal(list('user=guest', a.cookie).json.conversations.every((c) => c.user_id === a.id), true, 'filter ignored for a user');
  assert.equal(callPhp({ script: 'conversations.php', method: 'POST', body: { action: 'delete', id: idB }, cookie: a.cookie }).status, 403);
});

test('admin: all conversations (guests included), user / guest / language filters, paging', () => {
  const u = makeUser();
  const ku = probeKey(); say(ku, 1, 'user ESL talk', u.cookie, 'ESL');
  const kg = probeKey(); say(kg, 1, 'guest FSL talk', '', 'FSL');
  const adm = adminCookie();

  const all = list('limit=100', adm).json.conversations;
  assert.ok(all.some((c) => c.user_id === u.id && c.username === u.username));
  assert.ok(all.some((c) => c.user_id === null && c.title === 'guest FSL talk'));

  const mine = list(`limit=100&user=${u.id}`, adm).json.conversations;
  assert.ok(mine.length >= 1 && mine.every((c) => c.user_id === u.id));
  const guests = list('limit=100&user=guest', adm).json.conversations;
  assert.ok(guests.length >= 1 && guests.every((c) => c.user_id === null));
  const esl = list('limit=100&lang=ESL', adm).json.conversations;
  assert.ok(esl.some((c) => c.title === 'user ESL talk') && !esl.some((c) => c.title === 'guest FSL talk'));
  assert.ok(esl.every((c) => c.languages.includes('ESL')));

  const p1 = list('limit=1&offset=0', adm).json;
  const p2 = list('limit=1&offset=1', adm).json;
  assert.equal(p1.conversations.length, 1);
  assert.equal(p1.has_more, true);
  assert.notEqual(p1.conversations[0].id, p2.conversations[0].id);
  assert.equal(list('limit=0', adm).status, 400);
  assert.equal(list('lang=XYZ', adm).status, 400);
});

test('20 per page: 21 conversations -> 20 + has_more, then 1', () => {
  const u = makeUser();
  for (let i = 0; i < 21; i++) say(probeKey(), 1, 'talk ' + i, u.cookie);
  const p1 = list('limit=20&offset=0', u.cookie).json;
  assert.equal(p1.conversations.length, 20);
  assert.equal(p1.has_more, true);
  const p2 = list('limit=20&offset=20', u.cookie).json;
  assert.equal(p2.conversations.length, 1);
  assert.equal(p2.has_more, false);
});
