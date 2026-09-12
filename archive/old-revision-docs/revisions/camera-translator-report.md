# camera-translator.html Revision Report

Date updated: 2026-06-05

## File Name

`camera-translator.html`

## Current State

`camera-translator.html` is a self-contained camera, training, prediction, and sign-to-text translation screen. It includes:

- External libraries for TensorFlow.js and MediaPipe Hands.
- Supporting project scripts: `db-api.js`, `gesture-data.js`, and `db.js`.
- A large inline `<style>` block.
- A large inline `<script>` block.
- Multiple workflow panels controlled by JavaScript.
- A special `?screen=translate` mode that hides the left training workflow and opens directly into sign-language-to-voice/text translation.

No source files were modified during this analysis step.

## Problems Found

## 1. Screen Inventory

Primary screens and workflows contained in the file:

- Top navigation bar
  - Dashboard link.
  - Brand label.
  - Four-step progress navigation: Add Data, Train AI, Predict, Translate.
  - Next button.
- Main layout
  - `main` grid with a left workflow panel and a right camera/output panel.
- Left panel Step 1: Add Gesture Data
  - Header text.
  - Export/Load controls exist in markup but are removed during script initialization.
  - Gesture dataset capture card with label input, ESL/FSL radio toggle, Start Capture and Stop buttons.
  - Start/Stop gesture recording cards exist in markup but are removed during script initialization.
  - Hint card exists in markup but is removed during script initialization.
- Left panel Step 2: Train AI
  - Header text.
  - `trainDataControls` placeholder.
  - Training sample summary block exists in markup but is removed during initialization.
  - Epoch progress row and bar.
  - Training log.
  - Train Model button.
  - Hint card.
- Left panel Step 3: Predict Gesture
  - Instruction panel.
  - Prediction mode box.
  - Continue to Translate button.
- Left panel Step 4: Translate
  - Output language selector.
  - Custom word entry.
  - Word chip list.
  - Detected signs history.
  - Speak, clear, copy, and save actions.
- Right panel camera area
  - Mode switch link to `index.html?screen=voice`.
  - Camera frame.
  - Video element.
  - Camera placeholder.
  - Corner frame decoration.
  - Live/waiting camera badge.
  - Prediction overlay.
  - Enable Camera button.
- Right panel Step 3 prediction section
  - Hidden by default.
  - Live prediction result.
  - Confidence bar.
- Right panel Step 4 translation output section
  - Hidden by default.
  - Large translated output panel.
  - Speak, clear, copy controls.
- Sample strip
  - Hidden by default.
  - Recent captured sample thumbnails.
- Toast notification
  - `#sk-toast`.
- Translate-only mode
  - Triggered by `?screen=translate`.
  - Adds `body.translate-only`.
  - Hides steps, next button, and left panel.
  - Uses camera/right panel as the primary sign-to-text interface.

No modal dialogs were found.

No reports area was found inside this file.

No dedicated settings area was found inside this file, although language selection and dataset type toggles act like local settings.

## 2. CSS Inventory

Inline CSS:

- One `<style>` block from line 12 through line 219.
- Estimated size: 22,890 characters.
- Estimated lines: 208.
- Approximate rule blocks: 184.

Inline style attributes:

- 17 inline `style=` attributes were found in markup.
- They mostly appear in Step 2 training summaries, small labels, hidden right-side panels, and progress bar widths.

Major CSS groups:

- Reset and CSS variables.
- Navigation.
- Main layout.
- Left panel.
- Right panel.
- Camera frame and overlays.
- Gesture cards.
- Dataset card.
- Step panels.
- Training log and progress.
- Prediction overlay.
- Prediction result box.
- Translation controls.
- Custom word entry.
- Toast.
- Translate-only mode overrides.

Duplicated or repeated style patterns:

- Pill controls: `.back-btn`, `.mode-switch-btn`, `.step-pill`, `.next-btn`, `.clear-btn`, `.record-btn`, `.train-btn`, `.lang-chip`, and `#sk-toast` all repeat rounded-pill logic.
- Button gradients: primary pink gradients repeat across `.next-btn`, `.mode-switch-main`, `.enable-cam-btn`, `.train-btn`, `.voice-btn.primary`, `.tl-action-row button.primary`, and `.word-add-btn`.
- Card surfaces: `.gesture-card`, `.dataset-card`, `.prediction-box`, `.word-entry-card`, `.tl-history`, `.tl-big-output`, and the inline Step 2 summary block repeat panel/card logic.
- Border and radius values repeat with inconsistent radii: 10px, 11px, 12px, 14px, 16px, 18px, 20px, 22px, 28px, and 99px.
- Small uppercase labels repeat in `.prediction-label`, `.strip-label`, and several inline label styles.
- Progress bars repeat in `.progress-track`, `.epoch-bar-wrap`, `.pred-bar-mini`, and `.confidence-bar-wrap`.
- Flex row utility styles repeat in inline styles and class rules.

Styles that should eventually belong to the shared design system:

- Color tokens should align with approved `style.css`: dark background, dark surfaces, border tokens, primary accent, secondary accent, success, warning, and text colors.
- Typography scale for titles, panel headers, body copy, labels, and status text.
- Button base, primary button, secondary button, icon button, and disabled states.
- Card/panel base style.
- Progress bar base style.
- Form input, radio toggle, chip, badge, and toast patterns.
- Kiosk layout shell for 1024 x 600.
- Camera frame component.
- Live status badge.
- Touch target sizing rules.

## 3. Layout Map

Current visual structure:

- The page begins with a sticky top navigation bar.
- Below the nav, `main` is a two-column grid:
  - Left column: fixed 360px workflow panel.
  - Right column: flexible camera/output panel.
- Left panel has `overflow-y:auto`, allowing internal scrolling.
- Right panel centers camera and output content vertically and horizontally.
- Camera area is a 16:9 frame with a max width of 640px.
- Prediction and translation outputs are hidden right-panel sections displayed by JavaScript.
- Toast is fixed at the bottom center.

Major containers:

- `nav`
- `.nav-brand`
- `.steps`
- `main`
- `.left-panel`
- `.step-panel`
- `.right-panel`
- `.camera-wrapper`
- `.camera-frame`
- `.predict-overlay`
- `#rightStep3`
- `#rightStep4`
- `#sampleStrip`
- `#sk-toast`

Camera area:

- `.camera-wrapper`
- `#cameraFrame`
- `#videoFeed`
- `#cameraPlaceholder`
- `#camBadge`
- `#predictOverlay`
- `#enableCamBtn`

Translation area:

- Left Step 4: language toggle, custom words, detected sign history, voice controls.
- Right Step 4: big output, speak/clear/copy controls.
- Translate-only mode hides the left panel and uses the right panel as the main screen.

Training area:

- Left Step 1: dataset capture controls.
- Left Step 2: train button, epoch progress, train log.
- Right panel camera remains shared during training.

Reports area:

- None in this file. Reports are handled by `reports.html`.

Settings area:

- No dedicated settings section.
- Local settings-like controls include language chips and ESL/FSL radio toggle.

Hidden sections:

- `.step-panel` instances other than the active step.
- `#rightStep3`.
- `#rightStep4`.
- `#sampleStrip`.
- `.mode-switch-main` unless translate-only mode is active.
- `.predict-overlay` until live prediction begins.
- Several Step 1 elements are present in markup but removed by script initialization.

## 4. Workflow Map

Sign-to-text flow:

- User enters from `index.html` through `camera-translator.html?screen=translate`.
- Script detects `screen=translate`.
- `body.translate-only` is added.
- Step 4 is activated.
- User enables camera.
- If no model is trained, `autoTrainForTranslate()` attempts to train from saved gesture data.
- `startLivePrediction(true)` runs.
- Predictions update overlay confidence.
- Detected signs populate `translatedWords`.
- Output appears in `#tlHistory` and `#tlBigOutput`.
- User can speak, clear, copy, or save the translation.
- `DB_API.saveTranslation()` is called for recognized sign-to-text words.

Text-to-sign flow:

- This file does not contain the full text-to-sign translation workflow.
- It provides only a mode switch link to `index.html?screen=voice`.
- Text-to-sign is primarily handled by `index.html` and `script.js`.

Training flow:

- User opens `camera-translator.html` from the AI Train dashboard button.
- User enables camera.
- User records or captures gesture data.
- MediaPipe landmark samples may be loaded via `gesture-data.js`.
- User moves to Step 2 and trains a TensorFlow.js model.
- Epoch progress and logs update.
- When trained, model state is marked ready and Step 3/4 become usable.
- User can test prediction in Step 3.
- User can continue to translation in Step 4.

Navigation flow:

- Dashboard link returns to `index.html`.
- Step pills call `goToStep(1..4)`.
- Next button calls `nextStep()`.
- Step 3 Continue button calls `goToStep(4)`.
- Translate-only link points to `index.html?screen=voice`.
- JavaScript `setStep()` controls active panels, right-side output, progress pills, and next-button visibility.

## 5. Kiosk Compliance Review

1024 x 600 issues:

- The file currently uses `height: calc(100vh - 57px)`, which fits conceptually but depends on the nav height remaining exactly 57px.
- Left panel is 360px wide, leaving about 664px for the right panel at 1024px width. With right-panel padding of 64px total, the camera frame has limited horizontal space.
- Camera max-width is 640px, but effective width at 1024px may be closer to 600px after panel padding and borders.
- Vertical stacking in the left panel is too tall for 600px, especially Step 1 and Step 4.
- The training log has fixed 130px height and can crowd Step 2.
- Step labels and top nav may become cramped at 1024px width.

Overflow issues:

- `.left-panel` uses `overflow-y:auto`, which violates the final no-scroll kiosk goal.
- `body` does not explicitly use `overflow:hidden`.
- `.train-log` and `.tl-history` use internal scrolling.
- Step 1 contains more controls than can comfortably fit without scrolling.
- The right panel can become vertically crowded in Step 4 with camera, enable button, output panel, and action row.

Scrolling issues:

- Current design intentionally scrolls the left panel.
- History/log areas also scroll.
- Final kiosk design should avoid scrolling by reducing density, paginating sub-actions, or moving less-common controls behind compact states.

Touch-target issues:

- Several controls are below the recommended 48px target height:
  - Step pills.
  - Back button.
  - Small clear buttons.
  - Language chips.
  - Dataset type labels.
  - Word chip remove buttons.
  - Some voice/action buttons.
- Some clickable `div` elements should eventually become buttons for kiosk and accessibility consistency.
- Inline SVG buttons have small visual affordances.

Dark-theme consistency:

- Current screen uses a light pink/white theme, not the approved dark kiosk theme.
- It has its own color variables that do not match the shared design system established in root `style.css`.
- Many components use pale pink cards and white surfaces.

## 6. Train Gestures Assessment

Recommendation: training should remain inside `camera-translator.html` for the current UI-only revision phase.

Justification:

- `train-gestures.html` does not currently exist in the project.
- Training is tightly coupled to camera state, TensorFlow model state, sample capture, prediction, translation, and the shared `setStep()` workflow.
- Splitting training into a new file would require moving or duplicating JavaScript state, camera permissions, model training state, and dataset capture behavior.
- A split would likely require behavior changes or new cross-page persistence, which conflicts with the current no-backend/no-API/no-database/no-deployment-change constraint.
- The safest UI-first approach is to refine the existing step-based training workflow inside `camera-translator.html`.

Future option:

- A separate `train-gestures.html` could be considered later only if the JavaScript is first modularized and model/sample state persistence is clearly defined. That would be a larger architecture task, not a UI-only revision.

## 7. Risk Assessment

Risk level: High.

Reason: this file combines layout, inline CSS, camera permissions, TensorFlow training, prediction loops, speech synthesis, database API calls, and navigation state in one document.

JavaScript dependencies that must not be broken:

- External libraries:
  - TensorFlow.js via `tf`.
  - MediaPipe Hands.
- Project globals:
  - `DB_API.saveTranslation()`.
  - `saveRecording()`.
  - `window.extractLandmarkFeatures()`.
  - `window.loadGestureDatasetForTraining()`.
- Browser APIs:
  - `navigator.mediaDevices.getUserMedia`.
  - `window.speechSynthesis`.
  - `SpeechSynthesisUtterance`.
  - `navigator.clipboard`.
  - `Blob`, `FileReader`, generated downloads.

Critical IDs that must not be changed:

- Navigation and steps: `pill1`, `pill2`, `pill3`, `pill4`, `nextBtn`.
- Step panels: `leftStep1`, `leftStep2`, `leftStep3`, `leftStep4`.
- Camera: `videoFeed`, `cameraFrame`, `cameraPlaceholder`, `camBadge`, `enableCamBtn`, `predictOverlay`, `predEmoji`, `predLabel`, `predConf`, `predFillMini`.
- Dataset capture: `gestureDatasetCard`, `gestureLabelInput`, `startGestureDataBtn`, `stopGestureDataBtn`, `gestureDataStatus`, `gestureDataStatusText`, `gestureDataFrameCount`.
- Training: `downloadBtn`, `loadBtn`, `startCard`, `stopCard`, `startCount`, `stopCount`, `startProgress`, `stopProgress`, `recordStartBtn`, `recordStopBtn`, `clearStart`, `clearStop`, `trainDataControls`, `trainBtn`, `trainLog`, `epochBar`, `epochLabel`, `step2StartCount`, `step2StopCount`.
- Prediction: `rightStep3`, `livePredResult`, `confBar`.
- Translation: `rightStep4`, `tlBigOutput`, `tlHistory`, `speakBtn`, `speakBigBtn`, `langEn`, `langFil`, `wordInput`, `wordChips`.
- Samples/toast: `sampleStrip`, `sampleStripRow`, `sk-toast`.

Additional risks:

- The file has visible mojibake in shell output for some symbols and emojis. Edits must preserve encoding carefully.
- The init script removes some existing markup (`action-row`, `divider`, `startCard`, `stopCard`, hint cards, and Step 2 summary). UI edits must account for both initial markup and post-init DOM.
- Buttons without `type="button"` may behave unpredictably if forms are introduced later.
- Several clickable `div` controls are not semantic buttons.
- Inline styles used by JavaScript progress updates should not be blindly removed without replacing script behavior.

## Architecture Review Addendum

### 1. Screen Breakdown

User-facing screens contained inside `camera-translator.html`:

- AI Train / Add Gesture Data screen
  - Visible by default when opening `camera-translator.html`.
  - Primary visible sections: top nav, left Step 1 panel, right camera panel, enable camera button.
  - Hidden/removed sections: Step 2-4 panels, right prediction panel, right translation panel, sample strip until samples exist. Some Step 1 legacy elements are removed by init script.
- Train AI screen
  - Visible when `goToStep(2)` or Next activates Step 2.
  - Primary visible sections: Step 2 panel, train button, train log, epoch progress, shared camera panel.
  - Hidden sections: Step 1, Step 3, Step 4, right prediction and translation panels.
- Predict Gesture screen
  - Visible when `goToStep(3)` succeeds after training.
  - Primary visible sections: Step 3 panel, shared camera panel, `#rightStep3` live prediction display, prediction overlay.
  - Hidden sections: Step 1, Step 2, Step 4, right translation output.
- Translate screen inside full training workflow
  - Visible when `goToStep(4)` succeeds after training.
  - Primary visible sections: Step 4 panel, shared camera panel, `#rightStep4` translation output, prediction overlay.
  - Hidden sections: Step 1, Step 2, Step 3, `#rightStep3`.
- Sign Language to Voice/Text translate-only screen
  - Visible when opening `camera-translator.html?screen=translate`.
  - Primary visible sections: right camera panel, mode switch link, camera enable button, translation output.
  - Hidden sections: step pills, Next button, full left panel, training controls.
- Camera permission state
  - User-facing state inside the same camera panel.
  - Shows camera placeholder, waiting/live/denied badge, and enable camera button.
- Live prediction overlay state
  - Hidden until prediction begins.
  - Displays predicted gesture, confidence, and progress inside camera frame.
- Recent sample strip state
  - Hidden until samples exist.
  - Displays captured thumbnails below the camera workflow.
- Toast notification state
  - Hidden by opacity until feedback is shown.
  - Displays transient system messages at bottom center.

No dedicated reports, settings, or modal screens are currently contained in the file.

### 2. Train Gestures Decision

Option A: Create a dedicated `train-gestures.html` screen.

Advantages:

- Clear separation between training and translation.
- Easier to give training a purpose-built kiosk layout.
- Smaller individual screens could be easier to visually polish.
- Future training-only maintenance could become clearer after architecture cleanup.

Disadvantages:

- `train-gestures.html` does not currently exist.
- Requires moving or duplicating camera setup, TensorFlow state, sample capture, dataset loading, model training, and navigation behavior.
- Would likely need shared state or persistence across pages before prediction/translation can use the trained model reliably.
- Increases risk of breaking `?screen=translate`, model state, saved gesture loading, or database save behavior.
- Exceeds the safest interpretation of the current UI-only/no-behavior-change scope.

Impact on 1024 x 600 kiosk usability:

- Potentially positive long term because training can get a dedicated low-density layout.
- Risky short term because a new screen would need new navigation and state handoff.

Impact on maintainability:

- Positive only after JavaScript modularization.
- Negative in the current file structure because behavior is tightly coupled and would be split prematurely.

Recommended option for Option A:

- Not recommended for the current UI-first revision phase.
- Revisit only in a later architecture phase after JavaScript is modularized.

Option B: Keep gesture training integrated inside `camera-translator.html`.

Advantages:

- Preserves current behavior and state flow.
- Keeps camera, training, prediction, and translation in one continuous workflow.
- Avoids new backend, API, database, or deployment implications.
- Lowest-risk path for a UI-only revision.
- Matches the current dashboard destination: AI Train routes to `camera-translator.html`.

Disadvantages:

- File remains large and complex.
- UI density is harder to fit into 1024 x 600.
- Inline CSS and inline JavaScript remain mixed with markup.
- Training and translation design concerns are interdependent.

Impact on 1024 x 600 kiosk usability:

- Moderate positive if the existing step panels are tightened and the camera/output layout is rebalanced.
- Some constraints remain because four workflows share one file and one layout shell.

Impact on maintainability:

- Best short-term maintainability because it avoids behavior rewiring.
- Long-term maintainability still requires future CSS extraction and JavaScript modularization.

Recommended option:

- Option B is recommended for this UI-first phase.
- Keep training inside `camera-translator.html` while improving layout, dark-theme consistency, and touch usability.

### 3. CSS Extraction Assessment

Inline CSS estimate:

- About 22,890 characters.
- About 208 lines.
- About 184 CSS rule blocks.
- 17 additional inline style attributes in markup.

CSS that should move into the shared design system:

- Color variables and theme tokens.
- Font stack and type scale.
- Button styles: primary, secondary, icon/text, disabled, active, hover/focus.
- Card and panel surfaces.
- Form inputs, radio/toggle controls, chips, badges.
- Toast styling.
- Progress bar styling.
- Navigation shell.
- Kiosk grid/page shell for 1024 x 600.
- Touch target sizing.
- Camera frame base styling.

CSS that should remain local to `camera-translator.html`:

- Camera video mirroring and frame-specific states.
- Prediction overlay positioning inside the camera frame.
- Step visibility rules tied to `body.translate-only`.
- Training-specific progress/log details until those components are generalized.
- Sample thumbnail strip behavior.
- Gesture recording visual states such as `.camera-frame.glowing`, `.camera-frame.predicting`, and `.gesture-card.recording`.
- Any class names directly manipulated by JavaScript unless migrated carefully.

Extraction recommendation:

- For this approved file step, avoid large structural extraction into a new CSS file unless explicitly approved.
- It is safer to align inline CSS with the shared design rules first, then consider CSS extraction during a later polish or maintainability phase.

### 4. UI Refactor Scope

Safe changes:

- Update colors to the approved dark theme.
- Adjust spacing, padding, font sizes, and button dimensions.
- Add missing `type="button"` attributes.
- Improve visible labels and step titles where IDs and behavior remain unchanged.
- Replace inline visual styles with classes when JavaScript does not depend on those inline styles.
- Improve focus states and touch target sizes.
- Reduce decorative radius values to design-system values.
- Update nav sizing and panel density for 1024 x 600.

Moderate Risk changes:

- Reworking the `main` grid columns.
- Removing left-panel scrolling.
- Restructuring step panel markup.
- Changing clickable `div` step pills or language chips into buttons.
- Moving inline styles for progress bars that JavaScript updates.
- Hiding or relocating controls that are currently removed by initialization script.
- Changing translate-only mode layout rules.

High Risk changes:

- Renaming IDs or classes used by JavaScript.
- Splitting training into a new `train-gestures.html` file.
- Moving inline JavaScript to external files during this step.
- Changing model training logic, prediction thresholds, saved gesture loading, database calls, or camera setup.
- Replacing TensorFlow/MediaPipe flow.
- Changing navigation destinations.
- Changing API/database/deployment behavior.

### 5. Kiosk Layout Recommendation

Ideal camera area:

- Primary visual area on the right or center.
- Fixed 16:9 camera frame sized to fit 1024 x 600 with no scrolling.
- Clear camera state badge inside the frame.
- Enable Camera button directly below or beside the frame with at least 48px height.
- Prediction overlay compact and readable without covering too much of the camera.

Ideal translation results:

- In translate-only mode, translation output should be immediately visible without requiring the hidden left panel.
- Use a compact output band below the camera or a right-side output panel depending on available space.
- Keep Speak, Clear, Copy, and Save actions grouped with consistent 48px touch targets.
- Limit history height or summarize history to avoid scroll.

Ideal prediction display:

- Use a compact confidence panel below the camera frame in Step 3.
- Keep prediction label, confidence, and bar visible at once.
- Avoid duplicating prediction information in too many places.

Ideal training controls:

- Keep training as a stepped flow inside `camera-translator.html`.
- Step 1 should focus on custom dataset capture.
- Step 2 should focus on train progress and train action.
- Remove or collapse inactive/legacy controls that are currently removed by script.
- Keep the camera visible during training steps.
- Use dense but clear cards to avoid left-panel scrolling.

Ideal navigation controls:

- Top nav should fit 1024px without wrapping.
- Step controls should be touch-friendly but compact.
- Dashboard and Next should remain consistently placed.
- In translate-only mode, hide training navigation and show a clear mode switch back to Voice/Text to Sign Language.

### 6. Dependency Protection List

IDs that must not be broken:

- `camBadge`
- `cameraFrame`
- `cameraPlaceholder`
- `clearStart`
- `clearStop`
- `confBar`
- `downloadBtn`
- `enableCamBtn`
- `epochBar`
- `epochLabel`
- `gestureDataFrameCount`
- `gestureDatasetCard`
- `gestureDataStatus`
- `gestureDataStatusText`
- `gestureLabelInput`
- `langEn`
- `langFil`
- `leftStep1`
- `leftStep2`
- `leftStep3`
- `leftStep4`
- `livePredResult`
- `loadBtn`
- `nextBtn`
- `pill1`
- `pill2`
- `pill3`
- `pill4`
- `predConf`
- `predEmoji`
- `predFillMini`
- `predictOverlay`
- `predLabel`
- `recordStartBtn`
- `recordStopBtn`
- `rightStep3`
- `rightStep4`
- `sampleStrip`
- `sampleStripRow`
- `sk-toast`
- `speakBigBtn`
- `speakBtn`
- `startCard`
- `startCount`
- `startGestureDataBtn`
- `startProgress`
- `step2StartCount`
- `step2StopCount`
- `stopCard`
- `stopCount`
- `stopGestureDataBtn`
- `stopProgress`
- `tlBigOutput`
- `tlHistory`
- `trainBtn`
- `trainDataControls`
- `trainLog`
- `videoFeed`
- `wordChips`
- `wordInput`

Classes manipulated by JavaScript or behavior-sensitive CSS:

- `active`
- `done`
- `recording`
- `glowing`
- `predicting`
- `live`
- `show`
- `detected`
- `speaking`
- `translate-only`
- `idle`
- `primary`
- `secondary`
- `start-fill`
- `stop-fill`
- `pulsing`

JavaScript functions that must not be broken:

- `extractFeatures()`
- `mergeSavedGestureSamples()`
- `updateUI()`
- `captureThumbnail(type)`
- `startRecording(type)`
- `stopRecording(type)`
- `trainModel()`
- `autoTrainForTranslate()`
- `jitterFeatures(features, amount)`
- `averageScores(history)`
- `startLivePrediction(forTranslation)`
- `stopLivePrediction()`
- `getWordBank()`
- `setLang(lang)`
- `addCustomWord()`
- `removeCustomWord(idx)`
- `renderWordChips()`
- `renderTranslation()`
- `speakWord(word)`
- `speakAll()`
- `clearTranslation()`
- `copyTranslation()`
- `downloadTranslation()`
- `goToStep(step)`
- `nextStep()`
- `setStep(step)`
- `showToast(msg, dur)`

Event hooks and inline handlers that must remain functional:

- Step pill `onclick` handlers.
- Next button `onclick`.
- Train button `onclick`.
- Continue to Translate button `onclick`.
- Language chip `onclick` handlers.
- Custom word add/remove handlers.
- Speak, clear, copy, and save handlers.
- Camera enable click listener.
- Record start/stop mouse and touch listeners.
- Clear samples listeners.
- Export/load training data listeners.
- Word input Enter key listener.

External/global dependencies that must remain protected:

- `tf`
- MediaPipe Hands script
- `DB_API.saveTranslation`
- `saveRecording`
- `window.extractLandmarkFeatures`
- `window.loadGestureDatasetForTraining`
- `navigator.mediaDevices.getUserMedia`
- `window.speechSynthesis`
- `SpeechSynthesisUtterance`
- `navigator.clipboard`

## Planned Changes

Pending approval, revise `camera-translator.html` only to:

- Align the screen with the approved dark kiosk design system.
- Preserve all JavaScript hooks, IDs, workflow behavior, navigation destinations, and API/database calls.
- Keep training inside `camera-translator.html`.
- Reduce or eliminate visible scrolling for 1024 x 600.
- Improve touch target sizes.
- Make the translate-only sign-to-text mode feel like a focused kiosk screen.
- Consolidate repeated inline styles into reusable classes.
- Replace non-semantic clickable `div` controls with safer controls only where it will not break existing JavaScript.
- Keep all backend/API/database/deployment behavior unchanged.

## Expected UI Result

- Camera translator uses the same dark theme foundation as the Welcome Screen.
- Main camera, training, prediction, and translation workflows fit the 1024 x 600 kiosk target more reliably.
- Navigation remains clear and touch-friendly.
- Training remains integrated with the camera workflow.
- Sign-to-text translate-only mode becomes cleaner and less cluttered.
- No backend, API, database, or deployment behavior changes occur.

## Risk Assessment

See detailed Risk Assessment above.

## Approval Status

Modification approved by user. Completion report waiting for user approval.

## Changes Applied

- Replaced the local light pink/white visual theme with the approved dark kiosk theme.
- Reworked the inline CSS design tokens to match the shared system used by `style.css`.
- Tightened the top navigation to a fixed 54px kiosk header.
- Changed the main workflow layout to a 320px left panel plus flexible camera workspace.
- Reduced panel padding, heading sizes, log height, and history height to better fit 1024 x 600.
- Changed left panel overflow from scroll-dependent to hidden/compact layout behavior.
- Increased common control targets to practical kiosk sizes, mostly 44-46px minimum height.
- Standardized card, button, progress, input, badge, toast, and camera frame styling.
- Improved translate-only mode with a dedicated two-column camera/output layout.
- Kept the camera feed prominent in translate-only mode.
- Kept translation output visible beside the camera in translate-only mode.
- Added explicit `type="button"` to all button elements, including dynamically rendered word-chip buttons.
- Preserved all protected IDs, JavaScript hooks, navigation destinations, and integrated training behavior.

## UI Improvement Summary

- The camera translator now visually matches the dark Sining Kamay kiosk system.
- The camera frame, prediction overlay, training controls, and translation output now share one consistent component language.
- The screen is less visually dense while still keeping the training workflow integrated.
- Translate-only mode now prioritizes the camera feed and translated output as the primary kiosk task.

## Layout Changes

- Main layout now uses `grid-template-columns: 320px minmax(0, 1fr)`.
- Page height is locked to `calc(100vh - 54px)` under a fixed-height nav.
- The right panel uses compact spacing and a camera max width of 612px.
- Translate-only mode uses a two-column layout: camera on the left, translation output on the right.
- The left panel is compacted with smaller headings, tighter cards, and reduced gaps.

## Theme Changes

- Replaced light background variables with dark tokens: `#120a12`, `#1c111b`, and `#261827`.
- Reused the approved accent direction: pink primary, gold secondary, green success, muted light text.
- Removed the dominant pale pink/white screen appearance.
- Standardized borders, surfaces, shadows, and text colors around the approved kiosk design system.

## Touch Usability Changes

- Primary and secondary controls now share a minimum 44px height where practical.
- Dataset action buttons use 46px minimum height.
- Buttons have clearer focus-visible styling.
- Button spacing is more consistent across navigation, training, translation, and camera controls.
- All buttons now explicitly declare `type="button"` for predictable interaction.

## Scroll Reduction Results

- Body and page-level layout use `overflow:hidden`.
- Left panel no longer depends on `overflow-y:auto`.
- Training log and translation history were reduced and clipped to avoid visible internal scrolling.
- Sample strip and word chips are constrained to compact heights.
- Remaining inline `style=` attributes are behavior-related or JavaScript-updated display/progress states and were not removed to avoid breaking behavior.

## Verification Results

- Confirmed CSS brace count is balanced: 182 opening braces and 182 closing braces.
- Confirmed all 60 protected IDs remain present.
- Confirmed button count is 21 and every button has `type="button"`.
- Confirmed `div` tags are balanced: 117 opening and 117 closing.
- Confirmed dark theme token `--bg:#120a12` exists.
- Confirmed translate-only layout rules exist.
- Confirmed protected dependency references remain: `DB_API`, `saveRecording`, `window.extractLandmarkFeatures`, `window.loadGestureDatasetForTraining`, `trainModel`, `setStep`, `startLivePrediction`, and `goToStep`.
- Browser visual verification was not run because local preview was previously blocked by the in-app browser policy.

## Remaining Issues

- The file still contains inline CSS and inline JavaScript; extraction was not performed to avoid increasing behavior risk.
- 17 inline style attributes remain, mostly for hidden panels, progress widths, and script-managed state.
- Some symbols appear as mojibake in shell output, indicating encoding should be handled carefully in future edits.
- Actual camera behavior still needs real-device/browser permission testing.
- Some compact sections may still be dense at exactly 1024 x 600, especially during training logs or long translation output.

## Risk Assessment After Changes

Risk level: Medium.

Reason: the applied changes were primarily CSS and button-type cleanup, while protected IDs and JavaScript behavior were preserved. Risk remains because this file is still a single document containing camera, training, prediction, translation, and database-save behavior.

## Verification Results

- Confirmed `camera-translator.html` exists and has 1,021 lines.
- Confirmed one inline `<style>` block of about 22,890 characters.
- Confirmed inline script block of about 25,977 characters.
- Confirmed 17 inline style attributes.
- Confirmed expected workflow IDs are present.
- Confirmed no `train-gestures.html` file was present in the prior project scan.
- `camera-translator.html` was modified after user approval for the UI-first revision.

## Screens Impacted

Camera translator, gesture training, prediction, and sign-language-to-voice/text workflows.

## Next Recommended File

After approved `camera-translator.html` completion approval: `reports.html`.
