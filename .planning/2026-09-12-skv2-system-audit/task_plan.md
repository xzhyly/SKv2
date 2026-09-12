# Task Plan: SKv2 Documentation Audit (pre-revision)

## Goal
Produce an accurate, code-cited documentation set in docs/system/ so future revision
sessions do not need to re-read the full 17,000-line codebase. Audit only — no code
changes, no improvement suggestions yet.

## Next Step
User approved Pass 1 layer split with 3 changes (see findings.md). Dispatch the
5 Pass 2 subagents (UI-A, UI-B, Backend, Hardware/Boot, Vendored+ML) in one
message via the dispatching-parallel-agents skill. Write each returned draft to
disk and commit as it arrives.

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
- [ ] Use dispatching-parallel-agents skill, one subagent per approved layer, single message
- [ ] Explore agents for read/map layers, general-purpose for DB/model/command layers
- [ ] Self-contained brief per agent: system summary, exact file list, ACCURACY rule
      quoted in full, Pass 3 section structure, "report what you could not determine",
      explicit skip-list (js/main.js, js/dist/build.js, docs/)
- [ ] Write each returned draft to disk as it arrives; commit each
- [ ] Split layer into two agents if too large for one (UI already split into UI-A/UI-B)
- **Status:** in_progress

### Phase 3: Pass 3 - Assemble
- [ ] Merge drafts into docs/system/, renumbered per approved list
- [ ] Each layer doc: Owns, What it does, How it works (cited), Key decisions
      (or "reason not documented in code"), Constraints (Pi 4B), Touches
- [ ] Write CLAUDE.md at repo root (router, <60 lines, hard rules, doc table)
- [ ] Write docs/system/DEBT.md (ranked, dead code + oversized files as own sections)
- [ ] Commit everything
- **Status:** pending

### Phase 4: PDF
- [ ] Markdown committed first
- [ ] Check if pandoc or another PDF tool is installed
- [ ] If installed: generate one PDF, cover page + TOC + one chapter per doc
- [ ] If not installed: say so, stop, do not install/work around
- **Status:** pending

### Phase 5: Delivery
- [ ] Final report to user
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use planning-with-files for cross-session audit state | User instruction; audit spans many sessions, context may run out mid-pass |
| No code-body reading in Pass 1 | User instruction; Pass 1 is shell-only structural inventory |

## Errors Encountered
| Error | Resolution |
|-------|------------|
