Phase: Let's Talk turns, sign audio, avatar-only playback (talk-turns-audio)
Date: 2026-10-19
Status: DONE
Decision needed from owner: none required; four points to confirm in section 6.

# Let's Talk turns, sign audio, avatar-only playback — report

Spec `docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md`; wireframes `docs/design/talk-flow-wireframe.html`
and `docs/design/sign-audio-wireframe.html` (screens and Rules). Branch `accounts-quiz`, two commits (code `b548745`, then
these docs), pushed, not merged. Unchanged, as the spec requires: recognition (the k-NN tick, filter and debounce in
`js/talk-signing.js`), compile and the model files, the avatar renderer/retarget/timeline, Vosk, the conversation save
format (`js/talk-history.js` gets exactly the same fields; only who calls it changed) and accounts/quiz behaviour (scores,
saving, screens). No `saved_gestures/` data was changed and no video file was deleted (section 4).

**What was run here:** a cloud container (no laptop, no XAMPP): PHP 8.3 built-in server serving the repo at `/SKR/`,
`php-cgi`, MariaDB 10.11 (`database_setup.sql` + the accounts-quiz migration, `gestures` filled from the repo's 122
`sign.json` files), node 22, Playwright 1.56 Chromium at 1024x600 with a fake camera and microphone. This clone has
**no `avatar.json` at all**, so the browser checks serve avatar clips by request interception, built from the committed
Holistic fixture (`tests/avatar/fixtures/holistic-signs.json`), as the accounts-quiz phase did. Nothing was written into
`saved_gestures/` except by tests that remove it again.

## 1. Priority bug: "hi" played the old human videos

Reproduced before the change (`talk-audio-before-4-hi-video.png`): typing "hi" in Speak or Type and tapping Translate
requested, in this order (network log):

```
assets/signs/en/hi.webm      404 (probe for a video named after the word; 2 console errors)
assets/signs/en/hi.webm      404
assets/signs/en/h.webm       played (fingerspelling with the human letter videos)
assets/signs/en/i.webm       played
```

Cause: `js/sign-player.js` was a port of `archive/script.js`'s video pipeline — a probe for
`assets/signs/<lang>/<word>.webm`, a hard-coded word -> `.webm` map, fingerspelling with `<letter>.webm`, and
`fallback.png`. Only words whose sign had an `avatar.json` went to the avatar.

**Now** (`js/sign-player.js` rewritten, avatar only):
- A word or phrase whose sign has avatar data (`signs.php` `avatar: true`) plays that sign; the longest phrase wins.
- Any other word is fingerspelled **by the avatar** with the letter signs a-z (`saved_gestures/<a-z>/avatar.json`) and the
  number signs: a number 1-10 is one sign, other numbers are spelled digit by digit ("25" -> 2, 5). A number sign is the
  key `"3"` if such a sign exists, else the English word key (`three`) — the repo's number signs are `one` ... `ten`.
- A character with no clip (or no sign, e.g. `0`, `ñ`) appears in the caption only, highlighted for 0.7 s, avatar at rest.
- The whole sentence is one continuous movement on the avatar (one `AvatarPlayer.play()` per run of playable units).
- The word -> `.webm` map, the `assets/signs` probes, video fingerspelling, `fallback.png` and every `<video>`/`<img>` are
  gone from the file (`tests/sign-texts/talk-texts.test.mjs` fails if any of them comes back).

Network log after (`tests/talk-turns-audio/talk-check.mjs`, avatar data served for the letters):

```
while "hi" played: saved_gestures/h/avatar.json, saved_gestures/i/avatar.json
whole run (Let's Talk, both turns, Learn Signs, Quiz): 84 requests, 0 .webm / .mp4 / fallback.png
```

and against this clone's real data (no `avatar.json` anywhere, no interception): **0 requests** while "hi" plays, the
caption shows H I, 0 console errors, 0 of 46 page requests are video.

**Learn Signs** (`learn-signs.html`) is the external website in an iframe (`DEBT.md` item 29); it has no local video path,
so there was nothing to remove there (the check opens it and sees no video request). **Quiz:** `php/api/quiz.php` now pools
only signs with an avatar clip (the video fallback `quiz_video_for()` is removed) and `js/quiz-ui.js` has no video branch.

## 2. What changed, by spec section

| Spec | Done |
|---|---|
| 1 Turns: Sign screen "🗣 Speak or Type", Speak/Type "🤟 Sign instead" | `talk.html`: `#sign-to-speak-btn` in a row with Guide (110 px) under Send; `#speak-to-sign-btn` under the input row. Both call `showScreen()` directly (camera / mic released and taken as before). Dashed orange outline, so each screen keeps its one orange fill. |
| 1 Unsent signed sentence kept | `js/talk-signing.js` keeps `words` and their sign `keys` through `leave()` (shortcut, Back) and a language switch (shown again in the new language from the keys). Cleared only by Send and by `+ New conversation` (`TalkSigning.clearDraft()`, or the page reload when the conversation has messages). |
| 1 After every Send -> "Whose turn is it?" | Both Sends end with `showScreen('thread')`; that screen is unchanged. |
| 2 PWD: "Send 🔊" replaces Translate / Stop & Add | Recording starts by itself (the same 3 s countdown) once the camera runs; the "start" sign still works; Send is enabled as soon as the sentence has a word (also during the countdown, for a kept sentence). Send or the "stop" sign adds the message at once (no popup). |
| 2 Auto-speak, recorded audio per sign, browser voice fallback, skip without voice | `js/sign-audio.js`: per sign in order, its recording for EN/FIL (`signs.php` `audio`), else the browser voice — consecutive signs without a recording as **one** utterance so they sound like a phrase; no voice at all -> skipped silently; a recording that fails to play is read by the voice. |
| 2 🔊 on each signed message: replay / stop; one at a time | Each signed bubble's icon is a 44 px button; tap = replay, tap while playing = stop; "· playing…" on its label, a "🔊 Speaking: …" toast; a new message stops the previous one. |
| 3 Avatar fills the area under the top bar, caption highlights word/letter, Replay / Edit / Send | 1000x486 canvas at (12, 102), the conversation strip hidden while it shows; caption bar over the bottom edge: the sentence (words; fingerspelled words as letter boxes, current one orange) with "Spelling “Jose” (no sign yet) · letter 2 of 4" / "Word 2 of 3", and Replay / Edit / Send. |
| 3 Send adds directly; "You said … / Add to Conversation" removed | The confirm card (`renderConfirmModal`, its CSS, modal kind `confirm`) is removed; Send adds the message, shows "✓ Sent" and returns to "Whose turn is it?". Edit = back to the text. |
| 4 Avatar only in Let's Talk, Learn Signs, Quiz | Section 1. |
| 5 Audio files | `saved_gestures/<key>/audio_en.<ext>` / `audio_fil.<ext>`, one per language (an upload replaces any other extension). webm, mp3, m4a, wav, ogg, at most 2 MB; the format is read from the file's first bytes, not from its name. Letters: English only (enforced by the API and the page). `signs.php` GET adds `audio: {en, fil}` (URL with `?v=<mtime>` so a re-recording is never served from cache, or null). |
| 5 Admin UI | Train Gestures -> View Active Gesture Dataset -> Edit (the existing sign details): an **Audio** section with one row per language the sign uses — ▶, ● Record (MediaRecorder, "● REC 0:02" + ■ Stop, max 10 s), then the new take with ▶ / Save / Discard (nothing is uploaded until Save), ⇪ Upload, ✕ Delete. The list gets an **Audio** column: "🔊 EN · FIL", "🔊 EN" or "—". No new page; avatar-clips untouched. |
| 5 API admin only, reading public | `php/api/sign_audio.php` (POST upload / delete) calls `sk_require_admin()` (403 for a guest or user). Files are read as static files. |

## 3. Measured (1024x600)

| Screen | Measured |
|---|---|
| Sign | Send 60 px; Speak or Type + Guide row 52 px (Guide 110 wide); camera unchanged (648x486 first turn); no scroll |
| Speak or Type, first turn | "Sign instead" 320x52 under the input row; no scroll |
| Speak or Type, later turn | "Sign instead" ends at y 592 (thread strip above); keyboard up: it stays above the keyboard; no scroll |
| Avatar preview | frame and canvas 1000x486 at (12, 102); strip hidden; buttons 130 / 130 / 150 x 56; no scroll |
| Whose turn is it? | unchanged; no scroll |
| Train Gestures sign details | card fits 0..600 with the Audio section (two rows) |
| Avatar draw time (this container's software Chromium) | 560x260: 1.3 ms median / 1.7 p95; 1000x486: 1.8 / 2.6 ms per frame (budget at 30 fps: 33 ms). **Pi not measured** (`tests/avatar/pi-bench.sh`). |

**Console errors: 0** on talk.html (every step above), Train Gestures (record, upload, play, delete) and in the existing
checks (below).

## 4. Video files: not deleted

The spec says the asset files are deleted only when nothing references them. Still referencing `assets/signs/`:
`php/api/save_gesture.php` (writes each new word's first recording there as `<label>.mp4`/`.webm`),
`php/api/reports.php` (lists them), `db-schema/migrations/2026-09-24-backfill-asset-path.php`,
`tests/compact-model/kiosk-check.mjs` / `tests/video-capture/*` (fake camera fed from `hello.webm`) and the avatar fixture's
source videos. So `assets/signs/**` stays. No page that shows signs to a user requests it any more.

## 5. Tests

**Node suites (`node --test tests/*/*.test.mjs`, php-cgi, live DB):**

| | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Before (baseline, this branch at `0564f15`) | 429 | 387 | 5 | 37 |
| After | 440 | 398 | 5 | 37 |

The 5 failures are the same ones before and after, the Windows-only ones the accounts-quiz report lists:
`multi-sample/save-endpoint` 4 (its ffmpeg stub is a `.bat` file) and `bulk-import/save-import` 1. Changed on purpose
because they asserted the removed behaviour: `tests/accounts-quiz/quiz-api.test.mjs` (the pool is avatar only: a sign with
only a video is out), `tests/sign-texts/talk-texts.test.mjs` (the sign-player part rewritten against `SignPlayer.plan()`:
avatar sign, fingerspelling, numbers, "?", one avatar run, no media element, no `.webm` in the code),
`tests/sign-texts/signs-endpoint.test.mjs` (GET also has `avatar` and `audio`). New:
`tests/talk-turns-audio/sign-audio.test.mjs` 5/5 (order, grouping, failed recording -> voice, no voice -> silent, stop),
`tests/talk-turns-audio/sign-audio-endpoint.test.mjs` 4/4 (403 for guest and user; all 5 formats; sniffed extension;
replace; refusals: not audio, > 2 MB = 413, no file, bad lang, unknown sign, `../`, Filipino for a letter; delete one
language; samples / sign.json / avatar.json byte-identical).

**Browser checks (Playwright Chromium, 1024x600):**

| Check | Result |
|---|---|
| `tests/talk-turns-audio/talk-check.mjs` (new) | 38/38: everything in sections 1-3 for Let's Talk, plus Learn Signs and Quiz without video |
| `tests/talk-turns-audio/train-audio-check.mjs` (new) | 20/20: guest sent away + 403; Audio column; letter English only; record -> take -> ▶ (blob) -> Save -> `audio_fil.webm`; upload WAV -> `audio_en.wav` (shows 0.5 s); ▶ saved; 🔊 EN · FIL in the list; ✕ one language; files removed, the sign's other files unchanged |
| `tests/accounts-quiz/e2e-check.mjs` | 87/87 (same count as the accounts-quiz report). Updated: Send no longer has a card to confirm; the quiz pages answer the pool as if every sign except the number signs had an avatar clip (this data has none), Watch / Text -> Sign posters checked on the avatar canvas |
| `tests/accounts-quiz/talk-layout-check.mjs` | ALL PASS. Updated: the last row is Speak or Type + Guide; waits for the automatic recording start |
| `tests/sign-texts/talk-check.mjs` | ALL CHECKS PASSED. Updated: text-to-sign read from `SignPlayer.plan()` (fingerspelled here: no avatar data), no `<video>` |
| `tests/sign-texts/reports-keyboard-check.mjs`, `xss-check.mjs`, `step1-check.mjs` | all pass, unchanged |
| `compact-model/kiosk-check`, `training-check`, `avatar/talk-avatar-check` | cannot run here (need the Windows `ffmpeg.exe`), as in the accounts-quiz report |
| `avatar/import-check`, `sign-texts/verify-e2e` | laptop only (owner's files under `C:/Users/...`, `E:/ACADSS/...`) |

`avatar/talk-avatar-check`, `avatar/import-check` and `sign-texts/verify-e2e` were edited where they read removed elements
(`#speaking-sign-word`) or asserted the video fallback / the confirm card; those edits are **not run here** — please run
them on the laptop (section 7).

## 6. Points for the owner to confirm

1. **Recording starts by itself.** The spec replaces Translate with Send, so nothing else starts a recording: the 3 s
   countdown now starts as soon as the camera runs (the "start" sign still works if it is ever idle). The Guide text
   (Tagalog) was updated to say so and to name "SEND 🔊". Tell me if you would rather keep a start button.
2. **Filipino fingerspelling uses the letter signs a-z** (they are ESL signs in the data; there are no separate FSL letter
   signs). Audio for letters is English only, as the spec says.
3. **Number signs:** the spec writes `<1-10>/avatar.json`; the repo's number signs are `one` ... `ten`. Both work: a
   folder named `3` is used if it exists, else `three`.
4. **Quiz needs avatar clips now.** With the video fallback gone, a category whose signs have no `avatar.json` shows "No
   signs with an avatar clip in …" and Start stays disabled (on this clone that is every category, because it has no
   `avatar.json`; on the laptop it depends on which clips you made). This replaces DEBT 160/161.

## 7. Screenshots (1024x600)

Before:

| | |
|---|---|
| Whose turn is it? | ![](img/talk-audio-before-0-whose-turn.png) |
| Sign (Translate) | ![](img/talk-audio-before-1-sign.png) |
| Speak or Type | ![](img/talk-audio-before-3-speak-type.png) |
| "hi" -> human letter video h.webm (the bug) | ![](img/talk-audio-before-4-hi-video.png) |
| "You said … / Add to Conversation" popup | ![](img/talk-audio-before-5-you-said-popup.png) |
| Train Gestures list | ![](img/talk-audio-before-6-train-list.png) |
| Train Gestures sign details | ![](img/talk-audio-before-7-train-details.png) |

After:

| | |
|---|---|
| Sign: Send 🔊, 🗣 Speak or Type, Guide | ![](img/talk-audio-after-1-sign.png) |
| Back from Speak or Type: unsent sentence restored | ![](img/talk-audio-after-1b-sign-restored.png) |
| PWD Send: added at once, spoken, 🔊 playing | ![](img/talk-audio-after-2-sent-speaking.png) |
| Speak or Type: 🤟 Sign instead | ![](img/talk-audio-after-3-speak-type.png) |
| Speak or Type, later turn | ![](img/talk-audio-after-3b-speak-type-later-turn.png) |
| "hi": avatar fingerspells H I, full area | ![](img/talk-audio-after-4-avatar-spells-hi.png) |
| "Hello Jose 25 3": letter 2 of JOSE highlighted | ![](img/talk-audio-after-4b-avatar-spells-jose.png) |
| Non-PWD Send: ✓ Sent, no popup | ![](img/talk-audio-after-5-sent.png) |
| Train Gestures list: Audio column 🔊 | ![](img/talk-audio-after-6-train-list.png) |
| Sign details: Audio section | ![](img/talk-audio-after-7-train-details.png) |
| Recording | ![](img/talk-audio-after-7b-train-recording.png) |
| New take: ▶ / Save / Discard | ![](img/talk-audio-after-7c-train-take.png) |
| Saved (EN uploaded, FIL recorded) | ![](img/talk-audio-after-7d-train-saved.png) |

The avatar in the after screenshots plays clips built from the committed Holistic fixture (three signs reused for every
letter), so the hand shapes are not the real letters; with your own `avatar.json` files the real signs play.

## 8. OWNER CHECKLIST

1. `git pull` on `accounts-quiz`; Ctrl+F5 on `http://localhost/SKR/talk.html`.
2. Speak or Type, type **hi**, Translate: the avatar fills the screen under the top bar and spells H, I (the current
   letter orange in the caption). Open DevTools -> Network, filter `webm`: nothing. Replay plays it again; Edit returns
   to the text; Send adds it and goes back to "Whose turn is it?" with no popup.
3. Type a word that has an avatar clip, a name and a number ("Hello Jose 25"): the sign, then J-O-S-E, then 2-5.
4. Sign: recording starts after 3 s; sign two words, tap **🗣 Speak or Type**, then **🤟 Sign instead**: the two words
   are still there. Tap **Send 🔊**: the message is added and spoken. Tap its 🔊 to replay, tap again to stop.
5. Train Gestures -> View Active Gesture Dataset -> Edit a word: Audio -> ● Record, say the word, ■ Stop, ▶, Save. Check
   `saved_gestures/<key>/audio_en.webm` exists and the list shows 🔊 EN. Then Let's Talk: sign that word and Send — you
   hear your recording.
6. Run on the laptop the checks this container cannot: `node tests/avatar/talk-avatar-check.mjs`,
   `node tests/avatar/import-check.mjs`, `node tests/sign-texts/verify-e2e.mjs` (edited for this phase, not run here),
   and on the Pi `tests/avatar/pi-bench.sh` (the avatar canvas is now 1000x486).
7. Copy `saved_gestures/` to the Pi as before; the audio files travel with it.
