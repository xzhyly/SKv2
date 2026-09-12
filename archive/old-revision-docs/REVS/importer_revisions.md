# Sining Kamay — Kiosk Bulk Importer Revision History (REVS)

This document records the exact changes, debugging paths, and feature enhancements made to resolve the bulk importer issues on the kiosk platform.

---

## ?? Revision 1: WebGL Memory Access Crash & WASM Warm-up
* **Issue:** MediaPipe WASM extraction crashed with \RuntimeError: memory access out of bounds\ at the start of the batch queue.
* **Cause:** Passing the raw \ideoElement\ (while seeking) directly to \handsDetector.send\ caused GPU texture memory mapping crashes in the WebGL context.
* **Fix Applied:**
  1. Updated \ulk-importer.html\ to copy the seeked video frame onto a dedicated offscreen canvas first before sending.
  2. Implemented a **WASM warm-up phase** which sends a dummy black frame on load. This forces the browser to initialize WebGL before processing user files.
  3. Changed loop error handling to skip bad frames instead of throwing.

---

## ?? Revision 2: Corrupted TFLite Model Replacement
* **Issue:** The importer still crashed on frame 1 with \memory access out of bounds\ even on clean browser loads.
* **Cause:** The neural network asset file \js/lib/mediapipe/hand_landmark_full.tflite\ in the workspace was **truncated/corrupted (2.4MB)**. The complete working model should be **5.4MB**.
* **Fix Applied:**
  1. Copied the valid \5,478,688 bytes\ TFLite model from the working \Sining_kamay\ directory to the active \SKR\ directory.
  2. Applied \?v=timestamp\ query cache-busting to force browser reload.

---

## ?? Revision 3: Seek Safety Timeout (Stuck on Q.mp4)
* **Issue:** Batch processing froze at state \EXTRACTING\ when encountering specific videos (like \Q.mp4\).
* **Cause:** The async seek promise (\wait tempVideo.onseeked\) had no timeout safeguard. If a video had corrupted keyframes, the browser never fired the event.
* **Fix Applied:** Added a **250ms safety timeout** wrapper to \onseeked\.

---

## ?? Revision 4: BOTH Datasets & Automatic Tagalog Translation
* **Issue:** Hand gestures for letters are identical, but users had to upload them separately for ESL and FSL databases, leading to double work.
* **Feature Added:**
  1. Added **Both (ESL & FSL with Auto-Translate)** option to the Sign Language dropdown select.
  2. Added English-to-Tagalog automated translation using MyMemory Public translation API (with a built-in offline mapping dictionary for common words like *how are you*, *hello*, *good morning*).
  3. Saves the video and JSON in both destinations dynamically: \saved_gestures/\ (ESL) and \saved_gestures_fsl/\ (FSL).

---

## ?? Revision 5: Individual Language Duplication Skip Guard
* **Issue:** If a user already had a word in ESL and selected \"Both\" to add it to FSL, the system would create duplicate files/entries in the ESL dataset.
* **Feature Added:**
  - Integrated dynamic check before writing: If a specific dataset language (ESL or FSL) already contains the word, it skips that specific save operation but allows the missing one to be saved.
