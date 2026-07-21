#include <Arduino.h>
#include <HX711.h>
#include <esp_timer.h>

#include <measurement_pipeline.h>
#include <sample_pair_assembler.h>

namespace {
constexpr uint8_t kUpperDout = 4;
constexpr uint8_t kUpperClock = 5;
constexpr uint8_t kLowerDout = 6;
constexpr uint8_t kLowerClock = 7;
constexpr uint32_t kSerialBaud = 921600;

struct DiagnosticFrame {
  measurement::MeasurementSnapshot snapshot;
};

HX711 upper;
HX711 lower;
measurement::MeasurementPipeline pipeline;
measurement::SamplePairAssembler pairAssembler;
QueueHandle_t frames = nullptr;
uint32_t sequence = 0;
uint32_t partialSamples = 0;
uint32_t droppedFrames = 0;
uint64_t lastPairUs = 0;
uint64_t lastChannelUs[2]{0, 0};
double observedRateHz = measurement::config::kNominalSampleRateHz;
double observedChannelRateHz[2]{measurement::config::kNominalSampleRateHz,
                                measurement::config::kNominalSampleRateHz};
bool observedChannelRateInitialized[2]{false, false};

void loggerTask(void *) {
  Serial.println("timestamp_us,pipeline_sequence,upper_sample_timestamp_us,lower_sample_timestamp_us,upper_sample_rate_hz,lower_sample_rate_hz,pair_valid,pair_status,pair_skew_us,pair_tolerance_us,partial_samples,upper_raw,lower_raw,upper_median,lower_median,upper_calibrated,lower_calibrated,upper_filtered,lower_filtered,total_filtered,upper_innovation_g,lower_innovation_g,upper_alpha,lower_alpha,upper_tau_s,lower_tau_s,upper_updated,lower_updated,upper_slope_g_s,lower_slope_g_s,total_slope_g_s,upper_range_g,lower_range_g,total_range_g,state,candidate_state,residual_g_s,confidence,sample_rate_hz,dropped_samples,dropped_diagnostics");
  DiagnosticFrame frame{};
  char line[1400];
  for (;;) {
    if (xQueueReceive(frames, &frame, portMAX_DELAY) != pdTRUE) continue;
    const auto &s = frame.snapshot;
    const int length = snprintf(
        line, sizeof(line),
        "%llu,%lu,%llu,%llu,%.3f,%.3f,%u,%s,%lu,%lu,%lu,%ld,%ld,%ld,%ld,%.8f,%.8f,%.8f,%.8f,%.8f,%.8f,%.8f,%.8f,%.8f,%.6f,%.6f,%u,%u,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%s,%s,%.6f,%.4f,%.3f,%lu,%lu\n",
        s.timestampUs, static_cast<unsigned long>(s.sequence), s.upperLastSampleUs, s.lowerLastSampleUs,
        s.upperSampleRateHz, s.lowerSampleRateHz, s.pairValid, measurement::pairStatusName(s.pairStatus),
        static_cast<unsigned long>(s.pairSkewUs), static_cast<unsigned long>(s.pairToleranceUs),
        static_cast<unsigned long>(s.partialSamples), static_cast<long>(s.upperRaw), static_cast<long>(s.lowerRaw),
        static_cast<long>(s.upperMedianRaw), static_cast<long>(s.lowerMedianRaw), s.upperCalibrated, s.lowerCalibrated,
        s.upperFiltered, s.lowerFiltered, s.totalFiltered, s.upperInnovation, s.lowerInnovation, s.upperAlpha,
        s.lowerAlpha, s.upperTauSeconds, s.lowerTauSeconds, s.upperUpdated, s.lowerUpdated, s.upperSlopeGps,
        s.lowerSlopeGps, s.totalSlopeGps, s.upperRangeGrams, s.lowerRangeGrams, s.totalRangeGrams,
        measurement::stateName(s.state), measurement::stateName(s.candidateState), s.transferResidualGps,
        s.confidence, s.observedSampleRateHz, static_cast<unsigned long>(s.droppedSamples),
        static_cast<unsigned long>(droppedFrames));
    if (length > 0 && length < static_cast<int>(sizeof(line))) Serial.write(reinterpret_cast<const uint8_t *>(line), length);
  }
}

void recordChannelSample(uint8_t channel, uint64_t timestampUs) {
  if (lastChannelUs[channel] != 0 && timestampUs > lastChannelUs[channel]) {
    const double instantRate = 1000000.0 / static_cast<double>(timestampUs - lastChannelUs[channel]);
    if (!observedChannelRateInitialized[channel]) {
      observedChannelRateHz[channel] = instantRate;
      observedChannelRateInitialized[channel] = true;
    } else {
      observedChannelRateHz[channel] += 0.1 * (instantRate - observedChannelRateHz[channel]);
    }
  }
  lastChannelUs[channel] = timestampUs;
}

void processDiagnosticPair(measurement::RawSamplePair pair) {
  pair.sequence = ++sequence;
  if (pair.upperValid && pair.lowerValid) {
    if (lastPairUs != 0 && pair.pairTimestampUs > lastPairUs) {
      const double instantRate = 1000000.0 / static_cast<double>(pair.pairTimestampUs - lastPairUs);
      observedRateHz += 0.05 * (instantRate - observedRateHz);
    }
    lastPairUs = pair.pairTimestampUs;
  } else {
    ++partialSamples;
  }
  if (!pipeline.process(pair, observedRateHz, partialSamples)) return;
  DiagnosticFrame frame{pipeline.snapshot()};
  frame.snapshot.upperSampleRateHz = observedChannelRateHz[0];
  frame.snapshot.lowerSampleRateHz = observedChannelRateHz[1];
  frame.snapshot.partialSamples = partialSamples;
  if (xQueueSend(frames, &frame, 0) != pdTRUE) ++droppedFrames;
}

void acquisitionTask(void *) {
  upper.power_down();
  lower.power_down();
  delayMicroseconds(100);
  upper.power_up();
  lower.power_up();
  pairAssembler.reset();
  for (;;) {
    const bool upperReady = upper.is_ready();
    const bool lowerReady = lower.is_ready();
    const uint32_t toleranceUs = measurement::SamplePairAssembler::toleranceForRates(
        observedChannelRateHz[0], observedChannelRateHz[1]);
    measurement::RawSamplePair pair{};
    if (upperReady) {
      const uint64_t timestampUs = esp_timer_get_time();
      const int32_t raw = upper.read();
      recordChannelSample(0, timestampUs);
      if (pairAssembler.push(0, {raw, timestampUs}, toleranceUs, pair)) processDiagnosticPair(pair);
    }
    if (lowerReady) {
      const uint64_t timestampUs = esp_timer_get_time();
      const int32_t raw = lower.read();
      recordChannelSample(1, timestampUs);
      if (pairAssembler.push(1, {raw, timestampUs}, toleranceUs, pair)) processDiagnosticPair(pair);
    }
    if (pairAssembler.flushExpired(esp_timer_get_time(), toleranceUs, pair)) processDiagnosticPair(pair);
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}
}  // namespace

void setup() {
  Serial.begin(kSerialBaud);
  delay(500);
  upper.begin(kUpperDout, kUpperClock, 128);
  lower.begin(kLowerDout, kLowerClock, 128);
  measurement::DualScaleCalibration calibration{};
  calibration.zeroOffsetCounts[0] = POURFRAME_DIAG_UPPER_ZERO;
  calibration.countsPerGram[0] = POURFRAME_DIAG_UPPER_FACTOR;
  calibration.zeroOffsetCounts[1] = POURFRAME_DIAG_LOWER_ZERO;
  calibration.countsPerGram[1] = POURFRAME_DIAG_LOWER_FACTOR;
  calibration.channelCalibrated[0] = POURFRAME_DIAG_CALIBRATED;
  calibration.channelCalibrated[1] = POURFRAME_DIAG_CALIBRATED;
  pipeline.setCalibration(calibration);
  frames = xQueueCreate(measurement::config::kDiagnosticQueueCapacity, sizeof(DiagnosticFrame));
  if (frames == nullptr) while (true) delay(1000);
  xTaskCreatePinnedToCore(loggerTask, "csv-logger", 4096, nullptr, 1, nullptr, 0);
  xTaskCreatePinnedToCore(acquisitionTask, "diag-scale", 6144, nullptr, 3, nullptr, 1);
}

void loop() { delay(1000); }
