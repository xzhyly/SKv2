# Hardware / Boot Layer

## 1. Owns these files

- `start_kiosk.sh` (17 lines)
- `SKR_Kiosk.desktop` (9 lines)
- `models/vosk-model-small-en-us-0.15.tar.gz.zip` (41,138,088 bytes on disk)
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
  two tracked `.sql` dumps).
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
