# Sining Kamay: Train Gesture & Logical Functions Blueprint

Ang dokumentong ito ay naglalaman ng eksaktong JavaScript logic at XAMPP backend API updates na kailangan upang mapagana ang pagkuha ng camera gestures, pag-load ng database files, at ang model training sa hiwalay na UI files.

---

## 1. Shared Camera helper (`js/camera-helper.js`) [NEW]
Itong file na ito ang tanging hahawak sa webcam stream at pixels feature extraction.

```javascript
// js/camera-helper.js
const FEAT_W = 16;
const FEAT_H = 12;
const FEATURES = FEAT_W * FEAT_H;

async function initCameraWithFallback(idealWidth, idealHeight, successCallback, errorCallback) {
  if (!navigator.mediaDevices) {
    let msg = '⚠️ Ang camera API ay hindi magagamit. Siguraduhing naka-HTTPS o localhost ang URL!';
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      msg = '⚠️ Insecure context! Kailangan ng HTTPS o localhost para ma-access ang camera.';
    }
    console.error(msg);
    if (errorCallback) errorCallback(new Error('InsecureContext'), msg);
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    if (videoDevices.length === 0) {
      if (errorCallback) errorCallback(new Error('NotFoundError'), '⚠️ Walang webcam na nade-detect!');
      return;
    }

    let selectedDeviceId = null;
    const cleanDevices = videoDevices.filter(d => {
      const label = (d.label || "").toLowerCase();
      return !label.includes('metadata') && !label.includes('virtual') && !label.includes('control');
    });

    selectedDeviceId = cleanDevices.length > 0 ? cleanDevices[0].deviceId : videoDevices[0].deviceId;

    const constraints = {
      video: { width: { ideal: idealWidth }, height: { ideal: idealHeight } }
    };
    if (selectedDeviceId) constraints.video.deviceId = { exact: selectedDeviceId };

    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      if (successCallback) successCallback(s);
    } catch (err) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        if (successCallback) successCallback(s);
      } catch (fbErr) {
        if (errorCallback) errorCallback(fbErr, '⚠️ Hindi mabuksan ang camera. Pakisuri ang permissions.');
      }
    }
  } catch (err) {
    if (errorCallback) errorCallback(err, '⚠️ Error habang hinahanap ang camera: ' + err.message);
  }
}

function extractFeatures(vid) {
  vid = vid || document.getElementById('videoFeed');
  if (typeof window.extractLandmarkFeatures === 'function') {
    const lf = window.extractLandmarkFeatures();
    if (lf && lf.length) return lf;
  }
  const c = document.createElement('canvas');
  c.width = FEAT_W; c.height = FEAT_H;
  const ctx = c.getContext('2d');
  ctx.save(); ctx.scale(-1,1); ctx.drawImage(vid,-FEAT_W,0,FEAT_W,FEAT_H); ctx.restore();
  const d = ctx.getImageData(0,0,FEAT_W,FEAT_H).data;
  const f = [];
  for (let i=0;i<d.length;i+=4) f.push((d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)/255);
  return f;
}
```

---

## 2. Shared Speech synthesis (`js/speech-synthesis.js`) [NEW]

```javascript
// js/speech-synthesis.js
function speakWord(word, lang) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang === 'fil' ? 'fil-PH' : 'en-US';
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function speakUtterance(words, lang, onStart, onEnd) {
  if (!window.speechSynthesis || !words) return;
  const u = new SpeechSynthesisUtterance(words);
  u.lang = lang === 'fil' ? 'fil-PH' : 'en-US';
  u.rate = 0.85;
  if (typeof onStart === 'function') onStart();
  u.onend = () => { if (typeof onEnd === 'function') onEnd(); };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
```

---

## 3. UI logic para sa Training (`js/gesture-training-ui.js`) [NEW]
Hahawakan nito ang Step 1 hanggang Step 4, ang pangongolekta ng landmarks gamit ang `loadSavedGestureDataset()`, at ang neural network training sa browser gamit ang TensorFlow.js:

```javascript
// js/gesture-training-ui.js

let stream = null, modelTrained = false, tfModel = null;
let predictLoop = null;
let currentStep = 1;
const trainData = { start: [], stop: [] };
let startCount = 0, stopCount = 0;
let isRecordingStart = false, isRecordingStop = false, recordInterval = null;
let translatedWords = [], wordIndex = 0, currentGesture = null, signLang = 'en';
const GESTURE_HOLD_MS = 700;
let customWords = [];
let lastDetected = null, holdStart = null;
let predictionHistory = [];
let savedGestureSamplesMerged = false;
let activeFeatureSize = 192;
let activeLabels = ['start', 'stop'];
const EPOCHS = 50;

const DEFAULT_WORDS_EN  = ['Hello','Thank you','Yes','No','Please','Help','Water','Food','Good','Stop','I love you','Wait','Come here','Good morning','Goodbye'];
const DEFAULT_WORDS_FIL = ['Kumusta','Salamat','Oo','Hindi','Pakiusap','Tulong','Tubig','Pagkain','Mabuti','Hinto','Mahal kita','Sandali','Halika','Magandang umaga','Paalam'];

// DOM references
const videoFeed      = document.getElementById('videoFeed');
const cameraFrame    = document.getElementById('cameraFrame');
const camPlaceholder = document.getElementById('cameraPlaceholder');
const camBadge       = document.getElementById('camBadge');
const enableCamBtn   = document.getElementById('enableCamBtn');

function showToast(message, duration = 3000) {
  const toast = document.getElementById('sk-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(window.skToastTimeout);
  window.skToastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}
window.showToast = showToast;

// ── DYNAMIC SUMMARY CARD DRAWING (STEP 2) ──
function updateUI() {
  const card = document.getElementById('step2SummaryCard');
  if (!card) return;
  const labels = Object.keys(trainData);
  if (labels.length === 0) {
    card.innerHTML = '<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center;">No training samples loaded yet.</p>';
    return;
  }
  card.innerHTML = labels.map(label => {
    const count = trainData[label] ? trainData[label].length : 0;
    return `
      <div class="tr-summary-row" style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; margin-bottom:6px;">
        <span>${label.replace(/_/g, ' ').toUpperCase()} samples</span>
        <span class="tr-summary-val" style="color:var(--navy); font-weight:900;">${count} samples</span>
      </div>
    `;
  }).join('');
}

// ── DATASET DISPLAY IN STEP 1 (Table with Delete buttons) ──
async function renderSavedDataset() {
  const tableWrap = document.getElementById('gestureDatasetTableWrap');
  const datasetCount = document.getElementById('datasetCount');
  if (!tableWrap) return;
  try {
    const gestures = await GestureDataRecorder.loadSavedGestureDataset();
    const labels = Object.keys(gestures);
    datasetCount.textContent = `${labels.length} categories`;
    if (labels.length === 0) {
      tableWrap.innerHTML = '<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center; padding:10px;">No saved gestures found.</p>';
      return;
    }
    let html = '<table style="width:100%; border-collapse:collapse; font-size:11px; color:var(--text);">';
    html += '<tr style="background:var(--navy); color:#fff; font-weight:bold;">';
    html += '<th style="padding:6px 4px; text-align:left;">Label</th>';
    html += '<th style="padding:6px 4px; text-align:center;">Sign Set</th>';
    html += '<th style="padding:6px 4px; text-align:center;">Samples</th>';
    html += '<th style="padding:6px 4px; text-align:center;">Action</th>';
    html += '</tr>';
    labels.forEach(label => {
      const samples = gestures[label];
      const signSet = samples[0]?.signLanguage || 'ESL';
      html += `<tr style="border-bottom:1px solid var(--border);">`;
      html += `<td style="padding:6px 5px; font-weight:700;">${label}</td>`;
      html += `<td style="padding:6px 5px; text-align:center;">${signSet}</td>`;
      html += `<td style="padding:6px 5px; text-align:center;">${samples.length}</td>`;
      html += `<td style="padding:6px 5px; text-align:center;"><button type="button" onclick="deleteGesture('${label}')" style="background:#ef4444; color:#fff; border:none; border-radius:6px; padding:3px 8px; font-size:10px; font-weight:700; cursor:pointer;">Delete</button></td>`;
      html += `</tr>`;
    });
    html += '</table>';
    tableWrap.innerHTML = html;
  } catch(err) {
    tableWrap.innerHTML = `<p style="font-size:11px; color:#ef4444; text-align:center; padding:10px;">Error loading dataset: ${err.message}</p>`;
  }
}

// ── FRONTEND DELETE ACTION ──
async function deleteGesture(label) {
  if (!confirm(`Sigurado ka bang nais mong burahin ang lahat ng data para sa "${label}"?`)) return;
  try {
    const SAVE_ENDPOINT = (location.protocol === "file:" || (location.port && location.port !== "80" && location.port !== "443"))
      ? "http://localhost/Sining_kamay/php/api/save_gesture.php"
      : "php/api/save_gesture.php";
    const res = await fetch(SAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_gesture", label })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`🗑️ Deleted gesture "${label}"`);
      delete trainData[label];
      renderSavedDataset();
      updateUI();
    } else {
      alert("Failed to delete gesture: " + json.error);
    }
  } catch(err) {
    alert("Delete failed: " + err.message);
  }
}
window.deleteGesture = deleteGesture;

// (Kopyahin din ang sumusunod na core functions mula sa camera-translator.html at idikit dito:
// trainModel, jitterFeatures, mergeSavedGestureSamples, startLivePrediction, stopLivePrediction,
// setLang, tlSetLang, addCustomWord, removeCustomWord, renderWordChips, renderTranslation,
// speakAll, clearTranslation, copyTranslation, downloadTranslation, updateTrPills,
// showStepInstruction, showStepContent, trGoToStep, trClickPill).

// Startup triggers:
window.onload = () => {
  renderSavedDataset();
  updateUI();
};
```

---

## 4. UI logic para sa Translation (`js/sign-to-text-ui.js`) [NEW]
Logic na tatakbo sa translator screen para sa real-time predictions:

```javascript
// js/sign-to-text-ui.js
let tlUiState='idle',tlWords=[],tlWordIndex=0;
let tlCurrentGesture=null,tlLastDetected=null,tlHoldStart=null;
let tlPredHistory=[],tlPredLoop=null,tlStream=null,tlModelReady=false;

// (Kopyahin ang mga sumusunod na functions mula sa camera-translator.html:
// tlInitCamera, tlUpdateOverlays, tlStartPredLoop, tlStopPredLoop, tlRenderOutput,
// tlSetState, tlHandleTranslate, tlSpeakAll, tlCopyOutput, tlClearOutput, tlSaveLog).
```

---

## 5. Backend MySQL & File deletion (`php/api/save_gesture.php`)
**Aksyon:** Idagdag ang action route para sa pagbura sa database at files sa disk:

```php
// Ilagay ito sa loob ng POST handler ng save_gesture.php:
if (isset($body['action']) && $body['action'] === 'delete_gesture') {
    $label = clean_label($body['label'] ?? '');
    if ($label === '') fail('Label is required');

    // 1. Burahin ang samples folder sa disk
    $labelDir = $datasetRoot . DIRECTORY_SEPARATOR . $label;
    if (is_dir($labelDir)) {
        foreach (glob($labelDir . '/*.json') ?: [] as $file) {
            unlink($file);
        }
        rmdir($labelDir);
    }

    // 2. Burahin ang database entries sa MySQL
    require_once __DIR__ . '/../connect.php';
    
    $stmt = mysqli_prepare($conn, "SELECT id FROM gestures WHERE word = ? LIMIT 1");
    mysqli_stmt_bind_param($stmt, 's', $label);
    mysqli_stmt_execute($stmt);
    $res = mysqli_stmt_get_result($stmt);
    $row = mysqli_fetch_assoc($res);
    $gestureId = $row ? (int)$row['id'] : 0;
    mysqli_stmt_close($stmt);

    if ($gestureId > 0) {
        mysqli_query($conn, "DELETE FROM gesture_recordings WHERE gesture_id = $gestureId");
        mysqli_query($conn, "DELETE FROM gestures WHERE id = $gestureId");
    }
    
    mysqli_query($conn, "DELETE FROM esl_signs WHERE sign_key = '" . mysqli_real_escape_string($conn, $label) . "'");
    mysqli_query($conn, "DELETE FROM fsl_signs WHERE sign_key = '" . mysqli_real_escape_string($conn, $label) . "'");

    mysqli_close($conn);
    echo json_encode(['success' => true, 'message' => "Gesture '$label' successfully deleted."]);
    exit;
}
```
