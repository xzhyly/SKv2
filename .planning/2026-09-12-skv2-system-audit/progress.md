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
