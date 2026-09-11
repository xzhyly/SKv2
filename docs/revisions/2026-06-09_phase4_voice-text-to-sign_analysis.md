# Phase 4 Analysis Report — Voice/Text to Sign (index.html + style.css)

Date: 2026-06-09  
Scope: UI/UX only (no backend/API/DB/ML/gesture/deployment changes)  
Target kiosk: 1024 × 600 landscape, no-scroll public flows

## Files in Scope

- `index.html` (Voice/Text to Sign screen markup inside `#translator-pane`)
- `style.css` (styling for the translator pane)
- `script.js` (NO logic changes planned; used only to identify protected hooks)

## Objective (Phase 4)

Improve the flow where users speak or type text and see sign language visuals:

- Make the sign display area larger and more central.
- Make `Hold to Speak` the dominant action.
- Keep text input and Translate button large.
- Keep Download History as a secondary action.
- Improve status feedback readability.

## Current State Summary

- Voice/Text to Sign lives in `index.html` under `#translator-pane` and is revealed by `script.js` when `?screen=voice` is present.
- Layout is a two-column grid via `.main-layout`:
  - Left: `.controls` (language, mic, transcript, status, text input, download)
  - Right: `.display-area` (`#sign-container` + `#current-word`)
- Current sign container height: `246px` in `style.css`.
- Buttons are currently `min-height: 52px` for mic/text buttons (kiosk-friendly but not yet “primary 64px”).

## Protected Hooks (Must Be Preserved Exactly)

These IDs are referenced by `script.js` and must not be renamed or removed:

- Screen/state:
  - `#dashboard-pane`, `#translator-pane`, `#welcome-btn`
- Voice/Text to Sign controls:
  - `#start-btn`, `#download-history-btn`
  - `#transcript`, `#status`
  - `#lang-select`, `#text-sign-input`, `#text-sign-btn`
- Display:
  - `#sign-container`, `#current-word`

## Behavior Constraints From script.js

- Screen visibility is controlled by:
  - `dashboardPane.style.display = 'none'`
  - `translatorPane.style.display = 'block'`
- The mic button background color is set inline by JS:
  - Idle: `#007bff`
  - Listening: `#ff4b2b`
- Download History produces and downloads a JSON file; UI changes must not interfere with the button’s click handler.

## UI Problems (Phase 4-specific)

- `Hold to Speak` is important, but its visual weight is close to other controls.
- Status text is readable, but it blends into the panel; it needs stronger hierarchy (without turning into technical logs).
- The sign output area can be larger on a 7-inch kiosk; right now the controls column competes too much for height/space.
- The transcript and status are separated but visually similar; better structure would help first-time users understand the flow:
  - Speak/Type → See transcript → See sign output

## Planned UI Changes (Pending Approval)

### A. Make Sign Display Larger

In `style.css`:

- Increase `#sign-container` height (target range: ~290–330px), while keeping the whole screen within the 552px kiosk frame.
- Rebalance `.main-layout` column ratios to favor the display area (e.g., make display column wider than controls).
- Reduce padding slightly in `.controls` / `.display-area` if needed to avoid overflow.

### B. Make Hold-to-Speak the Dominant Action

In `style.css`:

- Increase `#start-btn` min-height to primary kiosk target (64px+).
- Keep `#text-sign-btn` as a large primary action (match `#start-btn` height).
- Keep `#download-history-btn` as a secondary-style button (already styled as secondary; may refine spacing and border).

### C. Improve Status Feedback Readability

In `style.css`:

- Upgrade `.status` into a “status pill/card” treatment:
  - soft background
  - border
  - clearer typography (18–20px feel without being oversized)
- Keep `aria-live="polite"` as-is in `index.html`.

### D. Markup Adjustments (UI-only)

In `index.html` (inside `#translator-pane` only):

- Optionally add a small label above the transcript/status area (pure text) to clarify what users are seeing (no ID changes).
- Keep Download History below the main translation controls (already done).
- No changes to IDs, button types, or navigation URLs.

## Expected Result After Approved Modification

- The sign output becomes the dominant visual element.
- Voice and text entry remains easy and touch-friendly.
- Status feedback becomes clearer (“Ready / Listening / Processing / Translating”) without exposing technical details.
- No scrolling needed at 1024 × 600.
- Existing JS behavior remains unchanged.

## Risk Assessment

Risk level: Medium.

Reason:

- Layout and sizing tweaks can introduce overflow in a strict 600px kiosk.
- JS uses inline styles on the mic button; CSS must remain compatible.
- All protected hooks must remain intact to avoid breaking translation flow.

## Approval Request

If you approve this Phase 4 plan, I will:

1. Update `style.css` and (only if necessary) small text-only markup in the `#translator-pane` area of `index.html`.
2. Create a Phase 4 completion report in `docs/revisions/` describing exactly what changed.

