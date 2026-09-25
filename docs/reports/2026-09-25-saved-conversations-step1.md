Phase: Saved conversations (Let's Talk history, admin-only)
Date: 2026-09-25
Status: WAITING FOR APPROVAL
Decision needed from owner: approve the proposal, and answer the 5 open questions in section (h)

# Step 1: investigation and proposal

Nothing has been changed. No code, schema or data was touched. The only new file is this report.
The DB facts were measured on live MariaDB `10.4.32-MariaDB` (`SELECT @@version`).

## Summary

- talk.html has **one place where a message is confirmed**: the "Add to Conversation" handler (`talk.html:1412-1416`).
  There are **three places where the conversation ends**: End Conversation (`talk.html:2000-2003`), the idle countdown reaching 0 (`talk.html:1484-1489`), and the idle card's End Now (`talk.html:1510-1515`).
  All three navigate away immediately with `location.href = 'index.html'`. So the save requests must survive a page unload. The proposal uses `fetch(..., {keepalive: true})`.
- **Two schema changes, with evidence.**
  - **Add a `client_key` column.** The page cannot wait for a server-assigned id, because saving is fire-and-forget and the page unloads right after End. So every request carries a random per-page key instead.
  - **Drop `confidence`.** talk.html never has a recognition score (see (b)).
- **Two small additions to live code are needed to get the data.**
  - **ESL/FSL mode:** talk.html doesn't see which mode a sentence was signed in. `talk-signing.js:127` has to pass it along.
  - **Spoken vs typed:** talk.html can't tell them apart today. Speak or Type's Send only passes the text (`talk.html:1880-1885`), and every hearing bubble is labelled "Spoken" (`talk.html:1717`). `talk-speaking.js` needs a callback that says "the mic wrote into the field".
- **`translations`: recommend dropping it.** It has 0 rows. Its only live writer can't run, because no `stop` gesture exists (see (c)). Its readers only log errors or show an empty tab.
- **Privacy finding.** `reports.html` fetches all report data at page load (`reports.html:624`), before the PIN is entered (`reports.html:494`). The PIN only hides the page. Conversations must not work this way: the proposal loads them only after the PIN is correct.

---

## (a) Hook points in talk.html (file:line)

### Where a message enters the thread

| What | Where | Data available at that point |
|---|---|---|
| Confirm card's **Add to Conversation** is the only real call to `appendBubble()` | `talk.html:1412-1416` (`renderConfirmModal`, `:1393`) | `opts.from` (`'deaf'`/`'hearing'`), `opts.text` |
| Signed text reaches the confirm card | `talk.html:1828-1830` (`TalkSigning.init({onText})`) | Text only. `talk-signing.js:127` calls `cb.onText(formulateSmartSentence(got, signLang))`. `signLang` (`'en'`/`'fil'`) is in scope there (global declared at `js/sign-to-text-ui.js:6`, changed by `talk-signing.js:237`) but is not passed on. |
| Typed or spoken text reaches the confirm card | `talk.html:1878-1888` (Send click) | Text only, `from:'hearing'`, label "You said". **The mic's text and typed text arrive the same way.** The mic writes `input.value` and fires `input` at `js/talk-speaking.js:61-65` (partials) and `:229-230` (final). The on-screen keyboard and real typing also fire `input`. |
| Recognition score | `js/talk-signing.js:119-128` (`finish()`), `:205` | **None.** `words` holds label strings only (`words.push(translateGestureLabel(...))`), so there is no sentence-level confidence. |
| Bubble time | `talk.html:1413` | `new Date()` on the client. The kiosk and server are the same machine (`start_kiosk.sh` → `http://localhost/SKR/`), so the server's `current_timestamp()` gives the same clock. |

### Where the conversation ends

| Exit | Where | Today |
|---|---|---|
| End Conversation button | `talk.html:2000-2003` | `onEndConversation(); location.href = 'index.html'` |
| Idle countdown reaches 0 (120 s `IDLE_TIMEOUT_MS` `:1273`, then a 30 s card `:2030`) | `talk.html:1484-1489` | same |
| Idle card's **End Now** | `talk.html:1510-1515` | same |
| Back while on who-first | `talk.html:1350-1352` | `location.href = 'index.html'`. who-first can't be showing once a message exists: Back goes to `thread` when there is a `.bubble-row` (`:1354-1355`), and so does the camera-error "Go back" (`:1845-1846`). So this exit never has anything to save. |
| Reload, tab close, kiosk restart, Chromium crash | nothing | Nothing runs. The browser's `pagehide` event fires on reload and close. It does not fire on a crash or power loss. |

`onEndConversation()` (`talk.html:1294-1297`) is already called by all three real exits, right before the navigation.

### Proposed hook points (additive only)

1. **`talk.html:1413`**: after `appendBubble(...)`, call `TalkHistory.saveMessage({from, source, signLanguage, text})`. It is wrapped so it can't throw into the handler, and `closeModal()`/`showScreen('thread')` still run unchanged.
2. **`talk.html:1829`**: `onText: function (text, meta)` adds `source:'sign', signLanguage: meta.signLanguage` to the confirm opts.
3. **`js/talk-signing.js:127`**: pass a second argument, `{signLanguage: signLang === 'fil' ? 'FSL' : 'ESL'}`. No other change to that file.
4. **`talk.html:1881-1885`**: add `source: speakingFromMic ? 'speech' : 'typed'` to the confirm opts.
   - `speakingFromMic` is a hoisted variable, like `speakingPlayer` at `:1281`.
   - It is set by a new `onTranscript` callback in `TalkSpeaking.init` (`talk.html:1924`).
   - It is cleared whenever the field becomes empty (the `input` listener, `:1867`), which also covers the clear after Send (`:1886`).
5. **`js/talk-speaking.js:64` and `:230`**: call `cb.onTranscript()` after each of the two existing writes. No other change.
6. **`onEndConversation(reason)`** (`talk.html:1294`): first calls `TalkHistory.end(reason)`, then the existing `leave()` calls. The three callers pass a reason:
   - `'ended'` from `:2001`
   - `'idle'` from `:1487`
   - `'ended'` from `:1513` (End Now; open question h2)
7. **`js/talk-history.js`** (new) listens for `pagehide` itself and sends `end('left')`. A flag makes the first reason win, so `pagehide` after End sends nothing more. The server also only fills `ended_at` while it is still NULL.
8. **`talk.html:1213`**: one new `<script src="js/talk-history.js"></script>` tag, before the inline script.

The speaker, source, time and cap logic of `appendBubble()`/`BUBBLE_LABEL_VERB` stays as it is. The thread still shows "Spoken" for typed text, and still caps at 30 bubbles (`:1806`). That cap now matches its own comment at `:1745`, which says older messages "still live in the database".

### `js/talk-history.js` behaviour (fire-and-forget)

- **Page key.** At load, it makes a 32-hex-character random key with `crypto.getRandomValues`, which works in any context. It also keeps a `seq` counter and a count of confirmed messages.
- **`saveMessage()`** increments `seq`, then runs `fetch('php/api/save_conversation.php', {method:'POST', keepalive:true, body})`. It returns right away.
  - Any rejection, non-2xx status or bad JSON → `console.warn('[talk-history] ...')`. It never uses `console.error` and never shows a modal.
  - Nothing awaits it.
  - The whole body is in `try/catch`.
- **`end(reason)`** does nothing if no message was confirmed on this page. So opening Let's Talk and leaving sends zero requests and creates no row.
- **Requests the kiosk can make:** only the two write actions below. No read of past data exists anywhere in talk.html's code path. The response is `{success}` only, with no ids or text.

---

## (b) Final schema DDL

```sql
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `client_key` char(32) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `ended_at` timestamp NULL DEFAULT NULL,
  `end_reason` enum('ended','idle','left') DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_conversations_client_key` (`client_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `seq` int(11) NOT NULL,
  `speaker` enum('signer','hearing') NOT NULL,
  `source` enum('sign','speech','typed') NOT NULL,
  `sign_language` enum('ESL','FSL') DEFAULT NULL,
  `text` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_messages_conversation_seq` (`conversation_id`,`seq`),
  CONSTRAINT `fk_messages_conversation` FOREIGN KEY (`conversation_id`)
    REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_messages_speaker_source` CHECK (
    (`speaker` = 'signer'  AND `source` = 'sign') OR
    (`speaker` = 'hearing' AND `source` IN ('speech','typed'))),
  CONSTRAINT `chk_messages_sign_language` CHECK (
    (`speaker` = 'signer') = (`sign_language` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

### Differences from your proposal, with evidence

- **`client_key` added.**
  - The page must refer to "this conversation" without ever waiting for a response. All three exits navigate right after `onEndConversation()` (`talk.html:1488`, `:1514`, `:2002`). A queued follow-up request that needs the id from the first response would be lost when the page unloads.
  - With a per-page key, the first message's request creates the row: `INSERT ... ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)` plus the message, in one transaction.
  - Later messages and `end` find the row by key.
  - A reload means a new page and a new key, so it starts a new conversation. The old one is closed with `'left'`.
- **`confidence` dropped.** talk.html has no score (`js/talk-signing.js:119-128`, `:205`). Your rule: don't invent fields.
- **`sign_language` kept, for signed messages only.** talk-signing knows the mode at `finish()` (`signLang`, `js/talk-signing.js:127`, `:237`). A failed language switch is reverted, so the mode and the loaded model always agree (`:242-252`). The CHECK makes it NOT NULL exactly when `speaker = 'signer'` (open question h3).
- **CHECK constraints added.** `source` can only be `sign` for the signer, and `speech`/`typed` for the hearing person. MariaDB 10.4 enforces CHECK constraints.
- **No extra index on `messages.conversation_id`.** The UNIQUE key `(conversation_id, seq)` starts with it, and InnoDB uses that key for the foreign key.
- **`seq` is assigned by the page** (1, 2, 3… in confirm order). The UNIQUE key stops a duplicate. If one save fails, there's a gap in `seq`, which shows that a message was lost rather than hiding it.
- **Timestamps.** `ended_at` is explicitly `NULL DEFAULT NULL`, and both NOT NULL timestamps have an explicit DEFAULT. So on MariaDB 10.4, where `explicit_defaults_for_timestamp` is OFF, neither gets an implicit `ON UPDATE`. Task 1 checks this with `SHOW CREATE TABLE`.

### `end` never creates a row, and the known edge case

`end` only runs `UPDATE conversations SET ended_at = current_timestamp(), end_reason = ? WHERE client_key = ? AND ended_at IS NULL`. So every conversation row has at least one message.

The edge case: someone taps End Conversation during the time it takes to save the message they just added. The `end` UPDATE can then reach the server first and match 0 rows, leaving `ended_at` NULL. Reports then shows "Not ended". No message is lost. It will be filed as a Low DEBT item.

---

## (c) `translations`: recommend dropping it

Measured: `SELECT COUNT(*) FROM translations` = **0**. It was emptied in the 2026-09-24 DB cleanup, per `docs/system/BACKEND.md` "DB cleanup".

| # | Reader / writer | Where | Reachable today? | If the table is dropped |
|---|---|---|---|---|
| W1 | `save_translation.php` INSERT | `php/api/save_translation.php:65` | Only through `js/db-api.js:35` | Would return 500. Delete it. |
| W1a | gesture-training Step 4, the `stop` gesture branch | `js/gesture-training-ui.js:844-853` (in `startLivePrediction(true)`, `:702`, entered at `:1055`/`:1097`) | **No.** It needs the k-NN to detect `stop`. Measured: `SELECT label FROM gestures WHERE label IN ('stop','start')` gives only `start/ESL`. `saved_gestures/` has `start` and no `stop`; `saved_gestures_fsl/` has neither. | The call is already in `try/catch` (`:852`, console.error only). |
| W1b | `tlProcessAndFinishSentence` | `js/sign-to-text-ui.js:633-642` (callers `:570` `tlStartPredLoop`, `:749` `tlHandleTranslate`) | **No.** talk.html loads this file (`js/talk-loader.js:15`) but uses its own loop. `js/talk-signing.js` only mentions `tlStartPredLoop` in a comment (`:3`), and `DB_API` isn't loaded in talk.html (no `db-api.js` in `talk.html:1209-1213` or `talk-loader.js:10-16`). The only page that runs this loop is `archive/sign-to-text.html`. | Already `try/catch`. |
| R1 | `get_translations.php` SELECT | `php/api/get_translations.php:39` | Only through `js/db-api.js:75` | Would return 500. Delete it. |
| R1a | "DB connected" status-dot ping | `js/sign-to-text-ui.js:859-872`, inside a `DOMContentLoaded` handler (`:837`) | **No.** In talk.html the file is added on window `load` (`js/talk-loader.js:152-153`), after `DOMContentLoaded` has already fired, so the handler never runs. The only other page is `archive/sign-to-text.html`. | Already `try/catch` (console.warn). |
| R2 | Reports Translations tab | `php/api/reports.php:51-57`, `:64`, `:69` → `reports.html:94`, `:69-78`, `:407`, `:416`, `:579-591`, `:630`, `:633` | Yes. It always shows "No translation records found." | reports.php would 500 and take the whole Reports page down with it, since one JSON feeds all tabs. That's why R2 changes in the same task as the drop. |
| S1 | `database_setup.sql` | `db-schema/database_setup.sql:57-69` | Setup | Remove the block. |
| S2 | `schema-guard.test.mjs` expected table list | `tests/normalization/schema-guard.test.mjs:23`, `:57` | Test | Must change either way: the new tables change the list. |
| S3 | `2026-09-24-normalize.php` step 10, `migration.test.mjs:81` | `db-schema/migrations/2026-09-24-normalize.php:247`, `:515` | Only on a clone of the **pre-normalization** backup, where `translations` still exists | **Not changed.** The one-time migration's own end state is unchanged. `:247` is inside `if (tableExists(...))`. |
| S4 | Tracked dumps | `sining_kamay_db.sql`, `db-schema/sining_kamay_db_backup.sql` | Old snapshots, not importable (DEBT 73) | Not changed. |
| — | `js/db-api.js` `<script>` tags | `gesture-training.html:12`, `diagnostic.html:23` | Loaded. diagnostic.html never calls `DB_API` (grep: 0 calls). | Remove both tags when `db-api.js` is deleted. |
| — | `archive/**` | several | Archived | Not changed (your rule). |

`admin_api.php` and `auth.php` don't mention `translations` (grep: 0).

**Recommendation: drop it (option A).**
- Drop the table after checking again that it has 0 rows.
- Delete `php/api/save_translation.php`, `php/api/get_translations.php` and `js/db-api.js`.
- Remove the two `<script>` tags and the three dead `DB_API` blocks (W1a, W1b, R1a). They are outside `knnPredict`/`cosineSimilarity`/`trainModel`/`mergeSavedGestureSamples`.
- Reports' Translations tab and metric become Conversations.

**Option B (smaller):** drop the table, delete the two PHP endpoints and change Reports, but leave `db-api.js` and the three call blocks. They would then get 404s and log errors in their catch blocks, on paths that can't run. This doesn't touch `sign-to-text-ui.js`, which talk.html loads live.

**Option C:** leave `translations` untouched. Conversations then becomes a 4th Reports tab next to Translations.

---

## (d) Endpoints

Two files, so the kiosk's code path only ever knows about a write-only endpoint:

### `php/api/save_conversation.php` (kiosk, write-only)

POST only; anything else → 405. JSON body. Prepared statements throughout. Every response is `{"success":true}` or `{"success":false,"error":"..."}`, the same shape as `save_gesture.php`/`reports.php`. **It never returns ids, text or other conversations.**

| action | Body | Effect | Errors |
|---|---|---|---|
| `message` | `client_key` (32 hex), `seq` (int ≥ 1), `speaker` (`signer`/`hearing`), `source` (`sign`/`speech`/`typed`), `sign_language` (`ESL`/`FSL`/null), `text` (non-empty after trim, ≤ 65,535 bytes, the TEXT limit) | One transaction: upsert `conversations` by `client_key`, then insert into `messages` | 400 for a bad or inconsistent field (same rules as the CHECKs, checked in PHP first for a clear message). 409 for a duplicate `(conversation, seq)`. 500 for a DB error. |
| `end` | `client_key`, `reason` (`ended`/`idle`/`left`) | `UPDATE ... WHERE client_key = ? AND ended_at IS NULL` | 400 for a bad field. Matching 0 rows is still `success:true` (fire-and-forget: nothing to report back). |

### `php/api/conversations.php` (Reports, admin)

It has the same gate as `reports.php` today, which is none on the server side (DEBT 72 stays open, per your decision). The only link to it is `reports.html` after the PIN.

| Request | Response |
|---|---|
| `GET` | `{success, conversations:[{id, started_at, ended_at, end_reason, duration_seconds, message_count, first_message}]}`, newest first (`ORDER BY started_at DESC, id DESC`). `duration_seconds = TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, MAX(messages.created_at)))`. `first_message` is the text of the lowest `seq`. |
| `GET ?id=N` | `{success, conversation:{...same fields...}, messages:[{seq, speaker, source, sign_language, text, created_at}]}` ordered by `seq`. 404 if not found. |
| `POST {"action":"delete","id":N}` | `DELETE FROM conversations WHERE id = ?`. Its messages go too, via CASCADE. `{success, deleted:1}`; 404 if 0 rows. |
| `POST {"action":"clear_all"}` | `DELETE FROM conversations` (not `TRUNCATE`: InnoDB refuses to truncate a table that a foreign key points to). `{success, deleted:n}`. |

---

## (e) Reports UI

- **Where it goes:** it replaces the Translations tab (`reports.html:407`, `:416`) and the Translations metric (`:398-402`, the third `.metric`). The layout stays the same: 3 metrics, 3 tabs. With option C it becomes a 4th tab instead.
- **Loading:** only after a correct PIN (a call added to the success branch of `trVerifyPin`, `reports.html:495`), not at page load like `reports.php` (`:624`).
  - `reports.php` keeps loading the ESL/FSL lists at page load, as today; they aren't private.
  - The list is re-fetched after every delete or Clear all.
- **List columns:** Date/time · Duration · Messages · First message (wraps, no ellipsis, following the existing rule at `reports.html:71-75`) · Ended (Ended / Idle / Left / Not ended) · Delete button.
  - A **Clear all** button sits above the table in the tab.
  - Tapping a row (anywhere except Delete) opens the thread view.
- **Thread view:** a modal in the same family as the existing `.asset-modal` (`reports.html:233-345`).
  - Header: date · duration · N messages · end reason.
  - Body: a scrolling list of bubbles, styled with talk.html's bubble rules copied in (`talk.html:226-247`: signer on the left, white with a border; hearing on the right, navy).
  - Each label reads "Signed · 10:41 AM" / "Spoken · …" / "Typed · …", from `source`. The time uses talk.html's `formatBubbleTime` rule (`talk.html:1726-1735`).
  - Signed bubbles add "ESL"/"FSL".
  - Footer: "Back to Reports" and Delete.
  - Read-only: there is no reply or continue control.
- **Confirm step:** one in-page confirm card, not `window.confirm`.
  - Text: "Delete this conversation?" or "Delete all N conversations?", plus "This cannot be undone."
  - Buttons: Cancel, and a red Delete.
  - A toast afterwards uses the existing `showToast` (`reports.html:482`).
- **Text is always inserted escaped.** List cells use the existing `esc()` (`reports.html:514`). Bubbles use `textContent`, as talk.html does.
- **Print:** `#tab-translations::before` (`:94`) becomes `#tab-conversations::before{content:'Conversations'}`. It prints the list only; the thread modal isn't printed.
- **1024×600:** the table area is the same `minmax(0,1fr)` grid row as today. Task 5 measures `scrollWidth` = 1024 and every button ≥ 44 px tall.

---

## (f) Files

### Changed or new (option A)

| File | Why |
|---|---|
| `db-schema/database_setup.sql` | Add `conversations`/`messages`; remove the `translations` block |
| `php/api/save_conversation.php` (new) | Kiosk write-only endpoint |
| `php/api/conversations.php` (new) | Admin list/detail/delete/clear endpoint |
| `php/api/reports.php` | Remove the `translations` query, and the `summary.translations`/`data.translations` keys |
| `reports.html` | Conversations tab, metric, thread modal and confirm card; loads after the PIN |
| `js/talk-history.js` (new) | Fire-and-forget save client |
| `talk.html` | 1 script tag, save call on Add, source/signLanguage in confirm opts, `onEndConversation(reason)` at 3 callers, `onTranscript` wiring |
| `js/talk-signing.js` | Line 127: pass `{signLanguage}` to `onText` |
| `js/talk-speaking.js` | Lines 64/230: call `cb.onTranscript()`; document it in `init` |
| `tests/conversations/helper.mjs` (new) | Runs any `php/api/*.php` through php-cgi, the same way as `tests/multi-sample/harness.mjs:21-37`, which is hard-wired to `save_gesture.php` |
| `tests/conversations/save-conversation.test.mjs` (new) | Endpoint tests (see Task 2) |
| `tests/conversations/conversations-admin.test.mjs` (new) | Endpoint tests (see Task 3) |
| `tests/normalization/schema-guard.test.mjs` | `EXPECTED_TABLES` (`:23`, `:57`) become the new 5 tables |
| **Delete** `php/api/save_translation.php`, `php/api/get_translations.php`, `js/db-api.js` | Option A |
| `gesture-training.html` (`:12`), `diagnostic.html` (`:23`) | Remove the `db-api.js` `<script>` tag (option A) |
| `js/gesture-training-ui.js` (`:844-853`), `js/sign-to-text-ui.js` (`:633-642`, `:859-872`) | Remove the dead `DB_API` blocks (option A only). The four protected functions aren't touched. |
| `docs/system/BACKEND.md` | Endpoints, tables, ERD (`conversations ||--o{ messages`), setup notes |
| `docs/system/UI.md` | Part 3: save hooks. Part 2: Reports Conversations tab |
| `docs/system/DECISIONS.md` | This phase's decisions |
| `docs/system/DEBT.md` | New items: end/save race (b), `conversations.php` has no server-side auth (added to 72's scope), translations items closed |
| `docs/system/INVENTORY.md` | New and deleted files |
| `CLAUDE.md` | "No DB logging happens from `talk.html`" and the "4-table" schema line are no longer true |
| `docs/reports/2026-09-25-saved-conversations-step1.md`, `...-final.md` | Reports |

### Not changed

| File | Why not |
|---|---|
| `js/sign-to-text-ui.js` `knnPredict`/`cosineSimilarity`/`trainModel`/`mergeSavedGestureSamples`, frame capture | Protected. Only dead `DB_API` blocks are removed, and only with option A. |
| `gestures`, `gesture_recordings`, `saved_gestures*/`, `assets/signs/` | Protected, and not needed |
| `archive/**` | Protected |
| `js/talk-loader.js`, `js/sign-player.js`, `js/gesture-data.js`, `js/camera-helper.js` | Nothing to save from them |
| `index.html` | The dashboard shows no conversation data. Its only related link is the Reports button (`index.html:73`), which leads to the PIN. |
| `php/connect.php`, `php/auth.php`, `php/admin_api.php` | Not involved. The auth gap stays (DEBT 72). |
| `db-schema/migrations/2026-09-24-*.php`, `tests/normalization/migration.test.mjs`, the tracked `.sql` dumps | Historical. They run against a pre-normalization clone (see (c) S3/S4). |
| `docs/revision/MEMORY.md`, `docs/system/MANUAL-CHECKS.md` | Your uncommitted edits. Not touched, not staged. They will show in `git status` but not in this phase's commits. |

With option B, drop the "Delete `js/db-api.js`", `gesture-training.html`, `diagnostic.html`, `gesture-training-ui.js` and `sign-to-text-ui.js` rows. With option C, also keep `database_setup.sql`'s translations block and `reports.php` as they are, and don't delete the two endpoints.

---

## (g) Tasks

Step 2 process: subagent-driven, with a fresh implementer per task and at most 3 review rounds, then escalate. Each task gets its own code commit. The docs and reports go in one docs commit at the end. No push, no merge.

1. **Backup + schema.**
   - Run `C:\xampp\mysql\bin\mysqldump.exe --single-transaction sining_kamay_db` > `E:\ACADSS\IOT\backups\sining_kamay_db_before-conversations.sql` (record its size).
   - Update `database_setup.sql`.
   - On live, run the two `CREATE TABLE IF NOT EXISTS` statements through `mysql.exe`. Re-check `SELECT COUNT(*) FROM translations` = 0, then `DROP TABLE translations`. If the count isn't 0, stop and escalate.
   - Update `schema-guard.test.mjs`.
   - **Done when:** the backup file exists and isn't empty; live `SHOW CREATE TABLE` for both tables matches (b) (no `ON UPDATE`, FK CASCADE and both CHECKs present); `SHOW TABLES` = the 5 expected; `schema-guard.test.mjs` passes. Reports can't be loaded between this step and Task 5 (dev PC only; Task 5 follows immediately).
2. **`save_conversation.php` + tests.**
   - **Done when** tests pass, using `zz`-prefixed probe keys that are cleaned up before and after, for:
     - the first message creates 1 conversation + 1 message, and a 2nd message with the same key goes to the same conversation;
     - a duplicate seq → 409;
     - every invalid enum or combination → 400, with no row written;
     - empty or whitespace text → 400;
     - `end` sets `ended_at`/`end_reason`, and a second `end` doesn't overwrite it;
     - `end` for an unknown key creates no row;
     - a GET → 405;
     - no response body contains `id`, `text` or `conversation`.
3. **`conversations.php` + tests.**
   - **Done when** tests pass for: list order and fields (`message_count`, `first_message`, `duration_seconds`); detail ordered by `seq`; detail 404; delete removes the conversation and **its messages** (counted with `SELECT COUNT(*) FROM messages WHERE conversation_id = ?` → 0), and returns 404 for an unknown id.
   - Clear-all test: it runs only when every row in `conversations` is a `zz` probe; otherwise it skips with a message, so it can never wipe real data. It asserts that 0 conversations and 0 messages remain.
4. **Let's Talk save hooks** (`js/talk-history.js`, `talk.html`, `talk-signing.js:127`, `talk-speaking.js:64/230`). **Done when**, in a real browser at 1024×600:
   - Add creates a row, and each later Add increments `seq`.
   - Signed, spoken and typed messages give the right `speaker`/`source`/`sign_language`.
   - End → `'ended'`.
   - Opening and leaving with no message → 0 new rows and 0 requests to `save_conversation.php`.
   - A reload after 1 message → `'left'`.
   - With `fetch` to `save_conversation.php` forced to reject, and separately forced to return a 500, the full conversation still works: the bubbles appear, End navigates, only `console.warn` lines appear and there is no modal.
   - No console errors.
   - The diff in `talk-signing.js`/`talk-speaking.js` is limited to the lines listed.
5. **Reports Conversations tab** (`reports.php`, `reports.html`). **Done when**, at 1024×600:
   - Before the PIN, no request to `conversations.php` appears in the network log.
   - After the PIN, the list matches the DB.
   - A row opens the thread view in the right order, with the right sides, labels and times.
   - Delete and Clear all both need a confirm step, and Cancel changes nothing.
   - `scrollWidth` = 1024, all controls ≥ 44 px, no console errors.
6. **translations cleanup** (option A only). Delete the 2 endpoints and `db-api.js`, and remove the 2 script tags and 3 blocks.
   - **Done when:** `grep -rn "DB_API\|db-api\|save_translation\|get_translations"` outside `archive/`/`docs/` returns 0 results; gesture-training.html, diagnostic.html and talk.html load with no console errors; the gesture-training Step 3/4 live prediction still runs.
7. **Docs.** Update BACKEND (with the ERD), UI, DECISIONS, DEBT, INVENTORY and CLAUDE.md.
   - **Done when:** every number is cited or measured, and `git diff --stat` matches (f).
8. **Whole-phase review and the verification you asked for** (all measured, written into `docs/reports/2026-09-25-saved-conversations-final.md`):
   - a real conversation with signed, spoken and typed messages, then End;
   - the idle return, waiting the real 150 s;
   - an empty session;
   - the save endpoint failing;
   - no route to past conversations from talk.html or index.html (grep plus the network log);
   - delete and Clear all, including the cascade;
   - every existing suite, plus the new tests;
   - 0 console errors at 1024×600;
   - `git diff --stat` compared with (f).
   - Verification caveat: a **signed** turn needs a camera and someone performing a trained sign. If I can't produce a real recognised sign (fake-camera capture, as in the 2026-09-21 phase), I'll say so in the final report and ask you to do that one turn. I won't fake a signed message by calling the endpoint directly.

---

## (h) Open questions (defaults I'll use if you just say "approved")

1. **translations:** option **A** (full removal), B (table + endpoints only) or C (keep)? Default: **A**.
2. **The idle card's End Now:** `'ended'` (a person tapped it) or `'idle'` (it's part of the idle return)? Default: **`'ended'`**. Only the countdown reaching 0 counts as `'idle'`.
3. **`sign_language` for hearing messages:** NULL (proposed; the hearing text isn't signing input, and the preview isn't stored) or the preview's sign set (`en-US` → ESL, `fil-PH` → FSL, from `TalkSpeaking.getLanguage()`, `js/talk-speaking.js:301`)? Default: **NULL**.
4. **Mixed input** (the mic filled the field, then the person edited it by typing): `'speech'` or `'typed'`? Default: **`'speech'`** if the mic wrote into the field since it was last empty.
5. **`client_key` column and dropping `confidence`** (section (b)): OK? Default: **yes**.
