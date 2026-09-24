# Revision Pipeline Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (recommended — this is one task, no parallel work to gain from
> subagent-driven-development) or superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Create `docs/revision/` in the SKv2 repo — `README.md`, `RULES.md`,
`MEMORY.md` — the scaffold the Cowork -> Claude Code -> Antigravity -> Cowork
revision pipeline runs on. No cycle folders yet; this is the one-time setup.

**Architecture:** Single task, three new files, one commit. Content is
copied from the approved spec, not invented — this plan exists so the exact
text is locked before it's written.

**Tech Stack:** Plain Markdown, git. No build step, no tests to run — SKv2
has none (see `docs/superpowers/specs/2026-09-20-revision-pipeline-design.md`).

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-09-20-revision-pipeline-design.md`.
  Read it before writing anything if any content below looks off — this
  plan copies it verbatim, but the spec wins on conflict.
- Create exactly 3 files. Touch nothing else in the repo.
- Do not create any `NNN-<slug>/` cycle folder — that happens on the first
  real revision cycle, not in this bootstrap.
- One commit for all three files.

---

### Task 1: Create docs/revision/ scaffold

**Files:**
- Create: `docs/revision/RULES.md`
- Create: `docs/revision/MEMORY.md`
- Create: `docs/revision/README.md`

**Interfaces:**
- Produces: the `docs/revision/` folder that every future REVISE/REPORT
  cycle is written into, per the design spec's Folder structure section.

- [ ] **Step 1: Create the folder and write RULES.md**

```bash
mkdir -p docs/revision
```

Write `docs/revision/RULES.md` with exactly this content:

```markdown
# docs/revision — rules

Every REVISE and REPORT file in this pipeline points back to this file.
Read MEMORY.md too before acting on either.

1. Read MEMORY.md first, every time — its conventions and "do not touch"
   list are binding.
2. Scope is exactly what the file you're reading names. No "while I'm here"
   fixes, no unrelated refactors.
3. Never estimate or invent a number. Cite file:line or measure it. If it's
   not in the code, write "not specified" — never guess.
4. Claude Code's job stops at writing the REVISE file. It never edits code
   in this pipeline.
5. Antigravity executes exactly what's in the REVISE file. Light item:
   locate it, apply the described fix. Precise item: use the exact
   FIND/REPLACE given, no undeclared deviation.
6. If a REVISE item doesn't match current code (already fixed, moved, gone)
   — stop that item, mark it "skipped" in the REPORT with why. Don't
   substitute your own judgment for what it should be.
7. One commit per completed item. Message = FILE + one-line WHY.
8. Run the item's own VERIFY check before reporting it done — not "looks
   right."
9. Never touch a file that isn't named. `git diff --stat` at the end must
   match the named file list exactly.
10. Never touch reports.html or gesture-training.html unless a cycle names
    them explicitly (hover-removal there is still deferred).
```

- [ ] **Step 2: Verify RULES.md**

Run: `grep -c '^[0-9]\+\.' docs/revision/RULES.md`
Expected: `10`

- [ ] **Step 3: Write MEMORY.md**

Write `docs/revision/MEMORY.md` with exactly this content:

```markdown
# docs/revision — memory

Read before any REVISE.md is written or executed.

## Read before any cycle

- `docs/ui-target/README.md` — design spec, wins over any reference image
- `docs/system/DECISIONS.md` — settled decisions + why
- `docs/system/UI-SURVEY-1024x600.md` — see "two things this survey nearly
  got wrong" — measurement traps already hit in this project
- `docs/system/MANUAL-CHECKS.md` — what still needs a human to verify

## Conventions

- Screen: 1024x600, 172ppi, 67.7 px/cm
- Tap-target floor: 60x60px (8.9mm) — not 44px
- No `:hover` states anywhere (touchscreen kiosk) — use `:active`
- `reports.html` and `gesture-training.html`: hover-removal still deferred,
  do not touch unless a cycle explicitly names them

## Cycles

(none yet — add one line per cycle here as each is queued: `<slug> - queued`,
then update to `done` once its REPORT is reviewed)
```

- [ ] **Step 4: Verify MEMORY.md**

Run: `grep -c '^##' docs/revision/MEMORY.md`
Expected: `3`

- [ ] **Step 5: Write README.md**

Write `docs/revision/README.md` with exactly this content:

````markdown
# docs/revision — how this folder works

One-time read. This folder is the pipeline: Cowork writes the scope for a
revision -> Claude Code investigates the codebase and writes a REVISE file
-> Antigravity executes it and writes a REPORT file -> Cowork reviews the
REPORT against the REVISE file, single pass.

Full design: `docs/superpowers/specs/2026-09-20-revision-pipeline-design.md`

## Before touching anything here

Read `RULES.md` and `MEMORY.md` first. Every REVISE/REPORT file assumes you
already have.

## Structure

```
docs/revision/
├── README.md              (this file)
├── RULES.md                 (rules every REVISE/REPORT file follows)
├── MEMORY.md                  (links + cycle log)
├── 001-<slug>/
│   ├── <slug>.md                    REVISE — written by Claude Code
│   └── <slug>-REPORT.md             REPORT — written by Antigravity
└── 002-<slug>/...
```

One cycle = one topic = one numbered folder. Folder name and file slug
match — no generic `REVISE.md`/`REPORT.md` repeated across cycles.

## REVISE file format

Light (default):

```
FILE: <path>
ISSUE: <what's wrong>
FIX: <what to change>
WHY: <one line>
VERIFY: <a check that can be run>
```

Precise (add exact code) — required when the file is shared across pages,
the change is JS logic/state, it removes/renames something used elsewhere,
or an exact number matters:

```
FILE: <path>
ISSUE: <what's wrong>
FIX: <what to change>
FIND:
<exact current code>
REPLACE:
<exact new code>
WHY: <one line>
VERIFY: <a check that can be run>
```

## REPORT file format

One block per REVISE item:

```
ITEM: <copied from REVISE>
STATUS: done | deviated (+why) | skipped (+why)
CHANGED: <file:line or the diff>
VERIFY RESULT: <ran the VERIFY check — pass/fail + evidence>
```
````

- [ ] **Step 6: Verify README.md**

Run: `grep -c '^## ' docs/revision/README.md`
Expected: `4`

- [ ] **Step 7: Verify nothing else changed**

Run: `git status --porcelain docs/revision`
Expected: three `??` lines — `docs/revision/README.md`,
`docs/revision/RULES.md`, `docs/revision/MEMORY.md` — and nothing else
under `docs/revision`.

- [ ] **Step 8: Commit**

```bash
git add docs/revision/README.md docs/revision/RULES.md docs/revision/MEMORY.md
git commit -m "docs: bootstrap docs/revision pipeline scaffold (README, RULES, MEMORY)"
```

- [ ] **Step 9: Confirm the commit**

Run: `git show --stat -1`
Expected: exactly 3 files listed, all under `docs/revision/`, all marked
new (insertions only, no deletions).
