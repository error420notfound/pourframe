#include "target_store.h"

#include <cmath>

namespace {
constexpr float kTargetPrecision = 10.0f;
constexpr float kDuplicateToleranceGrams = 0.05f;

const char *historyKey(TargetId target, uint8_t index) {
  static const char *const upperKeys[TargetConfig::kHistoryCapacity] = {"ut0", "ut1", "ut2", "ut3", "ut4"};
  static const char *const lowerKeys[TargetConfig::kHistoryCapacity] = {"lt0", "lt1", "lt2", "lt3", "lt4"};
  static const char *const totalKeys[TargetConfig::kHistoryCapacity] = {"tt0", "tt1", "tt2", "tt3", "tt4"};
  if (target == TargetId::Total) {
    return totalKeys[index];
  }
  return target == TargetId::Upper ? upperKeys[index] : lowerKeys[index];
}
}  // namespace

void TargetStore::begin(Preferences &preferences) {
  preferences_ = &preferences;
  load(TargetId::Upper);
  load(TargetId::Lower);
  load(TargetId::Total);

  if (!preferences_->getBool("tm", false)) {
    if (total_.historyCount == 0) {
      float migratedGrams = 0.0f;
      if (upper_.enabled && upper_.historyCount > 0) {
        migratedGrams += upper_.activeGrams();
      }
      if (lower_.enabled && lower_.historyCount > 0) {
        migratedGrams += lower_.activeGrams();
      }
      if (migratedGrams > 0.0f) {
        setTarget(TargetId::Total, migratedGrams);
      }
    }
    preferences_->putBool("tm", true);
  }
}

bool TargetStore::setTarget(TargetId targetId, float grams) {
  if (preferences_ == nullptr || !isfinite(grams) || grams <= 0.0f) {
    return false;
  }

  const float rounded = roundf(grams * kTargetPrecision) / kTargetPrecision;
  if (rounded <= 0.0f) {
    return false;
  }

  TargetConfig &target = mutableConfig(targetId);
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
  persist(targetId);
  return true;
}

void TargetStore::clearTarget(TargetId targetId) {
  if (preferences_ == nullptr) {
    return;
  }
  mutableConfig(targetId).enabled = false;
  persist(targetId);
}

const TargetConfig &TargetStore::config(TargetId target) const {
  if (target == TargetId::Total) {
    return total_;
  }
  return target == TargetId::Upper ? upper_ : lower_;
}

TargetConfig &TargetStore::mutableConfig(TargetId target) {
  if (target == TargetId::Total) {
    return total_;
  }
  return target == TargetId::Upper ? upper_ : lower_;
}

void TargetStore::load(TargetId targetId) {
  if (preferences_ == nullptr) {
    return;
  }
  TargetConfig &target = mutableConfig(targetId);
  target = {};
  const uint8_t storedCount = preferences_->getUChar(keyFor(targetId, "uc", "lc", "tc"), 0);
  for (uint8_t index = 0; index < min(storedCount, TargetConfig::kHistoryCapacity); ++index) {
    const float value = preferences_->getFloat(historyKey(targetId, index), 0.0f);
    if (isfinite(value) && value > 0.0f) {
      target.history[target.historyCount++] = value;
    }
  }
  target.enabled =
      target.historyCount > 0 && preferences_->getBool(keyFor(targetId, "ue", "le", "te"), target.historyCount > 0);
}

void TargetStore::persist(TargetId targetId) {
  TargetConfig &target = mutableConfig(targetId);
  preferences_->putUChar(keyFor(targetId, "uc", "lc", "tc"), target.historyCount);
  preferences_->putBool(keyFor(targetId, "ue", "le", "te"), target.enabled);
  for (uint8_t index = 0; index < target.historyCount; ++index) {
    preferences_->putFloat(historyKey(targetId, index), target.history[index]);
  }
}

const char *TargetStore::keyFor(TargetId target, const char *upperKey, const char *lowerKey,
                                const char *totalKey) const {
  if (target == TargetId::Total) {
    return totalKey;
  }
  return target == TargetId::Upper ? upperKey : lowerKey;
}
