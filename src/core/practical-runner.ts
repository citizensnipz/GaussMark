import type { RendererAdapter, Scene } from "./types";
import type {
  ComparisonGroup,
  LoadContext,
  PracticalRepeat,
  PracticalResult,
  PracticalSettings,
} from "./practical-types";
import {
  LocalByteSource,
  SharedConnection,
  delay,
  abortable,
} from "./delivery";
import { AllocationLedger, Timeline, sampleMemory } from "./measurements";
import { detectDevice } from "./runner";
import type { ReadOnlyProvider } from "./provider";

export interface LocalVariant {
  id: string;
  identity: string;
  file: Blob;
  name: string;
  format: Scene["format"];
  preReadBytes: number;
  preReadMs: number;
}
export function counterbalancedOrder(variants: LocalVariant[], cycles: number) {
  return Array.from({ length: cycles }, (_, i) =>
    i % 2 ? [...variants].reverse() : [...variants],
  ).flat();
}
export function validateSettings(s: PracticalSettings) {
  for (const [key, min, max] of [
    ["repeats", 1, 50],
    ["width", 64, 8192],
    ["height", 64, 8192],
    ["observationMs", 100, 30000],
    ["sampleIntervalMs", 10, 1000],
    ["disposalWaitMs", 0, 10000],
    ["consecutiveFrames", 1, 120],
    ["warmupCycles", 0, 49],
    ["cancelDelayMs", 0, 60000],
    ["applicationBudgetBytes", 0, 2 ** 32],
  ] as const) {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max)
      throw Error(`Invalid ${key}`);
  }
  if (!Number.isFinite(s.frameTargetMs) || s.frameTargetMs <= 0)
    throw Error("Invalid frame target");
}
let running = false;
export async function runPractical(options: {
  variants: LocalVariant[];
  settings: PracticalSettings;
  provider?: ReadOnlyProvider;
  group?: ComparisonGroup;
  create: () => RendererAdapter;
  canvas: () => HTMLCanvasElement;
  signal: AbortSignal;
  progress: (text: string) => void;
  checkpoint?: (result: PracticalResult) => void;
}): Promise<PracticalResult> {
  if (running) throw Error("Benchmarks must run serially");
  validateSettings(options.settings);
  if (!options.variants.length) throw Error("Select a local scene");
  options.signal.throwIfAborted();
  const { settings: s, signal, variants } = options;
  let adapter: RendererAdapter | undefined;
  let offError = () => {};
  const control = new AbortController();
  const externalAbort = () => control.abort(signal.reason);
  const hidden = () => {
    if (document.visibilityState === "hidden")
      control.abort(Error("Tab hidden during measurement"));
  };
  const resized = () =>
    control.abort(Error("Viewport resized during measurement"));
  const connection = new SharedConnection(s.delivery.bytesPerSecond);
  const sources = variants.map(
    (v) =>
      new LocalByteSource(
        v.file,
        {
          ...s.delivery,
          cacheBytes: Math.floor(s.delivery.cacheBytes / variants.length),
        },
        connection,
      ),
  );
  const ledger = new AllocationLedger();
  const retiredSources: LocalByteSource[] = [];
  const first = options.create();
  adapter = first;
  const result: PracticalResult = {
    schema: "gaussmark.practical.v1",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    localOnly: true,
    renderer: first.name,
    rendererVersion: first.version,
    api: first.api,
    device: detectDevice("Unavailable"),
    capabilities: first.capabilities(),
    settings: structuredClone(s),
    variants: variants.map(({ file, ...v }) => ({ ...v, bytes: file.size })),
    comparisonGroup: options.group,
    repeats: [],
    unavailable: {
      "visible-content":
        "No pixel/renderer convergence signal verifies visible splats.",
      "full-scene-readiness":
        "Asset readiness does not verify full-quality visibility.",
      "total-cpu-utilization":
        "Browser timers expose elapsed durations, not CPU counters.",
      "physical-vram":
        "Allocation accounting is not residency or OS memory reclamation.",
      "time-to-quality": "No intermediate image comparisons were captured.",
    },
    notes: [
      "Local-only schema; never submitted to the community API.",
      "Whole-file consumption remains whole-file with chunked byte delivery.",
      "Simulator cache is application managed; its total budget is divided across variants. No OS/browser/driver cache eviction is claimed.",
      "Pipeline/driver shader caches may survive fresh renderer creation.",
      "Memory peaks are sampled and may miss short-lived allocations. Allocations cover registered resources only.",
      "First submitted frame and frame-response readiness do not prove visible content.",
      "Provider file details, error text and assets are not persisted. Selected external code is trusted code, not sandboxed by this interface.",
      "GPU timestamp readback is deferred; WebSplatter exports at most its final 200 frames. Readback occurs outside the observation window.",
      "Scene files are not hashed or inspected before this suite; any pre-reads explicitly listed were user/import preparation. They may warm disk caches.",
    ],
  };
  let cancellationPending = s.cancellation !== "none";
  let pendingCancelled: { row: PracticalRepeat; absolute: number } | undefined;
  let initialized = false;
  const order = counterbalancedOrder(variants, s.repeats);
  // Cancellation is an additional attempt followed by a complete replacement, even with one repeat.
  if (cancellationPending) order.unshift(order[0]);
  signal.addEventListener("abort", externalAbort, { once: true });
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("resize", resized);
  running = true;
  try {
    hidden();
    for (let i = 0; i < order.length; i++) {
      if (control.signal.aborted && result.repeats.length) break;
      const variant = order[i],
        sourceIndex = variants.indexOf(variant);
      let source = sources[sourceIndex];
      if (source.pending) {
        source.clearCache();
        retiredSources.push(source);
        source = sources[sourceIndex] = new LocalByteSource(
          variant.file,
          {
            ...s.delivery,
            cacheBytes: Math.floor(s.delivery.cacheBytes / variants.length),
          },
          connection,
        );
      }
      const timeline = new Timeline();
      const attempt = new AbortController();
      const stopAttempt = () => attempt.abort(control.signal.reason);
      control.signal.addEventListener("abort", stopAttempt, { once: true });
      if (control.signal.aborted) stopAttempt();
      if (s.cacheState === "cold")
        for (const source of sources) source.clearCache();
      source.resetStats();
      const row: PracticalRepeat = {
        index: i,
        variant: variant.id,
        status: "failed",
        pipelineWarmState: initialized
          ? "Reused renderer/device; shader cache state unknown"
          : "Fresh renderer/device; driver shader cache state unknown",
        milestones: timeline.milestones,
        stages: timeline.stages,
        delivery: source.stats,
        memory: [],
        frames: [],
        gpu: [],
        longTasks: [],
        longTasksAvailable: false,
        instrumentationMs: 0,
        unavailable: { ...result.unavailable },
      };
      result.repeats.push(row);
      row.error =
        "Attempt interrupted before completion; crash/OOM cause is unverified.";
      options.checkpoint?.(result);
      delete row.error;
      const sample = (checkpoint: string) => {
        const begin = performance.now();
        const m = sampleMemory(
          ledger,
          timeline.now(),
          checkpoint,
          sources.reduce((n, src) => n + src.cachedBytes, 0),
        );
        m.application += [...sources, ...retiredSources].reduce(
          (n, src) => n + src.inFlightBytes,
          0,
        );
        row.memory.push(m);
        row.instrumentationMs += performance.now() - begin;
      };
      sample("baseline");
      let interval: ReturnType<typeof setInterval> | undefined;
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      const watchdog = setTimeout(() => {
        control.abort(Error("Load attempt exceeded the 120-second watchdog"));
      }, 120000);
      let offFrame = () => {};
      let observer: PerformanceObserver | undefined;
      let cancellationBytes = 0,
        cancelledAt: number | undefined;
      const context: LoadContext = {
        source,
        timeline,
        allocations: ledger,
        provider: options.provider,
        configureScene: () => {
          adapter?.setObjectTranslation(s.objectTranslation);
          adapter?.setObjectRotation(s.objectRotation);
          adapter?.setCameraPath(s.cameraPath);
          adapter?.setCamera(0, "stationary");
        },
        onStage: (name) => {
          sample(`${name}-entry`);
          if (cancellationPending && name === s.cancellation) {
            cancellationPending = false;
            const cancel = () => {
              cancellationBytes = source.stats.deliveredBytes;
              cancelledAt = timeline.now();
              attempt.abort(
                new DOMException(
                  "Scheduled cancellation at " + name,
                  "AbortError",
                ),
              );
            };
            // Zero delay cancels at stage entry. Positive delay is wall time, with actual spans retained.
            if (s.cancelDelayMs === 0) cancel();
            else cancelTimer = setTimeout(cancel, s.cancelDelayMs);
          }
        },
      };
      let firstRead = true;
      source.onRequest = () => {
        if (firstRead) {
          firstRead = false;
          context.onStage?.("delivery");
        }
      };
      options.progress(
        `Load ${i + 1}/${order.length} · variant ${variant.id} · ${s.delivery.mode === "simulated" ? "simulated delivery" : "direct local"}`,
      );
      try {
        attempt.signal.throwIfAborted();
        if (!adapter) adapter = options.create();
        adapter.setInstrumentation?.(
          s.gpuTiming && adapter.name !== "PlayCanvas",
        );
        if (!initialized) {
          const end = timeline.begin("renderer initialization");
          try {
            await abortable(
              adapter.initialize(options.canvas()),
              attempt.signal,
            );
          } finally {
            end();
          }
          initialized = true;
          offError();
          offError = adapter.onError?.((e) => control.abort(e)) ?? (() => {});
        }
        result.capabilities = adapter.capabilities();
        result.device = detectDevice(adapter.getGpu());
        adapter.setInstrumentation?.(
          s.gpuTiming && adapter.name !== "PlayCanvas",
        );
        adapter.resize(s.width, s.height);
        adapter.setInteractive(false);
        adapter.setGridVisible(false);
        adapter.setGizmoVisible(false);
        if (
          s.swap === "concurrent" &&
          !result.capabilities.concurrentScenes.supported
        ) {
          row.status = "unsupported";
          row.error = result.capabilities.concurrentScenes.reason;
          continue;
        }
        if (
          s.preset === "Editor interactions" ||
          s.preset === "Website exploration"
        ) {
          row.status = "unsupported";
          row.error =
            s.preset === "Editor interactions"
              ? "No splat edit provider is connected. Camera/object controls are not splat edits."
              : result.capabilities.streaming.reason;
          row.unavailable[s.preset] = row.error;
          continue;
        }
        if (
          !result.capabilities.formats.includes(variant.format) &&
          !(
            options.provider &&
            adapter.name === "WebSplatter" &&
            options.provider.formats.includes(variant.format)
          )
        ) {
          row.status = "unsupported";
          row.error =
            variant.format === "ssog"
              ? "SSOG support is unverified. Requires external read-only provider."
              : "Requires external read-only provider and compatible renderer bridge.";
          continue;
        }
        for (const fraction of [1, 10, 25])
          row.unavailable[`region-${fraction}%`] =
            result.capabilities.spatialRegions.reason +
            " This load is a whole-file baseline.";
        row.unavailable["memory-budgeted-navigation"] =
          result.capabilities.streaming.reason;
        row.unavailable["editor-actions"] = "No splat edit provider connected.";
        if (!s.gpuTiming || !result.capabilities.gpuTimestamps.supported)
          row.unavailable["gpu-execution"] = !s.gpuTiming
            ? "GPU timing disabled"
            : result.capabilities.gpuTimestamps.reason;
        if (
          typeof PerformanceObserver !== "undefined" &&
          PerformanceObserver.supportedEntryTypes.includes("longtask")
        ) {
          observer = new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              row.longTasks.push({
                startMs: e.startTime - timeline.origin,
                durationMs: e.duration,
              });
          });
          observer.observe({ type: "longtask" });
          row.longTasksAvailable = true;
        }
        interval = setInterval(() => sample("sampled"), s.sampleIntervalMs);
        const scene: Scene = {
          id: variant.id,
          version: "local-practical-v1",
          name: "Local scene",
          format: variant.format,
          source: "local",
          url: "",
          bytes: variant.file.size,
        };
        timeline.mark(
          "load-requested",
          "Adapter load called; no file hash or metadata pre-read by this suite",
        );
        const loadEnd = timeline.begin(
          "adapter load (contains overlapping stages)",
        );
        try {
          await abortable(
            adapter.load(scene, attempt.signal, context),
            attempt.signal,
          );
        } finally {
          loadEnd();
        }
        row.metadata = context.metadata;
        row.path = context.path;
        attempt.signal.throwIfAborted();
        adapter.setObjectTranslation(s.objectTranslation);
        adapter.setObjectRotation(s.objectRotation);
        adapter.setCameraPath(s.cameraPath);
        adapter.setCamera(0, "stationary");
        sample("steady");
        // PlayCanvas reports engine frames; start a fresh profiler window after asset readiness.
        if (adapter.name === "PlayCanvas")
          adapter.setInstrumentation?.(s.gpuTiming);
        let previous = 0,
          consecutive = 0;
        offFrame = adapter.onFrame((now) => {
          const start = performance.now();
          if (previous) {
            const dt = now - previous;
            row.frames.push(dt);
            consecutive = dt <= s.frameTargetMs ? consecutive + 1 : 0;
            if (consecutive >= s.consecutiveFrames)
              timeline.mark(
                "frame-response-ready",
                `${s.consecutiveFrames} consecutive post-load frame intervals <= ${s.frameTargetMs} ms; no input or visibility guarantee`,
              );
          }
          previous = now;
          row.instrumentationMs += performance.now() - start;
        });
        await delay(s.observationMs, attempt.signal);
        offFrame();
        offFrame = () => {};
        const gpuReadEnd = timeline.begin(
          "deferred GPU query readback outside observation",
        );
        try {
          row.gpu = await abortable(
            adapter.gpuSamples?.() ?? Promise.resolve([]),
            attempt.signal,
          );
        } finally {
          gpuReadEnd();
        }
        attempt.signal.throwIfAborted();
        row.status = "complete";
        if (pendingCancelled) {
          const ready = row.milestones["first-submitted-frame"]?.ms;
          pendingCancelled.row.cancellation!.replacementReadyMs =
            ready == null
              ? null
              : timeline.origin + ready - pendingCancelled.absolute;
          pendingCancelled = undefined;
        }
      } catch (e) {
        row.status =
          attempt.signal.aborted && !control.signal.aborted
            ? "cancelled"
            : "failed";
        row.error =
          options.provider &&
          !options.provider.synthetic &&
          !attempt.signal.aborted
            ? "External provider/rendering failure; details omitted for privacy."
            : e instanceof Error
              ? e.message
              : "Benchmark failed";
        if (cancelledAt !== undefined) {
          row.cancellation = {
            requestedMs: cancelledAt,
            settledMs: timeline.now(),
            deliveredAfter: source.stats.deliveredBytes - cancellationBytes,
            replacementReadyMs: null,
            continuingWork:
              adapter?.name === "PlayCanvas"
                ? "Engine parsing/in-flight GPU work is unobservable and may continue. Renderer teardown isolates replacement."
                : "Decode worker terminated on abort; submitted GPU work cannot be cancelled.",
            orphanedResources: null,
          };
          pendingCancelled = { row, absolute: timeline.origin + cancelledAt };
        }
      } finally {
        source.onRequest = undefined;
        clearInterval(interval);
        clearTimeout(cancelTimer);
        clearTimeout(watchdog);
        offFrame();
        if (observer) {
          for (const e of observer.takeRecords())
            row.longTasks.push({
              startMs: e.startTime - timeline.origin,
              durationMs: e.duration,
            });
          observer.disconnect();
        }
        if (source.stats.firstByteMs !== null)
          row.milestones["first-bytes"] = {
            ms: source.startedAt - timeline.origin + source.stats.firstByteMs,
            criterion: "First byte-source chunk available; cache hits included",
          };
        timeline.unavailable(
          "frame-response-ready",
          "Post-load consecutive frame target",
          "Target not reached within observation window",
        );
        timeline.unavailable(
          "first-visible-content",
          "Verified scene pixels",
          "No visible-content signal",
        );
        timeline.unavailable(
          "full-scene-ready",
          "Full scene visible at intended quality",
          "No convergence signal",
        );
        timeline.unavailable(
          "gpu-upload-submitted",
          "Upload submission boundary",
          "Engine does not expose this boundary separately",
        );
        timeline.unavailable(
          "gpu-preparation-complete",
          "Observable submitted GPU work completion",
          "Unavailable on this integration",
        );
        sample("pre-unload");
        const disposalStart = performance.now();
        try {
          adapter?.setInstrumentation?.(false);
          await adapter?.unload();
          row.disposal = {
            requestMs: performance.now() - disposalStart,
            completionMs: null,
            criterion:
              "Scene destroy/unload calls returned; GPU/driver reclamation unobservable",
          };
          sample("unload-request-returned");
          if (s.rendererState === "fresh" || row.status !== "complete") {
            offError();
            offError = () => {};
            adapter?.dispose();
            adapter = undefined;
            initialized = false;
          }
          // Checkpoint is a declared wait, not a forced GC or a completion guarantee.
          await delay(s.disposalWaitMs, control.signal);
          sample("post-disposal-checkpoint");
        } catch (e) {
          if (!control.signal.aborted) {
            row.status = "failed";
            row.error =
              "Scene disposal failed; resource cleanup could not be verified.";
            row.unavailable["disposal"] = "Destroy/unload raised an error";
            try {
              adapter?.dispose();
            } catch {
              /* Retained failure is inspectable. */
            }
            adapter = undefined;
            initialized = false;
          }
          sample("post-disposal-interrupted");
        }
        control.signal.removeEventListener("abort", stopAttempt);
        timeline.close();
        if (source.pending)
          row.unavailable["delivery-completion"] =
            "A non-interruptible Blob read is still pending; null range ends mean unobserved completion.";
        row.delivery = structuredClone(source.stats);
        options.checkpoint?.(result);
      }
    }
    if (
      s.cancellation !== "none" &&
      !result.repeats.some((r) => r.cancellation)
    )
      result.unavailable["cancellation-stage"] =
        `Requested ${s.cancellation} cancellation did not fire in an observable attempt; cancellation was not measured.`;
    return result;
  } finally {
    offError();
    try {
      adapter?.dispose();
    } catch {
      const last = result.repeats.at(-1);
      if (last) {
        last.status = "failed";
        last.error = "Renderer teardown failed";
      }
    } finally {
      signal.removeEventListener("abort", externalAbort);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("resize", resized);
      running = false;
    }
  }
}
