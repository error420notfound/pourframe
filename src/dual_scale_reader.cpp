#include "dual_scale_reader.h"

#include <esp_timer.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace {
constexpr uint8_t kSensorCommandQueueLength = 8;
constexpr uint8_t kSensorResultQueueLength = 8;
constexpr uint32_t kCalibrationDurationUs = 1000000;
constexpr uint16_t kCalibrationMinimumSamples = 8;
constexpr double kCalibrationMaxMotionFraction = 0.02;
constexpr int32_t kCalibrationMinimumMotionLimitCounts = 50;

uint8_t channelIndex(ScaleId scale) { return scale == ScaleId::Upper ? 0 : 1; }

bool confirmedCadence(double rateHz) {
  return (rateHz >= 8.0 && rateHz <= 12.0) || (rateHz >= 78.0 && rateHz <= 82.0);
}

bool cadenceClassMismatch(double upperHz, double lowerHz) {
  const bool upperFast = upperHz >= 78.0 && upperHz <= 82.0;
  const bool lowerFast = lowerHz >= 78.0 && lowerHz <= 82.0;
  return confirmedCadence(upperHz) && confirmedCadence(lowerHz) && upperFast != lowerFast;
}
}  // namespace

DualScaleReader::DualScaleReader(uint8_t upperDout, uint8_t upperClock, uint8_t lowerDout, uint8_t lowerClock)
    : upper_(ScaleId::Upper, upperDout, upperClock), lower_(ScaleId::Lower, lowerDout, lowerClock) {}

bool DualScaleReader::begin(float upperFactor, bool upperCalibrated, float lowerFactor, bool lowerCalibrated) {
  sensorCommands_ = xQueueCreate(kSensorCommandQueueLength, sizeof(AppCommand));
  sensorResults_ = xQueueCreate(kSensorResultQueueLength, sizeof(SensorCommandResult));
  if (sensorCommands_ == nullptr || sensorResults_ == nullptr) return false;

  measurement::DualScaleCalibration calibration{};
  calibration.countsPerGram[0] = upperFactor;
  calibration.countsPerGram[1] = lowerFactor;
  calibration.channelCalibrated[0] = upperCalibrated && measurement::MeasurementPipeline::validScaleFactor(upperFactor);
  calibration.channelCalibrated[1] = lowerCalibrated && measurement::MeasurementPipeline::validScaleFactor(lowerFactor);
  pipeline_.setCalibration(calibration);
  upper_.begin();
  lower_.begin();
  return xTaskCreatePinnedToCore(taskEntry, "dual-scale", 6144, this, 3, &task_, 1) == pdPASS;
}

bool DualScaleReader::submit(const AppCommand &command) {
  return sensorCommands_ != nullptr && xQueueSend(sensorCommands_, &command, 0) == pdTRUE;
}

bool DualScaleReader::takeResult(SensorCommandResult &result) {
  return sensorResults_ != nullptr && xQueueReceive(sensorResults_, &result, 0) == pdTRUE;
}

measurement::MeasurementSnapshot DualScaleReader::snapshot(uint32_t nowMs) const {
  measurement::MeasurementSnapshot copy{};
  portENTER_CRITICAL(&snapshotMux_);
  copy = latest_;
  portEXIT_CRITICAL(&snapshotMux_);
  const uint64_t nowUs = static_cast<uint64_t>(nowMs) * 1000;
  measurement::ChannelHealth *health[2] = {&copy.upperHealth, &copy.lowerHealth};
  for (uint8_t channel = 0; channel < 2; ++channel) {
    const uint64_t lastSampleUs = channel == 0 ? copy.upperLastSampleUs : copy.lowerLastSampleUs;
    const double measuredRate = channel == 0 ? copy.upperSampleRateHz : copy.lowerSampleRateHz;
    const double rate = measuredRate > 0.0 ? measuredRate : measurement::config::kNominalSampleRateHz;
    const uint32_t cadenceStaleMs = static_cast<uint32_t>(std::ceil(3000.0 / rate));
    const uint32_t staleMs = std::max(measurement::config::kStaleMinimumMs, cadenceStaleMs);
    const uint32_t disconnectedMs = std::max(measurement::config::kDisconnectedMinimumMs, staleMs * 4);
    // Pipeline availability is pair-local: a valid one-sided sample marks its
    // peer unavailable. Public health instead follows each channel's last
    // successful sample so normal pair skew does not look like a disconnect.
    measurement::applyChannelFreshness(*health[channel], lastSampleUs, nowUs, staleMs, disconnectedMs);
  }
  if (copy.upperHealth.stale || copy.lowerHealth.stale) {
    copy.state = measurement::MeasurementState::DisturbedOrUncertain;
    copy.isStable = false;
    copy.confidence = std::min(copy.confidence, static_cast<double>(measurement::config::kPartialConfidenceCap));
  }
  if (!copy.upperHealth.ready || !copy.lowerHealth.ready) {
    copy.pairStatus = measurement::PairStatus::Unavailable;
    copy.pairValid = false;
  }
  return copy;
}

void DualScaleReader::taskEntry(void *context) { static_cast<DualScaleReader *>(context)->taskLoop(); }

void DualScaleReader::taskLoop() {
  // Hold both clocks high long enough to power down, then release them within a
  // few microseconds so their next conversions start in phase.
  upper_.powerDown();
  lower_.powerDown();
  delayMicroseconds(100);
  upper_.powerUp();
  lower_.powerUp();
  pairAssembler_.reset();

  // Discard one complete startup pair after the synchronized restart.
  const uint64_t startupDeadlineUs = esp_timer_get_time() + measurement::config::kDisconnectedMinimumMs * 1000ULL;
  while (!(upper_.isReady() && lower_.isReady()) && esp_timer_get_time() < startupDeadlineUs) {
    processSensorCommands();
    vTaskDelay(pdMS_TO_TICKS(1));
  }
  if (upper_.isReady() && lower_.isReady()) {
    upper_.readRaw();
    lower_.readRaw();
  } else {
    Serial.println("HX711 startup pair incomplete; continuing with partial-channel health reporting");
  }

  for (;;) {
    processSensorCommands();
    const bool upperReady = upper_.isReady();
    const bool lowerReady = lower_.isReady();
    measurement::RawSamplePair pair{};
    const uint32_t toleranceUs = measurement::SamplePairAssembler::toleranceForRates(
        observedChannelRateHz_[0], observedChannelRateHz_[1]);
    if (upperReady) {
      const uint64_t timestampUs = esp_timer_get_time();
      const int32_t raw = upper_.readRaw();
      recordChannelSample(0, timestampUs);
      if (pairAssembler_.push(0, {raw, timestampUs}, toleranceUs, pair)) processPair(pair);
    }
    if (lowerReady) {
      const uint64_t timestampUs = esp_timer_get_time();
      const int32_t raw = lower_.readRaw();
      recordChannelSample(1, timestampUs);
      if (pairAssembler_.push(1, {raw, timestampUs}, toleranceUs, pair)) processPair(pair);
    }
    if (pairAssembler_.flushExpired(esp_timer_get_time(), toleranceUs, pair)) processPair(pair);
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

void DualScaleReader::processSensorCommands() {
  AppCommand command{};
  while (xQueueReceive(sensorCommands_, &command, 0) == pdTRUE) {
    const uint8_t channel = channelIndex(command.scale);
    if (command.type == CommandType::Tare) {
      if (tarePending_[channel] || calibrationCapture_[channel].active) {
        sendResult(command, SensorResultType::Tare, false, 0.0f, "Scale is busy");
      } else {
        pendingTare_[channel] = command;
        tarePending_[channel] = true;
      }
    } else if (command.type == CommandType::Calibrate) {
      if (calibrationCapture_[channel].active || tarePending_[channel] || !std::isfinite(command.knownGrams) ||
          command.knownGrams <= 0.0f || lastChannelUs_[channel] == 0) {
        sendResult(command, SensorResultType::Calibration, false, 0.0f, "Scale is unavailable or busy");
      } else {
        auto &capture = calibrationCapture_[channel];
        capture = {};
        capture.active = true;
        capture.startedUs = esp_timer_get_time();
        capture.knownGrams = command.knownGrams;
        capture.command = command;
      }
    }
  }
}

void DualScaleReader::processPair(measurement::RawSamplePair pair) {
  pair.sequence = ++sequence_;
  if (pair.upperValid && pair.lowerValid) {
    if (lastPairUs_ != 0 && pair.pairTimestampUs > lastPairUs_) {
      const double instantRate = 1000000.0 / static_cast<double>(pair.pairTimestampUs - lastPairUs_);
      if (!observedRateInitialized_) {
        observedRateHz_ = instantRate;
        observedRateInitialized_ = true;
      } else {
        observedRateHz_ += 0.05 * (instantRate - observedRateHz_);
      }
    }
    lastPairUs_ = pair.pairTimestampUs;
  } else {
    ++droppedSamples_;
    ++partialSamples_;
  }
  if (!pipeline_.process(pair, observedRateHz_, droppedSamples_)) return;
  const auto snapshot = pipeline_.snapshot();
  processTares(snapshot);
  if (pair.upperValid) processCalibration(0, snapshot.upperMedianRaw, pair.upperReadTimestampUs);
  if (pair.lowerValid) processCalibration(1, snapshot.lowerMedianRaw, pair.lowerReadTimestampUs);
  publishSnapshot(pipeline_.snapshot());
}

void DualScaleReader::recordChannelSample(uint8_t channel, uint64_t timestampUs) {
  if (channel > 1) return;
  if (lastChannelUs_[channel] != 0 && timestampUs > lastChannelUs_[channel]) {
    const double instantRate = 1000000.0 / static_cast<double>(timestampUs - lastChannelUs_[channel]);
    if (!observedChannelRateInitialized_[channel]) {
      observedChannelRateHz_[channel] = instantRate;
      observedChannelRateInitialized_[channel] = true;
    } else {
      observedChannelRateHz_[channel] += 0.1 * (instantRate - observedChannelRateHz_[channel]);
    }
  }
  lastChannelUs_[channel] = timestampUs;
}

void DualScaleReader::processTares(const measurement::MeasurementSnapshot &snapshot) {
  for (uint8_t channel = 0; channel < 2; ++channel) {
    const bool valid = channel == 0 ? snapshot.upperHealth.available && !snapshot.upperHealth.saturated
                                    : snapshot.lowerHealth.available && !snapshot.lowerHealth.saturated;
    if (!tarePending_[channel] || !valid) continue;
    const int32_t median = channel == 0 ? snapshot.upperMedianRaw : snapshot.lowerMedianRaw;
    pipeline_.resetAfterTare(channel, median);
    sendResult(pendingTare_[channel], SensorResultType::Tare, true, 0.0f, "Scale tared");
    tarePending_[channel] = false;
  }
}

void DualScaleReader::processCalibration(uint8_t channel, int32_t medianRaw, uint64_t timestampUs) {
  auto &capture = calibrationCapture_[channel];
  if (!capture.active) return;
  if (capture.count == 0) capture.minimum = capture.maximum = medianRaw;
  capture.minimum = std::min(capture.minimum, medianRaw);
  capture.maximum = std::max(capture.maximum, medianRaw);
  capture.sum += medianRaw;
  ++capture.count;
  if (timestampUs - capture.startedUs < kCalibrationDurationUs) return;

  const auto calibration = pipeline_.calibration();
  const double average = capture.count == 0 ? 0.0 : capture.sum / capture.count;
  const double span = average - calibration.zeroOffsetCounts[channel];
  const double motionLimit = std::max<double>(kCalibrationMinimumMotionLimitCounts,
                                               std::fabs(span) * kCalibrationMaxMotionFraction);
  const double factor = span / capture.knownGrams;
  const bool ok = capture.count >= kCalibrationMinimumSamples &&
                  static_cast<double>(capture.maximum - capture.minimum) <= motionLimit &&
                  measurement::MeasurementPipeline::validScaleFactor(factor);
  finishCalibration(channel, ok, static_cast<float>(factor),
                    ok ? "Calibration complete" : "Calibration rejected: motion, sample count, or invalid factor");
}

void DualScaleReader::finishCalibration(uint8_t channel, bool ok, float factor, const char *message) {
  auto &capture = calibrationCapture_[channel];
  if (ok) {
    auto calibration = pipeline_.calibration();
    calibration.countsPerGram[channel] = factor;
    calibration.channelCalibrated[channel] = true;
    pipeline_.setCalibration(calibration);
    pipeline_.resetAfterTare(channel, static_cast<int32_t>(calibration.zeroOffsetCounts[channel]));
  }
  sendResult(capture.command, SensorResultType::Calibration, ok, factor, message);
  capture = {};
}

void DualScaleReader::sendResult(const AppCommand &command, SensorResultType type, bool ok, float factor,
                                 const char *message) {
  SensorCommandResult result{};
  result.type = type;
  result.scale = command.scale;
  result.clientId = command.clientId;
  strlcpy(result.requestId, command.requestId, sizeof(result.requestId));
  result.ok = ok;
  result.factor = factor;
  result.message = message;
  if (xQueueSend(sensorResults_, &result, 0) != pdTRUE) {
    Serial.println("Sensor result queue full; command completion dropped");
  }
}

void DualScaleReader::publishSnapshot(const measurement::MeasurementSnapshot &snapshot) {
  measurement::MeasurementSnapshot copy = snapshot;
  copy.upperLastSampleUs = lastChannelUs_[0];
  copy.lowerLastSampleUs = lastChannelUs_[1];
  copy.upperSampleRateHz = observedChannelRateHz_[0];
  copy.lowerSampleRateHz = observedChannelRateHz_[1];
  copy.partialSamples = partialSamples_;
  const bool mismatch = cadenceClassMismatch(copy.upperSampleRateHz, copy.lowerSampleRateHz);
  copy.upperHealth.cadenceValid = confirmedCadence(copy.upperSampleRateHz) && !mismatch;
  copy.lowerHealth.cadenceValid = confirmedCadence(copy.lowerSampleRateHz) && !mismatch;
  if (!copy.upperHealth.cadenceValid || !copy.lowerHealth.cadenceValid) {
    copy.pairValid = false;
    copy.state = measurement::MeasurementState::DisturbedOrUncertain;
    copy.isStable = false;
    copy.confidence = 0.0;
  }
  copy.upperHealth.calibrating = calibrationCapture_[0].active;
  copy.lowerHealth.calibrating = calibrationCapture_[1].active;
  portENTER_CRITICAL(&snapshotMux_);
  latest_ = copy;
  portEXIT_CRITICAL(&snapshotMux_);
}
