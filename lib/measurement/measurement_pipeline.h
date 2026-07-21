#pragma once

#include <cstddef>
#include <cstdint>

#include "measurement_config.h"
#include "measurement_types.h"

namespace measurement {

void applyChannelFreshness(ChannelHealth &health, uint64_t lastSampleUs, uint64_t nowUs, uint32_t staleMs,
                           uint32_t disconnectedMs);

class MeasurementPipeline {
 public:
  MeasurementPipeline();

  void setCalibration(const DualScaleCalibration &calibration);
  const DualScaleCalibration &calibration() const;
  bool process(const RawSamplePair &sample, double observedSampleRateHz = config::kNominalSampleRateHz,
               uint32_t droppedSamples = 0);
  const MeasurementSnapshot &snapshot() const;
  void reset();
  void resetAfterTare(uint8_t channel, int32_t medianRaw);
  void resetChannelFilter(uint8_t channel);

  static bool validScaleFactor(double factor);
  static bool configureCrossTalk(DualScaleCalibration &calibration, double m00, double m01, double m10, double m11);
  static double alphaForTau(double tauSeconds, uint64_t intervalUs);

 private:
  struct MedianState {
    int32_t values[config::kMedianWindow]{};
    size_t count = 0;
    size_t index = 0;
  };

  int32_t updateMedian(MedianState &state, int32_t value);
  void appendHistory(const HistoryPoint &point);
  void computeWindowStats(uint64_t nowUs);
  MeasurementState classifyCandidate(bool completeAndValid) const;
  void updateCommittedState(MeasurementState candidate, uint64_t timestampUs, bool immediateFault);
  void updateConfidence(bool completeAndValid);
  bool calibrationValidFor(uint8_t channel) const;
  static bool adcValid(int32_t raw);

  DualScaleCalibration calibration_{};
  MeasurementSnapshot snapshot_{};
  MedianState medians_[2]{};
  HistoryPoint history_[config::kHistoryCapacity]{};
  size_t historyStart_ = 0;
  size_t historyCount_ = 0;
  uint64_t lastTimestampUs_ = 0;
  uint64_t lastFilterSampleUs_[2]{0, 0};
  uint64_t candidateSinceUs_ = 0;
  MeasurementState trackedCandidate_ = MeasurementState::DisturbedOrUncertain;
  bool emaInitialized_[2]{false, false};
};

}  // namespace measurement
