# Pourframe

Pourframe is a local-first dual-scale coffee weighing controller for the Vicharak Shrike-Fi (ESP32-S3). It reads two independent HX711 converters, serves a responsive web interface from LittleFS, provisions Wi-Fi through a captive portal, and publishes telemetry over WebSocket.

## Hardware

| Channel | HX711 DOUT | HX711 SCK |
| --- | ---: | ---: |
| Upper / dripper | GPIO4 | GPIO5 |
| Lower / carafe | GPIO6 | GPIO7 |

All Shrike-Fi GPIO is 3.3 V only. GPIO8-GPIO13 are reserved for the FPGA link and GPIO21 drives the normal active-high MCU LED. GPIO4-GPIO7 and the correct USB programming connector must be confirmed on the physical board before calibration.

### WS2812 RGB LED validation

The `hx711-validation` firmware drives one addressable WS2812 LED through GPIO0 while continuing to read both scales.

| WS2812 connection | Shrike-Fi connection |
| --- | --- |
| `5V` | `5V` header |
| `GND` | `GND` |
| `DI` / data in | GPIO0 through a 330-ohm series resistor |
| `DO` / data out | Leave disconnected for one LED |

The WS2812 and Shrike-Fi must share ground. The data direction matters: connect GPIO0 to `DI`, not `DO`. GPIO0 is an ESP32-S3 boot-strapping pin; if the board cannot boot or enter upload mode, disconnect the LED data wire during reset/upload or use a non-strapping GPIO such as GPIO14. For reliable 5 V operation, shift the ESP32-S3's 3.3 V data signal to 5 V with a 74AHCT125 or 74HCT14; many single LEDs work directly from 3.3 V data, but that is outside the guaranteed WS2812 input-high margin. Put a 100 uF or larger capacitor across the LED's `5V` and `GND` close to the LED. Never connect 5 V to a Shrike-Fi GPIO.

## Build

```powershell
npm.cmd --prefix web install
npm.cmd --prefix web run build
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e hx711-validation
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e shrike-fi
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e shrike-fi -t buildfs
```

Upload the validation environment first. Do not calibrate until both channels produce changing raw readings and continue operating independently when the other channel is disconnected.

## First connection

Without saved credentials, the controller starts an access point named `Pourframe-Setup-XXXX`. Connect to it, open the captive portal, and save the local Wi-Fi credentials. After joining the LAN, the device is available at `http://pourframe.local` when the client supports mDNS/Bonjour.

Calibration factors persist in NVS. Tare offsets intentionally reset after reboot.

The calibration protocol stores reference weights in grams. The web interface accepts either grams or kilograms and
converts kilograms to grams before sending the calibration command. After calibrating with the wrong unit, tare and
recalibrate that channel; the new factor replaces the previously stored factor.
