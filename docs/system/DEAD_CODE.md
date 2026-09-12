# Dead Code — Deletion Manifest

This is not documentation. It is a list of what to delete before the revision
starts, with the evidence that nothing loads it. Once deleted, this file stops
being accurate and should be deleted too — it is not part of the permanent
docs/system/ set.

Scope note: this manifest only lists files with **zero live wiring and no
ambiguity** about deleting them outright. Files that are unreachable from
navigation but still functionally wired to live code (`camera-translator.html`,
`bulk-importer.html`), and backend endpoints with no frontend caller
(`php/auth.php`, `php/admin_api.php`, `php/api/save_history.php`,
`php/api/get_history.php`), are judgment calls for the project owner, not
mechanical deletions — they are tracked in `docs/system/DEBT.md` instead.

## Delete: the abandoned earlier-revision build

- `js/main.js` — uses `import`/`export` (ES module syntax) and `deeplearn`-era
  APIs. Not loaded by any `<script>` tag anywhere in the repo (verified: `grep -rn
  "main.js" --include=*.html .` finds no `<script src>` reference).
- `js/dist/build.js` — 21,943-line browserify bundle of `js/main.js` plus old
  `deeplearn`/`utf8`-polyfill dependencies. Not referenced by any HTML file
  (verified: no `<script src="js/dist/build.js">` anywhere).
- `package.json` — browserify/babel/`deeplearn` build toolchain (`"build":
  "browserify js/main.js -o js/dist/build.js"`) that produces the two files
  above. The live app has no build step (loads files as-is via `<script src>`),
  so this toolchain has no consumer.

## Delete: the abandoned earlier revision's documentation

- `docs/rev/`, `docs/revisions/`, `docs/REVS/`, `docs/superpowers/`,
  `docs/PHASE_2_UI_REVIEW.md`, `docs/PROJECT_MASTER_PLAN.md`,
  `docs/REVISION_PROCESS.md`, `docs/SININGKAMAY_UI_FIRST_ANALYSIS.md`,
  `docs/UI_DESIGN_RULES.md`, `docs/UI_PROGRESS_REPORT.md`,
  `docs/UI_REVISION_FLOW_AND_PHASE_PLAN.md`, `docs/execution/Execution-plan.md`
  (37 files total under `docs/`, all pre-existing before this audit). File names
  and dates (2026-06-09, 2026-07-09/10/11) indicate this documents the abandoned
  prior revision's UI/process, not the current code. Not read for content this
  audit — flagged by the project owner as out of scope and safe to skip reading
  because it is slated for deletion. Note: `docs/system/` (this audit's own
  output) is a different, new directory and is not part of this deletion.

## Delete: standalone dev/test pages with zero callers

Confirmed independently in Pass 1 (grep for inbound/outbound HTML links) and
Pass 2 (UI-B subagent, which also grepped for `fetch`/`.php` calls):

- `camera_test.html` — no inbound or outbound links, no `fetch`/`.php` calls.
- `gesture_test.html` — no inbound or outbound links, no `fetch`/`.php` calls.
- `speech_test.html` — no inbound or outbound links, no `fetch`/`.php` calls.

Note: `diagnostic.html` looked similar in Pass 1 but Pass 2 found it still calls
`php/api/save_gesture.php` live (`diagnostic.html:112-113,121`) — it is **not**
included here; see `docs/system/DEBT.md` for its unreachability-from-nav issue.

## Delete: orphaned integration point

- `preload.html` — its only reference anywhere in the repo is a commented-out
  `<iframe src="preload.html">` in `index.html:820`. Currently inert.

## Delete: unreferenced CSS

- `css/animate.css` (3,199 lines) — grep across every tracked HTML file found
  zero `<link>` or `@import` references to it (confirmed independently by both
  Pass 1 and the Pass 2 UI-B subagent).

## Delete: empty/junk files

- `scratch/unpkg_dist.html` — 0 bytes.
- `README (1).md` — duplicate of `README.md` (Windows "keep both" artifact).
- `(1).gitignore.txt` — stray duplicate of `.gitignore`.

## Not included here (see DEBT.md instead)

- `camera-translator.html`, `bulk-importer.html` — unreachable from in-app
  navigation, but both are fully wired to live shared JS/PHP. This is planned
  dual-screen work per the project owner, not dead code.
- `php/auth.php`, `php/admin_api.php`, `php/api/save_history.php`,
  `php/api/get_history.php` — no frontend caller found, but deleting a backend
  endpoint is a bigger decision than deleting a vendored binary; also
  `auth.php` carries a known default admin credential worth the project owner's
  attention regardless of the deletion decision.
- `js/db-local.js` — loaded on every camera/sign-to-text/training screen but none
  of its exported functions are actually called anywhere (see
  `docs/system/UI.md` Part 1, §4). Loaded-but-unused is a different risk profile
  than unloaded — flagged as debt, not listed for blind deletion here.
- `scratch/trigger_sync.php` — a manual one-off DB migration script, not wired to
  the app, but potentially still useful as an ops tool. A judgment call, not a
  mechanical deletion.
- `.superpowers/` (4 files) — prior agent-session artifacts, not application code.
