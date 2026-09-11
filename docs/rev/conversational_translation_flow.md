# Sining Kamay: Conversational Sentence Flow & UI Indicators Blueprint

Ang dokumentong ito ay nagsisilbing gabay kung paano baguhin ang prediction loop at interface (UI) upang magkaroon ng **Conversational Sentence Accumulation Flow** sa halip na sabihin o isalin ang mga salita nang paisa-isa (word-by-word).

---

## 1. Pangkalahatang Konsepto ng Sentence Flow

Sa halip na bigkasin agad ang bawat salita habang ginagawa ang senyas, ang `start` at `stop` gestures ay magsisilbing pananda ng simula at wakas ng isang pangungusap:

```
[Start Gesture] ➔ Bubuksan ang sentence accumulator (isSentenceActive = true)
       │
[Custom Gestures] ➔ I-a-accumulate ang mga salita (hal. "Kumusta", "Salamat") at ipapakita sa screen (walang boses)
       │
[Stop Gesture] ➔ Isasara ang accumulator, pagsasamahin ang mga salita, babasahin ang buong pangungusap, at isasave sa DB.
```

Katuwang nito ang isang **Status Indicator Dot** sa UI ng webcam:
- **Green Dot (Active Gets):** Kapag nade-detect ang kamay at may mataas na confidence (> 65%).
- **Red Dot (Searching):** Kapag walang kamay na nakikita o mababa ang confidence, ibig sabihin ay hindi maintindihan ng camera.

---

## 2. Pagbabago sa UI: Status Dot Indicator

### HTML Revisions (sa `sign-to-text.html` o `gesture-training.html`)
Sa loob ng camera frame HTML block, magdagdag ng indicator dot element:

```html
<!-- Ilagay ito sa loob ng camera frame element (halimbawa sa tabi ng live badge) -->
<div class="tr-cam-badge" id="camStatusBadge">
  <div class="status-dot searching" id="indicatorDot"></div> 
  <span id="indicatorText">Searching...</span>
</div>
```

### CSS Revisions (sa `css/sign-to-text.css` o `css/gesture-training.css`)
Idagdag ang estilo para sa bilog na indicator dot:

```css
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  transition: background-color 0.2s, box-shadow 0.2s;
}

/* Red / Gray state kapag hindi nade-detect */
.status-dot.searching {
  background-color: #ef4444; /* Red */
  box-shadow: 0 0 8px #ef4444;
}

/* Green state kapag naintindihan ang sign language */
.status-dot.active-gets {
  background-color: #22c55e; /* Green */
  box-shadow: 0 0 12px #22c55e, 0 0 4px #22c55e;
}
```

---

## 3. Pagsasaayos ng JavaScript Logic (`js/sign-to-text-ui.js`)

I-update ang prediction loop upang mag-imbak ng mga salita sa isang array at basahin lamang ang mga ito kapag natanggap ang `stop` gesture.

### Bagong State Variables
```javascript
let currentSentence = [];       // Dito iipunin ang mga nade-detect na salita
let isSentenceActive = false;    // Tracker kung nasa loob ng start/stop block
```

### Na-update na Prediction Loop (`tlStartPredLoop` o `startLivePrediction`)

```javascript
// Ilagay ito sa loob ng prediction loop interval:
predictLoop = setInterval(async () => {
  if (!stream || !modelTrained) return;

  try {
    const f = extractFeatures();
    const inp = tf.tensor2d([f], [1, activeFeatureSize]);
    const pr = tfModel.predict(inp);
    const data = await pr.data();
    inp.dispose(); pr.dispose();

    const raw = Array.from(data);
    predictionHistory.push(raw);
    if (predictionHistory.length > 6) predictionHistory.shift();

    const scores = predictionHistory.length >= 3 ? averageScores(predictionHistory) : raw;
    const bi = scores.indexOf(Math.max(...scores));
    const conf = scores[bi];
    const detected = activeLabels[bi] || 'unknown';

    // ── 1. UPDATE UI INDICATOR DOT BATAY SA CONFIDENCE ──
    const dot = document.getElementById('indicatorDot');
    const indText = document.getElementById('indicatorText');
    
    if (conf > 0.65 && detected !== 'unknown') {
      if (dot) {
        dot.className = 'status-dot active-gets'; // Turns Green
        if (indText) indText.textContent = `Gets: ${detected}`;
      }
    } else {
      if (dot) {
        dot.className = 'status-dot searching'; // Turns Red
        if (indText) indText.textContent = 'Searching...';
      }
    }

    // ── 2. CONVERSATIONAL ACCUMULATION FLOW ──
    if (conf > 0.65) {
      if (detected !== lastDetected) {
        lastDetected = detected;
        holdStart = Date.now();
        return;
      }
      
      if (Date.now() - holdStart < GESTURE_HOLD_MS) return;

      // A. START GESTURE - Simulan ang Pangungusap
      if (detected === 'start' && currentGesture !== 'start') {
        currentGesture = 'start';
        isSentenceActive = true;
        currentSentence = []; // I-clear ang lumang pangungusap
        
        document.getElementById('tlOutputBox').innerHTML = '<span class="tl-out-empty">Nagsimula nang makinig... I-senyas ang mga salita.</span>';
        showToast("▶ Simula ng Pangungusap");
      } 
      
      // B. STOP GESTURE - Tapusin at Basahin ang Buong Pangungusap
      else if (detected === 'stop' && currentGesture !== 'stop') {
        currentGesture = 'stop';
        isSentenceActive = false;
        
        if (currentSentence.length > 0) {
          // Pagsamahin ang mga naipong salita
          const rawSentence = currentSentence.join(' ');
          
          // I-apply ang grammar rules (Opsyonal)
          const finalSentence = formulateSmartSentence(currentSentence, signLang);
          
          // I-display sa UI
          document.getElementById('tlOutputBox').innerHTML = `<span class="tl-out-word">${finalSentence}</span>`;
          
          // Basahin nang malakas ang BUONG pangungusap
          speakWord(finalSentence, signLang);
          showToast("⏹ Katapusan ng Pangungusap");

          // I-save ang buong pangungusap sa DB History
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
          document.getElementById('tlOutputBox').innerHTML = '<span class="tl-out-empty">Walang salitang narekord sa pangungusap.</span>';
        }
      } 
      
      // C. CUSTOM GESTURES - Magdagdag ng salita habang aktibo ang sentence block
      else if (detected !== 'start' && detected !== 'stop' && currentGesture !== detected) {
        currentGesture = detected;
        
        if (isSentenceActive) {
          const word = translateGestureLabel(detected, signLang);
          currentSentence.push(word);
          
          // Ipakita agad ang naiipong mga salita sa screen bilang real-time draft
          document.getElementById('tlOutputBox').innerHTML = `<span class="tl-out-word">${currentSentence.join(' ')}...</span>`;
          showToast(`+ Added "${word}"`);
        } else {
          showToast("⚠️ Gumawa muna ng 'Start' gesture para mag-ipon ng salita.");
        }
      }
    } else {
      lastDetected = null;
      holdStart = null;
    }
  } catch (e) {
    console.error("Prediction error:", e);
  }
}, 150);
```

---

## 4. Grammar / Smart Sentence Formulator (Future Expansion)

Upang hindi maging barok ang pagsasalin kapag pinagsama-sama ang mga salita (halimbawa, ang *"kumain ka"* ay magiging *"Kumain ka na ba?"*), maaari mong gamitin ang simpleng function helper na ito para maglapat ng rules:

```javascript
function formulateSmartSentence(wordsArray, lang) {
  if (!wordsArray || wordsArray.length === 0) return "";
  
  // Pagsamahin ang mga salita
  let rawSentence = wordsArray.join(' ');
  
  // Tagalog Grammatical Enhancements
  if (lang === 'fil') {
    // Halimbawa: "kumain ka" -> "Kumain ka na ba?"
    if (rawSentence.toLowerCase().includes("kumain ka")) {
      return "Kumain ka na ba?";
    }
    if (rawSentence.toLowerCase().includes("salamat tulong")) {
      return "Maraming salamat sa tulong mo.";
    }
    
    // I-capitalize ang unang letra at lagyan ng tuldok sa dulo
    return rawSentence.charAt(0).toUpperCase() + rawSentence.slice(1) + ".";
  } 
  
  // English Grammatical Enhancements
  else {
    if (rawSentence.toLowerCase().includes("hello thank you")) {
      return "Hello, thank you very much.";
    }
    if (rawSentence.toLowerCase().includes("you eat")) {
      return "Have you eaten yet?";
    }
    
    return rawSentence.charAt(0).toUpperCase() + rawSentence.slice(1) + ".";
  }
}
```
