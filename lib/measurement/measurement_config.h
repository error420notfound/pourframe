#pragma once

#include <cstddef>
#include <cstdint>

namespace measurement {
namespace config {

constexpr uint32_t kRevision = 1;
constexpr float kNominalSampleRateHz = 80.0f;
constexpr uint64_t kNominalPeriodUs = 12500;
constexpr uint32_t kPublicationIntervalMs = 50;
constexpr size_t kMedianWindow = 3;
constexpr size_t kHistoryCapacity = 96;
constexpr uint64_t kSlopeWindowUs = 320000;
constexpr uint64_t kRangeWindowUs = 625000;
constexpr uint64_t kFilterResetGapUs = 250000;

constexpr float kStableAlpha80 = 0.06f;
constexpr float kDrawdownAlpha80 = 0.11f;
constexpr float kActiveAlpha80 = 0.21f;
constexpr float kDisturbedAlpha80 = 0.06f;

constexpr float kActiveSlopeEnterGps = 0.8f;
constexpr float kActiveSlopeExitGps = 0.5f;
constexpr float kDrawdownUpperEnterGps = -0.2f;
constexpr float kDrawdownLowerEnterGps = 0.2f;
constexpr float kDrawdownTotalEnterGps = 0.3f;
constexpr float kDrawdownUpperExitGps = -0.12f;
constexpr float kDrawdownLowerExitGps = 0.12f;
constexpr float kDrawdownTotalExitGps = 0.45f;
constexpr float kStableUpperRangeGrams = 0.25f;
constexpr float kStableLowerRangeGrams = 0.25f;
constexpr float kStableTotalRangeGrams = 0.30f;
constexpr float kStableTotalSlopeGps = 0.10f;
constexpr float kStableExitMultiplier = 1.5f;
constexpr float kStableExitSlopeGps = 0.20f;
constexpr float kResidualDisturbedGps = 0.8f;

constexpr uint64_t kActiveDwellUs = 100000;
constexpr uint64_t kDrawdownDwellUs = 150000;
constexpr uint64_t kDisturbedDwellUs = 200000;
constexpr uint64_t kStableExitDwellUs = 100000;
constexpr float kStableConfidenceThreshold = 0.8f;

constexpr uint32_t kPairSkewTargetUs = 1000;
constexpr uint32_t kPairSkewWarningUs = 1500;
constexpr uint32_t kPairTimeoutUs = 30000;
constexpr uint32_t kStaleMinimumMs = 250;
constexpr uint32_t kDisconnectedMinimumMs = 1000;
constexpr int32_t kAdcMinimum = -8388608;
constexpr int32_t kAdcMaximum = 8388607;
constexpr int32_t kAdcSaturationMargin = 4096;
constexpr float kMinScaleFactorCountsPerGram = 0.0001f;
constexpr float kPartialConfidenceCap = 0.3f;
constexpr float kDisturbedConfidenceCap = 0.5f;
constexpr size_t kDiagnosticQueueCapacity = 32;

}  // namespace config
}  // namespace measurement
