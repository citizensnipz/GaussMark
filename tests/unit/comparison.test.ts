import { describe, it, expect } from "vitest";
import { comparisonIssues } from "../../src/core/comparison";
import type { BenchmarkResult } from "../../src/core/types";
const run = (id: string): BenchmarkResult =>
  ({
    id,
    benchmarkVersion: "0.1.0",
    methodology: "frame-interval-v1",
    scene: { sha256: "a".repeat(64), format: "ply" },
    config: {
      motion: "orbit",
      durationSeconds: 5,
      warmupSeconds: 2,
      repeats: 1,
      width: 1000,
      height: 600,
      renderScale: 1,
    },
    device: { browser: "Chrome", os: "Windows", devicePixelRatio: 1 },
  }) as BenchmarkResult;
describe("A/B workload matching", () => {
  it("allows different renderers/APIs for the same workload", () => {
    const a = run("a"),
      b = run("b");
    a.renderer = "PlayCanvas";
    b.renderer = "WebSplatter";
    a.api = "webgl2";
    b.api = "webgpu";
    expect(comparisonIssues(a, b)).toEqual([]);
  });
  it("rejects unknown and different local file identities", () => {
    const a = run("a"),
      b = run("b");
    delete b.scene.sha256;
    expect(comparisonIssues(a, b).join()).toContain("identity is unknown");
    b.scene.sha256 = "b".repeat(64);
    expect(comparisonIssues(a, b)).toContain("Different scene files.");
  });
  it("flags size, duration, rotation and environment differences", () => {
    const a = run("a"),
      b = run("b");
    b.config.width = 800;
    b.config.durationSeconds = 10;
    b.config.objectRotation = [0, 45, 0];
    b.device.browser = "Firefox";
    expect(comparisonIssues(a, b)).toHaveLength(4);
  });
  it("treats older missing rotation as zero and prevents self comparison", () => {
    const a = run("a"),
      b = run("b");
    b.config.objectRotation = [0, 0, 0];
    expect(comparisonIssues(a, b)).toEqual([]);
    expect(comparisonIssues(a, a)).toContain("A and B are the same run.");
  });
});
