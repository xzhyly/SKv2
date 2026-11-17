# Glove Connection & Access Control Analysis

**Date:** 2026-11-17  
**Branch:** `touch-ux` (Commit `8977b0f`)  
**Target Platform:** Raspberry Pi 4B (1024×600 Kiosk Touchscreen) & Local PC (Dev/Test)  
**Document Purpose:** In-depth technical analysis of the existing glove subsystem implemented by Claude, the root causes of the "Admin-Only Glove Connection" bottleneck, and architectural options for guest/user access and auto-detection.

---

## 1. Executive Summary

In the current codebase, the smart glove subsystem functions properly at the hardware and algorithmic level:
* Raw 16-channel mux readings (10 flex sensors) are processed by `js/glove.js`.
* Calibration (`open`/`fist`) is saved on the ESP32's flash memory (`cfg-set`).
* Re-ranking of MediaPipe k-NN sign predictions is handled by `js/glove-bend.js` and `js/glove-assist.js`.

**The Critical Bottleneck Identified by the User:**
Currently, a user cannot use the gloves in **Let's Talk (`talk.html`)** without an Admin first logging in, navigating to **Admin -> Settings -> Glove**, and manually clicking **"Connect glove"**. If a **Guest** or **Regular User** uses the kiosk, the glove icon never appears on the camera, rendering the hardware unusable for everyday signing sessions.

---

## 2. Current Glove Architecture Breakdown

### 2.1 Core Files & Responsibilities

| File | Purpose & Responsibilities |
|---|---|
| `js/glove.js` | Low-level Web Serial driver (`window.SKGlove`). Handles `navigator.serial`, 115200 baud streaming, framing JSON lines, ESP32 handshake (`hello`, `cfg-get`, `cfg-set`), normalization of raw ADC (0–4095), and status lifecycle. |
| `js/glove-bend.js` | Mathematical layer (`window.GloveBend`). Calculates joint angles and flex distances, re-ranking the top-5 camera k-NN predictions based on glove sensor values. |
| `js/glove-assist.js` | UI & Integration glue (`window.GloveAssist`). Controls the camera glove chip (`#glove-chip`), enforces safety preconditions before applying glove assistance (`apply()`), and tracks hand idle/worn states. |
| `settings.html` | Admin settings page. Contains the **ONLY UI button** (`#g-connect`) in the entire system that executes `navigator.serial.requestPort()`. Also houses 3-step setup (Wiring check, Calibrate, Save & Test) and the Debugger console. |
| `talk.html` | Main conversation/translation interface. Embeds `#glove-chip` inside `#camera-box` and calls `SKGlove.autoReconnect()` on page load. |

---

## 3. Root Cause Analysis: Why is Glove Connection Locked to Admin?

### 3.1 The Single Entrypoint Problem (`requestPort`)
* Under the Web Serial standard, a browser cannot open a hardware serial port until user permission has been granted via a user gesture calling `navigator.serial.requestPort()`.
* In the entire codebase, `navigator.serial.requestPort()` is wrapped exclusively inside `SKGlove.connect()`:
  ```javascript
  // js/glove.js:377
  async function connect() {
    ...
    var p = await navigator.serial.requestPort();
    await openPort(p);
    ...
  }
  ```
* The only place `SKGlove.connect()` is attached to an interactive DOM event is in `settings.html`:
  ```javascript
  // settings.html:522
  $('g-connect').addEventListener('click', function () { G.connect().then(renderStatus); });
  ```
* **Because `settings.html` is strictly restricted to authenticated administrators (`auth.php` / `session.php`), Guests and non-admin Users cannot physically reach this button.**

### 3.2 The Invisible Chip Problem (`ready()` precondition in `talk.html`)
In `talk.html`, Claude designed `#glove-chip` to be completely hidden unless the glove is already connected and calibrated:
```javascript
// js/glove-assist.js:35, 171-185
function available() { return !!(G() && G().ready()); }

function chipStateNow() {
  if (!available()) return 'hidden';   // <--- Hides if glove is not ready
  if (!on) return 'off';
  ...
}
```
* `ready()` requires `status === 'connected'` AND a valid stored calibration (`cfg.cal`).
* If a Guest or User opens `talk.html` while the glove is disconnected (or hasn't been granted port permission yet):
  1. `SKGlove.ready()` evaluates to `false`.
  2. `#glove-chip` receives `hidden = true`.
  3. No glove UI or icon is rendered anywhere on the camera.
  4. There is no button or trigger for a guest or user to initiate connection.

### 3.3 The USB Hotplug Bug in `js/glove.js`
In `js/glove.js`:
```javascript
// js/glove.js:440
navigator.serial.addEventListener('connect', function () {
  if (state === 'reconnecting' && !userClosed) retry();
});
```
* When `talk.html` is loaded without a connected glove, `state` is initialized to `'disconnected'`.
* If a user plugs the ESP32 USB cable into the Raspberry Pi while on `talk.html`, the browser fires the native `connect` event.
* **Bug:** Because `state === 'disconnected'` (not `'reconnecting'`), the event handler does nothing! The device is ignored, and the page never attempts to open the newly plugged device.

### 3.4 The Chromium Policy vs URL Context Nuance
On Raspberry Pi, `tools/pi/pi-setup.sh` configures a managed Chromium policy:
```json
"SerialAllowAllPortsForUrls": ["http://localhost"]
```
* **Intent:** Allow `navigator.serial.getPorts()` and auto-connect without prompting the user.
* **Limitation:** This policy only applies if the browser URL strictly matches `http://localhost`. If the user tests via a LAN IP (e.g. `http://192.168.254.110/SKR/`), port forwarded port (`http://localhost:8080`), or local dev domain, Chromium treats it as untrusted, requiring an explicit `requestPort()` click.

---

## 4. Key Differences: What Admin Needs vs What Guests/Users Need

It is essential to separate **Administrative Setup** from **End-User Operation**:

| Feature / Action | Admin Only? | Guest / Regular User? | Notes |
|---|:---:|:---:|---|
| **Flex Sensor Wiring Check** (16-channel mux test) | **YES** | NO | Technical diagnostics only. |
| **Calibration** (Open hand 3s / Fist 3s) | **YES** | NO | Stored in ESP32 flash memory (`cfg-set`). Survives reboots and power cycles. Users do not need to re-calibrate every session. |
| **Glove Weight Adjustment** (`w`: 0.1–1.0) | **YES** | NO | Algorithmic tuning in `settings.html`. |
| **Connect / Auto-Detect USB** | NO | **YES** | Must be accessible to everyone or automated. |
| **Toggle Gloves ON / OFF** | NO | **YES** | User simply wants glove assistance during sign language translation. |

> [!IMPORTANT]
> Because calibration is already saved permanently into the ESP32 microcontroller's internal flash memory, **a guest or normal user does NOT need to configure the glove**. Once connected, the ESP32 immediately reports `hasCfg: true`, returns the calibration via `cfg-get`, and is instantly ready for translation!

---

## 5. Architectural Options for Solution Design

### Option A: Direct Camera-Screen Glove Icon / Chip (Interactive Connect & Toggle)
* **How it works:**
  - Instead of completely hiding `#glove-chip` when `SKGlove.status() !== 'connected'`, render the glove icon in a semi-transparent "Disconnected / Plugged In" state (e.g., `🧤 Connect` or `🔌 Tap to Connect`).
  - When tapped by any user (Guest, User, Admin):
    - If supported: calls `SKGlove.connect()` (`requestPort()`).
    - The browser port picker opens (or auto-grants if policy exists).
    - Upon handshake, the chip immediately transitions to `🧤 Gloves` (Ready / OFF) or `🧤 ON`.
  - If Web Serial is unsupported (e.g., Firefox or non-localhost insecure HTTP), show a brief informative toast/hint.

### Option B: True Kiosk Auto-Detection (Zero-Click Connection)
* **How it works:**
  - Fix `js/glove.js:440`: Update `navigator.serial.addEventListener('connect')` so that if `state === 'disconnected'` and a USB device is plugged in, it immediately calls `autoReconnect()` or inspects `navigator.serial.getPorts()`.
  - On page load of `talk.html` (and optionally globally on `index.html`), run a silent auto-connect attempt.
  - On Raspberry Pi with the `SerialAllowAllPortsForUrls` policy active, plugging in the glove or opening the page will instantly connect the glove in the background without any user intervention or popup dialogs.
  - When connected, `#glove-chip` lights up automatically on the camera view.

### Option C: Hybrid Approach (Recommended)
1. **Automated Background Detection:** Kiosk auto-detects and connects whenever the glove is plugged in or already present on page load (fixing the `connect` event listener in `js/glove.js`).
2. **Visual Feedback on Camera:** If the glove is plugged in but requires user consent, or if the user wants to manually initiate connection, `#glove-chip` displays a clear interactive status right on the camera view (no Admin login required).
3. **Safety Fallback:** If the glove has no stored calibration in flash, a small non-blocking message informs the user: *"Glove needs admin calibration"*.

---

## 6. Next Steps for Brainstorming & Planning

1. **Review UX Preferences:**
   - Where should the glove indicator/connection button reside? (e.g., keep it on the camera top-right chip `#glove-chip`, or add an indicator to the navbar/header).
   - How should the chip visually indicate:
     - `Disconnected / Not Detected`
     - `Connecting / Handshake`
     - `Ready (OFF)`
     - `Active (ON - Green)`
     - `Idle / Camera Only (Amber)`
2. **Scope of Code Touches:**
   - `js/glove.js`: Auto-reconnect on USB `connect` event regardless of previous state.
   - `js/glove-assist.js`: Allow `#glove-chip` to handle `connect()` when clicked in disconnected state instead of staying hidden.
   - `talk.html`: CSS & UI refinements for the interactive chip states.
3. **Draft Implementation Plan:**
   - Create a clean revision step to implement and verify without breaking camera translation or existing admin diagnostics.
