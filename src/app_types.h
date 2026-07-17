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
