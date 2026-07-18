#include <Arduino.h>
#include <HX711.h>
#include <esp_timer.h>

#include <measurement_pipeline.h>

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
QueueHandle_t frames = nullptr;
uint32_t sequence = 0;
uint32_t droppedFrames = 0;
uint64_t lastPairUs = 0;
double observedRateHz = measurement::config::kNominalSampleRateHz;

void loggerTask(void *) {
  Serial.println("timestamp_us,sequence,upper_raw,lower_raw,upper_median,lower_median,upper_calibrated,lower_calibrated,upper_filtered,lower_filtered,total_filtered,upper_slope_g_s,lower_slope_g_s,total_slope_g_s,upper_range_g,lower_range_g,total_range_g,state,candidate_state,alpha,residual_g_s,confidence,sample_rate_hz,pair_skew_us,upper_ready,lower_ready,pair_valid,dropped_samples,dropped_diagnostics");
  DiagnosticFrame frame{};
  char line[768];
  for (;;) {
    if (xQueueReceive(frames, &frame, portMAX_DELAY) != pdTRUE) continue;
    const auto &s = frame.snapshot;
    const int length = snprintf(
        line, sizeof(line),
        "%llu,%lu,%ld,%ld,%ld,%ld,%.8f,%.8f,%.8f,%.8f,%.8f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%s,%s,%.6f,%.6f,%.4f,%.3f,%lu,%u,%u,%u,%lu,%lu\n",
        s.timestampUs, static_cast<unsigned long>(s.sequence), static_cast<long>(s.upperRaw), static_cast<long>(s.lowerRaw),
        static_cast<long>(s.upperMedianRaw), static_cast<long>(s.lowerMedianRaw), s.upperCalibrated, s.lowerCalibrated,
        s.upperFiltered, s.lowerFiltered, s.totalFiltered, s.upperSlopeGps, s.lowerSlopeGps, s.totalSlopeGps,
        s.upperRangeGrams, s.lowerRangeGrams, s.totalRangeGrams, measurement::stateName(s.state),
        measurement::stateName(s.candidateState), s.selectedAlpha, s.transferResidualGps, s.confidence,
        s.observedSampleRateHz, static_cast<unsigned long>(s.pairSkewUs), s.upperHealth.ready, s.lowerHealth.ready,
        s.pairValid, static_cast<unsigned long>(s.droppedSamples), static_cast<unsigned long>(droppedFrames));
    if (length > 0 && length < static_cast<int>(sizeof(line))) Serial.write(reinterpret_cast<const uint8_t *>(line), length);
  }
}

void acquisitionTask(void *) {
  while (!(upper.is_ready() && lower.is_ready())) vTaskDelay(pdMS_TO_TICKS(1));
  upper.read();
  lower.read();
  for (;;) {
    if (!(upper.is_ready() && lower.is_ready())) {
      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }
    measurement::RawSamplePair pair{};
    pair.sequence = ++sequence;
    pair.upperReadTimestampUs = esp_timer_get_time();
    pair.upperRaw = upper.read();
    pair.lowerReadTimestampUs = esp_timer_get_time();
    pair.lowerRaw = lower.read();
    pair.upperValid = pair.lowerValid = true;
    pair.pairTimestampUs = pair.upperReadTimestampUs + (pair.lowerReadTimestampUs - pair.upperReadTimestampUs) / 2;
    pair.pairSkewUs = pair.lowerReadTimestampUs - pair.upperReadTimestampUs;
    if (lastPairUs != 0) {
      const double instantRate = 1000000.0 / (pair.pairTimestampUs - lastPairUs);
      observedRateHz += 0.05 * (instantRate - observedRateHz);
    }
    lastPairUs = pair.pairTimestampUs;
    if (!pipeline.process(pair, observedRateHz)) continue;
    DiagnosticFrame frame{pipeline.snapshot()};
    if (xQueueSend(frames, &frame, 0) != pdTRUE) ++droppedFrames;
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
