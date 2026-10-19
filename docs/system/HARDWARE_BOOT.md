# Hardware / Boot Layer

## 1. Owns these files

- `start_kiosk.sh` (17 lines)
- `SKR_Kiosk.desktop` (9 lines)
- `models/vosk-model-small-en-us-0.15.tar.gz.zip` (41,138,088 bytes on disk)
- `models/knn_ESL.bin` (1,045,196 bytes) and `models/knn_FSL.bin` (723,096 bytes), the compiled recognition
  models, and `tests/compact-model/pi-bench.sh` (104 lines) — new 2026-10-15/16, see "Compact model files on
  the Pi" below
- `raspberry_pi_connection_guide.md` (2729 bytes)
- `raspberry_pi_startup_guide.md` (2856 bytes)

## 2. What it does

On the Raspberry Pi, a desktop entry (`SKR_Kiosk.desktop`) launches a shell script (`start_kiosk.sh`) that kills any leftover Chromium process, clears Chromium's singleton lock files, sets the X11 display, and starts Chromium in kiosk mode pointed at a fixed local URL served by the Pi's own web server. All console/error output is appended to a log file in the operator's home directory. Chromium is launched with flags that auto-approve camera/microphone permission prompts and enable local text-to-speech, so the kiosk can start unattended with no human clicking through browser dialogs.

Offline speech recognition is provisioned by shipping a pre-downloaded Vosk acoustic model archive (`models/vosk-model-small-en-us-0.15.tar.gz.zip`) inside the repo rather than fetching it at runtime; the in-page Vosk JS library (`js/vosk.js`, cross-referenced only) loads this local archive to run recognition entirely on-device.

The two connection/startup guide docs are operator runbooks (in Taglish) for SSH'ing into the Pi from a Windows laptop and for manually installing/testing audio (`speech-dispatcher`, `espeak-ng`) and manually launching Chromium from an SSH terminal — they are not executed by any script; they document a human procedure.

## 3. Local development

Phase 2.5 added a local development setup, run side-by-side with the Pi
deployment described above rather than replacing it:

- **Stack:** XAMPP (Apache + MySQL/MariaDB) on a Windows development machine.
- **Serving:** a directory junction at `C:\xampp\htdocs\SKR` points at the
  repo checkout, so Apache serves the same files tracked in git directly —
  one copy, no build/copy/sync step.
- **Database:** `sining_kamay_db` imported into the local MySQL/MariaDB
  instance (see `docs/system/BACKEND.md` for an encoding gotcha in one of the
  two tracked `.sql` dumps). **On a fresh machine, including a Pi running
  MariaDB on Bookworm, do not import either tracked `.sql` dump directly** —
  both are pre-normalization snapshots (2026-09-24 schema-normalization
  phase) and the current code no longer matches their shape. See
  `docs/system/BACKEND.md`, "Schema migration and fresh-machine setup
  (2026-09-24)", for the two supported setup routes.
- **URL:** http://localhost/SKR/ — deliberately the same `/SKR/` path
  segment `start_kiosk.sh:17` uses on the Pi (see Section 6).
- Confirmed working: camera capture and sign-to-text translation on
  `sign-to-text.html`, k-NN classifier loading all 120 ESL gestures, no
  console errors.
- Nothing in this section touches `start_kiosk.sh`, `SKR_Kiosk.desktop`, or
  the Vosk model — those remain Pi-only, unexercised by local development.

## 4. How it works (cited)

- Chromium launch, exact flags and URL — `start_kiosk.sh:17`:
  `chromium --kiosk --password-store=basic --use-fake-ui-for-media-stream --enable-speech-dispatcher --disable-accelerated-video-decode --enable-logging=stderr http://localhost/SKR/index.html >> "$LOG_FILE" 2>&1`
  Flags present, verbatim: `--kiosk`, `--password-store=basic`, `--use-fake-ui-for-media-stream`, `--enable-speech-dispatcher`, `--disable-accelerated-video-decode`, `--enable-logging=stderr`.
  Target URL: `http://localhost/SKR/index.html` (`start_kiosk.sh:17`).
- Process cleanup before launch — `pkill -9 chromium` (`start_kiosk.sh:3`), then `sleep 2` (`start_kiosk.sh:4`).
- Lock-file cleanup — `rm -rf /home/crystelle/.config/chromium/Singleton*` (`start_kiosk.sh:7`).
- DISPLAY env var — `export DISPLAY=:0` (`start_kiosk.sh:10`).
- Log file path — `LOG_FILE="/home/crystelle/kiosk_logs.log"` (`start_kiosk.sh:13`), header written with `echo "=== Kiosk Launch: $(date) ===" > "$LOG_FILE"` (`start_kiosk.sh:14`); Chromium's own stdout/stderr are appended to the same file (`start_kiosk.sh:17`).
- Desktop entry invocation — `Exec=/home/crystelle/start_kiosk.sh` (`SKR_Kiosk.desktop:5`), `Terminal=false` (`SKR_Kiosk.desktop:7`).
- Vosk model file — exact filename `vosk-model-small-en-us-0.15.tar.gz.zip`, 41,138,088 bytes as stored in the repo. Despite the `.zip` suffix, the `file`/gzip-header inspection shows this is actually gzip-compressed tar data (a `.tar.gz`), not a genuine ZIP container; the ungzipped tar contains a single top-level directory `vosk-model-small-en-us-0.15/` with subdirectories `am/` (contains `final.mdl`), `graph/` (contains `Gr.fst`, `HCLr.fst`, `disambig_tid.int`, `phones/word_boundary.int`), `ivector/` (`final.ie`, `final.dubm`, `final.mat`, `global_cmvn.stats`, `splice.conf`, `online_cmvn.conf`), `conf/` (`model.conf`, `mfcc.conf`), and a `README` — this is the standard Vosk small English model layout. Loaded from `models/vosk-model-small-en-us-0.15.tar.gz.zip` by `speech_test.html:54` (`modelUrl = window.location.origin + currentPath + '/models/vosk-model-small-en-us-0.15.tar.gz.zip'`); `index.html` loads the `js/vosk.js` library itself (`index.html:749`) but no reference to the model path was found in `index.html` in the scope reviewed.
- `js/vosk.js` constants (cross-reference only): sample rate is not a hardcoded constant — it is passed in as a `sampleRate` parameter to the `KaldiRecognizer` constructor (`js/vosk.js:291`, `js/vosk.js:300`) and forwarded per audio chunk (`js/vosk.js:325`, `js/vosk.js:338`); the caller (`speech_test.html:86`) supplies `this.audioContext.sampleRate` (the browser's `AudioContext` default), so no fixed sample-rate number is specified in `js/vosk.js` itself. No frame-rate, timeout, retry-count, or buffer-size constants were found in `js/vosk.js`.
- `js/camera-helper.js` constants (cross-reference only): `FEAT_W = 16`, `FEAT_H = 12` (`js/camera-helper.js:2-3`), a fixed 16x12 pixel sampling grid used only for a fallback landmark-feature extraction path (`js/camera-helper.js:54-68`), not a camera capture resolution. `initCameraWithFallback(idealWidth, idealHeight, ...)` (`js/camera-helper.js:6`) takes camera resolution as caller-supplied parameters — no default width/height is hardcoded in this file. No frame rate, timeout, or retry-count constants were found in `js/camera-helper.js`. (Note: callers of the same-named function in `camera-translator.html` — which defines its own local copy rather than loading `js/camera-helper.js` — pass `320, 240` as ideal width/height, e.g. `camera-translator.html:1128-1129` and `camera-translator.html:1592-1593`; this is a separate, out-of-scope file, cited here only because it shows the values this helper is actually called with elsewhere in the app.)

## 5. Key decisions and why

- `--kiosk`: full-screen, chrome-less browser window — standard for a public kiosk terminal. Reason not documented in code beyond the flag's standard Chromium purpose.
- `--use-fake-ui-for-media-stream`: auto-approves camera/microphone permission prompts instead of showing the browser's consent dialog — necessary because this is an unattended kiosk with no way for an operator to click "Allow" each boot.
- `--password-store=basic`: uses a plaintext/basic password backend instead of a system keyring — avoids Chromium blocking or prompting for keyring unlock on a headless/kiosk account. Reason not documented in code.
- `--enable-speech-dispatcher`: enables the OS `speech-dispatcher` TTS backend referenced in `raspberry_pi_startup_guide.md:23-24`, needed for the kiosk's text-to-speech output. Reason not documented in `start_kiosk.sh` itself.
- `--disable-accelerated-video-decode`: disables GPU-accelerated video decoding. Reason not documented in code.
- `--enable-logging=stderr`: routes Chromium's internal logging to stderr, which the script then redirects into `kiosk_logs.log` (`start_kiosk.sh:17`) — supports post-hoc debugging without a terminal attached (`Terminal=false`, `SKR_Kiosk.desktop:7`).
- `pkill -9 chromium` + `Singleton*` lock removal (`start_kiosk.sh:3,7`): forces a clean single-instance relaunch, working around Chromium's own single-instance lock that would otherwise block a fresh launch after a crash or unclean shutdown. Reason not documented in code beyond this evident mechanism.

## 6. Constraints

- `--disable-accelerated-video-decode` (`start_kiosk.sh:17`) turns off GPU video decode. The system brief states the target device is a Raspberry Pi 4B, CPU-only for inference; the code does not state why video decode accel is disabled, so the link to the Pi's GPU/driver limitations is plausible but "reason not documented in code."
- The Vosk model chosen is explicitly the "small" variant — filename `vosk-model-small-en-us-0.15.tar.gz.zip`. No comment in the repo states this choice was made because of the Pi's resource limits; per the accuracy rule this connection is not asserted as fact — "reason not documented in code." The only hard number available is the file's on-disk size, 41,138,088 bytes.
- No GPU-related TensorFlow.js constants, WebGL/WASM backend selection flags, or CPU-only inference settings appear anywhere in the files owned by this document (`start_kiosk.sh`, `SKR_Kiosk.desktop`, the guide docs); TensorFlow.js backend configuration is out of this document's scope (owned elsewhere per the audit's file assignment) and was not inspected here.
- No frame-rate, resolution, sample-rate, timeout, retry, or buffer-size constant tied explicitly to Pi hardware limits was found in `js/vosk.js` or `js/camera-helper.js` (see Section 4) — where the system brief's Pi specs might explain a design choice, the code itself is silent, so no such link is asserted here.
- `raspberry_pi_startup_guide.md:47,52` shows manually-run Chromium commands that omit `--use-fake-ui-for-media-stream`, `--password-store=basic`'s pairing, and `--disable-accelerated-video-decode` compared to `start_kiosk.sh:17` — i.e., the guide's manual fallback command is a reduced-flag version of the production script; this is a documentation/behavior gap between the guide and the actual boot script, not a Pi hardware constraint.

## 7. Touches

- Local development and the Pi now serve the app from the same `/SKR/` path
  (`http://localhost/SKR/` locally via the XAMPP junction described in
  Section 3, `http://localhost/SKR/index.html` on the Pi via
  `start_kiosk.sh:17`). Hardcoded `/SKR/`-relative paths in front-end JS (see
  `docs/system/DEBT.md` item 7) resolve the same way in both environments as
  a result.
- Boot depends on `index.html` existing at exactly the path baked into `start_kiosk.sh:17`: `http://localhost/SKR/index.html`. If `index.html` moves, is renamed, or the web server's document root changes, the kiosk boots to a browser error page with no fallback — this is a single point of failure with no retry or alternate-URL logic in the script.
- (Updated 2026-09-21: `index.html` no longer loads `js/vosk.js`; `talk.html` does, through `js/talk-loader.js`, and `js/talk-speaking.js` uses the model — the sentence below is otherwise as originally written.) `index.html:749` loads `js/vosk.js`, so removing or relocating `js/vosk.js` (or the `models/vosk-model-small-en-us-0.15.tar.gz.zip` file it/`speech_test.html` reference) breaks speech features but not the boot itself, since `start_kiosk.sh` has no dependency check — Chromium will still launch and load whatever HTML is at the URL.
- The desktop entry (`SKR_Kiosk.desktop:5`) hardcodes `Exec=/home/crystelle/start_kiosk.sh`; if the script is moved or the account is renamed, the desktop entry silently fails to launch anything.
- Hardcoded user-specific paths throughout `start_kiosk.sh` (`/home/crystelle/.config/chromium/Singleton*` at line 7, `/home/crystelle/kiosk_logs.log` at line 13) and `SKR_Kiosk.desktop:5` tie the entire boot flow to one specific Linux user account (`crystelle`); deploying to a different account or a fresh Pi image requires editing both files or boot fails / logs go to the wrong place.
- The two guide docs (`raspberry_pi_connection_guide.md`, `raspberry_pi_startup_guide.md`) reference a different deployment path convention than the current script: the guides' example Chromium commands target `http://localhost/Sining_kamay/` or `http://localhost/` (`raspberry_pi_startup_guide.md:47,52`) and their `scp` examples deploy files under `/var/www/html/Sining_kamay/` (`raspberry_pi_startup_guide.md:62,67,72,77,82`), whereas `start_kiosk.sh:17` targets `http://localhost/SKR/index.html`. These are inconsistent path conventions across the tracked files; which one reflects the current live deployment is not determinable from the code alone.
- Two-touchscreen claim: `start_kiosk.sh:17` launches exactly one `chromium` process against exactly one URL, with no second `DISPLAY` target, no second monitor/output configuration, and no second browser invocation anywhere in this script. No other tracked file inspected in this pass (`SKR_Kiosk.desktop`, the two guide docs) configures a second display or a second kiosk instance. Per the project owner's framing, this is treated as planned/future work, not a defect — documented here as an observation only: the "two touchscreens" capability described in the system brief is not yet reflected in the boot configuration in this repo.

## Problems found

- Hardcoded user-specific filesystem paths: `/home/crystelle/.config/chromium/Singleton*` (`start_kiosk.sh:7`), `/home/crystelle/kiosk_logs.log` (`start_kiosk.sh:13`), `/home/crystelle/start_kiosk.sh` (`SKR_Kiosk.desktop:5`).
- Single point of failure: the boot URL `http://localhost/SKR/index.html` (`start_kiosk.sh:17`) is not checked for availability before or after Chromium launch; no retry, no fallback page, no health check in the script.
- Single point of failure: `pkill -9 chromium` (`start_kiosk.sh:3`) unconditionally kills all Chromium processes for the invoking user with no scoping — could affect other Chromium instances if any existed under the same session.
- Path-convention mismatch between guide docs and script: guides describe `/Sining_kamay/` and `/var/www/html/Sining_kamay/` (`raspberry_pi_startup_guide.md:47,52,62,67,72,77,82`) while the actual boot script targets `/SKR/` (`start_kiosk.sh:17`) — undetermined from code which is current/authoritative.
- Filename/format mismatch: `models/vosk-model-small-en-us-0.15.tar.gz.zip` is named with a `.zip` suffix but is actually gzip-compressed tar data per direct inspection (not a real ZIP archive) — noted for accuracy, not assessed as a functional problem since `speech_test.html:54` treats it only as an opaque URL passed to the Vosk loader.
- Two-touchscreen gap: confirmed observation, not a bug per project owner's framing — `start_kiosk.sh:17` launches exactly one Chromium process against one URL; no second-display configuration was found anywhere in the tracked files reviewed for this document (`SKR_Kiosk.desktop`, `raspberry_pi_connection_guide.md`, `raspberry_pi_startup_guide.md`). Status: planned, not yet implemented in this repo.
- Guide docs describe a manual Chromium launch (`raspberry_pi_startup_guide.md:47,52`) with fewer flags than production `start_kiosk.sh:17` (missing `--use-fake-ui-for-media-stream`, `--disable-accelerated-video-decode`, `--enable-logging=stderr`) — if an operator follows the guide's manual command instead of the desktop entry, camera/mic prompts would not be auto-approved, contradicting the "unattended kiosk" design intent.
- Could not determine: whether `js/vosk.js`'s `sampleRate` parameter is fixed to a particular value anywhere at the call site inside `index.html` — the only concrete usage found in-repo is `speech_test.html:86`, which is outside this document's owned scope and was cited only in passing.
- Could not determine: any explicit statement in code tying `--disable-accelerated-video-decode` or the "small" Vosk model choice to Raspberry Pi hardware limits — plausible per the system brief but not asserted as fact per the accuracy rule; both are recorded as "reason not documented in code."
- Could not determine: the true uncompressed size or full internal audio-model parameters (e.g., MFCC config values, sample rate expected by the acoustic model) of the Vosk model beyond its directory/file listing, since fully unpacking/parsing `conf/mfcc.conf` etc. was outside the "inspect filename/structure only" instruction for this file.

## Avatar frame-rate bench on the Pi (avatar phase, 2026-10-05)

`tests/avatar/pi-bench.sh` (run on the Pi's desktop: `bash tests/avatar/pi-bench.sh [seconds]`) closes the kiosk
Chromium, opens `http://localhost/SKR/tests/avatar/bench.html` with `start_kiosk.sh`'s flags and a throw-away
profile, waits for the `AVATAR_BENCH {json}` console line in Chromium's `--enable-logging=stderr` output, prints it
and saves it to `~/avatar-bench-<date>.json`; then restart the kiosk from the desktop entry. The bench plays the
avatar at 560x260, capped at 30 fps then uncapped (signs with clips, else a synthetic movement). **Pi timing has
not been measured.** On this laptop: 29.9 fps capped, 59-60 fps uncapped (the display rate), 0.2-0.3 ms per
frame, with GPU and with `--disable-gpu` (the log parsing was checked with desktop Chrome).

## Compact model files on the Pi (compact-model phase, 2026-10-15/16)

Nothing here was run on the Pi (owner decision 10). Model, rule and laptop measurements: `docs/system/ML.md`
"Compact model".

- **The files.** `models/knn_ESL.bin` and `models/knn_FSL.bin` sit in `models/` next to the Vosk model and are
  tracked in git as binary (`.gitattributes:2`, `models/knn_*.bin binary`). The kiosk (Let's Talk) and Train
  Gestures Steps 3/4 load them from `models/knn_<LANG>.bin`, page-relative, i.e.
  `http://localhost/SKR/models/knn_<LANG>.bin`. They are built on the laptop (Train Gestures, Step 2 Compile) and
  are the only recognition data the Pi needs.
- **How the Pi gets them:** with the rest of the repo (`git pull`), or by copying the two files on their own into
  the Pi's `SKR/models/` (owner decision 9: an SSH copy is a later, separate task). The kiosk keeps a copy of each
  in Chromium's IndexedDB and sends one HEAD per load: a changed file (new ETag or length) is downloaded once,
  and a missing or broken file falls back to the stored copy, so the kiosk keeps the last good model. Apache's
  ETag also changes when only the mtime changes (a pull or a copy), which costs one download.
- **Samples.** The Pi does not need any sample to recognise. Bulk-imported samples are git-ignored
  (`saved_gestures/*/sample_i*.json`, `.gitignore:11`) and never reach the Pi through git. Samples recorded on
  the Pi are still saved, but they enter a model only after the laptop compiles.
- **Compile on the Pi is disabled.** `php/api/model_status.php` reports the device: `config/device.txt`
  (git-ignored, `.gitignore:10`) with `pi` or `laptop` wins, else `php_uname('m')` matching `aarch64` / `arm*`
  means the Pi (`php/api/knn_model_lib.php:52-64`). On the Pi, Train Gestures shows "Build the model on the
  laptop, then copy models/knn_ESL.bin and models/knn_FSL.bin to the Pi." with Compile disabled, never says "out of
  date", and `php/api/compile_model.php` answers 403. Not verified on the Pi: what `php_uname('m')` returns there.
  If it is wrong, write `pi` into `config/device.txt`.
- **`tests/compact-model/pi-bench.sh`** (run on the Pi's desktop: `bash tests/compact-model/pi-bench.sh`). It first
  checks that both model files exist next to the script's repo and exits without touching the kiosk if not
  (`:32-39`). Then, like `tests/avatar/pi-bench.sh`, it closes the kiosk Chromium, opens
  `http://localhost/SKR/tests/compact-model/bench.html` with `start_kiosk.sh`'s flags and a throw-away profile
  (the kiosk profile and its model cache are untouched), waits for the `COMPACT_BENCH {json}` line in Chromium's
  `--enable-logging=stderr` output, prints it and saves `~/compact-bench-<date>.json`. It gives up after 20 minutes
  or when Chromium exits, stops cleanly on Ctrl-C, and every exit after the kiosk was closed says to restart the
  kiosk from the desktop entry. The bench measures cold and cached loads of both files and `knnPredict` per call
  on both real models and on synthetic models of 2,047 / 9,164 / 10,196 / 14,140 / 24,007 / 89,887 rows (sizes
  stop once a median passes 1,000 ms). Compare `predict[].plain.median` with the 150 ms prediction tick; MediaPipe
  runs on the same CPU and is not in the bench. Run time on the Pi: not measured (67 s on the laptop). The script
  was exercised on the laptop with stubbed `chromium` / `pkill` (`.git/sdd/cm-task-7-report.md`); the Pi's log line
  format is not verified.
- **Line endings.** `.gitattributes:3` (`*.sh text eol=lf`) makes git check out every `.sh` with LF. This laptop's
  working copy of `start_kiosk.sh` is still CRLF (`git ls-files --eol`: `i/lf w/crlf`), so copy the scripts to the
  Pi from git, not from this working tree.
- **Git history.** Every recompiled model is a new binary blob in git (5,596,344 bytes for ESL at the
  3,000-sample scale check). Either accept the growth, or copy the two files to the Pi by hand and commit them
  less often (`docs/system/DEBT.md` item 139).

## One-command Pi setup (pi-setup phase, 2026-10-20)

`tools/pi/pi-setup.sh` sets up a fresh Bookworm Pi. It writes its own launcher, `~/.local/bin/sk-kiosk.sh`
(user-independent paths, `http://localhost/SKR/`), and starts it from labwc / wayfire / X11 autostart. The launcher
replaces `start_kiosk.sh` + `SKR_Kiosk.desktop`, which are left as they were (they hardcode `/home/crystelle`).

Data comes from the laptop through `tools/pi/export-from-laptop.cmd` / `tools/pi/import-on-pi.sh`. Step by step:
`docs/system/PI-SETUP.md`. Not run on a Pi yet: `docs/reports/2026-10-20-pi-setup.md`.
