Phase: Saved conversations (Let's Talk history, admin-only)
Date: 2026-09-25
Status: DONE
Decision needed from owner: none. One manual check is left for you: do one real signed turn in Let's Talk, then check it in Reports (DEBT 85).

# Final report

**What changed:**
- Every Let's Talk message is saved when it is confirmed into the thread.
- End, the idle return and a reload/close each record how the conversation ended.
- Reports has a Conversations tab (after the PIN) for reading, deleting and clearing conversations.
- `translations` was dropped (option A).

**Approval changes A, B and C** are all done:
- **A:** the DROP ships in the same commit as the Reports change.
- **B:** only the `DB_API` calls were removed.
- **C:** live bubbles say Typed, Spoken or Signed.

Nothing was pushed or merged.

## Commits (on `revision`, base `b079c38`)

| Commit | Task |
|---|---|
| `97753c9` | 1. Backup, then create `conversations`/`messages` |
| `8efc6c7` | 2. `php/api/save_conversation.php` (kiosk, write-only) + tests |
| `0b90bf8`, `b53708d` | 3. `php/api/conversations.php` (admin) + tests. Review fix: every mysqli failure now returns a JSON 500. |
| `d386aa6` | 4. talk.html save hooks (`js/talk-history.js`) |
| `0e25aff`, `cb29eb0`, `bdcde2d` | 5. Reports Conversations tab + `DROP TABLE translations`. Two review rounds removed cut-off text (ellipsis) from list cells; the Date/time column is 168 px, sized from a full sweep of worst-case dates. |
| `bcb1273` | 6. Removed the dead translations code (3 files deleted; only the `DB_API` calls removed from 2 JS files) |
| `0537012` | Fixes from the whole-phase review: speech/typed flag, opt-in for the Clear-all test, header comments |
| (docs commit) | 7. BACKEND, UI, DECISIONS, DEBT (78–85), INVENTORY, CLAUDE.md, and the two reports |

Review: each task had a fresh implementer and a task review.
- Task 3 needed 1 fix round and Task 5 needed 2; Task 5 was approved on its 3rd review. No task needed escalating.
- The whole-phase review (Opus) found 0 Critical and 1 Important issue, which is fixed in `0537012`. A retracted Vosk partial could leave the mic flag set on an empty field, so typed text would have been saved as speech.
- The remaining Minor findings are recorded as DEBT items 78–84.

## Backup and schema (measured)

- **Backup:** `E:\ACADSS\IOT\backups\sining_kamay_db_before-conversations.sql`, 9,804,299 bytes. Taken before any schema change; its last line is `-- Dump completed`.
- **Live `SHOW TABLES`:** `conversations, gesture_recordings, gestures, messages, users`.
  - `translations` still had 0 rows when checked again before the drop.
  - The DDL is exactly as approved: `client_key` UNIQUE, FK `ON DELETE CASCADE`, both CHECKs, and no `ON UPDATE` on any timestamp.
  - The CHECK is enforced: an insert of hearing+sign failed with error 4025.
- **Docs:** `database_setup.sql` and the ERD in `docs/system/BACKEND.md` are updated. BACKEND.md also has a post-migration step for the fresh-machine migration route.

## Verification (measured, 2026-09-25)

All checks ran in real Chrome (headless, over the DevTools protocol) at 1024×600, against the live DB.

| Check | Result |
|---|---|
| Real conversation: typed, then **spoken** (real Vosk recognising a speech WAV through Chrome's fake microphone), then typed, then End | Conversation 415 was saved in order: seq 1 `hearing/typed` "Good morning"; seq 2 `hearing/speech` "Hello how are you hello how are."; seq 3 `hearing/typed` "Thank you". `sign_language` was NULL, `end_reason` = `ended`, and the start/end times were 18:24:43 and 18:24:51. The live thread labels read "Typed · 6:24 PM", "Spoken · 6:24 PM", "Typed · 6:24 PM". All 4 save requests returned 200. |
| **Signed** message | **Not tested with a real sign.** Chrome's fake camera can't perform a trained sign. The signed path's stored fields (`signer/sign/ESL`) and the Reports label "Signed · … · ESL" were only checked by simulating the recognition result (Task 4 and the Task 5 probes). **You still need to do one signed turn** (DEBT 85). |
| Idle return | The "Still there?" card appeared 120 s after the last input, and the page went to `index.html` at 150 s. Conversation 419 was saved with `end_reason` = `idle`. |
| Open Let's Talk and leave with no message (Speak → Back → Back) | 0 requests to `save_conversation.php`; conversation rows stayed at 1. |
| One message, then reload | Conversation 418 was saved with `end_reason` = `left`. |
| Save failing, tested two ways: `fetch` rejects, and the server returns 500 | Both behaved the same: the bubble still appeared on the thread screen, no modal opened, and End still went to `index.html`. The only console output was 2 `console.warn` lines from `[talk-history]`, 0 JS errors, and 0 rows were written. In the 500 case Chrome also logs its own "Failed to load resource" line; that is a browser network entry, not page code. |
| Past conversations reachable from talk.html or the dashboard | No. talk.html, index.html and `js/*.js` have no reference to `conversations.php`; only `reports.html` calls it (`reports.html:714-715`). On Reports: 0 requests to `conversations.php` before the PIN, 1 after it. `save_conversation.php` only ever answers `{"success":true}`, and a test checks that. |
| Reports list | The list showed 3 conversations and the DB had 3, newest first. Example: "Sep 25, 2026, 6:24 PM \| 8 s \| 3 \| Good morning \| Ended". No cell's text was cut off, and page `scrollWidth` was 1024 on the list, the thread view and the confirm card. |
| Reports thread view | 3 bubbles in `seq` order, all on the hearing side, labelled Typed / Spoken / Typed with times. Header: "Sep 25, 2026, 6:24 PM · 8 s · 3 messages · Ended". |
| Delete one | Cancel left the row in place. Delete then removed conversation 415 **and its 3 messages** (conversations 1→0 and messages 3→0 for that id). The list and count updated to 2. |
| Clear all | The confirm card read "Delete all 2 conversations?". After confirming, the DB had 0 conversations and 0 messages, and the list showed "No conversations saved yet." with a count of 0. |
| ESL tab after all this | 120 rows |
| Console errors at 1024×600 | 0 JS errors on Reports and talk.html. talk.html logged only failed loads for the sign-preview clip lookup (`assets/signs/en/<word>.webm` 404, for example `thank_you.webm`). These already happened before this phase: the sign player tries a clip first and falls back to its map, as documented in `docs/system/UI.md` 3b. |
| Tests | Existing and new suites together: **79 tests, 78 pass, 1 skipped**. The skip is the Clear-all test, which now needs `SK_ALLOW_CLEAR_ALL=1`; with that set it passes too (45/45 conversation tests). `tests/normalization/migration.test.mjs`: 13/13. Before this phase: 34/34. |
| Test data cleanup | All verification rows were removed by the Delete and Clear-all checks, and the live DB has 0 conversations. No scratch databases were left behind. |

## `git diff --stat b079c38..HEAD` compared with the approved file list

It matches the approved list (f):
- 20 code and test files: 3 deletions (`save_translation.php`, `get_translations.php`, `js/db-api.js`) and 5 new files (`save_conversation.php`, `conversations.php`, `js/talk-history.js`, `tests/conversations/helper.mjs`, and the 2 test files). The rest are edits: `database_setup.sql`, `reports.php`, `reports.html`, `talk.html`, `talk-signing.js` (1 line), `talk-speaking.js` (2 lines), `gesture-training.html`, `diagnostic.html`, `gesture-training-ui.js`, `sign-to-text-ui.js` and `schema-guard.test.mjs`.
- Plus the docs commit: CLAUDE.md, BACKEND, UI, DECISIONS, DEBT, INVENTORY, and the two reports.
- Nothing outside the list. `docs/revision/MEMORY.md` and `docs/system/MANUAL-CHECKS.md` weren't touched or staged; both were last modified before this session (2026-09-22 and 2026-09-24).

## Deviations from the plan

- **Test probe prefix.** The plan's `zz` prefix can't pass the `client_key` rule (32 hex characters), so the tests use `deadbeef00000000`.
- **Clear-all test opt-in.** Its "only probe rows exist" check still leaves a moment in which a real conversation could be deleted, so the test also needs `SK_ALLOW_CLEAR_ALL=1`.
- **The mic flag** is set to whether the field is non-empty, rather than simply to true. This is the fix from the whole-phase review.

## Left open (DEBT, all Low)

- **78:** tapping End during the last message's save can leave `ended_at` NULL.
- **79:** no server-side auth on the two new endpoints (same issue as 72).
- **80:** a restore from the back/forward cache reuses the conversation's key after it has ended.
- **81:** `keepalive` requests are capped at 64 KiB, but the server accepts messages up to 65,535 bytes.
- **82:** `connect.php` never calls `mysqli_set_charset`. It works now because the server default is utf8mb4; check this on the Pi.
- **83:** the conversations list has no LIMIT or pagination.
- **84:** when the DB is down, `connect.php` answers HTTP 200 with a bare `{"error"}` (no `success` key), and `save_conversation.php` connects before it checks the request method.
- **85:** the signed turn hasn't been verified yet (your check).
