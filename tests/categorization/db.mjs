// Small shared helper for querying the live sining_kamay_db from Node tests via PHP CLI.
// Mirrors the harness's use of php/connect.php but returns JSON rows instead of an HTTP response.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const PHP = process.env.SK_PHP_CLI || 'C:\\xampp\\php\\php.exe';

// Runs arbitrary PHP with $conn (from php/connect.php) in scope, cwd = repo root so relative
// requires inside connect.php resolve the same way they do under Apache.
function runPhp(code) {
  const script = `require ${JSON.stringify(path.join(repo, 'php', 'connect.php'))}; ${code}`;
  const r = spawnSync(PHP, ['-r', script], { encoding: 'utf8', cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error('PHP failed: ' + r.stderr + r.stdout);
  }
  return r.stdout;
}

export function query(sql) {
  const php = `
    $res = mysqli_query($conn, ${JSON.stringify(sql)});
    if ($res === false) { fwrite(STDERR, mysqli_error($conn)); exit(1); }
    $rows = [];
    if ($res instanceof mysqli_result) { while ($row = mysqli_fetch_assoc($res)) { $rows[] = $row; } }
    echo json_encode($rows);
  `;
  return JSON.parse(runPhp(php));
}

export function exec(sql) {
  const php = `
    $res = mysqli_query($conn, ${JSON.stringify(sql)});
    if ($res === false) { fwrite(STDERR, mysqli_error($conn)); exit(1); }
    echo json_encode(['affected' => mysqli_affected_rows($conn)]);
  `;
  return JSON.parse(runPhp(php));
}

export function callPhp(requireFile, code) {
  const php = `require ${JSON.stringify(requireFile)}; ${code}`;
  const r = spawnSync(PHP, ['-r', php], { encoding: 'utf8', cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error('PHP failed: ' + r.stderr + r.stdout);
  }
  return r.stdout;
}
