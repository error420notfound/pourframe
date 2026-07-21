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

void applyChannelFreshness(ChannelHealth &health, uint64_t lastSampleUs, uint64_t nowUs, uint32_t staleMs,
                           uint32_t disconnectedMs) {
  const bool hasSample = lastSampleUs != 0;
  const uint64_t ageUs = hasSample && nowUs >= lastSampleUs ? nowUs - lastSampleUs : 0;
  health.stale = !hasSample || ageUs >= static_cast<uint64_t>(staleMs) * 1000;
  health.disconnected = !hasSample || ageUs >= static_cast<uint64_t>(disconnectedMs) * 1000;
  health.available = hasSample && !health.disconnected;
  health.ready = health.available && !health.stale;
}

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

double MeasurementPipeline::alphaForTau(double tauSeconds, uint64_t intervalUs) {
  if (!std::isfinite(tauSeconds) || tauSeconds <= 0.0) return 1.0;
  return 1.0 - std::exp(-static_cast<double>(intervalUs) / (tauSeconds * 1000000.0));
}

bool MeasurementPipeline::process(const RawSamplePair &sample, double observedSampleRateHz, uint32_t droppedSamples) {
  if (sample.pairTimestampUs == 0 || (lastTimestampUs_ != 0 && sample.pairTimestampUs <= lastTimestampUs_)) {
    return false;
  }

  lastTimestampUs_ = sample.pairTimestampUs;

  snapshot_.sequence = sample.sequence;
  snapshot_.timestampUs = sample.pairTimestampUs;
  if (sample.upperValid) snapshot_.upperRaw = sample.upperRaw;
  if (sample.lowerValid) snapshot_.lowerRaw = sample.lowerRaw;
  snapshot_.pairSkewUs = sample.pairSkewUs;
  snapshot_.pairToleranceUs = sample.pairToleranceUs;
  snapshot_.observedSampleRateHz = std::isfinite(observedSampleRateHz) ? observedSampleRateHz : 0.0;
  snapshot_.droppedSamples = droppedSamples;
  snapshot_.partialSamples = droppedSamples;
  snapshot_.upperUpdated = false;
  snapshot_.lowerUpdated = false;
  snapshot_.upperInnovation = snapshot_.lowerInnovation = 0.0;
  snapshot_.upperAlpha = snapshot_.lowerAlpha = 0.0;
  snapshot_.upperTauSeconds = snapshot_.lowerTauSeconds = config::kNormalTauSeconds;

  const bool rawValid[2] = {sample.upperValid && adcValid(sample.upperRaw), sample.lowerValid && adcValid(sample.lowerRaw)};
  snapshot_.upperHealth.available = sample.upperValid;
  snapshot_.lowerHealth.available = sample.lowerValid;
  if (sample.upperValid) snapshot_.upperHealth.saturated = !adcValid(sample.upperRaw);
  if (sample.lowerValid) snapshot_.lowerHealth.saturated = !adcValid(sample.lowerRaw);
  snapshot_.upperHealth.calibrated = calibrationValidFor(0);
  snapshot_.lowerHealth.calibrated = calibrationValidFor(1);
  const bool cadenceValid = observedSampleRateHz >= 8.0 && observedSampleRateHz <= 82.0;
  snapshot_.upperHealth.cadenceValid = cadenceValid;
  snapshot_.lowerHealth.cadenceValid = cadenceValid;
  snapshot_.upperHealth.ready = rawValid[0];
  snapshot_.lowerHealth.ready = rawValid[1];

  const uint64_t sampleTimestamps[2] = {sample.upperReadTimestampUs, sample.lowerReadTimestampUs};
  const bool longGap[2] = {
      lastFilterSampleUs_[0] != 0 && sampleTimestamps[0] > lastFilterSampleUs_[0] &&
          sampleTimestamps[0] - lastFilterSampleUs_[0] > config::kFilterResetGapUs,
      lastFilterSampleUs_[1] != 0 && sampleTimestamps[1] > lastFilterSampleUs_[1] &&
          sampleTimestamps[1] - lastFilterSampleUs_[1] > config::kFilterResetGapUs,
  };
  if (rawValid[0]) snapshot_.upperLastSampleUs = sample.upperReadTimestampUs;
  if (rawValid[1]) snapshot_.lowerLastSampleUs = sample.lowerReadTimestampUs;

  if (rawValid[0] && longGap[0]) medians_[0] = {};
  if (rawValid[1] && longGap[1]) medians_[1] = {};
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
  const bool bothRawCalibrated = rawValid[0] && rawValid[1] && calibrationValidFor(0) && calibrationValidFor(1) &&
                                 std::isfinite(calibrated[0]) && std::isfinite(calibrated[1]);
  if (bothRawCalibrated && calibration_.crossTalkEnabled) {
    const double upper = calibration_.inverseMatrix[0][0] * calibrated[0] + calibration_.inverseMatrix[0][1] * calibrated[1];
    const double lower = calibration_.inverseMatrix[1][0] * calibrated[0] + calibration_.inverseMatrix[1][1] * calibrated[1];
    calibrated[0] = upper;
    calibrated[1] = lower;
  }
  snapshot_.upperCalibrated = calibrated[0];
  snapshot_.lowerCalibrated = calibrated[1];
  const bool canUpdate[2] = {
      rawValid[0] && calibrationValidFor(0) && std::isfinite(calibrated[0]) &&
          (!calibration_.crossTalkEnabled || bothRawCalibrated),
      rawValid[1] && calibrationValidFor(1) && std::isfinite(calibrated[1]) &&
          (!calibration_.crossTalkEnabled || bothRawCalibrated),
  };
  double *filtered[2] = {&snapshot_.upperFiltered, &snapshot_.lowerFiltered};
  double *innovations[2] = {&snapshot_.upperInnovation, &snapshot_.lowerInnovation};
  double *alphas[2] = {&snapshot_.upperAlpha, &snapshot_.lowerAlpha};
  bool *updated[2] = {&snapshot_.upperUpdated, &snapshot_.lowerUpdated};
  for (uint8_t channel = 0; channel < 2; ++channel) {
    if (!canUpdate[channel]) continue;
    const uint64_t timestampUs = sampleTimestamps[channel];
    *innovations[channel] = emaInitialized_[channel] ? std::fabs(calibrated[channel] - *filtered[channel]) : 0.0;
    if (!emaInitialized_[channel] || longGap[channel] || timestampUs <= lastFilterSampleUs_[channel]) {
      *filtered[channel] = calibrated[channel];
      *alphas[channel] = 1.0;
      emaInitialized_[channel] = true;
    } else {
      const uint64_t intervalUs = timestampUs - lastFilterSampleUs_[channel];
      *alphas[channel] = alphaForTau(config::kNormalTauSeconds, intervalUs);
      *filtered[channel] += *alphas[channel] * (calibrated[channel] - *filtered[channel]);
    }
    lastFilterSampleUs_[channel] = timestampUs;
    *updated[channel] = true;
  }
  snapshot_.selectedAlpha = std::max(snapshot_.upperAlpha, snapshot_.lowerAlpha);
  snapshot_.totalFiltered = (emaInitialized_[0] ? snapshot_.upperFiltered : 0.0) +
                            (emaInitialized_[1] ? snapshot_.lowerFiltered : 0.0);

  const uint32_t toleranceUs = sample.pairToleranceUs == 0 ? config::kInitialPairToleranceUs : sample.pairToleranceUs;
  snapshot_.pairValid = snapshot_.upperUpdated && snapshot_.lowerUpdated &&
                        sample.pairSkewUs <= toleranceUs && cadenceValid;
  if (snapshot_.pairValid) {
    snapshot_.pairStatus = PairStatus::Synchronized;
  } else if ((snapshot_.upperUpdated && emaInitialized_[1]) || (snapshot_.lowerUpdated && emaInitialized_[0])) {
    snapshot_.pairStatus = PairStatus::RetainedPeer;
  } else {
    snapshot_.pairStatus = PairStatus::Unavailable;
  }

  if (snapshot_.pairValid) {
    HistoryPoint point{};
    point.timestampUs = sample.pairTimestampUs;
    point.upperCalibrated = snapshot_.upperFiltered;
    point.lowerCalibrated = snapshot_.lowerFiltered;
    point.totalCalibrated = snapshot_.totalFiltered;
    appendHistory(point);
    computeWindowStats(sample.pairTimestampUs);
  }
  snapshot_.transferResidualGps = std::fabs(snapshot_.upperSlopeGps + snapshot_.lowerSlopeGps);

  const bool immediateFault = !snapshot_.pairValid;
  const MeasurementState candidate = classifyCandidate(!immediateFault);
  snapshot_.candidateState = candidate;
  updateCommittedState(candidate, sample.pairTimestampUs, immediateFault);

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
  lastFilterSampleUs_[0] = lastFilterSampleUs_[1] = 0;
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
  resetChannelFilter(channel);
}

void MeasurementPipeline::resetChannelFilter(uint8_t channel) {
  if (channel > 1) return;
  emaInitialized_[channel] = false;
  lastFilterSampleUs_[channel] = 0;
  if (channel == 0) {
    snapshot_.upperAlpha = 0.0;
    snapshot_.upperInnovation = 0.0;
  } else {
    snapshot_.lowerAlpha = 0.0;
    snapshot_.lowerInnovation = 0.0;
  }
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

void MeasurementPipeline::updateConfidence(bool completeAndValid) {
  if (!completeAndValid || !snapshot_.pairValid) {
    snapshot_.confidence = 0.0;
    const bool upperUsable = snapshot_.upperHealth.calibrated && snapshot_.upperHealth.ready;
    const bool lowerUsable = snapshot_.lowerHealth.calibrated && snapshot_.lowerHealth.ready;
    const bool oneChannelUpdated = snapshot_.upperUpdated != snapshot_.lowerUpdated;
    if (oneChannelUpdated && (upperUsable || lowerUsable)) {
      snapshot_.confidence = config::kPartialConfidenceCap;
    }
    return;
  }
  double confidence = 1.0;
  const uint32_t toleranceUs = snapshot_.pairToleranceUs == 0 ? config::kInitialPairToleranceUs
                                                               : snapshot_.pairToleranceUs;
  confidence *= 1.0 - 0.25 * clamp01(static_cast<double>(snapshot_.pairSkewUs) / toleranceUs);
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
