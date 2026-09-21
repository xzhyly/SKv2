# sign-to-text.html — archived 2026-09-21

`sign-to-text.html` was the standalone camera translator screen. It was
retired when its camera UI was merged into `talk.html`'s signing screen
(`docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md`), so that
switching between signing and speaking no longer reloads TF.js, MediaPipe and
Vosk from scratch.

Unlike `camera-translator.html`, this page **worked** — it is archived because
it was replaced, not because it was broken. Where its pieces live now:

- Recognition logic (`knnPredict`, `autoTrainForTranslate`, label translation,
  `formulateSmartSentence`): still `js/sign-to-text-ui.js`, now loaded by
  `talk.html`'s loading queue (`js/talk-loader.js`).
- Prediction loop, camera lifecycle, ESL/FSL and Hand Guide toggles:
  `js/talk-signing.js`.
- The 3-step Guide text: copied into `talk.html`'s `#signing-guide`.
- Not carried over: the Result screen (Speak / Copy / Clear / Save Log /
  Translate Again), the output volume slider, the "Translate Text to Sign"
  header link, DB history saving, speaking the sentence aloud.

Its stylesheet `css/sign-to-text.css` is now unused (`docs/system/DEBT.md`
item 50). The archived copy links `css/`/`js/` paths relative to the repo
root, so it will not render correctly from `archive/` — it is a record, not a
page to serve.

Open item for the owner: `index.html:653` (`#translator-pane`'s "Translate Sign
to Text" link) still points at `sign-to-text.html` and is now dead
(`docs/system/DEBT.md` item 44).
