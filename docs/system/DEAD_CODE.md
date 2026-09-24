# Dead Code — Phase 1 Record

This file was a deletion manifest. Phase 1 (dead-code deletion) executed it,
after independently re-verifying every entry (see the `revision` branch
history for the verification pass). It is no longer a plan — it is now a
short record of what happened, kept for provenance rather than as a live
list of files (which no longer exist).

## What was deleted

- **Abandoned build pipeline** — `js/main.js`, `js/dist/build.js`,
  `package.json` — commit `bb7468f`. This pipeline was traced to a separate
  open-source project ("Sign-Language-Translator") this codebase was
  originally started from, not an earlier revision of it — see
  `archive/old-revision-docs/ORIGIN.md` and `docs/system/DEBT.md` item 24.
- **Standalone dev/test pages** — `camera_test.html`, `gesture_test.html`,
  `speech_test.html` — commit `ddc741c`.
- **Unreferenced CSS** — `css/animate.css` — commit `3c3147a`.
- **Orphaned integration point** — `preload.html` (only reference was a
  commented-out `<iframe>` in `index.html:820`, which remains) — commit
  `cc1ff23`.
- **Junk files** — `scratch/unpkg_dist.html` (0 bytes), `README (1).md` and
  `(1).gitignore.txt` (re-verified by content diff to not be duplicates as
  originally assumed, but files belonging to the separate project above), and
  a stray untracked shell-redirect artifact — commit `bdf7d51`.

## What was archived, not deleted

All 37 pre-existing files/folders under `docs/` (excluding `docs/system/`)
were moved to `archive/old-revision-docs/` via `git mv`, preserving history —
commit `a86823a`. See `archive/old-revision-docs/ORIGIN.md`.

## What was flagged instead of touched

`php/auth.php`, `php/admin_api.php`, `php/api/save_history.php`,
`php/api/get_history.php`, `js/db-local.js`, and `scratch/trigger_sync.php`
were left alone — judgment calls, not mechanical deletions. Tracked in
`docs/system/DEBT.md` items 6 and 8.

**2026-09-24 (DB cleanup, owner-approved):** `php/api/save_history.php` and
`php/api/get_history.php` were deleted, along with the `translation_history`
and `gesture_words` tables and the `admin_api.php`/`core_api.php` branches that
only served them. See `docs/system/BACKEND.md`, "DB cleanup (2026-09-24)".

## Line-count result

Tracked-file line count (`git ls-files` content, summed): 1,103,503 before
Phase 1 (tag `baseline`) → 1,075,876 after all Phase 1 commits, including the
docs archive move (which relocates lines rather than removing them) and the
42-line `ORIGIN.md` it added — a net reduction of 27,627 lines.

## Recovery

Everything deleted in Phase 1 is recoverable at the `baseline` git tag.
