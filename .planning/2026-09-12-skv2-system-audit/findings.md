# Findings & Decisions

## Requirements
- User approved Pass 1's proposed layer split with 3 changes (2026-09-12):
  1. Add thin docs/system/ML.md — pointer doc only, says where inference logic
     lives inside UI files and which vendored lib backs each part. Not a study.
  2. docs/system/DEAD_CODE.md is a deletion manifest, not permanent documentation.
     List what goes + evidence it's unloaded, then stop. Ceases to exist once the
     code is deleted, so written by the orchestrator directly from Pass 1
     evidence in Pass 3 — no dedicated subagent for it.
  3. Pass 2 subagents must NOT read js/main.js, js/dist/build.js, or the
     docs/ folder (abandoned prior revision) — wastes budget on code about to be
     deleted. Evidence already gathered in Pass 1 (INVENTORY.md §6) is sufficient.

## Corrections for DEBT.md (record exactly, do not let a later pass re-litigate)
- The dual-screen / camera-translator.html+bulk-importer.html unreachability is
  PLANNED WORK, not a defect. Record in DEBT.md (or a "planned work" note) as
  such — not as a bug for a later session to go hunting for.
- The Google Fonts CDN calls (9 of 12 HTML files, per INVENTORY.md §6) are a
  REAL, HIGH-SEVERITY DEFECT: the kiosk has no internet, so these requests fail
  on every page load. Rank high in DEBT.md.

## Pass 2 layer assignments (approved split + ML.md addition)
| Layer | Doc | Agent type | Files |
|---|---|---|---|
| UI-A | docs/system/UI.md (part 1: translation/recognition screens) | Explore | camera-translator.html, sign-to-text.html, js/db-api.js, js/db-local.js, js/gesture-data.js, js/camera-helper.js, js/speech-synthesis.js, js/sign-to-text-ui.js, js/virtual-keyboard.js, css/sign-to-text.css, css/virtual-keyboard.css |
| UI-B | docs/system/UI.md (part 2: dashboard/training/admin screens + orphan-page verification) | Explore | index.html, js/script.js, js/vosk.js, gesture-training.html, js/gesture-training-ui.js, css/style.css, css/gesture-training.css, bulk-importer.html, reports.html, learn-signs.html, + verify-only: camera_test.html, diagnostic.html, gesture_test.html, speech_test.html, preload.html, css/animate.css |
| Backend | docs/system/BACKEND.md | general-purpose (mysql skill) | php/*, php/api/*, db-schema/*, sining_kamay_db.sql, scratch/trigger_sync.php |
| Hardware/Boot | docs/system/HARDWARE_BOOT.md | general-purpose (inspects model file) | start_kiosk.sh, SKR_Kiosk.desktop, models/, raspberry_pi_connection_guide.md, raspberry_pi_startup_guide.md + citation-only cross-refs into js/vosk.js and js/camera-helper.js for hardware-relevant constants |
| Vendored+ML | docs/system/VENDORED.md + docs/system/ML.md | Explore | js/lib/* (all files) + grep-level (not full-read) pass over js/gesture-data.js, camera-translator.html, js/sign-to-text-ui.js, js/gesture-training-ui.js to find inference/model-call sites |

DEAD_CODE.md: written directly by orchestrator in Pass 3 from INVENTORY.md §6
evidence. No subagent.

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
- docs/system/INVENTORY.md — Pass 1 output, source of truth for file lists/line counts feeding Pass 2 briefs
