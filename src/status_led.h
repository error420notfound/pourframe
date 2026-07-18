#pragma once

#include <Arduino.h>

#include <measurement_types.h>

#include "target_store.h"

enum class TargetLedState : uint8_t {
  Normal,
  Approaching,
  AtTarget,
  Overweight,
};

struct TargetLedEvaluation {
  TargetLedEvaluation(TargetLedState stateValue = TargetLedState::Normal, float proximityValue = 0.0f)
      : state(stateValue), proximity(proximityValue) {}

  TargetLedState state;
  float proximity;
};

struct TotalWeightReading {
  float grams = 0.0f;
  bool available = false;
  bool partial = false;
  bool upperIncluded = false;
  bool lowerIncluded = false;
};

class StatusLed {
 public:
  void begin();
  void update(uint32_t nowMs, const TotalWeightReading &reading, const TargetConfig &target);

  static TotalWeightReading totalReading(const measurement::MeasurementSnapshot &snapshot);
  static TargetLedEvaluation evaluate(const TotalWeightReading &reading, const TargetConfig &target);
  static const char *stateName(TargetLedState state);

 private:
  void render(uint32_t nowMs, const TargetLedEvaluation &evaluation);

  uint32_t lastRenderMs_ = 0;
};
