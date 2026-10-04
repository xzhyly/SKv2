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
// Tab order and titles for the dataset modal; the default tab is the first one.
const DATASET_TABS = [['word', 'Words'], ['letter', 'Letters'], ['number', 'Numbers'], ['phrase', 'Phrases']];
let datasetGroups = null;          // category -> [{label, signSet, textEn, textFil, samples}], set by renderSavedDataset(); null = no table
let datasetActiveTab = 'word';
let datasetEditing = null;         // { key, oldSet } while the edit panel is open, else null
let datasetEditBusy = false;

function trOpenDatasetModal() {
  // Every open starts on the Words tab with an empty search, in table mode.
  datasetActiveTab = 'word';
  const search = document.getElementById('datasetSearch');
  if (search) search.value = '';
  datasetEditing = null;
  trShowDatasetEditPanel(false);
  trRenderDatasetView();
  document.getElementById('datasetModal').classList.add('show');
}

function trSetDatasetTab(category) {
  datasetActiveTab = category;
  trRenderDatasetView();
}

// A text the sign's set does not use shows "—" even if a hidden text is stored.
function datasetShownText(row, which) {
  const set = String(row.signSet || 'ESL').toUpperCase();
  const used = which === 'en' ? set !== 'FSL' : set !== 'ESL';
  const text = which === 'en' ? row.textEn : row.textFil;
  return used && text ? text : '—';
}
// English text, else Filipino text, else the key (used in the delete confirm).
function datasetDisplayName(key) {
  const sign = GestureDataRecorder.getSigns()[key] || {};
  return sign.textEn || sign.textFil || key;
}

// Renders the modal's tabs and the active tab's rows, filtered by the search box (substring,
// case-insensitive, over the key and both texts). Called on open, tab click, every search
// keystroke, and after every renderSavedDataset() so a delete/edit shows up immediately.
// All user text goes in through textContent -- never innerHTML.
function trRenderDatasetView() {
  const tabsEl = document.getElementById('datasetTabs');
  const search = document.getElementById('datasetSearch');
  const modalBody = document.getElementById('datasetModalBody');
  if (!tabsEl || !search || !modalBody) return;
  if (datasetEditing) return;   // the edit panel owns the card; Save/Cancel re-render when it closes

  if (!datasetGroups) {   // empty dataset, still loading, or load error: show the status message as before
    tabsEl.innerHTML = '';
    search.style.display = 'none';
    const tableWrap = document.getElementById('gestureDatasetTableWrap');
    modalBody.innerHTML = (tableWrap && tableWrap.innerHTML) || '<p style="color:#94a3b8;text-align:center;padding:16px;">No gestures recorded yet.</p>';
    return;
  }
  search.style.display = '';

  tabsEl.innerHTML = DATASET_TABS.map(([category, title]) => {
    const active = category === datasetActiveTab;
    return `<button type="button" role="tab" aria-selected="${active}" class="tr-ds-tab${active ? ' active' : ''}" onclick="trSetDatasetTab('${category}')">${title} · <span class="tr-ds-count">${datasetGroups[category].length}</span></button>`;
  }).join('');

  const query = search.value.trim().toLowerCase();
  const rows = datasetGroups[datasetActiveTab].filter(r =>
    r.label.toLowerCase().includes(query) ||
    (r.textEn || '').toLowerCase().includes(query) ||
    (r.textFil || '').toLowerCase().includes(query));

  const table = document.createElement('table');
  table.className = 'tr-ds-table';
  const head = table.createTHead().insertRow();
  ['English text', 'Filipino text', 'Set', 'Samples', 'Edit', 'Delete'].forEach(t => {
    const th = document.createElement('th'); th.textContent = t; head.appendChild(th);
  });
  const body = table.createTBody();
  if (rows.length === 0) {
    const td = body.insertRow().insertCell();
    td.colSpan = 6; td.className = 'tr-ds-empty';
    td.textContent = query ? 'No matches' : 'No gestures in this category yet.';
  }
  rows.forEach(row => {
    const tr = body.insertRow();
    tr.dataset.key = row.label;
    const en = tr.insertCell(); en.className = 'tr-ds-text'; en.textContent = datasetShownText(row, 'en');
    const fil = tr.insertCell(); fil.className = 'tr-ds-text'; fil.textContent = datasetShownText(row, 'fil');
    const set = tr.insertCell(); set.className = 'tr-ds-c'; set.textContent = signSetName(row.signSet);
    const n = tr.insertCell(); n.className = 'tr-ds-c'; n.textContent = row.samples;
    const editTd = tr.insertCell(); editTd.className = 'tr-ds-c';
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'tr-ds-btn tr-ds-editbtn'; editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => trOpenDatasetEdit(row.label));
    editTd.appendChild(editBtn);
    const delTd = tr.insertCell(); delTd.className = 'tr-ds-c';
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'tr-ds-btn tr-ds-del'; delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteGesture(row.label));
    delTd.appendChild(delBtn);
  });
  modalBody.replaceChildren(table);
}

// ── Edit panel: change a sign's set and both texts without re-recording ──
function trShowDatasetEditPanel(on) {
  const panel = document.getElementById('datasetEditPanel');
  const title = document.getElementById('datasetModalTitle');
  if (panel) panel.style.display = on ? '' : 'none';
  ['datasetTabs', 'datasetSearch', 'datasetModalBody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'none' : '';
  });
  if (!on && title) title.textContent = '📁 Active Gesture Dataset';
}
function trDatasetEditSet() {
  const r = document.querySelector('input[name="dsEditSet"]:checked');
  const v = r ? String(r.value).toUpperCase() : 'ESL';
  return v === 'FSL' || v === 'BOTH' ? v : 'ESL';
}
function trDatasetEditUpdateFields() {
  const set = trDatasetEditSet();
  document.getElementById('dsEditEnGroup').style.display = set === 'FSL' ? 'none' : '';
  document.getElementById('dsEditFilGroup').style.display = set === 'ESL' ? 'none' : '';
}
function trDatasetEditMessage(text) {
  const el = document.getElementById('dsEditMsg');
  if (el) el.textContent = text || '';
}
function trOpenDatasetEdit(key) {
  const cat = Object.keys(datasetGroups || {}).find(c => datasetGroups[c].some(r => r.label === key));
  if (!cat) return;
  const row = datasetGroups[cat].find(r => r.label === key);
  const oldSet = String(row.signSet || 'ESL').toUpperCase();
  datasetEditing = { key, oldSet };
  const catTitle = DATASET_TABS.find(t => t[0] === cat)[1].replace(/s$/, '');
  document.getElementById('datasetModalTitle').textContent = `Edit sign — key: ${key} · ${row.samples} sample${row.samples === 1 ? '' : 's'}`;
  const radio = document.querySelector(`input[name="dsEditSet"][value="${oldSet}"]`);
  if (radio) radio.checked = true;
  document.getElementById('dsEditType').textContent = `Type: ${catTitle}`;
  document.getElementById('dsEditEn').value = row.textEn || '';
  document.getElementById('dsEditFil').value = row.textFil || '';
  trDatasetEditMessage('');
  trDatasetEditUpdateFields();
  trShowDatasetEditPanel(true);
}
function trDatasetEditCancel() {
  datasetEditing = null;
  trShowDatasetEditPanel(false);
  trRenderDatasetView();
}
async function trDatasetEditSave() {
  if (!datasetEditing || datasetEditBusy) return;
  const { key, oldSet } = datasetEditing;
  const set = trDatasetEditSet();
  const en = document.getElementById('dsEditEn').value.trim();
  const fil = document.getElementById('dsEditFil').value.trim();
  if (set !== 'FSL' && !en) { trDatasetEditMessage('Enter the English text.'); return; }
  if (set !== 'ESL' && !fil) { trDatasetEditMessage('Enter the Filipino text.'); return; }
  trDatasetEditMessage('');
  const saveBtn = document.getElementById('dsEditSave');
  datasetEditBusy = true; saveBtn.disabled = true;
  try {
    const res = await fetch('php/api/signs.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', key, set,
        textEn: set === 'FSL' ? null : en, textFil: set === 'ESL' ? null : fil })
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok || !json || !json.success) {
      trDatasetEditMessage((json && json.error) || `Save failed (HTTP ${res.status}).`);
      return;
    }
    // Model caches: clear every language whose membership changed (ESL = ESL|BOTH, FSL = FSL|BOTH).
    const inLang = (s, lang) => s === 'BOTH' || s === lang;
    ['ESL', 'FSL'].forEach(lang => {
      if (inLang(oldSet, lang) !== inLang(set, lang)) {
        try { localStorage.removeItem(`sining_kamay_labels_${lang}`); } catch (e) { /* storage unavailable */ }
      }
    });
    showToast('Saved.');
    datasetEditing = null;
    trShowDatasetEditPanel(false);
    await window.reloadDataset();
    trRenderDatasetView();
  } catch (err) {
    trDatasetEditMessage('Save failed: ' + err.message);
  } finally {
    datasetEditBusy = false; saveBtn.disabled = false;
  }
}
window.trOpenDatasetEdit = trOpenDatasetEdit;
window.trDatasetEditCancel = trDatasetEditCancel;
window.trDatasetEditSave = trDatasetEditSave;
window.trDatasetEditUpdateFields = trDatasetEditUpdateFields;
window.trSetDatasetTab = trSetDatasetTab;
window.trRenderDatasetView = trRenderDatasetView;

function trCloseDatasetModal() {
  datasetEditing = null;
  trShowDatasetEditPanel(false);
  trRenderDatasetView();
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
  const t = window.GestureDataRecorder && GestureDataRecorder.getSignText && GestureDataRecorder.getSignText(label, lang);
  if (t) return t;
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
  const targetLang = modelLanguage();
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
const savedSampleInfo = {};   // sign key -> { samples, frames } (one tally per sign, whatever its set)
let justSavedNote = '';

// Step 1's Sign Set radio: 'ESL' | 'FSL' | 'BOTH'.
function selectedSignSet() {
  const r = document.querySelector('input[name="gestureDatasetType"]:checked');
  const v = r ? String(r.value).toUpperCase() : 'ESL';
  return v === 'FSL' || v === 'BOTH' ? v : 'ESL';
}
function signSetName(set) {
  const v = String(set || 'ESL').toUpperCase();
  return v === 'BOTH' ? 'Both' : v === 'FSL' ? 'FSL' : 'ESL';
}
function currentEnglishText() {
  const el = document.getElementById('signTextEn');
  return el ? el.value.trim() : '';
}
function currentFilipinoText() {
  const el = document.getElementById('signTextFil');
  return el ? el.value.trim() : '';
}
// The sign's key, derived from the shown text field (never typed): English for ESL/Both, Filipino
// for FSL. Same rule as the server (clean_label); empty text -> ''.
function currentKey() {
  const text = selectedSignSet() === 'FSL' ? currentFilipinoText() : currentEnglishText();
  return GestureDataRecorder.cleanLabel(text);
}
// ESL shows English only, FSL shows Filipino only, Both shows both (only the group's wrapper hides).
function updateTextFieldVisibility() {
  const set = selectedSignSet();
  const en = document.getElementById('signTextEnGroup');
  const fil = document.getElementById('signTextFilGroup');
  if (en) en.style.display = set === 'FSL' ? 'none' : '';
  if (fil) fil.style.display = set === 'ESL' ? 'none' : '';
}
// The stored category of a sign (a BOTH sign is under both ESL and FSL in the map).
function storedCategoryFor(key, set) {
  const saved = GestureDataRecorder.getSavedCategories();
  if (!saved || !key) return null;
  const order = set === 'FSL' ? ['FSL', 'ESL'] : ['ESL', 'FSL'];
  for (const s of order) { if (saved[s] && saved[s][key]) return saved[s][key]; }
  return null;
}
// Sets the checked Type (gestureCategory) radio to the stored category for the current key if one
// was saved, else the heuristic's guess; empty key -> 'word'.
// Only called from the text-field / Sign Set change handlers and renderSavedDataset() --
// a manual tap on a Type option must survive until the key or sign set changes again.
function autoSelectCategory() {
  const key = currentKey();
  let category = 'word';
  if (key) category = storedCategoryFor(key, selectedSignSet()) || GestureCategory.guess(key);
  const radio = document.querySelector(`input[name="gestureCategory"][value="${category}"]`);
  if (radio) radio.checked = true;
}
function sampleInfoFor(key) {
  return (key && savedSampleInfo[key]) || { samples: 0, frames: 0 };
}
function rebuildSampleInfo(gestures) {
  Object.keys(savedSampleInfo).forEach(k => { delete savedSampleInfo[k]; });
  Object.keys(gestures).forEach(key => gestures[key].forEach(s => {
    const e = savedSampleInfo[key] || (savedSampleInfo[key] = { samples: 0, frames: 0 });
    e.samples += 1; e.frames += s.frameCount || 0;
  }));
}
function noteSampleSaved(res) {
  const e = savedSampleInfo[res.label] || (savedSampleInfo[res.label] = { samples: 0, frames: 0 });
  e.samples = res.labelSampleCount || e.samples + 1;   // server count is authoritative
  e.frames += res.frameCount || 0;                     // exact again after the next dataset reload
  justSavedNote = 'Saved. Run Train AI (Step 2) again to use it.';
}
// The existing sign with this key if it was saved under a DIFFERENT set than the form's, else null.
function conflictingSign(key) {
  const signs = GestureDataRecorder.getSigns();
  const existing = key && signs && signs[key];
  return existing && String(existing.set).toUpperCase() !== selectedSignSet() ? existing : null;
}
function refreshSampleCountLine() {
  const line = document.getElementById('sampleCountLine');
  const startBtn = document.getElementById('startGestureDataBtn');
  if (!line) return;
  const key = currentKey();
  const clash = conflictingSign(key);
  if (startBtn) {
    startBtn.textContent = 'Record 3 samples';
    startBtn.disabled = !!clash;
  }
  const { samples, frames } = sampleInfoFor(key);
  line.classList.toggle('done', !clash && samples >= SAMPLE_TARGET);
  if (!key) { line.textContent = ''; return; }
  if (clash) {
    line.textContent = `“${key}” already exists as ${signSetName(clash.set)} — change it in View Active Gesture Dataset first.`;
    return;
  }
  let text;
  if (samples === 0) text = `“${key}” is a new word — no samples yet. Aim for ${SAMPLE_TARGET}.`;
  else if (samples < SAMPLE_TARGET) text = `“${key}” — ${samples} sample${samples === 1 ? '' : 's'} saved (${frames} frames). Record another — aim for ${SAMPLE_TARGET}.`;
  else text = `“${key}” — ${samples} samples saved (${frames} frames). ✓ Target reached; more are optional.`;
  line.textContent = justSavedNote ? `${text} ${justSavedNote}` : text;
}

// ── DATASET DISPLAY IN STEP 1 (Table with Delete buttons) ──
async function renderSavedDataset(prefetchedGestures) {
  const tableWrap = document.getElementById('gestureDatasetTableWrap');
  const datasetCount = document.getElementById('datasetCount');
  if (!tableWrap) return;
  // The modal (trRenderDatasetView) draws the per-category tabs from datasetGroups; tableWrap only
  // carries the empty/error message it falls back to when there is no table to show.
  datasetGroups = null;
  tableWrap.innerHTML = '';
  try {
    const gestures = prefetchedGestures || await GestureDataRecorder.loadSavedGestureDataset();
    rebuildSampleInfo(gestures); refreshSampleCountLine();
    const labels = Object.keys(gestures);
    datasetCount.textContent = `${labels.length} gestures`;
    if (labels.length === 0) {
      tableWrap.innerHTML = '<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center; padding:10px;">No saved gestures found.</p>';
      return;
    }
    // Group by category: stored category wins, else the heuristic's guess.
    const signs = GestureDataRecorder.getSigns();
    const groups = { word: [], letter: [], number: [], phrase: [] };
    labels.forEach(label => {
      const samples = gestures[label];
      const sign = signs && signs[label];
      const signSet = (sign && sign.set) || samples[0]?.signLanguage || 'ESL';
      const stored = storedCategoryFor(label, String(signSet).toUpperCase());
      const category = stored || GestureCategory.guess(label);
      (groups[category] || groups.word).push({ label, signSet, textEn: sign && sign.textEn, textFil: sign && sign.textFil, samples: samples.length });
    });
    Object.keys(groups).forEach(cat => groups[cat].sort((a, b) => a.label.localeCompare(b.label)));
    datasetGroups = groups;
  } catch(err) {
    tableWrap.innerHTML = `<p style="font-size:11px; color:#ef4444; text-align:center; padding:10px;">Error loading dataset: ${err.message}</p>`;
  } finally {
    trRenderDatasetView();
    autoSelectCategory();
  }
}

// ── FRONTEND DELETE ACTION ──
async function deleteGesture(label) {
  const delSign = GestureDataRecorder.getSigns()[label];
  const bothNote = delSign && String(delSign.set).toUpperCase() === 'BOTH' ? ' (ESL and FSL)' : '';
  if (!confirm(`Sigurado ka bang nais mong burahin ang lahat ng data para sa "${datasetDisplayName(label)}"${bothNote}?`)) return;
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
      delete savedSampleInfo[label]; refreshSampleCountLine();
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

// Step 2's "AI model" toggle: 'ESL' (ESL + Both signs, English text) or 'FSL' (FSL + Both signs,
// Filipino text).
function modelLanguage() {
  const r = document.querySelector('input[name="trainModelLang"]:checked');
  return r && String(r.value).toUpperCase() === 'FSL' ? 'FSL' : 'ESL';
}

// Step 3 shows the sign's text in the model's language (ESL -> English, FSL -> Filipino).
function predictDisplayText(label) {
  return translateGestureLabel(label, modelLanguage() === 'FSL' ? 'fil' : 'en');
}

// The model toggle changed (or was reset): load that language's cached model if there is one,
// else mark the model untrained so Train must be pressed.
function onModelLanguageChanged() {
  savedGestureSamplesMerged = false;
  if (!loadKnnFromCache(modelLanguage())) {
    modelTrained = false;
    knnModel = {};
    activeLabels = ['start', 'stop'];
    const nextBtn = document.getElementById('step2NextBtn');
    if (nextBtn) nextBtn.style.display = 'none';
    const trainBtn = document.getElementById('trainBtn');
    if (trainBtn) { trainBtn.disabled = false; trainBtn.textContent = 'Train Gesture'; }
  }
  updateTrPills(currentStep);
  updateUI();
}

// Each time Step 2 is shown the toggle starts from Step 1's set (Both -> ESL).
function syncModelToggleToStep1() {
  const want = selectedSignSet() === 'FSL' ? 'FSL' : 'ESL';
  const r = document.querySelector(`input[name="trainModelLang"][value="${want}"]`);
  if (!r || r.checked) return;
  r.checked = true;
  onModelLanguageChanged();
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
  const targetLang = modelLanguage();

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
      if (itemLang === targetLang || itemLang === 'BOTH') {
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

  const targetLang = modelLanguage();

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
      document.getElementById('predLabel').textContent=detected==='start'?'Start Gesture':detected==='stop'?'Stop Gesture':predictDisplayText(detected);
      document.getElementById('predConf').textContent=`Confidence: ${confPct}%`;
      document.getElementById('predFillMini').style.width=confPct+'%';
      if(currentStep===3){
        const res=document.getElementById('livePredResult');
        const bar=document.getElementById('confBar');
        if (res) {
          res.textContent=detected==='start'?'Start':detected==='stop'?'Stop':predictDisplayText(detected);
          res.className='tr-pred-result'+(conf>.7?' detected':'');
        }
        if (bar) {
          bar.style.width=confPct+'%';
        }
        
        const resAlt=document.getElementById('livePredResultAlt');
        const barAlt=document.getElementById('confBarAlt');
        if (resAlt) {
          resAlt.textContent=detected==='start'?'Start':detected==='stop'?'Stop':predictDisplayText(detected);
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
          indText.textContent = `Gets: ${predictDisplayText(detected)}`;
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
  if(step===2) syncModelToggleToStep1();
  
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
// One camera start, shared by the Enable Camera button (Steps 3/4) and Step 1's recording mode
// (js/gesture-capture-ui.js). Resolves with the stream; rejects with the helper's (err, msg).
function startPageCamera() {
  return new Promise((resolve, reject) => {
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
        if (window.GestureDataRecorder && typeof window.GestureDataRecorder.setupMediaPipe === 'function') {
          window.GestureDataRecorder.setupMediaPipe(videoFeed);
          // setupMediaPipe returns early for the same <video>; restart the loop if a closed
          // recording mode paused it (no-op when it is already running).
          if (typeof window.GestureDataRecorder.resumeHandLoop === 'function') window.GestureDataRecorder.resumeHandLoop();
        }

        // Ensure video is playing
        videoFeed.play().catch(e => console.warn("[Camera] Play failed:", e));

        // Auto-start predictions if camera is enabled while on Step 3 or Step 4
        if (currentStep === 3) {
          startLivePrediction(false);
        } else if (currentStep === 4) {
          startLivePrediction(true);
        }
        resolve(s);
      },
      (err, msg) => reject({ err, msg })
    );
  });
}

enableCamBtn.addEventListener('click', () => {
  startPageCamera().then(
    () => showToast('🟢 Camera successfully started!'),
    ({ err, msg }) => {
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

// Step 1's recording mode starts the camera when it opens and stops it when it closes - but only
// a camera it started itself; one already running for Steps 3/4 is left as it was.
let cameraOwnedByCapture = false;

function cameraErrorText(err) {
  const name = err && err.name;
  if (name === 'NotFoundError') return 'No camera found. Connect a camera and try again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The camera is busy. Close other apps using it and try again.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Camera permission was denied.';
  if (name === 'InsecureContext') return 'The camera needs localhost or HTTPS.';
  return 'Could not start the camera' + (name ? ' (' + name + ')' : '') + '.';
}

function acquireCaptureCamera() {
  if (window.GestureCaptureUI.streamIsLive(videoFeed.srcObject)) {
    const g = window.GestureDataRecorder;
    if (g && typeof g.resumeHandLoop === 'function') g.resumeHandLoop();
    return Promise.resolve(videoFeed.srcObject);
  }
  return startPageCamera().then(
    (s) => { cameraOwnedByCapture = true; return s; },
    ({ err }) => { console.warn('[gesture-training-ui] capture camera failed:', err); throw new Error(cameraErrorText(err)); }
  );
}

function releaseCaptureCamera() {
  if (!cameraOwnedByCapture) return;
  cameraOwnedByCapture = false;
  const g = window.GestureDataRecorder;
  if (g && typeof g.pauseHandLoop === 'function') g.pauseHandLoop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  videoFeed.srcObject = null;
  videoFeed.style.display = '';
  camPlaceholder.style.display = '';
  enableCamBtn.style.display = '';
  camBadge.classList.remove('live');
  camBadge.innerHTML = '<div class="live-dot"></div> Camera Off';
}

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
  const clearNote = () => { justSavedNote = ''; refreshSampleCountLine(); };
  ['signTextEn', 'signTextFil'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', clearNote);
    el.addEventListener('input', autoSelectCategory);
  });
  document.querySelectorAll('input[name="gestureDatasetType"]').forEach(r => r.addEventListener('change', () => {
    updateTextFieldVisibility(); clearNote(); autoSelectCategory();
  }));
  document.querySelectorAll('input[name="trainModelLang"]').forEach(r => r.addEventListener('change', onModelLanguageChanged));
  const startB = document.getElementById('startGestureDataBtn');
  if (startB) startB.addEventListener('click', () => { justSavedNote = ''; });
  updateTextFieldVisibility();
  refreshSampleCountLine();

  showStepInstruction(1);

  // Try restoring cached KNN model so Step 3 works without re-training
  const initLang = modelLanguage();
  if (loadKnnFromCache(initLang)) {
    console.log(`[KNN] Restored cached model for ${initLang} — ${activeLabels.length} gestures loaded`);
    showToast(`✅ Gesture model loaded (${activeLabels.length} gestures)`, 2500);
  }

  warmUpHandTracking();
  await mergeSavedGestureSamples();
  renderSavedDataset();
  updateUI();
});

// Warm up the ONE MediaPipe Hands instance at page load, after the startup dataset load so it does
// not compete with it: load the WASM + model (preloadMediaPipe), then run ONE detection on a blank
// frame through a detector (createVideoDetector; the results loop stays paused, no camera). The
// first inference is what made the first "Starting camera" take ~11 s (measured 2026-09-27: with
// initialize() alone the first open still took 11,157 ms). Opening the recording mode then only
// waits for the camera; every open, and Steps 3/4's Enable Camera, reuse this instance
// (setupMediaPipe returns early for the same <video>, and startPageCamera resumes the loop).
// window.handTrackingWarmUp resolves to { ok, ms } for timing checks.
function warmUpHandTracking() {
  const g = window.GestureDataRecorder;
  if (!g || typeof g.preloadMediaPipe !== 'function' || videoFeed.srcObject) {
    window.handTrackingWarmUp = Promise.resolve({ ok: false, ms: 0 });
    return;
  }
  const t0 = performance.now();
  window.handTrackingWarmUp = g.preloadMediaPipe(videoFeed).then(async (ok) => {
    if (ok && !videoFeed.srcObject && typeof g.createVideoDetector === 'function') {
      const blank = document.createElement('canvas');
      blank.width = 320;
      blank.height = 240;
      blank.getContext('2d').fillRect(0, 0, 320, 240);
      const det = await g.createVideoDetector();
      try { await det.detect(blank); } finally { det.release(); }
    }
    // A camera started while the model was loading (Enable Camera, or the recording mode):
    // preloadMediaPipe paused the loop, so start it again (no-op if it is running).
    if (videoFeed.srcObject && typeof g.resumeHandLoop === 'function') g.resumeHandLoop();
    return { ok: !!ok, ms: Math.round(performance.now() - t0) };
  }).then(
    (res) => res,
    (e) => {
      console.warn('[gesture-training-ui] hand-tracking warm-up failed:', e);
      return { ok: false, ms: Math.round(performance.now() - t0) };
    }
  );
}

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

// ── Step 1: "Record 3 samples" (video-based gesture capture) ──
// The recording itself (countdown, MediaRecorder, live guidance, review, landmark extraction,
// the 3 saves) lives in js/gesture-capture-ui.js (window.GestureCaptureUI). This file only
// checks the form's preconditions and opens it, and takes the "samples saved" callback back.
function openRecordingMode() {
  const set = selectedSignSet();
  const textEn = currentEnglishText();
  const textFil = currentFilipinoText();
  if (set !== 'FSL' && !textEn) { showToast('Enter the English text first.'); return; }
  if (set !== 'ESL' && !textFil) { showToast('Enter the Filipino text first.'); return; }
  const label = currentKey();
  if (!label) { showToast(`Enter ${set === 'FSL' ? 'the Filipino' : 'the English'} text with at least one letter or number.`); return; }
  if (conflictingSign(label)) { refreshSampleCountLine(); return; }
  if (!window.GestureCaptureUI || typeof window.GestureCaptureUI.open !== 'function') {
    console.error('[gesture-training-ui] GestureCaptureUI is not loaded.');
    return;
  }
  if (typeof window.closeKeyboard === 'function') window.closeKeyboard();
  if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
  const catRadio = document.querySelector('input[name="gestureCategory"]:checked');
  window.GestureCaptureUI.open({
    label,
    signSet: set,
    textEn: set === 'FSL' ? null : textEn,
    textFil: set === 'ESL' ? null : textFil,
    category: catRadio ? catRadio.value : 'word',
    acquireCamera: acquireCaptureCamera,
    releaseCamera: releaseCaptureCamera,
  });
}

// Called once by js/gesture-capture-ui.js when a recording leaves the mode with 1-3 samples saved,
// AFTER window.reloadDataset() has rebuilt savedSampleInfo from the server (so the new samples'
// frames are already counted): res = { label, signLanguage, labelSampleCount } - no frameCount,
// so noteSampleSaved adds 0 frames and only sets the sample count + "Run Train AI" note.
window.onCaptureSamplesSaved = (res) => {
  noteSampleSaved(res);
  refreshSampleCountLine();
};

(function wireRecordButton() {
  const btn = document.getElementById('startGestureDataBtn');
  if (btn) btn.addEventListener('click', openRecordingMode);
})();
