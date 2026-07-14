#pragma once

#include <Arduino.h>
#include <Preferences.h>

#include "app_types.h"

struct TargetConfig {
  static constexpr uint8_t kHistoryCapacity = 5;

  bool enabled = false;
  float history[kHistoryCapacity]{};
  uint8_t historyCount = 0;

  float activeGrams() const { return enabled && historyCount > 0 ? history[0] : 0.0f; }
};

class TargetStore {
 public:
  void begin(Preferences &preferences);
  bool setTarget(ScaleId scale, float grams);
  void clearTarget(ScaleId scale);
  const TargetConfig &config(ScaleId scale) const;

 private:
  TargetConfig &mutableConfig(ScaleId scale);
  void load(ScaleId scale);
  void persist(ScaleId scale);
  const char *keyFor(ScaleId scale, const char *upperKey, const char *lowerKey) const;

  Preferences *preferences_ = nullptr;
  TargetConfig upper_{};
  TargetConfig lower_{};
};
