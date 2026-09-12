# 100% Offline Kiosk Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the kiosk application to run 100% offline (without any internet connection) by downloading the TensorFlow.js and MediaPipe Hands script libraries and machine learning models directly into the local project directory.

**Architecture:** 
- We will download the required scripts (`tf.min.js`, `hands.js`) and model dependencies (`hands.binarypb`, `hands_solution_packed_assets.data`, `hands_solution_simd_wasm_bin.js`, `hands_solution_simd_wasm_bin.wasm`) locally into a newly created `js/lib/` directory inside the project.
- We will update all HTML files to reference these local scripts instead of the CDN links.
- We will configure the MediaPipe initialization in `js/gesture-data.js` to search for model files locally using the `locateFile` callback.

**Tech Stack:** JavaScript, MediaPipe Hands local ML models.

## Global Constraints

- Must work 100% offline without any internet connection.
- All files must be stored inside the `c:\xampp\htdocs\Sining_kamay\` directory so that transferring the project folder to the Raspberry Pi retains full functionality.

---

### Task 1: Create Directories and Download Offline Assets

**Files:**
- Create: `c:/xampp/htdocs/Sining_kamay/js/lib/`
- Create: `c:/xampp/htdocs/Sining_kamay/js/lib/mediapipe/`

**Interfaces:**
- Consumes: MediaPipe and TensorFlow CDN assets via internet download (one-time).
- Produces: Local copy of script and binary model files in the project.

- [ ] **Step 1: Run download script in PowerShell**

Run the following command in PowerShell on the laptop to create directories and download the required JS and ML model files:
```powershell
$libDir = "c:\xampp\htdocs\Sining_kamay\js\lib"
New-Item -ItemType Directory -Force -Path $libDir
New-Item -ItemType Directory -Force -Path "$libDir\mediapipe"

# Download TensorFlow.js
Invoke-WebRequest -Uri "https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.10.0/tf.min.js" -OutFile "$libDir\tf.min.js"

# Download MediaPipe Hands Library and Models
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js" -OutFile "$libDir\mediapipe\hands.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.binarypb" -OutFile "$libDir\mediapipe\hands.binarypb"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_packed_assets.data" -OutFile "$libDir\mediapipe\hands_solution_packed_assets.data"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_simd_wasm_bin.js" -OutFile "$libDir\mediapipe\hands_solution_simd_wasm_bin.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands_solution_simd_wasm_bin.wasm" -OutFile "$libDir\mediapipe\hands_solution_simd_wasm_bin.wasm"
```
Expected: The files are downloaded successfully to `c:\xampp\htdocs\Sining_kamay\js\lib\`.

---

### Task 2: Update Script References in HTML files

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/camera-translator.html`
- Modify: `c:/xampp/htdocs/Sining_kamay/diagnostic.html`
- Modify: `c:/xampp/htdocs/Sining_kamay/gesture-training.html`
- Modify: `c:/xampp/htdocs/Sining_kamay/sign-to-text.html`

**Interfaces:**
- Consumes: Local script references.
- Produces: Local script imports.

- [ ] **Step 1: Replace CDN links in HTML files with local script tags**

Replace:
```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.10.0/tf.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
```
With:
```html
  <script src="js/lib/tf.min.js"></script>
  <script src="js/lib/mediapipe/hands.js"></script>
```
in the following files:
- `c:\xampp\htdocs\Sining_kamay\camera-translator.html`
- `c:\xampp\htdocs\Sining_kamay\diagnostic.html`
- `c:\xampp\htdocs\Sining_kamay\gesture-training.html`
- `c:\xampp\htdocs\Sining_kamay\sign-to-text.html`

---

### Task 3: Configure MediaPipe to Load Model Files Locally

**Files:**
- Modify: `c:/xampp/htdocs/Sining_kamay/js/gesture-data.js`

**Interfaces:**
- Consumes: Local model files.
- Produces: Offline model loader.

- [ ] **Step 1: Update locateFile path in js/gesture-data.js**

In [js/gesture-data.js](file:///c:/xampp/htdocs/Sining_kamay/js/gesture-data.js) (lines 177-178 and 498-499), replace:
```javascript
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
```
With:
```javascript
      locateFile: (file) => `js/lib/mediapipe/${file}`,
```

---

## Verification Plan

### Manual Verification
1. Disconnect the laptop from the Wi-Fi / Internet completely.
2. Open Chrome and navigate to `http://localhost/Sining_kamay/sign-to-text.html` or `http://localhost/Sining_kamay/gesture-training.html`.
3. Verify that the camera starts, hand tracking landmarks are detected, and prediction functions properly without any network activity.
