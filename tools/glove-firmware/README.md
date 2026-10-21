# Glove firmware (`sk_glove` 2.0)

The firmware for the two wired data gloves: 10 flex sensors on a CD74HC4067 16-channel mux, an optional MPU6050
(GY-521), one ESP32, and a USB cable to the Pi (the laptop while testing). It speaks protocol v2 in
[`docs/system/GLOVE.md`](../../docs/system/GLOVE.md): 115200 baud, one JSON object per line, ~30 lines per second,
the raw value of all 16 mux channels, and the glove's setup stored in its flash.

## Wiring (the owner's circuit diagram)

```
   ESP32 dev board                 CD74HC4067 16-channel mux
   GPIO 14 ───────────────────────  S0
   GPIO 27 ───────────────────────  S1
   GPIO 26 ───────────────────────  S2
   GPIO 25 ───────────────────────  S3
   GPIO 34 ───────────────────────  SIG
   GND ───────────────────────────  EN, GND
   3V3 ───────────────────────────  VCC   (0.1 µF from VCC to GND)
                                    C0..C9  <- FS1..FS10 (one divider each, below)

   One divider per flex sensor:   3V3 ──[ flex sensor ]──┬──[ R ]── GND
                                                         └── mux C-pin

   MPU6050 / GY-521 (optional):   VCC 3V3 · GND · SDA GPIO 21 · SCL GPIO 22 · AD0 GND
   USB ── cable to the laptop / Pi (power and data)
```

- **Which sensor is which finger does not matter here.** The firmware sends all 16 channels; Settings -> Glove ->
  **Set up glove** finds each finger's channel and saves it on the glove.
- **3.3 V only.** Never connect 5 V to an ESP32 pin, the mux or a sensor.
- **Bending lowers the reading** (the sensor's resistance rises). The page's calibration handles it.
- **Battery: not used.** The diagram's 18650 + TP4056 + switch SW1 are not needed: USB powers everything. Keep
  **SW1 OFF whenever USB is plugged in** (USB 5 V would otherwise push into the battery through VIN without the
  charger's control).

## First time on a Windows laptop

1. **Driver / COM port.** Plug the ESP32 in with a **data** USB cable (many cables are power-only). Open Device
   Manager -> Ports (COM & LPT):
   - "Silicon Labs CP210x USB to UART Bridge (COMx)" or "USB-SERIAL CH340 (COMx)": good, note COMx.
   - Nothing, or "Unknown device": install the driver for the chip on the board (the small chip near the USB
     socket says CP2102 or CH340): Silicon Labs "CP210x VCP driver" or WCH "CH341SER", then unplug / plug.
2. **Arduino IDE board package** (once, needs internet): File -> Preferences -> Additional boards manager URLs:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`, then Tools -> Board -> Boards Manager ->
   install **esp32 by Espressif Systems**.
3. Tools -> Board -> **ESP32 Dev Module**. Tools -> Port -> your COMx.
4. Open `tools/glove-firmware/sk_glove/sk_glove.ino` and press **Upload**. No extra libraries (`Wire` and
   `Preferences` come with the board package). If it stops at "Connecting…", hold the board's **BOOT** button
   until the upload starts.

## Check 1: Serial Monitor (no kiosk needed)

1. Tools -> Serial Monitor, **115200 baud**, line ending **Newline**.
2. Press the board's **EN/RST**. The first line is the hello:
   `{"type":"hello","device":"sk-glove","fw":"2.0","channels":16,"imu":true,"i2c":"21/22","hasCfg":false}`
   (`"imu":false` if the MPU6050 did not answer).
3. Then about 30 lines a second: `{"t":1234,"ch":[3290,3310,...16 numbers...],"imu":{...}}`.
   - Bend one finger at a time: **one** of the first 10 numbers must drop clearly (by hundreds).
   - A number that never changes, or sits at 0 or 4095, is a sensor or wire to check. The last 6 (C10-C15) have
     nothing connected and may read anything.
4. Type `ping` and Enter: `{"type":"pong","t":...}`. Type `cfg-get`: `{"type":"cfg","cfg":null}` on a new glove.
5. **Close the Serial Monitor** before the next check: only one program can open the port at a time.

## Check 2: Settings -> Glove (kiosk page, laptop)

1. XAMPP running; Chrome on `http://localhost/SKR/`; log in as an admin -> name chip -> **Settings** -> Glove ->
   **Connect glove** -> pick the ESP32's port. (Web Serial does not work on a LAN address or in Firefox.)
2. The status line: `sk-glove · firmware 2.0 · 16 channels · IMU yes (21/22) · 30 readings/s · not set up`.
3. **Debug**: about 30 lines/s; the 16-channel table's numbers change as you bend fingers.
4. **Set up glove**: follow the screen (fingers, calibrate, camera, IMU, Save on glove).
5. Unplug the cable: "reconnecting…". Plug it back: connected within 3 s with no prompt, and the setup is still
   there (it comes from the glove).

No glove at hand? Turn on **Use simulator** (or open `settings.html?glove=sim`): the same lines, including a bad one
about every 5 s.
