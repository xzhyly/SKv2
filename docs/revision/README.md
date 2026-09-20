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
