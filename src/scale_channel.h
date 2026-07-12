#pragma once

#include <Arduino.h>
#include <HX711.h>

#include "app_types.h"

struct ScaleSnapshot {
  long raw;
  float grams;
  long offset;
  float scaleFactor;
  bool available;
  bool ready;
  bool stale;
  bool disconnected;
  bool calibrating;
  uint32_t lastSampleMs;
};

class ScaleChannel {
 public:
  ScaleChannel(ScaleId id, uint8_t doutPin, uint8_t clockPin);

  void begin(float calibrationFactor);
  bool poll(uint32_t nowMs);
  bool tare();
  bool startCalibration(float knownGrams);
  bool takeCalibrationResult(float &factor, bool &succeeded);
  void setScaleFactor(float factor);
  float scaleFactor() const;
  ScaleSnapshot snapshot(uint32_t nowMs) const;
  ScaleId id() const;
  void powerDown();
  void powerUp();

 private:
  static constexpr size_t kMedianWindow = 5;
  static constexpr uint8_t kCalibrationSamples = 10;
  static constexpr float kEmaAlpha = 0.25f;
  static constexpr uint32_t kStaleAfterMs = 1000;
  static constexpr uint32_t kDisconnectedAfterMs = 5000;

  long medianRaw() const;
  void consumeCalibrationSample(long raw);

  ScaleId id_;
  uint8_t doutPin_;
  uint8_t clockPin_;
  HX711 adc_;
  long window_[kMedianWindow]{};
  size_t windowCount_ = 0;
  size_t windowIndex_ = 0;
  long latestRaw_ = 0;
  float filteredRaw_ = 0.0f;
  float scaleFactor_ = 1.0f;
  long tareOffset_ = 0;
  uint32_t startedAtMs_ = 0;
  uint32_t lastSampleMs_ = 0;
  bool hasSample_ = false;

  bool calibrating_ = false;
  float knownCalibrationGrams_ = 0.0f;
  int64_t calibrationRawSum_ = 0;
  uint8_t calibrationSampleCount_ = 0;
  bool calibrationResultPending_ = false;
  bool calibrationSucceeded_ = false;
};
