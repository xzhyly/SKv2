// Tests for php/api/conversations.php (admin-facing, read + delete, used by reports.html).
// Runs against the LIVE DB via php-cgi (tests/conversations/helper.mjs). Written before the
// endpoint exists (TDD RED), per conv-task-3-brief.md. Probe conversations are created through
// save_conversation.php (Task 2), not by direct SQL inserts, except where a specific
// created_at/seq ordering must be controlled — each such case says so inline.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { callPhp, probeKey, cleanupProbes, PROBE_PREFIX } from './helper.mjs';
import { query, exec } from '../categorization/db.mjs';

const SAVE_SCRIPT = 'save_conversation.php';
const SCRIPT = 'conversations.php';

const save = (body) => callPhp({ script: SAVE_SCRIPT, body });
const get = (query_ = '') => callPhp({ script: SCRIPT, method: 'GET', query: query_ });
const post = (body) => callPhp({ script: SCRIPT, method: 'POST', body });

function signerMessage(key, overrides = {}) {
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

function hearingMessage(key, overrides = {}) {
  return {
    action: 'message',
    client_key: key,
    seq: 2,
    speaker: 'hearing',
    source: 'typed',
    sign_language: null,
    text: 'hi there',
    ...overrides,
  };
}

// db.mjs's query() runs through mysqli's text protocol (php -r + mysqli_query), which returns
// every column as a string regardless of its SQL type — unlike the endpoint's prepared
// statements, which the PHP driver type-juggles back to int. conversationRowFor()/messageCountFor()
// coerce `id`/count columns to Number so they compare cleanly against the endpoint's JSON numbers.
function conversationRowFor(key) {
  const row = query(`SELECT * FROM conversations WHERE client_key = '${key}'`)[0];
  return row ? { ...row, id: Number(row.id) } : undefined;
}

function messageCountFor(conversationId) {
  return Number(query(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ${conversationId}`)[0].n);
}

function countOf(sql) {
  return Number(query(sql)[0].n);
}

beforeEach(cleanupProbes);
after(cleanupProbes);

// --- GET list ---

test('GET list contains a probe conversation with correct message_count/first_message/duration_seconds', () => {
  const key = probeKey();
  save(signerMessage(key, { text: 'first one' }));
  save(hearingMessage(key, { text: 'second one' }));
  const endResp = save({ action: 'end', client_key: key, reason: 'ended' });
  assert.equal(endResp.status, 200);

  const row = conversationRowFor(key);
  const r = get();
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(Array.isArray(r.json.conversations));

  const entry = r.json.conversations.find((c) => c.id === row.id);
  assert.ok(entry, 'probe conversation must appear in the list');
  assert.equal(entry.message_count, 2);
  assert.equal(typeof entry.message_count, 'number');
  assert.equal(entry.first_message, 'first one');
  assert.ok(Number.isInteger(entry.duration_seconds));
  assert.ok(entry.duration_seconds >= 0);
  assert.equal(entry.end_reason, 'ended');
  assert.notEqual(entry.ended_at, null);
});

test('GET list orders by started_at DESC, id DESC', () => {
  const key1 = probeKey();
  const key2 = probeKey();
  save(signerMessage(key1));
  // Force key2's conversation to have an earlier started_at than key1's, so id DESC / insertion
  // order alone would get the ordering wrong if the endpoint didn't sort by started_at.
  save(signerMessage(key2));
  const id1 = conversationRowFor(key1).id;
  const id2 = conversationRowFor(key2).id;
  exec(`UPDATE conversations SET started_at = '2020-01-01 00:00:00' WHERE id = ${id2}`);

  const r = get();
  const ids = r.json.conversations.map((c) => c.id);
  const pos1 = ids.indexOf(id1);
  const pos2 = ids.indexOf(id2);
  assert.ok(pos1 !== -1 && pos2 !== -1);
  assert.ok(pos1 < pos2, 'the more recently started conversation must come first');
});

test('GET list: duration_seconds and message_count are JSON numbers, not strings', () => {
  const key = probeKey();
  save(signerMessage(key));
  const row = conversationRowFor(key);
  const r = get();
  const entry = r.json.conversations.find((c) => c.id === row.id);
  assert.equal(typeof entry.duration_seconds, 'number');
  assert.equal(typeof entry.message_count, 'number');
  assert.equal(typeof entry.id, 'number');
});

// --- GET detail ---

test('GET ?id=N returns the conversation and its messages ordered by seq', () => {
  const key = probeKey();
  save(signerMessage(key, { seq: 1, text: 'a' }));
  save(hearingMessage(key, { seq: 2, text: 'b' }));
  save(signerMessage(key, { seq: 3, text: 'c' }));
  const row = conversationRowFor(key);

  const r = get(`id=${row.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.conversation.id, row.id);
  assert.equal(r.json.conversation.message_count, 3);
  assert.equal(r.json.conversation.first_message, 'a');

  assert.equal(r.json.messages.length, 3);
  assert.deepEqual(r.json.messages.map((m) => m.seq), [1, 2, 3]);
  assert.deepEqual(r.json.messages.map((m) => m.text), ['a', 'b', 'c']);
  const first = r.json.messages[0];
  assert.equal(first.speaker, 'signer');
  assert.equal(first.source, 'sign');
  assert.equal(first.sign_language, 'ESL');
  assert.ok('created_at' in first);
  const second = r.json.messages[1];
  assert.equal(second.speaker, 'hearing');
  assert.equal(second.source, 'typed');
  assert.equal(second.sign_language, null);
});

test('GET ?id=N for a nonexistent id -> 404', () => {
  const r = query('SELECT COALESCE(MAX(id), 0) + 1000000 AS next_id FROM conversations');
  const missingId = r[0].next_id;
  const resp = get(`id=${missingId}`);
  assert.equal(resp.status, 404);
  assert.equal(resp.json.success, false);
});

test('GET ?id=0 -> 400', () => {
  const r = get('id=0');
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('GET ?id=-1 -> 400', () => {
  const r = get('id=-1');
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('GET ?id=1.5 -> 400', () => {
  const r = get('id=1.5');
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('GET ?id=abc -> 400', () => {
  const r = get('id=abc');
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

// --- POST delete ---

test('delete removes the conversation and its messages', () => {
  const key = probeKey();
  save(signerMessage(key));
  save(hearingMessage(key));
  const row = conversationRowFor(key);
  assert.equal(messageCountFor(row.id), 2);

  const r = post({ action: 'delete', id: row.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true, deleted: 1 });

  assert.equal(conversationRowFor(key), undefined);
  assert.equal(messageCountFor(row.id), 0);
});

test('a 2nd delete of the same id -> 404', () => {
  const key = probeKey();
  save(signerMessage(key));
  const row = conversationRowFor(key);

  const r1 = post({ action: 'delete', id: row.id });
  assert.equal(r1.status, 200);

  const r2 = post({ action: 'delete', id: row.id });
  assert.equal(r2.status, 404);
  assert.equal(r2.json.success, false);
});

test('delete with a bad id -> 400', () => {
  for (const badId of [0, -1, 1.5, 'nope', null]) {
    const r = post({ action: 'delete', id: badId });
    assert.equal(r.status, 400, `id=${JSON.stringify(badId)} should 400`);
    assert.equal(r.json.success, false);
  }
});

// --- POST clear_all ---

test('clear_all removes every conversation and message (only when all rows are probes)', (t) => {
  if (process.env.SK_ALLOW_CLEAR_ALL !== '1') {
    t.skip('set SK_ALLOW_CLEAR_ALL=1 to run; it deletes every conversation');
    return;
  }

  const rows = query('SELECT client_key FROM conversations');
  const allProbes = rows.every((r) => r.client_key.startsWith(PROBE_PREFIX));
  if (!allProbes) {
    t.skip('real (non-probe) conversations exist in the DB; refusing to run clear_all against them');
    return;
  }

  const key = probeKey();
  save(signerMessage(key));
  save(hearingMessage(key));

  const rowsBefore = query('SELECT client_key FROM conversations');
  assert.ok(rowsBefore.every((r) => r.client_key.startsWith(PROBE_PREFIX)), 'guard: every row must be a probe');

  const r = post({ action: 'clear_all' });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(typeof r.json.deleted, 'number');
  assert.ok(r.json.deleted >= 1);

  assert.equal(countOf('SELECT COUNT(*) AS n FROM conversations'), 0);
  assert.equal(countOf('SELECT COUNT(*) AS n FROM messages'), 0);
});

// --- method / action validation ---

test('POST with unknown action -> 400', () => {
  const r = post({ action: 'bogus' });
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('POST with missing action -> 400', () => {
  const r = post({});
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('DELETE method -> 405', () => {
  const r = callPhp({ script: SCRIPT, method: 'DELETE' });
  assert.equal(r.status, 405);
  assert.equal(r.json.success, false);
});

test('PUT method -> 405', () => {
  const r = callPhp({ script: SCRIPT, method: 'PUT' });
  assert.equal(r.status, 405);
  assert.equal(r.json.success, false);
});
