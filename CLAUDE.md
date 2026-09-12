# Sining Kamay (SKv2)

Offline Filipino Sign Language translation kiosk. Client-side vanilla
JavaScript/HTML5/CSS3, no framework, no build step. MediaPipe Hands (WASM) does
hand-landmark detection; TensorFlow.js and a hand-rolled cosine-similarity k-NN
(depending on screen) do sign classification, both on-device. PHP 8 + MySQL/
MariaDB on Apache handle admin functions and history/translation logging only —
never live inference. Target hardware is a Raspberry Pi 4B 8GB, CPU-only,
Chromium in kiosk mode. An earlier revision was abandoned mid-migration; expect
dead code and half-migrated paths until `docs/system/DEAD_CODE.md` is acted on.

## Hard rules

- **Offline only.** No fetch to the internet, no CDN, no external API, ever.
  (Known current violations are tracked in `docs/system/DEBT.md` — do not add more.)
- **No build step.** No npm, no webpack, no bundler. Files are served as-is.
- **No framework.** No React, Vue, or jQuery. Vanilla JS/DOM only.
- **Raspberry Pi 4B is the target, not a laptop.** CPU only, no GPU.
- **PHP touches admin/history only, never the live translation path.**

## Where to read for what

| Working on... | Read |
|---|---|
| Any screen's UI, camera/translation flow, gesture training, admin/reports pages | [docs/system/UI.md](docs/system/UI.md) |
| PHP endpoints, MySQL schema, ffmpeg invocations | [docs/system/BACKEND.md](docs/system/BACKEND.md) |
| Kiosk boot, Chromium flags, Vosk speech model, Pi-specific constraints | [docs/system/HARDWARE_BOOT.md](docs/system/HARDWARE_BOOT.md) |
| MediaPipe/TF.js vendored libraries themselves | [docs/system/VENDORED.md](docs/system/VENDORED.md) |
| Where inference is actually called from (pointer only) | [docs/system/ML.md](docs/system/ML.md) |
| What's safe to delete outright | [docs/system/DEAD_CODE.md](docs/system/DEAD_CODE.md) |
| Known bugs, security issues, inconsistencies, ranked | [docs/system/DEBT.md](docs/system/DEBT.md) |
| Full file-by-file inventory, load order, entry points | [docs/system/INVENTORY.md](docs/system/INVENTORY.md) |

Every number in `docs/system/` is cited by file and line, or marked "not
specified in code" — trust those documents over this file's prose if they ever
disagree, and prefer them over re-reading the full codebase.
