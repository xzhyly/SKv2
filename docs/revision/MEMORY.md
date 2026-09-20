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
