# Gesture Dataset Isolation and Grammar/Voice Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 
1. Isolate gesture training datasets so that FSL modes only use FSL-recorded gesture data (including start/stop), and ESL modes only use ESL-recorded gesture data.
2. Select the highest-quality native or Google-provided Filipino/Tagalog voice for Text-to-Speech (speech synthesis) when FSL is active, improving pronunciation and clarity.
3. Implement a robust ESL and FSL grammar rule engine (Smart Formulator) that translates sequences of sign vocabulary (like "salamat tulong" or "please water") into proper natural-sounding sentences (like "Maraming salamat sa tulong mo!" or "Please give me some water.").

**Architecture:** 
- In `js/sign-to-text-ui.js`, `js/gesture-training-ui.js`, and `camera-translator.html`, we will modify the dataset loading routines (`mergeSavedGestureSamples`) to filter all rows (including 'start' and 'stop') strictly by `itemLang === targetLang`.
- In `js/speech-synthesis.js` and `camera-translator.html`, we will implement a helper `getBestVoiceForLang(lang)` that queries `speechSynthesis.getVoices()` to dynamically bind a high-quality Filipino voice (`fil-PH`, `tl-PH`) when `lang === 'fil'` instead of letting the browser fall back to generic English voices.
- In `js/sign-to-text-ui.js` and `camera-translator.html`, we will expand `formulateSmartSentence(wordsArray, lang)` with sequence phrase mapping to automatically apply grammatical structures for ESL and FSL combinations.

**Tech Stack:** JavaScript, HTML5 Web Speech Synthesis API.

## Global Constraints

- No external npm dependencies should be added.
- Must preserve support for custom recorded gestures.

---

### Task 1: Isolate ESL and FSL Datasets in UI Logic

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/js/sign-to-text-ui.js`
- Modify: `c:/xampp/htdocs/Sining_kamay/js/gesture-training-ui.js`
- Modify: `c:/xampp/htdocs/Sining_kamay/camera-translator.html`

**Interfaces:**
- Consumes: Gesture samples loaded from database.
- Produces: Strictly filtered dataset for training.

- [ ] **Step 1: Update js/sign-to-text-ui.js dataset filtering**

In [js/sign-to-text-ui.js](file:///c:/xampp/htdocs/Sining_kamay/js/sign-to-text-ui.js) inside `mergeSavedGestureSamples()`, find line 105:
```javascript
      if (label === 'start' || label === 'stop' || itemLang === targetLang) {
```
Replace it with:
```javascript
      if (itemLang === targetLang) {
```

- [ ] **Step 2: Update js/gesture-training-ui.js dataset filtering**

In [js/gesture-training-ui.js](file:///c:/xampp/htdocs/Sining_kamay/js/gesture-training-ui.js) inside `mergeSavedGestureSamples()`, find line 341:
```javascript
      if (label === 'start' || label === 'stop' || itemLang === targetLang) {
```
Replace it with:
```javascript
      if (itemLang === targetLang) {
```

- [ ] **Step 3: Update camera-translator.html dataset filtering**

In [camera-translator.html](file:///c:/xampp/htdocs/Sining_kamay/camera-translator.html) inside `mergeSavedGestureSamples()`, find lines 1017-1020:
```javascript
    rows.forEach(({label,features}) => {
      if (!trainData[label]) trainData[label] = [];
      trainData[label].push(features);
    });
```
Replace it with:
```javascript
    const targetLang = signLang === 'fil' ? 'FSL' : 'ESL';
    let loadedCount = 0;
    rows.forEach(({label,features,signLanguage}) => {
      const itemLang = (signLanguage || 'ESL').toUpperCase();
      if (itemLang === targetLang) {
        if (!trainData[label]) trainData[label] = [];
        trainData[label].push(features);
        loadedCount++;
      }
    });
```

---

### Task 2: Implement High-Quality Filipino Voice Selection

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/js/speech-synthesis.js`
- Modify: `c:/xampp/htdocs/Sining_kamay/camera-translator.html`

**Interfaces:**
- Consumes: Browser SpeechSynthesis voices list.
- Produces: Correct voice binding for Filipino translations.

- [ ] **Step 1: Implement getBestVoiceForLang in js/speech-synthesis.js**

Replace the content of [js/speech-synthesis.js](file:///c:/xampp/htdocs/Sining_kamay/js/speech-synthesis.js) with:
```javascript
// js/speech-synthesis.js

function getBestVoiceForLang(lang) {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  
  if (lang === 'fil') {
    // Look for exact matches first
    const exact = voices.find(v => {
      const name = v.name.toLowerCase();
      const code = v.lang.toLowerCase();
      return code === 'fil-ph' || code === 'tl-ph';
    });
    if (exact) return exact;

    // Look for generic Filipino/Tagalog tags
    const fuzzy = voices.find(v => {
      const code = v.lang.toLowerCase();
      return code.startsWith('fil') || code.startsWith('tl');
    });
    if (fuzzy) return fuzzy;
  } else {
    // English defaults
    const exact = voices.find(v => v.lang.toLowerCase() === 'en-us');
    if (exact) return exact;
  }
  return null;
}

function speakWord(word, lang) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang === 'fil' ? 'fil-PH' : 'en-US';
  u.rate = 0.9;
  
  const voice = getBestVoiceForLang(lang);
  if (voice) {
    u.voice = voice;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function speakUtterance(words, lang, onStart, onEnd) {
  if (!window.speechSynthesis || !words) return;
  const u = new SpeechSynthesisUtterance(words);
  u.lang = lang === 'fil' ? 'fil-PH' : 'en-US';
  u.rate = 0.85;
  
  const voice = getBestVoiceForLang(lang);
  if (voice) {
    u.voice = voice;
  }
  if (typeof onStart === 'function') onStart();
  u.onend = () => { if (typeof onEnd === 'function') onEnd(); };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// Warm up voices list asynchronously
if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = () => {
    getBestVoiceForLang('fil');
  };
}
```

- [ ] **Step 2: Update speech functions in camera-translator.html**

In [camera-translator.html](file:///c:/xampp/htdocs/Sining_kamay/camera-translator.html), replace the definitions of `speakWord` and `speakAll` (around lines 1486-1502):
```javascript
function speakWord(word){
  if(!window.speechSynthesis)return;
  const u=new SpeechSynthesisUtterance(word);
  u.lang=signLang==='fil'?'fil-PH':'en-US';
  u.rate=.9;
  u.pitch=1;
  
  // Find Filipino voice
  const voices = window.speechSynthesis.getVoices();
  const filVoice = voices.find(v => {
    const code = v.lang.toLowerCase();
    return code === 'fil-ph' || code === 'tl-ph' || code.startsWith('fil') || code.startsWith('tl');
  });
  if (signLang === 'fil' && filVoice) {
    u.voice = filVoice;
  }
  window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}

function speakAll(){
  if(!window.speechSynthesis)return;
  const words=translatedWords.filter(w=>w.type!=='stop').map(w=>getTranslatedWordText(w, signLang)).join(', ');
  if(!words){showToast(signLang==='fil'?'⚠️ Walang salita sa listahan':'⚠️ No words to speak');return;}
  const u=new SpeechSynthesisUtterance(words);
  u.lang=signLang==='fil'?'fil-PH':'en-US';
  u.rate=.85;
  
  // Find Filipino voice
  const voices = window.speechSynthesis.getVoices();
  const filVoice = voices.find(v => {
    const code = v.lang.toLowerCase();
    return code === 'fil-ph' || code === 'tl-ph' || code.startsWith('fil') || code.startsWith('tl');
  });
  if (signLang === 'fil' && filVoice) {
    u.voice = filVoice;
  }
  window.speechSynthesis.cancel();window.speechSynthesis.speak(u);
}
```

And update `speakUtterance` (around lines 1993-2004):
```javascript
  const u = new SpeechSynthesisUtterance(words);
  u.lang = signLang === 'fil' ? 'fil-PH' : 'en-US';
  u.rate = 0.85;
  const voices = window.speechSynthesis.getVoices();
  const filVoice = voices.find(v => {
    const code = v.lang.toLowerCase();
    return code === 'fil-ph' || code === 'tl-ph' || code.startsWith('fil') || code.startsWith('tl');
  });
  if (signLang === 'fil' && filVoice) {
    u.voice = filVoice;
  }
  if (typeof onStart === 'function') onStart();
  u.onend = () => { if (typeof onEnd === 'function') onEnd(); };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
```

---

### Task 3: Implement Grammar Rules (Smart Phrase Formulator)

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/js/sign-to-text-ui.js`
- Modify: `c:/xampp/htdocs/Sining_kamay/camera-translator.html`

**Interfaces:**
- Consumes: `wordsArray` of signs.
- Produces: Formulated sentence mapping.

- [ ] **Step 1: Update formulateSmartSentence in js/sign-to-text-ui.js**

In [js/sign-to-text-ui.js](file:///c:/xampp/htdocs/Sining_kamay/js/sign-to-text-ui.js), replace the `formulateSmartSentence(wordsArray, lang)` function (lines 684-768) with:
```javascript
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
```

- [ ] **Step 2: Update formulateSmartSentence in camera-translator.html**

In [camera-translator.html](file:///c:/xampp/htdocs/Sining_kamay/camera-translator.html), replace the `formulateSmartSentence(wordsArray, lang)` function (lines 1756-1840) with the exact same implementation as Step 1 above.

---

## Verification Plan

### Manual Verification
1. Open the Sign to Text page, choose FSL, sign sequence: `salamat`, `tulong`, verify it expands to `"Maraming salamat sa tulong mo!"` and is spoken aloud using the high-quality Tagalog voice.
2. Repeat in ESL mode with `please`, `water` and verify it expands to `"Please give me some water."` in English.
