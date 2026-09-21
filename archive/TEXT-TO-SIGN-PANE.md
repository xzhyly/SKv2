# index.html's #translator-pane and js/script.js — archived 2026-09-21

`index.html` used to contain a second full screen, `#translator-pane` ("TEXT TO SIGN — REDESIGNED PANE"),
reached by `index.html?screen=voice`: Vosk speech-to-text or typed text, an explicit Translate button, and a
word-by-word sign-video player. It was driven entirely by `js/script.js`. Both were retired when that
functionality was merged into `talk.html`'s Speak or Type screen
(`docs/superpowers/specs/2026-09-21-text-to-sign-merge-design.md`), so a conversation no longer reloads
Vosk/TF.js/MediaPipe between turns.

This page **worked** — it is archived because it was replaced, not because it was broken.

What was removed from `index.html`: the `#translator-pane` section, its inline `<style>` block (all of it was
pane / on-screen-keyboard / language-toggle rules — none was dashboard styling), its inline `<script>`, the
`js/vosk.js`, `js/script.js` and `js/virtual-keyboard.js` script tags, the `css/virtual-keyboard.css` link, the
hidden `#welcome-btn` compatibility button and the stale commented-out `preload.html` iframe. The dashboard
(`#dashboard-pane`, its four cards, `css/style.css`, `css/tokens.css`, `css/fonts.css`, the MediaPipe/TF
prefetch links) is unchanged. `index.html?screen=voice` now simply loads the dashboard. The pane's "Translate Sign
to Text" link to the archived `sign-to-text.html` went with it (`docs/system/DEBT.md` item 44).

Where the pieces live now:

- Sign lookup/playback pipeline (asset maps, phrase matching, custom video → static map → fingerspelling →
  `fallback.png`): `js/sign-player.js`, a port of a copy of `archive/script.js:19-141, 357-413, 838-1010`
  (the source line numbers cited in the new files refer to `archive/script.js`).
- Vosk microphone capture, transcript, Filipino mic-disable, USB-mic auto-select: `js/talk-speaking.js`
  (from `archive/script.js:161-337, 467-485, 511-816, 1012-1081`).
- Not carried over: the pane's mic-picker dropdown, its "Speech debugger" panel, the "Download History" button, the
  auto-translate on mic stop, the hidden `#status`/`#lang-select` compatibility elements.

`css/style.css` still carries dead `#translator-pane` rules (`docs/system/DEBT.md`).
