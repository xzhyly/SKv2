// sk_glove.ino — Sining Kamay data glove, firmware starter (glove-serial phase, 2026-10-20).
// Protocol: docs/system/GLOVE.md. USB serial 115200 baud, one JSON object per line, ~30 lines/s.
//
// Board: any ESP32 dev board (Arduino core for ESP32), e.g. "ESP32 Dev Module".
// Libraries: none beyond the ESP32 core (Wire is built in). The MPU6050 is read with plain Wire
// calls, so no MPU library is needed.
//
// Flex sensors: ADC1 only (ADC2 cannot be read while Wi-Fi is on, and this keeps it simple):
//   thumb  -> GPIO 32      index -> GPIO 33      middle -> GPIO 34
//   ring   -> GPIO 35      pinky -> GPIO 36 (VP)
// GPIO 34, 35 and 36 are input-only, which is fine for sensors.
//
// Each finger is a voltage divider (one per finger):
//
//   3V3 ──[ flex sensor ]──┬──[ fixed resistor R ]── GND
//                          │
//                          └── GPIO (ADC)
//
//   Choose R close to the sensor's resistance halfway between straight and bent (for a 2.2" flex
//   sensor of ~25 kOhm flat / ~70 kOhm bent, R = 47 kOhm is a good start). Bending raises the
//   sensor's resistance, so the GPIO voltage DROPS when the finger bends; the page's calibration
//   works either way. A finger stuck at 0 or 4095 means an open or shorted divider (Settings ->
//   Glove -> Debug shows a hint). Never connect a sensor to 5 V: ESP32 pins are 3.3 V only.
//
// MPU6050 (optional): VCC -> 3V3, GND -> GND, SDA -> GPIO 21, SCL -> GPIO 22, AD0 -> GND (address
// 0x68). Detected at boot; without it the hello says "imu":false and data lines have no "imu".

#include <Wire.h>

static const char *FW = "1.0";
static const int FINGER_PINS[5] = {32, 33, 34, 35, 36};   // thumb, index, middle, ring, pinky
static const uint32_t PERIOD_MS = 33;                     // ~30 lines per second
static const uint8_t MPU_ADDR = 0x68;

static bool imuPresent = false;
static uint32_t nextAt = 0;
static char cmd[64];
static uint8_t cmdLen = 0;

static void sendHello() {
  Serial.print("{\"type\":\"hello\",\"device\":\"sk-glove\",\"fw\":\"");
  Serial.print(FW);
  Serial.print("\",\"fingers\":5,\"imu\":");
  Serial.print(imuPresent ? "true" : "false");
  Serial.print("}\n");
}

static bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

static bool mpuDetect() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);                          // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 1) != 1) return false;
  uint8_t who = Wire.read();
  if (who != 0x68 && who != 0x70 && who != 0x72) return false;   // MPU6050 and common clones
  return mpuWrite(0x6B, 0x00)                // wake up
      && mpuWrite(0x1B, 0x00)                // gyro +-250 deg/s  -> 131 LSB per deg/s
      && mpuWrite(0x1C, 0x00);               // accel +-2 g      -> 16384 LSB per g
}

// Reads accel (g) and gyro (deg/s). Returns false on an I2C error (the line then has no "imu").
static bool mpuRead(float *a, float *g) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                          // ACCEL_XOUT_H .. GYRO_ZOUT_L, 14 bytes
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) v[i] = (int16_t)((Wire.read() << 8) | Wire.read());
  for (int i = 0; i < 3; i++) a[i] = v[i] / 16384.0f;
  for (int i = 0; i < 3; i++) g[i] = v[i + 4] / 131.0f;   // v[3] is the temperature
  return true;
}

static void handleCommand(const char *c) {
  if (strcmp(c, "hello") == 0) {
    sendHello();
  } else if (strcmp(c, "ping") == 0) {
    Serial.print("{\"type\":\"pong\",\"t\":");
    Serial.print(millis());
    Serial.print("}\n");
  }
  // anything else is ignored (docs/system/GLOVE.md)
}

static void readCommands() {
  while (Serial.available() > 0) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      cmd[cmdLen] = '\0';
      if (cmdLen > 0) handleCommand(cmd);
      cmdLen = 0;
    } else if (cmdLen < sizeof(cmd) - 1) {
      cmd[cmdLen++] = ch;
    }
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);                  // 0..4095
  for (int i = 0; i < 5; i++) {
    analogSetPinAttenuation(FINGER_PINS[i], ADC_11db);   // full 0..3.3 V range
  }
  Wire.begin(21, 22);
  Wire.setClock(400000);
  imuPresent = mpuDetect();
  delay(200);                                // let the USB-serial bridge settle
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
  Serial.print(",\"f\":[");
  for (int i = 0; i < 5; i++) {
    if (i) Serial.print(',');
    Serial.print(analogRead(FINGER_PINS[i]));
  }
  Serial.print(']');
  float a[3], g[3];
  if (imuPresent && mpuRead(a, g)) {
    Serial.printf(",\"imu\":{\"ax\":%.2f,\"ay\":%.2f,\"az\":%.2f,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f}", a[0], a[1], a[2], g[0], g[1], g[2]);
  }
  Serial.print("}\n");
}
