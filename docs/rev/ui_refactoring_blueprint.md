# Sining Kamay: UI Refactoring Blueprint (HTML & CSS Separation)

Ang dokumentong ito ay naglalaman ng gabay sa paghahati ng user interface (UI) ng `camera-translator.html` patungong magkahiwalay na HTML at CSS files.

---

## 1. Dashboard Links Update (`index.html`)
I-update ang mga link sa welcome screen ng `index.html` upang ituro sila sa mga bagong hiwalay na HTML files:
- **Linya 387 (Translate Sign to Text):**
  - *Dati:* `onclick="window.location.href='camera-translator.html?screen=translate'"`
  - *Bago:* `onclick="window.location.href='sign-to-text.html'"`
- **Linya 408 (Train Gestures):**
  - *Dati:* `onclick="window.location.href='camera-translator.html'"`
  - *Bago:* `onclick="window.location.href='gesture-training.html'"`

---

## 2. Bagong HTML Pages

### A. `gesture-training.html` [NEW]
Itong file na ito ay para lamang sa Kiosk ng Training at Pagkuha ng Gesture Samples.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Train Gestures ✿ Sining Kamay</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/gesture-training.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.10.0/tf.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
  <script src="js/db-api.js"></script>
  <script src="js/gesture-data.js"></script>
  <script src="js/camera-helper.js"></script>
  <script src="js/speech-synthesis.js"></script>
  <script src="js/db-local.js"></script>
</head>
<body>

<div id="training-ui" class="active">
  <!-- Nav -->
  <nav class="tr-nav">
    <a href="index.html" class="tr-back">
      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 2L4 7l5 5"/></svg>
      Dashboard
    </a>
    <div class="tr-pills">
      <button class="tr-pill active" id="pill1" onclick="trClickPill(1)">
        <span class="tr-pill-num">1</span><span class="tr-pill-lbl">Add Data</span>
      </button>
      <span class="tr-pill-sep">›</span>
      <button class="tr-pill" id="pill2" onclick="trClickPill(2)">
        <span class="tr-pill-num">2</span><span class="tr-pill-lbl">Train AI</span>
      </button>
      <span class="tr-pill-sep">›</span>
      <button class="tr-pill" id="pill3" onclick="trClickPill(3)">
        <span class="tr-pill-num">3</span><span class="tr-pill-lbl">Predict</span>
      </button>
      <span class="tr-pill-sep">›</span>
      <button class="tr-pill" id="pill4" onclick="trClickPill(4)">
        <span class="tr-pill-num">4</span><span class="tr-pill-lbl">Translate</span>
      </button>
    </div>
  </nav>

  <!-- Instruction Screens -->
  <div id="trInstrWrap">
    <div id="trInstr1" class="tr-instr-card">
      <div class="tr-step-badge">STEP 1 OF 4</div>
      <h1>Step 1: Name and Capture</h1>
      <p class="tr-instr-desc">Type a gesture name, choose the sign set, then capture hand samples using the camera.</p>
      <ul class="tr-instr-bullets">
        <li><span class="tr-bullet-num">1</span>Name the gesture clearly.</li>
        <li><span class="tr-bullet-num">2</span>Keep your hand inside the camera frame.</li>
        <li><span class="tr-bullet-num">3</span>Capture enough samples, then continue to Train Gesture.</li>
      </ul>
      <button class="tr-next-btn" onclick="showStepContent(1)">Next →</button>
    </div>

    <div id="trInstr2" class="tr-instr-card" style="display:none">
      <div class="tr-step-badge">STEP 2 OF 4</div>
      <h1>Step 2: Train Gesture</h1>
      <p class="tr-instr-desc">Review the captured samples, then start training. Keep this screen open until training is complete.</p>
      <ul class="tr-instr-bullets">
        <li><span class="tr-bullet-num">1</span>Check that you have enough start and stop samples.</li>
        <li><span class="tr-bullet-num">2</span>Press the <strong>Train Gesture</strong> button to begin.</li>
        <li><span class="tr-bullet-num">3</span>Wait for the progress bar to finish before continuing.</li>
      </ul>
      <button class="tr-next-btn" onclick="showStepContent(2)">Next →</button>
    </div>

    <div id="trInstr3" class="tr-instr-card" style="display:none">
      <div class="tr-step-badge">STEP 3 OF 4</div>
      <h1>Step 3: Predict Gesture</h1>
      <p class="tr-instr-desc">Test the trained model live with your camera before translating. The prediction result appears in the panel.</p>
      <ul class="tr-instr-bullets">
        <li><span class="tr-bullet-num">1</span>Enable the camera if not already active.</li>
        <li><span class="tr-bullet-num">2</span>Perform your gesture in front of the camera.</li>
        <li><span class="tr-bullet-num">3</span>Continue when the confidence looks stable.</li>
      </ul>
      <button class="tr-next-btn" onclick="showStepContent(3)">Next →</button>
    </div>

    <div id="trInstr4" class="tr-instr-card" style="display:none">
      <div class="tr-step-badge">STEP 4 OF 4</div>
      <h1>Step 4: Translate</h1>
      <p class="tr-instr-desc">Perform your <strong>Start</strong> gesture to add a word. <strong>Stop</strong> gesture marks a pause. Words are spoken aloud!</p>
      <ul class="tr-instr-bullets">
        <li><span class="tr-bullet-num">1</span>Perform the Start gesture to add a word to your translation.</li>
        <li><span class="tr-bullet-num">2</span>Perform the Stop gesture to mark a pause.</li>
        <li><span class="tr-bullet-num">3</span>Speak, copy, or save your translation when done.</li>
      </ul>
      <button class="tr-next-btn" onclick="showStepContent(4)">Start Translating →</button>
    </div>
  </div>

  <!-- Content Screen -->
  <div id="trContentWrap" style="display:none">
    <!-- Top Panel: Camera -->
    <div class="tr-right-panel">
      <div class="tr-cam-lbl">Camera Feed</div>
      <div class="tr-cam-frame" id="cameraFrame">
        <video id="videoFeed" autoplay playsinline muted></video>
        <div class="tr-cam-placeholder" id="cameraPlaceholder">
          <div class="tr-cam-icon">📷</div>
          <p>Enable the camera to start sign translation</p>
        </div>
        <div class="tr-corner tr-corner-tl"></div><div class="tr-corner tr-corner-tr"></div>
        <div class="tr-corner tr-corner-bl"></div><div class="tr-corner tr-corner-br"></div>
        <div class="tr-cam-badge" id="camBadge" role="status" aria-live="polite">
          <div class="live-dot"></div> Camera Off
        </div>
        <div class="tr-pred-overlay" id="predictOverlay">
          <div class="tr-pred-emoji-ov" id="predEmoji">—</div>
          <div class="tr-pred-lbl-ov">
            <div class="tr-pred-lbl-txt" id="predLabel">Show your sign</div>
            <div class="tr-pred-conf-txt" id="predConf">Recognition confidence</div>
          </div>
          <div class="tr-pred-minibar"><div class="tr-pred-minifill" id="predFillMini" style="width:0%"></div></div>
        </div>
      </div>
      <button type="button" class="tr-enable-cam" id="enableCamBtn">📷 Enable Camera</button>
    </div>

    <!-- Bottom Panel: Controls -->
    <div class="tr-left-panel">
      <!-- Step 1 -->
      <div id="leftStep1" class="tr-left-content active">
        <div class="tr-section-lbl">Gesture Sample Capture</div>
        <div id="gestureDatasetCard" data-gesture-recorder>
          <div class="tr-fgrp">
            <label class="tr-flbl">Gesture Name</label>
            <input id="gestureLabelInput" data-gesture-label type="text" class="tr-input" placeholder="Gesture name, e.g. hello" autocomplete="off" aria-label="Gesture name">
          </div>
          <div class="tr-fgrp" style="margin-top:2px">
            <label class="tr-flbl">Sign Set</label>
            <div class="tr-sign-toggle">
              <label class="tr-sign-opt"><input type="radio" name="gestureDatasetType" value="ESL" data-gesture-language checked> ESL</label>
              <label class="tr-sign-opt"><input type="radio" name="gestureDatasetType" value="FSL" data-gesture-language> FSL</label>
            </div>
          </div>
          <div class="tr-cap-btns" style="margin-top:2px">
            <button id="startGestureDataBtn" data-gesture-start class="tr-cap-btn" type="button">Start Capture</button>
            <button id="stopGestureDataBtn" data-gesture-stop class="tr-cap-btn" type="button" disabled>Finish Capture</button>
          </div>
          <div class="tr-lm-card" id="gestureDataStatus" role="status" aria-live="polite" style="margin-top:2px">
            <div class="tr-lm-row">
              <span>Landmark frames</span>
              <span class="tr-lm-count" id="gestureDataFrameCount" data-gesture-frame-count>0 / 30</span>
            </div>
            <div class="tr-lm-bar"><div class="tr-lm-fill"></div></div>
            <div class="tr-lm-status" id="gestureDataStatusText" data-gesture-status-text>Ready to capture hand samples</div>
          </div>
        </div>

        <!-- DYNAMIC DATASET WRAPPER (Bagong UI element) -->
        <div class="tr-lm-card" style="margin-top:12px; max-height:280px; overflow-y:auto;">
          <div class="tr-lm-row" style="border-bottom:1.5px solid var(--border); padding-bottom:6px; margin-bottom:6px;">
            <span style="font-weight:800; color:var(--navy);">📁 Active Gesture Dataset</span>
            <span class="tr-lm-status" id="datasetCount">0 categories</span>
          </div>
          <div id="gestureDatasetTableWrap">
            <p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center; padding:10px;">Loading dataset...</p>
          </div>
        </div>

        <div id="trainDataControls"></div>
        <div class="tr-bottom-row">
          <button type="button" class="tr-ghost-btn" id="downloadBtn">Export Data</button>
          <button type="button" class="tr-ghost-btn" id="loadBtn">Load Saved</button>
        </div>
        <button type="button" class="tr-back-to-instr" onclick="showStepInstruction(1)">← Back to Instructions</button>
      </div>

      <!-- Step 2 -->
      <div id="leftStep2" class="tr-left-content" style="display:none">
        <div class="tr-section-lbl">Train Gesture</div>
        <!-- DYNAMIC SUMMARY CARD (Bago) -->
        <div class="tr-summary-card" id="step2SummaryCard">
          <p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center;">No training samples loaded yet.</p>
        </div>
        <div class="tr-fgrp">
          <div class="tr-epoch-row"><span>Training progress</span><span id="epochLabel">0 / 50 epochs</span></div>
          <div class="tr-epoch-bar"><div class="tr-epoch-fill" id="epochBar" style="width:0%"></div></div>
        </div>
        <div class="tr-train-log" id="trainLog">Ready to train. Press Train Gesture when samples are ready.</div>
        <button type="button" class="tr-train-btn" id="trainBtn" onclick="trainModel()">Train Gesture</button>
        <button type="button" class="tr-back-to-instr" onclick="showStepInstruction(2)" style="margin-top:auto">← Back to Instructions</button>
      </div>

      <!-- Step 3 -->
      <div id="leftStep3" class="tr-left-content" style="display:none">
        <div class="tr-section-lbl">Live Prediction</div>
        <div id="rightStep3">
          <div class="tr-pred-box">
            <div class="tr-pred-lbl">Prediction Result</div>
            <div class="tr-pred-result" id="livePredResult">—</div>
            <div class="tr-conf-bar"><div class="tr-conf-fill" id="confBar" style="width:0%"></div></div>
          </div>
        </div>
        <button type="button" class="tr-continue-btn" onclick="trGoToStep(4)">Continue to Translate →</button>
        <button type="button" class="tr-back-to-instr" onclick="showStepInstruction(3)" style="margin-top:auto">← Back to Instructions</button>
      </div>

      <!-- Step 4 -->
      <div id="leftStep4" class="tr-left-content" style="display:none">
        <div class="tr-section-lbl">Translation</div>
        <div class="tr-fgrp">
          <label class="tr-flbl">Output Language</label>
          <div class="tr-lang-toggle">
            <div class="tr-lang-chip active" id="langEn" role="button" onclick="setLang('en')">🇺🇸 English</div>
            <div class="tr-lang-chip" id="langFil" role="button" onclick="setLang('fil')">🇵🇭 Filipino</div>
          </div>
        </div>
        <div class="tr-word-card">
          <label class="tr-flbl">✏️ Custom Sign Words</label>
          <div class="tr-word-row">
            <input id="wordInput" type="text" class="tr-input" style="height:34px;" placeholder="e.g. Magandang umaga">
            <button type="button" class="tr-word-add" onclick="addCustomWord()">Add</button>
          </div>
          <div class="tr-word-chips" id="wordChips"></div>
        </div>
        <div class="tr-fgrp">
          <label class="tr-flbl">Detected Signs</label>
          <div class="tr-tl-hist" id="tlHistory"><span class="tl-empty">Wala pang na-detect na gestures...</span></div>
        </div>
        <div id="rightStep4"><div class="tr-tl-big" id="tlBigOutput"><span class="tl-big-empty">Show your start gesture to begin.</span></div></div>
        <div class="tr-voice-grid">
          <button type="button" class="tr-voice-btn primary" id="speakBtn" onclick="speakAll()">🔊 Speak All</button>
          <button type="button" class="tr-voice-btn" id="speakBigBtn" onclick="speakAll()">🔊 Speak</button>
          <button type="button" class="tr-voice-btn" onclick="clearTranslation()">🗑️ Clear</button>
          <button type="button" class="tr-voice-btn" onclick="copyTranslation()">📋 Copy</button>
        </div>
        <button type="button" class="tr-back-to-instr" onclick="showStepInstruction(4)" style="margin-top:auto">← Back to Instructions</button>
      </div>
    </div>
  </div>
</div>

<div id="sk-toast" role="status" aria-live="polite"></div>

<script src="js/gesture-training-ui.js"></script>
</body>
</html>
```

### B. `sign-to-text.html` [NEW]
Itong file na ito ay para lamang sa standalone Sign-to-Text translation page.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign to Text Translator ✿ Sining Kamay</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/sign-to-text.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.10.0/tf.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
  <script src="js/db-api.js"></script>
  <script src="js/gesture-data.js"></script>
  <script src="js/camera-helper.js"></script>
  <script src="js/speech-synthesis.js"></script>
  <script src="js/db-local.js"></script>
</head>
<body>

<div id="tl-page" class="active">
  <header class="tl-topbar">
    <a href="index.html" class="tl-back">Back</a>
    <div class="tl-topbar-title"><div class="tl-title-dot" id="tlDbStatusDot" title="Checking database..."></div>SIGN TO TEXT</div>
    <a href="index.html?screen=voice" class="tl-mode-btn">Translate Text</a>
  </header>

  <div class="tl-body">
    <div id="tl-state-cam">
      <div class="tl-cam-col">
        <div class="tl-camera-frame" id="tlCamFrame1">
          <video id="tlVideo1" autoplay playsinline muted></video>
          <div class="tl-cam-placeholder" id="tlPlaceholder1"><div class="tl-cam-dot"></div><p>Camera active</p></div>
          <div class="tl-live-badge"><div class="tl-live-dot"></div>LIVE</div>
          <div class="tl-pred-overlay" id="tlPredOverlay1">
            <div class="tl-pred-emoji" id="tlPredEmoji1">—</div>
            <div class="tl-pred-label" id="tlPredLabel1">Show your sign</div>
          </div>
        </div>
        <div class="tr-fgrp" style="margin: 4px 0;">
          <div class="tr-lang-toggle">
            <div class="tr-lang-chip active" id="tlLangEn1" onclick="tlSetLang('en')">🇺🇸 English</div>
            <div class="tr-lang-chip" id="tlLangFil1" onclick="tlSetLang('fil')">🇵🇭 Filipino</div>
          </div>
        </div>
        <button type="button" class="tl-translate-btn" id="tlTranslateBtn1" onclick="tlHandleTranslate()">TRANSLATE</button>
      </div>
    </div>

    <div id="tl-state-result">
      <div class="tl-cam-col">
        <div class="tl-camera-frame" id="tlCamFrame2">
          <video id="tlVideo2" autoplay playsinline muted></video>
          <div class="tl-cam-placeholder" id="tlPlaceholder2" style="display:none"><div class="tl-cam-dot"></div><p>Camera active</p></div>
          <div class="tl-live-badge"><div class="tl-live-dot"></div>LIVE</div>
          <div class="tl-pred-overlay" id="tlPredOverlay2">
            <div class="tl-pred-emoji" id="tlPredEmoji2">—</div>
            <div class="tl-pred-label" id="tlPredLabel2">Show your sign</div>
          </div>
        </div>
        <button type="button" class="tl-translate-btn" id="tlTranslateBtn2" onclick="tlHandleTranslate()">TRANSLATE</button>
      </div>
      <div class="tl-result-col">
        <div class="tl-output-label">TRANSLATION OUTPUT</div>
        <div class="tl-output-box" id="tlOutputBox"><span class="tl-out-empty">Translation will appear here…</span></div>
        <div class="tl-action-grid">
          <button type="button" class="tl-act-btn" id="tlSpeakBtn" onclick="tlSpeakAll()">Speak</button>
          <button type="button" class="tl-act-btn" onclick="tlCopyOutput()">Copy</button>
          <button type="button" class="tl-act-btn danger" onclick="tlClearOutput()">Clear</button>
          <button type="button" class="tl-act-btn" onclick="tlSaveLog()">Save Log</button>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="sk-toast" role="status" aria-live="polite"></div>

<script src="js/sign-to-text-ui.js"></script>
</body>
</html>
```

---

## 3. Mga Bagong CSS Stylesheets
Gumawa ng dalawang magkahiwalay na file sa loob ng `css/` folder.

- **`css/gesture-training.css`**: Ilagay ang reset codes at shared variables, at lahat ng CSS class selectors na ginagamit sa training dashboard (`#training-ui` at `.tr-*` styles).
- **`css/sign-to-text.css`**: Ilagay ang reset codes at shared variables, at lahat ng CSS class selectors na ginagamit sa standalone translator (`#tl-page` at `.tl-*` styles).
