# Voice Translation Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable accurate speech-to-text (voice recognition) for Tagalog in the Text-to-Sign screen by providing a visual language switcher, pre-requesting microphone streams with digital signal processing (DSP) noise cancellation/suppression constraints, and updating the SpeechRecognition language dynamically.

**Architecture:** We will add a language toggle to the Text-to-Sign HTML UI. In the JavaScript layer, we will listen to this toggle, update the Web Speech API language (`recognition.lang`), and pre-open the user's mic using Web Audio/MediaTrack constraints (`noiseSuppression: true`, `echoCancellation: true`) to activate system-level noise filtering.

**Tech Stack:** Vanilla JS, HTML5 MediaDevices API, Web Speech API (SpeechRecognition).

## Global Constraints

- No external npm dependencies should be added.
- Must support standard Chrome SpeechRecognition interface.
- Language options must support English (en-US) and Filipino (fil-PH).

---

### Task 1: Add Language Toggle UI to index.html

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/index.html` (CSS styles and HTML layout inside Controls panel)

**Interfaces:**
- Consumes: None
- Produces: CSS class `.tts-lang-toggle`, `.tts-lang-chip`, and HTML structure for language switcher.

- [ ] **Step 1: Write the CSS styles for the language toggle**

Modify the `<style>` block in [index.html](file:///c:/xampp/htdocs/Sining_kamay/index.html) to add:
```css
      /* ── TTS Language Toggle ── */
      .tts-lang-toggle {
        display: flex;
        gap: 8px;
        justify-content: center;
        width: 100%;
        max-width: 420px;
        margin: 4px auto 0 !important;
      }
      .tts-lang-chip {
        flex: 1;
        height: 38px;
        border-radius: 8px;
        border: 1.5px solid #e2e8f0;
        background: #fff;
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        transition: background .18s, border-color .18s, color .18s;
      }
      .tts-lang-chip:hover {
        border-color: #cbd5e0;
        color: #475569;
      }
      .tts-lang-chip.active {
        background: #1a2540;
        border-color: #1a2540;
        color: #fff;
      }
```

- [ ] **Step 2: Add the toggle markup inside `#translator-pane`**

Modify the HTML section inside `#translator-pane` controls in [index.html](file:///c:/xampp/htdocs/Sining_kamay/index.html) to place the toggle above the text input:
```html
                <!-- Live speech transcript -->
                <p id="transcript" class="tts-live-text"></p>

                <!-- Language Toggle -->
                <div class="tts-lang-toggle">
                    <button type="button" class="tts-lang-chip active" id="ttsLangEn" onclick="setTtsLanguage('en-US')">🇺🇸 English</button>
                    <button type="button" class="tts-lang-chip" id="ttsLangFil" onclick="setTtsLanguage('fil-PH')">🇵🇭 Filipino</button>
                </div>

                <!-- — OR — divider -->
                <div class="tts-or">— OR —</div>
```

---

### Task 2: Implement DSP Noise Suppression and Language Toggling in js/script.js

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/js/script.js`

**Interfaces:**
- Consumes: Language selection from DOM buttons.
- Produces: `setTtsLanguage(lang)` function and mic constraint pipeline inside `startListening()`.

- [ ] **Step 1: Add showToast and setTtsLanguage in js/script.js**

Add these helpers to the script:
```javascript
// --- TOAST NOTIFICATION HELPERS ---
function showToast(msg, ms = 3000) {
    const t = document.getElementById('sk-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.pointerEvents = 'auto';
    clearTimeout(window.skToastTimer);
    window.skToastTimer = setTimeout(() => {
        t.style.opacity = '0';
        t.style.pointerEvents = 'none';
    }, ms);
}

// --- LANGUAGE SWITCHER FOR TEXT TO SIGN ---
function setTtsLanguage(lang) {
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.value = lang;
    }
    const btnEn = document.getElementById('ttsLangEn');
    const btnFil = document.getElementById('ttsLangFil');
    if (btnEn) btnEn.classList.toggle('active', lang === 'en-US');
    if (btnFil) btnFil.classList.toggle('active', lang === 'fil-PH');
    
    showToast(lang === 'fil-PH' ? '🇵🇭 Filipino (Tagalog) mode' : '🇺🇸 English mode');
}
window.setTtsLanguage = setTtsLanguage;
```

- [ ] **Step 2: Update startListening and stop/error cleanup in js/script.js**

Modify the SpeechRecognition routines:
```javascript
    let speechMicStream = null;

    function startListening() {
        gotSpeechResult = false;
        if (!isRecognizing) {
            // Pre-request microphone stream with echo cancellation and noise suppression
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                statusDisplay.innerText = "Status: Initializing mic...";
                navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                }).then(stream => {
                    speechMicStream = stream;
                    runSpeechRecognition();
                }).catch(err => {
                    console.warn("Microphone pre-flight constraints failed:", err);
                    runSpeechRecognition(); // fallback to normal start
                });
            } else {
                runSpeechRecognition();
            }
        }
    }

    function runSpeechRecognition() {
        try {
            recognition.lang = langSelect.value;
            recognition.start();
            setVisualState(true);
            statusDisplay.innerText = "Status: Listening... speak now";
        } catch (e) {
            console.log("Recognition start blocked:", e);
            resetSpeechButton("Status: Ready");
        }
    }

    function cleanupMicStream() {
        if (speechMicStream) {
            speechMicStream.getTracks().forEach(track => track.stop());
            speechMicStream = null;
        }
    }

    // Call cleanupMicStream() inside recognition.onend and recognition.onerror
```
