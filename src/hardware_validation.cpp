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
constexpr uint32_t kReportIntervalMs = 2000;

HX711 upper;
HX711 lower;
CRGB rgbLeds[kRgbLedCount];
uint32_t lastReportMs = 0;
uint32_t lastRainbowStepMs = 0;
uint32_t upperSamples = 0;
uint32_t lowerSamples = 0;
uint32_t pairedSamples = 0;
uint32_t maximumPairSkewUs = 0;
int32_t upperRaw = 0;
int32_t lowerRaw = 0;
uint8_t rainbowHue = 0;

void beginRgbLed() {
  FastLED.addLeds<WS2812B, kRgbDataPin, GRB>(rgbLeds, kRgbLedCount).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(kRgbBrightness);
  const CRGB startupColors[] = {CRGB::Red, CRGB::Green, CRGB::Blue, CRGB::White, CRGB::Black};
  for (const CRGB &color : startupColors) {
    rgbLeds[0] = color;
    FastLED.show();
    delay(300);
  }
}

void updateRainbow(uint32_t nowMs) {
  if (nowMs - lastRainbowStepMs < kRainbowStepIntervalMs) return;
  lastRainbowStepMs = nowMs;
  rgbLeds[0] = CHSV(++rainbowHue, 255, 255);
  FastLED.show();
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nPourframe HX711 hardware validation");
  Serial.printf("Upper DOUT=%u SCK=%u; Lower DOUT=%u SCK=%u\n", kUpperDout, kUpperClock, kLowerDout, kLowerClock);
  Serial.println("Rates are measured continuously; expected clusters are 8-12 Hz or 78-82 Hz.");
  beginRgbLed();
  upper.begin(kUpperDout, kUpperClock, 128);
  lower.begin(kLowerDout, kLowerClock, 128);
  lastReportMs = millis();
}

void loop() {
  const uint32_t nowMs = millis();
  updateRainbow(nowMs);
  const bool upperReady = upper.is_ready();
  const bool lowerReady = lower.is_ready();
  if (upperReady && lowerReady) {
    const uint32_t upperUs = micros();
    upperRaw = upper.read();
    const uint32_t lowerUs = micros();
    lowerRaw = lower.read();
    ++upperSamples;
    ++lowerSamples;
    ++pairedSamples;
    maximumPairSkewUs = max(maximumPairSkewUs, lowerUs - upperUs);
  } else if (upperReady) {
    upperRaw = upper.read();
    ++upperSamples;
  } else if (lowerReady) {
    lowerRaw = lower.read();
    ++lowerSamples;
  }

  const uint32_t elapsedMs = nowMs - lastReportMs;
  if (elapsedMs >= kReportIntervalMs) {
    const float seconds = elapsedMs / 1000.0f;
    Serial.printf("upper_raw=%ld upper_hz=%.2f lower_raw=%ld lower_hz=%.2f paired=%lu max_pair_skew_us=%lu\n",
                  static_cast<long>(upperRaw), upperSamples / seconds, static_cast<long>(lowerRaw), lowerSamples / seconds,
                  static_cast<unsigned long>(pairedSamples), static_cast<unsigned long>(maximumPairSkewUs));
    upperSamples = lowerSamples = pairedSamples = maximumPairSkewUs = 0;
    lastReportMs = nowMs;
  }
  delay(1);
}
