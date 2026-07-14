#pragma once

#include <Arduino.h>

#include "scale_channel.h"
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

class StatusLed {
 public:
  void begin();
  void update(uint32_t nowMs, const ScaleSnapshot &upper, const TargetConfig &upperTarget,
              const ScaleSnapshot &lower, const TargetConfig &lowerTarget);

  static TargetLedEvaluation evaluate(const ScaleSnapshot &snapshot, const TargetConfig &target);

 private:
  static TargetLedEvaluation combine(const TargetLedEvaluation &upper, const TargetLedEvaluation &lower);
  void render(uint32_t nowMs, const TargetLedEvaluation &evaluation);

  uint32_t lastRenderMs_ = 0;
};
