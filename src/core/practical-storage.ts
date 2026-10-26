import type { PracticalResult } from "./practical-types";
import { distribution } from "./measurements";
import { z } from "zod";
const KEY = "gaussmark.practical.v1";
const n = z.number().finite().nonnegative();
const format = z.enum(["ply", "sog", "ssog", "gpc", "sgpc", "synthetic"]);
const support = z.object({ supported: z.boolean(), reason: z.string() });
const metadata = z.object({
  splats: n.int().positive(),
  shDegree: n.int(),
  bounds: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  precision: z.string(),
  compression: z.string().optional(),
  verifiedBy: z.enum(["decoder", "user"]),
});
// Validate all values consumed by the report before rendering imported JSON.
const importedSchema = z.object({
  schema: z.literal("gaussmark.practical.v1"),
  localOnly: z.literal(true),
  id: z.string().min(1),
  createdAt: z.string(),
  renderer: z.string(),
  rendererVersion: z.string(),
  api: z.enum(["webgl2", "webgpu"]),
  device: z.object({
    browser: z.string(),
    os: z.string(),
    gpu: z.string(),
    devicePixelRatio: n.positive(),
  }),
  settings: z
    .object({
      repeats: n.int().positive(),
      warmupCycles: n.int(),
      frameTargetMs: n.positive(),
    })
    .passthrough(),
  capabilities: z.object({
    formats: z.array(format),
    api: z.enum(["webgl2", "webgpu"]),
    loading: z.enum(["whole-file", "progressive"]),
    byteRanges: support,
    spatialRegions: support,
    gpuTimestamps: support,
    unload: support,
    concurrentScenes: support,
    streaming: support,
    edits: z.array(z.string()),
    memory: z.object({
      application: z.string(),
      worker: z.string(),
      gpu: z.string(),
    }),
  }),
  variants: z
    .array(
      z.object({
        id: z.string(),
        identity: z.string(),
        name: z.string(),
        format,
        bytes: n,
        preReadBytes: n,
        preReadMs: n,
      }),
    )
    .min(1),
  comparisonGroup: z
    .object({
      id: z.string(),
      equivalent: z.enum(["undeclared", "user-declared"]),
      alignmentConfirmed: z.boolean(),
      intendedVariables: z.array(z.enum(["format", "renderer", "api"])),
    })
    .optional(),
  repeats: z.array(
    z.object({
      index: n.int(),
      variant: z.string(),
      status: z.enum(["complete", "failed", "cancelled", "unsupported"]),
      error: z.string().optional(),
      pipelineWarmState: z.string(),
      milestones: z.record(
        z.string(),
        z.object({
          ms: n.nullable(),
          criterion: z.string(),
          unavailable: z.string().optional(),
        }),
      ),
      stages: z.array(
        z
          .object({
            name: z.string(),
            startMs: n,
            endMs: n,
            kind: z.enum([
              "elapsed",
              "synchronous",
              "worker-elapsed",
              "gpu-completion-latency",
            ]),
          })
          .refine((s) => s.endMs >= s.startMs),
      ),
      delivery: z.object({
        label: z.enum(["direct local", "simulated delivery"]),
        deliveredBytes: n,
        cacheHitBytes: n,
        redundantBytes: n,
        cancellations: n.int(),
        firstByteMs: n.nullable(),
        ranges: z.array(
          z
            .object({
              start: n.int(),
              end: n.int(),
              requestedMs: n,
              endedMs: n.nullable(),
              delivered: n,
              cacheHitBytes: n,
              cancelled: z.boolean(),
            })
            .refine(
              (r) =>
                r.end >= r.start &&
                (r.endedMs === null || r.endedMs >= r.requestedMs),
            ),
        ),
      }),
      memory: z.array(
        z.object({
          atMs: n,
          checkpoint: z.string(),
          jsHeap: n.nullable(),
          application: n,
          worker: n,
          gpu: n,
          cache: n,
        }),
      ),
      frames: z.array(n.positive()),
      gpu: z.array(
        z.object({
          stage: z.string(),
          durationMs: n,
          method: z.enum(["webgpu-timestamp", "webgl2-disjoint-query"]),
        }),
      ),
      longTasks: z.array(
        z.object({ startMs: z.number().finite(), durationMs: n }),
      ),
      longTasksAvailable: z.boolean(),
      instrumentationMs: n,
      disposal: z
        .object({
          requestMs: n,
          completionMs: n.nullable(),
          criterion: z.string(),
        })
        .optional(),
      cancellation: z
        .object({
          requestedMs: n,
          settledMs: n,
          deliveredAfter: n,
          replacementReadyMs: n.nullable(),
          continuingWork: z.string(),
          orphanedResources: n.nullable(),
        })
        .optional(),
      metadata: metadata.optional(),
      path: z
        .object({
          format,
          decoder: z.string(),
          conversion: z.string(),
          representation: z.string(),
          native: z.boolean(),
          providerVersion: z.string().optional(),
        })
        .optional(),
      unavailable: z.record(z.string(), z.string()),
    }),
  ),
  unavailable: z.record(z.string(), z.string()),
  notes: z.array(z.string()),
});
export function parsePractical(text: string): PracticalResult {
  const r = JSON.parse(text) as PracticalResult;
  if (!importedSchema.safeParse(r).success)
    throw Error("Invalid or unsupported practical result schema");
  if (
    r?.schema !== "gaussmark.practical.v1" ||
    r.localOnly !== true ||
    !r.id ||
    !r.settings ||
    !r.capabilities ||
    !Array.isArray(r.variants) ||
    !Array.isArray(r.repeats) ||
    !r.repeats.every(
      (x) =>
        ["complete", "cancelled", "failed", "unsupported"].includes(x.status) &&
        Array.isArray(x.stages) &&
        x.stages.every(
          (s) =>
            Number.isFinite(s.startMs) &&
            Number.isFinite(s.endMs) &&
            s.endMs >= s.startMs,
        ) &&
        Array.isArray(x.memory) &&
        Array.isArray(x.frames) &&
        x.frames.every((n) => Number.isFinite(n) && n > 0) &&
        x.milestones &&
        x.delivery,
    )
  )
    throw Error("Invalid or unsupported practical result schema");
  return r;
}
export function readPractical(): PracticalResult[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(values)
      ? values.flatMap((v) => {
          try {
            return [parsePractical(JSON.stringify(v))];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}
export function savePractical(r: PracticalResult): boolean {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        [r, ...readPractical().filter((v) => v.id !== r.id)].slice(0, 10),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
export function practicalCsv(r: PracticalResult) {
  const quote = (v: unknown) => {
    const text = String(v ?? "");
    return `"${(/^[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  const rows: unknown[][] = [
    [
      "repeat",
      "variant",
      "status",
      "load_to_submission_ms",
      "frame_median_ms",
      "frame_p95_ms_min_100_samples",
      "delivered_bytes",
      "cache_hit_bytes",
      "redundant_bytes",
      "sampled_js_peak_bytes",
      "tracked_gpu_peak_bytes",
      "reason",
    ],
  ];
  for (const x of r.repeats) {
    const frames = distribution(x.frames),
      heap = x.memory.flatMap((m) => (m.jsHeap === null ? [] : [m.jsHeap]));
    const start = x.milestones["load-requested"]?.ms,
      end = x.milestones["first-submitted-frame"]?.ms;
    rows.push([
      x.index,
      x.variant,
      x.status,
      start != null && end != null ? end - start : null,
      frames?.median,
      frames?.p95,
      x.delivery.deliveredBytes,
      x.delivery.cacheHitBytes,
      x.delivery.redundantBytes,
      heap.length ? Math.max(...heap) : null,
      !r.capabilities.memory.gpu.startsWith("Unavailable") && x.memory.length
        ? Math.max(...x.memory.map((m) => m.gpu))
        : null,
      x.error,
    ]);
  }
  return rows.map((row) => row.map(quote).join(",")).join("\r\n");
}
export function downloadPractical(r: PracticalResult, kind: "json" | "csv") {
  const url = URL.createObjectURL(
    new Blob([kind === "json" ? JSON.stringify(r, null, 2) : practicalCsv(r)], {
      type: kind === "json" ? "application/json" : "text/csv",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `gaussmark-practical-${r.id}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
