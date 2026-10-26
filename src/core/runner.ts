import { aggregate, loadWasm } from "./wasm";
import {
  BENCHMARK_VERSION,
  METHODOLOGY,
  type BenchmarkResult,
  type DeviceInfo,
  type LoadMetrics,
  type RendererAdapter,
  type RunConfig,
  type Scene,
  type Telemetry,
} from "./types";

export function detectDevice(gpu: string): DeviceInfo {
  const ua = navigator.userAgent;
  return {
    browser: /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other",
    os: /Windows/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Mac/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Other",
    gpu,
    devicePixelRatio: window.devicePixelRatio,
  };
}
// No React dependency. One subscription to renderer frame completion, UI <= 4 Hz.
export class BenchmarkRunner {
  private cancel?: () => void;
  stop() {
    this.cancel?.();
  }
  async run(
    adapter: RendererAdapter,
    scene: Scene,
    loading: LoadMetrics,
    config: RunConfig,
    onUpdate: (t: Telemetry) => void,
  ): Promise<BenchmarkResult> {
    if (this.cancel) throw new Error("A benchmark is already running.");
    await loadWasm();
    if (document.visibilityState === "hidden")
      throw new Error("Keep this tab visible during measurement.");
    adapter.setInteractive(false);
    const frames: number[][] = [];
    let lastUi = 0;
    let history: number[] = [];
    let invalidReason: string | undefined;
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        invalidReason = "Tab hidden during measurement";
        this.stop();
      }
    };
    const onResize = () => {
      invalidReason = "Viewport resized during measurement";
      this.stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("resize", onResize);
    try {
      for (let repeat = 0; repeat < config.repeats; repeat++) {
        adapter.setCamera(0, config.motion);
        const samples: number[] = [];
        await new Promise<void>((resolve, reject) => {
          let phase: "warmup" | "measuring" = "warmup",
            start = performance.now(),
            previous = 0;
          const cleanup = () => {
            off();
            clearTimeout(watchdog);
            this.cancel = undefined;
          };
          this.cancel = () => {
            cleanup();
            reject(
              new Error(
                invalidReason ?? "Benchmark stopped. No partial result saved.",
              ),
            );
          };
          const watchdog = setTimeout(
            () => {
              invalidReason = "Renderer stopped delivering frames";
              this.stop();
            },
            (config.warmupSeconds + config.durationSeconds + 15) * 1000,
          );
          const off = adapter.onFrame((now) => {
            let elapsed = (now - start) / 1000;
            if (phase === "warmup" && elapsed >= config.warmupSeconds) {
              phase = "measuring";
              start = now;
              elapsed = 0;
              previous = 0;
            }
            const dt = previous ? now - previous : 0;
            previous = now;
            if (dt > 0) {
              history.push(dt);
              if (history.length > 90) history.shift();
              if (phase === "measuring") samples.push(dt);
            }
            const progress =
              phase === "measuring"
                ? Math.min(1, elapsed / config.durationSeconds)
                : 0;
            adapter.setCamera(progress, config.motion);
            if (now - lastUi >= 250) {
              lastUi = now;
              onUpdate({
                phase,
                progress: (repeat + progress) / config.repeats,
                repeat: repeat + 1,
                fps: dt ? 1000 / dt : 0,
                frameMs: dt,
                history: [...history],
              });
            }
            if (phase === "measuring" && elapsed >= config.durationSeconds) {
              cleanup();
              resolve();
            }
          });
        });
        if (samples.length < 10)
          throw new Error("Too few rendered frames to produce a valid result.");
        frames.push(samples);
      }
      const repetitions = await Promise.all(frames.map(aggregate));
      const stats = await aggregate(frames.flat());
      const { url: _, ...metadata } = scene;
      // Custom filenames can contain personal information; do not persist them.
      const safeScene =
        scene.source === "local"
          ? {
              ...metadata,
              id: "custom",
              name: "Local scene",
              sha256: undefined,
            }
          : metadata;
      const result: BenchmarkResult = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        benchmarkVersion: BENCHMARK_VERSION,
        methodology: METHODOLOGY,
        renderer: adapter.name,
        rendererVersion: adapter.version,
        api: adapter.api,
        scene: safeScene,
        config,
        device: detectDevice(adapter.getGpu()),
        stats,
        repetitions,
        frames,
        loading,
        analysis: "rust-wasm",
        valid: true,
      };
      onUpdate({
        phase: "complete",
        progress: 1,
        repeat: config.repeats,
        fps: 1000 / stats.median,
        frameMs: stats.median,
        history,
      });
      return result;
    } finally {
      this.cancel = undefined;
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("resize", onResize);
      adapter.setInteractive(true);
    }
  }
}
