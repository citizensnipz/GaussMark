# Practical benchmarks — local schema v1

## Run locally

From Git Bash in `/d/Personal/Projects/GaussMark`:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

Open `http://127.0.0.1:3015/benchmark/`, then **Practical suites**. This suspends and disposes the regular viewport so it does not compete with the suite. Closing the dialog restores the existing workspace. Select scene A and optionally scene B directly in the dialog. No hashing, header inspection, metadata preparation, or eager file read occurs on selection. The normal workspace's legacy file importer still hashes files; importing there can warm caches before selecting the same file in the suite.

Use the production export for performance work. Development/HMR and automated functional tests are not hardware performance evidence. To run browser regression tests against the production preview:

```sh
TEST_BASE_URL=http://127.0.0.1:3015 TEST_NO_SERVER=1 npm run test:e2e
npm run check:public
```

Select a preset and review its settings. **Website initial load** defaults to full renderer teardown. **Memory lifecycle** and **Scene switching and cancellation** default to scene unload and device reuse. Choose **50** load cycles for long trend checks. One cycle loads each selected variant once; A/B order alternates AB, BA. There are therefore 100 loads in a two-scene 50-cycle test. The BA/AB boundary deliberately includes same-variant repeats. A configured cancellation adds one extra attempt before the replacement load. Benchmarks are serial. Stop, tab hiding, viewport resize and device loss retain an inspectable failed/cancelled attempt rather than awarding a successful score.

**Website exploration**, **Editor interactions**, concurrent loading, and region tests are capability-gated. The current renderer integrations cannot perform these workloads and return unavailable reasons, not simulated scores. The navigation budget is recorded as a requested application budget, not enforced or claimed as browser VRAM. Optional `StreamingSession`, `RegionProvider` and `EditProvider` contracts describe future renderer integrations; they are not active implementations.

## Capability matrix

| Integration | API | Verified public input | Loading | Unload | GPU timing | Allocation coverage |
| --- | --- | --- | --- | --- | --- | --- |
| PlayCanvas 2.23.3 | Actual WebGL2 or WebGPU; fallback rejected | Gaussian PLY, SOG | Whole-file | Entity + asset unload; renderer/device retained | Engine WebGL2 disjoint queries or WebGPU timestamps when device supports them; deferred readback | Shared source buffers/cache; optional sampled JS heap. Engine CPU/GPU allocations unobservable |
| WebSplatter 16bb06e-gaussmark.1 | WebGPU | Binary little-endian Gaussian PLY | Whole-file | Scene buffers/query sets/listeners released; camera/device retained | Feature-detected WebGPU timestamps: cull, preprocess, sort span, render | Input worker transfer, returned CPU arrays, scene GPU buffers and camera buffer; excludes worker temporaries, canvas, pipelines and driver |
| External provider → WebSplatter | WebGPU | Only formats explicitly declared by an authorized local worker | Whole decoded scene | Worker terminates after decode/abort; scene resources unload | Same renderer instrumentation | Public decoded arrays and bridge allocations; private decoder internals unobservable |
| Public mock → WebSplatter | WebGPU | Synthetic attributes only, 512 splats | Whole decoded scene | Yes | Same renderer instrumentation | Same bridge accounting |

No built-in GPC/SGPC implementation or assets exist. **Requires external read-only provider**. SSOG support is unverified; its extension is not treated as SOG. No current integration supports region rendering, application-managed scene streaming, concurrent scene rendering, or per-splat edits. Scene-wide camera/object transforms are not editing benchmarks.

## Metric definitions

All attempt timestamps are milliseconds from that attempt's monotonic origin, including renderer initialization. Load-to-submission subtracts `load-requested` from `first-submitted-frame`. Initialization is a separate span, so comparisons can include it explicitly. Successful attempts and failures retain their raw data. Unavailable milestones use `ms: null` and a reason; zero is never a substitute for unavailable.

| Metric | Exact interpretation and limit |
| --- | --- |
| Load requested | Entry to adapter load after initialization and capability checks |
| First bytes | First complete byte-source chunk available, including an own-cache hit; not an HTTP first-byte measurement |
| Byte delivery | Wall time reading the complete source into a renderer input; external decoders may request ranges during their decode span |
| Parse/decode | WebSplatter worker task elapsed time, including startup, parsing and worker conversion. External decode includes worker startup/IPC and any overlapping delivery. PlayCanvas decode/packing/preparation are inseparable |
| Attribute conversion | External decoded attributes interleaved into public WebSplatter float32 storage. Position, opacity, covariance and all supported SH coefficients are retained. SH above degree 3 is rejected, not truncated |
| Upload submission | WebSplatter buffer/pipeline construction plus `queue.writeBuffer` submission synchronous wall time; no GPU execution-time claim |
| GPU preparation completion | `onSubmittedWorkDone` resolves after first-frame submission; includes queued work and first rendering. It is a completion **latency**, not an upload execution duration |
| First submitted frame | PlayCanvas frameend after scene attachment, or WebSplatter command-buffer submission. Neither proves visible splats |
| Visible scene / full readiness | Unavailable: no pixel verification or renderer convergence criterion is connected |
| Frame-response readiness | Default five consecutive post-load frame intervals ≤20 ms. Measures frame pacing after asset preparation; does not establish visible-content or input readiness |
| Frame intervals | Positive time differences between renderer callbacks, including spikes; distinct from GPU durations. p95/p99 require at least 100 samples in this suite |
| GPU duration | PlayCanvas engine-frame timings. WebGL rejects disjoint samples. WebGPU timing is feature detected. WebSplatter exports a deferred snapshot of up to the last 200 frames in its timestamp ring. Sort is a multi-pass GPU span; gaps are included. Missing samples never become zero duration |
| CPU work | Instrumented synchronous wall durations, worker elapsed durations, optional Long Tasks entries, frame stalls. Not CPU utilization, summed thread CPU time, or OS counters |
| Instrumentation time | Time spent in memory/frame callbacks only. Does not measure total instrumentation cost, query overhead, or an instrumentation-on/off baseline |
| Memory baseline / peak / steady | Optional Chromium JS-heap samples plus explicitly tracked buffers. Loading samples, steady checkpoint, pre-unload, unload-return and configured post-disposal checkpoint are retained. Maxima are **sampled** and short peaks may be missed |
| Application / worker bytes | Identity-based accounting of underlying buffers. Multiple views/shared references do not add allocations; transfers change owner. Source output buffers count while in flight. Cache bytes are separate. External worker input transfers are retained in accounting until termination: an upper bound if the private worker frees input earlier. Blob/browser copies and worker temporaries are unobservable |
| GPU bytes | Known `GPUBuffer.size` allocations, including camera and query readback buffers. Query-set internal storage, pipeline and driver allocations are unknown. Not physical VRAM residency |
| Disposal request | Wall time for unload/destroy calls to return. Completion remains unavailable: destruction does not prove driver memory was returned to the OS |
| Post-disposal slope | Least-squares bytes per load over tracked checkpoint totals, after the declared number of initial checkpoints. Requires ≥3 remaining checkpoints. An allocator cache or positive slope alone is not a proven leak |
| Cancellation | Abort requested/settled times and delivered bytes after abort. Replacement latency ends at first submission, not verified visible content. Zero delay cancels at stage entry; delayed cancellation may occur in a later stage, which the timeline exposes |
| Orphaned resources | Unknown for engine/driver internals. Explicit WebSplatter resources are destroyed and tracked balances retained. Submitted GPU work is not cancelled. PlayCanvas parser work may continue; a fresh renderer isolates replacement |
| Amplification | Ratios require known denominators in a consistent decoded representation. Current whole-file baselines have no verified region denominator; region amplification is unavailable |

Timeline spans can overlap (especially delivery within external decoding). Do not sum nested/overlapping spans. A span marked `incomplete` ends at the observation cutoff, not a verified operation completion; late callbacks cannot rewrite the finished timeline. Null delivery range ends mean a non-interruptible read was still pending when recorded. Replacement loads get a separate source when an old read is still pending, and its known in-flight bytes remain accounted for. CPU clocks do not provide GPU utilization percentages. No universal score is produced. Repeated-load summaries use median, IQR, min/max. Per-attempt frames, spans, memory samples, GPU durations, long tasks, capability reasons and settings are in JSON. CSV gives one row per attempt and leaves unavailable values empty. Failed/OOM/device-loss attempts remain failures. The UI saves local checkpoints before and after each attempt, outside load/observation timing; an abrupt browser crash retains an interrupted attempt if storage was available, without claiming an OOM cause. A 120-second attempt watchdog requests abort; an already-running synchronous browser/driver call cannot be forcibly interrupted by JavaScript. Cancellation settlement means the orchestrator stopped waiting, not proof all underlying GPU/Blob work ended.

Scene-switch peak is the maximum of consecutive raw memory samples across the declared unload-first sequence, including retained cache. There is no concurrent A+B peak because concurrent scenes are unsupported. A fresh teardown and reused renderer are different experiments. Pipeline warm state records device reuse, while driver shader cache state remains unknown.

## Delivery model

The Blob-backed source supports size, half-open `readRange(start,end,signal)`, and an async stream with backpressure. No reads occur before demand. Stream consumers request one chunk at a time. The renderer can still consume the whole file, and remains labelled whole-file.

Simulated mode imposes per-request latency, seeded deterministic jitter, a concurrency limit and one shared connection bandwidth budget. Active transfers share the budget; new requests receive no credit for earlier or idle time. Timer granularity and event-loop delays affect observed timing. A single complete-file read has one latency cost even when internally chunked. A provider issuing multiple ranges pays per-range latency. Cache hits bypass simulated delivery. Ranges, delivered bytes, cached bytes, overlapping redundant delivery and cancellation counts are recorded. Cancellation prevents a pending non-abortable Blob result from being delivered, but cannot undo an OS read.

The exact-range LRU can serve subranges contained in cached entries; it does not prefetch. Cache budgets are divided among selected variants, with a shared connection across all sources. Cold clears only those caches per attempt; warm retains them, with the first attempt initially empty. Neither clears OS disk caches, browser caches or shader caches. This model excludes DNS, TLS, HTTP, CDN behavior and real networking. Results are explicitly **simulated delivery**.

## Comparison and persistence

Legacy `frame-interval-v1` result storage, exports and same-file hash safeguards are preserved. Practical results use `gaussmark.practical.v1`, a separate local archive (10 suites). Filenames and random local file identities remain local. No full-file hash is computed by this suite. The same selected File retains identity across reruns; selecting it again gives a new local identity. A local comparison-group ID links runs across renderer/API choices.

Cross-format comparison requires a user declaration of source equivalence and alignment, declared intended variables, matching workload/camera/transforms/resolution/delivery/instrumentation/environment, complete attempts, and matching decoder-reported splat count/SH degree/bounds. Missing decoded metadata blocks normalized deltas. PlayCanvas reports count/SH/bounds from its loaded public resource when available; encoding precision/settings remain explicitly unknown. Metadata agreement is not proof of equivalent attributes or image quality. Arbitrary files remain descriptively inspectable. No winner is announced. Changing renderer as well as format measures the whole integration path; it cannot isolate format causality. Both variants need at least two complete load samples. Cancelled/failed attempts suppress normalized comparisons.

Optional image comparison, PSNR/SSIM and time-to-quality are not implemented. No progress percentage is presented as image quality.

The existing community API accepts only its legacy schema. Practical results are explicitly rejected before submission payload construction. No provider URLs, local paths, hashes, filenames, images, assets or new metrics enter community submissions. Existing legacy local filenames/hashes continue to be anonymized/removed, and explicit submission consent is preserved. Local JSON exports intentionally retain local scene names/identities; review them before sharing.

## Remaining provider-dependent work

See [external provider protocol](external-provider.md). Supplying an authorized provider enables whole-scene decode → public conversion → WebSplatter rendering only. Actual GPC/SGPC measurements require authorized implementations and real assets supplied locally; the public mock is not evidence about them. Verified SSOG decoding needs equivalent provider evidence. Region loading, memory-budgeted navigation, edits and concurrent rendering additionally need genuine renderer integration and visible-result criteria, not just a decoder method.

There are no encoders, writers, serializers, file generation, saving, re-encoding, or round-trip quality tests for private formats. No provider files are copied to the repository or public output. Generic artifact checks help find mistakes but cannot certify NDA compliance.
