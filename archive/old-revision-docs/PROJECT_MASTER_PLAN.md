# Project Master Plan

Date created: 2026-06-05

## UI-First Development Plan

This plan governs the Sining Kamay kiosk UI revision. The work is limited to visual, layout, navigation, and interaction refinement for a 1024 x 600 kiosk display.

No backend, API, database, or Raspberry Pi deployment behavior may be changed during this UI-first revision phase.

## Current Progress

- Documentation scaffold created.
- Project scanned for UI-related files.
- First revision target completed through modification: `style.css`.
- User approved `style.css` completion.
- Second revision target completed through modification: `index.html`.
- User approved `index.html` completion.
- Third revision target analyzed: `camera-translator.html`.
- Architecture Review Addendum added for `camera-translator.html`.
- `train-gestures.html` resolved and approved by architecture decision.
- Gesture training remains integrated inside `camera-translator.html`.
- `camera-translator.html` UI-first revision applied.
- User approved `camera-translator.html` completion.
- `reports.html` UI-first revision applied.
- User approved `reports.html` completion.
- Phase 1 complete.
- Phase 2 UI Review generated.
- Awaiting user approval before final polish.

## Current Phase

Phase 2: UI Review. Current checkpoint: Phase 2 UI Review approval.

## Pending Tasks

Phase 1 - Status: Complete

- [x] `style.css`
- [x] `index.html`
- [x] `camera-translator.html`
- [x] `train-gestures.html` resolved
- [x] `reports.html`

Phase 2

- [x] UI Review
- [ ] Navigation Review
- [ ] Final Polish

Phase 3

- [ ] Deployment

## Completed Tasks

- [x] Create `/docs`
- [x] Create `/docs/revisions`
- [x] Create required master documentation files
- [x] Create required per-file report files
- [x] Scan project for UI-related files
- [x] Generate `style-css-report.md` only
- [x] Apply approved `style.css` UI-only revision
- [x] Generate `style.css` completion report
- [x] Receive approval for `style.css` completion
- [x] Generate `index-html-report.md`
- [x] Apply approved `index.html` UI-first revision
- [x] Generate `index.html` completion report
- [x] Receive approval for `index.html` completion
- [x] Generate `camera-translator-report.md`
- [x] Add `camera-translator.html` Architecture Review Addendum
- [x] Resolve `train-gestures.html` by architecture decision
- [x] Receive approval for `train-gestures.html` resolution
- [x] Apply approved `camera-translator.html` UI-first revision
- [x] Generate `camera-translator.html` completion report
- [x] Receive approval for `camera-translator.html` completion
- [x] Generate `reports-html-report.md`
- [x] Apply approved `reports.html` UI-first revision
- [x] Generate `reports.html` completion report
- [x] Receive approval for `reports.html` completion
- [x] Complete Phase 1
- [x] Generate `PHASE_2_UI_REVIEW.md`

## Current Architecture Decision

For the current UI-first phase, gesture training should remain integrated inside `camera-translator.html`.

Reason: the training flow is tightly coupled to camera setup, TensorFlow model state, saved gesture loading, prediction, translation, and the existing `?screen=translate` mode. Creating `train-gestures.html` now would likely require behavior/state refactoring beyond the approved UI-only scope.

## train-gestures.html Resolution

Status: Resolved and Approved

Resolution: Gesture training remains integrated inside `camera-translator.html`.

Reason: Creating `train-gestures.html` would require architecture and behavior changes outside the approved UI-only scope.

Source code changes: None for this resolution step.

## Revision Rules

- Follow the exact revision order.
- Analyze one file at a time.
- Generate the report before editing.
- Stop and wait for user approval after each report.
- Modify files only after approval.
- Generate a completion report after each approved modification.
- Stop and wait for approval before moving to the next file.
- Do not modify backend, API, database, or Raspberry Pi deployment files.
- Maintain the 1024 x 600 kiosk target.
- Avoid scrolling in final kiosk screens.
- Keep the dark theme and shared design system consistent.

## UI-Related Files Identified

- `style.css`
- `CSS/style.css`
- `index.html`
- `camera-translator.html`
- `reports.html`
- `script.js`
- `main.js`
- `gesture-data.js`
- `db-api.js`

## Notes

`train-gestures.html` was not found in the current project scan on 2026-06-05 and is resolved by architecture decision. The active training workflow remains inside `camera-translator.html`; older training logic appears in `main.js` with supporting styles in `CSS/style.css`.
