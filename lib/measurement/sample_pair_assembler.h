#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "measurement_config.h"
#include "measurement_types.h"

namespace measurement {

struct ChannelSample {
  ChannelSample() = default;
  ChannelSample(int32_t rawValue, uint64_t timestampValue) : raw(rawValue), timestampUs(timestampValue) {}

  int32_t raw = 0;
  uint64_t timestampUs = 0;
};

class SamplePairAssembler {
 public:
  void reset() {
    pending_[0] = {};
    pending_[1] = {};
  }

  static uint32_t toleranceForRates(double upperHz, double lowerHz) {
    const bool upperValid = std::isfinite(upperHz) && upperHz > 0.0;
    const bool lowerValid = std::isfinite(lowerHz) && lowerHz > 0.0;
    if (!upperValid || !lowerValid) return config::kInitialPairToleranceUs;
    const double slowerHz = std::min(upperHz, lowerHz);
    const double tolerance = config::kPairTolerancePeriodFraction * 1000000.0 / slowerHz;
    const double bounded = std::max(static_cast<double>(config::kPairToleranceMinimumUs),
                                    std::min(static_cast<double>(config::kPairToleranceMaximumUs), tolerance));
    return static_cast<uint32_t>(bounded);
  }

  bool push(uint8_t channel, const ChannelSample &sample, uint32_t toleranceUs, RawSamplePair &output) {
    if (channel > 1 || sample.timestampUs == 0) return false;
    pending_[channel].sample = sample;
    pending_[channel].valid = true;
    return emitReady(sample.timestampUs, toleranceUs, output);
  }

  bool flushExpired(uint64_t nowUs, uint32_t toleranceUs, RawSamplePair &output) {
    return emitReady(nowUs, toleranceUs, output);
  }

 private:
  struct Pending {
    ChannelSample sample{};
    bool valid = false;
  };

  bool emitReady(uint64_t nowUs, uint32_t toleranceUs, RawSamplePair &output) {
    if (pending_[0].valid && pending_[1].valid) {
      const uint64_t upperUs = pending_[0].sample.timestampUs;
      const uint64_t lowerUs = pending_[1].sample.timestampUs;
      const uint64_t skew = upperUs >= lowerUs ? upperUs - lowerUs : lowerUs - upperUs;
      if (skew <= toleranceUs) {
        output = {};
        output.upperRaw = pending_[0].sample.raw;
        output.lowerRaw = pending_[1].sample.raw;
        output.upperReadTimestampUs = upperUs;
        output.lowerReadTimestampUs = lowerUs;
        output.upperValid = output.lowerValid = true;
        output.pairTimestampUs = std::min(upperUs, lowerUs) + skew / 2;
        output.pairSkewUs = static_cast<uint32_t>(skew);
        output.pairToleranceUs = toleranceUs;
        reset();
        return true;
      }
      return emitPartial(upperUs < lowerUs ? 0 : 1, toleranceUs, output);
    }

    for (uint8_t channel = 0; channel < 2; ++channel) {
      if (pending_[channel].valid && nowUs >= pending_[channel].sample.timestampUs &&
          nowUs - pending_[channel].sample.timestampUs >= toleranceUs) {
        return emitPartial(channel, toleranceUs, output);
      }
    }
    return false;
  }

  bool emitPartial(uint8_t channel, uint32_t toleranceUs, RawSamplePair &output) {
    output = {};
    output.pairTimestampUs = pending_[channel].sample.timestampUs;
    output.pairSkewUs = toleranceUs;
    output.pairToleranceUs = toleranceUs;
    if (channel == 0) {
      output.upperRaw = pending_[0].sample.raw;
      output.upperReadTimestampUs = pending_[0].sample.timestampUs;
      output.upperValid = true;
    } else {
      output.lowerRaw = pending_[1].sample.raw;
      output.lowerReadTimestampUs = pending_[1].sample.timestampUs;
      output.lowerValid = true;
    }
    pending_[channel] = {};
    return true;
  }

  Pending pending_[2]{};
};

class PublicationLimiter {
 public:
  explicit PublicationLimiter(uint32_t intervalMs = config::kPublicationIntervalMs) : intervalMs_(intervalMs) {}

  bool due(uint32_t nowMs) {
    if (!initialized_) {
      initialized_ = true;
      lastPublicationMs_ = nowMs;
      return false;
    }
    if (nowMs - lastPublicationMs_ < intervalMs_) return false;
    lastPublicationMs_ += ((nowMs - lastPublicationMs_) / intervalMs_) * intervalMs_;
    return true;
  }

 private:
  uint32_t intervalMs_;
  uint32_t lastPublicationMs_ = 0;
  bool initialized_ = false;
};

}  // namespace measurement
