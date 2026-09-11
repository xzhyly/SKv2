# Phase 1 Analysis Report — style.css (Root)

Date: 2026-06-09  
Scope: UI/UX only (no backend/API/DB/ML/gesture/deployment changes)  
Target kiosk: 1024 × 600 landscape, no-scroll public flows

## File

- Target file for Phase 1: `style.css` (root)  
  Linked by: `index.html` via `<link rel="stylesheet" href="style.css">`
- Note: `CSS/style.css` exists but is not linked by current `index.html` and appears to support older/legacy training UI.

## Objective (per UI plan)

Convert the shared UI foundation to a consistent light-mode design system and apply it to the screens that currently depend on this file (dashboard + voice/text-to-sign pane in `index.html`).

## Current State Summary

- `style.css` currently defines a dark kiosk theme using `--sk-*` tokens and styles:
  - Welcome/Dashboard screen: `#dashboard-pane`, `.title-container`, `.dash-btn`, `.learning-btn`
  - Voice/Text to Sign screen: `#translator-pane`, `.translator-card`, `.controls`, `.display-area`, `#start-btn`, `#download-history-btn`, `#text-sign-btn`, `#sign-container`
- Layout is already “kiosk-framed” (`#dashboard-pane`/`#translator-pane` height capped at ~552px and `body { overflow: hidden; }`).

## Protected UI Hooks (Must Not Break)

These IDs are referenced by `script.js` and must remain present and functional:

- Dashboard/route:
  - `#dashboard-pane`, `#translator-pane`, `#welcome-btn`
- Voice/Text to Sign controls:
  - `#start-btn`, `#download-history-btn`, `#transcript`, `#status`
  - `#lang-select`, `#text-sign-input`, `#text-sign-btn`
- Sign display:
  - `#sign-container`, `#current-word`

Classes used as layout hooks in HTML (should remain, even if restyled):

- `.title-container`, `.title-sining`, `.title-kamay`, `.button-container`
- `.translator-card`, `.translator-top-actions`, `.translator-bottom-actions`
- `.main-layout`, `.controls`, `.display-area`, `.language-selector`, `.text-sign-entry`
- `.dashboard-link-btn`, `.switch-mode-btn`

## Risks / Constraints

- `script.js` directly sets inline styles for the mic button background (`startBtn.style.backgroundColor = ...`). The CSS update must tolerate this without relying on that button’s background remaining purely CSS-driven.
- `index.html` includes an external Learning link that opens a new tab (`target="_blank"`). This revision is UI-only; behavior stays as-is unless explicitly approved later.
- Light-mode only requirement means the current dark tokens and dark backgrounds must be replaced (not just overridden) so every screen renders in light mode by default.

## Planned UI Changes (No Behavior Changes)

### A. Design Tokens (Light Mode Only)

Replace/rename current tokens into a light-mode system (still using CSS variables) aligned to the latest UI-first analysis proposal:

- Background/surfaces: `#F7FAFC`, `#FFFFFF`, `#EEF6F8`
- Primary: `#0077B6` (dark variant `#005F8F`)
- Secondary: `#F9C74F` (+ focus ring)
- Accent: `#F9844A`
- Text: `#1F2933` / `#334E68` / `#6B7C93`
- Border: `#D9E2EC`
- Status colors: success/warn/error from the plan

### B. Shared Components

Add shared, reusable styles without changing markup/IDs:

- Buttons:
  - Primary (≥64px height), secondary (≥56px), minimum touch target 48px
  - Clear focus-visible ring using the focus color token
  - Consistent disabled state
- Cards/panels:
  - White surface, 1px border, subtle shadow for major panels only
- Inputs/select:
  - 48px min-height, readable font size, clear focus state
- Status text:
  - Promote important status text to be readable at kiosk distance (18–22px where used)

### C. Kiosk Layout Rules

Preserve the “no scroll” layout intent while making the light mode layout clean:

- Keep `overflow: hidden` for kiosk mode
- Keep the 1024×600 framing concept but ensure the internal spacing doesn’t clip titles/buttons
- Ensure all dashboard actions are fully visible without scrolling at 1024×600

### D. Minimal Visual Migration Strategy

- Do not remove any selectors that are currently relied on by HTML.
- Prefer updating existing selectors instead of introducing new required wrapper elements.

## Expected Result (After Approval + Implementation)

- `index.html` dashboard and voice/text-to-sign pane render in a consistent modern light theme.
- All primary buttons are ≥64px tall and easy to tap.
- Inputs/selects meet 48px minimum touch target.
- Visible focus states exist for kiosk accessibility.
- No JavaScript logic changes and no backend/API/DB/ML/gesture changes.

## Approval Request

If you approve this Phase 1 plan, I will:

1. Modify `style.css` (root) to implement the light-mode design tokens + shared components.
2. Produce a completion report in `docs/revisions/` describing exactly what changed and what was verified.

