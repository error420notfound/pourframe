# Environment and dependency audit

Audit date: 2026-07-12

## Platform

- PlatformIO Core: 6.1.19
- Installed platform: `platformio/espressif32` 6.13.0
- Arduino framework package: 2.0.17 (`framework-arduinoespressif32` 3.20017.241212)
- Current and retained board ID: `esp32-s3-devkitc-1`
- Target: ESP32-S3, Xtensa, 240 MHz; this is not a classic ESP32 target.
- Board profile: 8 MB QSPI flash, QIO, 80 MHz, `default_8MB.csv`, native USB Serial/JTAG mode, no PSRAM.
- Filesystem: LittleFS.
- Upload: `esptool` at 460800 baud; the enumerating USB connector and reset behavior require physical confirmation.

The current Shrike-Fi product specification and the owner's hardware clarification identify 8 MB QSPI flash. Older Vicharak documentation contains a conflicting 4 MB value, so `esptool flash_id` remains a first-upload gate. PSRAM is disabled unless a later physical probe proves it is installed.

## Dependencies

| Library | Package ID | Resolved version | Role | ESP32-S3 | Decision |
| --- | --- | ---: | --- | --- | --- |
| HX711 | `bogde/HX711` | 0.7.5 | Dual ADC acquisition | Compatible | Keep and pin |
| ESPAsyncWebServer | `esp32async/ESPAsyncWebServer` | 3.11.2 | HTTP, WebSocket, static files | Compatible | Keep and pin |
| AsyncTCP | `esp32async/AsyncTCP` | 3.4.10 | ESP32 async transport | Compatible | Keep and pin |
| ArduinoJson | `bblanchon/ArduinoJson` | 7.4.3 | Protocol JSON | Compatible | Keep and pin major 7 API |
| FastLED | `fastled/FastLED` | 3.10.3 | Future addressable status lighting | Compatible | Omit from v1 |

`ESP32Async` is the package organization, not another library. `ESPAsyncTCP` 2.0.0 and `RPAsyncTCP` 1.3.2 can appear as platform-gated transitive folders of ESPAsyncWebServer; they target ESP8266 and Raspberry Pi respectively and are not compiled for this environment. Only `esp32async/AsyncTCP` supplies the ESP32 transport.

The installed HX711 API provides `begin`, `is_ready`, `wait_ready`, `wait_ready_retry`, `wait_ready_timeout`, `read`, `read_average`, `tare`, offset/scale accessors, and power control. Production acquisition uses readiness polling plus `read()` to avoid blocking across multiple conversions.

## Physical acceptance gates

1. `esptool flash_id` reports ESP32-S3 and 8 MB flash.
2. Boot diagnostics report the expected chip and flash size and do not depend on PSRAM.
3. The programming USB connector provides reliable upload and 115200-baud CDC monitoring.
4. GPIO4-GPIO7 are physically exposed and do not conflict with the specific Shrike-Fi revision.
5. Both HX711 modules produce independent raw readings with one module disconnected.
