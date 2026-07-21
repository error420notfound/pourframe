#include <cmath>
#include <cstdlib>
#include <iostream>
#include <vector>

#include "measurement_pipeline.h"
#include "sample_pair_assembler.h"
#include "led_controller.h"

#ifdef PIO_UNIT_TESTING
#include <unity.h>
#endif

using measurement::ChannelHealth;
using measurement::DualScaleCalibration;
using measurement::MeasurementPipeline;
using measurement::MeasurementState;
using measurement::RawSamplePair;
using measurement::SamplePairAssembler;

namespace {
int failures = 0;

void expect(bool condition, const char *message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
    ++failures;
  }
}

void expectNear(double actual, double expected, double tolerance, const char *message) {
  if (!std::isfinite(actual) || std::fabs(actual - expected) > tolerance) {
    std::cerr << "FAIL: " << message << " actual=" << actual << " expected=" << expected << '\n';
    ++failures;
  }
}

DualScaleCalibration calibration() {
  DualScaleCalibration value{};
  value.zeroOffsetCounts[0] = 100000.0;
  value.zeroOffsetCounts[1] = 200000.0;
  value.countsPerGram[0] = 100.0;
  value.countsPerGram[1] = -200.0;
  value.channelCalibrated[0] = true;
  value.channelCalibrated[1] = true;
  return value;
}

RawSamplePair pairAt(uint32_t sequence, uint64_t timestampUs, double upperGrams, double lowerGrams) {
  RawSamplePair sample{};
  sample.sequence = sequence;
  sample.pairTimestampUs = timestampUs;
  sample.upperReadTimestampUs = timestampUs - 100;
  sample.lowerReadTimestampUs = timestampUs + 100;
  sample.pairSkewUs = 200;
  sample.pairToleranceUs = 60000;
  sample.upperRaw = static_cast<int32_t>(std::lround(100000.0 + upperGrams * 100.0));
  sample.lowerRaw = static_cast<int32_t>(std::lround(200000.0 - lowerGrams * 200.0));
  sample.upperValid = true;
  sample.lowerValid = true;
  return sample;
}

RawSamplePair pair(uint32_t sequence, double upperGrams, double lowerGrams) {
  return pairAt(sequence, static_cast<uint64_t>(sequence) * 100000, upperGrams, lowerGrams);
}

void testCalibrationMedianAndTimeAwareAlpha() {
  expectNear(MeasurementPipeline::alphaForTau(0.25, 100000), 1.0 - std::exp(-0.4), 1e-12,
             "10 Hz alpha uses 0.25 second tau");
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  pipeline.process(pair(1, 10.0, 20.0), 10.0);
  pipeline.process(pair(2, 10.1, 19.9), 10.0);
  pipeline.process(pair(3, 500.0, -500.0), 10.0);
  expectNear(pipeline.snapshot().upperCalibrated, 10.1, 0.02, "positive spike rejected by median-of-3");
  expectNear(pipeline.snapshot().lowerCalibrated, 19.9, 0.02, "negative spike rejected by median-of-3");
  expectNear(pipeline.snapshot().upperAlpha, 1.0 - std::exp(-0.4), 1e-12, "channel alpha uses genuine sample dt");
}

double emaForDuration(uint64_t intervalUs, uint64_t durationUs) {
  double filtered = 0.0;
  for (uint64_t elapsed = intervalUs; elapsed <= durationUs; elapsed += intervalUs) {
    const double alpha = MeasurementPipeline::alphaForTau(0.25, intervalUs);
    filtered += alpha * (1.0 - filtered);
  }
  return filtered;
}

void testEmaIntervalEquivalence() {
  expectNear(emaForDuration(50000, 1000000), emaForDuration(100000, 1000000), 1e-12,
             "EMA response is equivalent across sample intervals");
}

void testHeldPeerAndPairValidity() {
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  pipeline.process(pair(1, 10.0, 20.0), 10.0);
  const auto before = pipeline.snapshot();
  RawSamplePair partial = pair(2, 30.0, 999.0);
  partial.lowerValid = false;
  partial.lowerRaw = 0;
  partial.lowerReadTimestampUs = 0;
  pipeline.process(partial, 10.0, 1);
  const auto &after = pipeline.snapshot();
  expect(after.upperUpdated && !after.lowerUpdated, "partial cycle identifies only the updated channel");
  expectNear(after.lowerFiltered, before.lowerFiltered, 0.0, "held peer does not update its EMA");
  expectNear(after.lowerAlpha, 0.0, 0.0, "held peer alpha is zero");
  expect(after.lowerLastSampleUs == before.lowerLastSampleUs, "held peer timestamp is preserved");
  expect(!after.pairValid, "partial sample is not a synchronized pair");
  expect(after.pairStatus == measurement::PairStatus::RetainedPeer, "partial sample reports retained peer");
  expect(after.confidence <= measurement::config::kPartialConfidenceCap, "partial confidence is capped");
}

void testPairAssemblerAndCadenceTolerance() {
  expect(SamplePairAssembler::toleranceForRates(10.0, 10.0) == 60000, "10 Hz pairing tolerance is 60 ms");
  expect(SamplePairAssembler::toleranceForRates(80.0, 80.0) == 7500, "80 Hz pairing tolerance is 7.5 ms");
  SamplePairAssembler assembler;
  RawSamplePair output{};
  expect(!assembler.push(0, {101000, 100000}, 60000, output), "first channel waits in bounded assembler");
  expect(assembler.push(1, {198000, 148000}, 60000, output), "peer inside tolerance completes pair");
  expect(output.upperValid && output.lowerValid && output.pairSkewUs == 48000, "pair preserves sample skew");

  expect(!assembler.push(0, {102000, 300000}, 60000, output), "new unmatched sample is pending");
  expect(assembler.flushExpired(360000, 60000, output), "pending sample flushes at tolerance bound");
  expect(output.upperValid && !output.lowerValid, "expired pending sample remains partial");
}

void testTargetedResetAndLongGap() {
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  pipeline.process(pair(1, 10.0, 20.0), 10.0);
  pipeline.process(pair(2, 20.0, 30.0), 10.0);
  const double lowerBeforeTare = pipeline.snapshot().lowerFiltered;
  pipeline.resetAfterTare(0, pipeline.snapshot().upperMedianRaw);
  pipeline.process(pair(3, 0.0, 30.0), 10.0);
  expectNear(pipeline.snapshot().upperAlpha, 1.0, 0.0, "tared channel filter reinitializes");
  expect(pipeline.snapshot().lowerAlpha < 1.0, "untared peer keeps its EMA history");
  expect(pipeline.snapshot().lowerFiltered != lowerBeforeTare, "untared peer continues filtering");

  RawSamplePair recovered = pairAt(4, 700000, 50.0, 30.0);
  recovered.lowerValid = false;
  recovered.lowerReadTimestampUs = 0;
  pipeline.process(recovered, 10.0, 1);
  expectNear(pipeline.snapshot().upperAlpha, 1.0, 0.0, "long channel gap reinitializes EMA");
  expectNear(pipeline.snapshot().upperCalibrated, 30.0, 0.01, "long gap clears stale median history");
  expectNear(pipeline.snapshot().upperFiltered, pipeline.snapshot().upperCalibrated, 0.0,
             "long gap starts from fresh calibrated value");
}

void testPublicationLimiterAndNoAveraging() {
  measurement::PublicationLimiter limiter(100);
  std::vector<uint32_t> publications;
  for (uint32_t now = 0; now <= 1000; ++now) {
    if (limiter.due(now)) publications.push_back(now);
  }
  expect(publications.size() == 10, "100 ms limiter publishes ten times per second");
  for (size_t index = 1; index < publications.size(); ++index) {
    expect(publications[index] - publications[index - 1] == 100, "publication spacing remains 100 ms");
  }

  MeasurementPipeline fullRate;
  MeasurementPipeline publishedRate;
  fullRate.setCalibration(calibration());
  publishedRate.setCalibration(calibration());
  double latestPublished = 0.0;
  measurement::PublicationLimiter selectionLimiter(100);
  for (uint32_t index = 1; index <= 20; ++index) {
    const auto sample = pair(index, static_cast<double>(index), 20.0);
    fullRate.process(sample, 10.0);
    publishedRate.process(sample, 10.0);
    if (selectionLimiter.due(index * 100)) latestPublished = publishedRate.snapshot().upperFiltered;
  }
  expectNear(fullRate.snapshot().upperFiltered, publishedRate.snapshot().upperFiltered, 0.0,
             "publication limiting does not alter filter calculations");
  expectNear(latestPublished, publishedRate.snapshot().upperFiltered, 0.0,
             "publication selects latest snapshot rather than a block average");
}

void testLedCueStateMachine() {
  led::Controller controller;
  led::Color normal{0, 255, 0, 255, false};
  expect(controller.startCue("brew:bloom:0", 5, 1000, 100, led::Health::Healthy) == led::CommandResult::Accepted,
         "healthy five-pulse cue is accepted");
  expect(controller.startCue("brew:bloom:0", 5, 1000, 100, led::Health::Healthy) == led::CommandResult::Duplicate,
         "duplicate cue id is ignored");
  for (uint8_t pulse = 0; pulse < 5; ++pulse) {
    const auto start = controller.update(100 + pulse * 1000, led::Health::Healthy, normal);
    const auto peak = controller.update(600 + pulse * 1000, led::Health::Healthy, normal);
    expect(start.cue && start.red == 255 && start.green == 255 && start.blue == 255 && start.brightness == 0,
           "each neutral-white pulse begins dark");
    expect(peak.cue && peak.brightness == 255, "each pulse rises smoothly to full envelope brightness");
  }
  const auto restored = controller.update(5100, led::Health::Healthy, normal);
  expect(!restored.cue && restored.green == 255 && controller.cueStatus().pulsesCompleted == 5,
         "fifth pulse ends at transition and normal target output is restored");
  expect(controller.cueStatus().state == led::CueState::Completed, "cue lifecycle reports completion");

  expect(controller.startCue("brew:pour-1:0", 5, 1000, 6000, led::Health::Healthy) == led::CommandResult::Accepted,
         "next unique cue starts");
  const auto degraded = controller.update(6100, led::Health::Degraded, normal);
  expect(!degraded.cue && controller.cueStatus().state == led::CueState::HealthAborted,
         "degraded health aborts white cue and returns target-colored output");
  expect(controller.startCue("bad", 4, 1000, 7000, led::Health::Healthy) == led::CommandResult::Invalid,
         "non-five-pulse cue is rejected");
  expect(controller.startCue("unavailable", 5, 1000, 7000, led::Health::Degraded) == led::CommandResult::Unavailable &&
             controller.cueStatus().state == led::CueState::Unavailable,
         "unhealthy cue reports unavailable without showing white");
  expect(controller.startCue("unavailable", 5, 1000, 7100, led::Health::Healthy) == led::CommandResult::Duplicate,
         "an unavailable cue id remains idempotently handled after health recovers");
}

void testLedStepTargetAndCancellation() {
  led::Controller controller;
  expect(controller.activateStep("brew:bloom", 0.0, 60.0, 60.0) == led::CommandResult::Accepted,
         "step target activation is accepted");
  expect(controller.activateStep("brew:bloom", 0.0, 60.0, 60.0) == led::CommandResult::Duplicate,
         "duplicate step transition is ignored");
  expect(controller.stepTarget().active && controller.stepTarget().stepGrams == 60.0,
         "active step preserves baseline and target");
  controller.clearStep();
  expect(!controller.stepTarget().active, "reset clears transient target without changing scale zero");
  expect(controller.startCue("cancel", 5, 1000, 0, led::Health::Healthy) == led::CommandResult::Accepted,
         "cancellable cue starts");
  expect(controller.cancelCue("cancel") == led::CommandResult::Accepted &&
             controller.cueStatus().state == led::CueState::Cancelled,
         "pause/reset cancellation stops cue");
}

void testStateFreshnessTotalAndNoAutoZero() {
  MeasurementPipeline pipeline;
  const auto originalCalibration = calibration();
  pipeline.setCalibration(originalCalibration);
  for (uint32_t index = 1; index <= 20; ++index) pipeline.process(pair(index, 10.0, 20.0), 10.0);
  expect(pipeline.snapshot().state == MeasurementState::Stable, "filtered synchronized zero-motion input reaches stable");
  expectNear(pipeline.snapshot().totalFiltered,
             pipeline.snapshot().upperFiltered + pipeline.snapshot().lowerFiltered, 1e-12,
             "total is the sum of published channels");
  expectNear(pipeline.calibration().zeroOffsetCounts[0], originalCalibration.zeroOffsetCounts[0], 0.0,
             "ordinary processing never adjusts upper zero");
  expectNear(pipeline.calibration().zeroOffsetCounts[1], originalCalibration.zeroOffsetCounts[1], 0.0,
             "ordinary processing never adjusts lower zero");

  ChannelHealth health{};
  measurement::applyChannelFreshness(health, 1000000, 1100000, 250, 1000);
  expect(health.available && health.ready && !health.stale, "recent retained channel remains ready");
  measurement::applyChannelFreshness(health, 1000000, 1400000, 250, 1000);
  expect(health.available && !health.ready && health.stale && !health.disconnected,
         "stale channel remains available before disconnect");
  measurement::applyChannelFreshness(health, 1000000, 2100000, 250, 1000);
  expect(!health.available && health.disconnected, "disconnect timeout makes channel unavailable");
}

void runAll() {
  testCalibrationMedianAndTimeAwareAlpha();
  testEmaIntervalEquivalence();
  testHeldPeerAndPairValidity();
  testPairAssemblerAndCadenceTolerance();
  testTargetedResetAndLongGap();
  testPublicationLimiterAndNoAveraging();
  testStateFreshnessTotalAndNoAutoZero();
  testLedCueStateMachine();
  testLedStepTargetAndCancellation();
}
}  // namespace

#ifdef PIO_UNIT_TESTING
void runMeasurementTests() {
  failures = 0;
  runAll();
  TEST_ASSERT_EQUAL_INT(0, failures);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(runMeasurementTests);
  return UNITY_END();
}
#else
int main() {
  runAll();
  if (failures != 0) return EXIT_FAILURE;
  std::cout << "measurement tests passed\n";
  return EXIT_SUCCESS;
}
#endif
