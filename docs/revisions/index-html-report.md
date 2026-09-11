# index.html Revision Report

Date updated: 2026-06-05

## File Name

`index.html`

## Current State

`index.html` is the main entry screen for the kiosk. It loads the approved root `style.css` and `script.js`.

The page contains two primary UI areas:

- `#dashboard-pane`, shown by default.
- `#translator-pane`, hidden by default and displayed when the user opens `index.html?screen=voice` or clicks the voice/text-to-sign button.

The dashboard routes to the learning link, AI training, sign-language-to-voice/text mode, voice/text-to-sign mode, and reports.

The file has been modified after user approval on 2026-06-05.

## Problems Found

- The dashboard uses mixed navigation patterns: one external anchor, several buttons with inline `onclick`, and one JavaScript-controlled button.
- The external Learning link is very long and opens a new tab without `rel="noopener noreferrer"`.
- The Learning link points to a hosted external URL instead of a local kiosk screen, which may be risky for offline or locked-down kiosk use.
- `#translator-pane` uses inline `style="display: none;"`, which mixes screen state into markup and makes the UI less consistent.
- `#download-history-btn` has a long inline style that conflicts with the new shared `style.css` design system.
- The screen comments describe the old recreated design rather than the current kiosk design direction.
- The voice/text-to-sign label casing is inconsistent: `Voice/Text to sign language` should match the capitalization used elsewhere.
- The page title is generic: `Sining Kamay App`; it could better match the kiosk identity.
- There is no explicit accessible landmark structure such as `main`, which would make the document structure cleaner.
- Navigation buttons do not declare `type="button"`, which is safer and clearer even outside forms.
- The hidden translator pane still contains all controls in the initial DOM, which is acceptable functionally but should be reviewed for kiosk focus order and screen state clarity.
- The speech button includes an emoji icon. It appears correctly in targeted text inspection, but earlier raw shell output showed mojibake, so encoding should be preserved carefully if edited.

## Planned Changes

Pending approval, revise `index.html` only to:

- Keep the existing dashboard, translator pane, IDs, classes, and JavaScript hooks intact.
- Clean up comments to match the current kiosk UI.
- Convert navigation buttons to clearer, consistent markup while preserving destinations.
- Add `type="button"` to all non-submit buttons.
- Remove inline styling from `#download-history-btn` so `style.css` owns visual design.
- Replace inline hidden state with a class or hidden attribute only if it remains compatible with `script.js`.
- Add safer external-link attributes to the Learning link.
- Normalize visible labels and page title wording.
- Improve landmark structure with a main container if it can be done without breaking selectors.
- Avoid backend, API, database, and deployment changes.

## Expected UI Result

- Cleaner dashboard markup using the approved stylesheet.
- Same navigation behavior with safer, more consistent HTML.
- No visual drift away from the dark kiosk theme.
- Better maintainability for the next screens.
- No JavaScript behavior changes unless required to preserve existing screen switching.

## Risk Assessment

Risk level: Low to Medium.

Reason: Most planned changes are markup cleanup, but the page is tightly connected to `script.js` through IDs and direct display-state changes. Any change to `#dashboard-pane`, `#translator-pane`, `#welcome-btn`, `#start-btn`, `#download-history-btn`, `#text-sign-input`, or `#text-sign-btn` must preserve those exact hooks.

## Approval Status

Modification approved by user. Completion report waiting for user approval.

## Changes Applied

- Changed the page title from `Sining Kamay App` to `Sining Kamay Kiosk`.
- Converted the default dashboard container from a generic `div` into a `main` landmark while preserving `id="dashboard-pane"`.
- Converted the dashboard title area into a `header` while preserving the existing title classes.
- Converted the dashboard button group into a `nav` landmark while preserving `class="button-container"`.
- Added `aria-label` values for the Welcome Screen, kiosk navigation, and voice/text-to-sign screen.
- Added `rel="noopener noreferrer"` to the external Learning link while preserving its destination.
- Added `type="button"` to non-submit buttons.
- Standardized the visible label to `Voice/Text to Sign Language`.
- Converted the translator container from a generic `div` into a `section` while preserving `id="translator-pane"`.
- Removed the inline visual styling from `#download-history-btn` so the approved stylesheet controls its appearance.
- Added `aria-live="polite"` to the status message so screen readers can receive state updates.
- Preserved all existing JavaScript hooks and navigation destinations.

## UI Improvement Summary

Layout improvements:

- Strengthened the Welcome Screen structure with a clear `main` entry area, branded header, and navigation group.
- Kept the 1024 x 600 kiosk layout relationship established by the approved `style.css`.
- Removed old recreated-design comments and aligned the file structure with the approved kiosk intent.

Navigation improvements:

- Grouped all primary Welcome Screen actions inside a `nav` landmark.
- Preserved all existing destinations: Learning, AI Train, Sign Language to Voice/Text, Voice/Text to Sign Language, and Reports.
- Added safer external-link handling for the Learning destination.

Accessibility improvements:

- Added meaningful landmarks and labels.
- Added explicit button types for predictable control behavior.
- Added polite live-region behavior for translator status updates.

Kiosk usability improvements:

- Made the Welcome Screen read more clearly as the kiosk home screen.
- Preserved prominent button structure and touch-friendly sizing from the approved stylesheet.
- Removed inline button styling that could conflict with the shared kiosk design system.
- Kept all primary controls visible in the same dashboard flow.

## What Changed

The Welcome Screen markup now better supports the approved UI-first kiosk plan while keeping the existing functional wiring. The visible screen remains a direct kiosk entry with prominent navigation, and the hidden voice/text-to-sign screen keeps all script-controlled IDs.

## Files Modified

- `index.html`
- `docs/revisions/index-html-report.md`
- `docs/UI_PROGRESS_REPORT.md`
- `docs/PROJECT_MASTER_PLAN.md`

## Verification Results

- Confirmed `index.html` links to root `style.css`.
- Confirmed `script.js` depends on the current IDs used by the page.
- Confirmed required IDs remain present: `dashboard-pane`, `translator-pane`, `welcome-btn`, `start-btn`, `download-history-btn`, `text-sign-input`, `text-sign-btn`, and `status`.
- Confirmed navigation destinations are preserved.
- Confirmed HTML landmark counts are balanced: one `main`, one `section`, and one `nav`.
- Confirmed `div` tags are balanced: 12 opening and 12 closing.
- Confirmed the external Learning link includes `rel="noopener noreferrer"`.
- Confirmed the only remaining inline style is `style="display: none;"` on `#translator-pane`, retained for compatibility with the existing `script.js` display switching.
- Browser visual verification was not repeated because the in-app browser blocked local preview during the previous approved stylesheet verification.

## Screens Impacted

Dashboard and voice/text-to-sign translator entry screen.

## Next Recommended File

After approved `index.html` modification and completion approval: `camera-translator.html`.
