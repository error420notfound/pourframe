# Pourframe

Pourframe is a local-first dual-scale coffee weighing controller for the Vicharak Shrike-Fi (ESP32-S3). It reads two independent HX711 converters, serves a responsive web interface from LittleFS, provisions Wi-Fi through a captive portal, and publishes telemetry over WebSocket.

The hosted application also provides shared recipes, guided brew preparation, acknowledged device tare/target setup, partial-scale and timer-only fallbacks, a live brewing timer, and completed brew summaries. All runtime assets and data stay on the local device; the application has no cloud or CDN dependency.

Measurement acquisition runs in a dedicated paired-reader task. A hardware-independent pipeline provides median spike rejection, calibration validity, slope/range history, stable/active/drawdown/uncertain states, a common time-normalized EMA, total conservation, health diagnostics, and confidence. See [the measurement pipeline guide](docs/measurement-pipeline.md) for capture, replay, calibration, and physical release gates.

## Hardware

| Channel | HX711 DOUT | HX711 SCK |
| --- | ---: | ---: |
| Upper / dripper | GPIO4 | GPIO5 |
| Lower / carafe | GPIO6 | GPIO7 |

All Shrike-Fi GPIO is 3.3 V only. GPIO8-GPIO13 are reserved for the FPGA link and GPIO21 drives the normal active-high MCU LED. GPIO4-GPIO7 and the correct USB programming connector must be confirmed on the physical board before calibration.

### WS2812 RGB LED validation

The `hx711-validation` firmware drives one addressable WS2812 LED through GPIO3 while continuing to read both scales.

| WS2812 connection | Shrike-Fi connection |
| --- | --- |
| `5V` | `5V` header |
| `GND` | `GND` |
| `DI` / data in | GPIO3 through a 300-330 ohm series resistor |
| `DO` / data out | Leave disconnected for one LED |

The WS2812 and Shrike-Fi must share ground. The data direction matters: connect GPIO3 to `DI`, not `DO`. GPIO3 is an ESP32-S3 strapping pin, so disconnect the LED data wire during reset/upload if it causes boot problems. For reliable 5 V operation, shift the ESP32-S3's 3.3 V data signal to 5 V with a 74AHCT125 or 74HCT14; many single LEDs work directly from 3.3 V data, but that is outside the guaranteed WS2812 input-high margin. Put a 100 uF or larger capacitor across the LED's `5V` and `GND` close to the LED. Never connect 5 V to a Shrike-Fi GPIO.

In the complete `shrike-fi` firmware, the LED follows the combined upper-plus-lower weight. It is solid green below 90% of the total target, flashes yellow faster as the total approaches its target, breathes red within +/-0.2 g, and pulses purple above that tolerance. If only one scale has a usable reading, that partial total continues to drive the LED and is clearly marked as partial in the web interface.

## Build

```powershell
npm.cmd --prefix web install
npm.cmd --prefix web run build
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e hx711-validation
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e hx711-diagnostics
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e shrike-fi
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e shrike-fi -t buildfs
```

Upload the validation environment first. Do not calibrate until both channels produce changing raw readings, report a measured 10 Hz or 80 Hz cadence, and continue operating independently when the other channel is disconnected.

## First connection

Without saved credentials, the controller starts an access point named `Pourframe-Setup-XXXX`. Connect to it, open the captive portal, and save the local Wi-Fi credentials. After joining the LAN, the device is available at `http://pourframe.local` when the client supports mDNS/Bonjour.

Calibration factors persist in NVS. Tare offsets intentionally reset after reboot.
Missing calibration keys no longer fall back to apparently valid grams: the UI reports that calibration is required. Tare and calibration acknowledgements are sent only after the sensor task applies or completes the operation.

The primary total target is configured in grams from the Total Weight section. Its five most recent unique values persist in NVS; the newest value is restored after reboot and the other four remain available as quick selections. On the first boot after upgrading from per-scale targets, active upper and lower targets are summed to seed the total target once. Clearing a target disables its evaluation without deleting its recent history.

Legacy upper and lower targets remain available under the collapsed advanced controls and through the version 1 WebSocket target commands. They are retained for compatibility and no longer control the status LED or total progress indicator.

The calibration protocol stores reference weights in grams. The web interface accepts either grams or kilograms and
converts kilograms to grams before sending the calibration command. After calibrating with the wrong unit, tare and
recalibrate that channel; the new factor replaces the previously stored factor.

## Shared recipes and brew history

Recipes and completed brew summaries are stored as bounded, revisioned JSON collections under `/user` in LittleFS. Writes use a temporary file and rename, duplicate brew IDs are idempotent, corrupt collections are quarantined with a `.corrupt` suffix, and the filesystem is never automatically formatted after a mount failure.

The versioned local API is:

- `GET /api/recipes`
- `POST /api/recipes` with `{ "v": 1, "base_revision": n, "recipe": { ... } }`
- `DELETE /api/recipes?id=...&base_revision=n`
- `GET /api/brews?limit=5`
- `POST /api/brews` with `{ "v": 1, "brew": { ... } }`
- `DELETE /api/brews?confirm=clear&base_revision=n`

The device stores at most 24 recipes and the five newest completed brews. Each completed device-assisted brew has a versioned, checksum-validated 10 Hz binary trace containing absolute upper/lower/combined measurements, virtual step-relative values, pour rate, step index, and health flags. Browser `localStorage` is reserved for interface preferences; IndexedDB contains a last-good cache and an outbox for a completion record and trace that could not immediately reach the ESP32.

Trace transfer is additive to the version 1 API:

- `PUT /api/brew-traces?id=<brew-id>` with the packed binary trace
- `GET /api/brew-traces?id=<brew-id>` to retrieve an available trace

The trace is uploaded idempotently before its summary is committed. Committing a sixth brew removes the oldest summary and matching trace together.

**Back up shared data before uploading a new filesystem image.** The selected single-LittleFS layout contains both the generated frontend and `/user`; `uploadfs` replaces that partition and can erase recipes and brew history. Normal firmware builds and OTA application updates do not perform an `uploadfs` operation.

## Guided brew safety

A healthy device-assisted brew can be prepared after both channels are fresh, calibrated, and synchronized and after both one-time tare commands and the total-water target receive successful WebSocket acknowledgements. Preparation then presents an explicit Start brew action; pressing it starts Bloom and the timer immediately. Timer-only fallback also starts immediately from its explicit action. Later pours retain their five-second audio and physical LED countdown. Synchronized moving readings may be captured as reduced-confidence virtual baselines, so measurement stability never controls when the timer starts. When preparation cannot be acknowledged, the application offers a separate timer-only start; it never silently starts a one-scale brew. Pour steps use virtual baselines and never modify hardware zero offsets. No brew path performs automatic zero tracking or hides stale, uncalibrated, partial, saturated, or disconnected telemetry.

The additive WebSocket v1 brew commands are `brew_step_cue`, `brew_step_cue_cancel`, `brew_step_activate`, and `brew_step_clear`. Cue IDs and transition IDs are idempotent for the current boot. The WS2812 cue is a non-blocking five-pulse neutral-white envelope; it aborts if measurement health degrades and immediately returns to the existing target color behavior.

Next planned product stages are coffee inventory, local profiles, detailed history and traces, import/export and backup, then advanced analytics.
