#include "scale_channel.h"

#include <algorithm>
#include <cmath>

ScaleChannel::ScaleChannel(ScaleId id, uint8_t doutPin, uint8_t clockPin)
    : id_(id), doutPin_(doutPin), clockPin_(clockPin) {}

void ScaleChannel::begin(float calibrationFactor) {
  startedAtMs_ = millis();
  setScaleFactor(calibrationFactor);
  adc_.begin(doutPin_, clockPin_, 128);
  adc_.set_scale(scaleFactor_);
  adc_.set_offset(tareOffset_);
}

bool ScaleChannel::poll(uint32_t nowMs) {
  if (!adc_.is_ready()) {
    return false;
  }

  latestRaw_ = adc_.read();
  window_[windowIndex_] = latestRaw_;
  windowIndex_ = (windowIndex_ + 1) % kMedianWindow;
  if (windowCount_ < kMedianWindow) {
    ++windowCount_;
  }

  const long median = medianRaw();
  filteredRaw_ = hasSample_ ? filteredRaw_ + kEmaAlpha * (static_cast<float>(median) - filteredRaw_)
                            : static_cast<float>(median);
  hasSample_ = true;
  lastSampleMs_ = nowMs;

  if (calibrating_) {
    consumeCalibrationSample(latestRaw_);
  }
  return true;
}

bool ScaleChannel::tare() {
  if (!hasSample_) {
    return false;
  }
  tareOffset_ = lroundf(filteredRaw_);
  adc_.set_offset(tareOffset_);
  return true;
}

bool ScaleChannel::startCalibration(float knownGrams) {
  if (!hasSample_ || !std::isfinite(knownGrams) || knownGrams <= 0.0f || calibrating_) {
    return false;
  }
  knownCalibrationGrams_ = knownGrams;
  calibrationRawSum_ = 0;
  calibrationSampleCount_ = 0;
  calibrationResultPending_ = false;
  calibrating_ = true;
  return true;
}

bool ScaleChannel::takeCalibrationResult(float &factor, bool &succeeded) {
  if (!calibrationResultPending_) {
    return false;
  }
  calibrationResultPending_ = false;
  factor = scaleFactor_;
  succeeded = calibrationSucceeded_;
  return true;
}

void ScaleChannel::setScaleFactor(float factor) {
  if (std::isfinite(factor) && fabsf(factor) > 0.0001f) {
    scaleFactor_ = factor;
    adc_.set_scale(scaleFactor_);
  }
}

float ScaleChannel::scaleFactor() const { return scaleFactor_; }

ScaleSnapshot ScaleChannel::snapshot(uint32_t nowMs) const {
  const uint32_t referenceMs = hasSample_ ? lastSampleMs_ : startedAtMs_;
  const uint32_t ageMs = nowMs - referenceMs;
  const bool ready = hasSample_ && ageMs < kStaleAfterMs;
  const bool stale = hasSample_ && ageMs >= kStaleAfterMs;
  const bool disconnected = ageMs >= kDisconnectedAfterMs;
  const float grams = hasSample_ ? (filteredRaw_ - static_cast<float>(tareOffset_)) / scaleFactor_ : 0.0f;

  return {
      latestRaw_, grams, tareOffset_, scaleFactor_, hasSample_, ready, stale, disconnected, calibrating_, lastSampleMs_,
  };
}

ScaleId ScaleChannel::id() const { return id_; }

void ScaleChannel::powerDown() { adc_.power_down(); }

void ScaleChannel::powerUp() { adc_.power_up(); }

long ScaleChannel::medianRaw() const {
  long sorted[kMedianWindow];
  for (size_t i = 0; i < windowCount_; ++i) {
    sorted[i] = window_[i];
  }
  std::sort(sorted, sorted + windowCount_);
  return sorted[windowCount_ / 2];
}

void ScaleChannel::consumeCalibrationSample(long raw) {
  calibrationRawSum_ += raw;
  ++calibrationSampleCount_;
  if (calibrationSampleCount_ < kCalibrationSamples) {
    return;
  }

  const float averageRaw = static_cast<float>(calibrationRawSum_) / kCalibrationSamples;
  const float candidate = (averageRaw - static_cast<float>(tareOffset_)) / knownCalibrationGrams_;
  calibrationSucceeded_ = std::isfinite(candidate) && fabsf(candidate) > 0.0001f;
  if (calibrationSucceeded_) {
    setScaleFactor(candidate);
  }
  calibrating_ = false;
  calibrationResultPending_ = true;
}
