# Design & Execution Plan: Smart Glove Kiosk Fusion & Zero-Re-recording Accuracy Boost

**Date:** 2026-11-17  
**Branch:** `glove-kiosk-ux` (Base: `touch-ux` @ `8977b0f`)  
**Target Hardware:** Raspberry Pi 4B (1024×600 Kiosk Touchscreen) + ESP32 Smart Glove (10 Flex Sensors) + USB Camera  
**Core Objective:** Enable seamless kiosk glove connection for Guests & Users (no admin login needed) and drastically improve sign recognition accuracy (with or without gloves) **with ZERO re-recording of the existing dataset**.

---

## 1. Architecture & Design Overview

```
                                  +------------------------------+
                                  |     Live Camera (Webcam)     |
                                  +--------------+---------------+
                                                 |
                         +-----------------------+-----------------------+
                         |                                               |
                         v                                               v
              [MediaPipe Hand/Arm]                               [Body Zone Detector]
            Raw Wrist (X, Y) Coordinates                    Upper (Face) / Mid (Chest) / Lower
                         |                                               |
                         v                                               v
            [Normalized 21 Landmarks]                       [Location Filter & Booster]
                         |                                               |
                         +-----------------------+-----------------------+
                                                 |
                                                 v
                                   [k-NN Classifier (Top-5)]
                                                 |
                                                 v
                                   +-------------+-------------+
                                   | Is 🧤 Glove Connected/ON? |
                                   +-------------+-------------+
                                          /              \
                                     YES /                \ NO
                                        v                  v
                             [Flex Sensor Re-ranking]    [Final Candidate]
                             Matches C0–C4 / C5–C9              |
                                        |                       |
                                        +----------->-----------+
                                                    |
                                                    v
                                      [Translated Sign & Audio]
```

---

## 2. Key Modules & Exact Code Changes

### Module 1: Kiosk Glove Auto-Detection & Camera-Screen Connect
**Files to update:** `js/glove.js`, `js/glove-assist.js`, `talk.html`

1. **Auto-Reconnect Fix (`js/glove.js`):**
   * Update `navigator.serial.addEventListener('connect', ...)` to trigger `autoReconnect()` regardless of whether `state` is `'disconnected'` or `'reconnecting'` when a USB cable is plugged in.
2. **Camera Chip States (`js/glove-assist.js` & `talk.html`):**
   * Instead of hiding `#glove-chip` when disconnected, support 4 visible interactive states:
     * `🔌 Connect Glove` (Translucent gray): Glove unplugged or needs first-time port permission. Tapping calls `SKGlove.connect()` directly on the camera.
     * `⏳ Connecting…`: Initializing handshake (`hello` and `cfg-get`).
     * `🧤 Gloves` (Translucent dark, white text): Connected and calibrated (ESP32 flash), **Default OFF**.
     * `🧤 ON` (Solid white, navy text, green dot): Actively assisting translation.
   * **100% Optional:** Page load is ALWAYS OFF by default. Normal camera translation runs smoothly if the user does not tap the chip.

---

### Module 2: Zero-Re-recording Wrist Zone Location Boost
**Files to update:** `js/gesture-data.js`, `js/talk-signing.js`

1. **Why It Works Without Re-recording:**
   * Every recorded sample in `saved_gestures/*/sample_*.json` already contains `landmarks[0].y` (the raw wrist height on screen, 0.0 top to 1.0 bottom).
2. **Zone Mapping (Derived Automatically):**
   * Signs naturally cluster into 3 vertical body zones:
     * **Zone 1 (Head / Face):** `wrist.y < 0.40` (*hello*, *father*, *mother*, *know*, *think*, *doctor*)
     * **Zone 2 (Chest / Torso):** `0.40 <= wrist.y <= 0.72` (*please*, *thank you*, *me*, *help*, *want*, *healthy*)
     * **Zone 3 (Lower / Neutral):** `wrist.y > 0.72` (*walk*, *run*, *down*, *sit*)
3. **Inference Boost Logic:**
   * When `knnPredict` generates the top-5 candidate scores, compare the live wrist `y` with the expected zone.
   * If a candidate's expected zone matches the live wrist position: **Boost confidence score**.
   * If a candidate belongs to an opposite zone (e.g., live hand is at the forehead, but candidate is a chest-only sign): **Penalize score**.
   * **Impact:** Prevents signs with identical flat-hand shapes from being confused.

---

### Module 3: Smart Flex-Sensor Reranking with Black-Glove Tolerance
**Files to update:** `js/glove-assist.js`, `js/glove-bend.js`

1. **Black-Glove Confidence Tolerance:**
   * In `js/glove-assist.js`, when Glove is ON, lower `HAND_SCORE` from `0.80` to `0.55`.
   * Even if the camera struggles with black fabric on the knuckles, the wrist position + flex sensor data allows recognition to succeed.
2. **Sensor Agreement Check:**
   * `GloveBend.rerank()` compares the ESP32's 10 flex readings (C0–C4 for right hand, C5–C9 for left hand) against the finger bend angles of the candidate signs.
   * Correct finger bends confirm the true sign even if visual hand landmarks are noisy.

---

## 3. Step-by-Step Implementation Roadmap

| Step | Task Description | Files Touched | Verification |
|:---:|---|---|---|
| **Step 1** | Implement hotplug auto-connect in `js/glove.js`. | `js/glove.js` | Test USB unplug/plug event without page reload. |
| **Step 2** | Add disconnected & interactive connect states to `#glove-chip` on camera. | `js/glove-assist.js`, `talk.html` | Click chip as Guest/User to connect without Admin login. |
| **Step 3** | Implement Wrist Location Zone scoring in `js/gesture-data.js` / `js/talk-signing.js`. | `js/gesture-data.js`, `js/talk-signing.js` | Verify forehead signs vs chest signs are differentiated. |
| **Step 4** | Adjust `glove-assist.js` confidence threshold and tie flex sensors to candidate scoring. | `js/glove-assist.js` | Test signing with glove ON vs OFF. |
| **Step 5** | Run live verification on Pi/Laptop (1024×600 kiosk viewport). | Full flow | Confirm zero-lag (FPS steady at 15–30 fps). |

---

## 4. Verification & Testing Checklist

- [ ] **No Admin Required:** A guest can connect the glove directly from the Let's Talk camera screen.
- [ ] **Zero Re-recording:** All existing 14,000+ k-NN training rows remain intact and load normally.
- [ ] **Accuracy Improvement (Without Glove):** Open-hand signs at the face vs chest no longer cross-trigger.
- [ ] **Accuracy Improvement (With Glove):** Black glove finger bends match correctly with the sign language model.
- [ ] **Performance & FPS:** MediaPipe runs at steady frames without CPU throttling or UI lag on Raspberry Pi.
