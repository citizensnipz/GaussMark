# External Link benchmarks

Select **External Link** in the Benchmark renderer menu. Start
`npm run external:runner` in a separate terminal and paste its pairing token
into the dialog. Chrome must be installed. The runner binds only 127.0.0.1:3027
and accepts the local GaussMark origins on ports 3005, 3015 and 3018. Stop it
with Ctrl+C. This is a local runner, not a hosted URL-fetching service.

Provide A and optionally B links. The runner opens visible Chrome at 1280x800,
device scale 1, and alternates AB / BA serially. Leave that window foreground;
hidden or resized runs are invalid. Each observation lasts the configured
time after DOMContentLoaded. DOMContentLoaded is not scene readiness.
Use tokenized share links that work in a fresh context. Login-only links may
show a login page: browser observation completion does not certify scene load.
No existing browser profile, credentials, bypass or login automation is used.

Cold mode uses a fresh context and disables browser cache. Warm mode reuses
one context per variant, including its cookies and cache; first loads are
unprimed. Service workers are blocked for repeatability. Neither mode clears
OS/CDN/shader caches or measures an empty-editor baseline. Network totals cover
the whole page, not just scene files. Throughput measures received encoded
payload bytes per sampled second; it is not a connection capacity measurement.

CPU busy percent derives from CDP main-thread TaskDuration deltas. It excludes
worker/process CPU. JSHeapUsedSize is not total application memory. Network,
heap and task samples are approximately 500 ms apart; short peaks can be missed.
Frame intervals are requestAnimationFrame callbacks, not verified rendered
frames or GPU time. All viewer events are provider-reported. Timeline events
use the page's performance.now clock; runner samples use navigation-start
relative host time and must not be treated as exactly synchronized timestamps.

## Viewer contract v1

The runner injects `window.gaussmark` before page startup:
`{ protocol: "gaussmark.external.v1", mark(name, numericValue?) }`.
Only fixed event names and finite numeric values are exported:
load-requested, decode-start/end, scene-attached, first-scene-frame, usable,
full-detail, unload-start/end, gpu-bytes, cpu-buffer-bytes, gpu-frame-ms, splats.
GPU/CPU allocation counters are tracked bytes, not physical residency.
Expose `window.gaussmarkViewer.unload(): Promise<void>` only when safe local
scene disposal is implemented. The runner calls it after observation, then
samples three more seconds. Closing a page is never reported as scene unload.
Do not use this command to delete or save backend assets.

The private RealityStudio checkout has an opt-in hook for splat attachment,
first post-render submission, and local splat disposal. It must be built and
deployed separately before a hosted link emits these events. No editor or codec
source is bundled with GaussMark. Other links still receive browser metrics.

## Current limits

Automatic matched camera paths, explicit usable/full-detail criteria, decoder
stage hooks, OS process sampling, native VRAM, GPU queries, bandwidth shaping,
diagnostic tracing and normalized quality-equivalent comparisons are not yet
implemented. Capability gaps remain visible. Compare the individual A/B rows
and charts descriptively; no format winner is asserted. Use identical scene,
editor build, rendering settings and quality when interpreting results.

The report stays in runner/UI memory until explicitly exported as JSON. Inputs,
request URLs, headers, credentials, page titles, console output and scene pixels
are never included. No community submission is connected. Pairing tokens and
signed links are session secrets. The runner retains only its most recent
report and does not save browser profiles or traces.

Validation: `npm test`, `npm run typecheck`, and
`node scripts/test-external-runner.mjs` (real Chrome, public local fixture).
