// js/sign-to-text-ui.js

let stream = null, modelTrained = false, tfModel = null, knnModel = null;
let currentStep = 4; // standalone translator behaves as step 4
const trainData = { start: [], stop: [] };
let translatedWords = [], wordIndex = 0, currentGesture = null, signLang = 'en';
const GESTURE_HOLD_MS = 500;
let customWords = [];
let lastDetected = null, holdStart = null;
let predictionHistory = [];
let savedGestureSamplesMerged = false;
let lastLoadedLanguage = null;
let activeFeatureSize = 126;
let activeLabels = ['start', 'stop'];
const EPOCHS = 50;

// Temporal Smoothing & Debounce State Variables
let rollingHistory = [];
const ROLLING_WINDOW_SIZE = 4; // Check last 4 predictions (~600ms window)
let lastConfirmedGesture = null;
let gestureStabilityTicks = 0;
const STABILITY_THRESHOLD = 2; // Must be identical for 2 consecutive prediction cycles (300ms) to trigger visual gets or word draft

let currentSentence = [];       // Dito iipunin ang mga nade-detect na salita
let isSentenceActive = false;    // Tracker kung nasa loob ng start/stop block

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

function showToast(message, duration = 3000) {
  const toast = document.getElementById('sk-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(window.skToastTimeout);
  window.skToastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
  }, duration);
}
window.showToast = showToast;



function jitterFeatures(features,amount=0.015){return features.map(v=>v+((Math.random()*2-1)*amount))}

async function mergeSavedGestureSamples() {
  const targetLang = signLang === 'fil' ? 'FSL' : 'ESL';
  if (savedGestureSamplesMerged && lastLoadedLanguage === targetLang) return;
  if (typeof window.loadGestureDatasetForTraining !== 'function') return;
  try {
    const rows = await window.loadGestureDatasetForTraining(true); // Pass true to skip heavy PHP disk-to-db syncs
    // Reset trainData so we don't duplicate on reload
    for (const key in trainData) {
      if (key !== 'start' && key !== 'stop') delete trainData[key];
    }
    trainData.start = [];
    trainData.stop = [];
    
    let loadedCount = 0;
    rows.forEach(({label,features,signLanguage}) => {
      const itemLang = signLanguage || 'ESL';
      // Load if language matches OR if it's the control gestures 'start' or 'stop' (shared across languages)
      if (itemLang === targetLang || (label === 'start' || label === 'stop')) {
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
        
        const cachedKnnRaw = localStorage.getItem(`sining_kamay_knn_${targetLang}`);
        if (cachedKnnRaw) {
          const cachedKnn = JSON.parse(cachedKnnRaw);
          const totalCachedFrames = Object.values(cachedKnn).flat().length;
          const totalDbFrames = loadedCount;
          
          if (validCached.length !== cachedLabels.length || totalCachedFrames !== totalDbFrames) {
            console.log(`[KNN] Cache mismatch (Labels: ${validCached.length} vs ${cachedLabels.length}, Frames: ${totalCachedFrames} vs DB ${totalDbFrames}). Rebuilding model...`);
            localStorage.removeItem(`sining_kamay_knn_${targetLang}`);
            localStorage.removeItem(`sining_kamay_labels_${targetLang}`);
            knnModel = null;
            activeLabels = ['start', 'stop'];
            modelTrained = false;
            
            // Rebuild model from DB directly
            const rebuiltKnn = {};
            const rebuiltLabels = [];
            for (const label in trainData) {
              const allFrames = trainData[label].filter(f => Array.isArray(f) && f.length === 126);
              if (allFrames.length > 0) {
                rebuiltKnn[label] = allFrames;
                rebuiltLabels.push(label);
              }
            }
            if (rebuiltLabels.length >= 2) {
              knnModel = rebuiltKnn;
              activeLabels = rebuiltLabels;
              modelTrained = true;
              try {
                localStorage.setItem(`sining_kamay_knn_${targetLang}`, JSON.stringify(knnModel));
                localStorage.setItem(`sining_kamay_labels_${targetLang}`, JSON.stringify(activeLabels));
              } catch (e) {
                console.warn("[KNN] LocalStorage quota exceeded. Using in-memory model instead:", e);
              }
              console.log(`[KNN] Model rebuilt successfully from DB.`, activeLabels);
            }
          } else {
            // Cache is up to date, load it
            knnModel = cachedKnn;
            activeLabels = validCached;
            modelTrained = true;
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
    const dot = document.getElementById('tlDbStatusDot');
    if (dot) {
      dot.classList.remove('connected');
      dot.title = "Database connection error: " + err.message;
    }
  }
}

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
      
      if (typeof window.extractLandmarkFeatures === 'function' && size !== 126) {
        console.warn(`[KNN] Cached model has feature size ${size} but landmarks (126) are supported. Discarding cache.`);
        localStorage.removeItem(`sining_kamay_knn_${targetLang}`);
        localStorage.removeItem(`sining_kamay_labels_${targetLang}`);
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

async function buildKnnFromDatabase(targetLang) {
  await mergeSavedGestureSamples();
  const localKnn = {};
  const labels = [];
  
  for (const label in trainData) {
    const allFrames = trainData[label].filter(f => Array.isArray(f) && f.length === 126);
    if (allFrames.length > 0) {
      localKnn[label] = allFrames;
      labels.push(label);
    }
  }
  
  if (labels.length >= 2) {
    knnModel = localKnn;
    activeLabels = labels;
    activeFeatureSize = 126;
    modelTrained = true;
    
    try {
      localStorage.setItem(`sining_kamay_knn_${targetLang}`, JSON.stringify(knnModel));
      localStorage.setItem(`sining_kamay_labels_${targetLang}`, JSON.stringify(activeLabels));
    } catch (e) {
      console.warn("[KNN] LocalStorage quota exceeded. Using in-memory model instead:", e);
    }
    console.log(`[KNN] Successfully compiled model from DB for ${targetLang}. Labels:`, activeLabels);
    return true;
  }
  
  console.warn(`[KNN] Could not compile model from DB: less than 2 valid gesture labels found.`);
  return false;
}

async function autoTrainForTranslate() {
  if (modelTrained) return true;
  const targetLang = signLang === 'fil' ? 'FSL' : 'ESL';
  
  if (loadKnnFromCache(targetLang)) {
    return true;
  }
  
  return await buildKnnFromDatabase(targetLang);
}

// ══════════════════════════════════════════════════════════
// TRANSLATE-ONLY UI STATE MACHINE
// ══════════════════════════════════════════════════════════
let tlUiState='idle',tlWords=[],tlWordIndex=0;
let tlCurrentGesture=null,tlLastDetected=null,tlHoldStart=null;
let tlPredHistory=[],tlPredLoop=null,tlStream=null,tlModelReady=false;

window.hasModelEverLoaded = false;

async function tlLoadModelForActiveLanguage() {
  tlModelReady = false;
  modelTrained = false;
  knnModel = null;
  
  const dot = document.getElementById('tlDbStatusDot');
  const b1 = document.getElementById('tlTranslateBtn1');
  const overlay = document.getElementById('tlAiLoadingOverlay1');
  
  if (overlay) {
    overlay.style.display = 'flex';
    const label = overlay.querySelector('p');
    if (label) {
      label.textContent = window.hasModelEverLoaded ? 'AI is switching language...' : 'AI is getting ready...';
    }
  }
  if (b1) {
    b1.disabled = true;
    b1.innerHTML = '⏳ SWITCHING AI...';
  }
  
  const targetLang = signLang === 'fil' ? 'FSL' : 'ESL';
  console.log(`Switching model to ${targetLang}...`);
  
  const trained = await autoTrainForTranslate();
  tlModelReady = trained;
  
  if (overlay) overlay.style.display = 'none';
  
  if (dot) {
    if (trained) {
      dot.classList.add('connected');
      dot.title = `Database connected & ${targetLang} model ready!`;
    } else {
      dot.classList.remove('connected');
      dot.title = `Database connection or ${targetLang} model training failed.`;
    }
  }
  
  if (b1 && tlUiState === 'idle') {
    b1.disabled = false;
    b1.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> START';
  }
  
  if (trained) {
    window.hasModelEverLoaded = true;
    showToast(`🟢 ${targetLang} AI Model Ready! Show "Start" sign or click START.`);
  } else {
    showToast(`⚠️ ${targetLang} AI loading failed. Manual translation active.`);
  }
}

async function tlInitCamera(){
  initCameraWithFallback(
    320,
    240,
    async (s) => {
      tlStream = s;
      const v1 = document.getElementById('tlVideo1');
      const v2 = document.getElementById('tlVideo2');
      if (v1) v1.srcObject = tlStream;
      if (v2) v2.srcObject = tlStream;
      if (v1) v1.classList.add('active');
      const p1 = document.getElementById('tlPlaceholder1');
      if (p1) p1.style.display = 'none';
      stream = tlStream;
      if (window.GestureDataRecorder && typeof window.GestureDataRecorder.setupMediaPipe === 'function') {
        window.GestureDataRecorder.setupMediaPipe(v1);
      }
      
      // Initialize idle state immediately to activate overlays & start pred loop
      tlSetState('idle');
      
      // Load model for active language
      tlLoadModelForActiveLanguage();
    },
    (err, msg) => {
      console.error("tlInitCamera Fail:", err);
      showToast(msg, 5000);
    }
  );
}

function tlUpdateOverlays(emoji,label){
  const e1 = document.getElementById('tlPredEmoji1');
  const l1 = document.getElementById('tlPredLabel1');
  if (e1) e1.textContent=emoji;
  if (l1) l1.textContent=label;
  
  const e2 = document.getElementById('tlPredEmoji2');
  const l2 = document.getElementById('tlPredLabel2');
  if (e2) e2.textContent=emoji;
  if (l2) l2.textContent=label;
}

function tlStartPredLoop(){
  clearInterval(tlPredLoop);tlPredHistory=[];
  let tlLastHandTime = Date.now();
  const o1 = document.getElementById('tlPredOverlay1');
  const o2 = document.getElementById('tlPredOverlay2');
  if (o1) o1.classList.add('show');
  if (o2) o2.classList.add('show');
  console.log("Starting tlStartPredLoop: tlStream =", !!tlStream, "modelTrained =", modelTrained, "knnModel =", !!knnModel);
  tlPredLoop=setInterval(async()=>{
    if(!tlStream||!modelTrained||!knnModel){
      console.warn("Kiosk prediction loop skipped: stream =", !!tlStream, "modelTrained =", modelTrained, "knnModel =", !!knnModel);
      return;
    }
    try{
      const hasHand = window.GestureDataRecorder && typeof window.GestureDataRecorder.getLatestLandmarks === 'function' && window.GestureDataRecorder.getLatestLandmarks();
      if (!hasHand) {
        if (Date.now() - tlLastHandTime > 300) {
          tlUpdateOverlays('—', 'Show your sign');
          const dots = document.querySelectorAll('.status-dot');
          dots.forEach(dot => { dot.className = 'status-dot searching'; });
          
          // Clear rolling history when no hands are present to keep transitions clean
          rollingHistory = [];
          lastConfirmedGesture = null;
          gestureStabilityTicks = 0;
          
          // Reset hold and sequence tracking states on hand loss
          tlLastDetected = null;
          tlHoldStart = null;
          tlCurrentGesture = null;
        }
        return;
      }
      tlLastHandTime = Date.now();
      const f=extractFeatures(document.getElementById('tlVideo1'));
      if(!Array.isArray(f)||f.length!==activeFeatureSize){
        console.warn("Kiosk prediction loop skipped: feature size mismatch. f.length =", f ? f.length : 0, "activeFeatureSize =", activeFeatureSize);
        return;
      }
      
      const prediction = knnPredict(f);
      if (!prediction) return;
      
      // DIAGNOSTIC LOG (throttled to print once every 10 ticks / 1.5 seconds to avoid flooding)
      if (!window.predLogTick) window.predLogTick = 0;
      window.predLogTick++;
      if (window.predLogTick % 10 === 0) {
        const rawLm = window.GestureDataRecorder && typeof window.GestureDataRecorder.getLatestLandmarks === 'function' ? window.GestureDataRecorder.getLatestLandmarks() : 'no fn';
        console.log(`[KNN PREDICT] Best: "${prediction.label}" Conf: ${prediction.confidence.toFixed(3)}`, prediction.scores);
        console.log(`[KNN FEATURE DEBUG] First 5 of f:`, f.slice(0, 5), `Raw LM exists:`, !!rawLm, `Raw LM len:`, rawLm ? rawLm.length : 0);
        if (prediction.label) {
          console.log(`[KNN FULL f FOR '${prediction.label}']`, JSON.stringify(f));
        }
      }
      
      // ── 1. ROLLING TEMPORAL FILTER (WINDOW SIZE = 4) ──
      rollingHistory.push({ label: prediction.label, confidence: prediction.confidence, scores: prediction.scores });
      if (rollingHistory.length > ROLLING_WINDOW_SIZE) {
        rollingHistory.shift();
      }
      
      // Compute weighted average scores across history (newer predictions have higher weight)
      const labelWeights = {};
      rollingHistory.forEach((pred, index) => {
        const weight = (index + 1) / ROLLING_WINDOW_SIZE;
        for (const [lbl, score] of Object.entries(pred.scores)) {
          labelWeights[lbl] = (labelWeights[lbl] || 0) + (score * weight);
        }
      });
      
      // Find label with highest smoothed score
      let smoothedLabel = 'unknown';
      let maxWeight = 0;
      for (const [lbl, weight] of Object.entries(labelWeights)) {
        if (weight > maxWeight) {
          maxWeight = weight;
          smoothedLabel = lbl;
        }
      }
      
      const totalHistoryWeights = rollingHistory.reduce((sum, _, idx) => sum + ((idx + 1) / ROLLING_WINDOW_SIZE), 0);
      const avgConf = maxWeight / (totalHistoryWeights || 1);
      
      // ── 2. STABILITY DEBOUNCE (2 CONSECUTIVE TICKS / 300ms) ──
      let confirmedLabel = 'unknown';
      if (smoothedLabel !== 'unknown' && avgConf > 0.45) {
        if (smoothedLabel === lastConfirmedGesture) {
          gestureStabilityTicks++;
          if (gestureStabilityTicks >= STABILITY_THRESHOLD) {
            confirmedLabel = smoothedLabel;
          }
        } else {
          lastConfirmedGesture = smoothedLabel;
          gestureStabilityTicks = 1;
        }
      } else {
        lastConfirmedGesture = null;
        gestureStabilityTicks = 0;
      }
      
      // ── 3. UPDATE UI INDICATORS ──
      const dots = document.querySelectorAll('.status-dot');
      if (confirmedLabel !== 'unknown') {
        const cleanLabel = String(confirmedLabel || "").trim().toLowerCase().replace(/\s+/g, "_");
        const emoji = SIGN_TRANSLATIONS[cleanLabel]?.emoji || (confirmedLabel==='start'?'▶':confirmedLabel==='stop'?'⏹':'🤟');
        const displayWord = translateGestureLabel(confirmedLabel, signLang);
        tlUpdateOverlays(emoji, `Gets: ${displayWord}`);
        
        dots.forEach(dot => {
          dot.className = 'status-dot active-gets'; // Turns Green
        });
      } else {
        tlUpdateOverlays('—', smoothedLabel !== 'unknown' ? 'Stabilizing...' : 'Searching...');
        dots.forEach(dot => {
          dot.className = 'status-dot searching'; // Turns Red
        });
      }

      // ── 4. CONVERSATIONAL ACCUMULATION FLOW ──
      if((tlUiState==='recording' || tlUiState==='idle') && confirmedLabel !== 'unknown'){
        // A. Idle State -> Listen for 'start' gesture to trigger countdown
        if(tlUiState==='idle'){
          if(confirmedLabel==='start'){
            if(confirmedLabel!==tlLastDetected){tlLastDetected=confirmedLabel;tlHoldStart=Date.now();return;}
            if(Date.now()-tlHoldStart<GESTURE_HOLD_MS)return;
            
            tlCurrentGesture='start';
            tlLastDetected=null; tlHoldStart=null;
            
            // Reset history to prevent immediate repeat triggers
            rollingHistory = [];
            lastConfirmedGesture = null;
            gestureStabilityTicks = 0;
            
            tlHandleTranslate(); // Trigger countdown manually
          } else {
            tlLastDetected = null;
            tlHoldStart = null;
          }
        }
        // B. Recording State -> Listen for 'stop' and 'custom' gestures
        else if(tlUiState==='recording'){
          if(confirmedLabel!==tlLastDetected){tlLastDetected=confirmedLabel;tlHoldStart=Date.now();return;}
          if(Date.now()-tlHoldStart<GESTURE_HOLD_MS)return;
          
          if(confirmedLabel==='stop'&&tlCurrentGesture!=='stop'){
            tlCurrentGesture='stop';
            tlLastDetected=null; tlHoldStart=null;
            
            // Reset history
            rollingHistory = [];
            lastConfirmedGesture = null;
            gestureStabilityTicks = 0;
            
            await tlProcessAndFinishSentence();
            tlSetState('result');
            showToast(signLang==='fil'?'⏹ Katapusan ng Pangungusap':'⏹ End of Sentence');
          }
          else if(confirmedLabel!=='start'&&confirmedLabel!=='stop'&&tlCurrentGesture!==confirmedLabel){
            tlCurrentGesture=confirmedLabel;
            const word = translateGestureLabel(confirmedLabel, signLang);
            currentSentence.push(word);
            
            // Ipakita agad ang naiipong mga salita sa screen bilang real-time draft
            document.getElementById('tlOutputBox').innerHTML = `<span class="tl-out-word">${currentSentence.join(' ')}...</span>`;
            showToast(`+ Added "${word}"`);
            tlLastDetected=null; tlHoldStart=null;
            
            // Reset rolling history to prevent immediate re-triggering of the same word
            rollingHistory = [];
            lastConfirmedGesture = null;
            gestureStabilityTicks = 0;
          } else {
            tlLastDetected = null;
            tlHoldStart = null;
          }
        }
      } else {
        tlLastDetected = null;
        tlHoldStart = null;
      }
    }catch(e){
      console.error("Prediction loop exception:", e);
    }
  },150);
}

function tlStopPredLoop(){
  clearInterval(tlPredLoop);
  const o1 = document.getElementById('tlPredOverlay1');
  const o2 = document.getElementById('tlPredOverlay2');
  if (o1) o1.classList.remove('show');
  if (o2) o2.classList.remove('show');
}

function tlRenderOutput(){
  const box=document.getElementById('tlOutputBox');
  const words=tlWords.filter(w=>w.type!=='stop').map(w=>getTranslatedWordText(w, signLang));
  box.innerHTML=words.length?words.map(w=>`<span class="tl-out-word">${w}</span>`).join(' '):'<span class="tl-out-empty">Translation will appear here…</span>';
}

async function tlProcessAndFinishSentence() {
  isSentenceActive = false;
  window.isSentenceActive = false;
  
  const box = document.getElementById('tlOutputBox');
  if (currentSentence.length > 0) {
    // Pagsamahin at i-apply ang grammar rules (Smart formulator)
    const finalSentence = formulateSmartSentence(currentSentence, signLang);
    
    // I-display sa UI
    if (box) box.innerHTML = `<span class="tl-out-word">${finalSentence}</span>`;
    
    // Basahin nang malakas ang BUONG pangungusap
    speakWord(finalSentence, signLang);
  } else {
    if (box) box.innerHTML = `<span class="tl-out-empty">${signLang==='fil'?'Walang salitang narekord sa pangungusap.':'No words recorded in sentence.'}</span>`;
  }
}

function tlSetState(newState){
  if (newState !== 'countdown' && tlCountdownTimer) {
    clearInterval(tlCountdownTimer);
    tlCountdownTimer = null;
    const b1 = document.getElementById('tlTranslateBtn1');
    if (b1) b1.disabled = false;
  }
  tlUiState=newState;
  const sc=document.getElementById('tl-state-cam');
  const sr=document.getElementById('tl-state-result');
  const b1=document.getElementById('tlTranslateBtn1');
  const cf1=document.getElementById('tlCamFrame1');
  if(newState==='idle'){
    if (sc) {
      sc.style.display = 'flex';
      sc.classList.remove('hidden');
    }
    if (sr) {
      sr.style.display = 'none';
      sr.classList.remove('visible');
    }
    if (b1) {
      b1.classList.remove('recording');
      if (!modelTrained) {
        b1.disabled = true;
        b1.innerHTML = '⏳ AI GETTING READY...';
      } else {
        b1.disabled = false;
        b1.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> START';
      }
    }
    if (cf1) cf1.classList.remove('recording');
    tlStartPredLoop();
  }else if(newState==='recording'){
    if (sc) {
      sc.style.display = 'flex';
      sc.classList.remove('hidden');
    }
    if (sr) {
      sr.style.display = 'none';
      sr.classList.remove('visible');
    }
    if (b1) {
      b1.classList.add('recording');
      b1.disabled = false;
      b1.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> STOP';
    }
    if (cf1) cf1.classList.add('recording');
    isSentenceActive = true;
    window.isSentenceActive = true;
    currentSentence = [];
    window.currentSentence = [];
    document.getElementById('tlOutputBox').innerHTML = `<span class="tl-out-empty">${signLang==='fil'?'Nagsimula nang makinig... I-senyas ang mga salita.':'Started listening... Show your signs.'}</span>`;
    tlStartPredLoop();
  }else if(newState==='result'){
    if (sc) {
      sc.style.display = 'none';
      sc.classList.add('hidden');
    }
    if (sr) {
      sr.style.display = 'flex';
      sr.classList.add('visible');
    }
    tlStopPredLoop();
  }
}

let tlCountdownVal = 3;
let tlCountdownTimer = null;

async function tlHandleTranslate(){
  if(tlUiState==='idle'){
    if(!tlStream){showToast('Camera not ready yet…');return;}
    tlWords=[];tlWordIndex=0;tlCurrentGesture=null;tlLastDetected=null;tlHoldStart=null;
    
    // Switch to countdown state
    tlUiState = 'countdown';
    tlCountdownVal = 3;
    
    const b1 = document.getElementById('tlTranslateBtn1');
    if (b1) {
      b1.disabled = true;
      b1.innerHTML = `⏳ Starting in ${tlCountdownVal}...`;
    }
    showToast(`⏳ Translation starting in ${tlCountdownVal}...`);

    tlCountdownTimer = setInterval(() => {
      tlCountdownVal--;
      if (tlCountdownVal > 0) {
        if (b1) b1.innerHTML = `⏳ Starting in ${tlCountdownVal}...`;
      } else {
        clearInterval(tlCountdownTimer);
        tlCountdownTimer = null;
        if (b1) b1.disabled = false;
        tlSetState('recording');
        showToast('🟢 Recording started — press again to finish');
      }
    }, 1000);

  }else if(tlUiState==='recording'){
    await tlProcessAndFinishSentence();
    tlSetState('result');
    showToast('✅ Translation complete!');
  }else if(tlUiState==='result'){
    tlWords=[];tlWordIndex=0;tlCurrentGesture=null;tlRenderOutput();tlSetState('idle');
  }
}

function tlGetAccumulatedTranslation() {
  const box = document.getElementById('tlOutputBox');
  if (box) {
    const text = box.innerText || box.textContent;
    if (text && text.trim() && !text.includes('Translation will appear here') && !text.includes('Listening...') && !text.includes('Nagsimula nang makinig')) {
      return text.replace(/\.\.\.$/, '').trim();
    }
  }
  if (window.currentSentence && window.currentSentence.length > 0) {
    return window.currentSentence.join(' ');
  }
  if (tlWords && tlWords.length > 0) {
    return tlWords.filter(w=>w.type!=='stop').map(w=>getTranslatedWordText(w, signLang)).join(' ');
  }
  return '';
}

function tlSpeakAll(){
  const words = tlGetAccumulatedTranslation();
  if(!words){showToast('⚠️ No words to speak.');return;}
  const btn=document.getElementById('tlSpeakBtn');
  speakUtterance(words, signLang, () => {
    btn.classList.add('speaking');
    btn.textContent='🔊 Speaking…';
  }, () => {
    btn.classList.remove('speaking');
    btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Speak';
  });
}

function tlSetLang(lang){
  if (signLang === lang) return;
  signLang = lang;
  
  const suffix = lang === 'fil' ? 'Fil' : 'En';
  [1, 2].forEach(num => {
    const elEn = document.getElementById(`tlLangEn${num}`);
    const elFil = document.getElementById(`tlLangFil${num}`);
    if (elEn) elEn.classList.toggle('active', suffix === 'En');
    if (elFil) elFil.classList.toggle('active', suffix === 'Fil');
  });
  
  showToast(lang==='fil'?'🇵🇭 Filipino Sign Language (FSL) mode':'🇺🇸 English Sign Language (ESL) mode');
  tlRenderOutput();
  
  tlLoadModelForActiveLanguage();
}

function tlCopyOutput(){
  const text = tlGetAccumulatedTranslation();
  if(!text){showToast('⚠️ Nothing to copy.');return;}
  navigator.clipboard.writeText(text).then(()=>showToast('📋 Copied!'));
}

function tlClearOutput(){
  currentSentence = [];
  window.currentSentence = [];
  tlWords = [];
  tlWordIndex = 0;
  tlCurrentGesture = null;
  tlLastDetected = null;
  tlHoldStart = null;
  isSentenceActive = false;
  window.isSentenceActive = false;
  
  const box = document.getElementById('tlOutputBox');
  if (box) box.innerHTML = '<span class="tl-out-empty">Translation will appear here…</span>';
  
  tlSetState('idle');
  showToast('🗑️ Cleared');
}

function tlSaveLog(){
  const text = tlGetAccumulatedTranslation();
  if(!text){showToast('⚠️ No translation to save.');return;}
  const blob=new Blob([`SiningKamay Translation\n${new Date().toLocaleString()}\n\n${text}`],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`siningkamay-${Date.now()}.txt`;a.click();showToast('💾 Saved!');
}

// Startup
window.addEventListener('DOMContentLoaded', async () => {
  // Pre-load default language cache (ESL by default) on startup for instant ready state
  const initLang = (signLang === 'fil' ? 'FSL' : 'ESL');
  if (loadKnnFromCache(initLang)) {
    console.log(`[KNN] Preloaded cached model for ${initLang} — ${activeLabels.length} gestures ready`);
    tlModelReady = true;
    
    // Set UI states immediately so there is no loading delays
    const dot = document.getElementById('tlDbStatusDot');
    if (dot) {
      dot.className = 'tl-title-dot connected';
      dot.title = `Database connected & ${initLang} model ready (cached)!`;
    }
    const b1 = document.getElementById('tlTranslateBtn1');
    if (b1) {
      b1.disabled = false;
      b1.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> START';
    }
    const overlay = document.getElementById('tlAiLoadingOverlay1');
    if (overlay) overlay.style.display = 'none';
  }

  // Initialize skeleton toggle preference on startup
  window.showSkeleton = localStorage.getItem('sining_kamay_show_skeleton') !== 'false';
  const toggleBtn = document.getElementById('tlSkeletonToggle');
  if (toggleBtn) {
    toggleBtn.className = 'tr-lang-chip tr-skeleton-btn ' + (window.showSkeleton ? 'on' : 'off');
    toggleBtn.textContent = window.showSkeleton ? '🟢 Hand Guide' : '🔴 Hand Guide';
  }

  // Initialize Volume Control
  tlInitVolumeControl();
});

function tlToggleSkeleton() {
  window.showSkeleton = !window.showSkeleton;
  localStorage.setItem('sining_kamay_show_skeleton', window.showSkeleton);
  
  const toggleBtn = document.getElementById('tlSkeletonToggle');
  if (toggleBtn) {
    toggleBtn.className = 'tr-lang-chip tr-skeleton-btn ' + (window.showSkeleton ? 'on' : 'off');
    toggleBtn.textContent = window.showSkeleton ? '🟢 Hand Guide' : '🔴 Hand Guide';
  }
  
  // Immediately clear the canvas if disabled
  if (!window.showSkeleton) {
    const canvas = document.getElementById('tlCanvas1');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}
window.tlToggleSkeleton = tlToggleSkeleton;

function tlStartTranslationKiosk() {
  document.getElementById('tl-state-instr').style.display = 'none';
  document.getElementById('tl-state-cam').style.display = 'flex';
  tlInitCamera();
}
window.tlStartTranslationKiosk = tlStartTranslationKiosk;

function tlTranslateAgain() {
  tlWords = [];
  tlWordIndex = 0;
  tlCurrentGesture = null;
  tlLastDetected = null;
  tlHoldStart = null;
  currentSentence = [];
  window.currentSentence = [];
  isSentenceActive = false;
  window.isSentenceActive = false;
  
  const box = document.getElementById('tlOutputBox');
  if (box) box.innerHTML = '<span class="tl-out-empty">Translation will appear here…</span>';
  
  tlSetState('idle');
}
window.tlTranslateAgain = tlTranslateAgain;

function formulateSmartSentence(wordsArray, lang) {
  if (!wordsArray || wordsArray.length === 0) return "";
  
  const rawWords = wordsArray.map(w => w.trim().toLowerCase());
  const sentenceKey = rawWords.join(' ');

  if (lang === 'fil') {
    const FSL_PHRASES = {
      "kumusta": "Kumusta!",
      "kumusta ka": "Kumusta ka?",
      "magandang umaga": "Magandang umaga!",
      "magandang hapon": "Magandang hapon!",
      "magandang gabi": "Magandang gabi!",
      "paalam": "Paalam!",
      "tulong": "Tulong!",
      "hinto": "Hinto!",
      "mahal kita": "Mahal kita!",
      "salamat": "Salamat!",
      "pakiusap": "Pakiusap.",
      "oo": "Oo.",
      "hindi": "Hindi.",
      "mabuti": "Mabuti naman.",
      "salamat tulong": "Maraming salamat sa tulong mo!",
      "tulong salamat": "Maraming salamat sa tulong mo!",
      "pakiusap tubig": "Pakiusap, pahingi ng tubig.",
      "tubig pakiusap": "Pakiusap, pahingi ng tubig.",
      "pakiusap pagkain": "Pakiusap, pahingi ng pagkain.",
      "pagkain pakiusap": "Pakiusap, pahingi ng pagkain.",
      "hindi naintindihan": "Hindi ko naintindihan.",
      "sandali pakiusap": "Pakiusap, maghintay sandali.",
      "pakiusap sandali": "Pakiusap, maghintay sandali.",
      "halika pakiusap": "Pakiusap, halika rito.",
      "pakiusap halika": "Pakiusap, halika rito.",
      "ako punta tindahan": "Pupunta ako sa tindahan.",
      "ikaw kain": "Kumain ka na ba?",
      "kain ikaw": "Kumain ka na ba?",
      "ano pangalan mo": "Ano ang pangalan mo?",
      "ano pangalan ikaw": "Ano ang pangalan mo?",
      "sino ikaw": "Sino ka?",
      "salamat po": "Maraming salamat po!",
      "mahal kita pakiusap": "Mahal kita, pakiusap.",
      "tulong pakiusap": "Tulong, pakiusap!"
    };

    if (FSL_PHRASES[sentenceKey]) {
      return FSL_PHRASES[sentenceKey];
    }
  } else {
    const ESL_PHRASES = {
      "hello": "Hello!",
      "hello thank you": "Hello, thank you very much!",
      "thank you help": "Thank you for your help!",
      "help thank you": "Thank you for your help!",
      "please water": "Please give me some water.",
      "water please": "Please give me some water.",
      "please food": "Please give me some food.",
      "food please": "Please give me some food.",
      "come here please": "Please come here.",
      "please come here": "Please come here.",
      "no understand": "I do not understand.",
      "wait please": "Please wait a moment.",
      "please wait": "Please wait a moment.",
      "i love you": "I love you!",
      "how are you": "How are you?",
      "you eat": "Have you eaten yet?",
      "eat you": "Have you eaten yet?",
      "me name": "My name is...",
      "please help": "Please help me!",
      "help please": "Please help me!",
      "good morning": "Good morning!",
      "good afternoon": "Good afternoon!",
      "good evening": "Good evening!",
      "goodbye": "Goodbye!",
      "yes": "Yes.",
      "no": "No.",
      "good": "That is good.",
      "stop": "Stop!",
      "go store": "I am going to the store.",
      "i go store": "I am going to the store."
    };

    if (ESL_PHRASES[sentenceKey]) {
      return ESL_PHRASES[sentenceKey];
    }
  }

  let cleanWords = wordsArray.map((w, idx) => {
    let word = w.trim();
    if (lang === 'en' && word.toLowerCase() === 'i') {
      return 'I';
    }
    return word;
  });
  
  const introWords = [
    'hello', 'yes', 'no', 'please', 'goodbye', 'good morning', 'good afternoon', 'good evening',
    'kumusta', 'oo', 'hindi', 'pakiusap', 'paalam', 'magandang umaga', 'magandang hapon', 'magandang gabi'
  ];
  if (cleanWords.length > 1) {
    const firstWordLower = cleanWords[0].toLowerCase();
    if (introWords.includes(firstWordLower)) {
      cleanWords[0] = cleanWords[0] + ",";
    }
  }
  
  let sentence = cleanWords.join(' ');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  
  const lower = sentence.toLowerCase();
  if (lang === 'fil') {
    if (lower.includes("kumain ka")) return "Kumain ka na ba?";
    if (lower.includes("salamat tulong")) return "Maraming salamat sa tulong mo!";
    if (lower === "kumusta ka" || lower === "kamusta ka") return "Kumusta ka?";
  } else {
    if (lower.includes("hello thank you")) return "Hello, thank you very much!";
    if (lower.includes("you eat")) return "Have you eaten yet?";
    if (lower === "how are you") return "How are you?";
  }
  
  const enQuestionWords = ['how', 'what', 'who', 'where', 'why', 'when', 'are you', 'is it', 'do you', 'can you', 'have you', 'would you', 'should you', 'will you', 'did you', 'could you'];
  const filQuestionWords = ['ano', 'sino', 'saan', 'bakit', 'kailan', 'paano', 'kumusta', 'kamusta', 'ba', 'ka na', 'nasaan', 'kanino', 'magkano'];
  
  const enExclamatoryWords = ['help', 'stop', 'i love you', 'goodbye', 'thank you', 'hello', 'wow', 'congratulations', 'oh no'];
  const filExclamatoryWords = ['tulong', 'hinto', 'mahal kita', 'paalam', 'salamat', 'kumusta', 'hala', 'mabuhay'];
  
  let isQuestion = false;
  if (lang === 'fil') {
    const words = lower.split(/[\s,]+/);
    isQuestion = filQuestionWords.some(q => words.includes(q)) || lower.startsWith('paano') || lower.startsWith('kumusta') || lower.startsWith('kamusta');
  } else {
    isQuestion = enQuestionWords.some(q => lower.startsWith(q) || lower.includes(' ' + q + ' ') || lower.endsWith(' ' + q));
  }
  
  let isExclamation = false;
  if (cleanWords.length === 1) {
    const wordLower = cleanWords[0].replace(/,$/, '').toLowerCase();
    if (lang === 'fil') {
      isExclamation = filExclamatoryWords.includes(wordLower);
    } else {
      isExclamation = enExclamatoryWords.includes(wordLower);
    }
  } else {
    const lastWord = cleanWords[cleanWords.length - 1].toLowerCase();
    if (lang === 'fil') {
      isExclamation = ['tulong', 'hinto', 'mahal kita'].includes(lastWord);
    } else {
      isExclamation = ['help', 'stop', 'i love you'].includes(lastWord);
    }
  }
  
  if (sentence.endsWith('?') || sentence.endsWith('.') || sentence.endsWith('!')) {
    return sentence;
  }
  
  if (isQuestion) {
    return sentence + '?';
  } else if (isExclamation) {
    return sentence + '!';
  } else {
    return sentence + '.';
  }
}

// ══════════════════════════════════════════════════════════
// VOLUME CONTROL FUNCTIONS
// ══════════════════════════════════════════════════════════
function tlInitVolumeControl() {
  const slider = document.getElementById('tlVolumeSlider');
  const valDisp = document.getElementById('tlVolumeVal');
  const iconDisp = document.getElementById('tlVolumeIcon');
  if (slider) {
    const savedVol = parseFloat(localStorage.getItem('sining_kamay_speaker_volume') || '1.0');
    const volPct = Math.round(savedVol * 100);
    slider.value = volPct;
    if (valDisp) valDisp.textContent = `${volPct}%`;
    tlUpdateVolumeIcon(volPct, iconDisp);
  }
}
window.tlInitVolumeControl = tlInitVolumeControl;

function tlUpdateVolume(val) {
  const volFraction = parseFloat(val) / 100;
  localStorage.setItem('sining_kamay_speaker_volume', volFraction.toFixed(2));
  const valDisp = document.getElementById('tlVolumeVal');
  const iconDisp = document.getElementById('tlVolumeIcon');
  if (valDisp) valDisp.textContent = `${val}%`;
  tlUpdateVolumeIcon(val, iconDisp);
}
window.tlUpdateVolume = tlUpdateVolume;

function tlUpdateVolumeIcon(val, iconDisp) {
  if (!iconDisp) return;
  const vol = parseInt(val);
  if (vol === 0) {
    iconDisp.textContent = '🔇';
  } else if (vol < 40) {
    iconDisp.textContent = '🔈';
  } else if (vol < 80) {
    iconDisp.textContent = '🔉';
  } else {
    iconDisp.textContent = '🔊';
  }
}

