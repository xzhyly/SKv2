# Phase 2–3 Analysis Report — index.html

Date: 2026-06-09  
Scope: UI/UX only (no backend/API/DB/ML/gesture/deployment changes)  
Target kiosk: 1024 × 600 landscape, no-scroll public flows

## File

- Target file: `index.html`
- Supporting files already in use:
  - `style.css` (approved Phase 1 light-mode foundation)
  - `script.js` (must remain behavior-compatible)

## Phase Coverage

This analysis covers:

- Phase 2: Navigation Redesign
- Phase 3: Welcome Screen
- Partial Phase 4 prep inside the same file for the Voice/Text to Sign pane layout/content hierarchy

## Current State Summary

`index.html` currently contains two major screens in one file:

- Dashboard / Welcome screen: `#dashboard-pane`
- Voice/Text to Sign screen: `#translator-pane`

The file already uses semantic landmarks (`main`, `header`, `nav`, `section`) and connects correctly to the approved root stylesheet.

## Protected Hooks (Must Be Preserved Exactly)

These are directly used by `script.js` and must not be renamed or removed:

- Screen containers:
  - `#dashboard-pane`
  - `#translator-pane`
- Dashboard action:
  - `#welcome-btn`
- Voice/Text to Sign controls:
  - `#start-btn`
  - `#download-history-btn`
  - `#transcript`
  - `#status`
  - `#lang-select`
  - `#text-sign-input`
  - `#text-sign-btn`
- Sign display:
  - `#sign-container`
  - `#current-word`

Classes that should remain for current styling compatibility:

- `.title-container`
- `.title-sining`
- `.title-kamay`
- `.button-container`
- `.dash-btn`
- `.learning-btn`
- `.container`
- `.translator-card`
- `.translator-top-actions`
- `.translator-bottom-actions`
- `.main-layout`
- `.controls`
- `.display-area`
- `.language-selector`
- `.text-sign-entry`
- `.dashboard-link-btn`
- `.switch-mode-btn`

## Current UI/UX Problems In This File

### Welcome Screen

- Dashboard labels are still technical and not aligned with the approved plain-language plan:
  - `Learning`
  - `AI Train`
  - `Sign Language to Voice/Text`
  - `Reports`
- Public and admin/research actions are visually mixed in one undifferentiated list.
- The external Learning destination still leaves the kiosk experience and opens a new tab.
- The dashboard currently shows five actions in one stack, but there is no visual grouping to help first-time users distinguish primary translation flows from secondary/admin functions.

### Voice/Text to Sign Screen

- The title `Filipino Sign Language Translator` is broad and less task-oriented than the approved wording.
- `Download History` still appears alongside core translation controls even though it is a secondary task.
- The transcript placeholder and status wording are functional but still generic and could be clearer for kiosk users.
- The current display area is usable, but the content hierarchy in markup can be improved to better support:
  - a dominant `Hold to Speak` action
  - large text input
  - more readable sign output labeling

## Behavior Constraints From script.js

- `script.js` toggles screen visibility using inline `style.display`:
  - `dashboardPane.style.display = 'none'`
  - `translatorPane.style.display = 'block'`
- Because of this, the existing `style="display: none;"` on `#translator-pane` should remain unless we also change JS, which is out of scope for this phase.
- `#welcome-btn` is wired to open `index.html?screen=voice`.
- Voice recognition, typed translation, download history, and sign rendering all depend on the current IDs being intact.

## Planned Changes (UI Only, Pending Approval)

### A. Welcome Screen Navigation Rewrite

Update visible labels to match the approved plain-language plan while preserving destinations:

- `Learning` → `Learn Signs`
- `AI Train` → `Train Gestures`
- `Sign Language to Voice/Text` → `Translate Sign to Text`
- `Voice/Text to Sign Language` → `Translate Text to Sign`
- `Reports` → `View Reports`

### B. Welcome Screen Structure Improvements

Revise the dashboard markup only where safe to improve visual grouping:

- Add short helper text under the brand/title to explain the kiosk purpose.
- Split actions into two visible groups:
  - Public actions
  - Admin / Research actions
- Keep all five actions on-screen without scroll.
- Add inline SVG icons in markup for clearer recognition without adding dependencies.

### C. Voice/Text to Sign Content Improvements

Improve content wording and hierarchy without changing JS behavior:

- Retitle the screen toward the user task, e.g. `Translate Text to Sign`
- Add brief helper text for first-time use.
- Keep `Hold to Speak` as the dominant control in markup order.
- Move `Download History` into a more secondary area in the markup, while preserving its ID and button behavior.
- Add clearer labels around transcript/sign display if possible without breaking the existing DOM hooks.

### D. Accessibility / Kiosk Safety

- Preserve existing landmarks and ARIA labels.
- Add any missing accessible labels only if safe and necessary.
- Keep every non-submit control explicitly `type="button"`.
- Do not alter link destinations or route behavior in this phase.

## Expected Result After Approved Modification

- The Welcome screen becomes easier to understand for first-time kiosk users.
- Dashboard actions use plain-language labels and clearer grouping.
- Public translation actions become visually prioritized over training/reports.
- The Voice/Text to Sign pane feels more task-focused and less cluttered.
- All existing script behavior remains intact.

## Risk Assessment

Risk level: Medium.

Reason:

- `index.html` is tightly coupled to `script.js` through direct ID lookups and display-state changes.
- Markup reordering is safe only if the protected hooks remain present and visible to the script.
- Adding grouping wrappers or helper text is low-risk, but changing/removing the current hidden-state approach is not recommended in this phase.

## Explicit No-Change Areas

This phase will not modify:

- `script.js` logic
- Any backend/API/database files
- Any ML/gesture recognition logic
- The actual navigation destinations
- The external Learning URL behavior

## Approval Request

If you approve this analysis, I will modify `index.html` only and then create a Phase 2–3 completion report in `docs/revisions/` before waiting for your next approval.

