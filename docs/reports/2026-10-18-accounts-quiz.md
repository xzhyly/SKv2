Phase: Accounts, conversation history, quiz, dashboard revision (accounts-quiz)
Date: 2026-10-18
Status: DONE
Decision needed from owner: two small yes/no choices, nothing blocks testing. (a) Should a logged-in admin still type the PIN on Train Gestures / Reports / Bulk import (kept, per "keep how admin login works today")? (b) Should the training/import write APIs also answer 403 to non-admins (left open, DEBT 157)?

# Accounts, conversation history, quiz, dashboard revision — report

Branch `accounts-quiz`, made from `py-avatar` (`9672310`). Two commits: code, then docs (this report, the
screenshots and `docs/system/`). Nothing merged; nothing pushed to `revision` or `main`. No video touched, no
`saved_gestures` data changed, nothing under `archive/`, `docs/revision/MEMORY.md` and
`docs/system/MANUAL-CHECKS.md` untouched. Recognition (knnPredict, compile, models), live capture, the avatar
renderer, the bulk import logic and the py tools are unchanged.

**What was run here** (a cloud container, no laptop, no XAMPP): Ubuntu 24.04, PHP 8.3.6 (CLI, `php-cgi`, the
built-in server `php -S` on port 80 serving the repo at `/SKR/`), MariaDB 10.11.14 (the laptop has 10.4), node 22,
Playwright 1.56 + its Chromium at 1024x600. Database: `db-schema/database_setup.sql` + the new migration; the
`gestures` table filled from the repo's own `saved_gestures/*/sign.json` (122 signs) by one `save_gesture.php` GET;
synthetic users, conversations and quiz attempts were made by the tests (all `zzqa...` / `[e2e]`, removed after).
Avatar clips for the avatar quiz test were built from the committed Holistic fixture and served by request
interception — nothing was written into `saved_gestures/`.

## 1. What changed, by owner decision

| # | Owner decision | Done |
|---|---|---|
| 1 | Dashboard: 3 cards for everyone; "Log in" or a name chip with a menu top-right | `index.html`: Learn Signs, Let's Talk, Quiz (same 200x270 cards, `css/style.css` grid `repeat(3, 200px)`). Guest: "Log in". Logged in: chip (initial, name, ADMIN tag, caret) -> menu. User: My conversations, My quiz scores, Log out. Admin: Train Gestures, View Reports, Bulk import, Manage users, All conversations, Quiz results, Log out. Items 48 px. |
| 2 | Login: own full-screen page, two tabs, fields on top, 52 px inputs, >= 44 px buttons; Create account = display name, username, password (min 4), role always user, logged in at once; deactivated users cannot log in; `last_login_at` | `login.html` + `php/auth.php`. Every field and button ends at y <= 320 (the on-screen keyboard is 280 px tall and starts at y = 320 — measured); inputs 52 px, buttons 52 px. Username: 2-30 letters and numbers. A login sets `last_login_at`; a deactivated account gets "This account is turned off. Ask an admin to turn it back on." and its open session stops working. The on-screen keyboard now also opens for password fields (`js/virtual-keyboard.js`, one condition). |
| 3 | Admin-only pages redirect a non-admin to the dashboard; admin APIs 403; keep how admin login works; same login | `gesture-training`, `reports`, `bulk-import`, `avatar-clips`, `diagnostic`, `users`: a guest or user lands on `index.html` before the page shows. `php/admin_api.php` (now on the PHP session, no more trusted `requester_id`), `conversations.php` list-all/delete/clear_all and quiz results for all users answer 403. Admin = a `users` row with role admin, seeded admin / admin123, logging in on the same `login.html`; the admin pages' PIN pad is kept (see section 2). |
| 4 | Let's Talk: name chip and "+ New conversation" in the top bar; `user_id`, `title` = first message | `talk.html` header right side; guest sees a "Guest" chip. Saved with the session's user id (NULL for a guest) and the first message (trimmed, 120 characters) as title (`php/api/save_conversation.php`). "+ New conversation" ends the conversation like End Conversation and starts a new one. Nothing else in Let's Talk changed. |
| 5 | Conversations page: user own, admin all + User and Language filters, 20 per load + Load more, read-only thread | `conversations.html` + `php/api/conversations.php` (the server applies the same rule). |
| 6 | Quiz: setup, 10 questions, clips, one-tap answers, result, save only when logged in, scores page | `quiz.html`, `js/quiz-core.js`, `js/quiz-ui.js`, `php/api/quiz.php`, `quiz-scores.html`. |
| 7 | Manage users: list, Add user, Reset password (full-screen form), Activate/Deactivate, no delete, no self-deactivation | `users.html` + `php/admin_api.php`. |
| 8 | Same look; plain HTML/CSS/JS, inline SVG, no libraries, no blur/shadows/animations/images; reuse CSS | `css/sk-pages.css` uses `css/tokens.css` colours and the Inter font; no shadow, blur, gradient, transition or animation in the new CSS; icons are inline SVG. |
| 9 | Schema exactly as on the laptop; update `database_setup.sql`; idempotent `db-schema/2026-10-accounts-quiz.sql`; no drops; keep users rows | Done; `SHOW CREATE TABLE` of all four tables is byte-identical to the brief's on every path tested (section 4). |

## 2. Choices I made (please confirm or overrule)

1. **Admin PIN kept.** "Keep how admin login works today; make it the same login" was read as: same `users`
   table and seeded admin, same `login.html` for everyone, and the admin pages behave exactly as before for an
   admin — PIN pad included. A non-admin never reaches the PIN (sent to the dashboard first). Dropping the PIN for a
   logged-in admin is a small change (DEBT 158). **Decision (a).**
2. **Training/import write APIs left open.** `save_gesture.php`, `signs.php` POST, `gesture_category.php`,
   `compile_model.php`, `bulk_import.php`, `avatar_clip.php` still answer anyone, as before: the bulk import logic
   and the py tools (both "must not change") and ~20 existing php-cgi tests call them without a session. The admin
   APIs of this phase (users, all conversations, quiz results) do answer 403. **Decision (b)**, DEBT 157.
3. **Seeded admin password.** The admin hash in the old `database_setup.sql` (the same one as in the laptop's dumps,
   `users.id = 1`) does **not** match `admin123` — checked with `password_verify()`. So on the laptop the admin could
   not log in with admin123. The migration replaces that exact hash (and only that hash) with a real hash of
   admin123; a password you changed since is left alone. Change it after the first login (Manage users -> Reset
   password). DEBT 165.
4. **Quiz clip source = Let's Talk's.** `learn-signs.html` is an external website in an iframe (DEBT 29), so there is
   no local "Learn Signs source". The quiz uses what Let's Talk plays: the sign's avatar clip first, else the video in
   that language's folder named after the sign's text, else its `asset_path`, else `<key>.webm`. Only files of the
   chosen language are used. DEBT 160.
5. **Quiz details.** With 4-9 signs the quiz still has 10 questions (each sign once before any repeat, never twice in
   a row; the setup says so). Text -> Sign: tapping a clip plays it (and stops the others), "Choose A-D" answers —
   so one tap answers and only the tapped clip plays. Quit returns to the setup and saves nothing. The score is saved
   once at the end and scored by the server.
6. **"+ New conversation"** = End Conversation's own ending (saved as `ended`), then `talk.html` loads again (a new
   conversation key per page load). With nothing in the thread it just goes back to "Who speaks first?".
7. **Login refusals are HTTP 200** `{success:false, code, message}` (wrong password, deactivated, taken username,
   self-deactivation), as `auth.php` answered before: the browser logs every non-2xx answer as a console error. "Not
   an admin" is 403.
8. **Not built (optional in the wireframe):** auto log-out after ~5 min idle (DEBT 159).

## 3. Files

**New (13 product files):** `login.html`, `conversations.html`, `quiz.html`, `quiz-scores.html`, `users.html`,
`js/sk-account.js`, `js/quiz-core.js`, `js/quiz-ui.js`, `css/sk-pages.css`, `php/session.php`, `php/api/me.php`,
`php/api/quiz.php`, `db-schema/2026-10-accounts-quiz.sql`.

**Changed (product):** `index.html`, `css/style.css`, `talk.html`, `js/virtual-keyboard.js` (password fields get the
keyboard), `php/auth.php`, `php/admin_api.php`, `php/api/save_conversation.php`, `php/api/conversations.php`,
`db-schema/database_setup.sql`, and 5 lines in the `<head>` of `gesture-training.html`, `reports.html`,
`bulk-import.html`, `avatar-clips.html`, `diagnostic.html` (the admin guard).

**Tests:** new `tests/accounts-quiz/` (`helper.mjs`, `auth.test.mjs`, `admin-api.test.mjs`,
`conversations-scope.test.mjs`, `quiz-api.test.mjs`, `quiz-core.test.mjs`, `migration.test.mjs`, `e2e-check.mjs`).
Changed: `tests/conversations/helper.mjs` + `conversations-admin.test.mjs` (log in as admin first — the endpoint
now needs it), `tests/normalization/schema-guard.test.mjs` (expects the 2 new tables),
`tests/video-capture/cdp.mjs` (logs the test Chrome in as admin before it opens an admin page, so every laptop
browser check keeps working; `SK_CHROME`, `SK_CHROME_ARGS`, `SK_TEST_ADMIN_USER`, `SK_TEST_ADMIN_PASS`).

**Docs:** this report + 29 screenshots (`docs/reports/img/accounts-quiz-*.png`); `CLAUDE.md`;
`docs/system/BACKEND.md` (new section "Accounts, conversation history and quiz"), `UI.md` (new Part 4),
`DEBT.md` (item 72 update, items 157-165), `DECISIONS.md` (new section), `INVENTORY.md`.

## 4. Schema and migration

`database_setup.sql` now creates `users`, `conversations`, `quiz_attempts`, `quiz_answers` exactly as the brief's
`SHOW CREATE TABLE`. The migration checks `information_schema` before every step (works in phpMyAdmin, no
`DELIMITER`), never drops, keeps users rows, backfills nothing (old conversations keep `title`/`user_id` NULL; the
list shows their first message and an admin sees them as Guest — DEBT 162). Measured here, `SHOW CREATE TABLE` of the
four tables compared with the brief's text:

| Starting point | After the migration (run twice) |
|---|---|
| A database exactly like the laptop's (brief's DDL) | identical, nothing changed (second run too) |
| Fresh `database_setup.sql` | identical |
| The pre-2026-10-18 `database_setup.sql` with rows | identical; both users rows kept; only the old admin hash replaced; a conversation row kept with `user_id`/`title` NULL |
| An empty database | identical; admin / admin123 seeded |

(One extra step was needed for the old shape: newer MariaDB creates the old `created_at TIMESTAMP DEFAULT
CURRENT_TIMESTAMP` as NULL-able, so the migration makes it `NOT NULL` when it is not, as on the laptop.)
`tests/accounts-quiz/migration.test.mjs` repeats these on throw-away databases.

## 5. Test results

All counts are from runs in this container.

**Node test suites (`node --test`, php-cgi, live DB):** the same 30 existing test files before
any change (baseline, on `py-avatar`'s code with the old schema) and after:

| | Files | Pass | Fail |
|---|---|---|---|
| Before (baseline) | 30 | 347 | 6 |
| After | 30 | 348 | 5 |

The failures are the same ones before and after and are Windows-only: `tests/multi-sample/save-endpoint.test.mjs`
4 (its ffmpeg stub is a `.bat` file), `tests/bulk-import/save-import.test.mjs` 1 (the injected "DB recording insert
fails" case). `tests/avatar/avatar-clip-endpoint.test.mjs` failed 1 in the baseline run and passed 5/5 after (it passed
on a second baseline run too, so that one is timing). Changed for this phase: `conversations-admin.test.mjs` now logs in
as admin (16/16), `schema-guard.test.mjs` expects 7 tables (3/3).

**New tests:** `tests/accounts-quiz/*.test.mjs` 37 tests, 0 fail (auth 8, admin API 7, conversations scope 5, quiz
API 5, quiz core 7, migration 5).

**End-to-end (`tests/accounts-quiz/e2e-check.mjs`, Playwright, 1024x600): 88/88 checks passed**, including:

- Guest / user / admin dashboards: cards and menus exactly as in the wireframe; menu items >= 44 px; admin menu fits
  the screen.
- Each of the 6 admin pages: guest -> dashboard, user -> dashboard, admin stays (Train Gestures still shows its PIN).
  Admin APIs: 403 for guest and user; 403 again after Log out.
- Create account -> logged in as a user, role `user`, `last_login_at` set. Deactivate -> cannot log in (message) and the
  open session is sent to the login page; Activate + Reset password -> logs in with the new password. No Deactivate
  on the admin's own row.
- Let's Talk as guest (saved, `user_id` NULL, title "Hello") and as user (user's id, title "Good morning"); "+ New
  conversation": the old one `ended`, the next message is a new conversation (new key) for the same user.
- Conversations: user sees exactly their own, newest first, no filters; thread read-only, signer left / speaker right;
  admin: 20 + Load more, User = Guest / one user, Language = ESL, can open a guest conversation.
- Quiz: guest Sign -> Text ESL Letters (6/10, not saved, "Log in to save your score", Watch plays the right sign);
  user Sign -> Text FSL Words (5/10) and Text -> Sign ESL Letters (7/10): 10 questions, progress 1/10..10/10, 4
  distinct choices (keys and texts) containing the answer, green/red at once, score = right answers; each saved as one
  attempt + 10 answers whose sign, choices (order shown), choice and `question_type` match the screen. Text -> Sign
  posters are still and only the tapped clip plays; Quit saves nothing; Try again starts 1/10. Avatar clips: Sign ->
  Text plays on the avatar, Text -> Sign shows 4 still avatars and only the tapped one moves. ESL Numbers (0 signs
  with a clip in this data, DEBT 161): red message, Start disabled.
- Quiz scores: user page 2 taken / 60 % / best 7/10; admin "Quiz results" filtered to that user shows the same.
- **0 console errors** on every page the check opened (new pages, dashboard, Let's Talk and the six admin pages).

**Existing browser checks (laptop CDP checks, run here with the container's Chromium, server on port 80):** 25 checks (`tests/*/*-check.mjs`, `verify-e2e.mjs`,
`video-capture/e2e.mjs`, `screenshots.mjs`, `startup-check.mjs`), run on this branch and then on `py-avatar`'s code in a
temporary worktree served at the same `/SKR/` (same DB, same Chromium; `cdp.mjs` given the same two env variables
there, nothing else changed).

| Result | Checks (same on both, unless noted) |
|---|---|
| All pass | `sign-texts/reports-keyboard-check` (reports.html behind the new guard + PIN, keyboard on Train Gestures and Let's Talk), `step1-check`, `talk-check`, `xss-check`, `bulk-import/avatar-step-check` (43/43), `candidates-panel-check` (33/33), `compact-model/bench-check`, `scale-check` |
| Skipped by the check itself | `avatar/admin-check`, `avatar/import-check` (the owner's sample files in `C:/Users/ADMIN/Downloads/Avatar` are not here) |
| Cannot run here | 11 checks stop at `ffmpeg.exe` (a Windows binary) for the fake camera / test videos; `sign-texts/verify-e2e` needs `E:/ACADSS/...`; `compact-model/store-check` 3 fails need Apache's `.htaccess` (the PHP built-in server sends no ETag/Last-Modified) |
| Known stale check | `sign-texts/dataset-check`: 1 fail, the 7th "Avatar" column (DEBT 135), same before |
| Different | `avatar/talk-avatar-check`: this branch passes the 3 clip imports on avatar-clips.html and then stops at `ffmpeg.exe`; the baseline run failed those 3 imports (clip not saved) before reaching it. No check got worse. |

The admin pages' checks reached the pages because `cdp.mjs` now logs the test Chrome in as admin first.

## 6. Screenshots (1024x600)

| Screen | |
|---|---|
| Dashboard, guest | ![](img/accounts-quiz-01-dashboard-guest.png) |
| Log in | ![](img/accounts-quiz-02-login.png) |
| Log in with the on-screen keyboard up | ![](img/accounts-quiz-02b-login-keyboard.png) |
| Create account | ![](img/accounts-quiz-03-create-account.png) |
| Dashboard, user, menu open | ![](img/accounts-quiz-04-dashboard-user-menu.png) |
| Dashboard, admin, menu open | ![](img/accounts-quiz-05-dashboard-admin-menu.png) |
| My conversations | ![](img/accounts-quiz-06-conversations-user.png) |
| Conversation thread | ![](img/accounts-quiz-07-conversation-thread.png) |
| Thread of a guest conversation (admin) | ![](img/accounts-quiz-07b-conversation-thread-admin-guest.png) |
| All conversations (admin) | ![](img/accounts-quiz-08-conversations-admin.png) |
| All conversations, Language = ESL | ![](img/accounts-quiz-08b-conversations-admin-filtered.png) |
| Let's Talk header (user) | ![](img/accounts-quiz-09-talk-header-user.png) |
| Let's Talk thread (user) | ![](img/accounts-quiz-09b-talk-thread-user.png) |
| Quiz setup | ![](img/accounts-quiz-10-quiz-setup.png) |
| Sign -> Text, answered | ![](img/accounts-quiz-11-quiz-sign-to-text.png) |
| Sign -> Text with an avatar clip | ![](img/accounts-quiz-11b-quiz-sign-to-text-avatar.png) |
| Text -> Sign, answered | ![](img/accounts-quiz-12-quiz-text-to-sign.png) |
| Text -> Sign with avatar clips (one playing) | ![](img/accounts-quiz-12b-quiz-text-to-sign-avatar.png) |
| Result, logged in (saved) | ![](img/accounts-quiz-13-quiz-result-user.png) |
| My quiz scores | ![](img/accounts-quiz-14-quiz-scores-user.png) |
| Result, guest | ![](img/accounts-quiz-15-quiz-result-guest.png) |
| Watch the right sign | ![](img/accounts-quiz-15b-quiz-watch.png) |
| Fewer than 4 signs | ![](img/accounts-quiz-16-quiz-too-few.png) |
| Quiz results (admin, one user) | ![](img/accounts-quiz-17-quiz-results-admin.png) |
| Manage users | ![](img/accounts-quiz-18-manage-users.png) |
| Manage users after Deactivate | ![](img/accounts-quiz-18b-manage-users-deactivated.png) |
| Add user (keyboard up) | ![](img/accounts-quiz-19-add-user.png) |
| Reset password | ![](img/accounts-quiz-20-reset-password.png) |
| Log in refused (deactivated) | ![](img/accounts-quiz-21-login-deactivated.png) |

## 7. Known gaps (all in `docs/system/DEBT.md`)

157 training/import write APIs not session-checked · 158 admin PIN still asked · 159 no idle log-out (a user who
walks away stays logged in) · 160 quiz uses Let's Talk's clip source · 161 ESL Numbers has no playable clip in this
data (videos are `1.webm`..`10.webm`) · 162 old conversations have no title/user · 163 Let's Talk's preview logs a
404 for words without their own video (pre-existing) · 164 guests are not told Let's Talk is saved · 165 change the
admin password. Not measured on the Pi; the new pages use no canvas except the quiz's avatar clips, and at most one
clip plays at a time.

## 8. OWNER CHECKLIST

1. **Get the branch:** `git fetch origin` then `git checkout accounts-quiz` (in the repo folder that
   `C:\xampp\htdocs\SKR` points to).
2. **Start XAMPP:** Apache and MySQL in the XAMPP Control Panel.
3. **Database:** your laptop DB already has the new columns and tables, but run the migration anyway — it changes
   nothing that is already there, and it fixes the admin password if it is still the old broken seed:
   phpMyAdmin -> `sining_kamay_db` -> Import -> `db-schema/2026-10-accounts-quiz.sql` -> Go (or SQL tab, paste,
   Go). It should finish with no error.
4. **Reload:** open `http://localhost/SKR/` and press **Ctrl+F5**.
5. **Guest:** the dashboard shows Learn Signs, Let's Talk, Quiz and "Log in" top-right. Open
   `http://localhost/SKR/gesture-training.html` -> you are back on the dashboard.
6. **Admin:** Log in -> `admin` / `admin123` (if that fails, the admin password was changed before; use yours).
   Chip "Admin ADMIN" -> menu has the 6 admin items. Open Train Gestures -> PIN pad as before (2026). Then
   **Manage users -> Reset password** on your admin row and set a new password.
7. **Create a user:** Log out -> Log in -> Create account (name, username, password of 4+) -> you are on the
   dashboard as that user; menu = My conversations, My quiz scores, Log out. Type
   `http://localhost/SKR/reports.html` -> back to the dashboard.
8. **Let's Talk as the user:** say or type two messages -> "+ New conversation" -> one more message. Then menu -> My
   conversations: two conversations titled with their first messages; tap one -> the thread.
9. **Quiz:** Quiz -> Sign -> Text, FSL, Words -> answer 10 -> result -> "Score saved" -> My quiz scores shows it. Try
   Text -> Sign too (tap a video to watch, "Choose" to answer). Try ESL + Numbers: it says there are not enough signs.
10. **Guest quiz:** Log out, do a quiz -> result says "Log in to save your score"; nothing is added to the scores.
11. **Admin lists:** log in as admin -> All conversations (filters User / Language, Load more after 20) and Quiz
    results (User filter). Manage users -> Deactivate your test user -> try to log in as them -> refused. Activate
    again.
12. **Optional, laptop tests:** `node --test tests/accounts-quiz/` (needs `SK_PHP_CGI` / `SK_PHP_CLI` like the other
    php-cgi tests; set `SK_TEST_ADMIN_PASS=<your new admin password>` after step 6) and the existing browser checks
    (they log in as admin by themselves with the same variable).
13. **Tell me** your answers to decisions (a) and (b) at the top.
