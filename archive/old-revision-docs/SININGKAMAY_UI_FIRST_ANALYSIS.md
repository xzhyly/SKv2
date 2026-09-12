# SiningKamay UI-First Analysis Report

Date prepared: 2026-06-09  
Target device: 7-inch kiosk touchscreen  
Target resolution: 1024 x 600 landscape  
Scope: UI/UX only

## 1. Executive Summary

SiningKamay is an IoT-based Filipino Sign Language translation kiosk. Its active user interface is built mainly from:

- `index.html` and `style.css` for the Welcome screen and Voice/Text to Sign flow
- `camera-translator.html` for Camera Translator, AI training, prediction, and Sign Language to Voice/Text
- `reports.html` for reports
- `script.js` for Voice/Text to Sign UI behavior
- `db-api.js` and `gesture-data.js` for UI-adjacent data helpers

The project already has a kiosk-oriented UI foundation, but the next revision should focus on consistency, accessibility, light-mode modernization, touch usability, and better screen flow for first-time users.

This revision must not change backend logic, API behavior, database structure, machine learning logic, gesture recognition logic, or Raspberry Pi deployment behavior.

## 2. Current State Assessment

### Architecture

The project is a plain HTML, CSS, and JavaScript web application. It does not use a frontend framework. The structure is manageable, but `camera-translator.html` is large and tightly coupled because it contains markup, inline styles, inline scripts, camera behavior, TensorFlow training, prediction, translation, and database save calls.

### Current Strengths

- Clear kiosk entry point through `index.html`.
- Welcome screen already uses large touch-friendly buttons.
- Navigation routes exist for Learning, AI Train, Sign Language to Voice/Text, Voice/Text to Sign Language, and Reports.
- `camera-translator.html?screen=translate` provides a focused sign-to-text mode.
- Reports screen includes summary metrics, tabs, and print/PDF output.
- Existing documentation already defines UI-only revision rules.
- Current layouts mostly respect the 1024 x 600 kiosk target.

### Current Weaknesses

- Design system is split across shared CSS and inline page styles.
- Current active visual theme is dark, but the next requested modernization requires light mode only.
- Camera/training screen is dense for a 7-inch kiosk.
- Some controls are below the ideal 48 x 48px touch target.
- Some interactive controls are clickable `div` elements instead of semantic buttons.
- Reports tables are dense and clip long values.
- External Learning link depends on network access and may leave the kiosk experience.
- Older frontend files exist, including `main.js`, `CSS/style.css`, and `dist/build.js`, so care is needed to avoid changing legacy behavior unintentionally.

## 3. UI Problems

1. The visual system is not centralized.
   Similar button, card, color, and spacing styles are repeated across multiple files.

2. The current theme does not match the new requirement.
   Existing screens use a dark kiosk theme, while the next modernization should be light mode only.

3. Some dashboard labels are technical.
   `AI Train` may be unclear for first-time users. `Gesture Training` or `Train Gestures` is more understandable.

4. Translation modes are split across different screen models.
   Voice/Text to Sign is inside `index.html?screen=voice`, while Sign Language to Voice/Text is inside `camera-translator.html?screen=translate`.

5. Camera Translator is overloaded.
   It contains camera display, training, prediction, output language, custom words, save/copy/speak actions, and status overlays.

6. Reports are administrator-focused.
   The report tables are useful, but they are too dense for general kiosk users.

7. Asset organization is inconsistent.
   Assets are spread across `assets`, `Images`, `Design`, and `signlanguagedatas`.

## 4. UX Problems

### Welcome Screen

User objective: choose a task quickly.

Current pain points:

- Some labels are technical.
- External Learning link may break kiosk containment.
- Public user actions and admin/research actions are mixed.

Suggested improvements:

- Use plain labels such as `Learn Signs`, `Translate Sign to Text`, `Translate Text to Sign`, `Train Gestures`, and `View Reports`.
- Use icons beside text labels.
- Separate public actions from admin/research actions.

### Translation Screen

User objective: convert spoken or typed text into sign visuals.

Current pain points:

- Press-and-hold microphone behavior may not be obvious.
- Status messages are small.
- Download History is less important than the main translation task.

Suggested improvements:

- Make `Hold to Speak` the dominant action.
- Keep text input and Translate button large.
- Move Download History to a secondary action area.
- Make the sign display larger and more central.

### Camera Translator

User objective: perform a sign and receive text/voice output.

Current pain points:

- Camera permission state needs clearer user guidance.
- Confidence display may feel too technical.
- Output competes visually with the camera feed.

Suggested improvements:

- Make the camera feed the dominant visual element.
- Use simple states: `Camera Ready`, `Show your sign`, `Recognized`, and `Try again`.
- Hide technical confidence in public translate mode.
- Keep Speak, Clear, and Save as large bottom actions.

### Gesture Training

User objective: capture and train new gestures.

Current pain points:

- Training screen is dense and technical.
- Logs and sample counts may overwhelm first-time users.
- Step controls are compact.

Suggested improvements:

- Use a guided wizard: Name Gesture, Capture Samples, Train, Test.
- Replace technical logs with friendly progress states.
- Keep detailed logs in a secondary/admin area if needed.

### Reports

User objective: view saved signs, translations, and system records.

Current pain points:

- Tables are dense.
- Long values are clipped.
- No clear row detail view.

Suggested improvements:

- Prioritize summary cards.
- Use large segmented tabs.
- Add row detail view for long records.
- Keep Print/Save PDF as an admin action.

### History

User objective: review recent translations.

Current pain points:

- History exists through download/report behavior but is not a clear user flow.
- Users may not know what is being saved.

Suggested improvements:

- Add a simple Recent Translations screen or panel.
- Show latest items as readable rows.
- Provide Clear, Save, and Print only where appropriate.

### Administration Features

User objective: manage training data, reports, and research records.

Current pain points:

- Admin and public functions are mixed on the main dashboard.
- Reports and training are exposed beside public translation actions.

Suggested improvements:

- Visually separate public translation from admin/research features.
- Consider a future PIN or admin gate only if behavior changes are later allowed.

## 5. Kiosk Design Assessment

Target display: 1024 x 600 landscape.

Recommended kiosk standards:

- Minimum touch target: 48 x 48px.
- Primary actions: 64-76px tall.
- Secondary actions: 48-56px tall.
- Minimum body text: 16px.
- Important status text: 18-22px.
- Main screen title: 32-40px.
- Avoid scrolling in public flows.
- Avoid more than five primary actions on one screen.
- Keep public navigation depth to two levels.
- Keep one dominant task per screen.
- Provide persistent Home/Dashboard access.
- Use visible active, pressed, disabled, loading, success, and error states.
- Avoid technical logs in public-facing screens.

Current kiosk fit:

- Welcome Screen: strong fit.
- Voice/Text to Sign: acceptable, but should be simplified.
- Sign Language to Voice/Text: strong concept, needs light-mode redesign and clearer states.
- Gesture Training: usable but dense.
- Reports: functional but administrator-focused.
- History: not yet a first-class kiosk flow.
- Administration: not clearly separated from public use.

## 6. Design System Proposal

### Style Direction

Modern, professional, educational, friendly, accessible, light mode only, suitable for all ages, and appropriate for a public kiosk.

### Color Palette

- Background: `#F7FAFC`
- Surface: `#FFFFFF`
- Surface soft: `#EEF6F8`
- Primary: `#0077B6`
- Primary dark: `#005F8F`
- Secondary: `#F9C74F`
- Accent coral: `#F9844A`
- Success: `#2D9C6A`
- Warning: `#F59E0B`
- Error: `#D64545`
- Text strong: `#1F2933`
- Text body: `#334E68`
- Text muted: `#6B7C93`
- Border: `#D9E2EC`
- Focus ring: `#F9C74F`

### Typography

- Font family: `Segoe UI`, `Nunito`, `Arial`, sans-serif
- Display title: 36-42px, 800 weight
- Screen heading: 28-34px, 800 weight
- Section heading: 20-24px, 700 weight
- Body text: 16-18px, 500-600 weight
- Status text: 18-22px
- Metadata text: 13-14px for reports/admin only

### Spacing

- Base unit: 8px
- Tight gap: 8px
- Standard gap: 16px
- Large gap: 24px
- Screen padding: 24px
- Major panel gap: 20-24px
- Control gap: 12px

### Border Radius

- Buttons: 8px
- Cards: 8px
- Major panels and camera frames: 12px
- Pills only for real tags, chips, and status badges

### Card Style

- White or soft surface background.
- 1px border using `#D9E2EC`.
- Subtle shadow only for major panels.
- Avoid nested cards.
- Use cards for repeated report items, translation results, and training steps.

### Button Style

- Primary button: blue background, white text, 64px height for main actions.
- Secondary button: white background, blue border/text, 56px height.
- Destructive button: red border/text, filled red only for confirmation.
- Disabled button: low-contrast surface with clear disabled state.
- Use icon plus text for major kiosk actions.

### Icon Style

Use simple line icons around 24-28px. Recommended icons include Home, Camera, Mic, Keyboard, Volume, FileText, BarChart, Refresh, CheckCircle, and AlertCircle.

### Animation Guidelines

- Use short 120-180ms transitions.
- Avoid decorative motion.
- Use animation only for feedback such as recording, camera live state, training progress, and translation success.
- Respect reduced-motion preferences.

## 7. Screen Priority Ranking

| Rank | Screen | Reason | Impact | Complexity |
| --- | --- | --- | --- | --- |
| 1 | Camera Translator / Sign Language to Voice/Text | Core kiosk experience and highest user risk | Very high | High |
| 2 | Welcome Screen | Controls first impression and navigation | Very high | Low-Medium |
| 3 | Voice/Text to Sign Language | Second primary translation mode | High | Medium |
| 4 | Gesture Training | Important for teachers/researchers | High | High |
| 5 | Reports | Important for panel/demo/admin use | Medium-High | Medium |
| 6 | History | Useful but not yet a clear screen | Medium | Medium |
| 7 | Administration Features | Important but should not distract from public flows | Medium | Medium-High |
| 8 | External Learning | Depends on external destination | Medium | Unknown |

## 8. Final Recommendation

If only a few screens can be redesigned before deployment, prioritize:

1. Camera Translator / Sign Language to Voice/Text
2. Welcome Screen
3. Voice/Text to Sign Language

Top five priorities:

1. Camera Translator / Sign Language to Voice/Text
2. Welcome Screen
3. Voice/Text to Sign Language
4. Gesture Training
5. Reports

Best ROI improvements:

- Convert the UI to one consistent light-mode design system.
- Increase important touch targets to at least 48px.
- Use plain-language labels.
- Make camera status and translation output larger and clearer.
- Separate public-user flows from admin/research flows.
- Reduce visible technical logs and dense table content.
- Perform final visual QA at exactly 1024 x 600 on the target kiosk browser.
