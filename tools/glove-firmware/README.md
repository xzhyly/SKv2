# Glove firmware starter (`sk_glove`)

The firmware for the optional wired data glove: an ESP32 with 5 flex sensors, an optional MPU6050, and a USB cable to
the Pi. It speaks the protocol in [`docs/system/GLOVE.md`](../../docs/system/GLOVE.md): 115200 baud, one JSON object
per line, about 30 lines per second.

## Wiring

```
                    ESP32 dev board
                 ┌──────────────────┐
  thumb  divider─┤ GPIO 32          │
  index  divider─┤ GPIO 33          │
  middle divider─┤ GPIO 34          │            MPU6050 (optional)
  ring   divider─┤ GPIO 35          │           ┌──────────┐
  pinky  divider─┤ GPIO 36 (VP)     │   3V3 ────┤ VCC      │
                 │          GPIO 21 ├───────────┤ SDA      │
                 │          GPIO 22 ├───────────┤ SCL      │
                 │              GND ├───────────┤ GND, AD0 │
                 │              USB ├── cable to the Pi   └──────────┘
                 └──────────────────┘

  One divider per finger:   3V3 ──[ flex sensor ]──┬──[ R = 47 kΩ ]── GND
                                                   └── GPIO
```

- **Pins.** Use **ADC1 pins only** (32-36), as above. GPIO 34-36 are input-only, which is fine for sensors.
- **3.3 V only.** Never connect 5 V to an ESP32 pin.
- **Resistor value.** R ≈ the sensor's resistance halfway between straight and bent. For a 2.2" sensor (~25 kΩ
  straight, ~70 kΩ bent), 47 kΩ is a good start. Too small or too big squeezes all readings toward 0 or 4095: check
  the min/max table in the debugger.
- **Direction.** Bending raises the sensor's resistance, so its reading **drops**. That is fine: the page's
  calibration works in either direction.

## Arduino IDE

1. File -> Preferences -> Additional boards manager URLs: add
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`, then Tools -> Board -> Boards Manager ->
   install **esp32 by Espressif Systems**.
   - This is done once on the laptop with internet access. The kiosk itself never needs it.
2. Tools -> Board -> **ESP32 Dev Module** (or your board). Tools -> Port -> the ESP32's COM port.
3. No extra libraries: `Wire` comes with the core, and the MPU6050 is read with plain I2C.
4. Open `tools/glove-firmware/sk_glove/sk_glove.ino` and Upload. On some boards you hold **BOOT** while it says
   "Connecting…".

## Check 1: Serial Monitor (laptop)

1. Tools -> Serial Monitor, **115200 baud**, line ending **Newline**.
2. Press the board's **EN/RST**. The first line is the hello:
   `{"type":"hello","device":"sk-glove","fw":"1.0","fingers":5,"imu":true}`. It says `"imu":false` without the
   MPU6050.
3. Then about 30 lines a second: `{"t":1234,"f":[1840,3410,3502,1205,1010],"imu":{...}}`. Bend each finger: its
   number must change.
4. Type `ping` and Enter: `{"type":"pong","t":...}`. Type `hello`: the hello again.
5. **Close the Serial Monitor** before the next check: only one program can open the port at a time.

## Check 2: Settings -> Glove -> Debug (kiosk or laptop)

1. Log in as an admin, open the name chip -> **Settings** -> **Glove** -> **Connect glove**, and pick the ESP32's port.
   This must be in Chrome / Chromium on `http://localhost/SKR/settings.html`: Web Serial does not work on a LAN
   address or in Firefox.
2. The status line shows `sk-glove · firmware 1.0 · 5 fingers · IMU yes · 30 readings/s`.
3. Open **Debug**:
   - The raw lines scroll by; a bad line is shown in red with the reason.
   - LINES/S is about 30.
   - **Send "ping"** shows the round trip in ms.
   - The **min/max** table shows each finger's range as you bend it. A range under ~300 means R is badly chosen.
   - Hints appear for common faults: no hello / wrong baud, a finger stuck at 0 or 4095, too few lines per second.
   - **Download log** saves the last 2,000 lines with timestamps, to attach to a bug report.
4. **Calibrate**: open hand for 3 s, then a fist for 3 s, then Save. The bars then read 0 open and 1 fist.
5. **Unplug the cable**: the status shows "reconnecting…". Plug it back in: it reconnects by itself within 3 s, with
   no prompt.

No glove at hand? Turn on **Use simulator** (or open `settings.html?glove=sim`). It produces the same lines,
including a bad one about every 5 s.
