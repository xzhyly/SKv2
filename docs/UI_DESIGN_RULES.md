# UI Design Rules

Date created: 2026-06-05

All future UI changes must follow these rules.

## Resolution

- Target kiosk resolution: 1024 x 600.
- Primary screens must fit inside the viewport.
- No scrolling in final kiosk operation.
- Layouts must remain usable with touch input.

## Theme

- Theme: dark kiosk interface with warm Sining Kamay brand accents.
- Screens should feel consistent across dashboard, camera translator, training, translation, and reports.
- Avoid mixing unrelated visual systems between pages.

## Color Palette

- Page background: `#120A12`
- Surface: `#1C111B`
- Elevated surface: `#261827`
- Border: `#3A2639`
- Primary accent: `#E8648A`
- Primary deep: `#C94474`
- Secondary accent: `#F6C85F`
- Success: `#34A87A`
- Warning: `#F4A261`
- Text strong: `#FFFFFF`
- Text default: `#F6EAF1`
- Text muted: `#BCA6B5`

## Font Family

- Preferred: `Segoe UI`, `Nunito`, `Arial`, sans-serif.
- Use one shared font stack per page unless a logo treatment requires display styling.

## Typography Scale

- Page title: 32-42px.
- Section heading: 20-26px.
- Card heading: 16-20px.
- Body text: 14-16px.
- Small status text: 12-13px.
- Button text: 16-22px depending on button importance.
- Avoid text that is too small for kiosk viewing distance.

## Button Sizes

- Minimum touch target: 48 x 48px.
- Primary dashboard buttons: 64-76px height.
- Secondary action buttons: 48-56px height.
- Icon-only controls: at least 48 x 48px.
- Button labels must fit without clipping at 1024px width.

## Card Styles

- Use cards for functional panels, repeated items, camera frames, and report modules.
- Card background should contrast clearly against the page background.
- Cards should not be nested inside decorative cards.
- Important cards should have clear borders or subtle shadows.

## Border Radius

- Default radius: 8px.
- Large panels and camera frames: 12-16px.
- Pills and chips: 999px only when the shape is functionally a pill.
- Avoid excessive rounding on large content blocks.

## Spacing System

- Base spacing unit: 8px.
- Compact gap: 8px.
- Standard gap: 16px.
- Large gap: 24px.
- Page padding at 1024 x 600: 24-32px.
- Keep dense kiosk layouts readable without forcing scroll.

## Touch Target Requirements

- Controls must be easy to press on a kiosk touchscreen.
- Avoid placing important controls too close together.
- Active, hover, pressed, disabled, and loading states should be visually distinct.
- Navigation controls must remain visible and predictable.

## Kiosk Layout Requirements

- Every screen must be verified against 1024 x 600.
- Avoid viewport-height layouts that accidentally create overflow.
- Keep navigation reachable without scrolling.
- Camera, report, and dashboard screens must show their primary action within the first viewport.
