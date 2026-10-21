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

**Recognition does not use the glove yet** (Phase 2 of the design). Future code reads it through
`window.SKGlove` (below), and only when `SKGlove.ready()`.

Everything that reads or writes glove lines follows this file: the firmware, `js/glove.js` and its simulator.

## Hardware (as the owner's diagram)

| | |
|---|---|
| Mux select | S0 GPIO 14, S1 GPIO 27, S2 GPIO 26, S3 GPIO 25 |
| Mux output | SIG -> GPIO 34 (ADC1); EN -> GND; VCC 3V3 with 0.1 µF |
| Sensors | FS1-FS10 on C0-C9 (the diagram; Set up glove finds the real channels). Each: 3V3 - sensor - C-pin - R - GND, so a reading **drops** when the finger bends |
| IMU | MPU6050 / GY-521 on I2C SDA 21 / SCL 22 (the firmware also tries 22 / 21) |
| Power | USB only. The diagram's 18650 + TP4056 + SW1 are not used: SW1 OFF while USB is plugged in |

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
  channel is which finger; the setup does. Unused channels read whatever their pin floats to.
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
 "map":{"L":[5,6,7,8,9],"R":[0,1,2,3,4]},
 "cal":{"L":{"open":[3290,3301,3288,3296,3310],"fist":[1300,1302,1298,1299,1301]},
        "R":{"open":[...5],"fist":[...5]},"at":"2026-10-21T12:00:00.000Z"},
 "cam":{"mirror":true},
 "imuHand":"R",
 "w":0.3}
```

| Key | |
|---|---|
| `v` | 1 |
| `map.L` / `map.R` | the mux channel (0-15) of each finger, thumb -> pinky; `null` for a finger Set up glove skipped |
| `cal` | open and fist values per finger (median of 3 s each), and when; `null` before calibration. A skipped finger has 0 / 0 |
| `cam.mirror` | `true` when MediaPipe labels the wearer's **right** hand "Left" on this kiosk's camera; `null` when the camera step was skipped |
| `imuHand` | the hand with the MPU6050, or `null` |
| `w` | glove strength for the Phase 2 re-ranking, 0-1, default 0.3 |

`SKGlove.validateConfig(c)` is the rule: anything else (wrong version, a channel outside 0-15, a 6th finger, a
value outside 0-4095, `cal` without `at`, `w` outside 0-1, ...) is not valid. A stored setup that is not valid
JSON or not valid is reported as **damaged** ("run Set up glove again").

## Bad lines

A line that is not valid JSON, or valid JSON that is none of the lines above:
- is **counted** ("bad lines");
- is shown **in red** in the debugger console with the reason, e.g. "not JSON: Unexpected end of JSON input",
  "ch must be 16 integers 0-4095", "old firmware (5 fingers): flash sk_glove 2.0";
- **never** stops the reader or throws into the page. Empty lines are skipped and not counted.

## Values the page derives (`js/glove.js`)

- **Per finger** (only with a setup): `raw` = the mapped channel's value; `norm` = `(raw - open) / (fist - open)`,
  clamped to 0..1 (0 = open hand, 1 = fist), then a moving average of the last 3 readings. It works whichever way
  the divider is wired.
  - No calibration yet: `raw / 4095`.
  - A finger with no channel: `raw` and `norm` are `null`.
  - A finger whose open and fist are less than 50 apart: `norm` is `null` (ignored, not 0).
- **IMU on the page**: tilt X = `atan2(ay, az)`, tilt Y = `atan2(-ax, hypot(ay, az))` (degrees), turn = `gz`.

## `window.SKGlove`

| Member | |
|---|---|
| `CHANNELS`, `FINGERS`, `HANDS`, `DEFAULT_W` | 16, thumb..pinky, `['L','R']`, 0.3 |
| `isSupported()` | Web Serial present (or the simulator is on) |
| `status()` | `'unsupported'` / `'disconnected'` / `'connecting'` / `'connected'` / `'reconnecting'` |
| `connect()` | opens the port picker (`requestPort`, needs a tap), then the port. Simulator mode: starts the simulator |
| `autoReconnect()` | on page load: a port this browser already may use (`getPorts()`) is opened with no prompt |
| `disconnect()` | closes the port (or stops the simulator); no auto-reconnect afterwards |
| `send(line)` / `ping()` | writes one line / sends `ping` (the next pong fires `pong` with `{ rtt }`) |
| `on(event, cb)` | `'status'`, `'data'`, `'hello'`, `'config'`, `'raw'`, `'error'`, `'pong'`; returns an unsubscribe function |
| `latest()` | `{ t, ch: [16], hands: { L: { raw: [5], norm: [5] }, R: {...} } or null, imu, at }`, or null |
| `info()` | the last hello, or null |
| `config()` / `configState()` | the validated setup or null / `'unknown'`, `'none'`, `'ok'`, `'damaged'` |
| `validateConfig(c)` | a clean copy of a valid setup, or null |
| `saveConfig(c)` / `clearConfig()` | `cfg-set` / `cfg-clear`; resolve on `cfg-ok`, reject on `cfg-error`, a 2 s timeout or when not connected |
| `ready()` | connected **and** a setup with a calibration: the one test other pages use |
| `stats()` / `resetMinMax()` / `log()` | debugger counters, per-channel min/max (16), the last 2,000 lines |
| `simulator(on)` / `isSimulator()` / `simSetBend(ch, bend)` | the simulator source; hold a channel at a bend 0..1 (`null` releases) |

**Unplugged:** the status goes to `'reconnecting'`, the setup is forgotten until the next hello, `getPorts()` is
retried every 3 s, and the same glove plugged in again goes back to `'connected'` with no prompt (the reconnect
count goes up); its hello and `cfg-get` bring the setup back.

**Simulator** (the "Use simulator" switch, or `?glove=sim`): produces firmware 2.0's lines (`"fw":"2.0-sim"`):
C0-C4 = right thumb..pinky, C5-C9 = left thumb..pinky (about 3300 straight, about 1300 bent, a small idle wobble),
C10-C15 low noise, an IMU, one bad line about every 5 s. It answers `hello`, `ping`, `cfg-get`, `cfg-set`,
`cfg-clear`; its "flash" is `localStorage` `sk_glove_sim_cfg`, so a setup survives a reload. The switch is stored per
kiosk (`sk_glove_sim`).

## Set up glove (Settings -> Glove)

Full screen, in this order; Cancel leaves without saving:
1. **Fingers** — right thumb..pinky, then left thumb..pinky. Each: 1 s rest, then 2 s bending. Per channel,
   move = the largest distance from its resting median while bending, minus how much it wandered at rest. The
   channel with the largest move wins if move > 150 **and** it is at least 2x the next channel's; otherwise
   "No sensor moved" / "moved about the same" with Retry / Skip. A channel already given to another finger is
   refused ("C0 is already R thumb").
2. **Calibrate** — both hands open 3 s, both fists 3 s (1 s get-ready before each); median per channel.
3. **Camera** — "Raise your RIGHT hand": the same MediaPipe pipeline as Let's Talk (`js/gesture-data.js`); 5 frames
   with exactly one hand and a handedness score >= 0.8 decide `cam.mirror`. Skippable (then Phase 2 never uses the
   glove).
4. **IMU** (only when the hello says `imu: true`) — which hand has the sensor box.
5. **Save on glove** — `saveConfig()`; on `cfg-ok` back to Settings.

## Debugger hints (Settings -> Glove -> Debug)

| Condition | Hint |
|---|---|
| connected, no hello after 3 s | "No hello from the glove: firmware not sending hello, or wrong baud rate (must be 115200)." |
| hello `fw` 1.x | "Old firmware (1.x): flash sk_glove 2.0 (tools/glove-firmware/README.md)." |
| setup damaged | "The setup stored on the glove is damaged: run Set up glove again." |
| connected for 3 s and fewer than 10 lines/s | "Only N lines/s: check the firmware delay (should be ~33 ms)." |
| a mapped channel at 0 or 4095 for its last 30 readings | "C<n> (<finger>): always <value>: sensor not connected / check the voltage divider." |
| a mapped channel's min/max range under 20 after 300 data lines | "C<n> (<finger>) never changes: check that finger's sensor and wire." |
| bad lines in the last 5 s | "Bad lines (last: ...): check the firmware prints one JSON object per line." |

The Debug panel also shows the **16-channel table** (channel, used by, min, max, range, now), the **setup stored on
the glove** (JSON) and **Clear setup on glove**.

## Files

- `js/glove.js` — the module above (no libraries).
- `settings.html` — Admin -> Settings (General / Voice / Glove), admin only, linked from the admin menu.
- `tools/glove-firmware/sk_glove/sk_glove.ino`, `tools/glove-firmware/README.md` — firmware 2.0, wiring, first upload.
- `tests/glove/glove-core-check.mjs` (node, no browser), `tests/glove/settings-check.mjs` (headless Chrome, simulator),
  `tests/glove/no-db-router.php` (runs the browser check without MySQL).
