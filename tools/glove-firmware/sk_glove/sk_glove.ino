// sk_glove.ino — Sining Kamay data gloves, firmware 2.0 (glove-hw phase, 2026-10-21).
// Protocol: docs/system/GLOVE.md (v2). USB serial 115200 baud, one JSON object per line, ~30 lines/s.
// Hardware: the owner's circuit diagram (docs/superpowers/specs/2026-10-21-glove-hardware-design.md):
//
//   Two gloves, 10 flex sensors FS1-FS10 -> CD74HC4067 16-channel mux C0-C9, one ESP32 dev board.
//   Mux:  S0 -> GPIO 14   S1 -> GPIO 27   S2 -> GPIO 26   S3 -> GPIO 25   SIG -> GPIO 34
//         EN -> GND (always on)   VCC -> 3V3 (0.1 uF to GND)   GND -> GND
//   Each sensor:  3V3 --[ flex sensor ]--+--[ R ]-- GND
//                                        +-- mux C-pin
//   (measured on the owner's glove 2026-10-22: 0 straight, rising when bent; the page calibrates either way)
//   MPU6050 (GY-521, optional): VCC 3V3, GND, SDA GPIO 21, SCL GPIO 22 (tried swapped if nothing answers).
//   Power: USB only. The diagram's 18650 + TP4056 + SW1 are not used: keep SW1 OFF while USB is plugged in.
//
// This firmware sends the RAW value of all 16 mux channels. It never decides which channel is which
// finger: the kiosk's Settings -> Glove -> Set up glove finds that, and saves it here (flash) with
// cfg-set, so the same glove works on the laptop and on the Pi with no new setup.
//
// Board: "ESP32 Dev Module" (Arduino core for ESP32 by Espressif). Libraries: none beyond the core
// (Wire and Preferences are built in).

#include <Wire.h>
#include <Preferences.h>

static const char *FW = "2.0";
static const int MUX_S[4] = {14, 27, 26, 25};   // S0, S1, S2, S3
static const int MUX_SIG = 34;                  // ADC1_CH6, input only
static const int CHANNELS = 16;
static const uint32_t PERIOD_MS = 33;           // ~30 lines per second
static const uint8_t MPU_ADDR = 0x68;
static const size_t CFG_MAX = 1000;             // longest setup the page may store (characters)
static const size_t CMD_MAX = CFG_MAX + 16;     // "cfg-set " + the setup

static Preferences prefs;
static bool imuPresent = false;
static int sdaPin = 21, sclPin = 22;
static uint32_t nextAt = 0;
static char cmd[CMD_MAX + 1];
static size_t cmdLen = 0;
static bool cmdOverflow = false;

// ── mux ──
static int readChannel(int ch) {
  for (int b = 0; b < 4; b++) digitalWrite(MUX_S[b], (ch >> b) & 1);
  delayMicroseconds(10);          // mux + divider settle
  analogRead(MUX_SIG);            // first conversion after a switch is discarded
  return analogRead(MUX_SIG);
}

// ── MPU6050 (plain Wire, no library) ──
static bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}
static bool mpuDetect() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);                              // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 1) != 1) return false;
  uint8_t who = Wire.read();
  if (who != 0x68 && who != 0x70 && who != 0x72) return false;   // MPU6050 and common clones
  return mpuWrite(0x6B, 0x00)                    // wake up
      && mpuWrite(0x1B, 0x00)                    // gyro +-250 deg/s -> 131 LSB per deg/s
      && mpuWrite(0x1C, 0x00);                   // accel +-2 g     -> 16384 LSB per g
}
static bool mpuStart(int sda, int scl) {
  Wire.end();
  Wire.begin(sda, scl);
  Wire.setClock(400000);
  if (!mpuDetect()) return false;
  sdaPin = sda;
  sclPin = scl;
  return true;
}
static bool mpuRead(float *a, float *g) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                              // ACCEL_XOUT_H .. GYRO_ZOUT_L, 14 bytes
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) v[i] = (int16_t)((Wire.read() << 8) | Wire.read());
  for (int i = 0; i < 3; i++) a[i] = v[i] / 16384.0f;
  for (int i = 0; i < 3; i++) g[i] = v[i + 4] / 131.0f;   // v[3] is the temperature
  return true;
}

// ── setup storage (flash) ──
static bool hasCfg() { return prefs.isKey("cfg") && prefs.getString("cfg", "").length() > 0; }

static void sendHello() {
  Serial.print("{\"type\":\"hello\",\"device\":\"sk-glove\",\"fw\":\"");
  Serial.print(FW);
  Serial.print("\",\"channels\":16,\"imu\":");
  Serial.print(imuPresent ? "true" : "false");
  Serial.print(",\"i2c\":\"");
  Serial.print(sdaPin);
  Serial.print('/');
  Serial.print(sclPin);
  Serial.print("\",\"hasCfg\":");
  Serial.print(hasCfg() ? "true" : "false");
  Serial.print("}\n");
}
static void sendCfg() {
  Serial.print("{\"type\":\"cfg\",\"cfg\":");
  if (hasCfg()) Serial.print(prefs.getString("cfg", "null"));
  else Serial.print("null");
  Serial.print("}\n");
}
static void cfgError(const char *why) {
  Serial.print("{\"type\":\"cfg-error\",\"why\":\"");
  Serial.print(why);
  Serial.print("\"}\n");
}
static void cfgSet(const char *json) {
  size_t n = strlen(json);
  if (n == 0) { cfgError("empty"); return; }
  if (n > CFG_MAX) { cfgError("too long"); return; }
  if (json[0] != '{' || json[n - 1] != '}') { cfgError("not a JSON object"); return; }
  for (size_t i = 0; i < n; i++) {
    if (json[i] == '\n' || json[i] == '\r') { cfgError("line break inside"); return; }
  }
  if (prefs.putString("cfg", json) != n) { cfgError("flash write failed"); return; }
  Serial.print("{\"type\":\"cfg-ok\"}\n");
}

// ── commands from the page ──
static void handleCommand(const char *c) {
  if (strcmp(c, "hello") == 0) sendHello();
  else if (strcmp(c, "ping") == 0) {
    Serial.print("{\"type\":\"pong\",\"t\":");
    Serial.print(millis());
    Serial.print("}\n");
  } else if (strcmp(c, "cfg-get") == 0) sendCfg();
  else if (strncmp(c, "cfg-set ", 8) == 0) cfgSet(c + 8);
  else if (strcmp(c, "cfg-clear") == 0) {
    prefs.remove("cfg");
    Serial.print("{\"type\":\"cfg-ok\"}\n");
  }
  // anything else is ignored (docs/system/GLOVE.md)
}
static void readCommands() {
  while (Serial.available() > 0) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      cmd[cmdLen] = '\0';
      if (cmdOverflow) { if (strncmp(cmd, "cfg-set ", 8) == 0) cfgError("too long"); }
      else if (cmdLen > 0) handleCommand(cmd);
      cmdLen = 0;
      cmdOverflow = false;
    } else if (cmdLen < CMD_MAX) {
      cmd[cmdLen++] = ch;
    } else {
      cmdOverflow = true;          // keep the start (to answer "too long"), drop the rest
    }
  }
}

void setup() {
  Serial.setRxBufferSize(2048);    // a whole cfg-set line fits while a data line is being printed
  Serial.begin(115200);
  for (int b = 0; b < 4; b++) { pinMode(MUX_S[b], OUTPUT); digitalWrite(MUX_S[b], LOW); }
  analogReadResolution(12);                       // 0..4095
  analogSetPinAttenuation(MUX_SIG, ADC_11db);     // full 0..3.3 V range
  prefs.begin("skglove", false);
  imuPresent = mpuStart(21, 22) || mpuStart(22, 21);
  if (!imuPresent) { sdaPin = 21; sclPin = 22; }
  delay(200);                                     // let the USB-serial bridge settle
  sendHello();
  nextAt = millis();
}

void loop() {
  readCommands();
  uint32_t now = millis();
  if ((int32_t)(now - nextAt) < 0) return;
  nextAt += PERIOD_MS;
  if ((int32_t)(now - nextAt) > (int32_t)PERIOD_MS) nextAt = now + PERIOD_MS;   // fell behind: no burst

  Serial.print("{\"t\":");
  Serial.print(now);
  Serial.print(",\"ch\":[");
  for (int c = 0; c < CHANNELS; c++) {
    if (c) Serial.print(',');
    Serial.print(readChannel(c));
  }
  Serial.print(']');
  float a[3], g[3];
  if (imuPresent && mpuRead(a, g)) {
    Serial.printf(",\"imu\":{\"ax\":%.2f,\"ay\":%.2f,\"az\":%.2f,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f}", a[0], a[1], a[2], g[0], g[1], g[2]);
  }
  Serial.print("}\n");
  readCommands();
}
