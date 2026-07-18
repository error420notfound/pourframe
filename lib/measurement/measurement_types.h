#pragma once

#include <cstdint>

namespace measurement {

enum class MeasurementState : uint8_t {
  Stable,
  Active,
  Drawdown,
  DisturbedOrUncertain,
};

struct RawSamplePair {
  uint32_t sequence = 0;
  uint64_t pairTimestampUs = 0;
  uint64_t upperReadTimestampUs = 0;
  uint64_t lowerReadTimestampUs = 0;
  uint32_t pairSkewUs = 0;
  int32_t upperRaw = 0;
  int32_t lowerRaw = 0;
  bool upperValid = false;
  bool lowerValid = false;
};

struct DualScaleCalibration {
  double zeroOffsetCounts[2]{0.0, 0.0};
  double countsPerGram[2]{1.0, 1.0};
  bool channelCalibrated[2]{false, false};
  bool crossTalkEnabled = false;
  double measuredFromActual[2][2]{{1.0, 0.0}, {0.0, 1.0}};
  double inverseMatrix[2][2]{{1.0, 0.0}, {0.0, 1.0}};
};

struct ChannelHealth {
  bool available = false;
  bool ready = false;
  bool stale = false;
  bool disconnected = false;
  bool calibrating = false;
  bool calibrated = false;
  bool saturated = false;
  bool cadenceValid = false;
};

struct HistoryPoint {
  uint64_t timestampUs = 0;
  double upperCalibrated = 0.0;
  double lowerCalibrated = 0.0;
  double totalCalibrated = 0.0;
};

struct MeasurementSnapshot {
  uint32_t sequence = 0;
  uint64_t timestampUs = 0;
  uint64_t upperLastSampleUs = 0;
  uint64_t lowerLastSampleUs = 0;
  int32_t upperRaw = 0;
  int32_t lowerRaw = 0;
  int32_t upperMedianRaw = 0;
  int32_t lowerMedianRaw = 0;
  double upperCalibrated = 0.0;
  double lowerCalibrated = 0.0;
  double upperFiltered = 0.0;
  double lowerFiltered = 0.0;
  double totalFiltered = 0.0;
  double upperSlopeGps = 0.0;
  double lowerSlopeGps = 0.0;
  double totalSlopeGps = 0.0;
  double upperRangeGrams = 0.0;
  double lowerRangeGrams = 0.0;
  double totalRangeGrams = 0.0;
  double transferResidualGps = 0.0;
  MeasurementState state = MeasurementState::DisturbedOrUncertain;
  MeasurementState candidateState = MeasurementState::DisturbedOrUncertain;
  double selectedAlpha = 0.0;
  bool isStable = false;
  double confidence = 0.0;
  ChannelHealth upperHealth{};
  ChannelHealth lowerHealth{};
  bool pairValid = false;
  double observedSampleRateHz = 0.0;
  double upperSampleRateHz = 0.0;
  double lowerSampleRateHz = 0.0;
  uint32_t pairSkewUs = 0;
  uint32_t droppedSamples = 0;
};

inline const char *stateName(MeasurementState state) {
  switch (state) {
    case MeasurementState::Stable:
      return "STABLE";
    case MeasurementState::Active:
      return "ACTIVE";
    case MeasurementState::Drawdown:
      return "DRAWDOWN";
    default:
      return "DISTURBED_OR_UNCERTAIN";
  }
}

}  // namespace measurement
