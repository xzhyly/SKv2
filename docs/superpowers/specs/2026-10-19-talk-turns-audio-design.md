# Let's Talk turns, sign audio, avatar-only playback — design

Date: 2026-10-19 · Branch: accounts-quiz · Wireframes: docs/design/talk-flow-wireframe.html, docs/design/sign-audio-wireframe.html

## Goal
Two-person conversation on the 1024×600 kiosk: the PWD signs, the non-PWD speaks or types. Fewer taps, the hearing person hears what was signed, and every sign shown to the PWD comes from the avatar.

## 1. Turns
- Two users only. PWD = Sign screen (camera; no typing). Non-PWD = Speak/Type screen (mic + keyboard, existing).
- After every Send the app returns to the existing "Whose turn is it?" screen (Sign / Speak or Type / End Conversation). Unchanged.
- Shortcut inside a turn, one button each way:
  - Sign screen: "🗣 Speak or Type" → straight to the Speak/Type screen.
  - Speak/Type screen: "🤟 Sign instead" → straight to the Sign screen.
- An unsent signed sentence is kept while away and restored on return; it is cleared only by Send or "+ New conversation".

## 2. PWD Send (sign → text → voice)
- The Sign screen's main button is "Send 🔊" (replaces Translate / Stop & Add). It adds the message to the conversation immediately (no popup) and plays it automatically in the current language (EN/FIL).
- Playback: for each sign in the sentence, in order, play that sign's recorded audio for the language; a sign with no recording is read by the browser voice (speechSynthesis); if no voice exists, it is skipped silently.
- Every signed message bubble has 🔊: tap = replay, tap while playing = stop. Only one message plays at a time.

## 3. Non-PWD Send (speech/text → avatar)
- Translate shows the avatar filling the whole area under the top bar (conversation strip hidden while it plays), with a caption that highlights the current word or letter and a bottom bar: Replay / Edit / Send.
- Send adds the message directly. The "You said … → Add to Conversation / Try again" popup is removed (Edit covers try again).

## 4. Avatar-only playback (no videos)
- A word/phrase whose sign has avatar data → the avatar plays it.
- Otherwise the avatar fingerspells it with the letter signs a–z and number signs 1–10 (other numbers spelled digit by digit; a character with no sign appears only in the caption).
- The old video path (assets/signs/**/*.webm, fallback.png, the hard-coded word→.webm map in js/sign-player.js) is removed from Let's Talk, Learn Signs and Quiz. The asset files are deleted from the repo only when nothing references them.

## 5. Sign audio (data)
- Stored with each sign: saved_gestures/<key>/audio_en.<ext>, audio_fil.<ext> (next to sign.json; copied to the Pi with saved_gestures). Letters: English only. Accepted: webm (mic), mp3, m4a, wav, ogg; ≤ 2 MB.
- Admin UI: an Audio section in the existing Train Gestures sign details — Record (MediaRecorder, preview before save), Upload, Play, Delete per language — and a 🔊 marker in the sign list. No new page; avatar-clips unchanged.
- Upload/delete API is admin-only (same guard as other admin APIs). Reading audio is public (needed by Let's Talk).

## Must not change
Recognition, compile and model files, avatar rendering/retargeting, Vosk speech input, conversation save format (only who/when it is called), accounts/quiz behaviour.

## Done when
- Turn switch both ways works mid-turn; unsent signed sentence survives a round trip.
- PWD Send adds + speaks; 🔊 replays/stops; mixed recorded/browser voice works.
- Avatar full screen, no popup on Send.
- A word with no sign is fingerspelled by the avatar; no .webm is requested by any page (network log).
- Record/upload/delete audio in Train Gestures; files land in saved_gestures/<key>/.
- 1024×600, no scroll, 0 console errors, existing tests pass; screenshots in the report.
