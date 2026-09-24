# Signing screen — camera-first controls redesign

## Why

`docs/ui-target/README.md`'s own target for Screen 03 ("03 — Signing") never
specified side columns: the camera view is spec'd at 560×300, centred, with
one orange button below it — no ESL/FSL or Hand Guide controls mentioned.
Those two controls were added during the signing-screen merge as two 200px
`.signing-side` columns flanking the camera (`talk.html:1069-1084`,
`.signing-side{width:200px...}` at `talk.html:654`), which the owner reports
as visually cramping the camera — confirmed by the numbers: the current row
is 200+16+560+16+200 = 992px of the 1024px screen, leaving the camera at
only 54.7% of screen width.

The owner initially recalled these controls as "overlaid" on the camera —
checked against `archive/sign-to-text.html:84-87`: they never were. The
original had all three controls (ESL Mode, FSL Mode, Hand Guide) in one row
*below* the camera, in a roomy desktop two-panel layout. What talk.html's
merge changed was splitting that one row into two side columns — this design
undoes that split and reclaims the width, while fitting the kiosk's much
tighter vertical budget (see Layout below).

## Scope

In:
- Remove the two `.signing-side` columns from `#screen-signing`'s live state.
- Grow `.camera-box` from 560×300 to 760×~300 (width only — see Layout for
  why height cannot grow).
- Move the ESL/FSL toggle and the Hand Guide toggle into the same row as the
  existing Translate/Stop button (`#stop-signing-btn`), as compact
  short-label controls, not full-word buttons.

Out:
- No change to the Guide/waiting sub-state (`#signing-guide`) — this is
  `data-signing="live"` only.
- No change to `#screen-speaking` (Speak or Type) or its virtual keyboard —
  the owner confirmed this is a separate, later spec.
- No change to camera/MediaPipe logic, gesture recognition, or the confirm
  card flow — layout only.
- No change to the existing camera overlays (`.signing-cam-overlay`,
  `.signing-caption-pill`, `.signing-draft`) beyond resizing naturally with
  their now-wider parent — they're already `position:absolute` inset within
  `.camera-box`.

## Layout

**The vertical budget is the real constraint, not the horizontal one.**
`#screen-signing` gets `padding-top:186px` (90 header + 96 collapsed thread
strip) on every turn after the first (`talk.html:462-463`), leaving only
600−186 = 414px of content height. The current content — camera (300 +
16 margin-top) + button (68 + 14 margin-top) — already uses 398px, a 16px
slack. Adding a *separate* row of controls below the camera (another
~50-70px) would overflow the fixed 1024×600, `overflow:hidden` screen and
clip the button.

So the redesign reuses the existing button row instead of adding a new one:

```
┌──────────────────────────────────────────────────────────┐
│                    [camera-box: 760×300]                  │
│              (live caption pill, overlays unchanged)      │
└──────────────────────────────────────────────────────────┘
[ EN | FIL ]      [        Translate / Stop & Add        ]      [ ● Guide ]
   ~140px                      ~488px (flex)                       ~100px
```

- `.camera-box`: 560×300 → **760×300**. Width only — height stays 300 because
  the vertical budget has no more than ~16px of headroom to begin with
  (confirmed above), so growing height risks overflow on every turn after
  the first. Width grows because that's what the two removed columns freed.
- The controls row sits where `#stop-signing-btn` sits today — same
  vertical position, same margin-top (14px) from the camera. No new row, no
  new height.
- Row width matches the camera's new width (760px), split three ways with
  16px gaps: EN/FIL toggle (~140px, fixed) — Translate button (flex-grow,
  ~488px, stays the screen's one orange element per
  `docs/system/DECISIONS.md`'s orange-audit rule) — Guide toggle (~100px,
  fixed).
- Exact pixel widths are a target, not a hard requirement — the implementer
  should keep the row's total width ≤ 760px and each control's touch target
  ≥ 60×60px (`docs/revision/MEMORY.md`'s project-wide tap-target floor, not
  the generic 44px WCAG minimum), adjusting the three widths as needed once
  built and measured on the actual 1024×600 canvas.

## Component behaviour

- **EN/FIL toggle** (was `#chip-esl` / `#chip-fsl`, two separate 200×60
  `.mode-chip` buttons reading "ESL Mode" / "FSL Mode"): becomes a single
  compact two-segment control, short labels only ("EN" / "FIL"). Keep both
  element ids and their existing `tlSetLang`-equivalent click wiring
  (`js/talk-signing.js` — exact function name is a plan-time lookup) —
  this is a label/size/position change, not a behaviour change.
- **Hand Guide toggle** (was `#chip-guide` reading "Hand Guide: On"):
  becomes an icon + coloured state dot + short label ("Guide"), matching the
  original 🟢 on/off indicator pattern from `archive/sign-to-text.html:87`.
  Same click handler, same on/off state — label and size change only.
- Per `docs/ui-target/README.md:116` ("a bare icon does not read from two
  metres away"), neither control drops to icon-only — both keep a short text
  label alongside any icon/dot.
- `.mode-chip:disabled` styling (`talk.html:664`) carries over unchanged —
  whatever currently disables these controls during active
  capture/translation keeps doing so; this redesign does not touch that
  logic, only the buttons' size and position.

## Error handling

No new error states. The existing camera overlays
(`.signing-cam-overlay`/`#signing-cam-overlay-text` for "Starting camera…"
and camera errors, `.signing-caption-pill` for the live recognition caption)
are `position:absolute` within `.camera-box` and resize with it automatically
— nothing to change there.

## Testing scope

Automated (measured, cited):
- `document.scrollWidth` stays 1024 in the live sub-state, both on the first
  turn (90px padding-top) and a later turn (186px padding-top, thread strip
  present) — the tight-budget case this design was built around.
- Zero console errors.
- Controls row's total rendered width ≤ 760px; each control's rendered
  touch target ≥ 60×60px (project floor, see `docs/revision/MEMORY.md`).
- EN/FIL and Guide toggles keep their existing click behaviour (same
  handler fires, same active/disabled state reflected in the DOM) —
  regression check, not new behaviour.
- `git diff --stat` matches exactly: `talk.html` (+ this spec doc and any
  `docs/system/*.md` updates the implementer makes). No other file.

Manual (new `docs/system/MANUAL-CHECKS.md` section):
- On the real 7-inch Pi screen: is the enlarged camera comfortably visible,
  and are the three compact controls (EN/FIL, Translate, Guide) still
  legible and easy to tap at kiosk viewing/touch distance?
- Multi-turn check: start a conversation, sign once, return to sign again —
  confirm the screen still fits cleanly at 186px padding-top (the tight-
  budget case) with no clipped button.

## Self-review

- Placeholder scan: none — every dimension above is either cited from
  existing code or stated as a target the implementer measures against.
- Internal consistency: Layout section's "no height growth" is consistent
  with Component behaviour and Testing sections — neither assumes a taller
  camera box.
- Scope check: single screen, single concern (control layout) — no
  decomposition needed.
- Ambiguity check: exact per-control pixel widths are explicitly marked as
  targets, not hard requirements, so the implementer isn't stuck if the
  real rendered text/icons need a few px more or less — the ≤760px row
  total and ≥44px touch-target floor are the hard constraints.
