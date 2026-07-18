#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>

#include "measurement_pipeline.h"

#ifdef PIO_UNIT_TESTING
#include <unity.h>
#endif

using measurement::DualScaleCalibration;
using measurement::MeasurementPipeline;
using measurement::MeasurementState;
using measurement::RawSamplePair;

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

RawSamplePair pair(uint32_t sequence, double upperGrams, double lowerGrams) {
  return {sequence,
          static_cast<uint64_t>(sequence) * 12500,
          static_cast<uint64_t>(sequence) * 12500 - 100,
          static_cast<uint64_t>(sequence) * 12500 + 100,
          200,
          static_cast<int32_t>(std::lround(100000.0 + upperGrams * 100.0)),
          static_cast<int32_t>(std::lround(200000.0 - lowerGrams * 200.0)),
          true,
          true};
}

void testCalibrationAndMedianSpike() {
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  pipeline.process(pair(1, 10.0, 20.0));
  pipeline.process(pair(2, 10.1, 19.9));
  auto spike = pair(3, 500.0, -500.0);
  pipeline.process(spike);
  expectNear(pipeline.snapshot().upperCalibrated, 10.1, 0.02, "positive spike rejected by median-of-3");
  expectNear(pipeline.snapshot().lowerCalibrated, 19.9, 0.02, "negative spike rejected by median-of-3");
}

void testAlphaNormalizationAndReset() {
  expectNear(MeasurementPipeline::normalizedAlpha(0.21, 12500), 0.21, 1e-12, "nominal alpha unchanged");
  expectNear(MeasurementPipeline::normalizedAlpha(0.21, 100000), 1.0 - std::pow(0.79, 8.0), 1e-12,
             "10 Hz alpha keeps time constant");
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  pipeline.process(pair(1, 10.0, 20.0));
  RawSamplePair recovered = pair(30, 50.0, 60.0);
  pipeline.process(recovered);
  expectNear(pipeline.snapshot().selectedAlpha, 1.0, 1e-12, "long gap resets EMA");
}

void testStableAndActive() {
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  for (uint32_t i = 1; i <= 60; ++i) pipeline.process(pair(i, 10.0, 20.0));
  expect(pipeline.snapshot().state == MeasurementState::Stable, "static input reaches STABLE after range window");
  expect(pipeline.snapshot().isStable, "valid static input reports stable confidence");
  for (uint32_t i = 61; i <= 90; ++i) pipeline.process(pair(i, 10.0 + (i - 60) * 0.05, 20.0));
  expect(pipeline.snapshot().state == MeasurementState::Active, "positive total ramp reaches ACTIVE");
  expectNear(pipeline.snapshot().selectedAlpha, MeasurementPipeline::normalizedAlpha(0.21, 12500), 1e-7,
             "ACTIVE candidate immediately selects fast EMA");
}

void testDrawdownConservationAndMatchedDelay() {
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  for (uint32_t i = 1; i <= 55; ++i) pipeline.process(pair(i, 50.0, 50.0));
  for (uint32_t i = 56; i <= 100; ++i) {
    const double transfer = (i - 55) * 0.01;
    pipeline.process(pair(i, 50.0 - transfer, 50.0 + transfer));
  }
  const auto &snapshot = pipeline.snapshot();
  expect(snapshot.state == MeasurementState::Drawdown, "opposed channel ramps reach DRAWDOWN");
  expectNear(snapshot.totalFiltered, 100.0, 0.02, "common EMA conserves exact drawdown total");
  expectNear(snapshot.transferResidualGps, 0.0, 0.02, "balanced drawdown residual remains near zero");
}

void testFaultsAndPartialConfidence() {
  MeasurementPipeline pipeline;
  pipeline.setCalibration(calibration());
  pipeline.process(pair(1, 10.0, 20.0));
  RawSamplePair partial = pair(2, 10.0, 20.0);
  partial.lowerValid = false;
  pipeline.process(partial);
  expect(pipeline.snapshot().state == MeasurementState::DisturbedOrUncertain, "partial pair immediately disturbed");
  expect(pipeline.snapshot().confidence <= 0.300001, "partial confidence is capped");
  expect(!pipeline.snapshot().isStable, "partial pair cannot be stable");

  DualScaleCalibration invalid = calibration();
  invalid.channelCalibrated[1] = false;
  pipeline.reset();
  pipeline.setCalibration(invalid);
  pipeline.process(pair(1, 10.0, 20.0));
  expect(pipeline.snapshot().confidence == 0.0, "uncalibrated dual output has zero confidence");

  expect(!MeasurementPipeline::configureCrossTalk(invalid, 1.0, 2.0, 2.0, 4.0), "singular matrix rejected");
  expect(MeasurementPipeline::configureCrossTalk(invalid, 1.0, 0.05, 0.03, 1.0), "finite matrix accepted");
}
}  // namespace

#ifdef PIO_UNIT_TESTING
void runCalibrationAndMedianSpike() { failures = 0; testCalibrationAndMedianSpike(); TEST_ASSERT_EQUAL_INT(0, failures); }
void runAlphaNormalizationAndReset() { failures = 0; testAlphaNormalizationAndReset(); TEST_ASSERT_EQUAL_INT(0, failures); }
void runStableAndActive() { failures = 0; testStableAndActive(); TEST_ASSERT_EQUAL_INT(0, failures); }
void runDrawdownConservationAndMatchedDelay() { failures = 0; testDrawdownConservationAndMatchedDelay(); TEST_ASSERT_EQUAL_INT(0, failures); }
void runFaultsAndPartialConfidence() { failures = 0; testFaultsAndPartialConfidence(); TEST_ASSERT_EQUAL_INT(0, failures); }

int main() {
  UNITY_BEGIN();
  RUN_TEST(runCalibrationAndMedianSpike);
  RUN_TEST(runAlphaNormalizationAndReset);
  RUN_TEST(runStableAndActive);
  RUN_TEST(runDrawdownConservationAndMatchedDelay);
  RUN_TEST(runFaultsAndPartialConfidence);
  return UNITY_END();
}
#else
int main() {
  testCalibrationAndMedianSpike();
  testAlphaNormalizationAndReset();
  testStableAndActive();
  testDrawdownConservationAndMatchedDelay();
  testFaultsAndPartialConfidence();
  if (failures != 0) return EXIT_FAILURE;
  std::cout << "measurement tests passed\n";
  return EXIT_SUCCESS;
}
#endif
