#include "status_led.h"

#include <FastLED.h>

#include <cmath>

namespace {
constexpr uint8_t kDataPin = 3;
constexpr uint8_t kLedCount = 1;
constexpr uint8_t kMaxBrightness = 128;
constexpr float kTargetToleranceGrams = 0.2f;
constexpr float kApproachFraction = 0.9f;
constexpr uint32_t kRenderIntervalMs = 20;
constexpr uint32_t kSlowYellowPeriodMs = 1000;
constexpr uint32_t kFastYellowPeriodMs = 200;
constexpr uint32_t kRedBreathingPeriodMs = 2000;
constexpr uint32_t kPurplePulsePeriodMs = 500;
constexpr uint32_t kPurplePulseOnMs = 150;

CRGB statusPixels[kLedCount];

bool usableReading(const measurement::ChannelHealth &health, double grams) {
  return health.available && health.ready && !health.stale && !health.disconnected && !health.calibrating &&
         health.calibrated && isfinite(grams);
}

CRGB scaledColor(const CRGB &color, uint8_t scale) {
  CRGB output = color;
  output.nscale8_video(scale);
  return output;
}
}  // namespace

void StatusLed::begin() {
  FastLED.addLeds<WS2812B, kDataPin, GRB>(statusPixels, kLedCount).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(kMaxBrightness);
  statusPixels[0] = CRGB::Green;
  FastLED.show();
}

void StatusLed::update(uint32_t nowMs, const TotalWeightReading &reading, const TargetConfig &target) {
  if (nowMs - lastRenderMs_ < kRenderIntervalMs) {
    return;
  }
  lastRenderMs_ = nowMs;
  render(nowMs, evaluate(reading, target));
}

TotalWeightReading StatusLed::totalReading(const measurement::MeasurementSnapshot &snapshot) {
  TotalWeightReading reading{};
  reading.upperIncluded = usableReading(snapshot.upperHealth, snapshot.upperFiltered);
  reading.lowerIncluded = usableReading(snapshot.lowerHealth, snapshot.lowerFiltered);
  if (reading.upperIncluded) {
    reading.grams += snapshot.upperFiltered;
  }
  if (reading.lowerIncluded) {
    reading.grams += snapshot.lowerFiltered;
  }
  reading.available = reading.upperIncluded || reading.lowerIncluded;
  reading.partial = reading.upperIncluded != reading.lowerIncluded;
  return reading;
}

TargetLedEvaluation StatusLed::evaluate(const TotalWeightReading &reading, const TargetConfig &target) {
  if (!reading.available || !target.enabled || target.historyCount == 0 || !isfinite(reading.grams)) {
    return {};
  }

  const float targetGrams = target.activeGrams();
  const double difference = reading.grams - targetGrams;
  if (difference > kTargetToleranceGrams) {
    return {TargetLedState::Overweight, 1.0f};
  }
  if (std::fabs(difference) <= kTargetToleranceGrams) {
    return {TargetLedState::AtTarget, 1.0f};
  }

  const float approachStart = targetGrams * kApproachFraction;
  const float approachEnd = targetGrams - kTargetToleranceGrams;
  if (reading.grams >= approachStart && reading.grams < approachEnd) {
    const float window = approachEnd - approachStart;
    const float proximity = window > 0.0f ? constrain((reading.grams - approachStart) / window, 0.0f, 1.0f) : 1.0f;
    return {TargetLedState::Approaching, proximity};
  }
  return {};
}

const char *StatusLed::stateName(TargetLedState state) {
  if (state == TargetLedState::Approaching) {
    return "approaching";
  }
  if (state == TargetLedState::AtTarget) {
    return "at_target";
  }
  if (state == TargetLedState::Overweight) {
    return "overweight";
  }
  return "normal";
}

void StatusLed::render(uint32_t nowMs, const TargetLedEvaluation &evaluation) {
  CRGB color = CRGB::Green;
  if (evaluation.state == TargetLedState::Approaching) {
    const uint32_t period = static_cast<uint32_t>(
        kSlowYellowPeriodMs - evaluation.proximity * (kSlowYellowPeriodMs - kFastYellowPeriodMs));
    color = nowMs % period < period / 2 ? CRGB::Yellow : CRGB::Black;
  } else if (evaluation.state == TargetLedState::AtTarget) {
    const float phase = static_cast<float>(nowMs % kRedBreathingPeriodMs) / kRedBreathingPeriodMs;
    const float wave = (sinf(phase * TWO_PI - HALF_PI) + 1.0f) * 0.5f;
    color = scaledColor(CRGB::Red, static_cast<uint8_t>(24.0f + wave * 231.0f));
  } else if (evaluation.state == TargetLedState::Overweight) {
    color = nowMs % kPurplePulsePeriodMs < kPurplePulseOnMs ? CRGB(160, 0, 255)
                                                            : scaledColor(CRGB(160, 0, 255), 16);
  }
  statusPixels[0] = color;
  FastLED.show();
}
