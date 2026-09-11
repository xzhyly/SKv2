// js/speech-synthesis.js

function getBestVoiceForLang(lang) {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  
  if (lang === 'fil') {
    // Look for exact matches first (Tagalog/Filipino)
    const exact = voices.find(v => {
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
  u.volume = parseFloat(localStorage.getItem('sining_kamay_speaker_volume') || '1.0');
  
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
  u.volume = parseFloat(localStorage.getItem('sining_kamay_speaker_volume') || '1.0');
  
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
