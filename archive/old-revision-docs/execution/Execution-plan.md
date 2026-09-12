# Execution Plan — Sining Kamay Kiosk Upgrades (AI Planner Format)

Planong magpapatupad ng standalone Bulk Importer, 2-Hand Gesture Recognition, Fast kNN Classifier para sa Sign-to-Text, at Conversational Voice Settings sa Sining Kamay project.

---

## TASK-0: Initial Data Cleanup & GitHub Sync

**Task ID:** TASK-0 | **Priority:** 🔴 Critical
**Task Status:** `[ ]` Not Started

**Objective:**
Burahin ang lahat ng mga nakakalat na gesture folders sa root directory (na mga duplicate lamang ng nasa `saved_gestures/`), at opsyonal na linisin ang mga lumang 1-hand samples para maging handa sa bagong 2-hand training. I-sync ang mga deletions na ito sa GitHub para manatiling malinis ang repository.

**Affected Files:**
```
[DELETE] c:/xampp/htdocs/SKR/<scattered_folders>
```

**Implementation Checklist:**
- [ ] Linisin ang mga nakakalat na folders sa root directory gamit ang PowerShell at i-sync sa Git:
  ```powershell
  # 1. Burahin ang mga duplicate folders sa root
  Get-ChildItem -Path c:\xampp\htdocs\SKR -Directory | Where-Object { Test-Path (Join-Path "c:\xampp\htdocs\SKR\saved_gestures" $_.Name) } | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
  
  # 2. (Optional) Kung gustong i-clear ang lahat ng samples sa saved_gestures para maging malinis ang 2-hand dataset:
  Get-ChildItem -Path c:\xampp\htdocs\SKR\saved_gestures -Directory | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
  
  # 3. I-sync ang mga binurang folder sa GitHub
  git add -A
  git commit -m "clean: remove duplicate and old gesture folders"
  git push
  ```

---

## TASK-1: Standalone Bulk Video Importer & Landmark Extractor

**Task ID:** TASK-1 | **Priority:** 🔴 Critical
**Task Status:** `[ ]` Not Started

**Objective:**
Gagawa ng isang standalone developer page `bulk-importer.html` at backend script `bulk_importer_api.php` na hahawak sa pag-upload, pag-convert ng videos gamit ang FFmpeg (para maging 360p, no audio), pagpapakita ng visual trace overlay ng landmarks gamit ang MediaPipe, at pag-save sa dataset at database.

**Affected Files:**
```
[NEW] c:/xampp/htdocs/SKR/bulk-importer.html
[NEW] c:/xampp/htdocs/SKR/php/api/bulk_importer_api.php
```

**Implementation Checklist:**
- [ ] Bumuo ng PHP API for video conversion and DB operations:
  ```php
  // php/api/bulk_importer_api.php
  // Checks local PATH or bin/ffmpeg.exe for conversion.
  // Performs: ffmpeg -i input -vf scale=360:-2 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 -r 25 -an -b:v 300k output.mp4 -y
  // Returns video path.
  // Also saves extracted landmarks to saved_gestures/<label>/sample_*.json.
  // Seeds database entries in gestures, gesture_recordings, and dictionary tables.
  ```
- [ ] Bumuo ng developer-only interface with queue manager and live canvas overlay:
  ```html
  <!-- bulk-importer.html -->
  <!-- Standalone UI for selecting folder/multiple videos. -->
  <!-- Features: File list queue, progress percentage, video display player, -->
  <!-- and canvas overlay drawing MediaPipe landmarks in real-time during trace verification. -->
  ```
- [ ] Ikonekta ang browser-side MediaPipe landmark tracker at i-save ang final data:
  ```javascript
  // Extract landmarks frame-by-frame from playing video.
  // Draw skeletal lines on canvas for user verification (both 1-hand or 2-hands).
  // Once video finishes, POST the landmark array to backend API.
  ```

---

## TASK-2: MediaPipe 2-Hand Gesture Recognition Upgrade

**Task ID:** TASK-2 | **Priority:** 🔴 Critical
**Task Status:** `[ ]` Not Started

**Objective:**
I-enable ang dalawang kamay sa MediaPipe Hands configuration at palawakin ang landmark vector size mula 63 patungong 126 coordinates, na may kasamang zero-padding kapag isang kamay lamang ang nakikita sa screen.

**Affected Files:**
```
[MODIFY] c:/xampp/htdocs/SKR/js/gesture-data.js
[MODIFY] c:/xampp/htdocs/SKR/js/gesture-training-ui.js
```

**Implementation Checklist:**
- [ ] I-update ang MediaPipe configuration at 2-hand extraction sa `gesture-data.js`:
  ```javascript
  // Set maxNumHands: 2 in Hands constructor options.
  // normalization function:
  // If 2 hands detected, concatenate Hand 1 (63 coords) and Hand 2 (63 coords) -> 126 coords.
  // If only 1 hand detected, Hand 1 = 63 coords, Hand 2 = Array of 63 zeros -> 126 coords.
  // If no hands detected, return null.
  ```
- [ ] I-align ang feature size sa `gesture-training-ui.js`:
  ```javascript
  // Set default activeFeatureSize = 126.
  // Clear any single-hand cache items or variables if size is not 126.
  ```

---

## TASK-3: Fast Sign-to-Text kNN Classifier Integration

**Task ID:** TASK-3 | **Priority:** 🟠 Medium
**Task Status:** `[ ]` Not Started

**Objective:**
I-bypass ang TensorFlow.js neural network prediction loop sa `sign-to-text.html` sa pamamagitan ng pag-integrate ng mabilis na kNN (Cosine Similarity) classification algorithm mula sa training wizard.

**Affected Files:**
```
[MODIFY] c:/xampp/htdocs/SKR/js/sign-to-text-ui.js
```

**Implementation Checklist:**
- [ ] I-implement ang Cosine Similarity at kNN prediction sa `sign-to-text-ui.js`:
  ```javascript
  // function cosineSimilarity(a, b) { ... }
  // function knnPredict(features) { ... } (loads from localStorage sining_kamay_knn_${targetLang})
  // If not found in cache, fall back to fetching samples from DB, compile kNN instantly, and save.
  ```
- [ ] Palitan ang prediction loop sa `sign-to-text-ui.js`:
  ```javascript
  // Remove tfModel.predict(inp) and tensor disposal.
  // Use knnPredict(extractFeatures(videoElement)).
  // This will completely resolve the software video rendering lag on Raspberry Pi.
  ```

---

## TASK-4: Conversational Voice Settings & Safety Net

**Task ID:** TASK-4 | **Priority:** 🟠 Medium
**Task Status:** `[ ]` Not Started

**Objective:**
Magdagdag ng panel sa Dashboard para sa TTS settings (voice selection, speed, pitch sliders) at maglagay ng Promise timeout safety net sa video/media player ng `script.js` upang maiwasan ang tuluyang pag-freeze ng Translate button.

**Affected Files:**
```
[MODIFY] c:/xampp/htdocs/SKR/js/speech-synthesis.js
[MODIFY] c:/xampp/htdocs/SKR/index.html
[MODIFY] c:/xampp/htdocs/SKR/js/script.js
```

**Implementation Checklist:**
- [ ] I-load ang voice at parameters sa `speech-synthesis.js`:
  ```javascript
  // Read voiceName, rate, pitch from localStorage.
  // Apply to SpeechSynthesisUtterance inside speakWord and speakUtterance.
  ```
- [ ] Bumuo ng Settings UI sa Dashboard (`index.html`):
  ```html
  <!-- Dropdown select for SpeechSynthesis voices -->
  <!-- Sliders for Speed (rate: 0.5 - 2.0) and Pitch (0.5 - 2.0) -->
  <!-- Save selections to localStorage on change -->
  ```
- [ ] Magdagdag ng Promise timeout sa `displaySignWithFallback` (`script.js`):
  ```javascript
  // Wrap video.onloadedmetadata / onerror and img.onload in a Promise.race with a setTimeout (1500ms).
  // Ensures that even if the GPU decoder crashes or hangs, the code proceeds and never blocks the JS thread.
  ```

---

## Master Checklist — All Tasks

| ID | Task | Priority | Status |
|---|---|---|---|
| **TASK-0** | Initial Data Cleanup & GitHub Sync | 🔴 Critical | `[ ]` Not Started |
| **TASK-1** | Standalone Bulk Importer & Landmark Extractor | 🔴 Critical | `[ ]` Not Started |
| **TASK-2** | MediaPipe 2-Hand Gesture Recognition Upgrade | 🔴 Critical | `[ ]` Not Started |
| **TASK-3** | Fast Sign-to-Text kNN Classifier Integration | 🟠 Medium | `[ ]` Not Started |
| **TASK-4** | Conversational Voice Settings & Safety Net | 🟠 Medium | `[ ]` Not Started |
