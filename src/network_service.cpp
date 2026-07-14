#include "network_service.h"

#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <LittleFS.h>

#include <cstring>

namespace {
constexpr uint8_t kDnsPort = 53;
constexpr uint8_t kSetupApChannel = 6;
const IPAddress kSetupApAddress(192, 168, 4, 1);
const IPAddress kSetupApNetmask(255, 255, 255, 0);

bool validRequestId(const char *value) {
  if (value == nullptr) {
    return false;
  }
  const size_t length = strlen(value);
  return length > 0 && length <= 36;
}

bool parseScale(const char *value, ScaleId &scale) {
  if (value == nullptr) {
    return false;
  }
  if (strcmp(value, "upper") == 0) {
    scale = ScaleId::Upper;
    return true;
  }
  if (strcmp(value, "lower") == 0) {
    scale = ScaleId::Lower;
    return true;
  }
  return false;
}
}  // namespace

NetworkService::NetworkService() : server_(80), webSocket_("/ws") {}

void NetworkService::begin(QueueHandle_t commandQueue) {
  commandQueue_ = commandQueue;
  preferences_.begin("pourframe-wifi", false);
  savedSsid_ = preferences_.isKey("ssid") ? preferences_.getString("ssid", "") : "";
  savedPassword_ = preferences_.isKey("password") ? preferences_.getString("password", "") : "";

  webSocket_.onEvent([this](AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg,
                            uint8_t *data, size_t length) {
    handleWebSocketEvent(server, client, type, arg, data, length);
  });
  server_.addHandler(&webSocket_);
  configureRoutes();

  // AsyncTCP requires the ESP32 network stack to exist before the server is
  // started. Starting AsyncWebServer first triggers an "Invalid mbox" lwIP
  // assertion on a fresh boot, before the provisioning AP can be created.
  Serial.println("Wi-Fi: initializing network stack");
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  if (savedSsid_.isEmpty()) {
    startAccessPoint();
  } else {
    beginStationConnection(millis());
  }

  server_.begin();
  Serial.println("HTTP server started on port 80");
}

void NetworkService::loop(uint32_t nowMs) {
  if (accessPointActive_) {
    dnsServer_.processNextRequest();
  }

  const bool isConnected = WiFi.status() == WL_CONNECTED;
  if (isConnected && !previouslyConnected_) {
    stationConnecting_ = false;
    reconnectDelayMs_ = 1000;
    startMdns();
    stopAccessPoint();
    Serial.printf("Wi-Fi connected: %s, IP=%s, RSSI=%ld dBm\n", savedSsid_.c_str(), WiFi.localIP().toString().c_str(),
                  static_cast<long>(WiFi.RSSI()));
  } else if (!isConnected && previouslyConnected_) {
    stopMdns();
    stationConnecting_ = false;
    nextReconnectMs_ = nowMs + reconnectDelayMs_;
    Serial.println("Wi-Fi disconnected; scheduling reconnect");
  }
  previouslyConnected_ = isConnected;

  if (!isConnected && stationConnecting_ && nowMs - connectionStartedMs_ >= kConnectTimeoutMs) {
    stationConnecting_ = false;
    nextReconnectMs_ = nowMs + reconnectDelayMs_;
    reconnectDelayMs_ = min(reconnectDelayMs_ * 2, kMaxReconnectDelayMs);
    startAccessPoint();
    Serial.println("Wi-Fi connection timed out; setup access point is available");
  }

  if (!isConnected && !stationConnecting_ && !savedSsid_.isEmpty() && nowMs >= nextReconnectMs_) {
    beginStationConnection(nowMs);
  }

  if (nowMs - lastCleanupMs_ >= 1000) {
    lastCleanupMs_ = nowMs;
    webSocket_.cleanupClients(kMaxWebSocketClients);
  }
}

bool NetworkService::saveWifiCredentials(const char *ssid, const char *password) {
  if (ssid == nullptr || password == nullptr) {
    return false;
  }
  const size_t ssidLength = strlen(ssid);
  const size_t passwordLength = strlen(password);
  if (ssidLength == 0 || ssidLength > 32 || passwordLength > 64) {
    return false;
  }

  savedSsid_ = ssid;
  savedPassword_ = password;
  preferences_.putString("ssid", savedSsid_);
  preferences_.putString("password", savedPassword_);
  WiFi.disconnect(false, false);
  stationConnecting_ = false;
  nextReconnectMs_ = millis();
  reconnectDelayMs_ = 1000;
  return true;
}

void NetworkService::broadcastTelemetry(const char *payload, size_t length, uint32_t nowMs) {
  if (payload == nullptr || length == 0 || length >= kMaxOutputPayload) {
    return;
  }

  for (auto &client : webSocket_.getClients()) {
    if (client.status() != WS_CONNECTED) {
      continue;
    }
    if (client.canSend() && client.queueLen() < 2) {
      client.text(payload, length);
      clearSlowClientState(client.id());
      continue;
    }

    SlowClientState *state = slowClientState(client.id());
    if (state != nullptr && state->sinceMs == 0) {
      state->sinceMs = nowMs;
    } else if (state != nullptr && nowMs - state->sinceMs >= kSlowClientCloseMs) {
      client.close(1013, "slow client");
      clearSlowClientState(client.id());
    }
  }
}

void NetworkService::sendAck(uint32_t clientId, const char *requestId, bool ok, const char *message) {
  if (clientId == 0) {
    return;
  }
  JsonDocument document;
  document["v"] = POURFRAME_PROTOCOL_VERSION;
  document["type"] = "ack";
  document["id"] = requestId == nullptr ? "" : requestId;
  document["ok"] = ok;
  document["message"] = message;
  char output[kMaxOutputPayload];
  const size_t written = serializeJson(document, output, sizeof(output));
  if (written > 0 && written < sizeof(output)) {
    webSocket_.text(clientId, output, written);
  }
}

void NetworkService::sendCalibrationEvent(ScaleId scale, bool ok, float factor) {
  JsonDocument document;
  document["v"] = POURFRAME_PROTOCOL_VERSION;
  document["type"] = "calibration";
  document["channel"] = scaleIdName(scale);
  document["ok"] = ok;
  if (ok) {
    document["factor"] = factor;
  }
  char output[kMaxOutputPayload];
  const size_t written = serializeJson(document, output, sizeof(output));
  if (written > 0 && written < sizeof(output)) {
    webSocket_.textAll(output, written);
  }
}

bool NetworkService::connected() const { return WiFi.status() == WL_CONNECTED; }

bool NetworkService::accessPointActive() const { return accessPointActive_; }

const String &NetworkService::stationSsid() const { return savedSsid_; }

String NetworkService::ipAddress() const {
  return connected() ? WiFi.localIP().toString() : (accessPointActive_ ? WiFi.softAPIP().toString() : "0.0.0.0");
}

int32_t NetworkService::rssi() const { return connected() ? WiFi.RSSI() : 0; }

size_t NetworkService::webSocketClientCount() const { return webSocket_.count(); }

void NetworkService::configureRoutes() {
  server_.on("/api/health", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "application/json", "{\"status\":\"ok\",\"v\":1}");
  });
  server_.on("/api/status", HTTP_GET, [this](AsyncWebServerRequest *request) { sendNetworkStatus(request); });

  auto *wifiHandler = new AsyncCallbackJsonWebHandler(
      "/api/wifi", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        if (!json.is<JsonObject>()) {
          request->send(400, "application/json", "{\"error\":\"invalid_json\"}");
          return;
        }
        const char *ssid = json["ssid"] | "";
        const char *password = json["password"] | "";
        if (strlen(ssid) == 0 || strlen(ssid) > 32 || strlen(password) > 64) {
          request->send(422, "application/json", "{\"error\":\"invalid_credentials\"}");
          return;
        }

        AppCommand command{};
        command.type = CommandType::SaveWifi;
        strlcpy(command.requestId, "http-wifi", sizeof(command.requestId));
        strlcpy(command.ssid, ssid, sizeof(command.ssid));
        strlcpy(command.password, password, sizeof(command.password));
        if (commandQueue_ == nullptr || xQueueSend(commandQueue_, &command, 0) != pdTRUE) {
          request->send(503, "application/json", "{\"error\":\"command_queue_full\"}");
          return;
        }
        request->send(202, "application/json", "{\"accepted\":true}");
      });
  wifiHandler->setMethod(HTTP_POST);
  wifiHandler->setMaxContentLength(kMaxCommandPayload);
  server_.addHandler(wifiHandler);

  const char *captiveRoutes[] = {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
                                 "/ncsi.txt", "/connecttest.txt", "/redirect"};
  for (const char *route : captiveRoutes) {
    server_.on(route, HTTP_ANY, [](AsyncWebServerRequest *request) { request->redirect("/"); });
  }

  server_.serveStatic("/", LittleFS, "/").setDefaultFile("index.html").setCacheControl("max-age=3600");
  server_.onNotFound([](AsyncWebServerRequest *request) {
    if (request->url().startsWith("/api/")) {
      request->send(404, "application/json", "{\"error\":\"not_found\"}");
    } else if (LittleFS.exists("/index.html")) {
      request->send(LittleFS, "/index.html", "text/html");
    } else {
      request->send(503, "text/plain", "Pourframe UI has not been uploaded to LittleFS.");
    }
  });
}

void NetworkService::handleWebSocketEvent(AsyncWebSocket *, AsyncWebSocketClient *client, AwsEventType type, void *arg,
                                          uint8_t *data, size_t length) {
  if (type == WS_EVT_CONNECT) {
    if (webSocket_.count() > kMaxWebSocketClients) {
      client->close(1013, "client limit");
    }
    return;
  }
  if (type == WS_EVT_DISCONNECT) {
    clearSlowClientState(client->id());
    return;
  }
  if (type != WS_EVT_DATA) {
    return;
  }

  auto *info = static_cast<AwsFrameInfo *>(arg);
  if (info == nullptr || !info->final || info->index != 0 || info->len != length || info->opcode != WS_TEXT) {
    sendClientError(client, "", "unsupported_frame", "Only complete text frames are accepted");
    return;
  }
  handleWebSocketCommand(client, data, length);
}

void NetworkService::handleWebSocketCommand(AsyncWebSocketClient *client, uint8_t *data, size_t length) {
  if (length == 0 || length > kMaxCommandPayload) {
    sendClientError(client, "", "payload_too_large", "Command payload must be 1-512 bytes");
    return;
  }

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, data, length);
  if (error) {
    sendClientError(client, "", "invalid_json", error.c_str());
    return;
  }

  const int version = document["v"] | 0;
  const char *type = document["type"] | "";
  const char *requestId = document["id"] | "";
  const char *commandName = document["command"] | "";
  const char *channelName = document["channel"] | "";
  if (version != POURFRAME_PROTOCOL_VERSION) {
    sendClientError(client, requestId, "unsupported_version", "Expected protocol version 1");
    return;
  }
  if (strcmp(type, "command") != 0 || !validRequestId(requestId)) {
    sendClientError(client, requestId, "invalid_command", "A command type and request id are required");
    return;
  }

  AppCommand command{};
  command.clientId = client->id();
  if (!parseScale(channelName, command.scale)) {
    sendClientError(client, requestId, "invalid_channel", "Channel must be upper or lower");
    return;
  }
  strlcpy(command.requestId, requestId, sizeof(command.requestId));
  if (strcmp(commandName, "tare") == 0) {
    command.type = CommandType::Tare;
  } else if (strcmp(commandName, "calibrate") == 0) {
    command.type = CommandType::Calibrate;
    command.knownGrams = document["known_grams"] | 0.0f;
    if (!isfinite(command.knownGrams) || command.knownGrams <= 0.0f) {
      sendClientError(client, requestId, "invalid_calibration", "known_grams must be positive");
      return;
    }
  } else if (strcmp(commandName, "set_target") == 0) {
    command.type = CommandType::SetTarget;
    command.targetGrams = document["target_grams"] | 0.0f;
    if (!isfinite(command.targetGrams) || command.targetGrams <= 0.0f) {
      sendClientError(client, requestId, "invalid_target", "target_grams must be positive");
      return;
    }
  } else if (strcmp(commandName, "clear_target") == 0) {
    command.type = CommandType::ClearTarget;
  } else {
    sendClientError(client, requestId, "unknown_command",
                    "Supported commands are tare, calibrate, set_target, and clear_target");
    return;
  }

  if (commandQueue_ == nullptr || xQueueSend(commandQueue_, &command, 0) != pdTRUE) {
    sendClientError(client, requestId, "command_queue_full", "Try again after the current command completes");
  }
}

void NetworkService::sendClientError(AsyncWebSocketClient *client, const char *requestId, const char *code,
                                     const char *message) {
  JsonDocument document;
  document["v"] = POURFRAME_PROTOCOL_VERSION;
  document["type"] = "error";
  document["id"] = requestId == nullptr ? "" : requestId;
  document["code"] = code;
  document["message"] = message;
  char output[kMaxOutputPayload];
  const size_t written = serializeJson(document, output, sizeof(output));
  if (written > 0 && written < sizeof(output)) {
    client->text(output, written);
  }
}

void NetworkService::beginStationConnection(uint32_t nowMs) {
  if (savedSsid_.isEmpty()) {
    startAccessPoint();
    return;
  }
  WiFi.mode(accessPointActive_ ? WIFI_AP_STA : WIFI_STA);
  WiFi.begin(savedSsid_.c_str(), savedPassword_.c_str());
  stationConnecting_ = true;
  connectionStartedMs_ = nowMs;
  Serial.printf("Connecting to Wi-Fi: %s\n", savedSsid_.c_str());
}

void NetworkService::startAccessPoint() {
  if (accessPointActive_) {
    return;
  }
  const uint16_t suffix = static_cast<uint16_t>(ESP.getEfuseMac() & 0xFFFF);
  char name[32];
  snprintf(name, sizeof(name), "Pourframe-Setup-%04X", suffix);
  setupSsid_ = name;
  Serial.printf("Wi-Fi: starting setup AP %s\n", setupSsid_.c_str());

  // On first boot there is no station to connect, so keep the radio in pure
  // AP mode. AP+STA is enabled later when submitted credentials are tested.
  const wifi_mode_t mode = savedSsid_.isEmpty() ? WIFI_AP : WIFI_AP_STA;
  if (!WiFi.mode(mode)) {
    Serial.println("Wi-Fi: failed to enter provisioning radio mode");
    return;
  }
  WiFi.setSleep(false);
  if (!WiFi.setTxPower(WIFI_POWER_19_5dBm)) {
    Serial.println("Wi-Fi: could not set maximum transmit power");
  }
  if (!WiFi.softAPConfig(kSetupApAddress, kSetupApAddress, kSetupApNetmask)) {
    Serial.println("Wi-Fi: could not configure setup AP address");
    return;
  }
  if (WiFi.softAP(setupSsid_.c_str(), nullptr, kSetupApChannel, 0, kMaxWebSocketClients)) {
    accessPointActive_ = true;
    dnsServer_.start(kDnsPort, "*", WiFi.softAPIP());
    Serial.printf("Setup AP: %s, portal=%s, channel=%u, MAC=%s, power=%d\n", setupSsid_.c_str(),
                  WiFi.softAPIP().toString().c_str(), kSetupApChannel, WiFi.softAPmacAddress().c_str(),
                  static_cast<int>(WiFi.getTxPower()));
  } else {
    Serial.println("Wi-Fi: softAP creation failed");
  }
}

void NetworkService::stopAccessPoint() {
  if (!accessPointActive_) {
    return;
  }
  dnsServer_.stop();
  WiFi.softAPdisconnect(true);
  accessPointActive_ = false;
}

void NetworkService::startMdns() {
  if (mdnsActive_) {
    return;
  }
  if (MDNS.begin("pourframe")) {
    MDNS.addService("http", "tcp", 80);
    mdnsActive_ = true;
    Serial.println("mDNS ready: http://pourframe.local");
  }
}

void NetworkService::stopMdns() {
  if (mdnsActive_) {
    MDNS.end();
    mdnsActive_ = false;
  }
}

void NetworkService::sendNetworkStatus(AsyncWebServerRequest *request) {
  JsonDocument document;
  document["v"] = POURFRAME_PROTOCOL_VERSION;
  document["wifi"]["connected"] = connected();
  document["wifi"]["provisioning"] = accessPointActive_;
  document["wifi"]["ssid"] = connected() ? WiFi.SSID() : setupSsid_;
  document["wifi"]["ip"] = ipAddress();
  document["wifi"]["rssi"] = rssi();
  document["websocket_clients"] = webSocketClientCount();
  document["hostname"] = "pourframe.local";
  auto *response = request->beginResponseStream("application/json");
  serializeJson(document, *response);
  request->send(response);
}

NetworkService::SlowClientState *NetworkService::slowClientState(uint32_t clientId) {
  for (auto &state : slowClients_) {
    if (state.id == clientId) {
      return &state;
    }
  }
  for (auto &state : slowClients_) {
    if (state.id == 0) {
      state.id = clientId;
      return &state;
    }
  }
  return nullptr;
}

void NetworkService::clearSlowClientState(uint32_t clientId) {
  for (auto &state : slowClients_) {
    if (state.id == clientId) {
      state = {};
    }
  }
}
