import { describe, it, expect } from "vitest";
import { submissionSchema } from "../../src/core/community";
import reference from "../../public/scenes/orbital-v1.json";
function record() {
  const stats = {
    count: 300,
    median: 16.7,
    p95: 18,
    p99: 19,
    mean: 16.7,
    variance: 1,
    min: 15,
    max: 20,
  };
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    benchmarkVersion: "0.1.0",
    methodology: "frame-interval-v1",
    renderer: "PlayCanvas",
    rendererVersion: "2.23.3",
    api: "webgl2",
    scene: {
      id: "orbital",
      version: "1",
      name: "Orbital study",
      format: "ply",
      source: "reference",
      sha256: reference.sha256,
      bytes: reference.bytes,
    },
    config: {
      motion: "orbit",
      durationSeconds: 5,
      warmupSeconds: 2,
      repeats: 1,
      width: 1000,
      height: 600,
      renderScale: 1,
    },
    device: {
      browser: "Chrome",
      os: "Windows",
      gpu: "Unavailable",
      devicePixelRatio: 1,
    },
    stats,
    repetitions: [stats],
    loading: {
      requestMs: 10,
      readMs: null,
      prepareMs: 20,
      firstFrameMs: 35,
      totalMs: 35,
      bytes: reference.bytes,
      gaussians: 47000,
      heapBefore: null,
      heapAfter: null,
    },
    analysis: "rust-wasm",
    valid: true,
  };
}
describe("community record integrity", () => {
  it("accepts a consistent compact record", () =>
    expect(submissionSchema.safeParse(record()).success).toBe(true));
  it("rejects raw samples and arbitrary additional data", () =>
    expect(
      submissionSchema.safeParse({
        ...record(),
        frames: [1, 2],
        email: "private@example.com",
      }).success,
    ).toBe(false));
  it("rejects incompatible methodology", () =>
    expect(
      submissionSchema.safeParse({ ...record(), methodology: "invented-v2" })
        .success,
    ).toBe(false));
  it("rejects inconsistent percentiles and repeat counts", () => {
    const r = record();
    r.stats.p95 = 1;
    expect(submissionSchema.safeParse(r).success).toBe(false);
    const s = record();
    s.config.repeats = 3;
    expect(submissionSchema.safeParse(s).success).toBe(false);
  });
  it("rejects invented network timing or private names for local scenes", () => {
    const r = record();
    r.scene = {
      ...r.scene,
      id: "custom",
      source: "local",
      name: "private-client-file.ply",
    };
    expect(submissionSchema.safeParse(r).success).toBe(false);
  });
  it("rejects impossible measurement duration", () => {
    const r = record();
    r.stats.count = 30;
    expect(submissionSchema.safeParse(r).success).toBe(false);
  });
  it("rejects nonfinite numbers and aborted sessions", () => {
    const r = record();
    r.stats.mean = NaN;
    expect(submissionSchema.safeParse(r).success).toBe(false);
    expect(
      submissionSchema.safeParse({ ...record(), valid: false }).success,
    ).toBe(false);
  });
});
