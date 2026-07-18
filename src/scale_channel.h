#pragma once

#include <Arduino.h>
#include <HX711.h>

#include "app_types.h"

// Thin HX711 owner. Filtering, calibration transforms, state, and history live
// in MeasurementPipeline and are driven only by DualScaleReader's task.
class ScaleChannel {
 public:
  ScaleChannel(ScaleId id, uint8_t doutPin, uint8_t clockPin);

  void begin();
  bool isReady();
  int32_t readRaw();
  ScaleId id() const;
  void powerDown();
  void powerUp();

 private:
  ScaleId id_;
  uint8_t doutPin_;
  uint8_t clockPin_;
  HX711 adc_;
};
