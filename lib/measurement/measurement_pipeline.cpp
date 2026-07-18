#include "measurement_pipeline.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace measurement {
namespace {

double clamp01(double value) { return std::max(0.0, std::min(1.0, value)); }

uint64_t dwellFor(MeasurementState state) {
  switch (state) {
    case MeasurementState::Active:
      return config::kActiveDwellUs;
    case MeasurementState::Drawdown:
      return config::kDrawdownDwellUs;
    case MeasurementState::Stable:
      // The complete range window is itself the stability dwell.
      return 0;
    default:
      return config::kDisturbedDwellUs;
  }
}

}  // namespace

MeasurementPipeline::MeasurementPipeline() { reset(); }

void MeasurementPipeline::setCalibration(const DualScaleCalibration &calibration) {
  calibration_ = calibration;
  if (calibration_.crossTalkEnabled) {
    const double determinant = calibration_.measuredFromActual[0][0] * calibration_.measuredFromActual[1][1] -
                               calibration_.measuredFromActual[0][1] * calibration_.measuredFromActual[1][0];
    if (!std::isfinite(determinant) || std::fabs(determinant) < 1e-6) {
      calibration_.crossTalkEnabled = false;
    }
  }
}

const DualScaleCalibration &MeasurementPipeline::calibration() const { return calibration_; }

bool MeasurementPipeline::validScaleFactor(double factor) {
  return std::isfinite(factor) && std::fabs(factor) > config::kMinScaleFactorCountsPerGram;
}

bool MeasurementPipeline::configureCrossTalk(DualScaleCalibration &calibration, double m00, double m01, double m10,
                                              double m11) {
  const double determinant = m00 * m11 - m01 * m10;
  if (!std::isfinite(m00) || !std::isfinite(m01) || !std::isfinite(m10) || !std::isfinite(m11) ||
      !std::isfinite(determinant) || std::fabs(determinant) < 1e-6) {
    calibration.crossTalkEnabled = false;
    return false;
  }
  calibration.measuredFromActual[0][0] = m00;
  calibration.measuredFromActual[0][1] = m01;
  calibration.measuredFromActual[1][0] = m10;
  calibration.measuredFromActual[1][1] = m11;
  calibration.inverseMatrix[0][0] = m11 / determinant;
  calibration.inverseMatrix[0][1] = -m01 / determinant;
  calibration.inverseMatrix[1][0] = -m10 / determinant;
  calibration.inverseMatrix[1][1] = m00 / determinant;
  calibration.crossTalkEnabled = true;
  return true;
}

double MeasurementPipeline::normalizedAlpha(double alpha80, uint64_t intervalUs) {
  if (!std::isfinite(alpha80) || alpha80 <= 0.0) return 0.0;
  if (alpha80 >= 1.0) return 1.0;
  return 1.0 - std::pow(1.0 - alpha80, static_cast<double>(intervalUs) / config::kNominalPeriodUs);
}

bool MeasurementPipeline::process(const RawSamplePair &sample, double observedSampleRateHz, uint32_t droppedSamples) {
  if (sample.pairTimestampUs == 0 || (lastTimestampUs_ != 0 && sample.pairTimestampUs <= lastTimestampUs_)) {
    return false;
  }

  const uint64_t intervalUs = lastTimestampUs_ == 0 ? config::kNominalPeriodUs : sample.pairTimestampUs - lastTimestampUs_;
  const bool longGap = lastTimestampUs_ != 0 && intervalUs > config::kFilterResetGapUs;
  lastTimestampUs_ = sample.pairTimestampUs;

  snapshot_.sequence = sample.sequence;
  snapshot_.timestampUs = sample.pairTimestampUs;
  snapshot_.upperRaw = sample.upperRaw;
  snapshot_.lowerRaw = sample.lowerRaw;
  snapshot_.pairSkewUs = sample.pairSkewUs;
  snapshot_.observedSampleRateHz = std::isfinite(observedSampleRateHz) ? observedSampleRateHz : 0.0;
  snapshot_.droppedSamples = droppedSamples;

  const bool rawValid[2] = {sample.upperValid && adcValid(sample.upperRaw), sample.lowerValid && adcValid(sample.lowerRaw)};
  snapshot_.upperHealth.available = sample.upperValid;
  snapshot_.lowerHealth.available = sample.lowerValid;
  snapshot_.upperHealth.saturated = sample.upperValid && !adcValid(sample.upperRaw);
  snapshot_.lowerHealth.saturated = sample.lowerValid && !adcValid(sample.lowerRaw);
  snapshot_.upperHealth.calibrated = calibrationValidFor(0);
  snapshot_.lowerHealth.calibrated = calibrationValidFor(1);
  const bool cadenceValid = observedSampleRateHz >= 8.0 && observedSampleRateHz <= 82.0;
  snapshot_.upperHealth.cadenceValid = cadenceValid;
  snapshot_.lowerHealth.cadenceValid = cadenceValid;
  snapshot_.upperHealth.ready = rawValid[0];
  snapshot_.lowerHealth.ready = rawValid[1];

  if (rawValid[0]) snapshot_.upperMedianRaw = updateMedian(medians_[0], sample.upperRaw);
  if (rawValid[1]) snapshot_.lowerMedianRaw = updateMedian(medians_[1], sample.lowerRaw);

  double calibrated[2] = {snapshot_.upperCalibrated, snapshot_.lowerCalibrated};
  if (rawValid[0] && calibrationValidFor(0)) {
    calibrated[0] = (static_cast<double>(snapshot_.upperMedianRaw) - calibration_.zeroOffsetCounts[0]) /
                    calibration_.countsPerGram[0];
  }
  if (rawValid[1] && calibrationValidFor(1)) {
    calibrated[1] = (static_cast<double>(snapshot_.lowerMedianRaw) - calibration_.zeroOffsetCounts[1]) /
                    calibration_.countsPerGram[1];
  }
  const bool bothCalibratedValid = rawValid[0] && rawValid[1] && calibrationValidFor(0) && calibrationValidFor(1) &&
                                   std::isfinite(calibrated[0]) && std::isfinite(calibrated[1]);
  if (bothCalibratedValid && calibration_.crossTalkEnabled) {
    const double upper = calibration_.inverseMatrix[0][0] * calibrated[0] + calibration_.inverseMatrix[0][1] * calibrated[1];
    const double lower = calibration_.inverseMatrix[1][0] * calibrated[0] + calibration_.inverseMatrix[1][1] * calibrated[1];
    calibrated[0] = upper;
    calibrated[1] = lower;
  }
  snapshot_.upperCalibrated = calibrated[0];
  snapshot_.lowerCalibrated = calibrated[1];
  snapshot_.pairValid = bothCalibratedValid && sample.pairSkewUs <= config::kPairSkewWarningUs && cadenceValid;

  if (bothCalibratedValid) {
    HistoryPoint point{};
    point.timestampUs = sample.pairTimestampUs;
    point.upperCalibrated = calibrated[0];
    point.lowerCalibrated = calibrated[1];
    point.totalCalibrated = calibrated[0] + calibrated[1];
    appendHistory(point);
    computeWindowStats(sample.pairTimestampUs);
  } else {
    snapshot_.upperSlopeGps = snapshot_.lowerSlopeGps = snapshot_.totalSlopeGps = 0.0;
    snapshot_.upperRangeGrams = snapshot_.lowerRangeGrams = snapshot_.totalRangeGrams = 0.0;
  }
  snapshot_.transferResidualGps = std::fabs(snapshot_.upperSlopeGps + snapshot_.lowerSlopeGps);

  const bool immediateFault = !bothCalibratedValid || !cadenceValid || sample.pairSkewUs > config::kPairSkewWarningUs;
  const MeasurementState candidate = classifyCandidate(!immediateFault);
  snapshot_.candidateState = candidate;
  updateCommittedState(candidate, sample.pairTimestampUs, immediateFault);

  const double alpha80 = alphaFor(candidate);
  snapshot_.selectedAlpha = longGap ? 1.0 : normalizedAlpha(alpha80, intervalUs);
  double *filtered[2] = {&snapshot_.upperFiltered, &snapshot_.lowerFiltered};
  for (uint8_t channel = 0; channel < 2; ++channel) {
    if (!rawValid[channel] || !calibrationValidFor(channel) || !std::isfinite(calibrated[channel])) continue;
    if (!emaInitialized_[channel] || longGap) {
      *filtered[channel] = calibrated[channel];
      emaInitialized_[channel] = true;
    } else {
      *filtered[channel] += snapshot_.selectedAlpha * (calibrated[channel] - *filtered[channel]);
    }
  }
  snapshot_.totalFiltered = (emaInitialized_[0] ? snapshot_.upperFiltered : 0.0) +
                            (emaInitialized_[1] ? snapshot_.lowerFiltered : 0.0);
  updateConfidence(!immediateFault);
  snapshot_.isStable = snapshot_.state == MeasurementState::Stable && snapshot_.pairValid &&
                       snapshot_.confidence >= config::kStableConfidenceThreshold;
  return true;
}

const MeasurementSnapshot &MeasurementPipeline::snapshot() const { return snapshot_; }

void MeasurementPipeline::reset() {
  snapshot_ = {};
  snapshot_.state = MeasurementState::DisturbedOrUncertain;
  snapshot_.candidateState = MeasurementState::DisturbedOrUncertain;
  medians_[0] = {};
  medians_[1] = {};
  historyStart_ = 0;
  historyCount_ = 0;
  lastTimestampUs_ = 0;
  candidateSinceUs_ = 0;
  trackedCandidate_ = MeasurementState::DisturbedOrUncertain;
  emaInitialized_[0] = false;
  emaInitialized_[1] = false;
}

void MeasurementPipeline::resetAfterTare(uint8_t channel, int32_t medianRaw) {
  if (channel > 1) return;
  calibration_.zeroOffsetCounts[channel] = medianRaw;
  historyStart_ = 0;
  historyCount_ = 0;
  candidateSinceUs_ = lastTimestampUs_;
  trackedCandidate_ = MeasurementState::DisturbedOrUncertain;
  snapshot_.state = MeasurementState::DisturbedOrUncertain;
  snapshot_.candidateState = MeasurementState::DisturbedOrUncertain;
  snapshot_.confidence = 0.0;
  snapshot_.isStable = false;
  emaInitialized_[0] = false;
  emaInitialized_[1] = false;
}

int32_t MeasurementPipeline::updateMedian(MedianState &state, int32_t value) {
  state.values[state.index] = value;
  state.index = (state.index + 1) % config::kMedianWindow;
  if (state.count < config::kMedianWindow) ++state.count;
  int32_t sorted[config::kMedianWindow]{};
  for (size_t i = 0; i < state.count; ++i) sorted[i] = state.values[i];
  std::sort(sorted, sorted + state.count);
  return sorted[state.count / 2];
}

void MeasurementPipeline::appendHistory(const HistoryPoint &point) {
  if (historyCount_ < config::kHistoryCapacity) {
    history_[(historyStart_ + historyCount_) % config::kHistoryCapacity] = point;
    ++historyCount_;
  } else {
    history_[historyStart_] = point;
    historyStart_ = (historyStart_ + 1) % config::kHistoryCapacity;
  }
}

void MeasurementPipeline::computeWindowStats(uint64_t nowUs) {
  auto computeSlope = [&](uint8_t field) {
    double sumT = 0.0, sumV = 0.0, sumTT = 0.0, sumTV = 0.0;
    size_t count = 0;
    uint64_t firstTimestamp = 0;
    for (size_t i = 0; i < historyCount_; ++i) {
      const HistoryPoint &point = history_[(historyStart_ + i) % config::kHistoryCapacity];
      if (nowUs - point.timestampUs > config::kSlopeWindowUs) continue;
      if (firstTimestamp == 0) firstTimestamp = point.timestampUs;
      const double t = static_cast<double>(point.timestampUs - firstTimestamp) / 1000000.0;
      const double value = field == 0 ? point.upperCalibrated : field == 1 ? point.lowerCalibrated : point.totalCalibrated;
      sumT += t;
      sumV += value;
      sumTT += t * t;
      sumTV += t * value;
      ++count;
    }
    const double denominator = static_cast<double>(count) * sumTT - sumT * sumT;
    return count >= 3 && std::fabs(denominator) > 1e-12
               ? (static_cast<double>(count) * sumTV - sumT * sumV) / denominator
               : 0.0;
  };
  auto computeRange = [&](uint8_t field) {
    double minimum = std::numeric_limits<double>::infinity();
    double maximum = -std::numeric_limits<double>::infinity();
    for (size_t i = 0; i < historyCount_; ++i) {
      const HistoryPoint &point = history_[(historyStart_ + i) % config::kHistoryCapacity];
      if (nowUs - point.timestampUs > config::kRangeWindowUs) continue;
      const double value = field == 0 ? point.upperCalibrated : field == 1 ? point.lowerCalibrated : point.totalCalibrated;
      minimum = std::min(minimum, value);
      maximum = std::max(maximum, value);
    }
    return std::isfinite(minimum) && std::isfinite(maximum) ? maximum - minimum : 0.0;
  };
  snapshot_.upperSlopeGps = computeSlope(0);
  snapshot_.lowerSlopeGps = computeSlope(1);
  snapshot_.totalSlopeGps = computeSlope(2);
  snapshot_.upperRangeGrams = computeRange(0);
  snapshot_.lowerRangeGrams = computeRange(1);
  snapshot_.totalRangeGrams = computeRange(2);
}

MeasurementState MeasurementPipeline::classifyCandidate(bool completeAndValid) const {
  if (!completeAndValid) return MeasurementState::DisturbedOrUncertain;
  if (std::fabs(snapshot_.totalSlopeGps) > config::kActiveSlopeEnterGps) return MeasurementState::Active;
  if (snapshot_.upperSlopeGps < config::kDrawdownUpperEnterGps &&
      snapshot_.lowerSlopeGps > config::kDrawdownLowerEnterGps &&
      std::fabs(snapshot_.totalSlopeGps) < config::kDrawdownTotalEnterGps) {
    return MeasurementState::Drawdown;
  }
  const bool fullRangeWindow = historyCount_ > 1 &&
      snapshot_.timestampUs - history_[historyStart_].timestampUs >= config::kRangeWindowUs;
  if (fullRangeWindow && snapshot_.upperRangeGrams < config::kStableUpperRangeGrams &&
      snapshot_.lowerRangeGrams < config::kStableLowerRangeGrams &&
      snapshot_.totalRangeGrams < config::kStableTotalRangeGrams &&
      std::fabs(snapshot_.totalSlopeGps) < config::kStableTotalSlopeGps) {
    return MeasurementState::Stable;
  }
  return MeasurementState::DisturbedOrUncertain;
}

void MeasurementPipeline::updateCommittedState(MeasurementState candidate, uint64_t timestampUs, bool immediateFault) {
  if (immediateFault) {
    snapshot_.state = MeasurementState::DisturbedOrUncertain;
    trackedCandidate_ = candidate;
    candidateSinceUs_ = timestampUs;
    return;
  }
  if (candidate != trackedCandidate_) {
    trackedCandidate_ = candidate;
    candidateSinceUs_ = timestampUs;
  }

  if (snapshot_.state == MeasurementState::Active && candidate != MeasurementState::Active &&
      std::fabs(snapshot_.totalSlopeGps) >= config::kActiveSlopeExitGps) return;
  if (snapshot_.state == MeasurementState::Drawdown && candidate != MeasurementState::Drawdown) {
    const bool exitCondition = snapshot_.upperSlopeGps > config::kDrawdownUpperExitGps ||
                               snapshot_.lowerSlopeGps < config::kDrawdownLowerExitGps ||
                               std::fabs(snapshot_.totalSlopeGps) > config::kDrawdownTotalExitGps;
    if (!exitCondition) return;
  }
  if (snapshot_.state == MeasurementState::Stable && candidate == MeasurementState::DisturbedOrUncertain) {
    const bool relaxedExceeded = snapshot_.upperRangeGrams > config::kStableUpperRangeGrams * config::kStableExitMultiplier ||
                                 snapshot_.lowerRangeGrams > config::kStableLowerRangeGrams * config::kStableExitMultiplier ||
                                 snapshot_.totalRangeGrams > config::kStableTotalRangeGrams * config::kStableExitMultiplier ||
                                 std::fabs(snapshot_.totalSlopeGps) > config::kStableExitSlopeGps;
    if (!relaxedExceeded || timestampUs - candidateSinceUs_ < config::kStableExitDwellUs) return;
  }

  const bool promptStableExit = snapshot_.state == MeasurementState::Stable &&
                                (candidate == MeasurementState::Active || candidate == MeasurementState::Drawdown);
  if (promptStableExit || timestampUs - candidateSinceUs_ >= dwellFor(candidate)) snapshot_.state = candidate;
}

double MeasurementPipeline::alphaFor(MeasurementState state) const {
  switch (state) {
    case MeasurementState::Stable:
      return config::kStableAlpha80;
    case MeasurementState::Active:
      return config::kActiveAlpha80;
    case MeasurementState::Drawdown:
      return config::kDrawdownAlpha80;
    default:
      return config::kDisturbedAlpha80;
  }
}

void MeasurementPipeline::updateConfidence(bool completeAndValid) {
  if (!completeAndValid || !snapshot_.pairValid) {
    snapshot_.confidence = 0.0;
    const bool upperUsable = snapshot_.upperHealth.calibrated && snapshot_.upperHealth.ready;
    const bool lowerUsable = snapshot_.lowerHealth.calibrated && snapshot_.lowerHealth.ready;
    const bool missingPeer = (!snapshot_.upperHealth.available || !snapshot_.lowerHealth.available);
    if (missingPeer && upperUsable != lowerUsable) {
      snapshot_.confidence = config::kPartialConfidenceCap;
    }
    return;
  }
  double confidence = 1.0;
  confidence *= 1.0 - 0.25 * clamp01(static_cast<double>(snapshot_.pairSkewUs) / config::kPairSkewWarningUs);
  if (snapshot_.state == MeasurementState::Stable) {
    confidence *= 1.0 - 0.3 * clamp01(std::fabs(snapshot_.totalSlopeGps) / config::kStableTotalSlopeGps);
    confidence *= 1.0 - 0.2 * clamp01(snapshot_.totalRangeGrams / config::kStableTotalRangeGrams);
  } else if (snapshot_.state == MeasurementState::Drawdown) {
    confidence *= 1.0 - 0.5 * clamp01(snapshot_.transferResidualGps / config::kDrawdownTotalEnterGps);
  } else if (snapshot_.state == MeasurementState::DisturbedOrUncertain) {
    confidence = std::min(confidence, static_cast<double>(config::kDisturbedConfidenceCap));
  }
  snapshot_.confidence = clamp01(confidence);
}

bool MeasurementPipeline::calibrationValidFor(uint8_t channel) const {
  return channel < 2 && calibration_.channelCalibrated[channel] && validScaleFactor(calibration_.countsPerGram[channel]);
}

bool MeasurementPipeline::adcValid(int32_t raw) {
  return raw > config::kAdcMinimum + config::kAdcSaturationMargin && raw < config::kAdcMaximum - config::kAdcSaturationMargin;
}

}  // namespace measurement
