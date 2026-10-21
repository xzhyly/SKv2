Phase: pi-fixes (Raspberry Pi test findings, items 1-15)
Date: 2026-10-21
Status: DONE
Decision needed from owner: whether to vendor `js/lib/mediapipe/hand_landmark_lite.tflite` (item 9; without it the full hand model stays in use)

# Pi fixes — final report

Branch `pi-fixes` off `revision`, not pushed, not merged. Commits:

| Commit | Phase |
|---|---|
| `6ffe78e` | 1 — Pi setup (`tools/pi/`, `tests/avatar/pi-bench.sh`) |
| `3b65f16` | 2 — Sign turn camera |
| `e98e3d4` | 3 — Speak turn |
| `f1580f1` | 4 — favicon |
| (this docs commit) | report, `CLAUDE.md`, `docs/system/UI.md` 3h, `docs/system/PI-SETUP.md` troubleshooting |

Not touched: `docs/revision/MEMORY.md`, `docs/system/MANUAL-CHECKS.md` (your uncommitted edits are still
uncommitted), videos, `unzipping`, the database (no schema change, nothing dropped).

**What was measured here and what was not.** Everything below was checked on the laptop (XAMPP, the
Claude browser pane at 1024×600). The pane blocks camera and microphone, so the camera was a synthetic
30 fps canvas stream and the microphone a Windows-SAPI-synthesised English WAV (11.5 s) or a tone, fed
in place of `getUserMedia`. Nothing was run on the Pi: every Pi number in this report is still to be
measured with the steps under "How to test on the Pi".

---

## Phase 1 — Pi setup

### 1. Camera: `WebRtcPipeWireCamera` off
`tools/pi/pi-setup.sh:225` — the generated `~/.local/bin/sk-kiosk.sh` now passes
`--disable-features=Translate,WebRtcPipeWireCamera`.

### 2. Emoji font
`tools/pi/pi-setup.sh:56` — `fonts-noto-color-emoji` added to the apt package list.

### 3. Audio defaults on boot
New `tools/pi/sk-audio.sh`. Names and volume are the first lines of the script (`SINK_NAME="CD002-AUDIO"`,
`SOURCE_NAME="AB13X Headset Adapter"`, `SINK_VOLUME="0.75"`, `MAX_VOLUME="0.8"`); `~/.config/sk-audio.conf`
can override them without editing the tracked file. It reads `wpctl status` (Audio block only, Sinks /
Sources sections), takes the node id of the first line containing the name, waits up to 30 s for the
devices, then `wpctl set-default` both, unmutes the sink and sets its volume, clamped to `MAX_VOLUME`.
The launcher runs it in the background before Chromium starts (`pi-setup.sh`, launcher section), output
in `~/kiosk.log`. Checked on the laptop against a fake `wpctl` that prints a Bookworm-style status:
ids 52 / 53 picked, `0.95` in the config clamped to `0.80`.

### 4. pi-bench relaunches the kiosk
`tests/avatar/pi-bench.sh:43-52` — an `EXIT` trap runs exactly the command you gave
(`rm -f /tmp/sk-kiosk.lock`, then `nohup env DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) bash ~/.local/bin/sk-kiosk.sh …&`),
also when the bench produced no result.

### 5. Two "Sining Kamay Kiosk" tabs
I could not reproduce this (no Pi here), so these are the causes found in the code, each closed:

1. **Session restore.** The kiosk is always ended by `pkill`, so Chromium marks the profile as crashed.
   With "continue where you left off" (or a restore) the next start opens the old tab *and* the
   `--kiosk` URL: two tabs with the same title. Fixed three ways: policy `"RestoreOnStartup": 5`
   (`pi-setup.sh:158`), the launcher marks the profile cleanly closed (`exited_cleanly` / `exit_type`)
   before each start, and `--hide-crash-restore-bubble`.
2. **Several autostarts.** pi-setup wrote labwc's autostart, wayfire's `[autostart]` and an XDG
   `~/.config/autostart/sk-kiosk.desktop`; the labwc / wayfire sessions also run XDG autostarts. Now
   exactly one is written, for the session in `/etc/lightdm/lightdm.conf` (`pi-setup.sh:256-261`), the
   other two are removed, and old `start_kiosk.sh` / `SKR_Kiosk.desktop` / `chromium --kiosk` autostarts
   (no lock at all) are renamed `*.disabled-by-pi-setup` or commented out (`pi-setup.sh:237`).
3. **The lock lived in Chromium.** The old launcher `exec`'d Chromium, so the `flock` was held by
   Chromium's fd. Now the launcher shell keeps it (`flock -w 10`, `pi-setup.sh:197`), Chromium gets
   `9>&-` (`pi-setup.sh:226`), and before starting the launcher waits up to 10 s for an old kiosk Chromium
   to exit (then SIGKILL): a new Chromium started while the old one shuts down can hand its URL to the
   old process as a second tab. `sk-kiosk.sh --restart` closes the running kiosk first.

Each launcher run writes `=== kiosk <date> pid N started by: <parent command>` to `~/kiosk.log`, so if
it still happens the log shows which autostart fired twice.

### 6. Hardware notes
New `tools/pi/README.md`: file list, "Pi hardware notes" (power-on order hub/LCDs before Pi, speaker on
the Pi's own USB port, volume ≤ 0.8, splitter EDID and the forced `video=HDMI-A-1:1024x600@60D`),
`sk-audio.sh` configuration, restarting the kiosk from SSH, and checking for a single tab.
`docs/system/PI-SETUP.md` troubleshooting links to it.

---

## Phase 2 — Sign turn camera

### 7. Load order
Old behaviour (code, not the order you saw): the queue was sign libs → MediaPipe → k-NN → Vosk lib →
Vosk model, and the Guide's "Start Translating" waited for the **whole** queue, so the camera always
came after the Vosk model (`refreshGates()` used `TalkLoader.getProgress()` over all 5 items).

Now `js/talk-loader.js` has two queues:
- **Sign stack** at page load: libraries → MediaPipe (+ one warm-up frame, below) → k-NN. The Guide
  waits for this only.
- **Speech stack** (Vosk) via `TalkLoader.startSpeech()` (`talk-loader.js:163`), called by talk.html's
  `maybeStartSpeech()` (`talk.html:1757`) when the sign stack is done and the camera is not starting
  (who-first, thread, after the camera is live via `onLive`, `talk.html:2038`), and at once when
  Speak or Type opens. Speak or Type no longer shows "Getting ready…": typing works at once, the mic
  label says "Inihahanda ang mikropono… / Getting the mic ready…" until the model is there.
- Everything stays loaded for the page's life (models, k-NN, the one MediaPipe instance); only the
  camera hardware is released between turns, as before.

**Warm-up frame.** With the synthetic camera, the first MediaPipe result came ~880 ms after the first
video frame (console: first frame 818 ms, ready 1696 ms, the fake `getUserMedia` itself waits 800 ms).
`preloadMediaPipe(video, { warmUp: true })` (`js/gesture-data.js:537-559`, called at
`talk-loader.js:71`) runs one blank frame during loading; afterwards ready came 35-41 ms after the
first frame (820→861 ms and 812→847 ms, first and second Sign turn).

### 8. Loading overlay
`js/talk-signing.js` `enter()`: overlay with spinner and "Inihahanda ang camera… / Please stand by"
(`talk-signing.js:33`); Send, Undo, Clear and "Speak or Type" disabled. `waitUntilReady()`
(`talk-signing.js:401`) hides it only when the first video frame was presented
(`requestVideoFrameCallback`) **and** MediaPipe returned its first result after resume; then
`finishLoading()` (`:387`) starts the "Starting in 3…" countdown. If MediaPipe never answers, it goes on
after `READY_TIMEOUT_MS` 10 s (`:32`) with a console warning, so the turn is never stuck (seen in the
hidden-pane run: "no MediaPipe result after 10000 ms: starting anyway"). Measured with the synthetic
camera: overlay shown and buttons disabled at 201-1027 ms, countdown "Starting in 3…" from 1918 ms.

### 9. Frame rate
`js/gesture-data.js` `setLoopOptions({ detectEvery, modelComplexity })` (`:496`) and a
`requestVideoFrameCallback` loop (`onVideoFrame`, `:414`): with `detectEvery` N > 1 the loop waits for
real camera frames and sends only every Nth to MediaPipe, so MediaPipe no longer occupies the main
thread back to back; the `<video>` itself plays at the camera's rate. talk.html uses N = 2
(`talk-loader.js:31`; `?detectEvery=3` to try 3). Other pages keep the defaults (`detectEvery` 1 =
the old rAF loop, full model).

Lite model: MediaPipe loads `modelComplexity` 0 from `js/lib/mediapipe/hand_landmark_lite.tflite`, which
is **not vendored** (only `hand_landmark_full.tflite` is). So talk.html uses the full model (1) by default:
`LITE_MODEL_VENDORED = false` (`talk-loader.js:32`). (Correction, same day: a first version checked the
file with a HEAD request; its 404 was a console error on every load and broke the "0 console errors"
checks, so it was removed.) I did not download the file (offline rule / your call). To enable it: copy
`hand_landmark_lite.tflite` from the same MediaPipe Hands package as the other files (`0.4.1675469240`,
`docs/system/VENDORED.md`) into `js/lib/mediapipe/`, then set `LITE_MODEL_VENDORED = true`
(`?complexity=0` / `=1` overrides for a test). The recognition model was compiled from full-model
landmarks; check recognition with the lite model before relying on it.

Debug overlay `talk.html?devperf`: video fps, detection ms/frame, detection fps, every second over the
camera and every 5 s in the console (`[perf] …`). Laptop, synthetic 30 fps camera:
`video 29.9 fps | detect 19 ms/frame | detect 14.9 fps (1 of 2, model 1)`.

### 10. `console.time` markers
`[load] Sign libraries …`, `[load] MediaPipe Hands model`, `[load] Gesture set (ESL)` (k-NN),
`[load] Vosk library`, `[load] Vosk model (en-US)`, `[load] camera: first frame`,
`[load] camera + MediaPipe ready`. Laptop example (warm cache): 70 / 202 / 114 / 1 / 1118 ms;
camera first frame 820 ms (800 of them the fake getUserMedia), ready 861 ms.

---

## Phase 3 — Speak turn

### 11. Realtime STT
Partials are shown live and each Vosk final chunk is committed at a pause (as before); the field now
scrolls to the newest words. Test: 11.5 s synthesised sentence, 27 field updates while it played,
partial text visible from 1.6 s; final transcript: "Hello my name is maria I would like to ask where the
nearest hospital is because my friend is feeling very sick today thank you very much for your help."

### 12. Stop flushes
`stopCapture()` (`js/talk-speaking.js:354`): the recognizer is removed first (the vosk worker then
answers every chunk still queued and finally `FinalResult()`), then the mic closes. The last answer is
recognised by count (`answers >= chunksSent + 1`, `:264`). "Processing…" shows, and the mic, EN/FIL,
the field, Translate and "Sign instead" are disabled, only if speech was heard (text, or a chunk above
`SPEECH_RMS` 0.02, `:35`). It ends on the final text, on an empty result ("Walang narinig, subukan ulit",
`:39`) or after `FLUSH_TIMEOUT_MS` 4 s (`:34`, then the text so far incl. the partial). Leaving the
screen during Processing drops it. Tests: Stop at 5.0 s mid-sentence → field at Stop "…where the
nearest", after the flush "…where the nearest hospital." (173 ms); Stop after the full sentence → 106 ms;
silent input → hint at once, no Processing; a loud tone (heard, no words) → Processing, then the hint.

### 13. Delay after speaking
Measured (laptop, pane): the Vosk worker needs 1.8 s (silence) to 4.1 s (tone) to decode 3 s of audio,
at 16 kHz and at 48 kHz alike (3.0 s vs 2.8 s for noise). So the 3-4 s delay is the worker's backlog,
not the end-of-speech silence. Done:
- **Silence gate** (`talk-speaking.js` onaudioprocess, `QUIET_RMS` 0.006 / `KEEP_QUIET_CHUNKS` 6,
  `:36-37`): after ~0.77 s of quiet the rest of a pause is not sent (one chunk is kept as pre-roll), so
  the worker catches up while nobody speaks. With it, Stop → final text was 106-173 ms in the tests above.
- 16 kHz mono capture (`SAMPLE_RATE`, `:32`, AudioContext `sampleRate` with a fallback, `openAudio`
  `:163`), 128 ms chunks. Measured no decode-speed gain on the laptop; kept because it is a third of the
  data per message to the worker.
- No camera / MediaPipe in Speak turn: already true (leaving Sign stops the tracks and pauses the loop).
- Not possible in code: Vosk's own end-of-speech silence (`endpoint.rule2/3` in the model's
  `conf/model.conf`, inside the model zip) is not exposed by this `js/vosk.js` build. Changing it means
  editing the model zip and renaming it (the worker caches by URL): not done.

### 14. Flow
talk.html: Translate = Send — it adds the message (typed or spoken source, as before) and starts the
avatar. The Edit and Send buttons are gone; editing is only possible before Translate. While the avatar
signs, the preview actions are hidden (`talk.html:930`) and the caption highlights the current word
(sign-player, unchanged); when it finishes, Replay and Done appear (`playPreview()`); Done
(`#speaking-done`) returns to "Whose turn is it?". No audio on the Speak turn (unchanged). Tested:
"hello thank you" → 1 bubble at once, field emptied, no buttons while playing, Replay / Done after,
Done → thread.

---

## Phase 4

### 15. Favicon
`assets/favicon.svg` (the orange SK badge) and `<link rel="icon" … href="assets/favicon.svg">` in all 14
root pages. `curl` → 200 `image/svg+xml`.

---

## Laptop (XAMPP) behaviour
Unchanged except the talk.html changes above (they apply on the laptop too). Train Gestures, bulk
import and the other MediaPipe users keep `detectEvery` 1 and the full model. Not opened in the browser:
gesture-training.html is admin-only and I had no admin login, so only its default path was reasoned
about, not clicked.

## Known follow-ups
- ~~Old-flow checks~~ updated the same day (Translate = Send → Done instead of Edit / Send), see
  "Checks updated" below.
- The lite hand model file (decision above).

## Checks updated (follow-up, 2026-10-21)

| Check | Change | Run here |
|---|---|---|
| `tests/talk-turns-audio/talk-check.mjs` | A: the message is in the conversation at Translate, field emptied, no buttons while signing, then Replay / Done; B: Done → thread → Speak or Type instead of Edit, Done instead of Send, message present once; last part: Back while signing keeps the message, drops the preview | not run (Playwright not installed) |
| `tests/accounts-quiz/e2e-check.mjs`, `tests/accounts-quiz/talk-layout-check.mjs` | Translate, then `#speaking-done` (Playwright waits for it to become visible after the avatar) | not run (Playwright not installed) |
| `tests/avatar/talk-avatar-check.mjs` | Done + Speak or Type between sentences; `TalkHistory.saveMessage` stubbed (Translate now saves); the "nice" check accepts letter clips, which exist locally now (`saved_gestures/n,i,c,e/avatar.json`) | **26 PASS, 0 FAIL** (screenshots it rewrites in `docs/reports/img/` restored) |
| `tests/sign-texts/verify-e2e.mjs` | Done + Speak or Type between sentences; save stubbed | Sign turn, the 5 Speak sentences and both "0 console errors" PASS; 6 FAIL on its fixed 2026-10-04 data counts (expects 122 gestures, the DB has 164) and the old migration verify: not this phase |

The `tests/video-capture/*` "Starting camera…" texts are Train Gestures' capture overlay
(`js/gesture-capture-ui.js`), which this phase did not change.

---

## How to test on the Pi

First: `cd ~/SKv2 && git fetch && git checkout pi-fixes` (or pull after you merge), then
`bash tools/pi/pi-setup.sh --dev` (it rewrites the launcher and autostart), `sudo reboot`.

| # | Check |
|---|---|
| 1 | Let's Talk → Sign: the picture appears. `grep -c WebRtcPipeWireCamera ~/.local/bin/sk-kiosk.sh` → 1. |
| 2 | Emoji (🔊 🤟 🎤) show as pictures, not boxes. `dpkg -s fonts-noto-color-emoji` → installed. |
| 3 | After boot: `grep sk-audio ~/kiosk.log` shows the speaker and mic ids; `wpctl status` has `*` on `CD002-AUDIO` and on `AB13X Headset Adapter`, sink volume 0.75. Unplug/replug the speaker, `bash ~/SKv2/tools/pi/sk-audio.sh` again → found under the new id. Set `SINK_VOLUME=0.95` in `~/.config/sk-audio.conf` → log says clamped to 0.80. |
| 4 | Over SSH: `bash tests/avatar/pi-bench.sh` → at the end "Kiosk relaunched", the kiosk is back on the LCD. |
| 5 | After a reboot: `grep -c '=== kiosk' ~/kiosk.log` grew by exactly 1; `chrome://inspect` (via `ssh -L 9222:localhost:9222`) lists one "Sining Kamay Kiosk". Then restart from SSH with `--restart` (tools/pi/README.md) two or three times: still one tab. `pi-setup.sh` output names the session and the one autostart file. |
| 6 | Read `tools/pi/README.md` "Pi hardware notes" against the wiring. |
| 7 | DevTools console on talk.html: `[load] …` lines; the Vosk lines come after the sign stack, and not while the camera overlay is up. |
| 8 | Sign turn: overlay with spinner and "Inihahanda ang camera… / Please stand by"; Send / Undo / Clear / Speak or Type greyed; the countdown starts only after the overlay goes. Note the two `[load] camera …` times. |
| 9 | Open `http://localhost/SKR/talk.html?devperf`: note video fps / detect ms / detect fps in the Sign turn (target: video near the camera's 30 fps). Compare `?devperf&detectEvery=3`. `uptime` load average during the turn. If you add the lite model file, the overlay line says `model 0`; check recognition still works. |
| 10 | Console timers as in 7 / 8. |
| 11 | Speak turn: talk 10+ s without stopping; words appear while you speak and stay visible at the right end of the field. |
| 12 | Tap Stop while still talking: "Processing…", buttons grey, then the text including the last words. Tap the mic and Stop without speaking: "Walang narinig, subukan ulit", no Processing. It never stays on Processing longer than 4 s. |
| 13 | Time from the end of your sentence + Stop to the text: should be well under the old 3-4 s; if not, note the time and `uptime`'s load average for the next round. |
| 14 | Type or say a sentence → Translate: the bubble is in the conversation at once, the avatar signs with the current word highlighted, no buttons meanwhile; then Replay / Done; Done → "Whose turn is it?". No sound. |
| 15 | No favicon 404 in the console; the tab icon (DevTools target list) is the orange SK. |
