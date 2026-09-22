// js/gesture-training-ui.js

let stream = null, modelTrained = false, tfModel = null, knnModel = {};
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
let activeFeatureSize = 126;
let activeLabels = ['start', 'stop'];
const EPOCHS = 50;

let currentSentence = [];       // Dito iipunin ang mga nade-detect na salita
let isSentenceActive = false;    // Tracker kung nasa loob ng start/stop block

// ── PIN Password Logic ──
const CORRECT_PIN = '2026';
let pinInput = '';

function trPressPin(digit) {
  if (pinInput.length >= 4) return;
  pinInput += digit;
  updatePinDots();
  if (pinInput.length === 4) {
    setTimeout(trVerifyPin, 120);
  }
}

function trDeletePin() {
  pinInput = pinInput.slice(0, -1);
  updatePinDots();
}

function trClearPin() {
  pinInput = '';
  updatePinDots();
}

function updatePinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i < pinInput.length);
  });
}

function trVerifyPin() {
  if (pinInput === CORRECT_PIN) {
    const pinScreen = document.getElementById('pin-screen');
    const trainingUI = document.getElementById('training-ui');
    pinScreen.classList.remove('active');
    trainingUI.classList.add('active');
    pinInput = '';
    updatePinDots();
  } else {
    const card = document.querySelector('.pin-card');
    card.classList.add('shake');
    showToast('❌ Incorrect PIN. Try again.');
    setTimeout(() => {
      card.classList.remove('shake');
      pinInput = '';
      updatePinDots();
    }, 450);
  }
}

// ── Step Content Layout Class Switcher ──
function applyStepLayoutClass(step) {
  const wrap = document.getElementById('trContentWrap');
  if (!wrap) return;
  wrap.classList.remove('step-1-active', 'step-2-active', 'step-3-active', 'step-4-active');
  wrap.classList.add(`step-${step}-active`);

  // Show/hide floating Step 3 nav and prediction card
  const step3Nav = document.getElementById('trStep3Nav');
  const step3Pred = document.getElementById('trStep3Pred');
  if (step3Nav) step3Nav.style.display = step === 3 ? 'flex' : 'none';
  if (step3Pred) step3Pred.style.display = step === 3 ? 'block' : 'none';
}

// ── Dataset Modal Logic ──
function trOpenDatasetModal() {
  // Clone current table contents into the modal body
  const tableWrap = document.getElementById('gestureDatasetTableWrap');
  const modalBody = document.getElementById('datasetModalBody');
  if (tableWrap && modalBody) {
    modalBody.innerHTML = tableWrap.innerHTML || '<p style="color:#94a3b8;text-align:center;padding:16px;">No gestures recorded yet.</p>';
  }
  document.getElementById('datasetModal').classList.add('show');
}

function trCloseDatasetModal() {
  document.getElementById('datasetModal').classList.remove('show');
}


const DEFAULT_WORDS_EN  = ['Hello','Thank you','Yes','No','Please','Help','Water','Food','Good','Stop','I love you','Wait','Come here','Good morning','Goodbye'];
const DEFAULT_WORDS_FIL = ['Kumusta','Salamat','Oo','Hindi','Pakiusap','Tulong','Tubig','Pagkain','Mabuti','Hinto','Mahal kita','Sandali','Halika','Magandang umaga','Paalam'];

const SIGN_TRANSLATIONS = {
  "hello": { en: "Hello", fil: "Kumusta", emoji: "👋" },
  "thank_you": { en: "Thank you", fil: "Salamat", emoji: "🙏" },
  "salamat": { en: "Thank you", fil: "Salamat", emoji: "🙏" },
  "yes": { en: "Yes", fil: "Oo", emoji: "👍" },
  "oo": { en: "Yes", fil: "Oo", emoji: "👍" },
  "no": { en: "No", fil: "Hindi", emoji: "👎" },
  "hindi": { en: "No", fil: "Hindi", emoji: "👎" },
  "please": { en: "Please", fil: "Pakiusap", emoji: "🥺" },
  "pakiusap": { en: "Please", fil: "Pakiusap", emoji: "🥺" },
  "help": { en: "Help", fil: "Tulong", emoji: "🆘" },
  "tulong": { en: "Help", fil: "Tulong", emoji: "🆘" },
  "water": { en: "Water", fil: "Tubig", emoji: "💧" },
  "tubig": { en: "Water", fil: "Tubig", emoji: "💧" },
  "food": { en: "Food", fil: "Pagkain", emoji: "🍞" },
  "pagkain": { en: "Food", fil: "Pagkain", emoji: "🍞" },
  "good": { en: "Good", fil: "Mabuti", emoji: "✨" },
  "mabuti": { en: "Good", fil: "Mabuti", emoji: "✨" },
  "stop": { en: "Stop", fil: "Hinto", emoji: "🛑" },
  "hinto": { en: "Stop", fil: "Hinto", emoji: "🛑" },
  "love": { en: "I love you", fil: "Mahal kita", emoji: "🤟" },
  "mahal_kita": { en: "I love you", fil: "Mahal kita", emoji: "🤟" },
  "wait": { en: "Wait", fil: "Sandali", emoji: "⏳" },
  "sandali": { en: "Wait", fil: "Sandali", emoji: "⏳" },
  "come_here": { en: "Come here", fil: "Halika", emoji: "👈" },
  "halika": { en: "Come here", fil: "Halika", emoji: "👈" },
  "good_morning": { en: "Good morning", fil: "Magandang umaga", emoji: "🌅" },
  "magandang_umaga": { en: "Good morning", fil: "Magandang umaga", emoji: "🌅" },
  "goodbye": { en: "Goodbye", fil: "Paalam", emoji: "👋" },
  "paalam": { en: "Goodbye", fil: "Paalam", emoji: "👋" }
};

function translateGestureLabel(label, lang) {
  const clean = String(label || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (SIGN_TRANSLATIONS[clean]) {
    return SIGN_TRANSLATIONS[clean][lang === 'fil' ? 'fil' : 'en'];
  }
  const base = clean.replace(/_(fsl|esl)$/, "");
  if (SIGN_TRANSLATIONS[base]) {
    return SIGN_TRANSLATIONS[base][lang === 'fil' ? 'fil' : 'en'];
  }
  return base.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getTranslatedWordText(w, lang) {
  if (w.type === 'stop') return '⏸';
  if (w.type === 'custom') return translateGestureLabel(w.label, lang);
  return w.word || w.label;
}

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

// ── DYNAMIC SUMMARY CARD DRAWING (STEP 2) — shows all gestures + NEW badge ──
function updateUI() {
  const card = document.getElementById('step2SummaryCard');
  if (!card) return;
  const labels = Object.keys(trainData);
  if (labels.length === 0) {
    card.innerHTML = '<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center;">No training samples loaded yet.</p>';
    return;
  }

  // Detect NEW gestures not yet compiled into the KNN model
  const langRadio = document.querySelector('input[name="gestureDatasetType"]:checked');
  const targetLang = (langRadio ? langRadio.value : 'ESL').toUpperCase();
  let trainedLabels = [];
  try {
    const stored = localStorage.getItem(`sining_kamay_trained_labels_${targetLang}`);
    if (stored) trainedLabels = JSON.parse(stored);
  } catch(e) {}

  card.innerHTML = labels.map(label => {
    const count = trainData[label] ? trainData[label].length : 0;
    const isNew = trainedLabels.length > 0 && !trainedLabels.includes(label);
    return `
      <div class="tr-summary-row" style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; margin-bottom:6px;">
        <span style="display:flex;align-items:center;gap:4px;">${label.replace(/_/g, ' ').toUpperCase()}${isNew ? ' <span style="background:#f97316;color:#fff;font-size:9px;padding:1px 6px;border-radius:4px;font-weight:900;letter-spacing:.5px;vertical-align:middle;">NEW</span>' : ''}</span>
        <span class="tr-summary-val" style="color:var(--navy); font-weight:900;">${count} frames</span>
      </div>
    `;
  }).join('');
}

// ── Step 1: per-word sample tally ──
// Soft, never-blocking recording target. knnPredict scores a label by the mean of its top-5 cosine
// similarities over ALL its frames (knnPredict below), so 5 takes is the smallest count at which
// each of those 5 neighbours can come from a different take. A suggestion, not a gate.
const SAMPLE_TARGET = 5;
const savedSampleInfo = { ESL: {}, FSL: {} };   // sign set -> label -> { samples, frames }
let justSavedNote = '';

function selectedSignSet() {
  const r = document.querySelector('input[name="gestureDatasetType"]:checked');
  return r && r.value.toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
}
function currentLabelClean() {
  const el = document.getElementById('gestureLabelInput');
  return el ? GestureDataRecorder.cleanLabel(el.value) : '';
}
function sampleInfoFor(label, set) {
  return (label && savedSampleInfo[set][label]) || { samples: 0, frames: 0 };
}
function rebuildSampleInfo(gestures) {
  savedSampleInfo.ESL = {}; savedSampleInfo.FSL = {};
  Object.keys(gestures).forEach(label => gestures[label].forEach(s => {
    const set = String(s.signLanguage || 'ESL').toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
    const e = savedSampleInfo[set][label] || (savedSampleInfo[set][label] = { samples: 0, frames: 0 });
    e.samples += 1; e.frames += s.frameCount || 0;
  }));
}
function noteSampleSaved(res) {
  const set = String(res.signLanguage || 'ESL').toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
  const e = savedSampleInfo[set][res.label] || (savedSampleInfo[set][res.label] = { samples: 0, frames: 0 });
  e.samples = res.labelSampleCount || e.samples + 1;   // server count is authoritative
  e.frames += res.frameCount || 0;                     // exact again after the next dataset reload
  justSavedNote = 'Saved. Run Train AI (Step 2) again to use it.';
}
function refreshSampleCountLine() {
  const line = document.getElementById('sampleCountLine');
  const startBtn = document.getElementById('startGestureDataBtn');
  if (!line) return;
  const label = currentLabelClean();
  const { samples, frames } = sampleInfoFor(label, selectedSignSet());
  if (startBtn) startBtn.textContent = samples > 0 ? 'Record another sample' : 'Start Capture';
  line.classList.toggle('done', samples >= SAMPLE_TARGET);
  if (!label) { line.textContent = ''; return; }
  let text;
  if (samples === 0) text = `“${label}” is a new word — no samples yet. Aim for ${SAMPLE_TARGET}.`;
  else if (samples < SAMPLE_TARGET) text = `“${label}” — ${samples} sample${samples === 1 ? '' : 's'} saved (${frames} frames). Record another — aim for ${SAMPLE_TARGET}.`;
  else text = `“${label}” — ${samples} samples saved (${frames} frames). ✓ Target reached; more are optional.`;
  line.textContent = justSavedNote ? `${text} ${justSavedNote}` : text;
}

// ── DATASET DISPLAY IN STEP 1 (Table with Delete buttons) ──
async function renderSavedDataset(prefetchedGestures) {
  const tableWrap = document.getElementById('gestureDatasetTableWrap');
  const datasetCount = document.getElementById('datasetCount');
  if (!tableWrap) return;
  try {
    const gestures = prefetchedGestures || await GestureDataRecorder.loadSavedGestureDataset();
    rebuildSampleInfo(gestures); refreshSampleCountLine();
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
    const SAVE_ENDPOINT = (location.protocol === "file:")
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
      delete savedSampleInfo.ESL[label]; delete savedSampleInfo.FSL[label]; refreshSampleCountLine();
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

function jitterFeatures(features,amount=0.015){return features.map(v=>v+((Math.random()*2-1)*amount))}

// ── KNN Classifier Helpers (Instant, No Epoch Training Needed) ──
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function knnPredict(features) {
  if (!knnModel || Object.keys(knnModel).length === 0) return null;
  
  // Mirror X coordinates for mirror-invariant matching
  const mirroredFeatures = [...features];
  for (let i = 0; i < mirroredFeatures.length; i += 3) {
    mirroredFeatures[i] = -mirroredFeatures[i];
  }
  if (mirroredFeatures.length === 126) {
    const hand1 = mirroredFeatures.slice(0, 63);
    const hand2 = mirroredFeatures.slice(63, 126);
    const h1HasData = hand1.some(v => v !== 0);
    const h2HasData = hand2.some(v => v !== 0);
    if (h1HasData && h2HasData) {
      mirroredFeatures.splice(0, 63, ...hand2);
      mirroredFeatures.splice(63, 63, ...hand1);
    }
  }

  const rawScores = {};
  for (const label of Object.keys(knnModel)) {
    const frames = knnModel[label];
    if (!frames || frames.length === 0) { rawScores[label] = 0; continue; }
    // Top-K cosine similarity: find best matching frames for each gesture
    const sims = frames.map(frame => Math.max(
      cosineSimilarity(features, frame),
      cosineSimilarity(mirroredFeatures, frame)
    ));
    sims.sort((a, b) => b - a);
    const topK = sims.slice(0, Math.min(5, sims.length));
    rawScores[label] = topK.reduce((sum, s) => sum + s, 0) / topK.length;
  }
  const entries = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const [bestLabel] = entries[0];
  // Normalize: map cosine range 0.3–1.0 → 0–1 confidence
  const normalized = {};
  for (const [l, s] of entries) {
    normalized[l] = Math.max(0, Math.min(1, (s - 0.3) / 0.7));
  }
  return { label: bestLabel, confidence: normalized[bestLabel], scores: normalized };
}

function loadKnnFromCache(targetLang) {
  try {
    const knnData   = localStorage.getItem(`sining_kamay_knn_${targetLang}`);
    const labelsData = localStorage.getItem(`sining_kamay_labels_${targetLang}`);
    if (knnData && labelsData) {
      const parsedKnn = JSON.parse(knnData);
      const parsedLabels = JSON.parse(labelsData);
      const size = (Object.values(parsedKnn)[0]?.[0]?.length) || 126;
      
      // If we support landmarks (126), but the cached model has raw pixel size or single-hand size, discard it
      if (typeof window.extractLandmarkFeatures === 'function' && size !== 126) {
        console.warn(`[KNN] Cached model has feature size ${size} but landmarks (126) are supported. Discarding cached model to force landmark training.`);
        localStorage.removeItem(`sining_kamay_knn_${targetLang}`);
        localStorage.removeItem(`sining_kamay_labels_${targetLang}`);
        localStorage.removeItem(`sining_kamay_trained_labels_${targetLang}`);
        return false;
      }
      
      knnModel = parsedKnn;
      activeLabels = parsedLabels;
      activeFeatureSize = size;
      modelTrained = true;
      return true;
    }
  } catch(e) {
    console.warn('[KNN] Failed to load cached model:', e);
  }
  return false;
}

let lastLoadedLanguage = null;

async function mergeSavedGestureSamples(prefetchedGestures) {
  const langRadio = document.querySelector('input[name="gestureDatasetType"]:checked');
  const targetLang = (langRadio ? langRadio.value : 'ESL').toUpperCase();

  if (!prefetchedGestures && savedGestureSamplesMerged && lastLoadedLanguage === targetLang) return;
  if (!prefetchedGestures && typeof window.loadGestureDatasetForTraining !== 'function') return;
  try {
    const rows = prefetchedGestures
      ? window.GestureDataRecorder.recordingsToTrainingRows(prefetchedGestures)
      : await window.loadGestureDatasetForTraining();
    // Reset trainData so we don't duplicate on reload
    for (const key in trainData) {
      if (key !== 'start' && key !== 'stop') delete trainData[key];
    }
    trainData.start = [];
    trainData.stop = [];

    let loadedCount = 0;
    rows.forEach(({label,features,signLanguage}) => {
      const itemLang = (signLanguage || 'ESL').toUpperCase();
      if (itemLang === targetLang) {
        if (!trainData[label]) trainData[label] = [];
        trainData[label].push(features);
        loadedCount++;
      }
    });
    // Sync cached labels with database on load to avoid phantom gestures
    try {
      const cachedLabelsRaw = localStorage.getItem(`sining_kamay_labels_${targetLang}`);
      if (cachedLabelsRaw) {
        const cachedLabels = JSON.parse(cachedLabelsRaw);
        // Find if any cached label is completely missing from current trainData
        const validCached = cachedLabels.filter(label => trainData[label] && trainData[label].length > 0);
        if (validCached.length !== cachedLabels.length) {
          const cachedKnnRaw = localStorage.getItem(`sining_kamay_knn_${targetLang}`);
          if (cachedKnnRaw) {
            const cachedKnn = JSON.parse(cachedKnnRaw);
            for (const label of Object.keys(cachedKnn)) {
              if (!trainData[label] || trainData[label].length === 0) {
                delete cachedKnn[label];
              }
            }
            try {
              localStorage.setItem(`sining_kamay_knn_${targetLang}`,            JSON.stringify(cachedKnn));
              localStorage.setItem(`sining_kamay_labels_${targetLang}`,         JSON.stringify(validCached));
              localStorage.setItem(`sining_kamay_trained_labels_${targetLang}`, JSON.stringify(validCached));
            } catch (e) {
              console.warn("[KNN] LocalStorage quota exceeded in training-ui:", e);
            }
            
            // Update active variables if currently active
            knnModel = cachedKnn;
            activeLabels = validCached;
          }
        }
      }
    } catch (e) {
      console.warn('[KNN] Failed to sync cache on merge:', e);
    }

    if (loadedCount) showToast(`Loaded ${loadedCount} saved landmark frames for ${targetLang}`);
    savedGestureSamplesMerged = true;
    lastLoadedLanguage = targetLang;
  } catch(err){
    console.warn('Saved gesture dataset unavailable:',err);
  }
}

async function trainModel() {
  const btn = document.getElementById('trainBtn');
  const log = document.getElementById('trainLog');
  const epochBar = document.getElementById('epochBar');
  const epochLabel = document.getElementById('epochLabel');

  const langRadio = document.querySelector('input[name="gestureDatasetType"]:checked');
  const targetLang = (langRadio ? langRadio.value : 'ESL').toUpperCase();

  // Always reload the latest dataset to detect newly added gestures
  savedGestureSamplesMerged = false;
  await mergeSavedGestureSamples();

  btn.disabled = true; btn.textContent = 'Compiling…';
  log.innerHTML = '<span class="log-warn">Checking gesture model...</span>\n';
  const addLog = (msg, cls='') => { log.innerHTML += `<span class="${cls}">${msg}</span>\n`; log.scrollTop = log.scrollHeight; };

  // Determine feature size and all available labels
  const firstRow = Object.values(trainData).flat().find(f => Array.isArray(f) && f.length);
  activeFeatureSize = firstRow ? firstRow.length : 126;
  activeLabels = Object.keys(trainData).filter(label =>
    trainData[label] && trainData[label].some(f => Array.isArray(f) && f.length === activeFeatureSize)
  );

  if (activeLabels.length < 2) {
    const msg = `Add at least 2 gesture labels before training. (Loaded ${activeLabels.length} labels)`;
    console.error(msg, 'activeLabels =', activeLabels, 'trainData =', trainData);
    showToast(msg, 5000);
    btn.disabled = false; btn.textContent = 'Train Gesture';
    return;
  }

  // ── INCREMENTAL UPDATE: Load existing compiled model from cache ──
  let trainedLabels = [];
  try {
    const existingKnn    = localStorage.getItem(`sining_kamay_knn_${targetLang}`);
    const existingLabels = localStorage.getItem(`sining_kamay_labels_${targetLang}`);
    if (existingKnn && existingLabels) {
      knnModel      = JSON.parse(existingKnn);
      trainedLabels = JSON.parse(existingLabels);
      
      // Filter out any cached labels that no longer exist in the database (were deleted)
      let cacheChanged = false;
      for (const label of Object.keys(knnModel)) {
        if (!trainData[label] || trainData[label].length === 0) {
          delete knnModel[label];
          cacheChanged = true;
        }
      }
      
      if (cacheChanged) {
        trainedLabels = Object.keys(knnModel);
        activeLabels = trainedLabels;
        try {
          localStorage.setItem(`sining_kamay_knn_${targetLang}`,            JSON.stringify(knnModel));
          localStorage.setItem(`sining_kamay_labels_${targetLang}`,         JSON.stringify(activeLabels));
          localStorage.setItem(`sining_kamay_trained_labels_${targetLang}`, JSON.stringify(activeLabels));
        } catch (e) {
          console.warn("[KNN] LocalStorage quota exceeded in training-ui:", e);
        }
        addLog(`// Cache synced with DB: removed deleted phantom gestures`);
      }
      
      addLog(`// Existing model found: ${trainedLabels.length} gestures already compiled`);
    }
  } catch(e) {
    knnModel      = {};
    trainedLabels = [];
  }

  // Detect gestures not yet in the compiled model
  const newLabels = activeLabels.filter(l => !trainedLabels.includes(l));

  if (newLabels.length === 0 && Object.keys(knnModel).length >= 2) {
    // ── Nothing new to add — model is already up to date ──
    addLog(`// ✅ All ${activeLabels.length} gestures already compiled. Nothing to update!`, 'log-ok');
    addLog(`// Gestures: ${activeLabels.join(', ')}`, 'log-ok');

    // Quick progress bar sweep for UX
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, 12));
      epochBar.style.width = Math.round((i / steps) * 100) + '%';
    }
    epochLabel.textContent = `Up to date — ${activeLabels.length} gestures ready`;
    modelTrained = true;
    addLog('Model is up to date. No retraining needed.', 'log-ok');
    btn.textContent = 'Compiled ✓ (Recompile)'; btn.disabled = false;
    const nextBtnA = document.getElementById('step2NextBtn');
    if (nextBtnA) nextBtnA.style.display = 'block';
    updateTrPills(currentStep);
    showToast(`✅ Already up to date! (${activeLabels.length} gestures)`);
    return;
  }

  // ── Add ONLY new gesture(s) to the existing model ──
  let newFrames = 0;
  addLog(`// Adding ${newLabels.length} new gesture(s): ${newLabels.join(', ')}`);
  newLabels.forEach(label => {
    knnModel[label] = trainData[label].filter(f => Array.isArray(f) && f.length === activeFeatureSize);
    newFrames += knnModel[label].length;
  });

  if (trainedLabels.length > 0) {
    addLog(`// Old gestures retained as-is: ${trainedLabels.join(', ')}`, 'log-ok');
  }
  addLog(`// New frames added: ${newFrames} (${newLabels.join(', ')})`);

  // Animate progress bar
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await new Promise(r => setTimeout(r, 18));
    const pct = Math.round((i / steps) * 100);
    epochBar.style.width = pct + '%';
    epochLabel.textContent = `Compiling gestures... ${pct}%`;
  }
  epochLabel.textContent = `Complete! — ${activeLabels.length} gestures ready`;

  // Update active labels to include both old + new
  activeLabels = Object.keys(knnModel);

  // Persist updated KNN model to localStorage
  try {
    localStorage.setItem(`sining_kamay_knn_${targetLang}`,            JSON.stringify(knnModel));
    localStorage.setItem(`sining_kamay_labels_${targetLang}`,         JSON.stringify(activeLabels));
    localStorage.setItem(`sining_kamay_trained_labels_${targetLang}`, JSON.stringify(activeLabels));
    addLog(`// Model updated in cache (${targetLang}) — now has ${activeLabels.length} gestures`, 'log-ok');
  } catch (err) {
    console.warn('[KNN] Failed to cache model:', err);
    addLog('// Warning: could not cache model', 'log-warn');
  }

  modelTrained = true;
  addLog('Gesture model updated. Click Next to test your signs.', 'log-ok');
  btn.textContent = 'Compiled ✓ (Recompile)'; btn.disabled = false;
  const nextBtn = document.getElementById('step2NextBtn');
  if (nextBtn) nextBtn.style.display = 'block';
  updateTrPills(currentStep);
  updateUI(); // refresh summary card to clear NEW badges
  showToast(`🎉 ${newLabels.length} new gesture(s) added! Click Next →`);
}

function averageScores(history) {

  const totals=Array(history[0].length).fill(0);
  history.forEach(s=>s.forEach((v,i)=>totals[i]+=v));
  return totals.map(t=>t/history.length);
}

function startLivePrediction(forTranslation=false) {
  console.log("startLivePrediction triggered: stream =", !!stream, "modelTrained =", modelTrained);
  if (!modelTrained||!stream) {
    showToast("⚠️ Prediction skipped: Model or camera stream not ready.");
    return;
  }
  clearInterval(predictLoop);
  predictionHistory=[];
  document.getElementById('predictOverlay').classList.add('show');
  if (forTranslation) cameraFrame.classList.add('predicting');

  let trLastHandTime = Date.now();
  predictLoop=setInterval(async()=>{
    if(!stream||!modelTrained){
      console.warn("Live prediction loop skipped: stream =", !!stream, "modelTrained =", modelTrained);
      return;
    }
    try {
      const dbg = document.getElementById('predictDebugConsole');
      const hasHand = window.GestureDataRecorder && typeof window.GestureDataRecorder.getLatestLandmarks === 'function' && window.GestureDataRecorder.getLatestLandmarks();
      if (dbg) {
        dbg.innerHTML = `• activeLabels: ${JSON.stringify(activeLabels)}\n` +
                        `• knnModel keys: ${JSON.stringify(Object.keys(knnModel))}\n` +
                        `• activeFeatureSize: ${activeFeatureSize}\n` +
                        `• hasHand: ${!!hasHand}\n` +
                        `• Time: ${new Date().toLocaleTimeString()}`;
      }
      if (!hasHand) {
        if (Date.now() - trLastHandTime > 1000) {
          document.getElementById('predEmoji').textContent = '—';
          document.getElementById('predLabel').textContent = 'Show your sign';
          document.getElementById('predConf').textContent = 'Recognition confidence';
          document.getElementById('predFillMini').style.width = '0%';
          if (currentStep === 3) {
            const res = document.getElementById('livePredResult');
            if (res) res.textContent = '—';
            const bar = document.getElementById('confBar');
            if (bar) bar.style.width = '0%';
            
            const resAlt = document.getElementById('livePredResultAlt');
            if (resAlt) resAlt.textContent = '—';
            const barAlt = document.getElementById('confBarAlt');
            if (barAlt) barAlt.style.width = '0%';
          }
          const dots = document.querySelectorAll('.status-dot');
          const indTexts = document.querySelectorAll('.indicator-text');
          dots.forEach(dot => { dot.className = 'status-dot searching'; });
          indTexts.forEach(indText => { indText.textContent = 'Searching...'; });
        }
        return;
      }
      trLastHandTime = Date.now();
      const f=extractFeatures();
      if (dbg) {
        dbg.innerHTML += `\n• extracted features: ${f ? f.length : 0}`;
      }
      if(!Array.isArray(f)||f.length!==activeFeatureSize){
        console.warn("Live prediction loop skipped: feature size mismatch. f.length =", f ? f.length : 0, "activeFeatureSize =", activeFeatureSize);
        if (dbg) {
          dbg.innerHTML += `\n• Warning: Size mismatch! Expected ${activeFeatureSize}`;
        }
        return;
      }
      // KNN instant prediction (no tensor computation needed)
      const knnResult = knnPredict(f);
      if (dbg) {
        dbg.innerHTML += `\n• knnResult: ${knnResult ? JSON.stringify(knnResult) : 'null'}`;
      }
      if (!knnResult) return;
      // Build score array indexed by label position for smoothing compatibility
      const raw = activeLabels.map(l => knnResult.scores[l] !== undefined ? knnResult.scores[l] : 0);
      predictionHistory.push(raw);
      if(predictionHistory.length>6)predictionHistory.shift();
      const scores=predictionHistory.length>=3?averageScores(predictionHistory):raw;
      const bi=scores.indexOf(Math.max(...scores));
      const conf=scores[bi];
            const detected=activeLabels[bi]||'unknown';
      const confPct=Math.round(conf*100);
      document.getElementById('predEmoji').textContent=detected==='start'?'▶':detected==='stop'?'⏹':'?';
      document.getElementById('predLabel').textContent=detected==='start'?'Start Gesture':detected==='stop'?'Stop Gesture':detected.replace(/_/g,' ');
      document.getElementById('predConf').textContent=`Confidence: ${confPct}%`;
      document.getElementById('predFillMini').style.width=confPct+'%';
      if(currentStep===3){
        const res=document.getElementById('livePredResult');
        const bar=document.getElementById('confBar');
        if (res) {
          res.textContent=detected==='start'?'Start':detected==='stop'?'Stop':detected.replace(/_/g,' ');
          res.className='tr-pred-result'+(conf>.7?' detected':'');
        }
        if (bar) {
          bar.style.width=confPct+'%';
        }
        
        const resAlt=document.getElementById('livePredResultAlt');
        const barAlt=document.getElementById('confBarAlt');
        if (resAlt) {
          resAlt.textContent=detected==='start'?'Start':detected==='stop'?'Stop':detected.replace(/_/g,' ');
          resAlt.className='tr-pred-result'+(conf>.7?' detected':'');
        }
        if (barAlt) {
          barAlt.style.width=confPct+'%';
        }
      }
      
      // ── 1. UPDATE UI INDICATOR DOT BATAY SA CONFIDENCE ──
      const dots = document.querySelectorAll('.status-dot');
      const indTexts = document.querySelectorAll('.indicator-text');
      
      if (conf > 0.45 && detected !== 'unknown') {
        dots.forEach(dot => {
          dot.className = 'status-dot active-gets'; // Turns Green
        });
        indTexts.forEach(indText => {
          indText.textContent = `Gets: ${detected.replace(/_/g, ' ')}`;
        });
        // ── 2. CONVERSATIONAL ACCUMULATION FLOW ──
        if(forTranslation && conf > .45){
          if(detected !== lastDetected){ lastDetected = detected; holdStart = Date.now(); return; }
          if(Date.now() - holdStart < GESTURE_HOLD_MS) return;
          
          // A. START GESTURE - I-clear/reset ang kasalukuyang sentence
          if(detected === 'start' && currentGesture !== 'start'){
            currentGesture = 'start';
            currentSentence = [];
            isSentenceActive = true;
            lastDetected = null; holdStart = null;
            document.getElementById('tlHistory').innerHTML = '<span class="tl-empty">Sentence cleared. Show your signs...</span>';
            document.getElementById('tlBigOutput').innerHTML = '<span class="tl-big-empty">Listening...</span>';
            showToast(signLang === 'fil' ? '▶ Na-clear. I-senyas ang mga salita.' : '▶ Cleared. Show your signs.');
          }
          
          // B. STOP GESTURE - Tapusin at Basahin ang Buong Pangungusap
          else if(detected === 'stop' && currentGesture !== 'stop'){
            currentGesture = 'stop';
            isSentenceActive = false;
            
            if(currentSentence.length > 0){
              const finalSentence = formulateSmartSentence(currentSentence, signLang);
              document.getElementById('tlHistory').innerHTML = `<span class="tl-word">${finalSentence}</span>`;
              document.getElementById('tlBigOutput').innerHTML = `<span class="word">${finalSentence}</span>`;
              speakWord(finalSentence, signLang);
              showToast(signLang === 'fil' ? '⏹ Tapos! Binabasa...' : '⏹ Done! Speaking...');
              try {
                await DB_API.saveTranslation({
                  sourceType: 'sign_to_text',
                  signLabel: 'sentence',
                  translatedText: finalSentence,
                  language: signLang === 'fil' ? 'fil-PH' : 'en-US',
                  confidence: conf
                });
              } catch(e) {
                console.error("Failed to save translation history:", e);
              }
            } else {
              document.getElementById('tlHistory').innerHTML = `<span class="tl-empty">${signLang === 'fil' ? 'Walang salitang narekord.' : 'No words recorded.'}</span>`;
              document.getElementById('tlBigOutput').innerHTML = `<span class="tl-big-empty">${signLang === 'fil' ? 'Wala pang naipong salita.' : 'No words yet.'}</span>`;
            }
          }
          
          // C. ANY GESTURE - Awtomatikong nagdadagdag ng salita (walang 'start' gate)
          else if(detected !== 'start' && detected !== 'stop' && currentGesture !== detected){
            currentGesture = detected;
            const word = translateGestureLabel(detected, signLang);
            currentSentence.push(word);
            isSentenceActive = true;
            
            document.getElementById('tlHistory').innerHTML = currentSentence.map(w => `<span class="tl-word">${w}</span>`).join(' ');
            document.getElementById('tlBigOutput').innerHTML = currentSentence.map(w => `<span class="word">${w}</span>`).join(' ') + '...';
            showToast(`+ "${word}"`);
          }
        }
      }else if(forTranslation){lastDetected=null;holdStart=null;}
      }catch(e){
        console.error("Prediction loop error:", e);
        if (dbg) {
          dbg.innerHTML += `\n• ERROR: ${e.message}`;
        }
      }
  },150);
}

function stopLivePrediction(){
  clearInterval(predictLoop);
  document.getElementById('predictOverlay').classList.remove('webcam-active');
  document.getElementById('predictOverlay').classList.remove('show');
  cameraFrame.classList.remove('predicting','glowing');
}

function getWordBank(){const base=signLang==='fil'?DEFAULT_WORDS_FIL:DEFAULT_WORDS_EN;return customWords.length?[...customWords,...base]:base;}

function tlSetLang(lang){
  signLang = lang;
  const langEn = document.getElementById('langEn');
  const langFil = document.getElementById('langFil');
  if(langEn) langEn.classList.toggle('active', lang==='en');
  if(langFil) langFil.classList.toggle('active', lang==='fil');
  showToast(lang==='fil'?'🇵🇭 Filipino mode':'🇺🇸 English mode');
  renderTranslation();
}

function setLang(lang){
  tlSetLang(lang);
}

function addCustomWord(){
  const inp=document.getElementById('wordInput');const w=inp.value.trim();if(!w)return;
  customWords.unshift(w);inp.value='';wordIndex=0;renderWordChips();showToast(`✏️ Added: "${w}"`);
}

function removeCustomWord(idx){customWords.splice(idx,1);renderWordChips();}

function renderWordChips(){
  document.getElementById('wordChips').innerHTML=customWords.map((w,i)=>
    `<span class="tr-chip">${w}<button type="button" onclick="removeCustomWord(${i})">✕</button></span>`
  ).join('');
}

function renderTranslation(){
  const hist=document.getElementById('tlHistory');
  const big=document.getElementById('tlBigOutput');
  if(!translatedWords.length){
    hist.innerHTML='<span class="tl-empty">Wala pang na-detect na gestures...</span>';
    big.innerHTML='<span class="tl-big-empty">Show your start gesture to begin.</span>';
    return;
  }
  hist.innerHTML=translatedWords.map(w=>w.type==='stop'?'<span class="tl-word stop-word">⏸</span>':`<span class="tl-word">${getTranslatedWordText(w, signLang)}</span>`).join(' ');
  hist.scrollTop=hist.scrollHeight;
  const words=translatedWords.filter(w=>w.type!=='stop').map(w=>getTranslatedWordText(w, signLang));
  big.innerHTML=words.length?words.map(w=>`<span class="word">${w}</span>`).join(' '):'<span class="tl-big-empty">Show your start gesture to begin.</span>';
}

function getAccumulatedTranslation() {
  const bigOutputEl = document.getElementById('tlBigOutput');
  if (bigOutputEl) {
    const text = bigOutputEl.innerText || bigOutputEl.textContent;
    if (text && text.trim() && !text.includes('Show your start gesture') && !text.includes('Listening...') && !text.includes('Wala pang naipong salita') && !text.includes('Nagsimula nang makinig')) {
      return text.replace(/\.\.\.$/, '').trim();
    }
  }
  if (window.currentSentence && window.currentSentence.length > 0) {
    return window.currentSentence.join(' ');
  }
  if (translatedWords && translatedWords.length > 0) {
    return translatedWords.filter(w=>w.type!=='stop').map(w=>getTranslatedWordText(w, signLang)).join(' ');
  }
  return '';
}

function speakAll(){
  const words = getAccumulatedTranslation();
  if(!words){showToast('⚠️ Wala pang salita.');return;}
  
  const speakBtn = document.getElementById('speakBtn');
  const speakBigBtn = document.getElementById('speakBigBtn');
  
  speakUtterance(words, signLang, () => {
    [speakBtn, speakBigBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.add('speaking');
      btn.textContent = '🔊 Speaking…';
    });
  }, () => {
    [speakBtn, speakBigBtn].forEach(btn => {
      if (!btn) return;
      btn.classList.remove('speaking');
      btn.textContent = btn.id === 'speakBtn' ? '🔊 Speak All' : '🔊 Speak';
    });
  });
}

function clearTranslation(){
  window.currentSentence = [];
  translatedWords = [];
  wordIndex = 0;
  currentGesture = null;
  lastDetected = null;
  holdStart = null;
  window.isSentenceActive = false;
  
  const hist = document.getElementById('tlHistory');
  const big = document.getElementById('tlBigOutput');
  if (hist) hist.innerHTML = '<span class="tl-empty">Wala pang na-detect na gestures...</span>';
  if (big) big.innerHTML = '<span class="tl-big-empty">Show your start gesture to begin.</span>';
  
  showToast('🗑️ Cleared');
}

function copyTranslation(){
  const text = getAccumulatedTranslation();
  if(!text){showToast('⚠️ Wala pang text.');return;}
  navigator.clipboard.writeText(text).then(()=>showToast('📋 Copied!'));
}

function downloadTranslation(){
  const text = getAccumulatedTranslation();
  if(!text){showToast('⚠️ Wala pang translation.');return;}
  const blob=new Blob([`SiningKamay Translation\n${new Date().toLocaleString()}\n\n${text}`],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`siningkamay-${Date.now()}.txt`;a.click();
  showToast('💾 Saved!');
}

function showSuccessScreen(){
  stopLivePrediction();
  document.getElementById('trSuccessOverlay').classList.add('show');
}

function resetToStepOne(){
  document.getElementById('trSuccessOverlay').classList.remove('show');
  clearTranslation();
  showStepInstruction(1);
}

// ── TRAINING STEP NAVIGATION ──
function updateTrPills(step){
  [1,2,3,4].forEach(n=>{
    const p=document.getElementById('pill'+n);
    p.classList.remove('active','done');
    if(n<step) p.classList.add('done');
    if(n===step) p.classList.add('active');
  });
}

function showStepInstruction(step){
  stopLivePrediction();
  currentStep=step;
  updateTrPills(step);
  document.getElementById('trInstrWrap').style.display='flex';
  document.getElementById('trContentWrap').style.display='none';
  [1,2,3,4].forEach(n=>{
    document.getElementById('trInstr'+n).style.display=n===step?'flex':'none';
  });
}

function showStepContent(step){
  if(step>=3&&!modelTrained){showToast('Train the AI first in Step 2!');return;}
  currentStep=step;
  updateTrPills(step);
  document.getElementById('trInstrWrap').style.display='none';
  document.getElementById('trContentWrap').style.display='flex';
  applyStepLayoutClass(step);
  [1,2,3,4].forEach(n=>{
    const el=document.getElementById('leftStep'+n);
    el.classList.toggle('active',n===step);
    if(n!==step) el.style.display='none'; else el.style.display='';
  });
  stopLivePrediction();
  
  // Explicitly play video stream to prevent Chromium freezes on hidden element
  if (stream && videoFeed) {
    videoFeed.play().catch(e => console.warn("[Camera] Play failed:", e));
  }
  
  if(step===3) setTimeout(()=>startLivePrediction(false), 600);
  if(step===4) setTimeout(()=>startLivePrediction(true), 600);
}

function trGoToStep(step){
  if(step>=3&&!modelTrained){showToast('Train the AI first in Step 2!');return;}
  showStepInstruction(step);
}

function trClickPill(step){
  if(step>=3&&!modelTrained){showToast('Train the AI first in Step 2!');return;}
  showStepInstruction(step);
}

function goToStep(step){trGoToStep(step);}
function nextStep(){if(currentStep<4)goToStep(currentStep+1);}
function setStep(step){trGoToStep(step);}

// Hook UI event listeners
enableCamBtn.addEventListener('click', () => {
  initCameraWithFallback(
    320, 
    240, 
    (s) => {
      stream = s;
      videoFeed.srcObject = stream;
      videoFeed.style.display = 'block';
      camPlaceholder.style.display = 'none';
      enableCamBtn.style.display = 'none';
      camBadge.classList.add('live');
      camBadge.innerHTML = '<div class="live-dot pulsing"></div> Camera Ready';
      showToast('🟢 Camera successfully started!');
      if (window.GestureDataRecorder && typeof window.GestureDataRecorder.setupMediaPipe === 'function') {
        window.GestureDataRecorder.setupMediaPipe(videoFeed);
      }
      
      // Ensure video is playing
      videoFeed.play().catch(e => console.warn("[Camera] Play failed:", e));
      
      // Auto-start predictions if camera is enabled while on Step 3 or Step 4
      if (currentStep === 3) {
        startLivePrediction(false);
      } else if (currentStep === 4) {
        startLivePrediction(true);
      }
    },
    (err, msg) => {
      console.error("Enable Camera Fail:", err);
      if (err.name === 'NotFoundError') {
        camBadge.innerHTML = '<div class="live-dot"></div> No Camera Found';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        camBadge.innerHTML = '<div class="live-dot"></div> Camera Busy';
      } else {
        camBadge.innerHTML = '<div class="live-dot"></div> Permission Denied';
      }
      showToast(msg, 5000);
    }
  );
});

document.getElementById('downloadBtn').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(trainData)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='siningkamay-training.json';a.click();
  showToast('📥 Training data exported!');
});

document.getElementById('loadBtn').addEventListener('click',()=>{
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=ev=>{
      try{
        const d=JSON.parse(ev.target.result);
        if(typeof d === 'object'){
          Object.assign(trainData, d);
          showToast(`✅ Loaded training samples!`);
          updateUI();
        }
      }catch{showToast('⚠️ Invalid file');}
    };r.readAsText(f);
  };inp.click();
});

document.getElementById('wordInput').addEventListener('keydown',e=>{if(e.key==='Enter')addCustomWord();});

window.reloadDataset = async () => {
  savedGestureSamplesMerged = false;
  let gestures = null;
  try {
    // no_sync: the save that triggered this reload already wrote disk and the gesture_recordings
    // row directly (save_gesture.php's POST branch calls save_gesture_recording_to_db, not
    // sync_disk_to_db), so re-walking every label folder here is redundant (finding 10).
    // DOMContentLoaded, below, keeps the full synced fetch: disk could have been touched outside
    // the app between page loads, and that path is not on the per-save critical path.
    gestures = await GestureDataRecorder.loadSavedGestureDataset(true);
  } catch (err) {
    console.warn('[reloadDataset] shared fetch failed, falling back to independent full reloads:', err);
  }
  await mergeSavedGestureSamples(gestures || undefined);
  renderSavedDataset(gestures || undefined);
  updateUI();
};

// Startup triggers:
window.addEventListener('DOMContentLoaded', async () => {
  const lblIn = document.getElementById('gestureLabelInput');
  const clearNote = () => { justSavedNote = ''; refreshSampleCountLine(); };
  if (lblIn) lblIn.addEventListener('input', clearNote);
  document.querySelectorAll('input[name="gestureDatasetType"]').forEach(r => r.addEventListener('change', clearNote));
  const startB = document.getElementById('startGestureDataBtn');
  if (startB) startB.addEventListener('click', () => { justSavedNote = ''; });
  refreshSampleCountLine();

  showStepInstruction(1);

  // Try restoring cached KNN model so Step 3 works without re-training
  const initLangRadio = document.querySelector('input[name="gestureDatasetType"]:checked');
  const initLang = (initLangRadio ? initLangRadio.value : 'ESL').toUpperCase();
  if (loadKnnFromCache(initLang)) {
    console.log(`[KNN] Restored cached model for ${initLang} — ${activeLabels.length} gestures loaded`);
    showToast(`✅ Gesture model loaded (${activeLabels.length} gestures)`, 2500);
  }

  await mergeSavedGestureSamples();
  renderSavedDataset();
  updateUI();
});

function formulateSmartSentence(wordsArray, lang) {
  if (!wordsArray || wordsArray.length === 0) return "";
  
  // Pagsamahin ang mga salita
  let rawSentence = wordsArray.join(' ').trim();
  
  // 1. I-normalize ang capitalization at spacing
  let sentence = rawSentence.charAt(0).toUpperCase() + rawSentence.slice(1);
  
  // 2. Kilalanin kung ito ay Tanong (Question)
  const lower = rawSentence.toLowerCase();
  
  // Tukuyin ang mga question markers sa English at Tagalog
  const enQuestionWords = ['how', 'what', 'who', 'where', 'why', 'when', 'are you', 'is it', 'do you', 'can you', 'have you', 'would you', 'should you'];
  const filQuestionWords = ['ano', 'sino', 'saan', 'bakit', 'kailan', 'paano', 'kumusta', 'kamusta', 'ba', 'ka na'];
  
  let isQuestion = false;
  if (lang === 'fil') {
    const words = lower.split(/\s+/);
    isQuestion = filQuestionWords.some(q => words.includes(q)) || lower.startsWith('paano') || lower.startsWith('kumusta') || lower.startsWith('kamusta');
  } else {
    isQuestion = enQuestionWords.some(q => lower.startsWith(q) || lower.includes(' ' + q + ' '));
  }
  
  // 3. Ilapat ang mga Grammatical Enhancements (Smart Maps)
  if (lang === 'fil') {
    if (lower.includes("kumain ka")) {
      return "Kumain ka na ba?";
    }
    if (lower.includes("salamat tulong")) {
      return "Maraming salamat sa tulong mo.";
    }
    if (lower === "kumusta ka" || lower === "kamusta ka") {
      return "Kumusta ka?";
    }
  } else {
    if (lower.includes("hello thank you")) {
      return "Hello, thank you very much.";
    }
    if (lower.includes("you eat")) {
      return "Have you eaten yet?";
    }
    if (lower === "how are you") {
      return "How are you?";
    }
  }
  
  // 4. Lagyan ng tamang bantas (Punctuation) sa dulo
  if (sentence.endsWith('?') || sentence.endsWith('.') || sentence.endsWith('!')) {
    return sentence;
  }
  
  return sentence + (isQuestion ? '?' : '.');
}

// ── Countdown and Video Preview Features ──
let mediaRecorder = null;
let recordedChunks = [];
let previewBlobUrl = null;
let currentCaptureMeta = null;

function runCountdown(onComplete) {
  const overlay = document.getElementById('countdownOverlay');
  const numberEl = document.getElementById('countdownNumber');
  if (!overlay || !numberEl) {
    onComplete();
    return;
  }

  overlay.classList.add('show');
  let count = 3;
  numberEl.textContent = count;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      numberEl.textContent = count;
    } else if (count === 0) {
      numberEl.textContent = "GO!";
    } else {
      clearInterval(interval);
      overlay.classList.remove('show');
      onComplete();
    }
  }, 1000);
}

function startMediaRecording() {
  recordedChunks = [];
  if (!stream) {
    console.warn("No active camera stream for MediaRecorder.");
    return;
  }

  try {
    const options = { mimeType: 'video/webm;codecs=vp8' };
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    try {
      mediaRecorder = new MediaRecorder(stream);
    } catch (err) {
      console.error("Failed to initialize MediaRecorder:", err);
      return;
    }
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    console.log("MediaRecorder stopped. Chunks:", recordedChunks.length);
    const blob = new Blob(recordedChunks, { type: 'video/webm' });

    // Expose blob globally so gesture-data.js can read it during confirmAndSave
    window.currentPreviewBlob = blob;

    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
    }
    previewBlobUrl = URL.createObjectURL(blob);
    const previewVideo = document.getElementById('capturePreviewVideo');
    if (previewVideo) {
      previewVideo.classList.add('mirrored'); // Mirror webcam recording!
      previewVideo.src = previewBlobUrl;
      previewVideo.load();
      
      // Now show the preview panel and play after the src is loaded
      document.getElementById('step1CaptureControls').style.display = 'none';
      document.getElementById('step1PreviewControls').classList.add('active');
      
      previewVideo.play().catch(e => console.warn("Failed autoplaying preview video:", e));
    }
  };

  mediaRecorder.start();
}

function resetCaptureUI() {
  document.getElementById('step1CaptureControls').style.display = 'flex';
  document.getElementById('step1PreviewControls').classList.remove('active');
  const previewVideo = document.getElementById('capturePreviewVideo');
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo.classList.remove('mirrored');
    previewVideo.style.transform = ''; // Reset CSS zoom transform
  }
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }
  currentCaptureMeta = null;

  // Reset Zoom UI and values
  const previewZoom = document.getElementById('previewZoom');
  const previewZoomVal = document.getElementById('previewZoomVal');
  if (previewZoom) previewZoom.value = 100;
  if (previewZoomVal) previewZoomVal.textContent = '100%';
  currentZoom = 1;
  panX = 0;
  panY = 0;
}

// ── Video Preview Zoom and Pan Logic ──
let currentZoom = 1;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;

function updateVideoTransform() {
  const previewVideo = document.getElementById('capturePreviewVideo');
  if (!previewVideo) return;
  const isMirrored = previewVideo.classList.contains('mirrored');
  const scaleX = isMirrored ? -1 : 1;
  previewVideo.style.transform = `scale(${currentZoom}) translate(${panX / currentZoom}px, ${panY / currentZoom}px) scaleX(${scaleX})`;
}

window.addEventListener('DOMContentLoaded', () => {
  const previewContainer = document.querySelector('.tr-preview-video-container');
  const previewVideo = document.getElementById('capturePreviewVideo');
  const previewZoom = document.getElementById('previewZoom');
  const previewZoomVal = document.getElementById('previewZoomVal');

  if (previewZoom) {
    previewZoom.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      currentZoom = val / 100;
      if (previewZoomVal) {
        previewZoomVal.textContent = `${val}%`;
      }
      if (currentZoom <= 1) {
        panX = 0;
        panY = 0;
        if (previewContainer) previewContainer.style.cursor = 'default';
      } else {
        if (previewContainer) previewContainer.style.cursor = 'grab';
      }
      updateVideoTransform();
    });
  }

  if (previewContainer && previewVideo) {
    const startDrag = (clientX, clientY) => {
      if (currentZoom <= 1) return;
      isDragging = true;
      previewContainer.style.cursor = 'grabbing';
      startX = clientX - panX;
      startY = clientY - panY;
    };

    const moveDrag = (clientX, clientY) => {
      if (!isDragging) return;
      panX = clientX - startX;
      panY = clientY - startY;

      // Clamp panning boundaries to keep the video in view
      const limitX = (currentZoom - 1) * (previewContainer.clientWidth / 2);
      const limitY = (currentZoom - 1) * (previewContainer.clientHeight / 2);
      panX = Math.max(-limitX, Math.min(limitX, panX));
      panY = Math.max(-limitY, Math.min(limitY, panY));

      updateVideoTransform();
    };

    const endDrag = () => {
      if (isDragging) {
        isDragging = false;
        previewContainer.style.cursor = currentZoom > 1 ? 'grab' : 'default';
      }
    };

    // Mouse Controls
    previewContainer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      moveDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', endDrag);

    // Touch Controls (Tablet / Touch Kiosk Support)
    previewContainer.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startDrag(touch.clientX, touch.clientY);
    });

    window.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      moveDrag(touch.clientX, touch.clientY);
    });

    window.addEventListener('touchend', endDrag);
  }
});

// Hook into GestureDataRecorder.startRecording to inject countdown
function hookStartRecording() {
  if (window.GestureDataRecorder && typeof window.GestureDataRecorder.startRecording === 'function') {
    const origStart = window.GestureDataRecorder.startRecording;
    window.GestureDataRecorder.startRecording = function (label) {
      if (!stream) {
        showToast("⚠️ Please enable the camera first!");
        return;
      }
      resetCaptureUI();
      runCountdown(() => {
        startMediaRecording();
        origStart(label);
      });
    };
  } else {
    setTimeout(hookStartRecording, 50);
  }
}
hookStartRecording();

// Capture callbacks
window.onGestureCaptureStop = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
};

window.onGestureCaptureCancelled = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  resetCaptureUI();
};

window.onGestureCaptureReady = (label, signLanguage) => {
  currentCaptureMeta = { label, signLanguage };
  const prev = document.getElementById('previewSampleLine');
  if (prev) prev.textContent = `This will be sample ${sampleInfoFor(label, String(signLanguage).toUpperCase() === 'FSL' ? 'FSL' : 'ESL').samples + 1} of “${label}”.`;
};

// Wire confirm and retry preview controls immediately
const saveBtn = document.getElementById('savePreviewBtn');
const retryBtn = document.getElementById('retryPreviewBtn');

if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    if (window.GestureDataRecorder && typeof window.GestureDataRecorder.confirmAndSave === 'function') {
      const res = await window.GestureDataRecorder.confirmAndSave();
      if (res && res.success) {
        noteSampleSaved(res);
        resetCaptureUI();
        refreshSampleCountLine();
      }
    }
  });
}

if (retryBtn) {
  retryBtn.addEventListener('click', () => {
    if (window.GestureDataRecorder && typeof window.GestureDataRecorder.discardCapture === 'function') {
      window.GestureDataRecorder.discardCapture();
    }
    resetCaptureUI();
  });
}



