// Tests for php/api/save_conversation.php (kiosk-facing, write-only). Runs against the LIVE DB
// via php-cgi (tests/conversations/helper.mjs). Written before the endpoint exists (TDD RED),
// per conv-task-2-brief.md. Probe keys use the hex-valid "dead" prefix — see helper.mjs's header
// comment for why the global "zz" convention doesn't apply to this hex-only column.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { callPhp, probeKey, cleanupProbes } from './helper.mjs';
import { query } from '../categorization/db.mjs';

const SCRIPT = 'save_conversation.php';
const send = (body) => callPhp({ script: SCRIPT, body });

function validSignerMessage(key, overrides = {}) {
  return {
    action: 'message',
    client_key: key,
    seq: 1,
    speaker: 'signer',
    source: 'sign',
    sign_language: 'ESL',
    text: 'hello',
    ...overrides,
  };
}

function validHearingMessage(key, overrides = {}) {
  return {
    action: 'message',
    client_key: key,
    seq: 1,
    speaker: 'hearing',
    source: 'typed',
    sign_language: null,
    text: 'hi there',
    ...overrides,
  };
}

function conversationsFor(key) {
  return query(`SELECT * FROM conversations WHERE client_key = '${key}'`);
}
function messagesFor(key) {
  return query(
    `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.client_key = '${key}' ORDER BY m.seq`
  );
}

beforeEach(cleanupProbes);
after(cleanupProbes);

test('GET is rejected with 405', () => {
  const r = callPhp({ script: SCRIPT, method: 'GET' });
  assert.equal(r.status, 405);
  assert.equal(r.json.success, false);
});

test('invalid JSON body -> 400', () => {
  const r = callPhp({ script: SCRIPT, raw: '{not json' });
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('unknown action -> 400', () => {
  const key = probeKey();
  const r = send({ action: 'bogus', client_key: key });
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('missing action -> 400', () => {
  const key = probeKey();
  const r = send({ client_key: key });
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('first message creates exactly 1 conversation + 1 message with the exact stored fields', () => {
  const key = probeKey();
  const r = send(validSignerMessage(key));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true });

  const convs = conversationsFor(key);
  assert.equal(convs.length, 1);
  assert.equal(convs[0].client_key, key);
  assert.equal(convs[0].ended_at, null);
  assert.equal(convs[0].end_reason, null);

  const msgs = messagesFor(key);
  assert.equal(msgs.length, 1);
  assert.equal(Number(msgs[0].seq), 1);
  assert.equal(msgs[0].speaker, 'signer');
  assert.equal(msgs[0].source, 'sign');
  assert.equal(msgs[0].sign_language, 'ESL');
  assert.equal(msgs[0].text, 'hello');
});

test('a 2nd message with the same key reuses the same conversation and yields 2 messages', () => {
  const key = probeKey();
  send(validSignerMessage(key, { seq: 1 }));
  const before = conversationsFor(key);
  send(validHearingMessage(key, { seq: 2 }));
  const after_ = conversationsFor(key);

  assert.equal(before.length, 1);
  assert.equal(after_.length, 1);
  assert.equal(before[0].id, after_[0].id);

  const msgs = messagesFor(key);
  assert.equal(msgs.length, 2);
  assert.equal(Number(msgs[1].seq), 2);
  assert.equal(msgs[1].speaker, 'hearing');
  assert.equal(msgs[1].sign_language, null);
});

test('duplicate seq on the same conversation -> 409, still exactly 1 row for that seq', () => {
  const key = probeKey();
  send(validSignerMessage(key, { seq: 1, text: 'first' }));
  const r = send(validHearingMessage(key, { seq: 1, text: 'dup' }));
  assert.equal(r.status, 409);
  assert.equal(r.json.success, false);

  const msgs = messagesFor(key);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, 'first');
});

test('text is stored exactly as sent, not trimmed', () => {
  const key = probeKey();
  send(validHearingMessage(key, { text: '  padded text  ' }));
  const msgs = messagesFor(key);
  assert.equal(msgs[0].text, '  padded text  ');
});

// --- invalid message cases: each must 400 and write nothing ---

function assertRejectedNoWrite(name, body) {
  test(`invalid message: ${name} -> 400, no rows written`, () => {
    const key = body.client_key;
    const r = send(body);
    assert.equal(r.status, 400, `${name}: expected 400, got ${r.status} (${JSON.stringify(r.json)})`);
    assert.equal(r.json.success, false, name);
    if (/^[0-9a-f]{32}$/.test(key || '')) {
      assert.equal(conversationsFor(key).length, 0, `${name}: no conversation row expected`);
    }
  });
}

assertRejectedNoWrite('bad key format', validSignerMessage('not-a-valid-key'));
assertRejectedNoWrite('seq is 0', validSignerMessage(probeKey(), { seq: 0 }));
assertRejectedNoWrite('bad speaker', validSignerMessage(probeKey(), { speaker: 'robot' }));
assertRejectedNoWrite('bad source', validSignerMessage(probeKey(), { source: 'telepathy' }));
assertRejectedNoWrite('signer with source speech', validSignerMessage(probeKey(), { source: 'speech' }));
assertRejectedNoWrite('hearing with source sign', validHearingMessage(probeKey(), { source: 'sign' }));
assertRejectedNoWrite('signer with null sign_language', validSignerMessage(probeKey(), { sign_language: null }));
assertRejectedNoWrite('hearing with non-null sign_language', validHearingMessage(probeKey(), { sign_language: 'ESL' }));
assertRejectedNoWrite('empty text', validSignerMessage(probeKey(), { text: '' }));
assertRejectedNoWrite('whitespace-only text', validSignerMessage(probeKey(), { text: '   ' }));
assertRejectedNoWrite('text of 65536 bytes', validSignerMessage(probeKey(), { text: 'a'.repeat(65536) }));
assertRejectedNoWrite('seq as a string', validSignerMessage(probeKey(), { seq: '1' }));
assertRejectedNoWrite('seq as a float', validSignerMessage(probeKey(), { seq: 1.5 }));

test('text of exactly 65535 bytes is accepted', () => {
  const key = probeKey();
  const r = send(validSignerMessage(key, { text: 'a'.repeat(65535) }));
  assert.equal(r.status, 200);
  assert.equal(messagesFor(key)[0].text.length, 65535);
});

// --- end action ---

test('end sets ended_at and end_reason on an existing conversation', () => {
  const key = probeKey();
  send(validSignerMessage(key));
  const r = send({ action: 'end', client_key: key, reason: 'ended' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true });

  const conv = conversationsFor(key)[0];
  assert.notEqual(conv.ended_at, null);
  assert.equal(conv.end_reason, 'ended');
});

test('a 2nd end with a different reason does not overwrite the first', () => {
  const key = probeKey();
  send(validSignerMessage(key));
  send({ action: 'end', client_key: key, reason: 'idle' });
  const firstEndedAt = conversationsFor(key)[0].ended_at;

  const r = send({ action: 'end', client_key: key, reason: 'left' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true });

  const conv = conversationsFor(key)[0];
  assert.equal(conv.end_reason, 'idle');
  assert.equal(conv.ended_at, firstEndedAt);
});

test('end for an unknown client_key creates no row and still reports success', () => {
  const key = probeKey();
  const r = send({ action: 'end', client_key: key, reason: 'left' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true });
  assert.equal(conversationsFor(key).length, 0);
});

test('end with a bad key format -> 400', () => {
  const r = send({ action: 'end', client_key: 'nope', reason: 'left' });
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('end with a bad reason -> 400', () => {
  const key = probeKey();
  const r = send({ action: 'end', client_key: key, reason: 'bogus' });
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

// --- response shape ---

test('no success response body contains anything but "success"', () => {
  const key = probeKey();
  let r = send(validSignerMessage(key));
  assert.deepEqual(Object.keys(r.json), ['success']);

  r = send({ action: 'end', client_key: key, reason: 'ended' });
  assert.deepEqual(Object.keys(r.json), ['success']);
});
