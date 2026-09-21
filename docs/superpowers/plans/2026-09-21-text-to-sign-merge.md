# Text-to-Sign Merge — Plan (APPROVED 2026-09-21)

> **Status: APPROVED as written by the owner (2026-09-21), including: the neutral `fallback.png` placeholder (added, commit `ca8b8c9`), Filipino fingerspelling staying verbatim/logged (no English fallback), the chip placement, and the Send-enabled-immediately preview panel.** Tasks 1–3 below are expanded to step level; Tasks 4–8 are controller-run/docs and are detailed when reached. Executed with superpowers:subagent-driven-development (fresh implementer → task reviewer → fix → re-review; **max 3 review rounds per task, then escalate — no 4th attempt**).

**Goal:** Replace `talk.html`'s fake mic stand-in with real Vosk capture, add a word-by-word sign-video preview to the Speak-or-Type screen, then retire `#translator-pane` from `index.html` in its own final commit.

Spec: `docs/superpowers/specs/2026-09-21-text-to-sign-merge-design.md`. Seed decisions already committed: `2d22617`.

## Step 1 investigation results (cited)

### 1. js/script.js's sign pipeline — what is pure, what is welded to the DOM

`js/script.js` is not loadable in `talk.html` at all: line 13 `welcomeBtn.addEventListener(…)` and `:441` `textSignBtn.addEventListener(…)` dereference `index.html`-only ids with no null-guard, `:815` calls `alert()` if no speech API, and `:1-16` declare ~13 top-level `const`s (`startBtn`, `signContainer`, `currentWordDisplay`, `statusDisplay`, `langSelect`, `textSignInput`, `textSignBtn`, `dashboardPane`, `translatorPane`, `welcomeBtn`, `downloadHistoryBtn`, …) in the shared global scope.

| Piece | Lines | Status |
|---|---|---|
| `signAssetMapEn` / `signAssetMapFil` (+ a–z loop) | `:19-141` | **Pure data.** Copy verbatim. |
| `normalizeSpeechText` | `:944-950` | **Pure.** |
| `findLongestKnownPhrase(words, i)` | `:952-963` | Pure logic, but reads `getActiveKnownPhrases()` → `getActiveLanguage()`, which reads `document.getElementById('lang-select')` (`:144-147`, defaults `'en-US'`). Needs the language passed in. |
| `getActiveSignMap` / `getActiveKnownPhrases` / `getSignAssetBase` | `:149-159` | Pure once the language is an argument. |
| `rebuildKnownPhrases` + `knownPhrasesEn/Fil` | `:838-849` | Pure. |
| `fetchAndRegisterCustomGestures` | `:851-878` | Network: `GET php/api/save_gesture.php?no_sync=1`, adds DB gesture labels to the maps. Called at module load (`:878`). |
| `playSequence` | `:881-904` | Pure orchestration; **no cancellation** — two overlapping calls interleave on one container. |
| `displaySignWithFallback` | `:906-942` | Chain: (1) probe `assets/signs/<lang>/<word>.webm` by loading it into a throw-away `<video>` (`:912-918`), (2) static map (`:925-929`), (3) fingerspell letter clips (`:931-936`), (4) `fallback.png` for single-char items (`:937-938`), else a fixed **2000 ms** pause after a successful clip (`:940`). The probe `<video>` is never released (`:912-918`) — a leak per word. |
| `displayMedia` | `:965-1010` | **DOM-welded:** writes the module-scope `currentWordDisplay` and `signContainer` (`:977-979`, `:996-997`). Video branch resolves on `ended`; the `duration` argument is only honoured for images (`:999-1003`), so `displayMedia(letter.webm, letter, 800)` at `:935` ignores its `800`. |
| Vosk adapter `VoskSpeechRecognition` | `:162-337` | Coupled to `index.html` (`start-btn`, `.tts-mic-label`, `:184-215`). Capture path `:227-311`: `getUserMedia({audio:{echoCancellation,noiseSuppression,autoGainControl,channelCount:1,deviceId:{exact:localStorage.selectedMicId}}})` → `AudioContext` → `model.KaldiRecognizer(ctx.sampleRate)` → `result`/`partialresult` events → `ScriptProcessorNode(4096)` (`DEBT.md` item 33). |
| Mic toggle/session logic | `:511-816` | Tap toggles; `onend` appends the last partial to `finalTranscript` then auto-translates (`:715-717`). |
| `formatGrammar` | `:357-413` | Pure (capitalise, contractions, ending punctuation). |
| Mic auto-select | `:1012-1081` | `enumerateDevices()`; prefers `localStorage.selectedMicId`, else the first device whose label contains `ab13x` or `usb audio` and stores it (`:1054-1063`). **Its only consumer of `selectedMicId` writes is here** (grep: `js/script.js:238,609,1050,1061,1072`). |
| Mic-off in Filipino | `:467-485` | The pane **disables the mic** when `fil-PH` is chosen ("Voice input disabled in Filipino"). Typing still works. |

**Decision: port a copy into a new DOM-agnostic `js/sign-player.js`; do not extract-and-share.** Why: (1) `script.js` cannot be loaded into `talk.html` (above), so "sharing" means refactoring a page that is scheduled for deletion, in a phase whose own constraint is that `#translator-pane` must keep working until verified; (2) after retirement `script.js` has **no consumer** (§4) — a shared module would have exactly one user, so the abstraction buys nothing; (3) the copy becomes the sole implementation and the retirement commit removes the original, so the duplication lives for one phase and cannot drift afterwards. The port copies the logic **verbatim** (reviewers diff it against the line ranges above); permitted changes are only: language passed in instead of read from the DOM, container/label injected instead of module-scope, a cancellation token, releasing the probe `<video>`, and a `duration` fix is **not** made (behaviour preserved).

### 2. talk.html's current fake mic / Send flow (what Send/confirm expect)

- Markup `talk.html:1061-1082`: `#screen-speaking[data-wait]` → `.speaking-wait`, `.speaking-mic-row` (`#speaking-mic-btn`, label), `.speaking-input-row` (`#speaking-input`, `#speaking-send`).
- Enable logic `talk.html:~1772-1777`: `#speaking-send.disabled = input.value.trim() === ''`.
- **Fake mic** `talk.html:~1781-1787`: `openModal('confirm', {label:'You said', text: pickCanned(SPOKEN_CANNED_POOL), from:'hearing'})`; pool at `:1722-1728`, `pickCanned` `:1729`.
- **Send** `talk.html:~1795-1806`: `var typedText = speakingInput.value; openModal('confirm', {label:'You said', text: typedText, from:'hearing'}); speakingInput.value=''; speakingSend.disabled=true`.
- Confirm card contract (`renderConfirmModal`): `opts = {label, text, from}`; "Add to Conversation" → `appendBubble({from, text, timestamp})`, `closeModal()`, `showScreen('thread')`.
- **So the contract Send needs is a plain string in `#speaking-input`.** Real Vosk capture will write its transcript into that same input; Send/confirm/Add stay byte-for-byte unchanged (only the *mic* handler and `SPOKEN_CANNED_POOL`/`pickCanned` are removed).

### 3. How the loader exposes "Vosk is ready"

`js/talk-loader.js`: item `vosk-model` (`:55-60`) runs `Vosk.createModel(VOSK_MODEL_URL).then(model => { api.voskModel = model })` — `api.voskModel` is set **before** the item is marked `done` (`run()` awaits `def.run()` then `setStatus(…'done')`). Public API: `isSettled()` (`:105-107`), `getItems()`, `getProgress()`, `onChange(fn)` (`:115-121`), `voskModel` (`:110`). `talk.html` already gates the screen on it: `refreshGates()` sets `#screen-speaking[data-wait]` from `getProgress().settled` (`talk.html:~1561`); `stackFailed('speech')` + `maybeWarnMic()` (`:~1512-1531`) show the "Microphone not available / Type instead" card once when the speech stack failed.
**The hook the new code uses: `TalkLoader.voskModel !== null` (single source of truth — non-null only on success).** No new loader API, no readiness re-check. The screen is only reachable un-gated once the queue has settled, so `TalkSpeaking` reads `TalkLoader.voskModel` at mic-tap time; `null` ⇒ mic disabled (typing still works), reusing the existing error card.

### 4. What else needs js/script.js after #translator-pane is removed — nothing

- Grep across the repo (excluding `archive/`, `docs/`): `js/script.js` is loaded **only** by `index.html:752`. `js/vosk.js` is loaded by `index.html:751` and by `js/talk-loader.js` (`loadScript('js/vosk.js')`) — `talk.html` keeps it; `index.html` no longer needs it (drops a 5,657,075-byte script from the dashboard).
- The dashboard cards are plain anchors / inline `onclick` (`index.html:565-614`), independent of `script.js`. Everything else `script.js` touches lives inside the pane: `#start-btn`, `#transcript`, `#sign-container`, `#current-word`, `#text-sign-input`, `#text-sign-btn`, `#tts-mic-select`, `#ttsLangEn/Fil`, and the hidden compatibility elements `#status`, `#lang-select`, `#download-history-btn` (`index.html:714-720`) plus `#welcome-btn` (`:626`).
- `?screen=voice`: read only in `script.js:341`. No other page/PHP/shell file links to it (grep: `screen=voice` only in `index.html`/`script.js`/docs).
- `js/virtual-keyboard.js` (`index.html:753`) self-attaches to inputs and appends its own DOM at load (`virtual-keyboard.js:69,184-185`); the dashboard has no inputs after retirement, so the tag (and `css/virtual-keyboard.css`, `:9`) becomes dead weight. Optional to drop; not required.
- **Dead-with-the-pane (to remove in the retirement commit):** `index.html` inline `<style>` `:16-545` (all pane / keyboard / language-toggle rules — verified by the comment headings at `:17,34,77,…,368,514`), the pane `:634-748`, the inline script `:754-823`, the `<script>` tags `:751-752`, `#welcome-btn` + its comment `:617-626`. `css/style.css` also carries `#translator-pane` rules (`:69`, `:261`, `:541`); `style.css` is linked only by `index.html` — **left in place** (harmless dead CSS; trimming it risks the dashboard's `@media` blocks for no user-visible gain) and logged as debt.
- `js/script.js` → archived (`archive/script.js`) in the retirement commit; it is a whole file with zero consumers.
- **Regression this retirement would cause if not ported:** the Pi's USB mic (`ab13x` / `usb audio`) is auto-selected only by `script.js:1054-1063`. `talk-speaking.js` must carry that selection or the kiosk silently falls back to the default mic.

### 5. Other facts found while investigating (they affect what can be tested)

- **`fallback.png` does not exist** — not in `assets/signs/en/`, `assets/signs/fil/`, nor anywhere in the repo (`git ls-files | grep -i fallback` and `find . -iname 'fallback*'` both empty). `displayMedia`'s image branch resolves `false` on `img.onerror` (`:1006-1008`), so the pipeline's last step **silently shows nothing**.
- **`assets/signs/fil/` has no fingerspelling clips** — 89 files, none of `a.webm`…`z.webm` (checked all 26); `assets/signs/en/` has all 26 (120 files, all `.webm`). In Filipino mode an unknown word therefore fingerspells to nothing (every letter clip 404s, resolves `false`).
- Clips are tiny and mixed-orientation (measured with the repo's `ffmpeg.exe -i`): words `en/hello.webm` 360×202, 2.00 s; `en/good_morning.webm` 360×202, 3.73 s; `fil/kamusta.webm` 360×202, 2.00 s; letters `en/a.webm` 360×640 portrait, 1.93 s; `en/x.webm` 360×640, 2.60 s; `fil/tulong.webm` 360×638, 1.67 s. The panel must show both a wide word clip and a tall letter clip.
- `talk.html` has **no language toggle** on any screen: it was removed from "Who speaks first?" with the language now "defaulting" (`DECISIONS.md`, second review-pass entry; `DEBT.md` item 53). The spec says the EN/Filipino chips "carry over unchanged" — see Open question 2.
- Vosk API surface in the bundled `js/vosk.js` (grep on the minified file): `KaldiRecognizer`, `acceptWaveform`, `acceptWaveformFloat`, `setWords`, `terminate()` are present; `retrieveFinalResult` and a recognizer `remove()` were **not** found by name. `script.js:261` creates a new recognizer on every `start()` and never frees the old one. Task 2 must determine, by inspection at implementation time, which cleanup exists and avoid a per-session leak.

## Open questions for the owner (need an answer before Task 1)

1. **`fallback.png` is missing (blocks the "fully unmatched word" test as written).** Choose one: **(a, recommended)** add a plain neutral `fallback.png` to `assets/signs/en/` and `assets/signs/fil/` (a placeholder tile I generate; you can replace it with your own art) — no logic change, the chain then ends exactly as the spec describes; (b) make the last step show a text card ("No sign for “5”") instead of an image — new UI, contradicts "no new error states"; (c) leave it silent and change the test to "chain completes without error". Also: **Filipino fingerspelling has no clips** — recommend leaving the pipeline verbatim (it fingerspells to nothing in Filipino) and logging it in `DEBT.md`; the alternative is falling back to the English alphabet clips, which is a behaviour change you'd have to approve.
2. **Where do the EN / Filipino chips go?** `talk.html` has none. Recommendation: a row of two 60 px chips **above the mic** on the compose state (turn 2+ vertical budget: 60 + 16 + 110 + 8 + 22 + 24 + 32 + 64 = 336 of 414 px), hidden together with the mic when the keyboard is raised, default English, choice kept for the whole conversation. Filipino keeps the pane's behaviour: **mic disabled** ("Voice input disabled in Filipino"), typing still works and plays from `assets/signs/fil/`. (Your manual-check wording, "transcription just stays English, or fails gracefully", is satisfied by the mic being disabled; say if you'd rather leave the mic on and transcribe English.)
3. **Flow details the spec leaves open — confirm or correct (my defaults):**
   - Compose state: `[ input 700 | Translate 180 ]` (Translate disabled until there is text; it is that state's one orange element). **Send leaves the compose row** — it appears in the preview panel.
   - Preview state (replaces the mic/chips/input rows in place): sign frame (560×260) + current-word label + `[ Edit | Send ]` (Send orange). **Send is enabled immediately** (waiting for a 10-word sentence to finish, ~4 s per word, would be a wall); sending cancels playback. **Edit** cancels playback and returns to compose with the text kept. Leaving the screen (Back / thread) cancels playback and releases the mic.
   - Mic: tap = start, tap = stop (as the pane); transcript fills `#speaking-input` live; on stop `formatGrammar` (`script.js:357-413`) is applied so the bubble reads "Hello, how are you?" rather than raw lower-case Vosk text; the user can still edit before Translate. The pane's mic-picker dropdown (13 px text, below the touch rules) is **not** ported; the USB auto-select is.
   - Translate is the only trigger — the pane's auto-translate on mic stop (`script.js:715-717`) is intentionally dropped, per the spec's "explicit button".

## Global constraints (handed to every reviewer verbatim)

- `#screen-speaking` keeps its current compact, single-column shape and position in the 1024×600 stage. No new screen, no navigation — the sign-video panel replaces the mic/input row in place, same screen.
- Translate is an explicit button. No auto-play on speech-end or a typing pause.
- The sign-video preview plays once, pre-send. It is never stored in or replayed from the thread — only the text goes into the thread bubble via the existing, unmodified Send → confirm card → Add to Conversation flow.
- Reuse `js/script.js`'s existing lookup/playback pipeline (custom video → static asset map → fingerspelling → `fallback.png`). Do not rewrite the matching/fallback logic from scratch.
- The EN/Filipino toggle carries over unchanged, including the existing English-only Vosk limitation (DEBT item 53) — not this phase's job to fix.
- `reports.html` and `gesture-training.html`: untouched.
- Do not remove `#translator-pane` until the merged Speak-or-Type screen is verified working end to end — archive it as its own final commit, separate from the merge.
- Inherited from the last phase (still binding): touch rules from `docs/ui-target/README.md` (≥60×60 tappable, ≥16px body text, `:active` on every tappable, no hover, one orange element per screen state, colours only from `css/tokens.css`); fixed 1024×600; offline only; no build step/framework; camera/mic hardware must be released on leave.

## Task list

Tasks 1–3 are code (each: implementer → task reviewer → fix → re-review, ≤3 rounds); Task 4 is controller-run verification; Tasks 5–6 docs; Task 7 the retirement commit; Task 8 the final docs commit.

### Task 1: `js/sign-player.js` — DOM-agnostic port of the sign pipeline

**Files:**
- Create: `js/sign-player.js` (IIFE exposing `window.SignPlayer`). Touch nothing else.

**Interfaces:**
- Produces `window.SignPlayer`:
  - `create({container: HTMLElement, wordLabel: HTMLElement, getLanguage: () => 'en-US'|'fil-PH'}) → {play(text: string): Promise<void>, cancel(): void, isPlaying(): boolean}`
  - `normalizeSpeechText(text: string): string`, `formatGrammar(text: string): string` (both pure)
  - `registerCustomGestures(): Promise<void>` (idempotent — one `GET php/api/save_gesture.php?no_sync=1` per page load)
- `play()` resolves when the sequence finishes **or is cancelled**; calling `play()` again cancels the previous sequence first. `cancel()` never throws and is safe to call when idle.

**Rule: this is a PORT, not a rewrite.** Everything below marked VERBATIM is copied character-for-character from `js/script.js` (a reviewer will diff it). The only permitted departures are the five listed at the end of Step 2. `assets/signs/en/fallback.png` and `assets/signs/fil/fallback.png` already exist (commit `ca8b8c9`).

- [ ] **Step 1: File header and VERBATIM data.** Create `js/sign-player.js`:

```js
// js/sign-player.js
// DOM-agnostic port of js/script.js's text-to-sign pipeline for talk.html's Speak-or-Type
// preview (docs/superpowers/specs/2026-09-21-text-to-sign-merge-design.md). js/script.js
// cannot be loaded into talk.html (it dereferences index.html-only ids at load, script.js:13
// and :441), and it is retired once #translator-pane is, so this is a port of a copy, not a
// shared module. Sections marked VERBATIM are unchanged from js/script.js (line ranges given);
// the only departures are listed in docs/superpowers/plans/2026-09-21-text-to-sign-merge.md.
(function () {
  'use strict';

  // ── VERBATIM js/script.js:19-141 ── copy these lines unchanged, from
  // `const signAssetMapEn = {` through the end of the
  // `for (const letter of "abcdefghijklmnopqrstuvwxyz") { … }` loop.

  // ── VERBATIM js/script.js:838-849 ── `let knownPhrasesEn = []; let knownPhrasesFil = [];`
  // then `function rebuildKnownPhrases() { … }` and its immediate `rebuildKnownPhrases();` call.
```

- [ ] **Step 2: Language helpers, normalise, phrase matching, grammar, custom gestures.** Continue the file:

```js
  // js/script.js:144-159 with the language passed in (script.js reads #lang-select).
  function isFilipino(lang) { return lang === 'fil-PH'; }
  function getSignAssetBase(lang) { return isFilipino(lang) ? 'assets/signs/fil/' : 'assets/signs/en/'; }
  function getActiveSignMap(lang) { return isFilipino(lang) ? signAssetMapFil : signAssetMapEn; }
  function getActiveKnownPhrases(lang) { return isFilipino(lang) ? knownPhrasesFil : knownPhrasesEn; }

  // ── VERBATIM js/script.js:944-950 ── function normalizeSpeechText(text) { … }

  // js/script.js:952-963, only change: the language is an argument.
  function findLongestKnownPhrase(words, startIndex, lang) {
    const phrases = getActiveKnownPhrases(lang);
    for (const phrase of phrases) {
      const phraseWords = phrase.split(" ");
      const candidate = words.slice(startIndex, startIndex + phraseWords.length).join(" ");
      if (candidate === phrase) {
        return { text: phrase, wordCount: phraseWords.length };
      }
    }

    return null;
  }

  // ── VERBATIM js/script.js:357-413 ── function formatGrammar(text) { … }

  // js/script.js:851-878: the function body is VERBATIM; talk.html is always served over
  // http, so script.js:834-836's file:// branch is dropped and the endpoint is the relative path.
  const SAVE_ENDPOINT = "php/api/save_gesture.php";
  // ── VERBATIM js/script.js:851-876 ── async function fetchAndRegisterCustomGestures() { … }
  let customGesturesPromise = null;
  function registerCustomGestures() {
    if (!customGesturesPromise) customGesturesPromise = fetchAndRegisterCustomGestures();
    return customGesturesPromise;
  }
```
(`fetchAndRegisterCustomGestures` uses `SAVE_ENDPOINT`, both maps and `rebuildKnownPhrases()` — all defined above; keep its `try/catch` and `console.warn`.)

- [ ] **Step 3: The player.** Continue the file. The three pipeline functions below are `js/script.js:881-1010` re-expressed with the five permitted departures **(D1)** language via `getLanguage()` instead of `#lang-select`; **(D2)** container/label injected instead of the module-scope `signContainer`/`currentWordDisplay`; **(D3)** a cancellation `token` checked between steps and abortable waits; **(D4)** every `<video>` released (`src` removed + `load()`) when the probe finishes, when a clip is replaced, and on cancel — `script.js:912-918` never releases its probe; **(D5)** the image is built with DOM APIs, not `innerHTML` with interpolated `label` (`script.js:997`) — on this kiosk `label` derives from typed public input. The chain order and constants (probe → static map → per-letter fingerspell at 800 → `fallback.png` at 1200 → 2000 ms hold) are unchanged.

```js
  function create(opts) {
    const container = opts.container;
    const wordLabel = opts.wordLabel;
    const getLanguage = opts.getLanguage;
    let token = 0;
    let playing = false;
    let aborts = [];   // each settles whatever the current step is waiting on

    function releaseVideo(v) {
      try { v.pause(); } catch (e) { /* not playing */ }
      v.removeAttribute('src');
      v.load();
    }
    function clearContainer() {
      const vids = container.querySelectorAll('video');
      for (let i = 0; i < vids.length; i++) releaseVideo(vids[i]);
      container.innerHTML = '';
    }
    function abortAll() {
      const list = aborts;
      aborts = [];
      list.forEach(function (fn) { fn(); });
    }
    function sleep(ms) {
      return new Promise(function (resolve) {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          aborts = aborts.filter(function (f) { return f !== done; });
          resolve();
        }
        aborts.push(done);
      });
    }

    // js/script.js:965-1010
    function displayMedia(path, label, duration) {
      duration = duration || 0;
      return new Promise(function (resolve) {
        let settled = false;
        let video = null;
        let img = null;
        let timer = null;
        function finish(ok) {
          if (settled) return;
          settled = true;
          aborts = aborts.filter(function (f) { return f !== abort; });
          clearTimeout(timer);
          if (video) {
            video.onloadedmetadata = video.onended = video.onerror = null;
            if (!ok) releaseVideo(video);   // a clip that ended stays as the last frame until replaced
          }
          if (img) img.onload = img.onerror = null;
          resolve(ok);
        }
        function abort() { finish(false); }
        aborts.push(abort);

        // Handle video files (.webm, .mp4)
        if (/\.(webm|mp4)$/i.test(path)) {
          video = document.createElement('video');
          video.src = path;
          video.autoplay = true;
          video.muted = true;
          video.loop = false;
          video.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
          video.onloadedmetadata = function () {
            wordLabel.textContent = label.toUpperCase();
            clearContainer();
            container.appendChild(video);
            video.play().catch(function () {});
          };
          video.onended = function () { finish(true); };
          video.onerror = function () { finish(false); };
          video.load();
          return;
        }

        // Handle image files
        img = new Image();
        img.onload = function () {
          wordLabel.textContent = label.toUpperCase();
          clearContainer();
          img.alt = label;
          img.style.cssText = 'max-width:100%; max-height:100%; object-fit:contain;';
          container.appendChild(img);
          if (duration > 0) {
            timer = setTimeout(function () { finish(true); }, duration);
          } else {
            finish(true);
          }
        };
        img.onerror = function () { finish(false); };
        img.src = path;
      });
    }

    // js/script.js:906-942
    async function displaySignWithFallback(item, myToken) {
      const lang = getLanguage();
      const normalizedItem = normalizeSpeechText(item);
      const assetBase = getSignAssetBase(lang);

      // 1. Check for a custom recorded .webm video in language-specific assets/signs/ folder
      const customVideoPath = assetBase + normalizedItem.replace(/\s+/g, '_') + '.webm';
      const hasCustomVideo = await new Promise(function (resolve) {
        const v = document.createElement('video');
        function done(ok) {
          v.onloadedmetadata = null;
          v.onerror = null;
          releaseVideo(v);
          resolve(ok);
        }
        v.onloadedmetadata = function () { done(true); };
        v.onerror = function () { done(false); };
        v.src = customVideoPath;
        v.load();
      });
      if (myToken !== token) return;
      if (hasCustomVideo) {
        await displayMedia(customVideoPath, item);
        return;
      }

      // 2. Fall back to language-specific static asset map
      const assetMap = getActiveSignMap(lang);
      const assetFile = assetMap[normalizedItem];
      const isSuccess = assetFile
        ? await displayMedia(assetBase + assetFile, item)
        : false;
      if (myToken !== token) return;

      if (!isSuccess && normalizedItem.length > 1) {
        // Fingerspell letter by letter using .webm from the active language folder
        const letters = normalizedItem.replace(/\s/g, "").split("");
        for (const letter of letters) {
          if (myToken !== token) return;
          await displayMedia(assetBase + letter + '.webm', letter, 800);
        }
      } else if (!isSuccess) {
        await displayMedia(assetBase + 'fallback.png', item, 1200);
      } else {
        await sleep(2000);
      }
    }

    // js/script.js:881-904
    async function playSequence(text, myToken) {
      const cleanText = normalizeSpeechText(text);
      if (!cleanText) {
        return;
      }

      let words = cleanText.split(" ");
      let sequence = [];

      for (let i = 0; i < words.length; i++) {
        const phrase = findLongestKnownPhrase(words, i, getLanguage());
        if (phrase) {
          sequence.push(phrase.text);
          i += phrase.wordCount - 1;
          continue;
        }

        sequence.push(words[i]);
      }

      for (const item of sequence) {
        if (myToken !== token) return;
        await displaySignWithFallback(item, myToken);
      }
    }

    function play(text) {
      abortAll();                       // a new play() supersedes any sequence still running
      const myToken = ++token;
      playing = true;
      return playSequence(text, myToken).finally(function () {
        if (myToken === token) playing = false;
      });
    }

    function cancel() {
      token++;
      playing = false;
      abortAll();
      clearContainer();
      wordLabel.textContent = '';
    }

    function isPlaying() { return playing; }

    return { play: play, cancel: cancel, isPlaying: isPlaying };
  }

  window.SignPlayer = {
    create: create,
    normalizeSpeechText: normalizeSpeechText,
    formatGrammar: formatGrammar,
    registerCustomGestures: registerCustomGestures
  };
})();
```

- [ ] **Step 4: Static checks.** `node --check js/sign-player.js` → no output. `grep -n "getElementById\|lang-select\|innerHTML" js/sign-player.js` → only `container.innerHTML = ''` in `clearContainer` (no `getElementById`, no `lang-select`). A VERBATIM diff: for each VERBATIM range, extract those lines from `js/script.js` (`sed -n 'A,Bp'`) and confirm they appear unchanged in the new file (report the check you ran).

- [ ] **Step 5: Behaviour verification in real Chrome** (nothing is committed from this step). Scratch harness: `C:\Users\ADMIN\AppData\Local\Temp\claude\E--ACADSS-IOT-SKv2\533efd82-6f55-49d3-8cdc-0bde6a508b82\scratchpad\cdp.mjs` exports `launch`, `openTalk`, `waitSettled` (headless Chrome + CDP, Node 24, nothing to install; run scripts from that directory with `node x.mjs`; port 9333, so never two at once). Load `http://localhost/SKR/talk.html`, then via `evalJS` append `<div id="t-frame">` and `<h2 id="t-word">` to `document.body`, inject `js/sign-player.js` as a script element, and run in the page (times with `performance.now()`): (a) `play('hello')` on en-US resolves after ≈ the clip's 2.00 s (`ffmpeg`-measured; no 2000 ms hold because the custom-video branch returns early); `#t-word` reads `HELLO`. (b) `play('thank you')` (static-map word) takes ≈ its clip + 2000 ms. (c) `play('xyz')` fingerspells: `#t-word` visits X, Y, Z in order. (d) `play('@')` — a single character with no clip and no map entry (NOTE: digits have clips, `assets/signs/en/5.webm` exists, so use a symbol) — requests `assets/signs/en/fallback.png` and displays it (`#t-frame img` present, `alt="@"`, ~1200 ms). (e) `fil-PH`: `play('kamusta')` plays `assets/signs/fil/kamusta.webm`; `play('xyz')` completes without error and without displaying anything (Filipino has no letter clips — expected, DEBT item to be logged). (f) `cancel()` mid-clip: `play()`'s promise resolves promptly, `#t-frame` is empty, `SignPlayer.create(...).isPlaying()` false; then a fresh `play('hello')` works. (g) leak check: 20 × (`play('hello')`, wait 300 ms, `cancel()`), then `document.querySelectorAll('video').length` inside `#t-frame` is 0 and the count of `<video>` elements anywhere in `document` created by the player and still attached is 0. (h) `play('<img src=x onerror=alert(1)>')` inserts no element other than the fallback `<img>` (no injected node; `alt` holds the text literally). Report every measured value.

- [ ] **Step 6: Commit.** `git add js/sign-player.js && git commit -m "talk: sign-player — DOM-agnostic port of the text-to-sign pipeline"` (message ends with the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` line).

---

### Task 2: `js/talk-speaking.js` — Vosk capture and speak-side state

**Files:**
- Create: `js/talk-speaking.js` (IIFE exposing `window.TalkSpeaking`). Touch nothing else.

**Interfaces:**
- Consumes: `window.TalkLoader.voskModel` (non-null only when the `vosk-model` queue item succeeded — `js/talk-loader.js:55-60`); `window.SignPlayer.formatGrammar` (Task 1); DOM ids/classes `#speaking-mic-btn`, `.speaking-mic-label`, `#speaking-input` (already in `talk.html`).
- Produces `window.TalkSpeaking`:
  - `init({onMicError: (kind: 'model'|'capture', message: string) => void, onChange: () => void})` — once, at page load. `onChange` fires whenever `isCapturing()` changes.
  - `enter()` / `leave()` — idempotent; `leave()` finalises any transcript into the input and releases the microphone.
  - `setLanguage('en-US'|'fil-PH')`, `getLanguage()`; `isCapturing(): boolean`.
- Contract with the rest of the screen: the transcript is written into `#speaking-input` (`input.value`) and an `input` event is dispatched on it every time it changes (this is what keeps Send/Translate gating and the idle timer in sync — `talk.html` already listens for `input` on both `#speaking-input` and `document`). Nothing else writes the input.

**Behaviour ported from `js/script.js` (cite these when reviewing):** tap toggles start/stop (`:723-737`); `getUserMedia({audio:{echoCancellation, noiseSuppression, autoGainControl, channelCount:1, deviceId:{exact: localStorage.selectedMicId}}})` (`:238-252`); `AudioContext` + `createMediaStreamSource` + `model.KaldiRecognizer(ctx.sampleRate)` (`:254-261`); `result` → `message.result.text` and `partialresult` → `message.result.partial` (`:263-286`); `ScriptProcessorNode(4096,1,1)` feeding `recognizer.acceptWaveform(event.inputBuffer)` (`:288-300`, deprecated — `DEBT.md` item 33, carried over, not fixed here); on stop the last partial is appended to the final text (`:688-691`); Filipino disables voice input (`:467-485`); USB mic auto-select (`:1050-1063`).

- [ ] **Step 1: Inspect the bundled Vosk API before writing cleanup code.** `js/vosk.js` is minified (5.6 MB). Determine, and record in your report, what the `KaldiRecognizer` object actually offers for freeing itself: search the file for `remove`, `terminate`, `retrieveFinalResult`, `setWords`, `acceptWaveform`, `on(` near the string `KaldiRecognizer` (e.g. `grep -o ".\{80\}KaldiRecognizer.\{120\}" js/vosk.js | head`), and confirm at runtime in Chrome via the harness by creating a recognizer from `TalkLoader.voskModel` and listing `Object.getOwnPropertyNames(Object.getPrototypeOf(rec))`. `script.js:261` creates a fresh recognizer on every start and never frees the old one; your `teardown()` must call the recognizer's own removal method **if it exists** (guarded: `typeof rec.remove === 'function'`) and otherwise drop the reference — report which case applies and do not claim a leak fix you did not measure.

- [ ] **Step 2: Write the module.**

```js
// js/talk-speaking.js
// Real speech capture for talk.html's Speak-or-Type screen: Vosk (already loaded by
// js/talk-loader.js) → live transcript in #speaking-input. Logic ported from js/script.js's
// VoskSpeechRecognition + mic toggle (line refs in comments). Contract: leave() stops every
// audio track, closes the AudioContext and drops the recognizer, and never touches the
// loaded model (TalkLoader.voskModel) — the model is a page-lifetime resource.
(function () {
  'use strict';

  var MIC_KEY = 'selectedMicId';          // js/script.js:238, 1050-1072
  var cb = {};
  var lang = 'en-US';
  var active = false;
  var starting = false;
  var capturing = false;
  var gen = 0;
  var stream = null;
  var audioCtx = null;
  var source = null;
  var processor = null;
  var recognizer = null;
  var finalText = '';
  var partialText = '';
  var micBtn = null;
  var micLabel = null;
  var input = null;

  function modelReady() {
    return !!(window.TalkLoader && window.TalkLoader.voskModel);
  }

  function setLabel(text) { if (micLabel) micLabel.textContent = text; }

  function syncMic() {
    if (!micBtn) return;
    var fil = lang === 'fil-PH';
    var unavailable = !modelReady();
    micBtn.disabled = fil || unavailable;
    micBtn.classList.toggle('listening', capturing);
    micBtn.setAttribute('aria-pressed', capturing ? 'true' : 'false');
    if (fil) setLabel('Voice input disabled in Filipino');       // js/script.js:479
    else if (unavailable) setLabel('Microphone not available');
    else setLabel(capturing ? 'Tap to Stop' : 'Tap to Speak');    // js/script.js:584-586
  }

  function changed() {
    syncMic();
    if (cb.onChange) cb.onChange();
  }

  function renderTranscript() {
    var combined = (finalText + (finalText && partialText ? ' ' : '') + partialText).trim();
    input.value = combined;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // js/script.js:1050-1063: keep the saved mic if it still exists, else prefer the kiosk's
  // USB mic (label contains "ab13x" or "usb audio"). Labels are only readable after mic
  // permission has been granted, so this also runs after a successful capture start.
  function autoSelectMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var mics = devices.filter(function (d) { return d.kind === 'audioinput'; });
      var saved = null;
      try { saved = localStorage.getItem(MIC_KEY); } catch (e) { /* storage blocked */ }
      if (saved && mics.some(function (m) { return m.deviceId === saved; })) return;
      var target = mics.filter(function (m) {
        var label = (m.label || '').toLowerCase();
        return label.indexOf('ab13x') !== -1 || label.indexOf('usb audio') !== -1;
      })[0];
      if (target) {
        try { localStorage.setItem(MIC_KEY, target.deviceId); } catch (e) { /* storage blocked */ }
      }
    }).catch(function (err) { console.error('[talk-speaking] enumerateDevices failed:', err); });
  }

  function audioConstraints(useSavedId) {
    var c = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    var saved = null;
    if (useSavedId) { try { saved = localStorage.getItem(MIC_KEY); } catch (e) { /* storage blocked */ } }
    if (saved) c.deviceId = { exact: saved };
    return c;
  }

  // The saved mic may have been unplugged (OverconstrainedError / NotFoundError): retry once
  // with the default device instead of failing outright.
  async function acquireMic() {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints(true) });
    } catch (err) {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints(false) });
      }
      throw err;
    }
  }

  function teardown() {
    capturing = false;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (e) { /* already */ } processor = null; }
    if (source) { try { source.disconnect(); } catch (e) { /* already */ } source = null; }
    if (audioCtx && audioCtx.state !== 'closed') { try { audioCtx.close(); } catch (e) { /* already */ } }
    audioCtx = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (recognizer) {
      // Free the recognizer if this Vosk build offers a way (see Step 1); the MODEL is never touched.
      try { if (typeof recognizer.remove === 'function') recognizer.remove(); } catch (e) { /* best effort */ }
      recognizer = null;
    }
  }

  function fail(kind, message) {
    teardown();
    finalText = '';
    partialText = '';
    changed();
    if (cb.onMicError) cb.onMicError(kind, message);
  }

  async function startCapture() {
    if (capturing || starting || !active) return;
    if (!modelReady()) { fail('model', 'Vosk model not loaded'); return; }
    var model = window.TalkLoader.voskModel;
    starting = true;
    var myGen = ++gen;
    try {
      var s = await acquireMic();
      if (!active || myGen !== gen) {           // left the screen while getUserMedia was in flight
        s.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      stream = s;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      recognizer = new model.KaldiRecognizer(audioCtx.sampleRate);
      finalText = '';
      partialText = '';
      recognizer.on('result', function (message) {          // js/script.js:263-274
        if (!capturing) return;
        var text = message.result && message.result.text;
        if (text) {
          finalText += (finalText ? ' ' : '') + text;
          partialText = '';
          renderTranscript();
        }
      });
      recognizer.on('partialresult', function (message) {   // js/script.js:276-286
        if (!capturing) return;
        partialText = (message.result && message.result.partial) || '';
        renderTranscript();
      });
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function (event) {         // js/script.js:288-297
        if (recognizer && capturing) {
          try { recognizer.acceptWaveform(event.inputBuffer); } catch (err) { console.error('[talk-speaking] acceptWaveform failed:', err); }
        }
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      capturing = true;
      changed();
      autoSelectMic();                                       // labels are readable now
    } catch (err) {
      console.error('[talk-speaking] capture failed:', err);
      fail('capture', (err && err.message) || String(err));
    } finally {
      starting = false;
    }
  }

  // Finalise: append the last partial (js/script.js:688-691), tidy the text with formatGrammar,
  // release the hardware. A late 'result' after this is ignored (capturing === false).
  function stopCapture() {
    if (!capturing) return;
    var text = (finalText + (finalText && partialText ? ' ' : '') + partialText).trim();
    teardown();
    finalText = '';
    partialText = '';
    if (text) {
      input.value = window.SignPlayer ? window.SignPlayer.formatGrammar(text) : text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    changed();
  }

  function onMicTap() {
    if (micBtn.disabled) return;
    if (capturing) stopCapture(); else startCapture();
  }

  function init(callbacks) {
    cb = callbacks || {};
    micBtn = document.getElementById('speaking-mic-btn');
    micLabel = document.querySelector('.speaking-mic-label');
    input = document.getElementById('speaking-input');
    micBtn.addEventListener('click', onMicTap);
    // Typing and talking are alternatives: raising the keyboard ends a capture in progress.
    input.addEventListener('focus', function () { if (capturing) stopCapture(); });
    syncMic();
  }

  function enter() {
    if (active) return;
    active = true;
    syncMic();
    autoSelectMic();
  }

  function leave() {
    if (!active) return;
    active = false;
    gen++;                                   // discards a getUserMedia still in flight
    if (capturing) stopCapture(); else teardown();
    starting = false;
    syncMic();
  }

  function setLanguage(next) {
    if (next === lang) return;
    lang = next;
    if (lang === 'fil-PH' && capturing) stopCapture();   // js/script.js:469-471
    syncMic();
  }

  window.TalkSpeaking = {
    init: init,
    enter: enter,
    leave: leave,
    setLanguage: setLanguage,
    getLanguage: function () { return lang; },
    isCapturing: function () { return capturing; }
  };
})();
```

- [ ] **Step 3: Static checks.** `node --check js/talk-speaking.js`. `grep -n "voskModel" js/talk-speaking.js` — the only uses are `modelReady()` and reading it into `model`; the string `.terminate(` must not appear (the model is never touched).

- [ ] **Step 4: Verify in real Chrome with real audio.** Generate a spoken-English WAV with Windows SAPI so Vosk transcribes real audio automatically:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile("<scratchpad>\hello.wav")
$s.Speak("hello how are you")
$s.Dispose()
```
Then extend the harness's `launch()` (scratch copy, not the repo) to add `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<scratchpad>\hello.wav` (Chrome loops the file). In the page (after `waitSettled`), add a text `<input id="speaking-input">` if absent (it exists in `talk.html`), navigate to Speak or Type, call `TalkSpeaking.init({...})` only if `talk.html` hasn't yet (Task 3 wires it — for this task inject and init from the console), `TalkSpeaking.enter()`, tap `#speaking-mic-btn`, wait ~4 s, tap again. Report: (a) the transcript actually produced in `#speaking-input` (should contain recognisable words from "hello how are you"); (b) `input` events fired; (c) getUserMedia audio call count = taps; after stop: every audio track `readyState === 'ended'`, `AudioContext` closed; (d) 10 × start→stop cycles: 0 live tracks, 0 non-closed `AudioContext`s (instrument `AudioContext` construction in the harness and count states), and `Vosk.createModel` calls = 1 for the whole page (Apache access log: one GET of the model); (e) `leave()` while capturing → tracks ended, transcript so far in the input; `leave()` while `getUserMedia` is still pending (delay it by wrapping `getUserMedia` with a 1.5 s promise) → the stream that arrives is stopped, no capture starts; (f) `setLanguage('fil-PH')` disables `#speaking-mic-btn` and sets the label to "Voice input disabled in Filipino"; back to `en-US` re-enables; (g) mic denied (wrap `getUserMedia` to reject `NotAllowedError`) → `onMicError('capture', …)` fires once, mic still enabled for retry; (h) `TalkLoader.voskModel = null` → tap → `onMicError('model', …)`, mic disabled with "Microphone not available". Report which recognizer-cleanup case from Step 1 applied and what (a)–(h) measured.

- [ ] **Step 5: Commit.** `git add js/talk-speaking.js && git commit -m "talk: talk-speaking — real Vosk mic capture for the Speak-or-Type screen"` (ends with the Co-Authored-By line).

---

### Task 3: `talk.html` — compose/preview states, Translate, language chips, wiring

**Files:**
- Modify: `talk.html` only.

**Interfaces:**
- Consumes: `SignPlayer.create/…` (Task 1), `TalkSpeaking.init/enter/leave/setLanguage/getLanguage/isCapturing` (Task 2), `TalkLoader` (existing gate code), the existing `openModal`, `showScreen`, `maybeWarnMic`, `renderConfirmModal` (unchanged).
- Produces DOM: `#screen-speaking[data-speaking="compose"|"preview"]`; ids `#chip-lang-en`, `#chip-lang-fil`, `#speaking-translate`, `#speaking-preview`, `#speaking-sign-frame`, `#speaking-sign-word`, `#speaking-edit`; `#speaking-send` moves into the preview panel.

**Decided UX (owner-approved):** compose = `[English|Filipino]` chips above the mic, mic, and `[input | Translate]`; Translate is that state's one orange element and is disabled while the input is empty/whitespace **or a capture is running**. Tapping Translate swaps compose for the preview **in place**: sign frame + current word + `[Edit | Send]`. Send (orange, the preview's one orange element) is enabled from the start; Send and Edit cancel playback. Filipino disables the mic (Task 2) and switches the clip folder. Nothing about the confirm card, the thread or turn-taking changes.

- [ ] **Step 1: Script tags.** After `<script src="js/talk-signing.js"></script>` add:

```html
  <script src="js/sign-player.js"></script>
  <script src="js/talk-speaking.js"></script>
```

- [ ] **Step 2: Markup.** Replace the body of `#screen-speaking` (keep `id`, `class="screen"`, `data-wait="1"`; add `data-speaking="compose"`) so its children are, in order: the existing `.speaking-wait` block (unchanged); then

```html
    <div class="speaking-lang" id="speaking-lang" role="group" aria-label="Language">
      <button type="button" class="mode-chip active" id="chip-lang-en" aria-pressed="true">English</button>
      <button type="button" class="mode-chip" id="chip-lang-fil" aria-pressed="false">Filipino</button>
    </div>
```
then the existing `.speaking-mic-row` (button `#speaking-mic-btn` and `.speaking-mic-label`; update its comment — the mic is now real, `js/talk-speaking.js`), then the input row **without** Send and with Translate:

```html
    <div class="speaking-input-row">
      <input type="text" id="speaking-input" class="speaking-input" placeholder="Type your message" autocomplete="off">
      <button type="button" id="speaking-translate" class="speaking-send" disabled>Translate</button>
    </div>
```
then the preview panel (Send moves here **as the same element** — same id, same class):

```html
    <div class="speaking-preview" id="speaking-preview">
      <div class="speaking-sign-frame" id="speaking-sign-frame"></div>
      <div class="speaking-sign-word" id="speaking-sign-word"></div>
      <div class="speaking-preview-actions">
        <button type="button" class="speaking-edit" id="speaking-edit">Edit</button>
        <button type="button" id="speaking-send" class="speaking-send" disabled>Send</button>
      </div>
    </div>
```

- [ ] **Step 3: CSS.** Add after the existing Screen 04 rules (colours from tokens only; reuse `.mode-chip` from the signing screen):

```css
  /* ── Screen 04 additions (text-to-sign merge) ── */
  .speaking-lang{display:flex;gap:12px;margin-bottom:16px}
  .speaking-mic-btn:disabled{opacity:0.4;cursor:not-allowed}
  /* Green = live/listening only (README colour rules). */
  .speaking-mic-btn.listening{box-shadow:0 0 0 6px var(--green)}
  .speaking-preview{display:none;flex-direction:column;align-items:center}
  #screen-speaking[data-speaking="preview"] .speaking-preview{display:flex}
  #screen-speaking[data-speaking="preview"] .speaking-lang,
  #screen-speaking[data-speaking="preview"] .speaking-mic-row,
  #screen-speaking[data-speaking="preview"] .speaking-input-row{display:none}
  .speaking-sign-frame{
    width:560px;height:260px;border-radius:12px;background:var(--navy);
    display:flex;align-items:center;justify-content:center;overflow:hidden;
  }
  .speaking-sign-word{
    min-height:34px;margin:8px 0 16px;
    font-size:28px;font-weight:700;color:var(--navy);text-align:center;
  }
  .speaking-preview-actions{display:flex;gap:20px;width:560px}
  .speaking-preview-actions .speaking-edit,
  .speaking-preview-actions .speaking-send{flex:1;width:auto;height:64px}
  .speaking-edit{
    border:1px solid var(--border);border-radius:12px;
    background:var(--surface);color:var(--navy);
    font-family:inherit;font-size:18px;font-weight:700;cursor:pointer;
    transition:transform 0.08s, border-color 0.08s;
  }
  .speaking-edit:active{transform:scale(0.97);border-color:var(--navy)}
  /* Raised keyboard: chips leave with the mic (both are hidden while typing). */
  body.keyboard-active #screen-speaking .speaking-lang{display:none}
  /* Waiting on the loading queue: nothing but "Getting ready…" (must come after the preview rules). */
  #screen-speaking[data-wait="1"] .speaking-lang,
  #screen-speaking[data-wait="1"] .speaking-preview{display:none}
```
Update the "Task 3 orange audit" comment: `#screen-speaking` now has one orange element per sub-state — `#speaking-translate` (compose) and `#speaking-send` (preview); the other is `display:none` in each.

- [ ] **Step 4: Remove the fake mic; keep Send byte-identical.** Delete the `document.getElementById('speaking-mic-btn').addEventListener('click', …openModal('confirm', {…pickCanned(SPOKEN_CANNED_POOL)…}))` block, the `SPOKEN_CANNED_POOL` array and `pickCanned()` (`grep -n "CANNED\|pickCanned" talk.html` → 0 hits afterwards). **Do not edit** the `speakingInput` `input` listener or the `speakingSend` click handler in the existing "Screen 04" IIFE — they keep working because `#speaking-send` is the same element in a new place. Update the comment above that IIFE and the "two fake buttons"/canned notes that mention the speaking mic so they are true.

- [ ] **Step 5: New wiring** — add in a new IIFE directly after the existing Screen 04 IIFE, and top-level declarations near the loading-gate block so the lifecycle hooks can reach them:

```js
    // ── Text-to-sign merge: hoisted so onEnterSpeaking()/onLeaveSpeaking() can reach them ──
    var speakingPlayer = null;
    var resetSpeakingUi = function () {};
```
Replace the current `onEnterSpeaking`/`onLeaveSpeaking`/`onEndConversation` bodies:

```js
    function onEnterSpeaking() {
      resetSpeakingUi();
      TalkSpeaking.enter();
      SignPlayer.registerCustomGestures();     // idempotent; one DB fetch per page load
      maybeWarnMic(true);
    }
    function onLeaveSpeaking() {
      if (speakingPlayer) speakingPlayer.cancel();
      TalkSpeaking.leave();
      resetSpeakingUi();
    }
    // onEndConversation(): keep TalkSigning.leave(); add TalkSpeaking.leave(); before it.
```
(`onLeaveSpeaking` currently exists as an empty stub — replace it; `showScreen` already calls both hooks on real transitions.) The new IIFE:

```js
    // ── Screen 04 — real speech + sign preview (js/talk-speaking.js, js/sign-player.js) ──
    (function () {
      var screen = document.getElementById('screen-speaking');
      var input = document.getElementById('speaking-input');
      var translateBtn = document.getElementById('speaking-translate');
      var editBtn = document.getElementById('speaking-edit');
      var sendBtn = document.getElementById('speaking-send');
      var chipEn = document.getElementById('chip-lang-en');
      var chipFil = document.getElementById('chip-lang-fil');

      speakingPlayer = SignPlayer.create({
        container: document.getElementById('speaking-sign-frame'),
        wordLabel: document.getElementById('speaking-sign-word'),
        getLanguage: function () { return TalkSpeaking.getLanguage(); }
      });

      function setState(name) { screen.setAttribute('data-speaking', name); }
      function refreshTranslate() {
        translateBtn.disabled = input.value.trim() === '' || TalkSpeaking.isCapturing();
      }
      function syncChips() {
        var fil = TalkSpeaking.getLanguage() === 'fil-PH';
        chipEn.classList.toggle('active', !fil);
        chipFil.classList.toggle('active', fil);
        chipEn.setAttribute('aria-pressed', fil ? 'false' : 'true');
        chipFil.setAttribute('aria-pressed', fil ? 'true' : 'false');
      }
      resetSpeakingUi = function () { setState('compose'); refreshTranslate(); syncChips(); };

      TalkSpeaking.init({
        onChange: refreshTranslate,
        onMicError: function () {
          openModal('error', {
            heading: 'Microphone not available',
            message: 'I cannot hear anything.',
            buttonLabel: 'Type instead'
          });
        }
      });

      input.addEventListener('input', refreshTranslate);
      chipEn.addEventListener('click', function () { TalkSpeaking.setLanguage('en-US'); syncChips(); });
      chipFil.addEventListener('click', function () { TalkSpeaking.setLanguage('fil-PH'); syncChips(); });

      // Translate is the ONLY trigger (no auto-play on speech end or a typing pause).
      translateBtn.addEventListener('click', function () {
        if (translateBtn.disabled) return;
        input.blur();                       // lowers the virtual keyboard if it is up
        setState('preview');
        sendBtn.disabled = input.value.trim() === '';
        // js/sign-player.js's normalizeSpeechText does not strip '?' (nor does script.js's), so
        // the '?' formatGrammar adds to a spoken sentence would become part of the last token
        // ("you?") and break matching. Pass the text without '?' — the input keeps it for Send.
        speakingPlayer.play(input.value.replace(/[?]/g, ''));
      });
      editBtn.addEventListener('click', function () {
        speakingPlayer.cancel();
        resetSpeakingUi();                  // back to compose, text kept
      });
      // Registered AFTER the untouched Send handler above, so it runs after it: the message
      // is already in the confirm card; cancel the preview and return to an empty compose.
      sendBtn.addEventListener('click', function () {
        speakingPlayer.cancel();
        resetSpeakingUi();
      });
    })();
```
(Registration order matters: the existing Send handler is registered first, in the earlier IIFE; verify the listeners run in that order by checking the confirm card shows the typed text.)

- [ ] **Step 6: Verify (real Chrome via the scratch harness `cdp.mjs`; fake camera flag on; viewport 1024×600).** Report measured values for each:
  1. Plain `talk.html`: zero console errors; reach Speak or Type after the queue settles: compose state shows chips, mic, `[input | Translate]`; `#speaking-translate.disabled === true`; `#speaking-preview` not visible; exactly **one** visible orange element (`#speaking-translate`; the parked keyboard's HIDE key is pre-existing and off-stage).
  2. Type "hello" → Translate enables; whitespace only → stays disabled; empty → disabled. Enter key in the input does nothing.
  3. Tap Translate: `data-speaking="preview"`; compose rows not visible; `#speaking-preview` visible **in the same column** (`#screen-speaking` box unchanged: same `getBoundingClientRect()` before/after); `#speaking-sign-word` shows `HELLO`; `#speaking-send` enabled at once; exactly one visible orange (`#speaking-send`); `document.documentElement.scrollWidth === 1024`; `#speaking-sign-frame` 560×260; Edit/Send each ≥60 px tall.
  4. Edit: back to compose, input still "hello", playback stopped (no further `<video>` activity; `speakingPlayer.isPlaying()` false via a page-scope handle or by observing the frame empty).
  5. Send from preview: the confirm card shows `You said` / the typed text / `from:'hearing'` (accept → `.bubble-row.hearing` in the thread with the text only); `#thread-list` contains **no** `video`/`img` after; screen is compose with empty input, Translate disabled.
  6. Keyboard raised in compose (focus the input): chips and mic hidden together, input row bottom (turn 1 and turn 2+) at or above y = 360 − 16; after HIDE/blur, chips and mic return to their exact previous boxes (compare `getBoundingClientRect()` before/after: identical). Translate while the keyboard is up lowers it (`body.classList.contains('keyboard-active') === false` afterwards).
  7. Layout budget: turn 2+ (append a bubble first) compose block and preview block both fit inside y = 186…600; report the top/bottom of the tallest child in each state.
  8. Language: click Filipino → chip classes flip, mic disabled with the Filipino label, typing "kamusta" + Translate plays `assets/signs/fil/kamusta.webm` (request seen); click English → mic re-enabled.
  9. Leaving mid-playback (`showScreen('thread')` via Back with messages present, or Add) stops playback and `<video>` requests; re-entering Speak shows compose.
  10. `grep -n "SPOKEN_CANNED_POOL\|pickCanned" talk.html` → nothing; the diff of the Send click handler and the `input` listener is empty (report `git diff -U0` hunk headers touching those lines: none).
  11. `git diff --stat` = `talk.html` only.

- [ ] **Step 7: Commit.** `git add talk.html && git commit -m "talk: Speak or Type — real mic, Translate, in-place sign preview, language chips"` (ends with the Co-Authored-By line).

### Task 4 — End-to-end verification (controller-run, measured, cited; harness stays in the scratchpad)
Real Chrome + CDP as last phase, plus a **synthesized speech WAV** (Windows SAPI via PowerShell, `--use-file-for-fake-audio-capture`) so Vosk transcribes real audio automatically.
- Sign-video timing & fallback chain, three cases per language: known word (`hello` en — expect clip 2.00 s + 2000 ms hold), unknown word (fingerspell, e.g. `xyz` — expect the three letter clips in order), fully unmatched (single char, e.g. `5` — expect the chain to reach the `fallback.png` request; outcome per Open question 1). Timings measured with `performance.now()` around `play()` and reported next to the clip durations above.
- Translate gating (disabled/enabled with empty, whitespace, typed, and mic-filled text); `scrollWidth` 1024 in every new state; zero console errors; idempotency (Apache access log: model fetched once; `getUserMedia` audio count = taps; tracks ended after leave); Send → confirm → Add unchanged (`from:'hearing'`, thread bubble text only, no media node in the thread); Filipino toggle: no crash, mic disabled, typing plays `fil/` clips; mic failure card (denied permission).
- Real-mic accuracy, kiosk-distance legibility, and Pi behaviour stay **manual** (Task 5).
**Done:** every item in the task list's "Automated" testing scope has an actual measured value beside its target; anything not measurable is said so.

### Task 5 — Docs (own commit, before retirement)
`docs/system/UI.md` (Speak or Type states: compose, preview, gating, measured layout), `DECISIONS.md` (every decision settled), `MANUAL-CHECKS.md` (new section: real speech on this machine's mic, video legibility at kiosk distance, Filipino toggle doesn't crash), `CLAUDE.md` (Speak or Type is now real; script.js retirement noted only after Task 7). `DEBT.md` item 53 stays open with a note that it is still English-only by design of this phase; new items for the missing `fallback.png` (if not added), missing FIL alphabet, tiny 360-px clips, `ScriptProcessorNode` still deprecated (item 33 carried into `talk-speaking.js`), `style.css` dead `#translator-pane` rules.

### Task 6 — (folded into Task 4/5 review) whole-branch review
Final whole-branch review on the most capable model over Tasks 1–5 (same as last phase); one fix wave; then Task 7. (Not a separate implementation task.)

### Task 7 — Retirement commit (own final commit, only after Task 4 evidence + final review)
**Files:** modify `index.html`; `git mv js/script.js archive/script.js`; add `archive/TEXT-TO-SIGN-PANE.md` (short note: what moved where, as `archive/SIGN-TO-TEXT.md`).
**Done criteria (all measured):**
- Removed: `#translator-pane` section, its inline `<style>` (`:16-545`), inline script (`:754-823`), `<script>` tags for `js/vosk.js` and `js/script.js` (`:751-752`), `#welcome-btn` + its comment. `virtual-keyboard.js` tag/css: dropped only if the dashboard is verified unchanged.
- **DEBT item 44 resolved, with evidence:** `grep -n "translator-pane\|sign-to-text\|screen=voice\|welcome-btn\|tts-\|script.js\|vosk" index.html` returns nothing; `grep -rn "screen=voice\|sign-to-text.html" --include=*.html --include=*.js --include=*.php --include=*.sh` (excl. `archive/`, `docs/`) returns nothing; `http://localhost/SKR/index.html?screen=voice` loads the plain dashboard.
- Dashboard verified unchanged: the four cards' bounding boxes and computed styles identical before/after (measured), `scrollWidth` 1024, zero console errors, all four links navigate; `talk.html` still works end to end afterwards (harness re-run).

### Task 8 — Final docs commit
Close `DEBT.md` item 44 citing the retirement commit hash; update `docs/system/INVENTORY.md` / `HARDWARE_BOOT.md` / `UI.md` mentions of `script.js` and `#translator-pane`; `CLAUDE.md` if the Speak-or-Type description changed.

## Testing scope → where each item is measured

| Item | Target | Task |
|---|---|---|
| Sign-video sequence timing, known word | ≈ clip duration + 2000 ms hold (`script.js:940`) | 4 |
| Fingerspell, unknown word | letter clips in order, one after another | 4 |
| Fully unmatched word | reaches the `fallback.png` step; result per Open question 1 | 4 |
| Translate disabled until text | disabled for empty/whitespace | 3, 4 |
| `document.scrollWidth` | 1024 in every new state | 3, 4 |
| Console errors | 0 | 3, 4, 7 |
| `git diff --stat` | exactly the files each task lists | each task, 7 |
| Real speech on this mic; video legible at distance; Filipino doesn't crash | human | 5 |

## Self-review

- **Spec coverage:** real Vosk capture (T2), word-by-word player reusing the pipeline (T1), explicit Translate + in-place panel swap + text-only thread + unchanged Send (T3), language toggle carry-over (T3, Open Q2), retirement + DEBT 44 (T7/T8), investigations §1–4 answered, docs (T5/T8), manual checks (T5).
- **Contradictions surfaced rather than silently resolved:** missing `fallback.png` vs the spec's fallback chain and test; the language toggle the spec says "carries over" but `talk.html` no longer has; "Send unchanged" vs Send having to move out of the compose row; "sign preview plays before send" vs a per-word ~4 s wait.
- **No placeholders in scope:** every open item is an owner question above, not a TBD.
