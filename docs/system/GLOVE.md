# GLOVE.md — optional wired data glove (glove-serial phase, 2026-10-20)

An optional glove: an ESP32 with 5 flex sensors and an optional MPU6050, on a USB cable to the Pi. This phase builds
only the system side:
- the protocol (this file);
- `js/glove.js` (`window.SKGlove`);
- the Settings -> Glove page with its debugger (`settings.html`);
- a firmware starter (`tools/glove-firmware/`).

**Recognition does not use the glove yet**: Let's Talk and the k-NN are unchanged, and there is no glove UI outside
Settings. Future code reads the glove through `window.SKGlove` (below).

Everything that reads or writes glove lines follows this file: the firmware, `js/glove.js` and its simulator.

## Link

| | |
|---|---|
| Transport | USB serial (the ESP32's USB-UART bridge), **115200 baud**, 8N1 |
| Framing | one JSON object per line, UTF-8, ending in `\n` (a `\r` before it is ignored) |
| Rate | about **30 data lines per second** (one every ~33 ms) |
| Browser | Web Serial (`navigator.serial`), Chromium / Chrome only |
| Secure context | Web Serial exists only in a secure context. **`http://localhost` counts (the kiosk), a LAN address such as `http://192.168.1.20/SKR/` does not**, and neither does Firefox. The page then shows "This browser can't use the glove." |

## Glove -> page

**Hello**, sent once on boot and again whenever the page sends `hello`:

```json
{"type":"hello","device":"sk-glove","fw":"1.0","fingers":5,"imu":true}
```

`imu` is `false` when no MPU6050 answered on I2C at boot.

**Data**, about 30 per second:

```json
{"t":123456,"f":[1840,3410,3502,1205,1010]}
{"t":123489,"f":[1840,3410,3502,1205,1010],"imu":{"ax":0.02,"ay":-0.21,"az":0.97,"gx":1.5,"gy":-0.4,"gz":31.0}}
```

- `t`: the glove's `millis()`, an integer that only grows (it restarts at 0 on reboot).
- `f`: 5 integers, raw ADC **0-4095** (12-bit), in this order: **thumb, index, middle, ring, pinky**.
- `imu` (optional, only when the hello said `imu: true`):
  - `ax`, `ay`, `az`: acceleration in **g**;
  - `gx`, `gy`, `gz`: rotation in **degrees per second**;
  - each a number with at most 2 decimals.

**Pong**, the answer to `ping`:

```json
{"type":"pong","t":123500}
```

## Page -> glove

One line each, ending in `\n`:

| Line | Answer |
|---|---|
| `hello` | the hello line again |
| `ping` | `{"type":"pong","t":<millis>}` (the page measures the round trip) |

Anything else is ignored by the firmware. The debugger can send any line, to test new firmware commands.

## Bad lines

A line that is not valid JSON, or valid JSON that is neither a hello, a pong nor a data line with 5 numbers 0-4095:
- is **counted** ("bad lines");
- is shown **in red** in the debugger console with the reason, e.g. "not JSON: Unexpected end of JSON input" or
  "f must be 5 numbers 0-4095";
- **never** stops the reader or throws into the page. Empty lines are skipped and not counted.

## Values the page derives (`js/glove.js`)

- **Normalized 0-1 per finger**, from this kiosk's calibration: `(raw - open) / (fist - open)`, clamped to 0..1
  (0 = open hand, 1 = fist). It works whichever way the divider is wired: `fist` may be smaller than `open`.
  Then a moving average of the last 3 readings.
  - Without a calibration: `raw / 4095`.
  - A finger whose open and fist values are less than 50 apart reads 0.
- **Calibration**: `{ open: [5], fist: [5], at: ISO time }`, each value the median of 3 s of readings. It is stored
  per kiosk in `localStorage` (`sk_glove_calibration`, read and written in try/catch): nothing goes to the server.
- **IMU on the page**:
  - tilt X = `atan2(ay, az)`;
  - tilt Y = `atan2(-ax, hypot(ay, az))`, both in degrees;
  - turn = `gz` (degrees per second).

## `window.SKGlove`

| Member | |
|---|---|
| `isSupported()` | Web Serial present (or the simulator is on) |
| `status()` | `'unsupported'` / `'disconnected'` / `'connecting'` / `'connected'` / `'reconnecting'` |
| `connect()` | opens the port picker (`requestPort`, needs a tap), then opens the port. In simulator mode it starts the simulator. |
| `autoReconnect()` | on page load: a port this kiosk already allowed (`getPorts()`) is opened with no prompt |
| `disconnect()` | closes the port (or stops the simulator); no auto-reconnect afterwards |
| `send(line)` | writes one line (adds `\n`) |
| `ping()` | sends `ping`; the next pong fires `pong` with `{ rtt }` in ms |
| `on(event, cb)` | `'status'`, `'data'`, `'hello'`, `'raw'`, `'error'`, `'pong'`; returns an unsubscribe function |
| `latest()` | `{ t, raw: [5], norm: [5], imu, at }` of the last data line, or null |
| `info()` | the last hello object, or null |
| `calibration.get() / set(cal) / reset()` | the stored calibration (above) |
| `stats()` / `resetMinMax()` / `log()` | debugger counters, per-finger min/max, the last 2,000 lines |
| `simulator(on)` / `isSimulator()` | the simulator source |

**Unplugged:**
1. The status goes to `'reconnecting'`.
2. `getPorts()` is retried every 3 s.
3. Plugging the same glove in again goes back to `'connected'` with no prompt, and the reconnect count goes up.

**Simulator** (the "Use simulator" switch, or `?glove=sim`):
- It produces the exact protocol lines: a hello (`"fw":"1.0-sim"`), data lines at 30 per second with fingers bending
  slowly, an IMU, and **one bad line about every 5 s**.
- It answers `hello` and `ping`.
- Its lines go through the same parser as the serial port, so the whole path is tested without hardware.
- The switch is stored per kiosk (`sk_glove_sim`).

## Debugger hints (Settings -> Glove -> Debug)

| Condition | Hint |
|---|---|
| connected, no hello after 3 s | "No hello from the glove: firmware not sending hello, or wrong baud rate (must be 115200)." |
| a finger at 0 or 4095 for its last 30 readings | "<finger>: always <value>: sensor not connected / check the voltage divider." |
| connected for 3 s and fewer than 10 lines/s | "Only N lines/s: check the firmware delay (should be ~33 ms)." |
| bad lines in the last 5 s | "Bad lines: check the firmware prints one JSON object per line." |

## Files

- `js/glove.js` — the module above (no libraries).
- `settings.html` — Admin -> Settings (General / Voice / Glove). Admin only (`SKAccount.adminPage()`), linked from
  the admin menu (`js/sk-account.js`).
- `tools/glove-firmware/sk_glove/sk_glove.ino`, `tools/glove-firmware/README.md` — firmware starter, wiring, how to
  check it.
- `docs/design/glove-settings-wireframe.html` — the 4 screens and rules this follows.
