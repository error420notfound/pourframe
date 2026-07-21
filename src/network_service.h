#pragma once

#include <Arduino.h>
#include <AsyncTCP.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

#include "app_types.h"

class NetworkService {
 public:
  static constexpr size_t kMaxOutputPayload = 3072;

  NetworkService();

  void begin(QueueHandle_t commandQueue);
  void loop(uint32_t nowMs);
  bool saveWifiCredentials(const char *ssid, const char *password);
  void broadcastTelemetry(const char *payload, size_t length, uint32_t nowMs);
  void sendAck(uint32_t clientId, const char *requestId, bool ok, const char *message);
  void sendCalibrationEvent(ScaleId scale, bool ok, float factor);

  bool connected() const;
  bool accessPointActive() const;
  const String &stationSsid() const;
  String ipAddress() const;
  int32_t rssi() const;
  size_t webSocketClientCount() const;

 private:
  static constexpr size_t kMaxCommandPayload = 512;
  static constexpr uint8_t kMaxWebSocketClients = 4;
  static constexpr uint32_t kConnectTimeoutMs = 15000;
  static constexpr uint32_t kMaxReconnectDelayMs = 30000;
  static constexpr uint32_t kSlowClientCloseMs = 10000;

  struct SlowClientState {
    uint32_t id = 0;
    uint32_t sinceMs = 0;
  };

  void configureRoutes();
  void handleWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg,
                            uint8_t *data, size_t length);
  void handleWebSocketCommand(AsyncWebSocketClient *client, uint8_t *data, size_t length);
  void sendClientError(AsyncWebSocketClient *client, const char *requestId, const char *code, const char *message);
  void beginStationConnection(uint32_t nowMs);
  void startAccessPoint();
  void stopAccessPoint();
  void startMdns();
  void stopMdns();
  void sendNetworkStatus(AsyncWebServerRequest *request);
  SlowClientState *slowClientState(uint32_t clientId);
  void clearSlowClientState(uint32_t clientId);

  AsyncWebServer server_;
  AsyncWebSocket webSocket_;
  DNSServer dnsServer_;
  Preferences preferences_;
  QueueHandle_t commandQueue_ = nullptr;
  String savedSsid_;
  String savedPassword_;
  String setupSsid_;
  bool accessPointActive_ = false;
  bool mdnsActive_ = false;
  bool stationConnecting_ = false;
  bool previouslyConnected_ = false;
  uint32_t connectionStartedMs_ = 0;
  uint32_t nextReconnectMs_ = 0;
  uint32_t reconnectDelayMs_ = 1000;
  uint32_t lastCleanupMs_ = 0;
  SlowClientState slowClients_[kMaxWebSocketClients]{};
};
