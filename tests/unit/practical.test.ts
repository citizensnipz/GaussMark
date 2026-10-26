import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AllocationLedger,
  Timeline,
  distribution,
  memorySlope,
  amplification,
} from "../../src/core/measurements";
import { mockProvider, validateAttributes } from "../../src/core/provider";
import { LocalByteSource, directProfile } from "../../src/core/delivery";
import {
  rendererCapabilities,
  type PracticalResult,
  type PracticalSettings,
} from "../../src/core/practical-types";
import {
  parsePractical,
  practicalCsv,
  readPractical,
  savePractical,
} from "../../src/core/practical-storage";
import { formatComparison } from "../../src/core/format-comparison";
import { submissionPayload } from "../../src/core/community";
import { readSessions } from "../../src/core/storage";
import type { BenchmarkResult } from "../../src/core/types";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
export function resultFixture(): PracticalResult {
  const metadata = {
    splats: 10,
    shDegree: 0,
    bounds: [0, 0, 0, 1, 1, 1] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    precision: "f32",
    verifiedBy: "decoder" as const,
  };
  return {
    schema: "gaussmark.practical.v1",
    id: "local-a",
    createdAt: "2026-10-27T00:00:00Z",
    localOnly: true,
    renderer: "WebSplatter",
    rendererVersion: "16bb06e-gaussmark.1",
    api: "webgpu",
    device: {
      browser: "Chrome",
      os: "Windows",
      gpu: "test",
      devicePixelRatio: 1,
    },
    capabilities: rendererCapabilities("WebSplatter", "webgpu"),
    settings: {
      repeats: 2,
      warmupCycles: 0,
      frameTargetMs: 20,
    } as PracticalSettings,
    variants: [
      {
        id: "A",
        name: "Private local filename",
        identity: "local-identity",
        bytes: 32,
        format: "ply",
        preReadBytes: 0,
        preReadMs: 0,
      },
    ],
    comparisonGroup: {
      id: "group",
      equivalent: "user-declared",
      alignmentConfirmed: true,
      intendedVariables: ["format"],
    },
    repeats: [0, 1].map((index) => ({
      index,
      variant: "A",
      status: "complete",
      pipelineWarmState: "unknown",
      milestones: {
        "load-requested": { ms: 10, criterion: "test" },
        "first-submitted-frame": { ms: 20, criterion: "test" },
      },
      stages: [],
      delivery: {
        label: "direct local",
        deliveredBytes: 32,
        cacheHitBytes: 0,
        redundantBytes: 0,
        cancellations: 0,
        firstByteMs: 1,
        ranges: [],
      },
      memory: [],
      frames: [16, 17],
      gpu: [],
      longTasks: [],
      longTasksAvailable: false,
      instrumentationMs: 0,
      metadata,
      unavailable: {},
    })),
    unavailable: {},
    notes: [],
  };
}
describe("honest lifecycle measurements", () => {
  it("keeps overlapping spans and idempotent milestones", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const t = new Timeline(),
      a = t.begin("decode");
    vi.advanceTimersByTime(10);
    const b = t.begin("prepare");
    vi.advanceTimersByTime(10);
    a();
    vi.advanceTimersByTime(10);
    b();
    b();
    expect(t.stages).toEqual([
      { name: "decode", startMs: 0, endMs: 20, kind: "elapsed" },
      { name: "prepare", startMs: 10, endMs: 30, kind: "elapsed" },
    ]);
    t.mark("frame", "submission only");
    vi.advanceTimersByTime(1);
    t.mark("frame", "no overwrite");
    expect(t.milestones.frame.ms).toBe(30);
    t.unavailable("visible", "pixels", "No signal");
    expect(t.milestones.visible.ms).toBeNull();
    const late = t.begin("unfinished work");
    vi.advanceTimersByTime(5);
    t.close();
    const snapshot = JSON.stringify(t.stages);
    vi.advanceTimersByTime(50);
    late();
    t.mark("stale-frame", "late callback");
    expect(JSON.stringify(t.stages)).toBe(snapshot);
    expect(t.stages.at(-1)?.incomplete).toBe(true);
    expect(t.milestones["stale-frame"]).toBeUndefined();
  });
  it("counts underlying buffers once and changes ownership on transfer", () => {
    const ledger = new AllocationLedger(),
      b = new ArrayBuffer(64);
    ledger.buffer(new Uint8Array(b, 0, 16));
    ledger.buffer(new Float32Array(b));
    expect(ledger.totals().application).toBe(64);
    ledger.transfer(b, "worker");
    expect(ledger.totals()).toEqual({ application: 0, worker: 64, gpu: 0 });
    const gpu = {};
    ledger.track(gpu, 100, "gpu");
    ledger.release(gpu);
    ledger.release(b);
    expect(ledger.count).toBe(0);
    const shared = new SharedArrayBuffer(32);
    ledger.buffer(shared);
    ledger.buffer(new Uint8Array(shared));
    expect(ledger.totals().application).toBe(32);
  });
  it("does not manufacture percentiles, amplification, or leak conclusions", () => {
    expect(distribution([10, 100])?.p95).toBeNull();
    expect(distribution(Array(100).fill(10))?.p95).toBe(10);
    expect(distribution([10, 100])?.max).toBe(100);
    expect(amplification(10, null)).toBeNull();
    expect(amplification(10, 0)).toBeNull();
    expect(memorySlope([100, 10, 20, 30], 1)).toBe(10);
    expect(memorySlope([1, 2], 0)).toBeNull();
  });
});
describe("external read-only boundary", () => {
  it("provides public synthetic attributes without decoding proprietary files", async () => {
    const p = mockProvider(),
      source = new LocalByteSource(new Blob([]));
    const a = await p.decode(source, "synthetic", new AbortController().signal);
    expect(validateAttributes(a).metadata.splats).toBe(512);
    expect(p.formats).toEqual(["synthetic"]);
    expect(source.stats.deliveredBytes).toBe(0);
    await expect(
      p.decode(source, "gpc", new AbortController().signal),
    ).rejects.toThrow("cannot decode");
    a.metadata.shDegree = 4;
    expect(() => validateAttributes(a)).toThrow("not silently truncated");
  });
  it("does not claim native support or infer SSOG support", () => {
    const pc = rendererCapabilities("PlayCanvas", "webgl2"),
      ws = rendererCapabilities("WebSplatter", "webgpu");
    expect(pc.formats).toEqual(["ply", "sog"]);
    expect(ws.formats).toEqual(["ply"]);
    for (const c of [pc, ws]) {
      expect(c.spatialRegions.supported).toBe(false);
      expect(c.streaming.reason).toBeTruthy();
      expect(c.edits).toEqual([]);
    }
  });
  it("rejects the full new schema before constructing any community payload", () => {
    expect(() =>
      submissionPayload(resultFixture() as unknown as BenchmarkResult),
    ).toThrow("local-only");
  });
});
describe("versioned local results and cross-format rules", () => {
  it("round-trips failures and raw spans while retaining old result readability", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k),
      setItem: (k: string, v: string) => data.set(k, v),
    });
    const r = resultFixture();
    r.repeats[0].status = "failed";
    r.repeats[0].error = "Device lost";
    expect(parsePractical(JSON.stringify(r))).toEqual(r);
    expect(savePractical(r)).toBe(true);
    expect(readPractical()[0]).toEqual(r);
    const old = {
      valid: true,
      methodology: "frame-interval-v1",
      stats: { count: 10, median: 10 },
      frames: [[10]],
      scene: {},
      config: {},
      device: {},
      loading: {},
    };
    data.set("gaussmark.sessions.v1", JSON.stringify([old]));
    expect(readSessions()).toEqual([old]);
    expect(practicalCsv(r)).toContain("Device lost");
    expect(() =>
      parsePractical(JSON.stringify({ ...r, schema: "future" })),
    ).toThrow();
  });
  it("gates normalized deltas on declaration, metadata, workload and environment", () => {
    const a = resultFixture(),
      b = structuredClone(a);
    b.id = "local-b";
    b.variants[0].format = "sog";
    b.variants[0].identity = "different";
    expect(formatComparison(a, "A", b, "A").issues).toEqual([]);
    b.repeats.forEach((r) => {
      r.milestones["first-submitted-frame"].ms = 30;
    });
    expect(formatComparison(a, "A", b, "A").deltaPercent).toBe(100);
    b.settings.delivery = directProfile;
    expect(formatComparison(a, "A", b, "A").deltaPercent).toBeNull();
    delete (b.settings as Partial<PracticalSettings>).delivery;
    b.repeats[0].metadata!.shDegree = 1;
    expect(formatComparison(a, "A", b, "A").issues.join()).toContain(
      "SH degrees",
    );
    b.device.gpu = "other GPU";
    expect(formatComparison(a, "A", b, "A").issues.join()).toContain(
      "environment",
    );
    a.comparisonGroup!.equivalent = "undeclared";
    expect(formatComparison(a, "A", b, "A").issues.join()).toContain("Declare");
  });
  it("keeps arbitrary files descriptive and refuses success scores for failed attempts", () => {
    const a = resultFixture(),
      b = structuredClone(a);
    b.id = "b";
    b.repeats[0].status = "failed";
    expect(formatComparison(a, "A", b, "A").deltaPercent).toBeNull();
    b.repeats[0].status = "complete";
    delete b.repeats[0].metadata;
    expect(formatComparison(a, "A", b, "A").issues.join()).toContain(
      "metadata unavailable",
    );
  });
});
