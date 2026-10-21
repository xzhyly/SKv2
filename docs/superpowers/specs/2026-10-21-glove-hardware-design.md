# Glove hardware bring-up and glove-assisted recognition — design

Date: 2026-10-21
Status: approved in brainstorming (owner, 2026-10-21); waiting for the owner's review of this file
Builds on: `docs/system/GLOVE.md` and `docs/reports/2026-10-20-glove-serial.md` (glove-serial phase)

## Why

The glove-serial phase (2026-10-20) built a firmware starter and Settings -> Glove for **one glove, 5 flex sensors
wired straight to GPIO 32-36**. The group's real hardware is different (owner's circuit diagram, 2026-10-21):

| | glove-serial firmware | Real hardware (diagram) |
|---|---|---|
| Gloves | 1 | **2 (left and right), one ESP32** |
| Flex sensors | 5 | **10 (FS1-FS10)** |
| Reading | direct GPIO 32-36 | **CD74HC4067 16-channel mux**, FS1-FS10 on C0-C9 |
| Mux pins | — | S0 GPIO 14, S1 GPIO 27, S2 GPIO 26, S3 GPIO 25, **SIG GPIO 34**, EN GND, VCC 3V3 (0.1 µF) |
| Divider | 3V3 - sensor - pin - R - GND | same (reading drops when bent) |
| IMU | MPU6050 SDA 21 / SCL 22 | one GY-521 (MPU6050), SDA/SCL on D21/D22 |
| Power | USB | diagram also has 18650 + TP4056 + SW1 on VIN; **not used** (below) |

Owner decisions (brainstorming, 2026-10-21):
1. The diagram is the reference; the soldered build is assumed to follow it, and the code must **discover** the
   real wiring rather than trust it (finger-finding wizard, all 16 channels read).
2. The hardware is fully assembled. Arduino IDE is on the laptop; no upload to the ESP32 has been tried yet.
3. **No battery.** The glove is powered by USB only (laptop now, Pi later). SW1 stays OFF whenever USB is plugged in.
4. The kiosk is standalone: the glove stays **permanently plugged into the Pi** inside the kiosk. Turning it on/off
   is a **UI button**, not plugging.
5. The glove's setup (finger map, calibration, camera handedness) is **saved on the ESP32**, so it is set up once
   on the laptop and is plug-and-play on the Pi.
6. Glove button in Let's Talk: **default OFF**, and back to **OFF at every conversation end** (End Conversation,
   idle timeout, "+ New conversation").
7. Recognition uses the glove by **re-ranking the k-NN's top guesses with finger bend computed from the existing
   model rows** (no re-recording, no model-file change).
8. The leave-one-signer-out accuracy test stays at the very end of the project; this design does not claim an
   accuracy gain.

Two phases, with a stop between them: **Phase 1** (hardware, laptop) must pass on the real glove before **Phase 2**
(recognition + UI button) starts.

---

## Phase 1 — hardware bring-up (laptop)

### 1.1 Firmware (`tools/glove-firmware/sk_glove/sk_glove.ino`, replaced)

- Pins exactly as the diagram (table above). Mux select: set S0-S3, wait ~10 µs, `analogRead(34)`; read all **16
  channels** every cycle, ~30 cycles/s (33 ms), ADC 12-bit, 11 dB attenuation.
- MPU6050 detected at boot on SDA 21 / SCL 22; if nothing answers, retry with the pins swapped (22/21). The hello
  says which worked.
- **Sends raw values only.** The firmware never maps channels to fingers; the page does, from the stored setup.
- **Setup storage** in ESP32 flash (`Preferences`, survives unplugging): one JSON string, at most 1 KB, written and
  read verbatim. The firmware does not parse it beyond checking it is valid length/UTF-8.
- Boot: hello. Commands (one line each, `\n`): `hello`, `ping` (unchanged), `cfg-get`, `cfg-set <json>`,
  `cfg-clear`.
- A plain **Serial Monitor check** works without the kiosk: the data lines show 16 numbers that change when a
  finger bends.

### 1.2 Protocol v2 (`docs/system/GLOVE.md`, rewritten)

```json
{"type":"hello","device":"sk-glove","fw":"2.0","channels":16,"imu":true,"i2c":"21/22","cfg":{...}|null}
{"t":123456,"ch":[1840,3410,...16 values],"imu":{"ax":0.02,"ay":-0.21,"az":0.97,"gx":1.5,"gy":-0.4,"gz":31.0}}
{"type":"pong","t":123500}
{"type":"cfg","cfg":{...}|null}
{"type":"cfg-ok"}  /  {"type":"cfg-error","why":"too long"}
```

The stored `cfg` (written by the page, version-tagged):

```json
{"v":1,
 "map":{"L":[c,c,c,c,c],"R":[c,c,c,c,c]},
 "cal":{"L":{"open":[5],"fist":[5]},"R":{"open":[5],"fist":[5]},"at":"ISO time"},
 "cam":{"mirror":true|false},
 "imuHand":"L"|"R"|null,
 "w":0.3}
```

- `map`: mux channel (0-15) per finger, thumb -> pinky; `null` for a finger the wizard skipped.
- `w`: glove strength for Phase 2 re-ranking (2.2); Phase 1 writes the default 0.3.
- `cam.mirror`: whether MediaPipe's "Left"/"Right" label must be swapped to mean the wearer's left/right on this
  kiosk's camera (set by the wizard's camera step).
- Bad-line rules unchanged (counted, shown red, never throw). A data line must have exactly 16 integers 0-4095.
- Firmware 1.x lines (`f` with 5 values) are reported as "old firmware: flash sk_glove 2.0".

### 1.3 `js/glove.js` (`window.SKGlove`, extended, same style)

- Parser for protocol v2; `latest()` returns `{ t, ch: [16], hands: { L: {raw:[5], norm:[5]}, R: {...} }, imu,
  at }` once a `cfg` with a map exists, else only `ch`.
- Normalization per finger as today: `(raw - open) / (fist - open)`, clamped 0..1, moving average of 3; a finger
  with `|fist - open| < 50` or no channel reads `null` (not 0) so later code can skip it.
- `config()` (last `cfg` from the glove), `saveConfig(cfg)` (sends `cfg-set`, resolves on `cfg-ok`, rejects on
  `cfg-error` or 2 s timeout), `clearConfig()`.
- `ready()`: connected **and** a `cfg` with a map and a calibration — the single test other pages use.
- The localStorage calibration of the glove-serial phase is dropped (the glove holds it); the simulator switch
  stays per kiosk.
- **Simulator** updated: 16 channels, two hands on C0-C9 in diagram order, a stored `cfg` it keeps in memory,
  the new commands, one bad line about every 5 s.

### 1.4 Settings -> Glove (`settings.html`, admin only)

Same theme, 1024x600, no modals, every control >= 44 px.

- **Status line**: device, firmware, channels, IMU yes/no (+ pins), readings/s, "setup saved on glove: date" or
  "not set up".
- **Two hands**: left and right, 5 bars each (thumb -> pinky), shown once a map exists.
- **Set up glove** (full screen, steps, Back / Skip / Next):
  1. *Find the fingers* — "Bend your RIGHT thumb", ... "LEFT pinky" (10 steps). For each step the channel with the
     largest change over 2 s (vs a 1 s rest baseline) is taken. Warnings: no channel moved by more than 150 (offer
     Retry / Skip finger); the channel is already used by another finger (offer Retry).
  2. *Calibrate* — both hands open 3 s, both fists 3 s, median per finger (existing method, now 10 fingers).
  3. *Camera* — "Raise your RIGHT hand in front of the camera": MediaPipe Hands runs on the kiosk camera for up to
     5 s (Settings loads the vendored `js/lib/mediapipe/hands.js`, offline, only for this step); the handedness label it gives (score >= 0.8) sets `cam.mirror`. Skippable (then Phase 2 uses the
     "unsure" rule below for every frame).
  4. *IMU hand* — "Which hand has the sensor box?" Left / Right (shown only when `imu` is true).
  5. *Save* — `saveConfig()`; on `cfg-ok`: "Saved on the glove." On failure the setup stays on screen with Retry.
- **Debug** (existing panel): adds a **16-channel raw table** (value, min, max, range, "used by: R index") and the
  `cfg` JSON; hints add "channel N never changes" and "old firmware".

### 1.5 Pi preparation (`tools/pi/pi-setup.sh`, `docs/system/PI-SETUP.md`)

- Add the kiosk user to `dialout`.
- Chromium managed policy `SerialAllowUsbDevicesForUrls` for `http://localhost` with the ESP32's USB-UART
  vendor/product IDs, so `getPorts()` returns the glove after boot with no port picker. The IDs are **not
  assumed**: Settings -> Glove -> Debug shows the connected port's `usbVendorId` / `usbProductId`
  (`port.getInfo()`), and the owner's Phase 1 checklist records them from the laptop; `pi-setup.sh` takes them
  as parameters, with CP210x (10c4:ea60) and CH340 (1a86:7523) as the default list.

### 1.6 Phase 1 checks

- Automatic (simulator, headless Chrome 1024x600, extending `tests/glove/settings-check.mjs`): connect, hello v2,
  16-channel table, full wizard run with simulated bends, save -> `cfg-ok` -> reload -> setup read back from the
  glove, hints, no page scroll, 0 console errors.
- Firmware: compiled with `arduino-cli` (esp32 core) in the workspace if the toolchain can be downloaded there;
  otherwise the report says it was not compiled.
- **Owner checklist (real glove, laptop)**: driver/COM port, upload, Serial Monitor shows 16 changing numbers,
  Connect in Settings, wizard (each finger found), calibrate (~0 open / ~1 fist), unplug/replug keeps the setup,
  note the USB IDs shown in Debug.

---

## Phase 2 — glove-assisted recognition and the ON/OFF button

Starts only after the owner reports Phase 1 passing on the real glove.

### 2.1 Finger bend from model rows (`js/glove-bend.js`, new)

- A model row is 126 numbers: two hand slots of 21 points (x, y, z), wrist-relative and scaled
  (`flattenHand`, `js/gesture-data.js`). A slot of all zeros = no hand.
- `bend(slot) -> [5]` per finger, 0 = straight, 1 = fully bent, from joint angles (MCP, PIP, DIP; thumb CMC, MCP,
  IP), scaled by fixed per-finger ranges. Angles are unaffected by the scaling and by the x-mirror `knnPredict`
  tries, so the same function serves both.
- Computed **once per loaded model** (all rows) and kept in memory next to `knnModel`; no change to the model file,
  `knn-compile.js` or Compile. Load time and memory on the Pi are measured in Phase 2 and reported.

### 2.2 Re-ranking (`js/glove-bend.js`, called from `js/talk-signing.js` and `js/gesture-training-ui.js`)

Runs only when the glove button is ON **and** `SKGlove.ready()` **and** the live glove data is fresher than 200 ms.
Otherwise `knnPredict`'s result is used unchanged.

For one frame:
1. `knnPredict(f)` as today -> `scores`.
2. **Which glove hands count this frame** (from MediaPipe's live result for the same frame):
   - no hand seen -> glove not used;
   - each seen hand's handedness label (score >= 0.8), swapped if `cam.mirror`, gives L or R; a hand whose label is
     below 0.8 -> **glove not used this frame** (better no help than wrong help);
   - only the seen hands' gloves are compared.
3. For each of the **top 5 labels** only: take that label's rows; a row slot of all zeros means the sign uses one
   hand there. Compare the counted glove hands with the row's non-empty slots, trying both slot orders (slots are
   not stored by handedness) and keeping the better; fingers that read `null` are skipped. Distance = mean absolute
   difference of bend (0..1). The label's glove distance = the mean of its best 5 rows.
4. `score' = score - W x distance` for those 5 labels; labels outside the top 5 are unchanged. The result goes
   into the existing rolling filter and debounce untouched.
5. `W` ("glove strength") is one admin setting in Settings -> Glove, default 0.3, range 0-1, stored on the glove
   in `cfg` as `w`. It is not tuned in this phase (decision 8).
6. **Not worn**: if all counted fingers changed by less than 0.05 over the last 3 s, the glove is not used until
   they move again.

The MPU6050 is not used in recognition (shown in Settings only).

### 2.3 UI button

- **Let's Talk signing screen** (`talk.html`, `js/talk-signing.js`): a "🧤 Gloves: OFF" toggle near the camera,
  >= 44 px, same theme, no modal. **Shown only while `SKGlove.ready()`**; it disappears (and the glove stops being
  used) when the glove disconnects, and reappears when it reconnects. Default OFF; set back to OFF at End
  Conversation, the idle timeout and "+ New conversation". ON is visibly different (filled colour + label "ON").
- **Train Gestures Steps 3/4** (`gesture-training.html`): the same toggle, so the admin can compare ON vs OFF.
- `talk.html` and `gesture-training.html` load `js/glove.js` and `autoReconnect()` on page load; nothing about
  the glove is shown anywhere when no glove is set up. Learn Signs, Quiz and Speak or Type are unchanged.

### 2.4 Phase 2 checks

- `bend()` on real model rows: letter/number signs known to be a fist read high, open-hand signs read low
  (sign keys listed in the report, measured, not estimated).
- Re-ranking unit checks: one-hand row vs two gloves; slot order swapped; `null` fingers; unsure handedness ->
  unchanged scores; stale glove data -> unchanged scores.
- Simulator page checks (1024x600): button hidden with no glove; shown after setup; OFF by default; back to OFF
  after End Conversation, idle timeout, "+ New conversation"; disappears on simulated disconnect while the
  conversation continues; 0 console errors.
- Owner checklist on the real glove: wear both gloves, ON vs OFF on a few look-alike letters; then the Pi.

---

## Out of scope

- Battery/wireless operation; any change to the TP4056/18650 wiring.
- Recording glove values into new samples (owner chose re-ranking from existing rows).
- Using the IMU in recognition.
- Measuring accuracy (leave-one-signer-out test at the end of the project).

## Files

| Phase | File | Change |
|---|---|---|
| 1 | `tools/glove-firmware/sk_glove/sk_glove.ino`, `tools/glove-firmware/README.md` | rewritten for the mux, 16 channels, setup storage; README wiring = the diagram, Windows driver + first upload steps |
| 1 | `docs/system/GLOVE.md` | protocol v2 |
| 1 | `js/glove.js` | v2 parser, config on the glove, two hands, simulator v2 |
| 1 | `settings.html` | two hands, setup wizard, 16-channel debug, USB IDs |
| 1 | `tools/pi/pi-setup.sh`, `docs/system/PI-SETUP.md` | dialout, Chromium serial policy |
| 1 | `tests/glove/settings-check.mjs` | v2 checks |
| 2 | `js/glove-bend.js` (new) | bend from rows, re-ranking |
| 2 | `js/talk-signing.js`, `talk.html`, `js/gesture-training-ui.js`, `gesture-training.html` | toggle + re-rank hook |
| 2 | `docs/system/ML.md`, `docs/system/UI.md` | glove re-ranking, the button |
| both | `docs/reports/<date>-glove-hw-final.md`, `docs/reports/<date>-glove-recog-final.md` (date = the day each phase ends) | phase reports |
