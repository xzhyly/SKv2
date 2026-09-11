// =============================================
// SiningKamay Database — MySQL Edition
// Replaces IndexedDB with real PHP/MySQL calls.
// Function signatures are IDENTICAL to the old
// IndexedDB version so no other file needs changing.
// =============================================

const _API = (location.protocol === "file:")
  ? "http://localhost/Sining_kamay/php/api/core_api.php"
  : "php/api/core_api.php"; // points to unified api router

async function _post(action, payload = {}) {
  const res = await fetch(_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ── RECORDINGS ────────────────────────────────────────────────
// Called in camera-translator.html → stopRecording()
async function saveRecording(gesture, sampleCount, thumbnailDataUrl) {
  return _post('save_recording', { gesture, sampleCount, thumbnailDataUrl });
}

async function getAllRecordings() {
  const json = await _post('get_recordings');
  return json.data ?? [];
}

async function deleteRecording(id) {
  return _post('delete_recording', { id });
}

// ── TRANSLATIONS ──────────────────────────────────────────────
// Called in camera-translator.html → startLivePrediction() on gesture detect
async function saveTranslation(word, language, fullTranscript) {
  return _post('save_translation', { word, language, fullTranscript });
}

async function getAllTranslations() {
  const json = await _post('get_translations');
  return json.data ?? [];
}

async function deleteTranslation(id) {
  return _post('delete_translation', { id });
}

// ── GESTURE WORDS (kNN trainer / main.js) ─────────────────────
// Called in main.js → setupTrainingUI() when a new sign word is added
async function saveGestureWord(word) {
  return _post('save_gesture_word', { word });
}

// ── UTILITIES ─────────────────────────────────────────────────
async function clearStore(storeName) {
  // storeName: 'recordings' | 'translations' | 'gesture_words'
  return _post('clear_store', { storeName });
}

async function getDBStats() {
  return _post('get_stats');
}