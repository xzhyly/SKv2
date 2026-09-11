# Phase 5 Analysis Report — camera-translator.html (Translate Sign to Text)

Date: 2026-06-09  
Scope: UI/UX only (no backend/API/DB/ML/gesture/deployment changes)  
Target kiosk: 1024 × 600 landscape, no-scroll public flow  
Priority: Translate-only mode (`camera-translator.html?screen=translate`)

## File in Scope

- `camera-translator.html` (single-file UI with inline CSS + inline JS)

## Objective (Phase 5)

Make the “Translate Sign to Text” kiosk experience the strongest public flow:

- Apply approved **light-mode only** design system.
- Make camera feed the dominant visual element.
- Keep translated output visible and readable beside/below camera.
- Make camera permission state clearer.
- Use simple status labels (avoid technical/ML wording) in public translate mode.
- Keep Speak / Clear / Copy as large touch-friendly actions.
- Preserve all existing behavior (camera, training, prediction, translation, DB saves).

## Entry Modes (Existing)

- Full workflow (training + predict + translate): `camera-translator.html`
- Translate-only public mode: `camera-translator.html?screen=translate`
  - Adds `body.translate-only`
  - Hides left panel + step pills + Next button
  - Uses the right panel as the main experience (camera + output)

Phase 5 will prioritize translate-only mode first; training UI simplification is Phase 6.

## Protected Hooks (Must Not Break)

Critical IDs referenced by inline JS (must remain unchanged):

- Navigation/step state:
  - `pill1`, `pill2`, `pill3`, `pill4`, `nextBtn`
  - `leftStep1`, `leftStep2`, `leftStep3`, `leftStep4`
- Camera + overlay:
  - `videoFeed`, `cameraFrame`, `cameraPlaceholder`, `camBadge`, `enableCamBtn`
  - `predictOverlay`, `predEmoji`, `predLabel`, `predConf`, `predFillMini`
- Translate outputs:
  - `rightStep4`, `tlBigOutput`, `tlHistory`
  - `speakBtn`, `speakBigBtn`
  - `langEn`, `langFil`, `wordInput`, `wordChips`
- Prediction panel (step 3):
  - `rightStep3`, `livePredResult`, `confBar`
- Dataset/training (Phase 6 but must not break now):
  - `gestureDatasetCard`, `gestureLabelInput`, `startGestureDataBtn`, `stopGestureDataBtn`
  - `gestureDataStatus`, `gestureDataStatusText`, `gestureDataFrameCount`
  - `trainBtn`, `trainLog`, `epochBar`, `epochLabel`, `trainDataControls`
  - `recordStartBtn`, `recordStopBtn`, `clearStart`, `clearStop`, `startCount`, `stopCount`, `startProgress`, `stopProgress`
  - `downloadBtn`, `loadBtn`, `step2StartCount`, `step2StopCount`
- Misc:
  - `sampleStrip`, `sampleStripRow`, `sk-toast`

Behavior-sensitive classes / states (used by JS or important CSS):

- `translate-only`, `active`, `done`, `live`, `show`, `predicting`, `glowing`, `recording`, `speaking`, `idle`, `primary`, `secondary`, `detected`

## Current Issues (Translate-only Mode)

- Theme is still locally defined inside `camera-translator.html` and is not aligned with the approved root `style.css` light-mode palette.
- Some labels and overlays show technical wording (e.g., “Confidence”), which should be reduced in public translate mode.
- Touch targets in translate-only mode are mostly acceptable, but key buttons should align with the kiosk standard:
  - Primary actions 64px+, secondary 48px+
- Camera permission state is present but can be simplified visually:
  - Show a clear “Enable Camera” primary action
  - Show a simple status label: “Camera Off / Camera Ready / Permission Denied”
- The output panel (`#tlBigOutput`) can be emphasized as the translation result, with stronger hierarchy and less “training UI” visual language.

## Planned UI Changes (Pending Approval)

### A. Light-mode Token Conversion (Inline :root)

Replace the current dark tokens in the inline `<style>` with the approved light-mode set to match `style.css`:

- Background/surfaces:
  - `--bg: #F7FAFC`
  - `--bg-soft: #EEF6F8`
  - `--surface: #FFFFFF`
  - `--surface2: #FFFFFF`
  - `--border: #D9E2EC`
  - `--border-md: #C7D2E0`
- Primary/secondary:
  - `--pink`/primary → `#0077B6`
  - `--pink-deep` → `#005F8F`
  - `--gold`/focus/accent → `#F9C74F`
  - Accent coral (where needed) → `#F9844A`
- Text:
  - strong `#1F2933`, body `#334E68`, muted `#6B7C93`
- Status:
  - success `#2D9C6A`, warning `#F59E0B`, error `#D64545`

Variable names can remain the same (e.g., keep `--pink` but map it to the new primary color) to reduce risk.

### B. Translate-only Layout Polish (No Behavior Change)

Within `body.translate-only` CSS:

- Keep camera as the dominant element (largest area).
- Keep output panel visible at all times (already true) but increase readability:
  - Larger output font weight/contrast
  - Clear empty state text
- Ensure no scroll in translate-only mode:
  - Keep `overflow: hidden`
  - Constrain history height and avoid internal scroll where possible

### C. Public-Friendly Status and Overlay

In translate-only mode only:

- Simplify the overlay copy to user-friendly terms (CSS/markup text adjustments only, no logic change):
  - `predConf` can be visually de-emphasized or hidden in translate-only mode (CSS: `display:none`), while keeping the element for JS updates.
  - Keep a simple “Recognizing…” / “Recognized” label, without showing numeric confidence.

### D. Touch Targets

- Make the primary action button `#enableCamBtn` at least 64px tall.
- Ensure bottom actions (Speak/Clear/Copy) are at least 48–56px tall (and consider 64px for Speak in public mode).
- Keep spacing between buttons to reduce mis-taps.

### E. Navigation Text Consistency

In translate-only mode:

- Ensure the visible mode-switch label matches the dashboard naming:
  - Back link: “Dashboard”
  - Switch: “Translate Text to Sign” (links to `index.html?screen=voice`)

## What Will Not Change

- No changes to:
  - TensorFlow / MediaPipe logic
  - training/prediction thresholds
  - camera setup or permission flow
  - database save calls (`DB_API.saveTranslation`)
  - gesture dataset behaviors
  - Raspberry Pi deployment behavior
- No file split; everything remains inside `camera-translator.html`.

## Risk Assessment

Risk level: High.

Reason:

- This file mixes UI + inline CSS + inline JS + camera + ML + DB calls.
- Safe changes are primarily CSS/token updates and text-only content changes; structural changes must be minimal.

## Approval Request

If you approve this Phase 5 analysis, I will:

1. Modify `camera-translator.html` focusing first on `?screen=translate` UI-only improvements (light-mode conversion + touch targets + simplified public overlay).
2. Produce a Phase 5 completion report in `docs/revisions/`.

