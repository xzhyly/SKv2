# Progress Log

## Session: 2026-09-12

### Current Status
- **Phase:** 1 - Pass 1 Inventory — COMPLETE, awaiting user approval before Pass 2
- **Started:** 2026-09-12

### Actions Taken
- Ran shell-only inventory: git ls-files, per-directory counts, per-file line counts
  (wc -l), size checks (du), grep-based script/link/fetch reference tracing across
  all HTML/JS/PHP files, SQL CREATE TABLE extraction (incl. UTF-16 decode of root
  sining_kamay_db.sql via iconv), start_kiosk.sh / SKR_Kiosk.desktop read for boot
  order.
- Wrote docs/system/INVENTORY.md (full file-by-file inventory, import/load graph,
  entry points, PHP endpoint list, MySQL table list, dead/orphaned file list,
  >5MB binary list).
- Committed as "docs: audit pass 1 - inventory".

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| n/a - documentation pass, no code tested | | | |

### Errors
| Error | Resolution |
|-------|------------|
| root sining_kamay_db.sql showed 0 CREATE TABLE matches via plain grep | File is UTF-16 encoded (MariaDB dump on Windows); decoded with `iconv -f UTF-16LE -t UTF-8` before grep, confirmed same 8 tables as the other two schema sources |

### Pass 2 dispatch (2026-09-12)
Launched 5 subagents in parallel via dispatching-parallel-agents skill, each with a
fully self-contained brief (system summary, exact owned file list, ACCURACY rule
quoted in full, Pass 3 section structure, explicit skip-list for js/main.js,
js/dist/build.js, docs/, instruction to report what could not be determined,
~1200-word cap):
- UI-A (Explore, agentId aa6fc05bcc8f6b0e0): camera-translator.html, sign-to-text.html
  + shared JS (db-api, db-local, gesture-data, camera-helper, speech-synthesis,
  sign-to-text-ui, virtual-keyboard) + their CSS -> docs/system/UI.md part 1
- UI-B (Explore, agentId a69b7fec3dbf7168f): index.html, script.js, vosk.js,
  gesture-training.html + gesture-training-ui.js, style.css, gesture-training.css,
  bulk-importer.html, reports.html, learn-signs.html + verify-only pass on
  camera_test/diagnostic/gesture_test/speech_test/preload.html + animate.css
  -> docs/system/UI.md part 2
- Backend (general-purpose, agentId acfb932bc4c159e3a): php/*, db-schema/*,
  sining_kamay_db.sql, scratch/trigger_sync.php -> docs/system/BACKEND.md
- Hardware/Boot (general-purpose, agentId ac499bde69b1cd549): start_kiosk.sh,
  SKR_Kiosk.desktop, models/, pi guides + citation-only cross-refs into vosk.js/
  camera-helper.js -> docs/system/HARDWARE_BOOT.md
- Vendored+ML (Explore, agentId aa21959f7c85b208e): js/lib/* + grep-only pass over
  4 UI files for inference call sites -> docs/system/VENDORED.md + docs/system/ML.md

Each agent returns a draft + problems list capped ~1200 words. Orchestrator writes
each draft to disk verbatim as it arrives and commits individually (not batched).
DEAD_CODE.md has no subagent - orchestrator writes it directly from
INVENTORY.md Section 6 in Pass 3.

### Key findings for the Pass 1 report to user
- Actual core code: ~20,560 lines (html+js-excl-lib+php+css), close to but above
  the "roughly 17,000" estimate in the brief.
- js/main.js + js/dist/build.js + package.json = dead browserify/babel/deeplearn
  toolchain from the abandoned earlier revision; not wired into any current HTML.
- 4 standalone dev/test HTML pages (camera_test, diagnostic, gesture_test,
  speech_test) have zero inbound/outbound links - orphaned.
- camera-translator.html and bulk-importer.html have NO navigation reference
  anywhere in the repo (not even via JS) - unclear how they're reached at runtime.
  Likely opened directly by URL/second-screen, not confirmed. Needs hardware-layer
  investigation in Pass 2, not resolvable by static grep.
- Deployment path inconsistency: start_kiosk.sh uses /SKR/, but several JS files
  hard-code a /Sining_kamay/ fallback base URL (old project name). Half-migrated.
- 9 of 12 root HTML files load fonts.googleapis.com - contradicts the "fully
  offline, no CDN" hard rule in the system brief. Real discrepancy, not fixed.
- php/admin_api.php, php/auth.php, php/api/save_history.php,
  php/api/get_history.php have no caller anywhere in the tracked frontend.
- docs/ (37 files) appears to be leftover documentation from the abandoned prior
  revision - not verified against current code, flagged for Pass 2 skepticism.
