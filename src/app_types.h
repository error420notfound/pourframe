#pragma once

#include <Arduino.h>

enum class ScaleId : uint8_t {
  Upper,
  Lower,
};

enum class TargetId : uint8_t {
  Upper,
  Lower,
  Total,
};

enum class CommandType : uint8_t {
  Tare,
  Calibrate,
  SetTarget,
  ClearTarget,
  SaveWifi,
  BrewStepCue,
  BrewStepCueCancel,
  BrewStepActivate,
  BrewStepClear,
};

struct AppCommand {
  CommandType type;
  ScaleId scale;
  TargetId target;
  uint32_t clientId;
  char requestId[37];
  float knownGrams;
  float targetGrams;
  char ssid[33];
  char password[65];
  char cueId[97];
  char transitionId[97];
  uint8_t pulseCount;
  uint16_t intervalMs;
  float baselineTotalGrams;
  float stepTargetGrams;
  float cumulativeTargetGrams;
};

inline const char *scaleIdName(ScaleId scale) {
  return scale == ScaleId::Upper ? "upper" : "lower";
}

inline const char *targetIdName(TargetId target) {
  if (target == TargetId::Total) {
    return "total";
  }
  return target == TargetId::Upper ? "upper" : "lower";
}
