#pragma once

#include <Arduino.h>

enum class ScaleId : uint8_t {
  Upper,
  Lower,
};

enum class CommandType : uint8_t {
  Tare,
  Calibrate,
  SaveWifi,
};

struct AppCommand {
  CommandType type;
  ScaleId scale;
  uint32_t clientId;
  char requestId[37];
  float knownGrams;
  char ssid[33];
  char password[65];
};

inline const char *scaleIdName(ScaleId scale) {
  return scale == ScaleId::Upper ? "upper" : "lower";
}
