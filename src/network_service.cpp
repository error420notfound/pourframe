#include "network_service.h"

#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <LittleFS.h>

#include <cmath>
#include <cctype>
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

bool validCueId(const char *value) {
  if (value == nullptr) return false;
  const size_t length = strlen(value);
  return length > 0 && length <= 96;
}

bool validStorageId(const String &value) {
  if (value.isEmpty() || value.length() > 64) return false;
  for (size_t index = 0; index < value.length(); ++index) {
    const char character = value[index];
    if (!isalnum(static_cast<unsigned char>(character)) && character != '-' && character != '_') return false;
  }
  return true;
}

bool parseUint32(const String &value, uint32_t &result) {
  if (value.isEmpty()) return false;
  char *end = nullptr;
  const unsigned long parsed = strtoul(value.c_str(), &end, 10);
  if (end == value.c_str() || *end != '\0') return false;
  result = static_cast<uint32_t>(parsed);
  return true;
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

bool parseTarget(const char *value, TargetId &target) {
  if (value == nullptr) {
    return false;
  }
  if (strcmp(value, "upper") == 0) {
    target = TargetId::Upper;
    return true;
  }
  if (strcmp(value, "lower") == 0) {
    target = TargetId::Lower;
    return true;
  }
  if (strcmp(value, "total") == 0) {
    target = TargetId::Total;
    return true;
  }
  return false;
}

void sendJson(AsyncWebServerRequest *request, int status, const JsonDocument &document) {
  AsyncResponseStream *response = request->beginResponseStream("application/json");
  response->setCode(status);
  serializeJson(document, *response);
  request->send(response);
}

void sendApiError(AsyncWebServerRequest *request, int status, const char *code, const String &message) {
  JsonDocument document;
  document["v"] = 1;
  document["error"]["code"] = code;
  document["error"]["message"] = message;
  sendJson(request, status, document);
}

String apiErrorMessage(const String &code) {
  if (code == "revision_conflict") return "Shared data changed on another client. Refresh and try again.";
  if (code == "recipe_limit_reached") return "PourFrame can store up to 24 recipes.";
  if (code == "storage_limit_reached") return "PourFrame shared storage is full.";
  if (code == "recipe_not_found") return "The selected recipe no longer exists.";
  if (code == "trace_not_found") return "Upload the validated brew trace before committing its summary.";
  if (code.startsWith("invalid_recipe") || code == "recipe_equipment_limit") return "The recipe contains unsupported or oversized values.";
  if (code.startsWith("invalid_brew")) return "The completed brew record is invalid.";
  if (code.startsWith("storage_")) return "PourFrame could not safely update shared storage.";
  return code;
}
}  // namespace

NetworkService::NetworkService() : server_(80), webSocket_("/ws") {}

void NetworkService::begin(QueueHandle_t commandQueue) {
  commandQueue_ = commandQueue;
  userDataReady_ = userDataStore_.begin();
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

  server_.on("/api/recipes", HTTP_GET, [this](AsyncWebServerRequest *request) {
    if (!userDataReady_) {
      sendApiError(request, 503, "storage_unavailable", "Shared recipe storage is unavailable");
      return;
    }
    JsonDocument output;
    String error;
    if (!userDataStore_.readRecipes(output, error)) {
      sendApiError(request, 500, error.c_str(), "Stored recipes could not be read");
      return;
    }
    sendJson(request, 200, output);
  });

  auto *recipePostHandler = new AsyncCallbackJsonWebHandler(
      "/api/recipes", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        if (!userDataReady_) {
          sendApiError(request, 503, "storage_unavailable", "Shared recipe storage is unavailable");
          return;
        }
        if (!json.is<JsonObjectConst>()) {
          sendApiError(request, 400, "invalid_json", "A JSON object is required");
          return;
        }
        JsonDocument output;
        String error;
        int status = 500;
        if (!userDataStore_.upsertRecipe(json.as<JsonObjectConst>(), output, status, error)) {
          sendApiError(request, status, error.c_str(), apiErrorMessage(error));
          return;
        }
        sendJson(request, status, output);
      });
  recipePostHandler->setMethod(HTTP_POST);
  recipePostHandler->setMaxContentLength(UserDataStore::kMaxRecipePayload);
  server_.addHandler(recipePostHandler);

  server_.on("/api/recipes", HTTP_DELETE, [this](AsyncWebServerRequest *request) {
    if (!userDataReady_) {
      sendApiError(request, 503, "storage_unavailable", "Shared recipe storage is unavailable");
      return;
    }
    if (!request->hasParam("id") || !request->hasParam("base_revision")) {
      sendApiError(request, 422, "invalid_request", "id and base_revision are required");
      return;
    }
    const String id = request->getParam("id")->value();
    uint32_t baseRevision = 0;
    if (!parseUint32(request->getParam("base_revision")->value(), baseRevision)) {
      sendApiError(request, 422, "invalid_revision", "base_revision must be an unsigned integer");
      return;
    }
    JsonDocument output;
    String error;
    int status = 500;
    if (!userDataStore_.deleteRecipe(id, baseRevision, output, status, error)) {
      sendApiError(request, status, error.c_str(), apiErrorMessage(error));
      return;
    }
    sendJson(request, status, output);
  });

  server_.on("/api/brews", HTTP_GET, [this](AsyncWebServerRequest *request) {
    if (!userDataReady_) {
      sendApiError(request, 503, "storage_unavailable", "Shared brew storage is unavailable");
      return;
    }
    size_t limit = UserDataStore::kMaxBrews;
    if (request->hasParam("limit")) {
      const long requested = request->getParam("limit")->value().toInt();
      if (requested > 0) limit = min(static_cast<size_t>(requested), UserDataStore::kMaxBrews);
    }
    JsonDocument output;
    String error;
    if (!userDataStore_.readBrews(output, limit, error)) {
      sendApiError(request, 500, error.c_str(), "Stored brews could not be read");
      return;
    }
    sendJson(request, 200, output);
  });

  auto *brewPostHandler = new AsyncCallbackJsonWebHandler(
      "/api/brews", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        if (!userDataReady_) {
          sendApiError(request, 503, "storage_unavailable", "Shared brew storage is unavailable");
          return;
        }
        if (!json.is<JsonObjectConst>()) {
          sendApiError(request, 400, "invalid_json", "A JSON object is required");
          return;
        }
        JsonDocument output;
        String error;
        int status = 500;
        if (!userDataStore_.appendBrew(json.as<JsonObjectConst>(), output, status, error)) {
          sendApiError(request, status, error.c_str(), apiErrorMessage(error));
          return;
        }
        sendJson(request, status, output);
      });
  brewPostHandler->setMethod(HTTP_POST);
  brewPostHandler->setMaxContentLength(UserDataStore::kMaxBrewPayload);
  server_.addHandler(brewPostHandler);

  server_.on("/api/brews", HTTP_DELETE, [this](AsyncWebServerRequest *request) {
    if (!userDataReady_) {
      sendApiError(request, 503, "storage_unavailable", "Shared brew storage is unavailable");
      return;
    }
    if (!request->hasParam("base_revision") || !request->hasParam("confirm") ||
        request->getParam("confirm")->value() != "clear") {
      sendApiError(request, 422, "confirmation_required", "confirm=clear and base_revision are required");
      return;
    }
    uint32_t baseRevision = 0;
    if (!parseUint32(request->getParam("base_revision")->value(), baseRevision)) {
      sendApiError(request, 422, "invalid_revision", "base_revision must be an unsigned integer");
      return;
    }
    JsonDocument output;
    String error;
    int status = 500;
    if (!userDataStore_.clearBrews(baseRevision, output, status, error)) {
      sendApiError(request, status, error.c_str(), apiErrorMessage(error));
      return;
    }
    sendJson(request, status, output);
  });

  server_.on(
      "/api/brew-traces", HTTP_PUT,
      [this](AsyncWebServerRequest *request) {
        if (!userDataReady_) { sendApiError(request, 503, "storage_unavailable", "Shared trace storage is unavailable"); return; }
        if (!request->hasParam("id") || !validStorageId(request->getParam("id")->value())) { sendApiError(request, 422, "invalid_brew_id", "A safe brew id is required"); return; }
        const String id = request->getParam("id")->value();
        const String temporary = String("/user/traces/") + id + ".tmp";
        String error;
        if (!userDataStore_.storeTrace(id, temporary.c_str(), error)) {
          LittleFS.remove(temporary);
          sendApiError(request, 422, error.c_str(), "The trace could not be validated or stored");
          return;
        }
        JsonDocument output;
        output["v"] = 1; output["id"] = id; output["stored"] = true;
        sendJson(request, 200, output);
      },
      nullptr,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t length, size_t index, size_t total) {
        if (!request->hasParam("id")) return;
        const String id = request->getParam("id")->value();
        if (!validStorageId(id) || total < 16 || total > 138616) return;
        const String temporary = String("/user/traces/") + id + ".tmp";
        if (index == 0) {
          LittleFS.remove(temporary);
          request->_tempFile = LittleFS.open(temporary, "w");
        }
        if (request->_tempFile) request->_tempFile.write(data, length);
        if (index + length == total && request->_tempFile) { request->_tempFile.flush(); request->_tempFile.close(); }
      });

  server_.on("/api/brew-traces", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("id") || !validStorageId(request->getParam("id")->value())) { request->send(422, "application/json", "{\"error\":\"invalid_brew_id\"}"); return; }
    const String path = String("/user/traces/") + request->getParam("id")->value() + ".pftr";
    if (!LittleFS.exists(path)) { request->send(404, "application/json", "{\"error\":\"trace_not_found\"}"); return; }
    request->send(LittleFS, path, "application/octet-stream");
  });

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
  strlcpy(command.requestId, requestId, sizeof(command.requestId));
  if (strcmp(commandName, "tare") == 0) {
    if (!parseScale(channelName, command.scale)) {
      sendClientError(client, requestId, "invalid_channel", "Tare channel must be upper or lower");
      return;
    }
    command.type = CommandType::Tare;
  } else if (strcmp(commandName, "calibrate") == 0) {
    if (!parseScale(channelName, command.scale)) {
      sendClientError(client, requestId, "invalid_channel", "Calibration channel must be upper or lower");
      return;
    }
    command.type = CommandType::Calibrate;
    command.knownGrams = document["known_grams"] | 0.0f;
    if (!isfinite(command.knownGrams) || command.knownGrams <= 0.0f) {
      sendClientError(client, requestId, "invalid_calibration", "known_grams must be positive");
      return;
    }
  } else if (strcmp(commandName, "set_target") == 0) {
    if (!parseTarget(channelName, command.target)) {
      sendClientError(client, requestId, "invalid_channel", "Target channel must be upper, lower, or total");
      return;
    }
    command.type = CommandType::SetTarget;
    command.targetGrams = document["target_grams"] | 0.0f;
    if (!isfinite(command.targetGrams) || command.targetGrams <= 0.0f) {
      sendClientError(client, requestId, "invalid_target", "target_grams must be positive");
      return;
    }
  } else if (strcmp(commandName, "clear_target") == 0) {
    if (!parseTarget(channelName, command.target)) {
      sendClientError(client, requestId, "invalid_channel", "Target channel must be upper, lower, or total");
      return;
    }
    command.type = CommandType::ClearTarget;
  } else if (strcmp(commandName, "brew_step_cue") == 0) {
    const char *cueId = document["cue_id"] | "";
    if (!validCueId(cueId)) {
      sendClientError(client, requestId, "invalid_cue_id", "cue_id must contain 1-96 characters");
      return;
    }
    command.pulseCount = document["pulse_count"] | 0;
    command.intervalMs = document["interval_ms"] | 0;
    if (command.pulseCount != 5 || command.intervalMs != 1000) {
      sendClientError(client, requestId, "invalid_cue", "brew_step_cue requires five pulses at 1000 ms");
      return;
    }
    command.type = CommandType::BrewStepCue;
    strlcpy(command.cueId, cueId, sizeof(command.cueId));
  } else if (strcmp(commandName, "brew_step_cue_cancel") == 0) {
    const char *cueId = document["cue_id"] | "";
    if (!validCueId(cueId)) {
      sendClientError(client, requestId, "invalid_cue_id", "cue_id must contain 1-96 characters");
      return;
    }
    command.type = CommandType::BrewStepCueCancel;
    strlcpy(command.cueId, cueId, sizeof(command.cueId));
  } else if (strcmp(commandName, "brew_step_activate") == 0) {
    const char *transitionId = document["transition_id"] | "";
    if (!validCueId(transitionId)) {
      sendClientError(client, requestId, "invalid_transition_id", "transition_id must contain 1-96 characters");
      return;
    }
    command.baselineTotalGrams = document["baseline_total_grams"] | static_cast<float>(NAN);
    command.stepTargetGrams = document["step_target_grams"] | static_cast<float>(NAN);
    command.cumulativeTargetGrams = document["cumulative_target_grams"] | static_cast<float>(NAN);
    if (!isfinite(command.baselineTotalGrams) || !isfinite(command.stepTargetGrams) || command.stepTargetGrams <= 0.0f ||
        !isfinite(command.cumulativeTargetGrams) || command.cumulativeTargetGrams <= 0.0f) {
      sendClientError(client, requestId, "invalid_brew_step", "Finite baseline, positive step target, and positive cumulative target are required");
      return;
    }
    command.type = CommandType::BrewStepActivate;
    strlcpy(command.transitionId, transitionId, sizeof(command.transitionId));
  } else if (strcmp(commandName, "brew_step_clear") == 0) {
    command.type = CommandType::BrewStepClear;
  } else {
    sendClientError(client, requestId, "unknown_command",
                    "Supported commands are tare, calibrate, set_target, clear_target, and brew step commands");
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
