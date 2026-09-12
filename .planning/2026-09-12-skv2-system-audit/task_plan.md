# Task Plan: SKv2 Documentation Audit (pre-revision)

## Goal
Produce an accurate, code-cited documentation set in docs/system/ so future revision
sessions do not need to re-read the full 17,000-line codebase. Audit only — no code
changes, no improvement suggestions yet.

## Next Step
Audit complete: docs/system/ (INVENTORY, UI, BACKEND, HARDWARE_BOOT, VENDORED,
ML, DEAD_CODE, DEBT), CLAUDE.md, all committed. No PDF tool available - not
generated. Report final summary to user; nothing further planned unless user
requests changes or a fresh session picks up the revision work itself.

## Current Phase
Phase 1

## Phases

### Phase 1: Pass 1 - Inventory (shell only, no code-body reading)
- [ ] File tree with line count per file
- [ ] Import graph (which module imports which)
- [ ] Entry points and boot order from index.html
- [ ] List of PHP endpoints
- [ ] List of MySQL tables (schema files or queries)
- [ ] Dead/orphaned/half-finished files flagged
- [ ] Binary/vendored files over 5MB flagged with size
- [x] Write docs/system/INVENTORY.md
- [x] git commit
- [x] STOP - report layer boundaries, proposed docs, surprises to user. WAIT for approval.
- **Status:** complete

### Phase 2: Pass 2 - Deep dive (subagents, only after user approval)
- [x] Get user approval on layer boundaries + doc list from Pass 1 (with 3 changes, see findings.md)
- [x] Use dispatching-parallel-agents skill, one subagent per approved layer, single message
- [x] Explore agents for read/map layers, general-purpose for DB/model/command layers
- [x] Self-contained brief per agent: system summary, exact file list, ACCURACY rule
      quoted in full, Pass 3 section structure, "report what you could not determine",
      explicit skip-list (js/main.js, js/dist/build.js, docs/)
- [x] Write each returned draft to disk as it arrives; commit each
- [x] Split layer into two agents if too large for one (UI split into UI-A/UI-B)
- **Status:** complete

### Phase 3: Pass 3 - Assemble
- [x] Merge drafts into docs/system/ (agents already used final names, no renumbering needed)
- [x] Each layer doc: Owns, What it does, How it works (cited), Key decisions
      (or "reason not documented in code"), Constraints (Pi 4B), Touches
- [x] Write CLAUDE.md at repo root (router, 36 lines, hard rules, doc table)
- [x] Write docs/system/DEBT.md (ranked, dead code + oversized files as own sections)
- [x] Write docs/system/DEAD_CODE.md (deletion manifest, not permanent doc)
- [x] Commit everything
- **Status:** complete

### Phase 4: PDF
- [x] Markdown committed first
- [x] Check if pandoc or another PDF tool is installed - checked pandoc, wkhtmltopdf,
      weasyprint via `which`/`where` - none found
- [ ] If installed: generate one PDF, cover page + TOC + one chapter per doc
- [x] If not installed: say so, stop, do not install/work around - STOPPED, reported to user
- **Status:** complete (no PDF generated - no tool available, per instructions)

### Phase 5: Delivery
- [ ] Final report to user
- **Status:** in_progress

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use planning-with-files for cross-session audit state | User instruction; audit spans many sessions, context may run out mid-pass |
| No code-body reading in Pass 1 | User instruction; Pass 1 is shell-only structural inventory |

## Errors Encountered
| Error | Resolution |
|-------|------------|
