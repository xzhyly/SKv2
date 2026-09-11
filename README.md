# Gesture Dataset Structure

New landmark recordings are saved by label:

```text
saved_gestures/
  hello/
    sample_12345.json
  thank_you/
    sample_12346.json
  start/
    sample_12347.json
  stop/
    sample_12348.json
```

Each `sample_*.json` file contains:

- `label`: normalized gesture label
- `format`: `mediapipe_hands_landmarks_v1`
- `frames`: 20-40 captured MediaPipe Hands landmark frames

The existing `my_gestures.json` file is left untouched for the older exported KNN model flow.
