#pragma once

#include <Arduino.h>
#include <led_controller.h>
#include <measurement_types.h>

#include "target_store.h"

enum class TargetLedState : uint8_t { Normal, Approaching, AtTarget, Overweight };

struct TargetLedEvaluation {
  TargetLedEvaluation(TargetLedState stateValue = TargetLedState::Normal, float proximityValue = 0.0f) : state(stateValue), proximity(proximityValue) {}
  TargetLedState state;
  float proximity;
};

struct TotalWeightReading {
  double grams = 0.0;
  bool available = false;
  bool partial = false;
  bool upperIncluded = false;
  bool lowerIncluded = false;
};

class StatusLed {
 public:
  void begin();
  void update(uint32_t nowMs, const measurement::MeasurementSnapshot &snapshot, const TargetConfig &target);
  led::CommandResult startCue(const char *cueId, uint8_t pulses, uint16_t intervalMs, uint32_t nowMs);
  led::CommandResult cancelCue(const char *cueId);
  led::CommandResult activateStep(const char *transitionId, float baselineTotal, float stepTarget, float cumulativeTarget);
  void clearStep();
  led::CueStatus cueStatus() const;

  static TotalWeightReading totalReading(const measurement::MeasurementSnapshot &snapshot);
  static TargetLedEvaluation evaluate(const TotalWeightReading &reading, const TargetConfig &target);
  static const char *stateName(TargetLedState state);

 private:
  static led::Health health(const measurement::MeasurementSnapshot &snapshot, const TotalWeightReading &reading);
  TargetLedEvaluation activeEvaluation(const TotalWeightReading &reading, const TargetConfig &target) const;
  led::Color baseColor(uint32_t nowMs, const TargetLedEvaluation &evaluation) const;

  uint32_t lastRenderMs_ = 0;
  led::Health lastHealth_ = led::Health::Unavailable;
  led::Controller controller_;
};
