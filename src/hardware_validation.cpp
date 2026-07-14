#include <Arduino.h>
#include <FastLED.h>
#include <HX711.h>

namespace {
constexpr uint8_t kUpperDout = 4;
constexpr uint8_t kUpperClock = 5;
constexpr uint8_t kLowerDout = 6;
constexpr uint8_t kLowerClock = 7;
constexpr uint8_t kRgbDataPin = 3;
constexpr uint8_t kRgbLedCount = 1;
constexpr uint8_t kRgbBrightness = 255;
constexpr uint32_t kRainbowStepIntervalMs = 20;
constexpr uint32_t kReadTimeoutMs = 150;
constexpr uint32_t kReportIntervalMs = 500;

HX711 upper;
HX711 lower;
CRGB rgbLeds[kRgbLedCount];
uint32_t lastReportMs = 0;
uint32_t lastRainbowStepMs = 0;
uint8_t rainbowHue = 0;

void beginRgbLed() {
  FastLED.addLeds<WS2812B, kRgbDataPin, GRB>(rgbLeds, kRgbLedCount).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(kRgbBrightness);
  const CRGB startupColors[] = {CRGB::Red, CRGB::Green, CRGB::Blue, CRGB::White, CRGB::Black};
  for (const CRGB &color : startupColors) {
    rgbLeds[0] = color;
    FastLED.show();
    delay(500);
  }
}

void updateRainbow(uint32_t nowMs) {
  if (nowMs - lastRainbowStepMs < kRainbowStepIntervalMs) {
    return;
  }
  lastRainbowStepMs = nowMs;
  rgbLeds[0] = CHSV(++rainbowHue, 255, 255);
  FastLED.show();
}

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
  Serial.printf("WS2812 data pin=%u count=%u brightness=%u/255\n", kRgbDataPin, kRgbLedCount, kRgbBrightness);
  beginRgbLed();
  upper.begin(kUpperDout, kUpperClock, 128);
  lower.begin(kLowerDout, kLowerClock, 128);
}

void loop() {
  const uint32_t now = millis();
  updateRainbow(now);
  if (now - lastReportMs >= kReportIntervalMs) {
    lastReportMs = now;
    reportChannel("upper", upper);
    reportChannel("lower", lower);
  }
  delay(2);
}
