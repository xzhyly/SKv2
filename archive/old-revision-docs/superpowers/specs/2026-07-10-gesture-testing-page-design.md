# Standalone Gesture Testing Tool (gesture_test.html)

Design specification for a simple, single-page diagnostic tool to verify MediaPipe Hands performance, frame rates (FPS), and skeletal rendering.

## Goal
To visualize finger landmarks and joints, measure real-time frames per second (FPS), and ensure all Raspberry Pi optimizations (non-SIMD WebAssembly fallback, offscreen canvas downscaling) are fully operational and verified.

## User Interface Design
- **Webcam Feed Container:** Displays mirrored live webcam video.
- **Canvas Overlay:** Overlaid on top of the webcam feed to draw the 21 joints (red circles) and finger segments (green lines).
- **Control Bar:**
  - `Start Capture` button: Starts camera and initiates MediaPipe loops.
  - `Stop Capture` button: Halts webcam and resets processing loops.
- **Diagnostics Panel:**
  - **Current FPS:** Displays real-time calculations.
  - **Hand State:** Displays "No hand detected", "1 hand detected", or "2 hands detected".
  - **Landmark Coordinates:** Shows the absolute `(x, y, z)` coordinates for the index finger tip (`Landmark #8`).

## Architecture & Code Flow
1. **Camera Initialization:**
   Uses `initCameraWithFallback` or equivalent, requesting a lower resolution (320x240 or 640x480) to minimize CPU load on Raspberry Pi.
2. **MediaPipe Tracking:**
   Loads `js/lib/mediapipe/hands.js`. Initializes `window.Hands`.
   Overrides `WebAssembly.validate` to force a non-SIMD fallback on Raspberry Pi.
3. **Canvas Drawing:**
   On results:
   - Clear canvas.
   - Draw circles on each joint of the detected hands.
   - Draw lines between connected joints (wrist to knuckles, knuckle to finger tips).
4. **FPS Counter:**
   Measures time difference between consecutive `onResults` updates.

## Verification
- Load page in laptop browser. Click `Start Capture`. Verify skeleton overlay, FPS (30 FPS expected on laptop), and coordinates update.
- Load page on Raspberry Pi Chromium. Verify SIMD override log, check FPS (10-15 FPS expected on Pi 4, 30 FPS on Pi 5), and check for memory leaks or crashes.
