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
  bool setTarget(TargetId target, float grams);
  void clearTarget(TargetId target);
  const TargetConfig &config(TargetId target) const;

 private:
  TargetConfig &mutableConfig(TargetId target);
  void load(TargetId target);
  void persist(TargetId target);
  const char *keyFor(TargetId target, const char *upperKey, const char *lowerKey, const char *totalKey) const;

  Preferences *preferences_ = nullptr;
  TargetConfig upper_{};
  TargetConfig lower_{};
  TargetConfig total_{};
};
