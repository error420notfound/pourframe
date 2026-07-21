# Measurement pipeline

The production measurement path is split into two layers:

- `DualScaleReader` is the sole HX711 owner. Its pinned FreeRTOS task polls both DOUT pins, immediately reads ready channels, assembles bounded cadence-aware pairs, measures per-channel cadence and sample skew, and applies sensor commands.
- `MeasurementPipeline` is allocation-free ordinary C++. It performs median-of-3 filtering, calibration, optional matrix correction, per-channel time-aware EMA, 96-point filtered history, regression/ranges, state hysteresis, total conservation, health, and confidence.

The Arduino loop only copies the latest immutable snapshot. LED rendering, JSON serialization, Wi-Fi maintenance, and WebSocket transmission never run in the sensor task. Production telemetry remains protocol v1, retains the existing fields, adds measurement diagnostics, and publishes the latest snapshot every 125 ms without bucket averaging. Slow clients receive newer frames instead of a queued backlog.

Each channel updates only from a genuine HX711 sample using `alpha = 1 - exp(-dt / tau)` and `filtered += alpha * (measurement - filtered)`. Production uses `tau=0.25 s`; the configured `0.12 s` fast constant remains disabled until live pre-EMA innovation captures support trustworthy transition thresholds. Held peers never re-enter the EMA. Tare, calibration, reconnection, and gaps longer than 250 ms reset only the affected channel filter.

Pair tolerance is 60% of the slower measured channel period, bounded to 7.5-75 ms. Samples are read immediately into a pending assembler, so waiting for a peer never blocks acquisition. Telemetry distinguishes synchronized pairs, recent retained peers, unavailable channels, and repeated publications through pair status, pipeline sequence, telemetry sequence, and `new_snapshot`.

## Calibration and tare

The existing `upper_factor` and `lower_factor` Preferences keys are preserved. Key presence is now required: a missing, non-finite, or near-zero factor leaves the channel explicitly uncalibrated. Factors may be negative for reversed wiring. Tare offsets still reset after reboot.

Tare is applied on the next valid median sample. It resets both EMA streams, history, slopes, state dwell, stability, and confidence before acknowledging the command. Calibration captures approximately one second of median samples, requires at least eight, rejects excessive motion, persists a successful factor, and only then acknowledges completion.

Cross-talk correction defaults to the identity and disabled. `MeasurementPipeline::configureCrossTalk` rejects non-finite and singular matrices. Do not enable a matrix until held-out upper-only and lower-only captures show repeatable coupling and improved error without unacceptable noise amplification.

## Hardware rate validation

Build and upload `hx711-validation`. It continuously drains both converters and reports independent observed rates plus maximum paired-read skew every two seconds. Confirm whether each channel clusters near 8-12 Hz or 78-82 Hz before tuning or accepting responsiveness. RATE is hardware-controlled.

## CSV capture

`hx711-diagnostics` is a diagnostics-only environment at 921600 baud. It feeds the same processing library and copies full-rate snapshots to a bounded queue. Serial logging runs on a lower-priority task; when it falls behind, diagnostic frames are dropped and counted instead of blocking acquisition. Production also tracks each channel's cadence separately; an unrecognized rate or persistent 10 Hz/80 Hz mismatch forces the uncertain state.

Before a gram-domain capture, set the four `POURFRAME_DIAG_*` calibration values in `platformio.ini` and set `POURFRAME_DIAG_CALIBRATED=1`. With the default zero/one values and calibrated flag off, raw and timing fields remain useful but gram output is intentionally invalid.

Capture sequence:

1. Warm up both channels and confirm cadence with `hx711-validation`.
2. Manual tare, then capture unloaded data.
3. Capture several known weights on each stage across the working range.
4. Capture upper-only and lower-only loading for coupling analysis.
5. Capture placement, removal, pouring, drawdown, fan disturbance, spikes, dropout, and drift.
6. Fit scale linearity, replay the raw pairs, inspect residuals/state timelines, then accept factors and separately decide whether cross-talk correction is justified.

No production flash logging is added.

## Host tools

Build the deterministic tests and tools with a host compiler:

```sh
c++ -std=c++17 -Ilib/measurement lib/measurement/measurement_pipeline.cpp test/test_measurement/test_main.cpp -o measurement-tests
./measurement-tests

c++ -std=c++17 -Ilib/measurement lib/measurement/measurement_pipeline.cpp tools/measurement_replay.cpp -o measurement-replay
./measurement-replay input.csv enriched.csv upper_zero upper_factor lower_zero lower_factor

c++ -std=c++17 tools/calibration_fit.cpp -o calibration-fit
./calibration-fit known-weights.csv
```

Replay input columns are `timestamp_us,sequence,upper_raw,lower_raw,upper_valid,lower_valid,pair_skew_us,reserved`. The fitter input columns are `channel,known_grams,mean_raw`; it reports zero offset, counts per gram, RMS residual, and maximum residual for both stages.

## Physical release gates

Software builds and synthetic tests cannot establish HX711 RATE wiring, pair-skew distribution, load-cell overload limits, mechanical cross-talk, wind response, creep, temperature drift, or credible display resolution. Retain 0.1 g display precision only when repeated static placements and 30-second settled captures have no more than 0.2 g spread. Cross-talk remains disabled until controlled held-out tests show a stable, well-conditioned benefit.
