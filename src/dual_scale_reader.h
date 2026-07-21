#pragma once

#include <Arduino.h>

#include <measurement_pipeline.h>
#include <sample_pair_assembler.h>

#include "app_types.h"
#include "scale_channel.h"

enum class SensorResultType : uint8_t { Tare, Calibration };

struct SensorCommandResult {
  SensorResultType type = SensorResultType::Tare;
  ScaleId scale = ScaleId::Upper;
  uint32_t clientId = 0;
  char requestId[37]{};
  bool ok = false;
  float factor = 0.0f;
  const char *message = nullptr;
};

class DualScaleReader {
 public:
  DualScaleReader(uint8_t upperDout, uint8_t upperClock, uint8_t lowerDout, uint8_t lowerClock);

  bool begin(float upperFactor, bool upperCalibrated, float lowerFactor, bool lowerCalibrated);
  bool submit(const AppCommand &command);
  bool takeResult(SensorCommandResult &result);
  measurement::MeasurementSnapshot snapshot(uint32_t nowMs) const;

 private:
  struct CalibrationCapture {
    bool active = false;
    uint64_t startedUs = 0;
    double sum = 0.0;
    int32_t minimum = 0;
    int32_t maximum = 0;
    uint16_t count = 0;
    float knownGrams = 0.0f;
    AppCommand command{};
  };

  static void taskEntry(void *context);
  void taskLoop();
  void processSensorCommands();
  void processPair(measurement::RawSamplePair pair);
  void recordChannelSample(uint8_t channel, uint64_t timestampUs);
  void processTares(const measurement::MeasurementSnapshot &snapshot);
  void processCalibration(uint8_t channel, int32_t medianRaw, uint64_t timestampUs);
  void finishCalibration(uint8_t channel, bool ok, float factor, const char *message);
  void sendResult(const AppCommand &command, SensorResultType type, bool ok, float factor, const char *message);
  void publishSnapshot(const measurement::MeasurementSnapshot &snapshot);

  ScaleChannel upper_;
  ScaleChannel lower_;
  measurement::MeasurementPipeline pipeline_;
  measurement::SamplePairAssembler pairAssembler_;
  QueueHandle_t sensorCommands_ = nullptr;
  QueueHandle_t sensorResults_ = nullptr;
  TaskHandle_t task_ = nullptr;
  mutable portMUX_TYPE snapshotMux_ = portMUX_INITIALIZER_UNLOCKED;
  measurement::MeasurementSnapshot latest_{};
  AppCommand pendingTare_[2]{};
  bool tarePending_[2]{false, false};
  CalibrationCapture calibrationCapture_[2]{};
  uint32_t sequence_ = 0;
  uint32_t droppedSamples_ = 0;
  uint32_t partialSamples_ = 0;
  uint64_t lastPairUs_ = 0;
  uint64_t lastChannelUs_[2]{0, 0};
  double observedRateHz_ = measurement::config::kNominalSampleRateHz;
  bool observedRateInitialized_ = false;
  double observedChannelRateHz_[2]{measurement::config::kNominalSampleRateHz,
                                   measurement::config::kNominalSampleRateHz};
  bool observedChannelRateInitialized_[2]{false, false};
};
