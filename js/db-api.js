// db-api.js
// ──────────────────────────────────────────────────────────────────────────────
// Drop this <script> tag into index.html AND camera-translator.html:
//   <script src="db-api.js"></script>
//
// Then call the helpers wherever you detect/train a sign or finish speaking.
// ──────────────────────────────────────────────────────────────────────────────

const DB_API = (() => {
  const BASE = (location.protocol === "file:")
    ? "http://localhost/Sining_kamay/php/api/"
    : "php/api/";   // adjust if PHP files live in a sub-folder

  /**
   * saveTranslation()
   * ------------------
   * Call this any time a sign is detected or spoken text is finalised.
   *
   * @param {Object} options
   * @param {"sign_to_text"|"text_to_sign"} options.sourceType
   * @param {string}  options.signLabel      - gesture label  (e.g. "Hello")
   * @param {string}  options.translatedText - resulting text (e.g. "Hello")
   * @param {string}  [options.language]     - "en-US" | "fil-PH"
   * @param {number}  [options.confidence]   - model confidence 0–1
   * @returns {Promise<{success:boolean, id?:number, error?:string}>}
   */
  async function saveTranslation({
    sourceType,
    signLabel      = "",
    translatedText = "",
    language       = "en-US",
    confidence     = null,
  }) {
    try {
      const res = await fetch(`${BASE}save_translation.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type:     sourceType,
          sign_label:      signLabel,
          translated_text: translatedText,
          language,
          confidence,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error("[DB_API] Save failed:", json.error);
      }
      return json;
    } catch (err) {
      console.error("[DB_API] Network error:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * getTranslations()
   * ------------------
   * Fetches recent records from the database.
   *
   * @param {Object} [opts]
   * @param {number} [opts.limit=50]
   * @param {string} [opts.sourceType]  - filter: "sign_to_text" | "text_to_sign"
   * @param {string} [opts.language]    - filter: "en-US" | "fil-PH"
   * @returns {Promise<Array>}
   */
  async function getTranslations({ limit = 50, sourceType = "", language = "" } = {}) {
    try {
      const params = new URLSearchParams({ limit });
      if (sourceType) params.set("source_type", sourceType);
      if (language)   params.set("language", language);

      const res  = await fetch(`${BASE}get_translations.php?${params}`);
      const json = await res.json();
      return json.data ?? [];
    } catch (err) {
      console.error("[DB_API] Fetch error:", err);
      return [];
    }
  }

  return { saveTranslation, getTranslations };
})();


// ══════════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLES — paste the relevant snippet into your existing JS files
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. camera-translator.html / main.js ──────────────────────────────────────
//    Call this inside whatever callback fires when your ML model detects a sign:
//
//    function onSignDetected(label, confidence) {
//      document.getElementById("current-word").textContent = label;
//
//      DB_API.saveTranslation({
//        sourceType:     "sign_to_text",
//        signLabel:      label,
//        translatedText: label,        // or a mapped translation string
//        confidence,
//      }).then(result => {
//        console.log("Saved to DB:", result.id);
//      });
//    }


// ── 2. index.html speech recognition (Voice/Text → Sign Language) ────────────
//    In your SpeechRecognition onresult handler, add the save call:
//
//    recognition.onresult = (event) => {
//      const spokenText = event.results[event.results.length - 1][0].transcript.trim();
//      const confidence = event.results[event.results.length - 1][0].confidence;
//      const lang       = document.getElementById("lang-select").value;
//
//      document.getElementById("transcript").textContent = spokenText;
//      displaySign(spokenText);   // your existing function
//
//      DB_API.saveTranslation({
//        sourceType:     "text_to_sign",
//        signLabel:      "",            // no gesture input here
//        translatedText: spokenText,
//        language:       lang,
//        confidence,
//      });
//    };


// ── 3. Download history button (already in index.html) ───────────────────────
//
//    document.getElementById("download-history-btn").addEventListener("click", async () => {
//      const rows = await DB_API.getTranslations({ limit: 200 });
//
//      // Build CSV
//      const header = "id,source_type,sign_label,translated_text,language,confidence,created_at";
//      const body   = rows.map(r =>
//        [r.id, r.source_type, `"${r.sign_label}"`, `"${r.translated_text}"`,
//         r.language, r.confidence ?? "", r.created_at].join(",")
//      ).join("\n");
//
//      const blob = new Blob([header + "\n" + body], { type: "text/csv" });
//      const url  = URL.createObjectURL(blob);
//      const a    = document.createElement("a");
//      a.href     = url;
//      a.download = "sining_kamay_history.csv";
//      a.click();
//      URL.revokeObjectURL(url);
//    });