// Owner decision 2026-10-18 (accounts-quiz phase): the admin PIN is removed completely. The admin
// pages and admin APIs are protected only by the logged-in admin role (js/sk-account.js adminPage(),
// php/session.php sk_require_admin()). This scans every served file (root pages, js/, css/, php/;
// vendored js/lib/ and archive/ excepted) for anything left of the PIN pad or its setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repo } from '../conversations/helper.mjs';

const PIN_RE = /CORRECT_PIN|pinInput|trPressPin|trVerifyPin|trClearPin|trDeletePin|updatePinDots|onPinKey|pin-screen|pin-card|pin-pad|pin-key|pin-dot|pin-badge|pin-back-btn|data-pin|sk_train_unlocked|UNLOCK_KEY|enter the PIN|var PIN\b|'2026'/;

function served() {
  const files = fs.readdirSync(repo).filter((f) => /\.(html|php)$/.test(f)).map((f) => path.join(repo, f));
  for (const dir of ['js', 'css', 'php', path.join('php', 'api')]) {
    for (const f of fs.readdirSync(path.join(repo, dir))) {
      if (/\.(js|css|php|html)$/.test(f)) files.push(path.join(repo, dir, f));
    }
  }
  return files;
}

test('no PIN pad, PIN check or PIN setting is left in any served file', () => {
  const hits = [];
  for (const f of served()) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (PIN_RE.test(line)) hits.push(`${path.relative(repo, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('every admin page is guarded by the admin role in its <head>', () => {
  for (const page of ['gesture-training.html', 'reports.html', 'bulk-import.html', 'avatar-clips.html', 'diagnostic.html', 'users.html']) {
    const head = fs.readFileSync(path.join(repo, page), 'utf8').split('</head>')[0];
    assert.match(head, /<script src="php\/api\/me\.php"><\/script>\s*\n\s*<script src="js\/sk-account\.js"><\/script>\s*\n\s*<script>SKAccount\.adminPage\(\);<\/script>/, page);
  }
});
