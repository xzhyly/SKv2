# Revision pipeline: Cowork -> Claude Code -> Antigravity -> Cowork

Date: 2026-09-20
Status: design, not yet built. Nothing in `docs/revision/` exists on disk yet.

## Why

Every SKv2 revision so far went Cowork (analyzes + writes a WORKORDER-*.md
with exact FIND/REPLACE) -> Claude Code (executes it). That worked
(WORKORDER-ui-polish.md, 9/9 commits confirmed) but puts all the analysis
tokens on Cowork and all the execution tokens on Claude Code's Pro quota.

New goal: split analysis and execution across three tools so each does only
what it's positioned to do well, and reduce total tokens by not writing full
FIND/REPLACE code for every edit.

## Roles

- **Cowork (this)** — designs the pipeline (this doc), writes the one-time
  bootstrap prompt, writes each cycle's *scope* (what Sk wants revised, in
  plain terms), and does the single-pass review of Antigravity's report
  against the REVISE file. Does not write code.
- **Claude Code** — has git + terminal + can run the app locally. Reads the
  scope, investigates the codebase, writes one REVISE file per cycle. Never
  edits code in this pipeline.
- **Antigravity** — agentic IDE (Gemini 3, editor+terminal+browser agents,
  already installed — confirmed via `.antigravity-ide` on Sk's machine).
  Reads the REVISE file, executes it, writes the matching REPORT file.
  Never invents scope beyond the REVISE file.

Single review pass by design: Cowork only, straight against the REVISE file.
No second pass by Claude Code — that would double the review tokens for
marginal extra safety, and the REPORT format below is structured
specifically so Cowork can check it without re-deriving the diff.

## Folder structure

```
docs/revision/
├── README.md              (how this folder works — one-time read)
├── RULES.md                (rules every REVISE/REPORT file points back to)
├── MEMORY.md                (links to the project's existing docs + cycle log)
├── 001-<slug>/
│   ├── <slug>.md                 <- REVISE, written by Claude Code
│   └── <slug>-REPORT.md          <- REPORT, written by Antigravity
├── 002-<slug>/
│   ├── <slug>.md
│   └── <slug>-REPORT.md
└── ...
```

One cycle = one topic = one folder, numbered in order. Folder name and file
slug match, so the filename alone says what it covers — no generic
`REVISE.md`/`REPORT.md` repeated across cycles.

`MEMORY.md` does **not** copy the content of `docs/system/DECISIONS.md`,
`docs/system/UI-SURVEY-1024x600.md`, `docs/system/MANUAL-CHECKS.md`, or
`docs/ui-target/README.md`. It links to them. Those stay the single source
of truth where they already are — copying them here would recreate the
exact drift problem this project already has with its 4 divergent CSS
`:root` blocks.

## REVISE file format

Every item is one of two shapes. Default to Light; use Precise only when a
trigger below applies.

**Light** (default):
```
FILE: css/style.css
ISSUE: .card-icon-highlight and .card-icon are equal specificity, .card-icon
       always wins, so the highlighted card's icon never renders orange
FIX: make the highlight selector more specific
WHY: spec says the highlighted card's icon should be orange
VERIFY: open the dashboard, Let's Talk's icon should be orange
```

**Precise** (adds exact current code + exact replacement):
```
FILE: css/style.css
ISSUE: (same as above)
FIX: (same as above)
FIND:
.card-icon-highlight { color: var(--orange, #f97316); }
REPLACE:
.card-icon.card-icon-highlight { color: var(--orange, #f97316); }
WHY: (same as above)
VERIFY: (same as above)
```

**Precise is required when any of these is true**, otherwise Light:
1. The file is shared across multiple pages (`css/style.css`,
   `css/virtual-keyboard.css`, `css/tokens.css`, `js/script.js` if the
   change touches a function used by more than one screen).
2. The change is to JS logic/state, not a CSS value.
3. The change removes or renames something used elsewhere (a function, a
   selector, an id) — Precise here doubles as the proof that nothing else
   references it.
4. An exact number matters (a px/mm size, a timing value) where "close
   enough" would be wrong.

Claude Code decides Light vs. Precise per item when writing the REVISE file,
using these four triggers — not asked per item.

## REPORT file format

One block per REVISE item, same ITEM wording, plus:
```
ITEM: <copied from REVISE>
STATUS: done | deviated (+ why) | skipped (+ why)
CHANGED: <file:line or the actual diff>
VERIFY RESULT: <ran the REVISE item's own VERIFY check — pass/fail + evidence>
```

`VERIFY RESULT` must be a real result, not "should be fine" — this is the
`verification-before-completion` discipline (see Skills below), applied per
item.

## RULES.md (full content, to be written verbatim into docs/revision/RULES.md)

```
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

## Claude Code prompt template (reusable per cycle)

```
Read docs/revision/MEMORY.md first.

Scope: <one line — what Sk wants revised>

Task: ANALYSIS ONLY. Do not edit code. Investigate the codebase, find every
file/line in scope, and write docs/revision/NNN-<slug>/<slug>.md following
docs/revision/RULES.md and the REVISE format in
docs/superpowers/specs/2026-09-20-revision-pipeline-design.md.

Also append one line to MEMORY.md's Cycles list: <slug> - queued.

Stop after writing the file. Do not execute anything.
```

## Skills

Checked before writing this: Sk's Cowork account skills (`SearchSkills`) and
the local `E:\SKILLS` folder Claude Code/Antigravity both read from
(confirmed: same skill set is installed for both).

- **Antigravity's execution step**: `strict-execution`, revised today
  (2026-09-20) to drop its Android/Gradle-specific "Compilation Gate" and
  replace it with a dynamic Lane A (agent can self-check — browser/file/
  script access) / Lane B (needs the human — build tooling, physical
  device) verification model. This was a shared skill used by Sk's other
  (Android) projects too, so the fix is general, not an SKv2-only patch.
  Stacked with `verification-before-completion` for the "no completion
  claim without fresh evidence" discipline on the REPORT's VERIFY RESULT.
- **Claude Code's analysis step**: no existing skill fits. `code-analyzer`
  was the closest by name but is built for short single-function/error
  answers (1-2 lines), not a full-codebase audit that writes a structured
  multi-item file — confirmed not a fit, and deleted from `E:\SKILLS`
  (2026-09-20) since it wasn't being used for anything else either. Plain
  prompt instructions (above) carry the discipline instead; no skill
  needed here (YAGNI).
- **Cowork's review step**: no skill; the REPORT format above is built to
  make the manual single-pass check fast without one.

## Bootstrap — who creates docs/revision/

Claude Code creates it (has git; this repo showed line-ending/mount
oddities when touched from Cowork's device bridge — see Open items). One
time only, via:

```
Create docs/revision/ with README.md, RULES.md, and MEMORY.md (content in
docs/superpowers/specs/2026-09-20-revision-pipeline-design.md — RULES.md
section verbatim, README.md explains the folder from this doc's Folder
structure + REVISE/REPORT format sections, MEMORY.md starts with links to
docs/system/DECISIONS.md, docs/system/UI-SURVEY-1024x600.md,
docs/system/MANUAL-CHECKS.md, docs/ui-target/README.md, plus an empty
Cycles list). Commit it as one commit.
```

## Out of scope / not decided here

- The first real cycle's content (e.g. the toast bug, uneven borders —
  currently still sitting in the old-pattern `docs/WORKORDER-ui-polish-2.md`,
  unexecuted). Whether that becomes cycle 001 under this new pipeline, or
  runs as-is under the old pattern, is Sk's call after this design ships.
- Anything about the sign-to-text/talk.html merge — separately still
  unapproved.

## Open items noticed while building this (not part of the design, flagging only)

- `git status` on SKv2 from Cowork's device bridge shows nearly every
  tracked file as modified, plus a stuck `.git/index.lock` it couldn't
  remove. Almost certainly a line-ending/mount artifact between this bridge
  and the Windows checkout, not real content changes — but Cowork did not
  run any `git add`/`git commit` here to avoid recording a bad diff. Worth
  a quick look in a real terminal on the machine itself before the next
  Claude Code session commits anything.
