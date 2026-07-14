#include "target_store.h"

#include <cmath>

namespace {
constexpr float kTargetPrecision = 10.0f;
constexpr float kDuplicateToleranceGrams = 0.05f;

const char *historyKey(ScaleId scale, uint8_t index) {
  static const char *const upperKeys[TargetConfig::kHistoryCapacity] = {"ut0", "ut1", "ut2", "ut3", "ut4"};
  static const char *const lowerKeys[TargetConfig::kHistoryCapacity] = {"lt0", "lt1", "lt2", "lt3", "lt4"};
  return scale == ScaleId::Upper ? upperKeys[index] : lowerKeys[index];
}
}  // namespace

void TargetStore::begin(Preferences &preferences) {
  preferences_ = &preferences;
  load(ScaleId::Upper);
  load(ScaleId::Lower);
}

bool TargetStore::setTarget(ScaleId scale, float grams) {
  if (preferences_ == nullptr || !isfinite(grams) || grams <= 0.0f) {
    return false;
  }

  const float rounded = roundf(grams * kTargetPrecision) / kTargetPrecision;
  if (rounded <= 0.0f) {
    return false;
  }

  TargetConfig &target = mutableConfig(scale);
  float updated[TargetConfig::kHistoryCapacity]{};
  uint8_t count = 1;
  updated[0] = rounded;
  for (uint8_t index = 0; index < target.historyCount && count < TargetConfig::kHistoryCapacity; ++index) {
    if (fabsf(target.history[index] - rounded) < kDuplicateToleranceGrams) {
      continue;
    }
    updated[count++] = target.history[index];
  }
  memcpy(target.history, updated, sizeof(updated));
  target.historyCount = count;
  target.enabled = true;
  persist(scale);
  return true;
}

void TargetStore::clearTarget(ScaleId scale) {
  if (preferences_ == nullptr) {
    return;
  }
  mutableConfig(scale).enabled = false;
  persist(scale);
}

const TargetConfig &TargetStore::config(ScaleId scale) const { return scale == ScaleId::Upper ? upper_ : lower_; }

TargetConfig &TargetStore::mutableConfig(ScaleId scale) { return scale == ScaleId::Upper ? upper_ : lower_; }

void TargetStore::load(ScaleId scale) {
  if (preferences_ == nullptr) {
    return;
  }
  TargetConfig &target = mutableConfig(scale);
  target = {};
  const uint8_t storedCount = preferences_->getUChar(keyFor(scale, "uc", "lc"), 0);
  for (uint8_t index = 0; index < min(storedCount, TargetConfig::kHistoryCapacity); ++index) {
    const float value = preferences_->getFloat(historyKey(scale, index), 0.0f);
    if (isfinite(value) && value > 0.0f) {
      target.history[target.historyCount++] = value;
    }
  }
  target.enabled = target.historyCount > 0 && preferences_->getBool(keyFor(scale, "ue", "le"), target.historyCount > 0);
}

void TargetStore::persist(ScaleId scale) {
  TargetConfig &target = mutableConfig(scale);
  preferences_->putUChar(keyFor(scale, "uc", "lc"), target.historyCount);
  preferences_->putBool(keyFor(scale, "ue", "le"), target.enabled);
  for (uint8_t index = 0; index < target.historyCount; ++index) {
    preferences_->putFloat(historyKey(scale, index), target.history[index]);
  }
}

const char *TargetStore::keyFor(ScaleId scale, const char *upperKey, const char *lowerKey) const {
  return scale == ScaleId::Upper ? upperKey : lowerKey;
}
