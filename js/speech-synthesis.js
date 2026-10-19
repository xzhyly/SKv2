// js/speech-synthesis.js
// Browser voice for Train Gestures. Voice, rate, pitch and volume come from js/sk-voice.js (female voice,
// the same for every word).

function getBestVoiceForLang(lang) {
  if (!window.speechSynthesis || !window.SKVoice) return null;
  return window.SKVoice.pick(lang).voice;
}

function speakWord(word, lang) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(word);
  window.SKVoice.apply(u, lang);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function speakUtterance(words, lang, onStart, onEnd) {
  if (!window.speechSynthesis || !words) return;
  const u = new SpeechSynthesisUtterance(words);
  window.SKVoice.apply(u, lang);
  if (typeof onStart === 'function') onStart();
  u.onend = () => { if (typeof onEnd === 'function') onEnd(); };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// Warm up voices list asynchronously (js/sk-voice.js drops its cached choice on voiceschanged)
if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = () => {
    getBestVoiceForLang('fil');
  };
}
