#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_system.h>

#include <measurement_config.h>
#include <measurement_types.h>

#include "app_types.h"
#include "dual_scale_reader.h"
#include "network_service.h"
#include "status_led.h"
#include "target_store.h"

namespace {
constexpr uint8_t kUpperDout = 4;
constexpr uint8_t kUpperClock = 5;
constexpr uint8_t kLowerDout = 6;
constexpr uint8_t kLowerClock = 7;
constexpr uint8_t kCommandQueueLength = 8;
constexpr float kDefaultScaleFactor = 1.0f;

DualScaleReader scales(kUpperDout, kUpperClock, kLowerDout, kLowerClock);
NetworkService network;
Preferences scalePreferences;
TargetStore targetStore;
StatusLed statusLed;
QueueHandle_t commandQueue = nullptr;
uint32_t telemetrySequence = 0;
uint32_t lastTelemetryMs = 0;

void printBootDiagnostics() {
  Serial.println("\nPourframe dual-scale controller");
  Serial.printf("Protocol: v%d, measurement-config: r%lu\n", POURFRAME_PROTOCOL_VERSION,
                static_cast<unsigned long>(measurement::config::kRevision));
  Serial.printf("Chip: %s, revision=%u, cores=%u\n", ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores());
  Serial.printf("Flash: %u bytes, speed=%u Hz, mode=%u\n", ESP.getFlashChipSize(), ESP.getFlashChipSpeed(),
                static_cast<unsigned>(ESP.getFlashChipMode()));
  Serial.printf("PSRAM found: %s\n", psramFound() ? "yes" : "no");
  Serial.printf("Reset reason: %d\n", static_cast<int>(esp_reset_reason()));
  Serial.printf("HX711 pins: upper=%u/%u lower=%u/%u\n", kUpperDout, kUpperClock, kLowerDout, kLowerClock);
}

void processCommands() {
  AppCommand command{};
  for (uint8_t processed = 0; processed < 4 && xQueueReceive(commandQueue, &command, 0) == pdTRUE; ++processed) {
    if (command.type == CommandType::SaveWifi) {
      const bool accepted = network.saveWifiCredentials(command.ssid, command.password);
      network.sendAck(command.clientId, command.requestId, accepted,
                      accepted ? "Wi-Fi credentials accepted" : "Invalid Wi-Fi credentials");
    } else if (command.type == CommandType::SetTarget) {
      const bool accepted = targetStore.setTarget(command.target, command.targetGrams);
      network.sendAck(command.clientId, command.requestId, accepted,
                      accepted ? "Target weight saved" : "Invalid target weight");
    } else if (command.type == CommandType::ClearTarget) {
      targetStore.clearTarget(command.target);
      network.sendAck(command.clientId, command.requestId, true, "Target weight cleared");
    } else if (!scales.submit(command)) {
      network.sendAck(command.clientId, command.requestId, false, "Sensor command queue is full");
    }
  }
}

void processSensorResults() {
  SensorCommandResult result{};
  while (scales.takeResult(result)) {
    if (result.type == SensorResultType::Calibration) {
      if (result.ok) {
        scalePreferences.putFloat(result.scale == ScaleId::Upper ? "upper_factor" : "lower_factor", result.factor);
      }
      network.sendCalibrationEvent(result.scale, result.ok, result.factor);
    }
    network.sendAck(result.clientId, result.requestId, result.ok, result.message == nullptr ? "Sensor command complete" : result.message);
  }
}

void addTargetTelemetry(JsonObject object, const TargetConfig &target) {
  if (target.enabled && target.historyCount > 0) object["target_grams"] = target.activeGrams();
  else object["target_grams"] = nullptr;
  JsonArray history = object["target_history_grams"].to<JsonArray>();
  for (uint8_t index = 0; index < target.historyCount; ++index) history.add(target.history[index]);
}

void addScaleTelemetry(JsonObject object, bool upper, const measurement::MeasurementSnapshot &snapshot,
                       const TargetConfig &target) {
  const measurement::ChannelHealth &health = upper ? snapshot.upperHealth : snapshot.lowerHealth;
  object["raw"] = upper ? snapshot.upperRaw : snapshot.lowerRaw;
  object["median_raw"] = upper ? snapshot.upperMedianRaw : snapshot.lowerMedianRaw;
  object["grams"] = upper ? snapshot.upperFiltered : snapshot.lowerFiltered;
  object["calibrated"] = upper ? snapshot.upperCalibrated : snapshot.lowerCalibrated;
  object["slope_g_s"] = upper ? snapshot.upperSlopeGps : snapshot.lowerSlopeGps;
  object["range_g"] = upper ? snapshot.upperRangeGrams : snapshot.lowerRangeGrams;
  object["available"] = health.available;
  object["ready"] = health.ready;
  object["stale"] = health.stale;
  object["disconnected"] = health.disconnected;
  object["calibrating"] = health.calibrating;
  object["calibration_valid"] = health.calibrated;
  object["saturated"] = health.saturated;
  object["cadence_valid"] = health.cadenceValid;
  object["last_sample_ms"] = (upper ? snapshot.upperLastSampleUs : snapshot.lowerLastSampleUs) / 1000;
  addTargetTelemetry(object, target);
}

void addTotalTelemetry(JsonObject object, const measurement::MeasurementSnapshot &snapshot,
                       const TotalWeightReading &reading, const TargetConfig &target) {
  if (reading.available) object["grams"] = reading.grams;
  else object["grams"] = nullptr;
  object["available"] = reading.available;
  object["partial"] = reading.partial;
  object["upper_included"] = reading.upperIncluded;
  object["lower_included"] = reading.lowerIncluded;
  object["slope_g_s"] = snapshot.totalSlopeGps;
  object["pour_rate_g_s"] = snapshot.totalSlopeGps > 0.0 ? snapshot.totalSlopeGps : 0.0;
  object["transfer_residual_g_s"] = snapshot.transferResidualGps;
  addTargetTelemetry(object, target);
  const TargetLedEvaluation evaluation = StatusLed::evaluate(reading, target);
  object["led_state"] = StatusLed::stateName(evaluation.state);
  object["led_proximity"] = evaluation.proximity;
}

void publishTelemetry(uint32_t nowMs, const measurement::MeasurementSnapshot &snapshot) {
  JsonDocument document;
  document["v"] = POURFRAME_PROTOCOL_VERSION;
  document["type"] = "telemetry";
  document["seq"] = telemetrySequence++;
  document["uptime_ms"] = nowMs;
  const TotalWeightReading totalReading = StatusLed::totalReading(snapshot);
  addScaleTelemetry(document["scales"]["upper"].to<JsonObject>(), true, snapshot,
                    targetStore.config(TargetId::Upper));
  addScaleTelemetry(document["scales"]["lower"].to<JsonObject>(), false, snapshot,
                    targetStore.config(TargetId::Lower));
  addTotalTelemetry(document["total"].to<JsonObject>(), snapshot, totalReading, targetStore.config(TargetId::Total));
  JsonObject measurementObject = document["measurement"].to<JsonObject>();
  measurementObject["sample_timestamp_ms"] = snapshot.timestampUs / 1000;
  measurementObject["state"] = measurement::stateName(snapshot.state);
  measurementObject["candidate_state"] = measurement::stateName(snapshot.candidateState);
  measurementObject["is_stable"] = snapshot.isStable;
  measurementObject["confidence"] = snapshot.confidence;
  measurementObject["alpha"] = snapshot.selectedAlpha;
  measurementObject["sample_rate_hz"] = snapshot.observedSampleRateHz;
  measurementObject["upper_sample_rate_hz"] = snapshot.upperSampleRateHz;
  measurementObject["lower_sample_rate_hz"] = snapshot.lowerSampleRateHz;
  measurementObject["pair_skew_us"] = snapshot.pairSkewUs;
  measurementObject["dropped_samples"] = snapshot.droppedSamples;
  document["wifi"]["connected"] = network.connected();
  document["wifi"]["provisioning"] = network.accessPointActive();
  document["wifi"]["ssid"] = network.stationSsid();
  document["wifi"]["rssi"] = network.rssi();
  document["wifi"]["ip"] = network.ipAddress();
  document["hostname"] = "pourframe.local";

  char output[NetworkService::kMaxOutputPayload];
  const size_t required = measureJson(document);
  if (required >= sizeof(output)) {
    Serial.printf("Telemetry serialization overflow (required=%u capacity=%u)\n", static_cast<unsigned>(required + 1),
                  static_cast<unsigned>(sizeof(output)));
    return;
  }
  const size_t written = serializeJson(document, output, sizeof(output));
  if (written > 0 && written < sizeof(output)) {
    network.broadcastTelemetry(output, written, nowMs);
  } else {
    Serial.printf("Telemetry serialization overflow (capacity=%u)\n", static_cast<unsigned>(sizeof(output)));
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  printBootDiagnostics();

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed; static UI will be unavailable");
  else Serial.printf("LittleFS: used=%u total=%u bytes\n", LittleFS.usedBytes(), LittleFS.totalBytes());

  scalePreferences.begin("pourframe-scale", false);
  targetStore.begin(scalePreferences);
  const bool upperCalibrated = scalePreferences.isKey("upper_factor");
  const bool lowerCalibrated = scalePreferences.isKey("lower_factor");
  const float upperFactor = scalePreferences.getFloat("upper_factor", kDefaultScaleFactor);
  const float lowerFactor = scalePreferences.getFloat("lower_factor", kDefaultScaleFactor);
  if (!scales.begin(upperFactor, upperCalibrated, lowerFactor, lowerCalibrated)) {
    Serial.println("FATAL: dual-scale task or queue allocation failed");
    while (true) delay(1000);
  }
  statusLed.begin();
  commandQueue = xQueueCreate(kCommandQueueLength, sizeof(AppCommand));
  if (commandQueue == nullptr) {
    Serial.println("FATAL: command queue allocation failed");
    while (true) delay(1000);
  }
  network.begin(commandQueue);
}

void loop() {
  const uint32_t nowMs = millis();
  processCommands();
  processSensorResults();
  const measurement::MeasurementSnapshot snapshot = scales.snapshot(nowMs);
  const TotalWeightReading totalReading = StatusLed::totalReading(snapshot);
  statusLed.update(nowMs, totalReading, targetStore.config(TargetId::Total));
  network.loop(nowMs);
  if (nowMs - lastTelemetryMs >= measurement::config::kPublicationIntervalMs) {
    lastTelemetryMs = nowMs;
    publishTelemetry(nowMs, snapshot);
  }
  delay(1);
}
