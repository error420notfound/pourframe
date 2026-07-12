#include <Arduino.h>
#include <HX711.h>

namespace {
constexpr uint8_t kUpperDout = 4;
constexpr uint8_t kUpperClock = 5;
constexpr uint8_t kLowerDout = 6;
constexpr uint8_t kLowerClock = 7;
constexpr uint32_t kReadTimeoutMs = 150;
constexpr uint32_t kReportIntervalMs = 500;

HX711 upper;
HX711 lower;
uint32_t lastReportMs = 0;

void reportChannel(const char *label, HX711 &channel) {
  bool ready = channel.is_ready();
  if (!ready) {
    ready = channel.wait_ready_timeout(kReadTimeoutMs, 1);
  }
  Serial.printf("%s ready=%s", label, ready ? "true" : "false");
  if (ready) {
    Serial.printf(" raw=%ld\n", channel.read());
  } else {
    Serial.printf(" timeout=%lu ms\n", static_cast<unsigned long>(kReadTimeoutMs));
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nPourframe HX711 hardware validation");
  Serial.printf("Upper DOUT=%u SCK=%u; Lower DOUT=%u SCK=%u\n", kUpperDout, kUpperClock, kLowerDout, kLowerClock);
  upper.begin(kUpperDout, kUpperClock, 128);
  lower.begin(kLowerDout, kLowerClock, 128);
}

void loop() {
  const uint32_t now = millis();
  if (now - lastReportMs >= kReportIntervalMs) {
    lastReportMs = now;
    reportChannel("upper", upper);
    reportChannel("lower", lower);
  }
  delay(2);
}
