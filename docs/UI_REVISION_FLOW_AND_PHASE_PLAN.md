# SiningKamay UI Revision Flow and Phase Plan

Date prepared: 2026-06-09  
Purpose: Practical implementation guide for UI-first revision  
Scope: UI/UX only

## Core Rule

Do not modify:

- Backend logic
- API behavior
- Database structure
- Machine learning logic
- Gesture recognition logic
- Raspberry Pi deployment behavior

Only revise:

- User interface
- User experience
- Navigation
- Layout
- Visual hierarchy
- Accessibility
- Touch interaction
- 1024 x 600 responsiveness
- Information architecture

## Recommended Work Flow

Follow this order for every screen:

1. Review the current file.
2. Identify protected IDs, classes, and JavaScript hooks.
3. Plan UI changes only.
4. Update layout and styles.
5. Check 1024 x 600 fit.
6. Check touch target sizes.
7. Check accessibility labels and focus states.
8. Test navigation paths.
9. Document what changed.

## Phase 1: Foundation UI System

### Objective

Create the shared light-mode design foundation before redesigning individual screens.

### Files Affected

- `style.css`
- Later: inline styles in `camera-translator.html`
- Later: inline styles in `reports.html`

### Tasks

- Define light-mode color tokens.
- Define typography scale.
- Define spacing system.
- Define card, button, input, tab, status, and panel styles.
- Establish 1024 x 600 kiosk layout rules.
- Set minimum touch target rules.

### Deliverables

- Light-mode design tokens.
- Shared button styles.
- Shared card/panel styles.
- Shared form/input styles.
- Shared status and feedback styles.

### Success Criteria

- The visual system feels consistent.
- Main buttons are at least 64px tall.
- Secondary controls are at least 48px tall.
- Text is readable on a 7-inch kiosk.
- No backend or behavior logic is changed.

## Phase 2: Navigation Redesign

### Objective

Make navigation clearer for children, students, adults, senior citizens, teachers, researchers, and first-time users.

### Files Affected

- `index.html`
- `camera-translator.html`
- `reports.html`

### Tasks

- Rename technical labels into plain user language.
- Keep Dashboard/Home access visible.
- Separate public actions from admin/research actions visually.
- Confirm all navigation paths return safely to the dashboard.

### Suggested Labels

- `Learning` -> `Learn Signs`
- `AI Train` -> `Train Gestures`
- `Sign Language to Voice/Text` -> `Translate Sign to Text`
- `Voice/Text to Sign Language` -> `Translate Text to Sign`
- `Reports` -> `View Reports`

### Deliverables

- Clear dashboard action labels.
- Consistent Home/Dashboard controls.
- Predictable mode switching between translation flows.

### Success Criteria

- A first-time user can choose the correct flow without help.
- No screen becomes a dead end.
- Navigation fits within 1024 x 600.

## Phase 3: Welcome Screen

### Objective

Make the Welcome screen bright, friendly, and immediately understandable.

### Files Affected

- `index.html`
- `style.css`

### Tasks

- Apply light-mode visual design.
- Make SiningKamay branding clear.
- Use large action buttons or tiles.
- Group public actions separately from admin/research actions.
- Add icons to support recognition.

### Deliverables

- Revised light-mode Welcome screen.
- Large touch-friendly navigation actions.
- Clear visual hierarchy.

### Success Criteria

- All primary actions are visible without scrolling.
- Buttons are easy to tap.
- Labels are understandable to first-time users.

## Phase 4: Voice/Text to Sign Language Screen

### Objective

Improve the flow where users speak or type text and see sign language visuals.

### Files Affected

- `index.html`
- `style.css`
- `script.js` only if UI labels or non-logic display states need adjustment

### Tasks

- Make the sign display area larger.
- Make `Hold to Speak` the main action.
- Keep text input and Translate button large.
- Move Download History to a secondary location.
- Improve status feedback.

### Deliverables

- Large sign display area.
- Clear speech and text entry controls.
- More visible status messages.

### Success Criteria

- User can translate by voice or text from one screen.
- Current sign is easy to see.
- Status messages are clear and readable.

## Phase 5: Camera Translator

### Objective

Make the Sign Language to Voice/Text flow the strongest public kiosk experience.

### Files Affected

- `camera-translator.html`

### Tasks

- Apply light-mode design.
- Make the camera feed dominant.
- Keep translated output visible beside or below the camera.
- Make camera permission state easier to understand.
- Use simple status labels.
- Reduce technical confidence display in public mode.
- Keep Speak, Clear, Copy, and Save actions large.

### Deliverables

- Light-mode camera translator screen.
- Clear camera state UI.
- Large readable translation output.
- Better action button grouping.

### Success Criteria

- Camera and translated output are visible at the same time.
- User knows what to do after enabling the camera.
- No scrolling is needed at 1024 x 600.
- Existing camera, training, prediction, and save behavior still works.

## Phase 6: Gesture Training

### Objective

Make gesture training feel like a guided wizard while preserving existing training behavior.

### Files Affected

- `camera-translator.html`

### Tasks

- Keep training inside `camera-translator.html`.
- Preserve all existing IDs and JavaScript hooks.
- Simplify the visible training steps.
- Use friendly step names.
- Reduce visible technical logs.
- Keep progress visible and understandable.

### Suggested Step Flow

1. Name Gesture
2. Capture Samples
3. Train Gesture
4. Test Gesture

### Deliverables

- Guided gesture training UI.
- Larger training controls.
- Friendly progress states.

### Success Criteria

- User can name, capture, train, and test a gesture.
- Training fits the 1024 x 600 kiosk display.
- Existing ML and gesture logic is unchanged.

## Phase 7: Reports

### Objective

Make reports easier to scan for teachers, researchers, and capstone panel review.

### Files Affected

- `reports.html`

### Tasks

- Apply light-mode design.
- Improve summary cards.
- Make tabs larger and accessible.
- Improve table readability.
- Add or plan a row detail pattern for long values.
- Preserve Print/Save PDF behavior.

### Deliverables

- Light-mode reports screen.
- Clear summary metrics.
- Better report tabs.
- More readable data tables.

### Success Criteria

- Summary is readable immediately.
- Reports do not overwhelm the kiosk screen.
- Print/PDF still works.

## Phase 8: Accessibility and Final Polish

### Objective

Prepare the UI for final kiosk presentation and deployment.

### Files Affected

- `index.html`
- `style.css`
- `camera-translator.html`
- `reports.html`

### Tasks

- Check all touch targets.
- Check text readability.
- Check focus states.
- Add ARIA labels where needed.
- Convert clickable `div`s to buttons only where safe.
- Check 1024 x 600 layout.
- Check camera permission state.
- Check speech status state.
- Check reports loading/error state.
- Check print/PDF output.

### Deliverables

- Final polished kiosk UI.
- Accessibility cleanup.
- Visual QA notes.
- Final issue list, if any.

### Success Criteria

- All public flows fit without scrolling.
- All controls are readable and tappable.
- Users can recover from camera/speech/report errors.
- The interface is ready for capstone presentation and kiosk testing.

## Priority If Time Is Limited

### Top 3

1. Camera Translator / Translate Sign to Text
2. Welcome Screen
3. Voice/Text to Sign Language

### Top 5

1. Camera Translator / Translate Sign to Text
2. Welcome Screen
3. Voice/Text to Sign Language
4. Gesture Training
5. Reports

## Simple Implementation Checklist

Use this checklist for each screen:

- [ ] Screen uses light-mode design.
- [ ] Main action is obvious.
- [ ] Buttons are at least 48px tall.
- [ ] Primary buttons are 64px or taller.
- [ ] Text is readable on 1024 x 600.
- [ ] No public flow requires scrolling.
- [ ] Dashboard/Home navigation is visible.
- [ ] Error and loading states are clear.
- [ ] Existing IDs and JavaScript hooks are preserved.
- [ ] Backend, API, database, ML, gesture recognition, and deployment behavior are untouched.

## Recommended Revision Order

1. `style.css`
2. `index.html`
3. Voice/Text to Sign section inside `index.html`
4. Translate-only mode inside `camera-translator.html`
5. Training flow inside `camera-translator.html`
6. `reports.html`
7. Final accessibility and 1024 x 600 QA
