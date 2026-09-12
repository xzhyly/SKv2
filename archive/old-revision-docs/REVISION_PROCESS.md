# Revision Process

Date created: 2026-06-05

This project follows a strict UI-first approval workflow.

## Required Process

1. Analyze file
2. Create revision report
3. Wait for approval
4. Modify file
5. Generate completion report
6. Wait for approval
7. Move to next file

## Approval Rule

Never skip approval.

## File Order

1. `style.css`
2. `index.html`
3. `camera-translator.html`
4. `train-gestures.html`
5. `reports.html`

## Phase A: Analysis

For each file:

- Analyze current structure and UI role.
- Identify current issues.
- List planned changes.
- Define expected UI result.
- Document risk level.
- Stop and wait for user approval.

## Phase B: Approved Modification

After approval:

- Apply only approved UI changes.
- Do not touch backend, API, database, or deployment behavior.
- Generate completion report.
- Include files modified, screens affected, verification results, and next recommended file.
- Stop and wait for user approval before continuing.

## Guardrails

- No source file may be modified during an analysis-only step.
- No parallel editing.
- No skipped files.
- No hidden backend changes.
- Every change must support the 1024 x 600 no-scroll kiosk layout.
