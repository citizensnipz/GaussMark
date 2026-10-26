import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  runPractical,
  counterbalancedOrder,
  type LocalVariant,
} from "../../src/core/practical-runner";
import { directProfile, delay } from "../../src/core/delivery";
import {
  rendererCapabilities,
  type LoadContext,
  type PracticalSettings,
} from "../../src/core/practical-types";
import type { RendererAdapter, Scene } from "../../src/core/types";
const settings: PracticalSettings = {
  preset: "Website initial load",
  repeats: 2,
  rendererState: "reused",
  cacheState: "warm",
  delivery: directProfile,
  observationMs: 100,
  frameTargetMs: 20,
  consecutiveFrames: 2,
  disposalWaitMs: 0,
  sampleIntervalMs: 10,
  warmupCycles: 0,
  swap: "unload-first",
  cancellation: "none",
  cancelDelayMs: 0,
  gpuTiming: false,
  width: 640,
  height: 480,
  objectTranslation: [0, 0, 0],
  objectRotation: [0, 0, 0],
  applicationBudgetBytes: 1024,
};
const variants: LocalVariant[] = [
  {
    id: "A",
    identity: "a",
    file: new Blob([new Uint8Array(64)]),
    name: "public-synthetic-bytes",
    format: "ply",
    preReadBytes: 0,
    preReadMs: 0,
  },
];
beforeEach(() => {
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { devicePixelRatio: 1 }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function harness(fail = false) {
  const allocations = {},
    callbacks = new Set<(n: number) => void>();
  let context: LoadContext | undefined, timer: ReturnType<typeof setInterval>;
  const unload = vi.fn(() => {
    clearInterval(timer);
    context?.allocations.release(allocations);
  });
  const dispose = vi.fn(() => unload());
  const create = vi.fn(
    () =>
      ({
        name: "PlayCanvas",
        version: "test",
        api: "webgl2",
        initialize: vi.fn(async () => {}),
        capabilities: () => rendererCapabilities("PlayCanvas", "webgl2"),
        load: async (_: Scene, signal: AbortSignal, c: LoadContext) => {
          context = c;
          c.onStage?.("delivery");
          signal.throwIfAborted();
          await c.source.readRange(0, c.source.size, signal);
          c.allocations.track(allocations, 64, "gpu");
          c.onStage?.("decode");
          await delay(2, signal);
          if (fail) throw Error("Synthetic device loss");
          c.timeline.mark(
            "first-submitted-frame",
            "Test-only callback, not hardware evidence",
          );
          timer = setInterval(() => {
            for (const cb of callbacks) cb(performance.now());
          }, 5);
          return {};
        },
        onFrame: (cb: (n: number) => void) => {
          callbacks.add(cb);
          return () => callbacks.delete(cb);
        },
        getGpu: () => "test-only",
        unload,
        dispose,
        resize() {},
        setInteractive() {},
        setGridVisible() {},
        setGizmoVisible() {},
        setObjectTranslation() {},
        setObjectRotation() {},
        setCameraPath() {},
        setCamera() {},
      }) as unknown as RendererAdapter,
  );
  return { create, unload, dispose };
}
it("runs serial counterbalanced loads, reuses renderer and cleans tracked resources", async () => {
  const h = harness();
  const two = [...variants, { ...variants[0], id: "B", identity: "b" }];
  expect(counterbalancedOrder(two, 2).map((v) => v.id)).toEqual([
    "A",
    "B",
    "B",
    "A",
  ]);
  const r = await runPractical({
    variants: two,
    settings,
    ...h,
    canvas: () => ({}) as HTMLCanvasElement,
    signal: new AbortController().signal,
    progress() {},
  });
  expect(r.repeats.map((x) => x.variant)).toEqual(["A", "B", "B", "A"]);
  expect(r.repeats.every((x) => x.status === "complete")).toBe(true);
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(r.repeats.every((x) => x.memory.at(-1)?.gpu === 0)).toBe(true);
  expect(r.repeats[2].delivery.cacheHitBytes).toBe(64);
  expect(h.dispose).toHaveBeenCalledTimes(1);
});
it("retains a cancelled attempt and measures the replacement separately", async () => {
  const h = harness();
  const r = await runPractical({
    variants,
    settings: { ...settings, repeats: 1, cancellation: "decode" },
    ...h,
    canvas: () => ({}) as HTMLCanvasElement,
    signal: new AbortController().signal,
    progress() {},
  });
  expect(r.repeats.map((x) => x.status)).toEqual(["cancelled", "complete"]);
  expect(r.repeats[0].cancellation?.deliveredAfter).toBe(0);
  expect(r.repeats[0].cancellation?.replacementReadyMs).toBeGreaterThan(0);
  expect(r.repeats[0].memory.at(-1)?.gpu).toBe(0);
});
it("retains failures instead of turning them into successful measurements", async () => {
  const h = harness(true);
  const r = await runPractical({
    variants,
    settings,
    ...h,
    canvas: () => ({}) as HTMLCanvasElement,
    signal: new AbortController().signal,
    progress() {},
  });
  expect(r.repeats.every((x) => x.status === "failed")).toBe(true);
  expect(r.repeats[0].error).toBe("Synthetic device loss");
  expect(r.repeats[0].frames).toEqual([]);
  expect(r.repeats[0].memory.at(-1)?.gpu).toBe(0);
});
it("unsupported navigation has a reason and no fabricated readiness", async () => {
  const h = harness();
  const r = await runPractical({
    variants,
    settings: { ...settings, preset: "Website exploration", repeats: 1 },
    ...h,
    canvas: () => ({}) as HTMLCanvasElement,
    signal: new AbortController().signal,
    progress() {},
  });
  expect(r.repeats[0].status).toBe("unsupported");
  expect(r.repeats[0].error).toContain("Whole-scene");
  expect(r.repeats[0].milestones["frame-response-ready"].ms).toBeNull();
  expect(r.repeats[0].delivery.deliveredBytes).toBe(0);
});
