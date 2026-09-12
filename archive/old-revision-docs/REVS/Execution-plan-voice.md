# Voice-to-Sign Offline Performance and UX Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the path of the Vosk model in `script.js` to ensure the Voice-to-Sign offline model works flawlessly. Improve the UI behavior of the microphone button by disabling it during loading and supporting a single-click start/stop toggle.

**Architecture:**
1. Fix the Vosk model path in `js/script.js` from the absolute `/Sining_kamay/` directory to a dynamic path relative to the current project location.
2. Initialize Vosk model status during page load and disable the microphone button with a loading indicator until the model is fully loaded.
3. Replace any double-click or delayed interactions with a clean single-click toggle state.

**Tech Stack:** JavaScript, Vosk Speech Recognition API.

## Global Constraints
- Do not affect Text-to-Sign translations.
- Suppress browser errors related to media stream access.
- Support touchscreen devices without double-tap delay.

---

### Task 1: Fix Model Path and Add Button Loading States

**Files:**
- Modify: [script.js](file:///c:/xampp/htdocs/SKR/js/script.js)

**Interfaces:**
- Consumes: Vosk model load promise.
- Produces: Enable state and red-glow toggle behavior for microphone button.

- [ ] **Step 1: Locate and modify Vosk model URL path**
  Find `modelUrl` initialization in `initModel()` inside `js/script.js`. Change it to use a location-relative path.
  ```javascript
  const modelUrl = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/models/vosk-model-small-en-us-0.15.tar.gz.zip';
  ```

- [ ] **Step 2: Add microphone button loading state**
  During model load, disable the start button and show a loading indicator. Once loaded, restore active states.
  
  Modify `initModel()` to manage the button disabled state:
  ```javascript
  async function initModel() {
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
          const modelUrl = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/models/vosk-model-small-en-us-0.15.tar.gz.zip';
          this.model = await Vosk.createModel(modelUrl);
          console.log("[Vosk] Offline model loaded!");
          
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
          if (micLabel) {
              micLabel.textContent = "Offline Model Load Failed";
              micLabel.style.color = '#ef4444';
          }
      }
  }
  ```

- [ ] **Step 3: Clean up button toggle interface**
  Ensure the single-click listener works reliably without double clicks or multiple clicks during initialization. Ensure that once clicking active, the button stays red and clicks again to stop.
  
  ```javascript
  // Handle start and stop toggle smoothly
  ```

- [ ] **Step 4: Commit changes to Git**
  ```bash
  git add js/script.js
  git commit -m "perf: fix Vosk offline model path and add loading UI state for microphone"
  ```

---

## Verification Plan

### Manual Verification
1. Open Chrome/Brave and navigate to `http://localhost/SKR/index.html?screen=voice`.
2. Confirm the microphone button is initially disabled with label "Loading Offline AI Model...".
3. Verify the label changes to "Tap to Speak" and the button becomes clickable.
4. Test clicking the button once: it should glow red and change label to "Tap to Stop".
5. Speak "hello" or "water" and click once again to stop. Verify the translation animation plays correctly.
