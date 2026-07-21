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
  return health.available && health.ready && !health.stale && !health.disconnected && !health.calibrating && health.calibrated && health.cadenceValid && !health.saturated && isfinite(grams);
}
}

void StatusLed::begin() {
  FastLED.addLeds<WS2812B, kDataPin, GRB>(statusPixels, kLedCount).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(kMaxBrightness);
  statusPixels[0] = CRGB::Black;
  FastLED.show();
}

void StatusLed::update(uint32_t nowMs, const measurement::MeasurementSnapshot &snapshot, const TargetConfig &target) {
  if (nowMs - lastRenderMs_ < kRenderIntervalMs) return;
  lastRenderMs_ = nowMs;
  const TotalWeightReading reading = totalReading(snapshot);
  lastHealth_ = health(snapshot, reading);
  const led::Color output = controller_.update(nowMs, lastHealth_, baseColor(nowMs, activeEvaluation(reading, target)));
  CRGB color(output.red, output.green, output.blue);
  color.nscale8_video(output.brightness);
  statusPixels[0] = color;
  FastLED.show();
}

led::CommandResult StatusLed::startCue(const char *cueId, uint8_t pulses, uint16_t intervalMs, uint32_t nowMs) { return controller_.startCue(cueId, pulses, intervalMs, nowMs, lastHealth_); }
led::CommandResult StatusLed::cancelCue(const char *cueId) { return controller_.cancelCue(cueId); }
led::CommandResult StatusLed::activateStep(const char *transitionId, float baselineTotal, float stepTarget, float cumulativeTarget) { return controller_.activateStep(transitionId, baselineTotal, stepTarget, cumulativeTarget); }
void StatusLed::clearStep() { controller_.clearStep(); }
led::CueStatus StatusLed::cueStatus() const { return controller_.cueStatus(); }

TotalWeightReading StatusLed::totalReading(const measurement::MeasurementSnapshot &snapshot) {
  TotalWeightReading reading{};
  reading.upperIncluded = usableReading(snapshot.upperHealth, snapshot.upperFiltered);
  reading.lowerIncluded = usableReading(snapshot.lowerHealth, snapshot.lowerFiltered);
  if (reading.upperIncluded) reading.grams += snapshot.upperFiltered;
  if (reading.lowerIncluded) reading.grams += snapshot.lowerFiltered;
  reading.available = reading.upperIncluded || reading.lowerIncluded;
  reading.partial = reading.upperIncluded != reading.lowerIncluded;
  return reading;
}

led::Health StatusLed::health(const measurement::MeasurementSnapshot &snapshot, const TotalWeightReading &reading) {
  if (!reading.available) return led::Health::Unavailable;
  if (reading.partial || !snapshot.pairValid || snapshot.state == measurement::MeasurementState::DisturbedOrUncertain) return led::Health::Degraded;
  return led::Health::Healthy;
}

TargetLedEvaluation StatusLed::evaluate(const TotalWeightReading &reading, const TargetConfig &target) {
  if (!reading.available || !target.enabled || target.historyCount == 0 || !isfinite(reading.grams)) return {};
  const float targetGrams = target.activeGrams();
  const double difference = reading.grams - targetGrams;
  if (difference > kTargetToleranceGrams) return {TargetLedState::Overweight, 1.0f};
  if (std::fabs(difference) <= kTargetToleranceGrams) return {TargetLedState::AtTarget, 1.0f};
  const float approachStart = targetGrams * kApproachFraction;
  const float approachEnd = targetGrams - kTargetToleranceGrams;
  if (reading.grams >= approachStart && reading.grams < approachEnd) {
    const float window = approachEnd - approachStart;
    return {TargetLedState::Approaching, window > 0.0f ? static_cast<float>(constrain((reading.grams - approachStart) / window, 0.0, 1.0)) : 1.0f};
  }
  return {};
}

TargetLedEvaluation StatusLed::activeEvaluation(const TotalWeightReading &reading, const TargetConfig &target) const {
  const led::StepTarget &step = controller_.stepTarget();
  if (!step.active || !reading.available) return evaluate(reading, target);
  const double stepAdded = reading.grams - step.baselineTotal;
  if (stepAdded - step.stepGrams > kTargetToleranceGrams || reading.grams - step.cumulativeGrams > kTargetToleranceGrams) return {TargetLedState::Overweight, 1.0f};
  const double difference = stepAdded - step.stepGrams;
  if (std::fabs(difference) <= kTargetToleranceGrams) return {TargetLedState::AtTarget, 1.0f};
  const double approachStart = step.stepGrams * kApproachFraction;
  const double approachEnd = step.stepGrams - kTargetToleranceGrams;
  if (stepAdded >= approachStart && stepAdded < approachEnd) return {TargetLedState::Approaching, static_cast<float>(constrain((stepAdded - approachStart) / (approachEnd - approachStart), 0.0, 1.0))};
  return {};
}

const char *StatusLed::stateName(TargetLedState state) {
  if (state == TargetLedState::Approaching) return "approaching";
  if (state == TargetLedState::AtTarget) return "at_target";
  if (state == TargetLedState::Overweight) return "overweight";
  return "normal";
}

led::Color StatusLed::baseColor(uint32_t nowMs, const TargetLedEvaluation &evaluation) const {
  if (evaluation.state == TargetLedState::Approaching) {
    const uint32_t period = static_cast<uint32_t>(kSlowYellowPeriodMs - evaluation.proximity * (kSlowYellowPeriodMs - kFastYellowPeriodMs));
    return nowMs % period < period / 2 ? led::Color{255, 255, 0, 255, false} : led::Color{};
  }
  if (evaluation.state == TargetLedState::AtTarget) {
    const float phase = static_cast<float>(nowMs % kRedBreathingPeriodMs) / kRedBreathingPeriodMs;
    const float wave = (sinf(phase * TWO_PI - HALF_PI) + 1.0f) * 0.5f;
    return {255, 0, 0, static_cast<uint8_t>(24.0f + wave * 231.0f), false};
  }
  if (evaluation.state == TargetLedState::Overweight) return {160, 0, 255, static_cast<uint8_t>(nowMs % kPurplePulsePeriodMs < kPurplePulseOnMs ? 255 : 16), false};
  return {0, 255, 0, 255, false};
}
