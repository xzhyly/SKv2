// js/gesture-training-ui.js

let stream = null, modelTrained = false, tfModel = null, knnModel = {};
let predictLoop = null;
let currentStep = 1;
let startCount = 0, stopCount = 0;
let isRecordingStart = false, isRecordingStop = false, recordInterval = null;
let translatedWords = [], wordIndex = 0, currentGesture = null, signLang = 'en';
const GESTURE_HOLD_MS = 700;
let customWords = [];
let lastDetected = null, holdStart = null;
let predictionHistory = [];
let activeFeatureSize = 126;
let activeLabels = [];
const EPOCHS = 50;

// Compact-model phase: Steps 2-4 use the compiled model file models/knn_<LANG>.bin, loaded through
// js/knn-model-store.js (IndexedDB cache). Compile (Step 2) builds it in the browser (js/knn-compile.js)
// from a full-sync summary listing plus `labels=` frame batches, and POSTs it to php/api/compile_model.php.
let loadedModel = null;        // { lang, header, labels, source, bytes } of the file knnModel came from, else null
let modelLoadSeq = 0;          // the latest loadModelForLang() call; older results are dropped
let modelStatus = null;        // last php/api/model_status.php answer, null = unknown / unavailable
let modelStatusSeq = 0;
let modelStatusReady = Promise.resolve(null);
let listingGestures = null;    // the last summary listing (no frames): label -> [{file, frameCount, ...}]
let compileRunning = false;
const PI_WARNING = 'Build the model on the laptop, then copy models/knn_ESL.bin and models/knn_FSL.bin to the Pi.';

let currentSentence = [];       // Dito iipunin ang mga nade-detect na salita
let isSentenceActive = false;    // Tracker kung nasa loob ng start/stop block

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
let datasetGroups = null;          // category -> [{label, signSet, textEn, textFil, samples, avatar}], set by renderSavedDataset(); null = no table
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
  ['English text', 'Filipino text', 'Set', 'Samples', 'Avatar', 'Edit', 'Delete'].forEach(t => {
    const th = document.createElement('th'); th.textContent = t; head.appendChild(th);
  });
  const body = table.createTBody();
  if (rows.length === 0) {
    const td = body.insertRow().insertCell();
    td.colSpan = 7; td.className = 'tr-ds-empty';
    td.textContent = query ? 'No matches' : 'No gestures in this category yet.';
  }
  rows.forEach(row => {
    const tr = body.insertRow();
    tr.dataset.key = row.label;
    const en = tr.insertCell(); en.className = 'tr-ds-text'; en.textContent = datasetShownText(row, 'en');
    const fil = tr.insertCell(); fil.className = 'tr-ds-text'; fil.textContent = datasetShownText(row, 'fil');
    const set = tr.insertCell(); set.className = 'tr-ds-c'; set.textContent = signSetName(row.signSet);
    const n = tr.insertCell(); n.className = 'tr-ds-c'; n.textContent = row.samples;
    const av = tr.insertCell(); av.className = 'tr-ds-c tr-ds-avatar' + (row.avatar ? ' yes' : '');
    av.textContent = row.avatar === null ? '?' : row.avatar ? '✓' : '—';
    av.title = row.avatar === null ? 'Unknown' : row.avatar ? 'Has an avatar clip' : 'No avatar clip';
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
    // No model cache to clear any more (compact-model phase): reloadDataset() below refreshes the
    // model status, which reads "Model out of date" for every language whose membership changed.
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

// ── STEP 2 SUMMARY CARD — the selected model's signs + NEW badge ──
// Every sign of the summary listing that belongs in the selected model (KnnCompile.inModel), with
// its row count from the loaded model file's header; a sign with samples that the loaded file
// does not have yet gets a NEW badge ("not compiled yet").
function listingSet(signs, label, samples) {
  const sign = signs && Object.prototype.hasOwnProperty.call(signs, label) ? signs[label] : null;
  return (sign && sign.set) || (samples && samples[0] && samples[0].signLanguage) || 'ESL';
}
function updateUI() {
  const card = document.getElementById('step2SummaryCard');
  if (!card) return;
  if (!listingGestures || !window.KnnCompile) {
    card.innerHTML = '<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center;">No training samples loaded yet.</p>';
    return;
  }
  const lang = modelLanguage();
  const signs = GestureDataRecorder.getSigns() || {};
  const rowsInFile = Object.create(null);
  if (loadedModel && loadedModel.lang === lang) loadedModel.header.labels.forEach(L => { rowsInFile[L.key] = L.rows; });
  const keys = Object.keys(listingGestures).filter(label =>
    KnnCompile.inModel(lang, label, listingSet(signs, label, listingGestures[label]))).sort();
  if (keys.length === 0) {
    card.innerHTML = `<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center;">No ${lang} signs in the saved samples yet.</p>`;
    return;
  }
  const compiled = keys.filter(k => rowsInFile[k] !== undefined).length;
  const head = `<div class="tr-summary-row" style="font-size:11px; color:var(--muted);"><span>${keys.length} ${lang} signs in the saved samples</span><span>${compiled} in the model file</span></div>`;
  card.innerHTML = head + keys.map(label => {
    const nSamples = listingGestures[label].length;
    const rows = rowsInFile[label];
    let right;
    if (rows !== undefined) right = `<span class="tr-summary-val" style="color:var(--navy); font-weight:900;">${rows} rows</span>`;
    else if (nSamples === 0) right = '<span class="tr-summary-val" style="color:var(--muted);">no samples</span>';
    else right = '<span class="tr-summary-val" style="color:#b45309;">not compiled yet</span>';
    const badge = rows === undefined && nSamples > 0 ? ' <span class="tr-new-badge">NEW</span>' : '';
    return `<div class="tr-summary-row" data-key="${escapeHtml(label)}"><span style="display:flex;align-items:center;gap:4px;">${escapeHtml(label.replace(/_/g, ' ').toUpperCase())}${badge}</span>${right}</div>`;
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
  justSavedNote = 'Saved. Run Compile (Step 2) again to use it.';
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
// prefetchedGestures: a summary listing (no frames) already fetched by refreshDataset(); loadError:
// that fetch's error, shown in place of the table. Called with neither, it fetches a summary itself.
async function renderSavedDataset(prefetchedGestures, loadError) {
  const tableWrap = document.getElementById('gestureDatasetTableWrap');
  const datasetCount = document.getElementById('datasetCount');
  if (!tableWrap) return;
  // The modal (trRenderDatasetView) draws the per-category tabs from datasetGroups; tableWrap only
  // carries the empty/error message it falls back to when there is no table to show.
  datasetGroups = null;
  tableWrap.innerHTML = '';
  try {
    if (loadError) throw loadError;
    const gestures = prefetchedGestures || await GestureDataRecorder.loadSavedGestureDataset(false, { summary: true });
    rebuildSampleInfo(gestures); refreshSampleCountLine();
    const labels = Object.keys(gestures);
    datasetCount.textContent = `${labels.length} gestures`;
    if (labels.length === 0) {
      tableWrap.innerHTML = '<p style="font-size:11px; color:var(--muted); font-style:italic; text-align:center; padding:10px;">No saved gestures found.</p>';
      return;
    }
    // Which signs have an avatar clip (signs.php `avatar`; avatar phase). Never fails the table.
    let avatarFlags = null;
    try {
      const res = await fetch('php/api/signs.php', { cache: 'no-cache' });
      const json = await res.json();
      if (json && json.success && json.signs) avatarFlags = json.signs;
    } catch (e) { console.warn('[gesture-training] avatar flags not loaded:', e); }
    // Group by category: stored category wins, else the heuristic's guess.
    const signs = GestureDataRecorder.getSigns();
    const groups = { word: [], letter: [], number: [], phrase: [] };
    labels.forEach(label => {
      const samples = gestures[label];
      const sign = signs && signs[label];
      const signSet = (sign && sign.set) || samples[0]?.signLanguage || 'ESL';
      const stored = storedCategoryFor(label, String(signSet).toUpperCase());
      const category = stored || GestureCategory.guess(label);
      const avatar = avatarFlags ? !!(avatarFlags[label] && avatarFlags[label].avatar) : null;
      (groups[category] || groups.word).push({ label, signSet, textEn: sign && sign.textEn, textFil: sign && sign.textFil, samples: samples.length, avatar });
    });
    Object.keys(groups).forEach(cat => groups[cat].sort((a, b) => a.label.localeCompare(b.label)));
    datasetGroups = groups;
  } catch(err) {
    tableWrap.innerHTML = `<p style="font-size:11px; color:#ef4444; text-align:center; padding:10px;">Error loading dataset: ${escapeHtml(err && err.message)}</p>`;
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
      delete savedSampleInfo[label]; refreshSampleCountLine();
      // Full disk sync (as before), summary listing; then the model status (now out of date).
      await refreshDataset(false);
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

// Sign texts are user input: escape before they go into innerHTML.
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

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

// ── Model file: load (Steps 2-4), status line, Compile (compact-model phase) ──

const fmtInt = (n) => Number(n).toLocaleString('en-US');

// No model in memory: Steps 3/4 locked, Step 2's Next hidden.
function clearLoadedModel() {
  knnModel = {};
  activeLabels = [];
  activeFeatureSize = 126;
  modelTrained = false;
  loadedModel = null;
  refreshStep2Buttons();
}

// Use a KnnModelStore.load() result: exactly the rows of the file (labels in header order).
function applyLoadedModel(lang, res) {
  knnModel = res.model;
  activeLabels = res.labels.slice();
  activeFeatureSize = 126;
  modelTrained = activeLabels.length >= 2;
  loadedModel = { lang, header: res.header, labels: res.labels.slice(), source: res.source, bytes: res.bytes };
  if (typeof GestureDataRecorder.setModelSigns === 'function') GestureDataRecorder.setModelSigns(res.header.labels);
  console.log(`[KNN] ${lang} model: ${res.header.rowCount} rows, ${activeLabels.length} labels (${res.source})`);
  if (!modelTrained) console.warn(`[KNN] ${lang} model has ${activeLabels.length} label(s); at least 2 are needed for Steps 3 and 4`);
  refreshStep2Buttons();
}

// Loads models/knn_<lang>.bin for Steps 2-4. A stored copy used only because the server's file is
// missing or broken ('cache-fallback') is accepted on the Pi (keep the last good file, as the
// kiosk does) but not on the laptop, where the answer is to run Compile. Resolves true/false.
async function loadModelForLang(lang) {
  const seq = ++modelLoadSeq;
  clearLoadedModel();
  updateUI();
  let res = null, why = null;
  try {
    if (!window.KnnModelStore) throw new Error('js/knn-model-store.js is not loaded');
    res = await KnnModelStore.load(lang);
    if (res.source === 'cache-fallback') {
      const st = await modelStatusReady;
      if (!st || st.device !== 'pi') { why = 'the model file on the server is missing or cannot be read'; res = null; }
    }
  } catch (e) {
    why = e && e.message ? e.message : String(e);
  }
  if (seq !== modelLoadSeq || modelLanguage() !== lang) return false;   // a newer load or another language won
  if (!res) {
    console.warn(`[KNN] ${lang} model not loaded: ${why}`);
  } else {
    applyLoadedModel(lang, res);
  }
  updateTrPills(currentStep);
  updateUI();
  return !!res && modelTrained;
}

// GET php/api/model_status.php and redraw the status line. Resolves the answer, or null when it is
// unavailable (one console.warn). Never rejects.
function refreshModelStatus() {
  const seq = ++modelStatusSeq;
  const p = fetch('php/api/model_status.php', { cache: 'no-store' })
    .then((res) => res.json().then((j) => {
      if (!res.ok || !j || j.success !== true) throw new Error((j && j.error) || `HTTP ${res.status}`);
      return j;
    }))
    .then((j) => j, (e) => { console.warn('[gesture-training] model status unavailable:', e); return null; })
    .then((j) => {
      if (seq === modelStatusSeq) { modelStatus = j; renderModelStatus(); }
      return j;
    });
  modelStatusReady = p;
  return p;
}

// "<LANG> model: <rows> rows, <labels> signs, built <date> — up to date" / "Model out of date: run
// Compile" / "No model file: run Compile". On the Pi: Compile disabled, the warning shown, no
// out-of-date text (the Pi lacks the bulk samples by design, so it cannot judge).
function renderModelStatus() {
  const line = document.getElementById('modelStatusLine');
  const warn = document.getElementById('modelPiWarning');
  const lang = modelLanguage();
  const onPi = !!(modelStatus && modelStatus.device === 'pi');
  if (warn) warn.hidden = !onPi;
  refreshStep2Buttons();
  if (!line) return;
  let text, stale = false;
  const m = modelStatus && modelStatus.models ? modelStatus.models[lang] : null;
  if (!modelStatus) { text = 'Model status unavailable'; stale = true; }
  else if (!m || !m.exists) { text = onPi ? 'No model file' : 'No model file: run Compile'; stale = true; }
  else if (m.stale) { text = 'Model out of date: run Compile'; stale = true; }
  else if (!m.header) { text = `${lang} model file cannot be read`; stale = true; }
  else {
    const h = m.header;
    const built = h.buildDate ? new Date(h.buildDate).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'at an unknown time';
    text = `${lang} model: ${fmtInt(h.rowCount)} rows, ${fmtInt(h.labelCount)} signs, built ${built}` + (onPi ? '' : ' — up to date');
  }
  line.textContent = text;
  line.classList.toggle('stale', stale);
}

// Compile is off while it runs and on the Pi; Next shows only with a usable model in memory.
function refreshStep2Buttons() {
  const btn = document.getElementById('trainBtn');
  const next = document.getElementById('step2NextBtn');
  const onPi = !!(modelStatus && modelStatus.device === 'pi');
  if (btn) {
    btn.disabled = compileRunning || onPi;
    btn.textContent = compileRunning ? 'Compiling…' : 'Compile';
  }
  if (next) next.style.display = modelTrained && !compileRunning ? 'flex' : 'none';
}

// #trainBtn's handler: the Step 2 model-language radios are locked while Compile runs (it reads
// the choice at the start and loads that language's file at the end), and always re-enabled.
async function compileModelGuarded() {
  if (compileRunning) return;
  const radios = document.querySelectorAll('input[name="trainModelLang"]');
  radios.forEach(r => { r.disabled = true; });
  try {
    await compileModel();
  } finally {
    radios.forEach(r => { r.disabled = false; });
  }
}

const COMPILE_STAGES = 5;
const COMPILE_BATCH_SAMPLES = 60;   // samples with frames per save_gesture.php request (one bigger sign: alone)
const COMPILE_BATCH_SIGNS = 200;    // the endpoint's labels= limit
function compileFail(message) { const e = new Error(message); e.compileMessage = true; return e; }

// Compile (replaces trainModel's incremental merge): model_status (refused on the Pi) -> full-sync
// summary listing (no frames; fingerprint) -> frames a batch of signs at a time
// (save_gesture.php?no_sync=1&labels=...) into KnnCompile.createBuilder -> encode -> POST
// php/api/compile_model.php?lang=L -> KnnModelStore.load(L), so the page uses exactly the written file.
async function compileModel() {
  const lang = modelLanguage();
  const log = document.getElementById('trainLog');
  const epochBar = document.getElementById('epochBar');
  const epochLabel = document.getElementById('epochLabel');
  const addLog = (msg, cls = '') => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg;
    log.appendChild(span); log.appendChild(document.createTextNode('\n'));
    log.scrollTop = log.scrollHeight;
  };
  const stage = async (n, text) => {
    epochBar.style.width = Math.round(((n - 1) / COMPILE_STAGES) * 100) + '%';
    epochLabel.textContent = `${n} of ${COMPILE_STAGES}: ${text}…`;
    await new Promise(r => setTimeout(r, 0));   // let the bar paint between stages
  };
  const file = `models/knn_${lang}.bin`;
  const t0 = performance.now();
  compileRunning = true;
  refreshStep2Buttons();
  log.textContent = '';
  addLog(`Compiling the ${lang} model…`, 'log-warn');
  try {
    await stage(1, 'Checking the device');
    const st = await refreshModelStatus();
    if (!st) throw compileFail('Compile failed: the model status (php/api/model_status.php) could not be read');
    if (st.device === 'pi') throw compileFail(PI_WARNING);

    await stage(2, 'Reading the sample list');
    // ONE summary listing (no frames) WITH the disk-to-DB sync: labels, sample files, signs,
    // categories. The full listing with frames runs PHP out of memory at ~732 v3 samples, so the
    // frames are read below a batch of signs at a time.
    let summary;
    try {
      summary = await GestureDataRecorder.loadSavedGestureDataset(false, { summary: true });
    } catch (e) {
      throw compileFail(`Compile failed: the sample list could not be loaded (${e.message})`);
    }
    // The listing's own signs/categories, copied at once (a later loadSigns() would merge
    // signs.php into the same state), so the fingerprint matches model_status.php's.
    const signs = Object.assign({}, GestureDataRecorder.getSigns());
    const cats = GestureDataRecorder.getSavedCategories() || {};
    const categories = { ESL: Object.assign({}, cats.ESL), FSL: Object.assign({}, cats.FSL) };
    listingGestures = summary;
    const fpText = KnnCompile.fingerprintText(summary, signs, lang);

    // The signs with at least one in-model sample file, and the files the summary listed.
    const inModelFiles = Object.create(null);   // label -> Set of `file`
    Object.keys(summary).sort().forEach(label => {
      const files = summary[label].filter(s => KnnCompile.inModel(lang, label, listingSet(signs, label, [s]))).map(s => s.file);
      if (files.length) inModelFiles[label] = new Set(files);
    });
    const todo = Object.keys(inModelFiles);
    if (todo.length < 2) throw compileFail('Add at least 2 signs before compiling');
    const batches = [];
    let cur = [], curSamples = 0;
    todo.forEach(label => {
      const n = inModelFiles[label].size;
      if (cur.length && (curSamples + n > COMPILE_BATCH_SAMPLES || cur.length >= COMPILE_BATCH_SIGNS)) { batches.push(cur); cur = []; curSamples = 0; }
      cur.push(label); curSamples += n;
    });
    if (cur.length) batches.push(cur);

    await stage(3, `Reading samples 0/${todo.length} signs`);
    const builder = KnnCompile.createBuilder({ signs, categories, lang, toRows: GestureDataRecorder.recordingToFeatureRows });
    const batchLog = [];
    let doneSigns = 0, missing = 0;
    for (let b = 0; b < batches.length; b++) {
      const keys = batches[b];
      let res, text;
      try {
        res = await fetch(`php/api/save_gesture.php?no_sync=1&labels=${keys.map(encodeURIComponent).join(',')}`);
        text = await res.text();
      } catch (e) {
        throw compileFail(`Compile failed: the server could not be reached (${e.message})`);
      }
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* not JSON: a PHP error page */ }
      if (!json || json.success !== true || !json.gestures) {
        const detail = json && typeof json.error === 'string' && json.error ? json.error : text.slice(0, 200);
        throw compileFail(`Compile failed reading samples (HTTP ${res.status}): ${detail}`);
      }
      let nSamples = 0;
      keys.forEach(label => {
        const want = inModelFiles[label];
        // Only the files of the summary, so a sample saved during Compile cannot make the rows and
        // the fingerprint disagree.
        const samples = (json.gestures[label] || []).filter(s => want.has(s.file));
        missing += want.size - samples.length;
        nSamples += samples.length;
        builder.addSign(label, samples);
      });
      batchLog.push({ signs: keys.length, samples: nSamples, bytes: text.length });
      json = null; text = null;   // drop this batch's frames before the next request
      doneSigns += keys.length;
      addLog(`// Read ${doneSigns}/${todo.length} signs (request ${b + 1} of ${batches.length}: ${keys.length} signs, ${nSamples} samples)`);
      epochBar.style.width = Math.round(((2 + doneSigns / todo.length) / COMPILE_STAGES) * 100) + '%';
      epochLabel.textContent = `3 of ${COMPILE_STAGES}: Reading samples ${doneSigns}/${todo.length} signs…`;
      await new Promise(r => setTimeout(r, 0));
    }
    if (missing) addLog(`// ${missing} sample file(s) disappeared while compiling: run Compile again.`, 'log-warn');

    const built = builder.finish();
    const header = built.header;
    if (header.labels.length < 2) throw compileFail('Add at least 2 signs before compiling');
    header.fingerprint = await KnnCompile.sha256Hex(fpText);
    const buffer = KnnCompile.encode(header, built.model);
    addLog(`// ${lang}: ${header.labels.length} signs, ${fmtInt(header.sampleCount)} samples, ${fmtInt(header.rowCount)} rows (budget ${header.rule.budget} rows per sign)`);
    addLog(`// Signs: ${header.labels.map(L => L.key).join(', ')}`);

    await stage(4, `Saving ${file}`);
    let res;
    try {
      res = await fetch(`php/api/compile_model.php?lang=${lang}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer,
      });
    } catch (e) {
      throw compileFail(`Compile failed: the server could not be reached (${e.message})`);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON: a PHP warning in front, or no PHP at all */ }
    if (!json || typeof json !== 'object' || json.success !== true) {
      const detail = json && typeof json.error === 'string' && json.error ? json.error : text.slice(0, 200);
      throw compileFail(`Compile failed (HTTP ${res.status}): ${detail}`);
    }
    addLog(`// Wrote ${file}: ${fmtInt(json.bytes)} bytes, fingerprint ${String(json.fingerprint).slice(0, 12)}…`);
    if (json.upToDate === false) addLog('// The samples changed while compiling: run Compile again.', 'log-warn');

    await stage(5, 'Loading the saved file');
    let loaded;
    try {
      loaded = await KnnModelStore.load(lang);
      if (loaded.header.buildDate !== header.buildDate || loaded.header.fingerprint !== header.fingerprint) {
        await KnnModelStore.remove(lang);   // a stored copy that is not the new file: fetch it again
        loaded = await KnnModelStore.load(lang);
      }
    } catch (e) {
      throw compileFail(`Compile wrote ${file}, but loading it failed: ${e.message}`);
    }
    if (loaded.source === 'cache-fallback' || loaded.header.buildDate !== header.buildDate) {
      throw compileFail(`Compile wrote ${file}, but the page could not load that file back`);
    }
    modelLoadSeq++;                 // drop any older load still running
    applyLoadedModel(lang, loaded);
    const ms = Math.round(performance.now() - t0);
    addLog(`// Loaded ${file} (${loaded.source}): ${fmtInt(loaded.header.rowCount)} rows, ${loaded.labels.length} signs`, 'log-ok');
    addLog(`Compile complete in ${(ms / 1000).toFixed(1)} s. Click Next to test your signs.`, 'log-ok');
    epochBar.style.width = '100%';
    epochLabel.textContent = `Complete! — ${fmtInt(loaded.header.rowCount)} rows, ${loaded.labels.length} signs`;
    showToast(`✅ ${lang} model compiled: ${loaded.labels.length} signs. Click Next →`);
    window.lastCompile = { lang, ok: true, ms, bytes: json.bytes, rowCount: loaded.header.rowCount, labels: loaded.labels.length, sampleCount: loaded.header.sampleCount, fingerprint: loaded.header.fingerprint, batches: batchLog };
  } catch (e) {
    const msg = e && e.compileMessage ? e.message : `Compile failed: ${e && e.message ? e.message : e}`;
    addLog(msg, 'log-err');
    showToast(msg, 6000);
    epochBar.style.width = '0%';
    epochLabel.textContent = 'Not compiled';
    window.lastCompile = { lang, ok: false, ms: Math.round(performance.now() - t0), error: msg };
  } finally {
    compileRunning = false;
    refreshStep2Buttons();
    updateTrPills(currentStep);
    updateUI();
    await refreshModelStatus();
  }
}

// The model toggle changed (or was reset): show that language's status and load its file.
function onModelLanguageChanged() {
  renderModelStatus();
  return loadModelForLang(modelLanguage());
}

// Each time Step 2 is shown the toggle starts from Step 1's set (Both -> ESL).
function syncModelToggleToStep1() {
  const want = selectedSignSet() === 'FSL' ? 'FSL' : 'ESL';
  const r = document.querySelector(`input[name="trainModelLang"][value="${want}"]`);
  if (!r || r.checked) return;
  r.checked = true;
  onModelLanguageChanged();
}

// One summary listing (no frames) for the Step 1 table and the Step 2 card, then the model status.
async function refreshDataset(noSync) {
  await refreshDatasetNoStatus(noSync);
  await refreshModelStatus();
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
              document.getElementById('tlHistory').innerHTML = `<span class="tl-word">${escapeHtml(finalSentence)}</span>`;
              document.getElementById('tlBigOutput').innerHTML = `<span class="word">${escapeHtml(finalSentence)}</span>`;
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
            
            document.getElementById('tlHistory').innerHTML = currentSentence.map(w => `<span class="tl-word">${escapeHtml(w)}</span>`).join(' ');
            document.getElementById('tlBigOutput').innerHTML = currentSentence.map(w => `<span class="word">${escapeHtml(w)}</span>`).join(' ') + '...';
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
    `<span class="tr-chip">${escapeHtml(w)}<button type="button" onclick="removeCustomWord(${i})">✕</button></span>`
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
  hist.innerHTML=translatedWords.map(w=>w.type==='stop'?'<span class="tl-word stop-word">⏸</span>':`<span class="tl-word">${escapeHtml(getTranslatedWordText(w, signLang))}</span>`).join(' ');
  hist.scrollTop=hist.scrollHeight;
  const words=translatedWords.filter(w=>w.type!=='stop').map(w=>getTranslatedWordText(w, signLang));
  big.innerHTML=words.length?words.map(w=>`<span class="word">${escapeHtml(w)}</span>`).join(' '):'<span class="tl-big-empty">Show your start gesture to begin.</span>';
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
  if(step>=3&&!modelTrained){showToast('Compile the model first in Step 2!');return;}
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
  if(step>=3&&!modelTrained){showToast('Compile the model first in Step 2!');return;}
  showStepInstruction(step);
}

function trClickPill(step){
  if(step>=3&&!modelTrained){showToast('Compile the model first in Step 2!');return;}
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

// Export Data: the loaded model file's rows as { label: rows } (labels in header order), the same
// shape the old training export had.
document.getElementById('downloadBtn').addEventListener('click',()=>{
  if (!loadedModel) { showToast('No model file loaded: run Compile (Step 2) first.'); return; }
  const out = {};
  loadedModel.labels.forEach(label => { out[label] = knnModel[label]; });
  const blob=new Blob([JSON.stringify(out)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='siningkamay-training.json';a.click();
  showToast(`📥 ${loadedModel.lang} model rows exported (${loadedModel.labels.length} signs)!`);
});

// Load Saved: retired (compact-model phase). The model is built only by Compile, from the saved samples.
document.getElementById('loadBtn').addEventListener('click',()=>{
  showToast('Loading a training file is no longer used: Compile builds the model from the saved samples.', 5000);
});

document.getElementById('wordInput').addEventListener('keydown',e=>{if(e.key==='Enter')addCustomWord();});

// After a save (js/gesture-capture-ui.js) or a dataset-modal edit: one summary listing, then the
// model status (a new sample makes the model of its set out of date).
window.reloadDataset = async () => {
  // no_sync: the save that triggered this reload already wrote disk and the gesture_recordings
  // row directly (save_gesture.php's POST branch calls save_gesture_recording_to_db, not
  // sync_disk_to_db), so re-walking every label folder here is redundant (finding 10).
  // DOMContentLoaded, below, keeps the full synced fetch: disk could have been touched outside
  // the app between page loads, and that path is not on the per-save critical path.
  await refreshDataset(true);
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

  warmUpHandTracking();
  // The model file of the selected language (Steps 2-4), its status, and ONE summary listing
  // (full disk sync, no frames) for the Step 1 table and the Step 2 card, side by side.
  const status = refreshModelStatus();
  const model = loadModelForLang(modelLanguage());
  await Promise.all([status, model, refreshDatasetNoStatus(false)]);
});

// The startup listing: refreshDataset without its own model_status request (startup has one).
async function refreshDatasetNoStatus(noSync) {
  let gestures = null, error = null;
  try {
    gestures = await GestureDataRecorder.loadSavedGestureDataset(noSync, { summary: true });
  } catch (e) {
    error = e;
    console.warn('[gesture-training] dataset listing failed:', e);
  }
  listingGestures = gestures;
  await renderSavedDataset(gestures || undefined, error || undefined);
  updateUI();
}

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
// so noteSampleSaved adds 0 frames and only sets the sample count + "Run Compile" note.
window.onCaptureSamplesSaved = (res) => {
  noteSampleSaved(res);
  refreshSampleCountLine();
};

(function wireRecordButton() {
  const btn = document.getElementById('startGestureDataBtn');
  if (btn) btn.addEventListener('click', openRecordingMode);
})();
