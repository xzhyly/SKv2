# GLOVE.md — optional wired data gloves (protocol v2, glove-hw phase, 2026-10-21)

Two gloves (left and right) with 10 flex sensors on a CD74HC4067 16-channel mux, one ESP32, an optional MPU6050,
on one USB cable to the Pi (or the laptop while testing). Hardware and decisions:
`docs/superpowers/specs/2026-10-21-glove-hardware-design.md`. Protocol v1 (5 fingers on GPIO 32-36, glove-serial
phase 2026-10-20) is replaced; a v1 glove is reported as "old firmware".

What exists:
- the protocol (this file);
- `js/glove.js` (`window.SKGlove`);
- Settings -> Glove with Set up glove and the debugger (`settings.html`);
- the firmware (`tools/glove-firmware/sk_glove/`).

**Recognition uses the glove only while 🧤 is ON** (Phase 2, section "Glove in recognition" below): it re-ranks the
camera k-NN's top 5 guesses; it never replaces the camera.

Everything that reads or writes glove lines follows this file: the firmware, `js/glove.js` and its simulator.

**Since the glove-static phase (2026-10-22) the finger wiring is fixed in hardware** (section "Fixed wiring"): Set up
glove no longer searches for the fingers or asks for the camera, it is 1 Check wiring, 2 Calibrate, 3 Save + Test.

## Hardware (as the owner's diagram)

| | |
|---|---|
| Mux select | S0 GPIO 14, S1 GPIO 27, S2 GPIO 26, S3 GPIO 25 |
| Mux output | SIG -> GPIO 34 (ADC1); EN -> GND; VCC 3V3 with 0.1 µF |
| Sensors | FS1-FS10 on C0-C9, in the fixed order below. Each a voltage divider with a resistor. **Measured on the owner's glove (2026-10-22): 0 straight, rising to 2846-4095 fully bent** (C0-C9; the opposite of what the diagram's divider suggested). Calibration works either way |
| IMU | MPU6050 / GY-521 on I2C SDA 21 / SCL 22 (the firmware also tries 22 / 21) |
| Power | USB only. The diagram's 18650 + TP4056 + SW1 are not used: SW1 OFF while USB is plugged in |

## Fixed wiring (glove-static phase, 2026-10-22)

One constant, `MAP` in `js/glove.js` (`SKGlove.MAP`); everything else reads it.

| Finger | RIGHT hand | LEFT hand |
|---|---|---|
| Thumb | C0 | C9 |
| Index | C1 | C8 |
| Middle | C2 | C7 |
| Ring | C3 | C6 |
| Pinky | C4 | C5 |

C10-C15 are unused. Left and right come from this table, not from the camera. What the camera step used to measure
(`cam.mirror`: does MediaPipe call the wearer's right hand "Left"?) is still needed by Let's Talk to pair a hand on
screen with a glove, but it follows from the code, not the camera: MediaPipe labels handedness as if the picture
were a mirrored selfie, and `js/gesture-data.js` sends it the camera's own unmirrored frames (`selfieMode` is not
set, `js/gesture-data.js:250-255`), so the right hand reads "Left". `DEFAULT_MIRROR = true` in `js/glove.js` is used
for every setup with no `cam`; a `cam` measured by the old camera step is kept. A camera that mirrors its own
picture in hardware would need `cam.mirror: false` (not handled by any screen now).

## Link

| | |
|---|---|
| Transport | USB serial (the ESP32's USB-UART bridge), **115200 baud**, 8N1 |
| Framing | one JSON object per line, UTF-8, ending in `\n` (a `\r` before it is ignored) |
| Rate | about **30 data lines per second** (one every ~33 ms) |
| Browser | Web Serial (`navigator.serial`), Chromium / Chrome only |
| Secure context | Web Serial exists only in a secure context. **`http://localhost` counts (the kiosk), a LAN address such as `http://192.168.1.20/SKR/` does not**, and neither does Firefox. The page then shows "This browser can't use the glove." |
| Pi | `tools/pi/pi-setup.sh` sets the Chromium policy `SerialAllowAllPortsForUrls: ["http://localhost"]` (no port picker) and adds the kiosk user to `dialout` |

## Glove -> page

**Hello**, sent once on boot and again whenever the page sends `hello`:

```json
{"type":"hello","device":"sk-glove","fw":"2.0","channels":16,"imu":true,"i2c":"21/22","hasCfg":true}
```

- `imu`: `false` when no MPU6050 answered at boot (on either pin order); `i2c` is the order that worked, SDA/SCL.
- `hasCfg`: a setup is stored on the glove. The hello never carries the setup itself, so a damaged stored setup
  cannot break it. After a hello with `hasCfg: true` the page sends `cfg-get`.

**Data**, about 30 per second:

```json
{"t":123456,"ch":[3290,3310,3305,1320,3275,3301,3288,3296,3310,3279,41,38,29,44,35,40]}
{"t":123489,"ch":[...16 values...],"imu":{"ax":0.02,"ay":-0.21,"az":0.97,"gx":1.5,"gy":-0.4,"gz":31.0}}
```

- `t`: the glove's `millis()`, an integer that only grows (it restarts at 0 on reboot).
- `ch`: **16 integers, raw ADC 0-4095** (12-bit), mux channels C0-C15 in order. The firmware never says which
  channel is which finger; the fixed wiring (`SKGlove.MAP`) does. Unused channels read whatever their pin floats to.
- `imu` (only when the hello said `imu: true`): `ax ay az` in **g**, `gx gy gz` in **degrees per second**, at most
  2 decimals each.

**Answers:**

```json
{"type":"pong","t":123500}
{"type":"cfg","cfg":{...the stored setup, verbatim...}}
{"type":"cfg","cfg":null}
{"type":"cfg-ok"}
{"type":"cfg-error","why":"too long"}
```

## Page -> glove

One line each, ending in `\n`:

| Line | Answer |
|---|---|
| `hello` | the hello line again |
| `ping` | `{"type":"pong","t":<millis>}` (the page measures the round trip) |
| `cfg-get` | `{"type":"cfg","cfg":<stored setup or null>}` |
| `cfg-set <json>` | stores `<json>` in flash (survives unplugging) -> `cfg-ok`; `cfg-error` with `why`: `empty`, `too long` (over 1,000 characters), `not a JSON object`, `line break inside`, `flash write failed` |
| `cfg-clear` | removes the stored setup -> `cfg-ok` |

Anything else is ignored by the firmware. The firmware stores `cfg-set` text **verbatim** (it only checks the
length and the outer `{ }`); the page validates the setup before sending it and after reading it back.

## The setup (stored on the glove)

```json
{"v":1,
 "map":{"L":[9,8,7,6,5],"R":[0,1,2,3,4]},
 "cal":{"L":{"open":[3290,3301,3288,3296,3310],"fist":[1300,1302,1298,1299,1301]},
        "R":{"open":[...5],"fist":[...5]},"at":"2026-10-21T12:00:00.000Z"},
 "cam":{"mirror":true},
 "imuHand":"R",
 "w":0.3}
```

| Key | |
|---|---|
| `v` | 1 |
| `map.L` / `map.R` | always the fixed wiring (`SKGlove.MAP`), thumb -> pinky; written so an older kiosk can still read the setup. Optional when reading |
| `cal` | open and fist values per finger (median of 3 s each), and when; `null` before calibration |
| `cam.mirror` | `true` when MediaPipe labels the wearer's **right** hand "Left"; `DEFAULT_MIRROR` (`true`) when not stored (section "Fixed wiring") |
| `imuHand` | the hand with the MPU6050, or `null`. Set up glove no longer asks; a stored value is kept |
| `w` | glove strength for the Phase 2 re-ranking, 0-1, default 0.3 |

`SKGlove.validateConfig(c)` is the rule: anything else (wrong version, a channel outside 0-15, a 6th finger, a
value outside 0-4095, `cal` without `at`, `w` outside 0-1, ...) is not valid. A stored setup that is not valid
JSON or not valid is reported as **damaged** ("run Set up glove again").

**Old setups** (saved before the glove-static phase, with the finger map Set up glove found): the stored map is
ignored. Its calibration is kept only when every channel of the fixed wiring had one there; it is then re-keyed by
channel (the calibration of C9 goes to the left thumb, whichever finger it belonged to before) and
`SKGlove.calibrationFrom()` is `'moved'` (Settings: "kept from the old setup, re-keyed to the fixed wiring"). Otherwise
the calibration is dropped (`'dropped'`, "Calibration needed: the old setup used another wiring"), `ready()` is false
and the glove stays hidden in Let's Talk until Set up glove runs again. The next save writes the fixed map.

## Bad lines

A line that is not valid JSON, or valid JSON that is none of the lines above:
- is **counted** ("bad lines");
- is shown **in red** in the debugger console with the reason, e.g. "not JSON: Unexpected end of JSON input",
  "ch must be 16 integers 0-4095", "old firmware (5 fingers): flash sk_glove 2.0";
- **never** stops the reader or throws into the page. Empty lines are skipped and not counted.

## Values the page derives (`js/glove.js`)

- **Per finger** (always, through the fixed wiring): `raw` = the finger's channel; `norm` = `(raw - open) / (fist - open)`,
  clamped to 0..1 (0 = open hand, 1 = fist), then a moving average of the last 3 readings. A sensor that reads
  lower when bent just has `fist < open` (a negative span), so nothing is inverted by hand.
  - No calibration yet: `raw / 4095`.
  - A finger whose open and fist are less than 50 apart (`MINSPAN`): `norm` is `null` (ignored, not 0).
- **IMU on the page**: tilt X = `atan2(ay, az)`, tilt Y = `atan2(-ax, hypot(ay, az))` (degrees), turn = `gz`.

## `window.SKGlove`

| Member | |
|---|---|
| `CHANNELS`, `FINGERS`, `HANDS`, `DEFAULT_W` | 16, thumb..pinky, `['L','R']`, 0.3 |
| `MAP`, `DEFAULT_MIRROR`, `MINSPAN` | the fixed wiring `{ R: [0,1,2,3,4], L: [9,8,7,6,5] }`, `true`, 50 |
| `isSupported()` | Web Serial present (or the simulator is on) |
| `status()` | `'unsupported'` / `'disconnected'` / `'connecting'` / `'connected'` / `'reconnecting'` |
| `connect()` | opens the port picker (`requestPort`, needs a tap), then the port. Simulator mode: starts the simulator |
| `autoReconnect()` | on page load: a port this browser already may use (`getPorts()`) is opened with no prompt |
| `disconnect()` | closes the port (or stops the simulator); no auto-reconnect afterwards |
| `send(line)` / `ping()` | writes one line / sends `ping` (the next pong fires `pong` with `{ rtt }`) |
| `on(event, cb)` | `'status'`, `'data'`, `'hello'`, `'config'`, `'raw'`, `'error'`, `'pong'`; returns an unsubscribe function |
| `latest()` | `{ t, ch: [16], hands: { L: { raw: [5], norm: [5] }, R: {...} }, imu, at }`, or null |
| `info()` | the last hello, or null |
| `config()` / `configState()` | the validated setup or null / `'unknown'`, `'none'`, `'ok'`, `'damaged'` |
| `validateConfig(c, info)` | a clean copy of a valid setup (map = `MAP`), or null; `info.cal` says what happened to the calibration |
| `calibrationFrom()` | for the setup read from the glove: `'none'`, `'same'`, `'moved'` (old map, re-keyed) or `'dropped'` (old map, calibrate again) |
| `saveConfig(c)` / `clearConfig()` | `cfg-set` / `cfg-clear`; resolve on `cfg-ok`, reject on `cfg-error`, a 2 s timeout or when not connected |
| `ready()` | connected **and** a setup with a calibration: the one test other pages use |
| `stats()` / `resetMinMax()` / `log()` | debugger counters, per-channel min/max (16), the last 2,000 lines |
| `simulator(on)` / `isSimulator()` / `simSetBend(ch, bend)` | the simulator source; hold a channel at a bend 0..1 (`null` releases) |

**Unplugged:** the status goes to `'reconnecting'`, the setup is forgotten until the next hello, `getPorts()` is
retried every 3 s, and the same glove plugged in again goes back to `'connected'` with no prompt (the reconnect
count goes up); its hello and `cfg-get` bring the setup back.

**Simulator** (only with `?glove=sim` in the address; owner 2026-10-22: no switch on any page, an old `sk_glove_sim` value is ignored): produces firmware 2.0's lines (`"fw":"2.0-sim"`):
the fixed wiring (C0-C4 = right thumb..pinky, C9-C5 = left thumb..pinky; about 3300 straight, about 1300 bent, a small idle wobble),
C10 copies 65 % of C9 (like the real mux), C11-C15 low noise, an IMU, one bad line about every 5 s. It answers `hello`, `ping`, `cfg-get`, `cfg-set`,
`cfg-clear`; its "flash" is `localStorage` `sk_glove_sim_cfg`, so a setup survives a reload.

## Set up glove (Settings -> Glove, glove-static phase)

Full screen, three steps, EN and FIL text, no modals; Cancel leaves without saving. Every finger is shown with its
channel ("Thumb C0"), in two rows: RIGHT (C0-C4) and LEFT (C9-C5).
1. **Check wiring** (live) — "Bend one finger at a time. The matching bar should move." Each bar shows the raw value.
   A finger gets ✓ (green) once its raw value has spanned **400** since the step opened (chosen: about 10 % of 0-4095;
   the simulator's idle wobble stays under 150). The bar moving now has an **orange outline** (its value spanned 150
   within the last 0.4 s), so a finger wired to the wrong channel shows at once: the wrong bar lights up. Next once
   all 10 have ✓; "Skip check" goes straight to step 2.
2. **Calibrate** — "Open both hands flat — 3 s", then "Make two fists — 3 s" (1 s "Ready…" before each, a seconds
   countdown, live bars); median per channel, saved as `open` / `fist` per finger (a sensor that reads lower when
   bent is handled by the signed span, above). Each finger then shows `open→fist`.
3. **Save + Test** — 10 bars 0-100 % with the new calibration ("open hand = 0, fist = 100"), before saving.
   **Save** = `saveConfig()` on the glove (the simulator: its flash), then "Done"; **Redo calibration** goes back to 2.
   `imuHand`, `cam` and `w` already on the glove are kept.

**Weak sensor.** After step 2, a finger whose open and fist are **less than 150 apart** (the old Fingers step's
"moved" threshold) is marked ⚠ "weak sensor" and named in the message ("⚠ Weak sensor: Right ring C3"). Save stays
allowed. Between 50 and 150 the finger is used but its 0-1 value is coarse; under 50 (`MINSPAN`) it is
**ignored** (`norm` null; the test view says "ignored"), so recognition compares the other fingers only. Usual causes:
the finger was not fully bent, a loose wire, or a divider resistor that does not suit the sensor.

**Check fingers** (Glove card) opens step 1 alone, titled CHECK FINGERS, with "Done" at any time: a quick wiring
check that never changes the calibration.

The Glove card shows "Wiring: fixed (C0–C4 right, C5–C9 left)" and the calibration date (or "not calibrated yet",
or the old-setup notes above). There is no camera step and no IMU step any more (the IMU hand is only shown).

## Debugger hints (Settings -> Glove -> Debug)

| Condition | Hint |
|---|---|
| connected, no hello after 3 s | "No hello from the glove: firmware not sending hello, or wrong baud rate (must be 115200)." |
| hello `fw` 1.x | "Old firmware (1.x): flash sk_glove 2.0 (tools/glove-firmware/README.md)." |
| setup damaged | "The setup stored on the glove is damaged: run Set up glove again." |
| connected for 3 s and fewer than 10 lines/s | "Only N lines/s: check the firmware delay (should be ~33 ms)." |
| a finger's channel at 0 or 4095 for its last 30 readings | "C<n> (<finger>): always <value>: sensor not connected / check the voltage divider." |
| a finger's channel's min/max range under 20 after 300 data lines | "C<n> (<finger>) never changes: check that finger's sensor and wire." |
| bad lines in the last 5 s | "Bad lines (last: ...): check the firmware prints one JSON object per line." |

The Debug panel also shows the **16-channel table** (channel, finger from the fixed wiring, min, max, range, now), the **setup stored on
the glove** (JSON) and **Clear setup on glove**.

## Glove in recognition (glove-hw Phase 2, 2026-10-21)

**The chip and the button.** `js/glove-assist.js` (`window.GloveAssist`) shows its control **only while
`SKGlove.ready()`**:
- Let's Talk, Sign screen (glove-chip phase, 2026-10-22, `docs/design/glove-chip-wireframe.html`):
  `GloveAssist.initChip(el, { hint, lang })` fills `#glove-chip`, a 44 px pill over the camera's top-right corner
  (the right column is exactly as before gloves). States `off` / `on` (green dot) / `idle` (amber dot, "Camera
  only": ON, but `glovesForFrame()` gives a reason other than "no hand in the frame"; the same rules as `apply()`
  below, not new ones). While ON the state is re-checked every 250 ms; the DOM changes only when the state changes.
  OFF at every Sign turn (`startTurn()`). The first ON of a conversation shows `#glove-hint` for 3 s (FIL, EN while
  EN is selected); `reset()` re-arms it. No finger bars. (Before: "🧤 Gloves OFF / ON" beside EN | FIL.)
- Train Gestures, Step 3 panel (Step 4 stays camera only): `GloveAssist.init(button)`, "🧤 Gloves OFF / ON".
- Tap = ON (`aria-pressed`); the ON state is never stored. Every end of a conversation reloads
  `talk.html` except "+ New conversation" with an empty thread, which calls `GloveAssist.reset()`; so a new
  conversation always starts OFF. Unplugged or setup cleared: the chip / button hides and goes OFF.
- Train Gestures Step 3 button only, while ON: 10 finger bars inside it (left 5, right 5), redrawn at most every
  100 ms with CSS `transform` only. Settings -> Glove "Finger bars in Train Gestures" (per kiosk, `localStorage`
  `sk_glove_bars`, `'0'` = off; it was "Finger bars in Let's Talk" before the glove-chip phase).
- The simulator runs only with `?glove=sim` on every page, so a kiosk never shows a fake glove (the
  `window.SK_GLOVE_URL_SIM_ONLY` line left in Let's Talk and Train Gestures is now redundant and harmless).

**The math.** `js/glove-bend.js` (`window.GloveBend`, also a node module):
- `bendOfSlot(row, slot)`: per finger 0 (straight) .. 1 (bent) from the sum of the joint angles in a model row's hand
  slot (fingers: wrist-MCP-PIP, MCP-PIP-DIP, PIP-DIP-tip; thumb: CMC-MCP-IP, MCP-IP-tip), scaled between `RANGES`
  measured on `models/knn_ESL.bin` (14,492 rows, 10th / 98th percentiles): thumb 14°..96°, index 21°..232°, middle
  20°..264°, ring 20°..286°, pinky 25°..275°. Cached per row (`WeakMap`) the first time it is needed.
- `rerank(scores, model, gloves, w)`: for the top 5 labels only, distance = mean |glove - row| over the fingers
  both have (null glove fingers skipped), the closer of the two slot orders (rows keep MediaPipe's hand order,
  not left/right), averaged over the label's 5 closest rows; `score - w x distance`, never below 0. Labels outside
  the top 5 and the input object are untouched.

**When the glove is used** (`GloveAssist.apply(scores, knnModel)`, called right after `knnPredict` in
`js/talk-signing.js` `tick()` and in `js/gesture-training-ui.js` Step 3): ALL of
1. 🧤 is ON and `SKGlove.ready()`;
2. the setup has `cam` (always true since the glove-static phase: `DEFAULT_MIRROR` when none is stored);
3. glove data younger than **1 s** (MediaPipe holds the page's only thread while it detects; about 1.1 s per frame was
   measured in the cloud test container, and glove lines wait behind it);
4. the gloves are worn: some finger moved by >= 0.05 in the last 3 s;
5. MediaPipe's last frame has 1 or 2 hands, each with a handedness score >= 0.8. Each hand's label ("Left"/"Right",
   swapped when `cam.mirror`) picks the glove compared.

Otherwise the scores come back unchanged; `GloveAssist.lastInfo()` says why (`off`, `glove not ready`,
`no camera setup`, `no fresh glove data`, `not worn`, `no hand in the frame`, `unsure which hand`). `w` is the glove
strength stored on the glove (Settings -> Glove, 0-1 in 0.1 steps, default 0.3), not tuned: the accuracy test is at
the end of the project.

## Files

- `js/glove.js` — the module above (no libraries).
- `js/glove-bend.js`, `js/glove-assist.js` — glove in recognition (above).
- `talk.html` (`.signing-lang-row`), `gesture-training.html` (Step 3) — the 🧤 button.
- `settings.html` — Admin -> Settings (General / Voice / Glove), admin only, linked from the admin menu.
- `tools/glove-firmware/sk_glove/sk_glove.ino`, `tools/glove-firmware/README.md` — firmware 2.0, wiring, first upload.
- `tests/glove/glove-core-check.mjs` and `tests/glove/glove-bend-check.mjs` (node, no browser),
  `tests/glove/settings-check.mjs` and `tests/glove/talk-glove-check.mjs` (headless browser, simulator),
  `tests/glove/no-db-router.php` (runs the browser checks without MySQL).
