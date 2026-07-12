#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_system.h>

#include "app_types.h"
#include "network_service.h"
#include "scale_channel.h"

namespace {
constexpr uint8_t kUpperDout = 4;
constexpr uint8_t kUpperClock = 5;
constexpr uint8_t kLowerDout = 6;
constexpr uint8_t kLowerClock = 7;
constexpr uint32_t kTelemetryIntervalMs = 200;
constexpr uint8_t kCommandQueueLength = 8;
constexpr float kDefaultScaleFactor = 1.0f;

ScaleChannel upperScale(ScaleId::Upper, kUpperDout, kUpperClock);
ScaleChannel lowerScale(ScaleId::Lower, kLowerDout, kLowerClock);
NetworkService network;
Preferences scalePreferences;
QueueHandle_t commandQueue = nullptr;
uint32_t telemetrySequence = 0;
uint32_t lastTelemetryMs = 0;

ScaleChannel &channelFor(ScaleId id) { return id == ScaleId::Upper ? upperScale : lowerScale; }

void printBootDiagnostics() {
  Serial.println("\nPourframe dual-scale controller");
  Serial.printf("Protocol: v%d\n", POURFRAME_PROTOCOL_VERSION);
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
      continue;
    }

    ScaleChannel &channel = channelFor(command.scale);
    if (command.type == CommandType::Tare) {
      const bool ok = channel.tare();
      network.sendAck(command.clientId, command.requestId, ok, ok ? "Scale tared" : "Scale has no current sample");
    } else if (command.type == CommandType::Calibrate) {
      const bool ok = channel.startCalibration(command.knownGrams);
      network.sendAck(command.clientId, command.requestId, ok,
                      ok ? "Calibration sampling started" : "Scale is unavailable or busy");
    }
  }
}

void processCalibrationResult(ScaleChannel &channel, const char *preferenceKey) {
  float factor = 0.0f;
  bool succeeded = false;
  if (!channel.takeCalibrationResult(factor, succeeded)) {
    return;
  }
  if (succeeded) {
    scalePreferences.putFloat(preferenceKey, factor);
  }
  network.sendCalibrationEvent(channel.id(), succeeded, factor);
}

void addScaleTelemetry(JsonObject object, const ScaleSnapshot &snapshot) {
  object["raw"] = snapshot.raw;
  object["grams"] = roundf(snapshot.grams * 100.0f) / 100.0f;
  object["available"] = snapshot.available;
  object["ready"] = snapshot.ready;
  object["stale"] = snapshot.stale;
  object["disconnected"] = snapshot.disconnected;
  object["calibrating"] = snapshot.calibrating;
  object["last_sample_ms"] = snapshot.lastSampleMs;
}

void publishTelemetry(uint32_t nowMs) {
  JsonDocument document;
  document["v"] = POURFRAME_PROTOCOL_VERSION;
  document["type"] = "telemetry";
  document["seq"] = telemetrySequence++;
  document["uptime_ms"] = nowMs;
  addScaleTelemetry(document["scales"]["upper"].to<JsonObject>(), upperScale.snapshot(nowMs));
  addScaleTelemetry(document["scales"]["lower"].to<JsonObject>(), lowerScale.snapshot(nowMs));
  document["wifi"]["connected"] = network.connected();
  document["wifi"]["provisioning"] = network.accessPointActive();
  document["wifi"]["ssid"] = network.stationSsid();
  document["wifi"]["rssi"] = network.rssi();
  document["wifi"]["ip"] = network.ipAddress();
  document["hostname"] = "pourframe.local";

  char output[1024];
  const size_t written = serializeJson(document, output, sizeof(output));
  if (written > 0 && written < sizeof(output)) {
    network.broadcastTelemetry(output, written, nowMs);
  } else {
    Serial.println("Telemetry serialization exceeded the output buffer");
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  printBootDiagnostics();

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed; static UI will be unavailable");
  } else {
    Serial.printf("LittleFS: used=%u total=%u bytes\n", LittleFS.usedBytes(), LittleFS.totalBytes());
  }

  scalePreferences.begin("pourframe-scale", false);
  upperScale.begin(scalePreferences.getFloat("upper_factor", kDefaultScaleFactor));
  lowerScale.begin(scalePreferences.getFloat("lower_factor", kDefaultScaleFactor));

  commandQueue = xQueueCreate(kCommandQueueLength, sizeof(AppCommand));
  if (commandQueue == nullptr) {
    Serial.println("FATAL: command queue allocation failed");
    while (true) {
      delay(1000);
    }
  }
  network.begin(commandQueue);
}

void loop() {
  const uint32_t nowMs = millis();
  upperScale.poll(nowMs);
  lowerScale.poll(nowMs);
  processCommands();
  processCalibrationResult(upperScale, "upper_factor");
  processCalibrationResult(lowerScale, "lower_factor");
  network.loop(nowMs);

  if (nowMs - lastTelemetryMs >= kTelemetryIntervalMs) {
    lastTelemetryMs = nowMs;
    publishTelemetry(nowMs);
  }
  delay(1);
}
