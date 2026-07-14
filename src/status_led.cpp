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

bool validReading(const ScaleSnapshot &snapshot, const TargetConfig &target) {
  return target.enabled && target.historyCount > 0 && snapshot.available && snapshot.ready && !snapshot.stale &&
         !snapshot.disconnected && !snapshot.calibrating && isfinite(snapshot.grams);
}

uint8_t statePriority(TargetLedState state) { return static_cast<uint8_t>(state); }

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

void StatusLed::update(uint32_t nowMs, const ScaleSnapshot &upper, const TargetConfig &upperTarget,
                       const ScaleSnapshot &lower, const TargetConfig &lowerTarget) {
  if (nowMs - lastRenderMs_ < kRenderIntervalMs) {
    return;
  }
  lastRenderMs_ = nowMs;
  render(nowMs, combine(evaluate(upper, upperTarget), evaluate(lower, lowerTarget)));
}

TargetLedEvaluation StatusLed::evaluate(const ScaleSnapshot &snapshot, const TargetConfig &target) {
  if (!validReading(snapshot, target)) {
    return {};
  }

  const float targetGrams = target.activeGrams();
  const float difference = snapshot.grams - targetGrams;
  if (difference > kTargetToleranceGrams) {
    return {TargetLedState::Overweight, 1.0f};
  }
  if (fabsf(difference) <= kTargetToleranceGrams) {
    return {TargetLedState::AtTarget, 1.0f};
  }

  const float approachStart = targetGrams * kApproachFraction;
  const float approachEnd = targetGrams - kTargetToleranceGrams;
  if (snapshot.grams >= approachStart && snapshot.grams < approachEnd) {
    const float window = approachEnd - approachStart;
    const float proximity = window > 0.0f ? constrain((snapshot.grams - approachStart) / window, 0.0f, 1.0f) : 1.0f;
    return {TargetLedState::Approaching, proximity};
  }
  return {};
}

TargetLedEvaluation StatusLed::combine(const TargetLedEvaluation &upper, const TargetLedEvaluation &lower) {
  if (statePriority(lower.state) > statePriority(upper.state)) {
    return lower;
  }
  if (upper.state == TargetLedState::Approaching && lower.state == TargetLedState::Approaching &&
      lower.proximity > upper.proximity) {
    return lower;
  }
  return upper;
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
