# Pourframe

Pourframe is a local-first dual-scale coffee weighing controller for the Vicharak Shrike-Fi (ESP32-S3). It reads two independent HX711 converters, serves a responsive web interface from LittleFS, provisions Wi-Fi through a captive portal, and publishes telemetry over WebSocket.

## Hardware

| Channel | HX711 DOUT | HX711 SCK |
| --- | ---: | ---: |
| Upper / dripper | GPIO4 | GPIO5 |
| Lower / carafe | GPIO6 | GPIO7 |

All Shrike-Fi GPIO is 3.3 V only. GPIO8-GPIO13 are reserved for the FPGA link and GPIO21 drives the normal active-high MCU LED. GPIO4-GPIO7 and the correct USB programming connector must be confirmed on the physical board before calibration.

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
