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

## Run

Phase 2.5 (local development environment) is complete — the system runs
locally via XAMPP:

- **Stack:** XAMPP (Apache + MySQL/MariaDB).
- **Serving:** a directory junction at `C:\xampp\htdocs\SKR` points at this
  repo, so there is one copy of the files on disk — editing the repo edits
  what Apache serves, and vice versa. No file copying/syncing step.
- **Database:** import `sining_kamay_db` into the local MySQL/MariaDB instance
  (see `docs/system/BACKEND.md` for which `.sql` file to use — one of the
  tracked dumps needs encoding conversion first).
- **URL:** http://localhost/SKR/
- The local path (`/SKR/`) deliberately matches the path the Pi serves the
  kiosk from (`start_kiosk.sh` targets `http://localhost/SKR/index.html`, see
  `docs/system/HARDWARE_BOOT.md`), so hardcoded `/SKR/`-relative references
  behave the same in local dev as on the Pi.

Confirmed working locally: camera capture and sign-to-text translation on
`sign-to-text.html`, with the k-NN classifier loading all 120 ESL gestures and
no console errors.

`talk.html` is a new "Let's Talk" two-way conversation screen — UI only, fake
data, no camera/mic/DB yet (see `docs/system/UI.md` Part 3 and
`docs/system/DECISIONS.md`). It is not yet linked from the dashboard; open it
directly at `/SKR/talk.html`.

## Where to read for what

| Working on... | Read |
|---|---|
| Any screen's UI, camera/translation flow, gesture training, admin/reports pages, or the new "Let's Talk" conversation screen (`talk.html`) | [docs/system/UI.md](docs/system/UI.md) |
| Settled design/build decisions for `talk.html` specifically (why a value was chosen, what an earlier task rejected) | [docs/system/DECISIONS.md](docs/system/DECISIONS.md) |
| PHP endpoints, MySQL schema, ffmpeg invocations | [docs/system/BACKEND.md](docs/system/BACKEND.md) |
| Kiosk boot, Chromium flags, Vosk speech model, Pi-specific constraints | [docs/system/HARDWARE_BOOT.md](docs/system/HARDWARE_BOOT.md) |
| MediaPipe/TF.js vendored libraries themselves | [docs/system/VENDORED.md](docs/system/VENDORED.md) |
| Where inference is actually called from (pointer only) | [docs/system/ML.md](docs/system/ML.md) |
| What Phase 1 deleted/archived, and why | [docs/system/DEAD_CODE.md](docs/system/DEAD_CODE.md) |
| Known bugs, security issues, inconsistencies, ranked | [docs/system/DEBT.md](docs/system/DEBT.md) |
| Full file-by-file inventory, load order, entry points | [docs/system/INVENTORY.md](docs/system/INVENTORY.md) |

Every number in `docs/system/` is cited by file and line, or marked "not
specified in code" — trust those documents over this file's prose if they ever
disagree, and prefer them over re-reading the full codebase.
