# Measurement conventions — frame-interval-v1

The original warmed-frame methodology below is preserved. New local-only lifecycle suites use a separate schema and measurement protocol; see [Practical benchmarks](practical-benchmarks.md) for repeated loads, delivery simulation, GPU timestamps, allocation coverage, cancellation and cross-format comparison rules. Claims below about absent GPU timings apply to the legacy frame-interval report only.

## Lifecycle

1. Create a fresh renderer/device when the scene, renderer, API, render scale or locked target changes. The previous app, entity, asset, input listeners and observer are disposed. API changes also replace the canvas, because browser canvases cannot switch context families.
2. Fetch the full asset, then use PlayCanvas’s GSplat loader or the pinned WebSplatter PLY worker. Record request/read and combined decoding/preparation wall time. PlayCanvas load-to-frame ends at the next engine frame-end after attachment; WebSplatter waits for its first submitted render to finish. These loading boundaries and parsers differ; load metrics are descriptive, not equivalent cold-load benchmarks.
3. Initialize Rust/WASM and verify its median against `[1,2,3,4] → 2.5` before enabling Run.
4. Reset to the canonical scene origin and hold the starting camera for 2 seconds before each pass. Interactive pan/zoom never changes the measured path.
5. Measure positive differences between successive `performance.now()` values at PlayCanvas `frameend` or immediately after WebSplatter command submission. The first callback establishes a baseline and contributes no sample. Camera transforms for the following frame are set after that callback.
6. Continue through the first callback at or after the selected measured duration. Each pass therefore includes the final interval crossing the target boundary. Do not remove spikes or slow frames.
7. Repeat with the same starting camera and warm-up. UI progress updates at most four times a second; idle telemetry twice a second. No WASM work occurs per frame.
8. Aggregate each pass and the pooled intervals in Rust. Save only completed runs. Tab hiding, resizing, manual stop and renderer-frame timeout invalidate/cancel the run without a saved result. Configuration and telemetry-size controls are locked while running.

Fullscreen, render scale and CSS viewport size affect the render target; record the **actual pixel dimensions**, API, renderer version, scene version/hash, methodology and protocol. Render scale uses CSS pixels and a graphics-device pixel ratio of one, with the browser device pixel ratio recorded separately. Narrow aspect ratios pull the camera back to keep the scene in view; compare only matching dimensions.

## Statistics

For sorted intervals `x`, percentile `p` uses linear interpolation at `(n - 1) * p`. Variance is population variance (division by `n`). Median FPS is `1000 / median(interval_ms)`, not a mean of instantaneous FPS values. A stutter in the Motion panel is an interval strictly greater than 50 ms. The distribution bins are `[0,8.33)`, `[8.33,16.67)`, `[16.67,33.33)`, `[33.33,50)`, `[50,∞)` milliseconds; display labels are rounded.

Input must be finite, positive and nonempty. Rust returns an empty vector for invalid inputs, and TypeScript throws instead of creating fake statistics. Measured passes require at least ten samples.

Pooled distributions retain unequal sample counts. The previous-session reference delta requires identical scene hash, renderer version, API, protocol, dimensions, scale and reported device information. Explicit A/B comparisons intentionally allow different renderers and APIs, checking the same file hash, source/framing profile, protocol, dimensions, scale, object rotation, benchmark version and browser/OS/DPR instead. API differences are labelled and GPU identifiers are displayed for inspection. Different or unidentified workloads suppress percentage comparisons. Custom workloads are never considered matching references.

## Interpretation

Frame intervals include CPU scheduling, GPU work and browser/display pacing. VSync and background throttling strongly affect results. This does not measure GPU throughput in isolation; no timestamp-query GPU timings are reported. Automated test results are functional evidence, not hardware rankings. Production builds avoid HMR/dev overhead but do not remove browser noise.

Load time is measured once during scene initialization, not on every render repetition. HTTP request wall time includes reading the body and may use browser caches. Local Blob reads have **null network timing**. Decode and preparation are combined because the renderer does not expose a verified boundary. “Load to frame” and “first post-load frame” are submission events, **not verified first-splat visibility or full-quality readiness**. Splats may still be sorting when the first event arrives; warm-up precedes measurement.

Heap snapshots use Chromium's nonstandard `performance.memory` when present. They can be coarse and process-shared. Asset bytes describe source size, not GPU allocation. No total physical VRAM, system RAM, peak renderer allocation or retained-allocation metric is claimed.

## Spatial workload

The isolated math test uses WGS84 semi-major axis `6378137 m` and inverse flattening `298.257223563`, as defined by [NGA](https://earth-info.nga.mil/index.php?action=wgs84&dir=wgs84). Inputs are latitude/longitude in degrees and ellipsoidal height in metres; outputs are ECEF metres in Float64.

Analytic reference cases: equator at longitude zero, north pole, and longitude 90° with 100 m height. Maximum absolute component error must be ≤ `1e-6 m`. A deterministic 50,000-point batch is computed in Rust/WASM and TypeScript; every output component is compared at the same tolerance. One untimed warm-up precedes six timed batches, alternating implementation order. Report median wall time, including allocations and WASM copying. The reference cases verify a small subset of forward conversion, not a full geodetic validation suite.

## Community data

The API accepts only benchmark `0.1.0` and methodology `frame-interval-v1`, with structural and cross-field checks. Reference metadata must match the bundled hash/count/bytes. Server receipt timestamps control activity and date filters. These checks cannot prove a client actually ran the workload; all records remain explicitly self-reported.

No composite score, winner ranking, or mixed-configuration performance trend is calculated. Dashboard averages are descriptive, labelled as heterogeneous, and supported by inspectable records. The default view contains only standard reference scenes; custom data requires a separate selection.

## Object orientation

Rotation is recorded as XYZ Euler angles in degrees. Both adapters apply its inverse to the camera position, target and up vector about the same scene center. This is equivalent to rotating the Gaussian object, including the SH viewing direction, without re-uploading geometry. It affects the benchmark and must match across A/B runs. Inspection pan, zoom and fly position do not alter the automated path.
