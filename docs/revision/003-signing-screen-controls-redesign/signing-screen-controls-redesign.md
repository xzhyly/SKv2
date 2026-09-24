# Cycle 003 — signing-screen-controls-redesign

Design: `docs/superpowers/specs/2026-09-21-signing-screen-controls-redesign-design.md`
(read it first — this REVISE implements it, doesn't re-derive it).

Two files, two items. Both are one cycle — same topic, same design doc.

---

## Item 1

FILE: talk.html

ISSUE: `#screen-signing`'s live camera view sits between two 200px
`.signing-side` columns (ESL/FSL on the left, Hand Guide on the right,
`talk.html:1069-1084`) — 992px of the 1024px screen is spoken for, leaving
the camera at only 560px (54.7% of screen width). The design doc traces
this to the signing-merge phase splitting what was originally one row of
controls below the camera (`archive/sign-to-text.html:84-87`) into two side
columns.

FIX: Four precise edits in this one file — remove the two side columns,
widen `.camera-box` to 760px (width only, per the design doc's vertical-
budget math), and move the ESL/FSL + Hand Guide controls into one row with
`#stop-signing-btn`, as compact short-label controls (`EN`/`FIL`, `Guide`).
Do not change any id — `js/talk-signing.js` (Item 2) still looks up
`chip-esl`/`chip-fsl`/`chip-guide`/`stop-signing-btn` by those exact ids.
`.mode-chip` (talk.html:655-664) is NOT touched — `#screen-speaking`'s
`chip-lang-en`/`chip-lang-fil` still use it and are out of scope.

FIND 1:
```
  .signing-row{display:flex;align-items:flex-start;gap:16px}
  .signing-side{width:200px;display:flex;flex-direction:column;gap:12px;margin-top:16px}
  .mode-chip{
```
REPLACE 1:
```
  /* Screen 03 controls redesign (docs/superpowers/specs/2026-09-21-
     signing-screen-controls-redesign-design.md): the camera's old two
     200px .signing-side flanking columns are gone — .signing-row now
     wraps .camera-box alone, and the EN/FIL + Guide controls moved into
     .signing-controls-row below (next to #stop-signing-btn, see that
     rule's block further down). .mode-chip below is left untouched:
     #screen-speaking's EN/Filipino chips (chip-lang-en/fil) still use it
     and are out of this redesign's scope. */
  .signing-row{display:flex;justify-content:center}
  .lang-toggle{
    width:140px;height:60px;
    display:flex;
    border:1px solid var(--border);border-radius:12px;
    overflow:hidden;
  }
  .lang-seg{
    flex:1;border:none;
    background:var(--surface);color:var(--muted);
    font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;
  }
  .lang-seg.active{background:var(--navy);color:var(--surface)}
  .lang-seg:disabled{opacity:0.5;cursor:not-allowed}
  .guide-toggle{
    width:100px;height:60px;
    display:flex;align-items:center;justify-content:center;gap:6px;
    border:1px solid var(--border);border-radius:12px;
    background:var(--surface);color:var(--muted);
    font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;
  }
  .guide-toggle::before{
    content:'';width:8px;height:8px;border-radius:50%;
    background:var(--muted-light);flex-shrink:0;
  }
  .guide-toggle.active{background:var(--navy);border-color:var(--navy);color:var(--surface)}
  .guide-toggle.active::before{background:var(--green)}
  .guide-toggle:disabled{opacity:0.5;cursor:not-allowed}
  .mode-chip{
```

FIND 2:
```
  .camera-box{
    width:560px;height:300px;
```
REPLACE 2:
```
  .camera-box{
    width:760px;height:300px;
```

FIND 3:
```
  .stop-signing-btn{
    width:560px;height:68px;
    margin-top:14px;
    border:none;border-radius:12px;
    background:var(--orange);
    color:var(--surface);
    font-family:inherit;font-size:18px;font-weight:700;
    cursor:pointer;
    transition:background 0.08s;
  }
  .stop-signing-btn:active{
    background:#ea6a0a;
  }
```
REPLACE 3:
```
  .signing-controls-row{
    display:flex;align-items:center;gap:16px;
    width:760px;margin-top:14px;
  }
  .stop-signing-btn{
    flex:1;height:68px;
    border:none;border-radius:12px;
    background:var(--orange);
    color:var(--surface);
    font-family:inherit;font-size:18px;font-weight:700;
    cursor:pointer;
    transition:background 0.08s;
  }
  .stop-signing-btn:active{
    background:#ea6a0a;
  }
```

FIND 4:
```
    <!-- Live camera view. -->
    <div class="signing-live" id="signing-live">
      <div class="signing-row">
        <div class="signing-side">
          <button type="button" class="mode-chip active" id="chip-esl">ESL Mode</button>
          <button type="button" class="mode-chip" id="chip-fsl">FSL Mode</button>
        </div>
        <div class="camera-box" id="camera-box">
          <video id="signing-video" class="camera-video" autoplay playsinline muted></video>
          <canvas id="tlCanvas1" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:2; transform:scaleX(-1);"></canvas>
          <div class="signing-draft" id="signing-draft"></div>
          <div class="signing-caption-pill"><span id="signing-caption">Show your sign</span></div>
          <div class="signing-cam-overlay" id="signing-cam-overlay"><span id="signing-cam-overlay-text">Starting camera…</span></div>
        </div>
        <div class="signing-side">
          <button type="button" class="mode-chip active" id="chip-guide" aria-pressed="true">Hand Guide: On</button>
        </div>
      </div>
      <!-- Real control (js/talk-signing.js): "Translate" starts the 3 s
           countdown, "Stop & Add to Conversation" ends the recording and
           hands the recognised sentence to openModal('confirm', ...) — never
           straight to appendBubble(). Its click handler lives in
           TalkSigning.init(), not in this file's <script>. -->
      <button type="button" class="stop-signing-btn" id="stop-signing-btn">Translate</button>
    </div>
  </div>
```
REPLACE 4:
```
    <!-- Live camera view. Screen 03 controls redesign
         (docs/superpowers/specs/2026-09-21-signing-screen-controls-redesign-design.md):
         the camera used to sit between two 200px .signing-side columns
         (ESL/FSL left, Hand Guide right); those are gone — .camera-box now
         has the row to itself, and the same three controls (same ids, same
         click wiring in js/talk-signing.js) moved into
         .signing-controls-row below, next to Translate. -->
    <div class="signing-live" id="signing-live">
      <div class="signing-row">
        <div class="camera-box" id="camera-box">
          <video id="signing-video" class="camera-video" autoplay playsinline muted></video>
          <canvas id="tlCanvas1" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:2; transform:scaleX(-1);"></canvas>
          <div class="signing-draft" id="signing-draft"></div>
          <div class="signing-caption-pill"><span id="signing-caption">Show your sign</span></div>
          <div class="signing-cam-overlay" id="signing-cam-overlay"><span id="signing-cam-overlay-text">Starting camera…</span></div>
        </div>
      </div>
      <div class="signing-controls-row">
        <div class="lang-toggle" role="group" aria-label="Language">
          <button type="button" class="lang-seg active" id="chip-esl">EN</button>
          <button type="button" class="lang-seg" id="chip-fsl">FIL</button>
        </div>
        <!-- Real control (js/talk-signing.js): "Translate" starts the 3 s
             countdown, "Stop & Add to Conversation" ends the recording and
             hands the recognised sentence to openModal('confirm', ...) — never
             straight to appendBubble(). Its click handler lives in
             TalkSigning.init(), not in this file's <script>. -->
        <button type="button" class="stop-signing-btn" id="stop-signing-btn">Translate</button>
        <button type="button" class="guide-toggle active" id="chip-guide" aria-pressed="true">Guide</button>
      </div>
    </div>
  </div>
```

WHY: Reclaim the width the two 200px side columns were taking, without
adding a new row (there's only ~16px of vertical slack once the thread
strip is showing — traced in the design doc) — reuse the button's row
instead, and keep both controls legible with short text, not icon-only
(`docs/ui-target/README.md:116` — bare icons don't read from two metres).

VERIFY:
1. Load talk.html fresh, reach the signing live sub-state. `#camera-box`
   computed width is 760px, not 560px.
2. `#screen-signing .signing-live` has no `.signing-side` element left —
   `document.querySelectorAll('.signing-side').length === 0`.
3. `#chip-esl`/`#chip-fsl`/`#chip-guide`/`#stop-signing-btn` all still
   exist by those exact ids, all inside one `.signing-controls-row`.
4. `document.body.scrollWidth === 1024` on the signing screen.
5. Zero console errors.
6. Tap `#chip-fsl` — it gains `.active`, `#chip-esl` loses it (existing
   `js/talk-signing.js:63-64` logic, untouched — confirms the id-based
   wiring survived the markup move).

---

## Item 2

FILE: js/talk-signing.js

ISSUE: `syncChips()` sets `#chip-guide`'s full text every time it runs —
`g.textContent = 'Hand Guide: ' + (on ? 'On' : 'Off')` (line 66-67, current
code, confirmed by reading the file before writing this REVISE). If Item 1
ships a static short "Guide" label in the HTML, this line overwrites it
back to "Hand Guide: On"/"Hand Guide: Off" the first time `syncChips()`
runs (it runs on init and on every toggle) — the two files would fight
each other and the compact label would never actually show.

FIX: `syncChips()` sets `#chip-guide`'s label to the static short "Guide"
instead of rewriting it with the on/off state — on/off now shows through
`.active` (existing nav-background swap) and Item 1's new
`.guide-toggle::before` state dot (green when active), so the text no
longer needs to carry the state.

FIND:
```
  function syncChips() {
    var fil = signLang === 'fil';
    $('chip-esl').classList.toggle('active', !fil);
    $('chip-fsl').classList.toggle('active', fil);
    var on = window.showSkeleton !== false;
    var g = $('chip-guide');
    g.textContent = 'Hand Guide: ' + (on ? 'On' : 'Off');
    g.classList.toggle('active', on);
    g.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
```
REPLACE:
```
  function syncChips() {
    var fil = signLang === 'fil';
    $('chip-esl').classList.toggle('active', !fil);
    $('chip-fsl').classList.toggle('active', fil);
    var on = window.showSkeleton !== false;
    var g = $('chip-guide');
    // Screen 03 controls redesign (docs/superpowers/specs/2026-09-21-
    // signing-screen-controls-redesign-design.md): label stays the static
    // short "Guide" — on/off now shows via .active (nav background) and
    // the CSS-only state dot (.guide-toggle::before, green when active),
    // not by rewriting the button's text on every sync.
    g.textContent = 'Guide';
    g.classList.toggle('active', on);
    g.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
```

WHY: Without this, Item 1's HTML label change is silently overwritten the
moment `syncChips()` first runs — the two files must ship together.

VERIFY:
1. Reach the signing live sub-state. `#chip-guide` reads exactly "Guide",
   not "Hand Guide: On"/"Hand Guide: Off".
2. Tap `#chip-guide` — text stays "Guide" (does not change to "Hand Guide:
   Off"), `.active` class and `aria-pressed` toggle as before, and the
   state dot's colour changes (green when active, per Item 1's CSS).
3. Zero console errors.

---

## Scope

Files: `talk.html`, `js/talk-signing.js`. Nothing else — `git diff --stat`
at the end must show exactly these two.
