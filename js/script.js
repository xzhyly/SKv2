const startBtn = document.getElementById('start-btn');
const transcriptDisplay = document.getElementById('transcript');
const signContainer = document.getElementById('sign-container');
const currentWordDisplay = document.getElementById('current-word');
const statusDisplay = document.getElementById('status');
const langSelect = document.getElementById('lang-select');
const textSignInput = document.getElementById('text-sign-input');
const textSignBtn = document.getElementById('text-sign-btn');

// Grab references to the dashboard elements
const dashboardPane = document.getElementById('dashboard-pane');
const translatorPane = document.getElementById('translator-pane');
const welcomeBtn = document.getElementById('welcome-btn');

// Download button and history array
const downloadHistoryBtn = document.getElementById('download-history-btn');
let translationHistory = [];
// ── Language-specific sign asset maps ──────────────────────────────────────
const signAssetMapEn = {
    "i dont know": "dont_know.webm",
    "dont know": "dont_know.webm",
    "i dont understand": "dont_understand.webm",
    "dont understand": "dont_understand.webm",
    "dont like": "dont_like.webm",
    "dont want": "dont_want.webm",
    "how are you": "how_are_you.webm",
    "how are you doing": "how_are_you.webm",
    "good morning": "good_morning.webm",
    "nice to meet you": "nice_to_meet_you.webm",
    "see you later": "see_you_later.webm",
    "where do you live": "where_do_you_live.webm",
    "where is the bathroom": "where_is_the_bathroom.webm",
    "what is your name": "what_is_your_name.webm",
    "what did you say": "what_did_you_say.webm",
    "do you understand": "do_you_understand.webm",
    "no i dont understand": "no_i_dont_understand.webm",
    "are you hearing": "are_you_hearing.webm",
    "my name": "my_name.webm",
    "please": "please.webm",
    "love": "love.webm",
    "happy": "happy.webm",
    "sad": "sad.webm",
    "morning": "morning.webm",
    "afternoon": "afternoon.webm",
    "night": "night.webm",
    "hello": "hello.webm",
    "goodbye": "goodbye.webm",
    "yes": "yes.webm",
    "no": "no.webm",
    "help": "help.webm",
    "thank you": "nice_to_meet_you.webm",
    "deaf": "deaf.webm",
    "hearing": "hearing.webm",
    "friend": "friend.webm",
    "family": "family.webm",
    "mother": "mother.webm",
    "father": "father.webm",
    "sister": "sister.webm",
    "brother": "brother.webm",
    "understand": "understand.webm",
    "name": "name.webm",
    "where": "where.webm",
    "what": "what.webm",
    "when": "when.webm",
    "who": "who.webm",
    "why": "why.webm",
    "how": "how.webm",
    "know": "know.webm",
    "want": "want.webm",
    "like": "like.webm",
    "good": "good.webm",
    "bad": "bad.webm",
    "more": "more.webm",
    "nothing": "nothing.webm",
    "come": "come.webm",
    "go": "go.webm",
    "work": "work.webm",
    "learn": "learn.webm",
    "student": "student.webm",
    "meet": "meet.webm",
    "see": "see.webm",
    "tired": "tired.webm",
    "sick": "sick.webm",
    "scared": "scared.webm",
    "confused": "confused.webm",
    "excited": "excited.webm",
    "bored": "bored.webm",
    "busy": "busy.webm",
    "nice": "nice.webm",
    "done": "done.webm",
    "home": "home.webm",
    "time": "time.webm",
    "day": "day.webm",
    "week": "week.webm",
    "month": "month.webm",
    "year": "year.webm"
};

const signAssetMapFil = {
    "kamusta": "kamusta.webm",
    "magandang umaga": "magandang_umaga.webm",
    "magandang hapon": "hapon.webm",
    "magandang gabi": "gabi.webm",
    "paalam": "paalam.webm",
    "asawa": "asawa.webm",
    "ama": "ama.webm",
    "ina": "ina.webm",
    "ate": "ate.webm",
    "kapatid": "kapatid_sa_pangasinan.webm",
    "mag-anak": "mag-anak.webm",
    "kailan": "kailan.webm",
    "saan": "saan.webm",
    "bakit": "bakit.webm",
    "sino": "sino.webm",
    "ano": "ano_ba_sabi_mo.webm",
    "kailangan": "kailangan.webm",
    "tulong": "tulong.webm",
    "salamat": "nice_to_meet_you.webm",
    "oo": "yes.webm",
    "hindi": "no.webm",
    "tapos": "tapos.webm",
    "bukas": "bukas.webm",
    "gabi": "gabi.webm",
    "umaga": "magandang_umaga.webm",
    "hapon": "hapon.webm",
    "mahal": "love.webm",
    "masaya": "happy.webm",
    "malungkot": "sad.webm",
    "sige": "go.webm",
    "punta": "go.webm",
    "linggo": "linggo.webm",
    "buwan": "buwan.webm",
    "taon": "taon.webm",
    "araw": "day.webm"
};

// Populate alphabet letters for both language maps
for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    signAssetMapEn[letter] = `${letter}.webm`;
    signAssetMapFil[letter] = `${letter}.webm`;
}

// ── Language helper functions ────────────────────────────────────────────────
function getActiveLanguage() {
    const ls = document.getElementById('lang-select');
    return ls ? ls.value : 'en-US';
}

function getActiveSignMap() {
    return getActiveLanguage() === 'fil-PH' ? signAssetMapFil : signAssetMapEn;
}

function getActiveKnownPhrases() {
    return getActiveLanguage() === 'fil-PH' ? knownPhrasesFil : knownPhrasesEn;
}

function getSignAssetBase() {
    return getActiveLanguage() === 'fil-PH' ? 'assets/signs/fil/' : 'assets/signs/en/';
}

// --- VOSK OFFLINE SPEECH RECOGNITION ADAPTER ---
class VoskSpeechRecognition {
    constructor() {
        this.lang = 'en-US';
        this.interimResults = true;
        this.continuous = false;
        
        this.onstart = null;
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        
        this.model = null;
        this.recognizer = null;
        this.mediaStream = null;
        this.audioContext = null;
        this.processorNode = null;
        this.isStarted = false;
    }
    
    async initModel() {
        if (this.model) return;
        
        const startBtn = document.getElementById('start-btn');
        const micLabel = document.querySelector('.tts-mic-label');
        
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.5';
            startBtn.style.cursor = 'not-allowed';
        }
        if (micLabel) {
            micLabel.textContent = "Loading Offline AI Model...";
            micLabel.style.color = '#f97316'; // Warning orange
        }
        
        try {
            console.log("[Vosk] Loading offline model...");
            if (typeof logDebugEvent === 'function') logDebugEvent("Loading offline model...");
            // Use location path to make it dynamic and independent of hardcoded folder name
            const currentPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
            const modelUrl = window.location.origin + currentPath + '/models/vosk-model-small-en-us-0.15.tar.gz.zip';
            this.model = await Vosk.createModel(modelUrl);
            console.log("[Vosk] Offline model loaded!");
            if (typeof logDebugEvent === 'function') logDebugEvent("Offline model loaded!");
            
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.style.opacity = '1';
                startBtn.style.cursor = 'pointer';
            }
            if (micLabel) {
                micLabel.textContent = "Tap to Speak";
                micLabel.style.color = '#1a2540';
            }
        } catch (e) {
            console.error("[Vosk] Model load failed:", e);
            if (typeof logDebugEvent === 'function') logDebugEvent("Model load failed: " + e.message);
            if (this.onerror) this.onerror({ error: 'network', message: e.message });
            if (micLabel) {
                micLabel.textContent = "Offline Model Load Failed";
                micLabel.style.color = '#ef4444';
            }
        }
    }
    
    async start() {
        if (this.isStarted) return;
        this.isStarted = true;
        
        try {
            if (!this.model) {
                await this.initModel();
            }
            if (!this.model) throw new Error("Vosk model not loaded");
            
            // Start audio capture using selected microphone from localStorage
            const savedMicId = localStorage.getItem('selectedMicId');
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            };
            if (savedMicId) {
                audioConstraints.deviceId = { exact: savedMicId };
            }
            
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints
            });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            
            // Initialize KaldiRecognizer with the actual AudioContext sample rate
            if (this.recognizer) {
                this.recognizer = null;
            }
            this.recognizer = new this.model.KaldiRecognizer(this.audioContext.sampleRate);
            
            this.recognizer.on("result", (message) => {
                const text = message.result.text;
                console.log("[Vosk] Result:", text);
                if (this.onresult && text) {
                    const event = {
                        resultIndex: 0,
                        results: [[{ transcript: text }]]
                    };
                    event.results[0].isFinal = true; // Mark as final
                    this.onresult(event);
                }
            });
            
            this.recognizer.on("partialresult", (message) => {
                const text = message.result.partial;
                if (this.onresult && text) {
                    const event = {
                        resultIndex: 0,
                        results: [[{ transcript: text }]]
                    };
                    event.results[0].isFinal = false; // Mark as interim/partial
                    this.onresult(event);
                }
            });
            
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.processorNode.onaudioprocess = (event) => {
                if (this.recognizer && this.isStarted) {
                    try {
                        this.recognizer.acceptWaveform(event.inputBuffer);
                    } catch (err) {
                        console.error("acceptWaveform error:", err);
                    }
                }
            };
            
            source.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);
            
            if (this.onstart) this.onstart();
            if (typeof logDebugEvent === 'function') logDebugEvent("Vosk audio stream capture started at sample rate: " + this.audioContext.sampleRate);
            
        } catch (e) {
            console.error("[Vosk] start failed:", e);
            this.isStarted = false;
            if (this.onerror) this.onerror({ error: 'audio-capture', message: e.message });
            if (this.onend) this.onend();
        }
    }
    
    stop() {
        if (!this.isStarted) return;
        this.isStarted = false;
        if (typeof logDebugEvent === 'function') logDebugEvent("Vosk stop called");
        
        try {
            if (this.processorNode) {
                this.processorNode.disconnect();
                this.processorNode = null;
            }
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.audioContext.close();
                this.audioContext = null;
            }
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
                this.mediaStream = null;
            }
        } catch (e) {
            console.error("[Vosk] stop cleanup failed:", e);
        }
        
        if (this.onend) this.onend();
    }
}

// Force using VoskSpeechRecognition to ensure 100% offline functionality on all devices (Laptop & Raspberry Pi)
let SpeechRecognition = VoskSpeechRecognition;
const isVoiceScreen = new URLSearchParams(window.location.search).get('screen') === 'voice';

function openVoiceToSignScreen() {
    dashboardPane.style.display = 'none';
    translatorPane.style.display = 'flex';
    statusDisplay.innerText = "Status: Ready";
}

welcomeBtn.addEventListener('click', () => {
    window.location.href = 'index.html?screen=voice';
});

if (isVoiceScreen) {
    openVoiceToSignScreen();
}

function formatGrammar(text) {
    if (!text) return "";
    
    // Trim and clean spacing
    let formatted = text.trim().replace(/\s+/g, ' ');
    if (formatted.length === 0) return "";
    
    // Split sentences by '.', '?', '!' followed by space or end of string
    const parts = formatted.split(/([.?!]\s*)/);
    let result = "";
    const questionWords = [
        "who", "what", "where", "when", "why", "how", "which", "whose", "whom",
        "is", "are", "do", "does", "did", "can", "could", "should", "would", "will", "shall", "has", "have", "am", "was", "were"
    ];
    
    for (let i = 0; i < parts.length; i += 2) {
        let sentence = parts[i];
        if (sentence) {
            sentence = sentence.trim();
            if (sentence.length > 0) {
                // Capitalize first letter of sentence
                sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
                
                // Capitalize standalone "i"
                sentence = sentence.replace(/\bi\b/g, 'I');
                
                // Fix common contractions
                sentence = sentence
                    .replace(/\bim\b/g, "I'm").replace(/\bIm\b/g, "I'm")
                    .replace(/\bdont\b/g, "don't").replace(/\bDont\b/g, "Don't")
                    .replace(/\bcant\b/g, "can't").replace(/\bCant\b/g, "Can't")
                    .replace(/\bwont\b/g, "won't").replace(/\bWont\b/g, "Won't")
                    .replace(/\byoure\b/g, "you're").replace(/\bYoure\b/g, "You're");
                
                // Check if delimiter follows
                const delimiter = parts[i + 1] ? parts[i + 1].trim() : "";
                if (delimiter) {
                    sentence += delimiter + " ";
                } else {
                    // No delimiter - add smart ending punctuation
                    const lastChar = sentence.slice(-1);
                    const hasPunctuation = ['.', '?', '!'].includes(lastChar);
                    if (!hasPunctuation) {
                        const firstWord = sentence.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
                        if (questionWords.includes(firstWord)) {
                            sentence += "?";
                        } else {
                            sentence += ".";
                        }
                    }
                }
            }
            result += sentence;
        }
    }
    return result.trim();
}

function handleRecognizedText(rawText, onDone = null) {
    const trimmedRaw = rawText.trim();
    if (!trimmedRaw) {
        if (onDone) {
            onDone("Status: Ready - no text detected");
        } else {
            statusDisplay.innerText = "Status: Ready - no text detected";
        }
        return;
    }

    const formattedText = formatGrammar(trimmedRaw);
    transcriptDisplay.innerText = `You said: "${formattedText}"`;
    translationHistory.push(formattedText);
    statusDisplay.innerText = "Status: Translating...";

    const normalized = normalizeSpeechText(trimmedRaw);
    return playSequence(normalized).finally(() => {
        if (onDone) {
            onDone("Status: Ready");
        } else {
            statusDisplay.innerText = "Status: Ready";
        }
    });
}

textSignBtn.addEventListener('click', () => {
    handleRecognizedText(textSignInput.value);
});

textSignInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        handleRecognizedText(textSignInput.value);
    }
});

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
    
    const startBtn = document.getElementById('start-btn');
    const micLabel = document.querySelector('.tts-mic-label');
    const micSelectWrap = document.querySelector('.tts-mic-select-wrap');
    
    if (lang === 'fil-PH') {
        // If voice recording is currently active, turn it off
        if (typeof window.stopActiveSpeech === 'function') {
            window.stopActiveSpeech();
        }
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.4';
            startBtn.style.cursor = 'not-allowed';
            startBtn.style.pointerEvents = 'none';
        }
        if (micLabel) {
            micLabel.textContent = "Voice input disabled in Filipino";
            micLabel.style.color = '#64748b';
        }
        if (micSelectWrap) {
            micSelectWrap.style.opacity = '0.4';
            micSelectWrap.style.pointerEvents = 'none';
        }
    } else {
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            startBtn.style.cursor = 'pointer';
            startBtn.style.pointerEvents = 'auto';
        }
        if (micLabel) {
            micLabel.textContent = "Tap to Speak";
            micLabel.style.color = '';
        }
        if (micSelectWrap) {
            micSelectWrap.style.opacity = '1';
            micSelectWrap.style.pointerEvents = 'auto';
        }
    }
    
    showToast(lang === 'fil-PH' ? '🇵🇭 Filipino (Tagalog) mode' : '🇺🇸 English mode');
}
window.setTtsLanguage = setTtsLanguage;

// Run initially to set the correct visual state on load
if (langSelect) {
    setTtsLanguage(langSelect.value);
}

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true; 
    recognition.interimResults = false;

    // Pre-initialize offline model if Vosk adapter is active — but only once the user
    // has actually opened the voice screen, not on every dashboard load.
    if (isVoiceScreen && typeof recognition.initModel === 'function') {
        recognition.initModel();
    }

    // --- STATE TRACKING TO PREVENT RAPID START/STOP ERRORS ---
    let isRecognizing = false;
    let gotSpeechResult = false;
    let processingTimer = null;
    let pressStartTime = 0;
    let speechMicStream = null;
    let isRecordingActive = false; // Toggle state tracking
    let finalTranscript = "";
    let currentSegmentTranscript = "";

    // Global helper hook to turn off active speech from outside the SpeechRecognition block
    window.stopActiveSpeech = () => {
        if (isRecordingActive) {
            isRecordingActive = false;
            stopListening();
        }
    };

    const micLabel = document.querySelector('.tts-mic-label');

    // Speech Debugger DOM cache & toggle
    const debugEl = document.getElementById('speech-debugger');
    const debugHeader = document.getElementById('speech-debugger-header');
    const debugActive = document.getElementById('debug-active');
    const debugRecognizing = document.getElementById('debug-recognizing');
    const debugError = document.getElementById('debug-error');
    const debugSegment = document.getElementById('debug-segment');
    const debugFinal = document.getElementById('debug-final');
    const debugLogs = document.getElementById('debug-logs');

    if (debugHeader && debugEl) {
        debugHeader.addEventListener('click', () => {
            debugEl.classList.toggle('speech-debugger-collapsed');
        });
    }

    function logDebugEvent(msg) {
        if (debugLogs) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            debugLogs.innerHTML += `<div>[${time}] ${msg}</div>`;
            debugLogs.scrollTop = debugLogs.scrollHeight;
        }
    }

    function updateDebuggerState() {
        if (debugActive) {
            debugActive.textContent = isRecordingActive ? "YES" : "NO";
            debugActive.style.color = isRecordingActive ? "#34d399" : "#ef4444";
        }
        if (debugRecognizing) {
            debugRecognizing.textContent = isRecognizing ? "YES" : "NO";
            debugRecognizing.style.color = isRecognizing ? "#34d399" : "#ef4444";
        }
        if (debugSegment) debugSegment.textContent = JSON.stringify(currentSegmentTranscript);
        if (debugFinal) debugFinal.textContent = JSON.stringify(finalTranscript);
    }

    function setVisualState(on) {
        startBtn.classList.toggle('listening', on);
        if (on) {
            transcriptDisplay.innerText = '';
            if (micLabel) micLabel.textContent = "Tap to Stop";
        } else {
            if (micLabel) micLabel.textContent = "Tap to Speak";
        }
    }

    function resetSpeechButton(message = "Status: Ready") {
        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }
        setVisualState(false);
        statusDisplay.innerText = message;
    }
    function startListening() {
        gotSpeechResult = false;
        finalTranscript = "";
        currentSegmentTranscript = "";
        logDebugEvent("startListening called");
        updateDebuggerState();

        if (!isRecognizing) {
            // Pre-request microphone stream with noise suppression constraints
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                statusDisplay.innerText = "Status: Initializing mic...";
                const savedMicId = localStorage.getItem('selectedMicId');
                const audioConstraints = {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                };
                if (savedMicId) {
                    audioConstraints.deviceId = { exact: savedMicId };
                }
                navigator.mediaDevices.getUserMedia({
                    audio: audioConstraints
                }).then(stream => {
                    speechMicStream = stream;
                    if (typeof window.loadMicrophones === 'function') {
                        window.loadMicrophones();
                    }
                    runSpeechRecognition();
                }).catch(err => {
                    console.warn("Microphone pre-flight constraints failed:", err);
                    runSpeechRecognition(); // fallback
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

    function stopListening() {
        logDebugEvent("stopListening called");
        try {
            recognition.stop();
            statusDisplay.innerText = "Status: Processing...";
            processingTimer = setTimeout(() => {
                if (!gotSpeechResult) {
                    resetSpeechButton("Status: Ready - no speech detected");
                }
            }, 2500);
        } catch (e) {
            console.log("Recognition already stopped.");
            if (isRecognizing) {
                statusDisplay.innerText = "Status: Processing...";
            } else {
                resetSpeechButton("Status: Ready");
            }
        }
    }

    recognition.onstart = () => {
        isRecognizing = true;
        logDebugEvent("recognition.onstart");
        updateDebuggerState();
    };

    recognition.onend = () => {
        console.log("[Speech] onend event fired. isRecordingActive:", isRecordingActive, "isRecognizing:", isRecognizing, "gotSpeechResult:", gotSpeechResult);
        console.log("[Speech] Before append - finalTranscript:", JSON.stringify(finalTranscript), "currentSegmentTranscript:", JSON.stringify(currentSegmentTranscript));
        isRecognizing = false;
        logDebugEvent(`recognition.onend. Active: ${isRecordingActive}`);
        
        // Append the last segment result if any
        if (gotSpeechResult && currentSegmentTranscript.trim()) {
            finalTranscript += (finalTranscript ? " " : "") + currentSegmentTranscript.trim();
            console.log("[Speech] Appended. New finalTranscript:", JSON.stringify(finalTranscript));
            currentSegmentTranscript = "";
        } else {
            console.log("[Speech] Skip append. gotSpeechResult:", gotSpeechResult, "currentSegmentTranscript:", JSON.stringify(currentSegmentTranscript));
        }
        updateDebuggerState();

        if (isRecordingActive) {
            // Recording is still active! Restart engine to continue listening through pauses
            console.log("[Speech] Premature segment end while active. Restarting recognition...");
            logDebugEvent("Restarting recognition quietly...");
            try {
                recognition.start();
                isRecognizing = true;
                setVisualState(true);
                statusDisplay.innerText = "Status: Listening... speak now";
            } catch (e) {
                console.log("Speech recognition restart failed:", e);
                logDebugEvent(`Restart failed: ${e.message}`);
                resetSpeechButton("Status: Ready");
            }
        } else {
            // Recording explicitly stopped. Stop everything and trigger translation
            cleanupMicStream();
            setVisualState(false); // Instantly turn button back to original blue color
            if (finalTranscript.trim()) {
                handleRecognizedText(finalTranscript, resetSpeechButton);
            } else {
                resetSpeechButton("Status: Ready - no speech detected");
            }
        }
    };

    function handleMicToggle() {
        if (isRecordingActive) {
            console.log("[Event Tracer] Toggling OFF speech recognition.");
            logDebugEvent("Toggled OFF by user click");
            isRecordingActive = false;
            stopListening();
        } else {
            console.log("[Event Tracer] Toggling ON speech recognition.");
            logDebugEvent("Toggled ON by user click");
            if (debugError) debugError.textContent = "None";
            isRecordingActive = true;
            startListening();
        }
        updateDebuggerState();
    }

    // --- TAP TO TOGGLE (Start/Stop) ---
    // We strictly use click, which is universally triggered once by touch and mouse
    startBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleMicToggle();
    });

    // Block context menu on touchscreens
    startBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    recognition.onresult = (event) => {
        console.log("[Speech] onresult event fired. isRecordingActive:", isRecordingActive);
        gotSpeechResult = true;

        if (processingTimer) {
            clearTimeout(processingTimer);
            processingTimer = null;
        }

        let interimTranscript = "";
        let newFinals = "";

        // Process all segments starting from resultIndex (crucial for native continuous SpeechRecognition)
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                newFinals += event.results[i][0].transcript + " ";
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        // Safely accumulate finalized speech segments
        if (newFinals) {
            finalTranscript += (finalTranscript ? " " : "") + newFinals.trim();
        }
        currentSegmentTranscript = interimTranscript;

        // Show combined real-time transcript update to user
        const combined = (finalTranscript + (finalTranscript && currentSegmentTranscript ? " " : "") + currentSegmentTranscript).trim();
        console.log("[Speech] Result combined transcript:", JSON.stringify(combined), "finalTranscript:", JSON.stringify(finalTranscript), "currentSegmentTranscript:", JSON.stringify(currentSegmentTranscript));
        logDebugEvent(`Result update: ${JSON.stringify(combined.substring(0, 40))}`);
        updateDebuggerState();
        
        const formattedText = formatGrammar(combined);
        transcriptDisplay.innerText = `You said: "${formattedText}"`;
    };

    // --- UPDATED ERROR HANDLING ---
    recognition.onerror = (event) => {
        console.error("Speech Recognition Error:", event.error); // This will show more detail in F12 tools
        if (debugError) {
            debugError.textContent = event.error;
            debugError.style.color = "#f43f5e";
        }
        logDebugEvent(`ERROR: ${event.error}`);
        
        // If recording is active, ignore temporary pause errors and let onend restart quietly
        if (isRecordingActive && ["no-speech", "aborted"].includes(event.error)) {
            console.log("[Speech] Ignoring quiet error while recording is active:", event.error);
            logDebugEvent(`Ignore quiet error: ${event.error}`);
            return;
        }

        cleanupMicStream();
        const quietErrors = ["no-speech", "aborted"];
        const message = quietErrors.includes(event.error)
            ? "Status: Ready - no speech detected"
            : "Error: " + event.error;
        resetSpeechButton(message);
        isRecognizing = false; // Ensure state resets on error
        updateDebuggerState();
    };

} else {
    alert("Your browser does not support Speech Recognition.");
}

// Download History Function
downloadHistoryBtn.addEventListener('click', () => {
    if (translationHistory.length === 0) {
        alert("No translations to download yet!");
        return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ history: translationHistory }, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "translation_history.json");
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
});

const SAVE_ENDPOINT = (location.protocol === "file:")
    ? "http://localhost" + (window.location.pathname.includes('/SKR') ? '/SKR' : '/Sining_kamay') + "/php/api/save_gesture.php"
    : "php/api/save_gesture.php";

let knownPhrasesEn = [];
let knownPhrasesFil = [];

function rebuildKnownPhrases() {
    knownPhrasesEn = Object.keys(signAssetMapEn)
        .filter((key) => key.includes(" "))
        .sort((a, b) => b.split(" ").length - a.split(" ").length);
    knownPhrasesFil = Object.keys(signAssetMapFil)
        .filter((key) => key.includes(" "))
        .sort((a, b) => b.split(" ").length - a.split(" ").length);
}
rebuildKnownPhrases();

async function fetchAndRegisterCustomGestures() {
    try {
        const response = await fetch(SAVE_ENDPOINT + "?no_sync=1");
        if (!response.ok) return;
        const data = await response.json();
        if (data && data.success && data.gestures) {
            Object.keys(data.gestures).forEach(label => {
                const spaceLabel = label.replace(/_/g, ' ');
                const samples = data.gestures[label] || [];
                samples.forEach(sample => {
                    const lang = (sample.signLanguage || 'ESL').toUpperCase();
                    const targetMap = (lang === 'FSL') ? signAssetMapFil : signAssetMapEn;
                    if (!targetMap[label]) {
                        targetMap[label] = `${label}.webm`;
                    }
                    if (!targetMap[spaceLabel]) {
                        targetMap[spaceLabel] = `${label}.webm`;
                    }
                });
            });
            rebuildKnownPhrases();
        }
    } catch (e) {
        console.warn('Failed to load custom gestures for text-to-sign:', e);
    }
}
// Fetch custom gestures immediately
fetchAndRegisterCustomGestures();


async function playSequence(text) {
    const cleanText = normalizeSpeechText(text);
    if (!cleanText) {
        return;
    }

    let words = cleanText.split(" ");
    let sequence = [];
    
    for (let i = 0; i < words.length; i++) {
        const phrase = findLongestKnownPhrase(words, i);
        if (phrase) {
            sequence.push(phrase.text);
            i += phrase.wordCount - 1;
            continue;
        }

        sequence.push(words[i]);
    }

    for (const item of sequence) {
        await displaySignWithFallback(item);
    }
}

async function displaySignWithFallback(item) {
    const normalizedItem = normalizeSpeechText(item);
    const assetBase = getSignAssetBase();

    // 1. Check for a custom recorded .webm video in language-specific assets/signs/ folder
    const customVideoPath = `${assetBase}${normalizedItem.replace(/\s+/g, '_')}.webm`;
    const hasCustomVideo = await new Promise(resolve => {
        const v = document.createElement('video');
        v.src = customVideoPath;
        v.onloadedmetadata = () => resolve(true);
        v.onerror = () => resolve(false);
        v.load();
    });
    if (hasCustomVideo) {
        await displayMedia(customVideoPath, item);
        return;
    }

    // 2. Fall back to language-specific static asset map
    const assetMap = getActiveSignMap();
    const assetFile = assetMap[normalizedItem];
    const isSuccess = assetFile
        ? await displayMedia(`${assetBase}${assetFile}`, item)
        : false;

    if (!isSuccess && normalizedItem.length > 1) {
        // Fingerspell letter by letter using .webm from the active language folder
        const letters = normalizedItem.replace(/\s/g, "").split("");
        for (const letter of letters) {
            await displayMedia(`${assetBase}${letter}.webm`, letter, 800);
        }
    } else if (!isSuccess) {
        await displayMedia(`${assetBase}fallback.png`, item, 1200);
    } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

function normalizeSpeechText(text) {
    return String(text)
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~'()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function findLongestKnownPhrase(words, startIndex) {
    const phrases = getActiveKnownPhrases();
    for (const phrase of phrases) {
        const phraseWords = phrase.split(" ");
        const candidate = words.slice(startIndex, startIndex + phraseWords.length).join(" ");
        if (candidate === phrase) {
            return { text: phrase, wordCount: phraseWords.length };
        }
    }

    return null;
}

function displayMedia(path, label, duration = 0) {
    return new Promise((resolve) => {
        // Handle video files (.webm, .mp4)
        if (/\.(webm|mp4)$/i.test(path)) {
            const video = document.createElement('video');
            video.src = path;
            video.autoplay = true;
            video.muted = true;
            video.loop = false;
            video.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';

            video.onloadedmetadata = () => {
                currentWordDisplay.innerText = label.toUpperCase();
                signContainer.innerHTML = '';
                signContainer.appendChild(video);
                video.play().catch(() => {});
            };

            video.onended = () => resolve(true);

            video.onerror = () => resolve(false);

            video.load();
            return;
        }

        // Handle image files
        const img = new Image();
        img.src = path;

        img.onload = () => {
            currentWordDisplay.innerText = label.toUpperCase();
            signContainer.innerHTML = `<img src="${path}" alt="${label}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
            
            if (duration > 0) {
                setTimeout(() => resolve(true), duration);
            } else {
                resolve(true);
            }
        };

        img.onerror = () => {
            resolve(false);
        };
    });
}

// ── Microphone Selection Logic ──
(function () {
    const micSelect = document.getElementById('tts-mic-select');
    if (!micSelect) return;

    let lastDeviceListHash = "";

    function loadMicrophones() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.warn("Media devices API not supported");
            return;
        }

        // Prevent clearing dropdown if the user is currently selecting/interacting with it
        if (document.activeElement === micSelect) {
            console.log("[Mic Selector] Dropdown is active/open, skipping rebuild to prevent immediate closing.");
            return;
        }

        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const audioMics = devices.filter(d => d.kind === 'audioinput');
                
                // Compare device list to skip re-rendering if nothing actually changed
                const currentHash = audioMics.map(d => d.deviceId + d.label).join("|");
                if (currentHash === lastDeviceListHash) {
                    return;
                }
                lastDeviceListHash = currentHash;

                micSelect.innerHTML = '<option value="">Default Microphone</option>';
                audioMics.forEach(mic => {
                    const option = document.createElement('option');
                    option.value = mic.deviceId;
                    option.textContent = mic.label || `Microphone (${mic.deviceId.slice(0, 5)}...)`;
                    micSelect.appendChild(option);
                });

                const savedMicId = localStorage.getItem('selectedMicId');
                if (savedMicId && audioMics.some(m => m.deviceId === savedMicId)) {
                    micSelect.value = savedMicId;
                } else {
                    // Auto-select AB13X or USB Audio mic automatically if found
                    const targetMic = audioMics.find(m => {
                        const label = (m.label || "").toLowerCase();
                        return label.includes('ab13x') || label.includes('usb audio');
                    });
                    if (targetMic) {
                        micSelect.value = targetMic.deviceId;
                        localStorage.setItem('selectedMicId', targetMic.deviceId);
                        console.log("[Mic Selector] Auto-selected USB microphone:", targetMic.label);
                    }
                }
            })
            .catch(err => {
                console.error("Error enumerating devices:", err);
            });
    }

    micSelect.addEventListener('change', function () {
        localStorage.setItem('selectedMicId', this.value);
    });

    window.loadMicrophones = loadMicrophones;
    loadMicrophones();

    if (navigator.mediaDevices) {
        navigator.mediaDevices.addEventListener('devicechange', loadMicrophones);
    }
})();
