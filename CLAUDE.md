# Sining Kamay (SKv2)

Offline Filipino Sign Language translation kiosk. Client-side vanilla
JavaScript/HTML5/CSS3, no framework, no build step. MediaPipe Hands (WASM) does
hand-landmark detection; a hand-rolled cosine-similarity k-NN does sign
classification, on-device — the only classification approach that has ever
run in this system. A second, TensorFlow.js-based approach exists in code
(`archive/camera-translator.html`) but has never executed in any browser; see
`docs/system/ML.md`. PHP 8 + MySQL/
MariaDB on Apache handle admin functions and history/translation logging only —
never live inference. Target hardware is a Raspberry Pi 4B 8GB, CPU-only,
Chromium in kiosk mode, with a **1024×600** touchscreen — this is the screen
size to test against, not a laptop viewport. Phase 1 of this revision (dead-code deletion, see
`docs/system/DEAD_CODE.md`) is complete: a browserify/deeplearn.js build
pipeline that turned out to belong to a separate open-source project this
codebase was originally started from — not an earlier revision of this one,
see `archive/old-revision-docs/ORIGIN.md` — has been removed, along with
several orphaned dev/test pages. Expect some half-migrated paths to remain;
see `docs/system/DEBT.md`.

## Hard rules

- **Offline only.** No fetch to the internet, no CDN, no external API, ever.
  Phase 2 removed the Google Fonts CDN calls and the MyMemory translation API
  call (see `docs/system/DEBT.md` items 1 and 3). One known violation remains —
  `learn-signs.html` embeds an entire external website in an `<iframe>`
  (`docs/system/DEBT.md` item 29) — so this rule is not yet fully true in
  practice. Do not add more violations, and do not assume this one is
  someone else's problem to notice.
- **No build step.** No npm, no webpack, no bundler. Files are served as-is.
- **No framework.** No React, Vue, or jQuery. Vanilla JS/DOM only.
- **Raspberry Pi 4B is the target, not a laptop.** CPU only, no GPU.
- **PHP touches admin/history only, never the live translation path.**

## Reports go to files, not chat

- Every report you'd normally give in chat goes to a Markdown file under
  docs/reports/: Step 1 proposals (the STOP-and-wait point), investigation
  results, blocker reports, and final phase reports.
- File name: docs/reports/YYYY-MM-DD-<phase-slug>-<stage>.md, where
  <stage> is step1, investigation, blocked, or final. A revised proposal
  gets a new file (-step1-v2), never an overwrite.
- Every report starts with this header:
    Phase: <name>
    Date: YYYY-MM-DD
    Status: WAITING FOR APPROVAL | BLOCKED | DONE
    Decision needed from owner: <one line, or "none">
- Same evidence rule as docs/system/: every number is measured or cited
  by file:line, never estimated.
- In chat, reply with at most 3 lines: what happened, the Status, and the
  report file path. No duplicate of the report in chat.
- Commit report files with the phase's docs commit (not with code).
- docs/revision/ keeps its own REVISE/REPORT convention (see
  docs/revision/RULES.md). This rule covers everything outside it.

## Run

Phase 2.5 (local development environment) is complete — the system runs
locally via XAMPP:

- **Stack:** XAMPP (Apache + PHP). This machine used to have two database
  servers competing for port 3306 (XAMPP's MariaDB 10.4 and a separate
  MySQL 8.0 Windows service, `MySQL80`). The owner disabled `MySQL80` on
  2026-09-24; **XAMPP MariaDB 10.4 (`C:\xampp\mysql\data`) is now the only DB
  server**, and it runs standalone from the XAMPP Control Panel, not as a
  Windows service, so nothing listens on port 3306 after a reboot until it's
  started there (see `docs/system/DEBT.md` item 68). Check
  `SELECT @@version` through `php/connect.php` if in doubt.
- **Serving:** a directory junction at `C:\xampp\htdocs\SKR` points at this
  repo, so there is one copy of the files on disk — editing the repo edits
  what Apache serves, and vice versa. No file copying/syncing step.
- **Database:** the 7-table schema (`gestures`, `gesture_recordings`,
  `conversations`, `messages`, `users`, `quiz_attempts`, `quiz_answers`) is what the current code expects
  (`translations` was dropped 2026-09-25, saved-conversations phase; the quiz tables and the new `users` /
  `conversations` columns came with the 2026-10-18 accounts-quiz phase — run
  `db-schema/2026-10-accounts-quiz.sql` on an older database, it is idempotent — see
  `docs/system/BACKEND.md`). Do **not** import
  either tracked `.sql` dump on a fresh machine — both are pre-normalization
  snapshots (2026-09-24 schema-normalization phase) and no longer match the
  code. See `docs/system/BACKEND.md`, "Schema migration and fresh-machine
  setup (2026-09-24)", for the two supported setup routes.
- **URL:** http://localhost/SKR/
- The local path (`/SKR/`) deliberately matches the path the Pi serves the
  kiosk from (`start_kiosk.sh` targets `http://localhost/SKR/index.html`, see
  `docs/system/HARDWARE_BOOT.md`), so hardcoded `/SKR/`-relative references
  behave the same in local dev as on the Pi.

Confirmed working locally: camera capture and sign-to-text translation, with
the k-NN classifier loading all 122 signs (89 Both + 33 ESL) and no console errors — first
on `sign-to-text.html`, now (2026-09-21) inside `talk.html`'s signing screen;
`sign-to-text.html` itself is archived (`archive/sign-to-text.html`). As of
the 2026-09-23 gesture-categorization phase, every gesture-training label
also carries a `word`/`letter`/`number`/`phrase` category (auto-guessed by a
heuristic, manually re-taggable in `gesture-training.html`'s Step 1) — see
`docs/system/UI.md` and `docs/system/DECISIONS.md`.

`avatar-clips.html` (opened from Train Gestures, laptop only) makes one 2D-avatar
clip per sign from a video or an imported landmark JSON, saved as
`saved_gestures/<key>/avatar.json`; in Let's Talk, Speak or Type plays a word on
the avatar when its sign has a clip and otherwise fingerspells it on the avatar
with the letter and number signs — no video anywhere since the 2026-10-19
talk-turns-audio phase — see `docs/system/UI.md` ("Avatar clips", Part 3 3e/3g).

`bulk-import.html` (laptop only, admin only; **no kiosk page links to it** — open it
by typing `http://localhost/SKR/bulk-import.html`) turns a folder of videos named
`<SET>_<label>_<SIGNER>.<ext>` into recognition samples (through
`php/api/save_gesture.php`) and avatar clip candidates. Its cache and the
candidates live in the git-ignored `bulk_import_cache/` and never go to the Pi.
Imported samples (`saved_gestures/*/sample_i*.json`) are git-ignored too, so they
never reach the Pi through git, and since the compact-model phase the kiosk no
longer needs any samples (it loads the compiled model files, below; `DEBT.md`
item 116, resolved 2026-10-16) — see `docs/system/UI.md` ("Bulk video importer")
and `docs/system/BACKEND.md`. Since bulk-reps-fix (2026-10-16) the importer finds each
video's 3 repetitions with its own split (`js/bulk-rep-split.js`: no hand / hand lowered /
nearly still while low, thresholds in `SPLIT`), not with the live 1 s no-hand segmenter,
which live capture keeps; re-importing a video with another split replaces its old samples
(`docs/reports/2026-10-16-bulk-reps-fix.md`).
Since py-extractor (2026-10-16) the Hands pass can also run outside the browser:
`tools/py_extract/extract.py` (Python 3.12, mediapipe 0.10.21, venv `E:\ACADSS\IOT\mp_env`, laptop only) writes the
same cache entries (`source: "python mediapipe …"`, split left to the page); the page's Start splits them from the cache
and runs Holistic for the avatar signers only. Folders named `unzipping` / `_duplicates*` are skipped by both. See
`tools/py_extract/README.md` and `docs/reports/2026-10-16-py-extractor.md`.
Since py-avatar (2026-10-17) `extract.py --avatar-signers P03,...` also makes those signers' avatar candidates
(Holistic on the best repetition, in the page's candidate format, `source: "python mediapipe 0.10.21 holistic"`; HEVC
works), so the page only does Step 5 for them; the split, best rep and clip come from the page's own JavaScript run
with node. It never replaces a stored candidate without `--overwrite` and never writes `avatar.json`. See
`docs/reports/2026-10-17-py-avatar.md`.

**Recognition model (compact-model phase, 2026-10-16).** Recognition no longer
downloads samples. Let's Talk and Train Gestures Steps 3/4 load
`models/knn_ESL.bin` / `models/knn_FSL.bin` (tracked binary files, one per
language) through `js/knn-model-store.js`, which keeps a copy of each in
IndexedDB and downloads a file again only when it changed (otherwise one HEAD).
The files are built on the laptop by Train Gestures Step 2 **Compile**, one
language at a time, from every saved sample (`js/knn-compile.js`,
`php/api/compile_model.php`). On the laptop the Step 2 status line reads "Model
out of date: run Compile" when the samples changed (`php/api/model_status.php`).
On the Pi, Compile is disabled with a "build the model on the laptop" warning and
the kiosk keeps using the last good file. The device is `php_uname('m')` (ARM =
Pi) unless the git-ignored `config/device.txt` says `pi` or `laptop`. See
`docs/system/ML.md` ("Compact model"), `docs/system/UI.md` and
`docs/system/HARDWARE_BOOT.md`.

`talk.html` is the "Let's Talk" two-way conversation screen (see
`docs/system/UI.md` Part 3 / 3a and `docs/system/DECISIONS.md`). Its **signing
screen is real**: live camera + MediaPipe + the k-NN, output added to the
conversation on Send (through a confirm card until 2026-10-19). A background loading queue (`js/talk-loader.js`) loads the sign
stack once per page load and gates the Guide on it; since pi-fixes (2026-10-21,
`docs/reports/2026-10-21-pi-fixes-final.md`) the Vosk model is a separate queue started in the
background (sign stack ready, camera not starting) or when Speak or Type opens, the camera shows an
"Inihahanda ang camera…" overlay until its first frame and first MediaPipe result, and MediaPipe gets
every 2nd camera frame (`?detectEvery=N`, `?devperf` fps overlay); `talk.html?devqueue` shows a
diagnostic overlay for the queue (off otherwise). Leaving the signing screen stops the
camera tracks (hardware released) but keeps the loaded model and the single
MediaPipe instance. The **speak side is real too** (2026-09-21): Speak or Type has
a real Vosk microphone (`js/talk-speaking.js`, English-only model; Filipino disables
the mic) filling the text field, an explicit **Translate** button, and an in-place
word-by-word sign preview (`js/sign-player.js`) before Send; the preview is never
stored in the thread. **Since the talk-turns-audio phase (2026-10-19,
`docs/reports/2026-10-19-talk-turns-audio.md`):** the preview is avatar only (the
avatar fills the area under the top bar; since pi-fixes Translate = Send, then the avatar signs, then
Replay / Done; Stop on the mic flushes Vosk's final result), the confirm card is
gone (both Sends add the message directly and return to "Whose turn is it?"), the
Sign screen's main button is "Send 🔊" (recording starts by itself) and speaks the
message (each sign's recorded audio `saved_gestures/<key>/audio_en|audio_fil.<ext>`,
else the browser voice; 🔊 on each signed bubble replays/stops), "🗣 Speak or Type" /
"🤟 Sign instead" switch turns, and leaving a turn discards whatever was not sent
(owner change: only Send keeps a message). Sign audio is
recorded/uploaded in Train Gestures' sign details (`php/api/sign_audio.php`, admin
only). As of the 2026-09-25 saved-conversations
phase, every message added to the thread (signed, spoken or typed) and every
conversation end (End Conversation, the idle timeout, reload/tab-close) is
also fire-and-forget POSTed to `php/api/save_conversation.php`
(`js/talk-history.js`) into the `conversations`/`messages` tables — this never
blocks, delays or breaks the live conversation, and any failure is only a
`console.warn`. Past conversations are never read back from `talk.html`; since the
accounts-quiz phase they are read by `conversations.html` (a user sees their own, an admin all of
them) and still by `reports.html`'s Conversations tab (`php/api/conversations.php`, session-checked).
See `docs/system/BACKEND.md` and `docs/system/UI.md` Part 3.
**Accounts, history, quiz (accounts-quiz phase, 2026-10-18).** Everyone logs in on `login.html` (Log in /
Create account; Create account always makes a `user`), the PHP session is in `php/session.php`, and
`<script src="php/api/me.php">` tells a page who is logged in. The dashboard has 3 cards (Learn Signs, Let's
Talk, Quiz) and a name chip whose menu holds the user's lists and, for an admin, every admin tool (Train
Gestures, View Reports, Bulk import, Manage users = `users.html`, All conversations, Quiz results). Admin pages
send non-admins to the dashboard (`js/sk-account.js` `adminPage()`); there is no PIN any more (the admin role is
the only gate; admin APIs answer 403). Let's Talk
saves the logged-in user's id and a title and has "+ New conversation". `quiz.html` (Sign -> Text / Text -> Sign,
10 questions from signs with a clip, `php/api/quiz.php`) saves scores only for logged-in accounts
(`quiz-scores.html`). The training/import write endpoints are deliberately not session-checked (owner decision,
`docs/system/DEBT.md` item 157). See `docs/system/UI.md` Part 4 and `docs/reports/2026-10-18-accounts-quiz.md`.

Open it at `/SKR/talk.html`. `index.html` is now a **pure dashboard**: the old
`#translator-pane` (`?screen=voice`) and `js/script.js` were retired into this screen
and archived (`archive/script.js`, `archive/TEXT-TO-SIGN-PANE.md`).

## Where to read for what

| Working on... | Read |
|---|---|
| Any screen's UI, camera/translation flow, gesture training, admin/reports pages, or the new "Let's Talk" conversation screen (`talk.html`) | [docs/system/UI.md](docs/system/UI.md) |
| Accounts, login, conversation history, quiz, Manage users | [docs/system/UI.md](docs/system/UI.md) Part 4, [docs/system/BACKEND.md](docs/system/BACKEND.md) "Accounts, conversation history and quiz" |
| Settled design/build decisions for `talk.html` specifically (why a value was chosen, what an earlier task rejected) | [docs/system/DECISIONS.md](docs/system/DECISIONS.md) |
| PHP endpoints, MySQL schema, ffmpeg invocations | [docs/system/BACKEND.md](docs/system/BACKEND.md) |
| Setting up a Pi from scratch (`tools/pi/pi-setup.sh`, data transfer, VNC / DevTools debugging) | [docs/system/PI-SETUP.md](docs/system/PI-SETUP.md) |
| Kiosk boot, Chromium flags, Vosk speech model, Pi-specific constraints | [docs/system/HARDWARE_BOOT.md](docs/system/HARDWARE_BOOT.md) |
| MediaPipe/TF.js vendored libraries themselves | [docs/system/VENDORED.md](docs/system/VENDORED.md) |
| Where inference is actually called from (pointer only) | [docs/system/ML.md](docs/system/ML.md) |
| What Phase 1 deleted/archived, and why | [docs/system/DEAD_CODE.md](docs/system/DEAD_CODE.md) |
| Optional data gloves (two, 16-channel mux): serial protocol v2, the setup stored on the glove, `window.SKGlove`, Settings -> Glove + Set up glove, firmware 2.0 | [docs/system/GLOVE.md](docs/system/GLOVE.md) |
| Known bugs, security issues, inconsistencies, ranked | [docs/system/DEBT.md](docs/system/DEBT.md) |
| Full file-by-file inventory, load order, entry points | [docs/system/INVENTORY.md](docs/system/INVENTORY.md) |
| Phase proposals, investigation results, and final reports | docs/reports/ |

Every number in `docs/system/` is cited by file and line, or marked "not
specified in code" — trust those documents over this file's prose if they ever
disagree, and prefer them over re-reading the full codebase.
