// db-schema/2026-10-accounts-quiz.sql (accounts-quiz phase) on throw-away databases: it must give
// exactly the schema of db-schema/database_setup.sql (= the owner's laptop SHOW CREATE TABLE) from
// an older database, from a fresh one and from an empty one, change nothing on a second run or on a
// database that already has it, keep users rows, and replace only the old broken admin hash.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { callPhp as runWith } from '../categorization/db.mjs';
import { repo } from '../conversations/helper.mjs';

const CONNECT = path.join(repo, 'php', 'connect.php');
const MIGRATION = fs.readFileSync(path.join(repo, 'db-schema', '2026-10-accounts-quiz.sql'), 'utf8');
const SETUP = fs.readFileSync(path.join(repo, 'db-schema', 'database_setup.sql'), 'utf8');
const OLD_HASH = '$2y$10$WFl4wMfeT4363nF7G5V2vujb8813K0k0fG9R21d5a71h086.V2v/u';
const TABLES = ['users', 'conversations', 'quiz_attempts', 'quiz_answers'];
const made = [];

// The users / conversations tables as database_setup.sql created them before 2026-10-18.
const OLD_SCHEMA = `
CREATE DATABASE IF NOT EXISTS sining_kamay_db; USE sining_kamay_db;
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
INSERT INTO users (username, email, password_hash, role) VALUES ('admin', 'admin@siningkamay.com', '${OLD_HASH}', 'admin');
INSERT INTO users (username, email, password_hash, role) VALUES ('olduser', 'old@x.y', 'keep-this-hash', 'user');
CREATE TABLE IF NOT EXISTS conversations (
  id int(11) NOT NULL AUTO_INCREMENT,
  client_key char(32) NOT NULL,
  started_at timestamp NOT NULL DEFAULT current_timestamp(),
  ended_at timestamp NULL DEFAULT NULL,
  end_reason enum('ended','idle','left') DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_client_key (client_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
INSERT INTO conversations (client_key) VALUES ('0123456789abcdef0123456789abcdef');
`;

function sqlIn(db, sql) {
  return sql.replace(/\bsining_kamay_db\b/g, db);
}

// Runs a multi-statement script; throws with the MySQL error on the first failing statement.
function run(db, sql) {
  const code = `
    $sql = base64_decode(${JSON.stringify(Buffer.from(sqlIn(db, sql)).toString('base64'))});
    if (!mysqli_multi_query($conn, $sql)) { fwrite(STDERR, mysqli_error($conn)); exit(1); }
    do { if ($r = mysqli_store_result($conn)) mysqli_free_result($r); } while (mysqli_more_results($conn) && mysqli_next_result($conn));
    if (mysqli_errno($conn)) { fwrite(STDERR, mysqli_error($conn)); exit(1); }
    echo 'ok';`;
  return runWith(CONNECT, code);
}

function q(db, sql) {
  const code = `
    mysqli_select_db($conn, ${JSON.stringify(db)});
    $res = mysqli_query($conn, ${JSON.stringify(sql)});
    $rows = [];
    while ($row = mysqli_fetch_assoc($res)) { $rows[] = $row; }
    echo json_encode($rows);`;
  return JSON.parse(runWith(CONNECT, code));
}

function schema(db) {
  return TABLES.map((t) => q(db, `SHOW CREATE TABLE \`${t}\``)[0]['Create Table'].replace(/ AUTO_INCREMENT=\d+/, ''));
}

function newDb() {
  const name = 'zz_mig_' + crypto.randomBytes(4).toString('hex');
  made.push(name);
  return name;
}

after(() => {
  for (const db of made) run(db, `DROP DATABASE IF EXISTS \`${db}\``);
});

let expected;
test('database_setup.sql gives the target schema; the migration changes nothing on it (twice)', () => {
  const db = newDb();
  run(db, SETUP);
  expected = schema(db);
  assert.match(expected[0], /`display_name` varchar\(80\) DEFAULT NULL/);
  assert.match(expected[1], /CONSTRAINT `fk_conversations_user` FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\) ON DELETE SET NULL/);
  run(db, MIGRATION);
  run(db, MIGRATION);
  assert.deepEqual(schema(db), expected);
  assert.equal(q(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")[0].n, '1');
});

test('an older database: same schema after the migration, rows kept, only the old admin hash replaced', () => {
  const db = newDb();
  run(db, OLD_SCHEMA);
  run(db, MIGRATION);
  assert.deepEqual(schema(db), expected);
  run(db, MIGRATION);
  assert.deepEqual(schema(db), expected, 'second run: no change');
  const users = q(db, 'SELECT username, email, password_hash, role, is_active FROM users ORDER BY id');
  assert.equal(users.length, 2);
  assert.notEqual(users[0].password_hash, OLD_HASH);
  assert.ok(users[0].password_hash.startsWith('$2y$'));
  assert.deepEqual(users[1], { username: 'olduser', email: 'old@x.y', password_hash: 'keep-this-hash', role: 'user', is_active: '1' });
  assert.deepEqual(q(db, 'SELECT user_id, title FROM conversations'), [{ user_id: null, title: null }]);
});

test('the replaced admin hash is a real hash of admin123 (PHP password_verify)', () => {
  const db = newDb();
  run(db, OLD_SCHEMA);
  run(db, MIGRATION);
  const hash = q(db, "SELECT password_hash FROM users WHERE username = 'admin'")[0].password_hash;
  // base64: a "$..." inside a double-quoted PHP string would be read as a variable.
  const ok = runWith(CONNECT, `echo password_verify('admin123', base64_decode('${Buffer.from(hash).toString('base64')}')) ? 'yes' : 'no';`);
  assert.equal(ok, 'yes');
});

test('a changed admin password is never touched', () => {
  const db = newDb();
  run(db, OLD_SCHEMA.replace(OLD_HASH, 'owner-changed-hash'));
  run(db, MIGRATION);
  assert.equal(q(db, "SELECT password_hash FROM users WHERE username = 'admin'")[0].password_hash, 'owner-changed-hash');
});

test('an empty database: the migration alone creates the four tables and seeds one admin', () => {
  const db = newDb();
  run(db, MIGRATION);
  assert.deepEqual(schema(db), expected);
  assert.deepEqual(q(db, 'SELECT username, role FROM users'), [{ username: 'admin', role: 'admin' }]);
});
