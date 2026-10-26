import { z } from "zod";
import type { BenchmarkResult } from "./types";
const finite = z.number().finite();
const stat = z
  .object({
    count: z.number().int().min(10).max(1000000),
    median: finite.positive().max(60000),
    p95: finite.positive().max(60000),
    p99: finite.positive().max(60000),
    mean: finite.positive().max(60000),
    variance: finite.nonnegative().max(3600000000),
    min: finite.positive().max(60000),
    max: finite.positive().max(60000),
  })
  .strict()
  .refine(
    (s) =>
      s.min <= s.median &&
      s.median <= s.p95 &&
      s.p95 <= s.p99 &&
      s.p99 <= s.max &&
      s.mean >= s.min &&
      s.mean <= s.max,
    "Inconsistent statistics",
  );
export const submissionSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    benchmarkVersion: z.literal("0.1.0"),
    methodology: z.literal("frame-interval-v1"),
    renderer: z.enum(["PlayCanvas", "WebSplatter"]),
    rendererVersion: z
      .string()
      .regex(/^(\d+\.\d+\.\d+|16bb06e-gaussmark\.1)$/)
      .max(30),
    api: z.enum(["webgl2", "webgpu"]),
    scene: z
      .object({
        id: z.enum(["orbital", "custom"]),
        version: z.string().max(20),
        name: z.string().max(80),
        format: z.enum(["ply", "sog"]),
        source: z.enum(["reference", "local"]),
        bytes: z.number().int().nonnegative().max(1073741824).optional(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    config: z
      .object({
        motion: z.enum(["stationary", "slow", "fast", "orbit"]),
        durationSeconds: z.number().int().min(5).max(30),
        warmupSeconds: z.literal(2),
        repeats: z.number().int().min(1).max(3),
        width: z.number().int().min(64).max(8192),
        height: z.number().int().min(64).max(8192),
        renderScale: z.number().min(0.25).max(2),
        cameraCoordinates: z.literal("object-centered").optional(),
        cameraPath: z
          .discriminatedUnion("mode", [
            z
              .object({
                mode: z.literal("orbit"),
                center: z.tuple([finite, finite, finite]),
                radius: finite.positive().max(1000000),
                height: finite,
                startAngle: finite,
              })
              .strict(),
            z
              .object({
                mode: z.literal("frozen"),
                eye: z.tuple([finite, finite, finite]),
                target: z.tuple([finite, finite, finite]),
                up: z.tuple([finite, finite, finite]),
              })
              .strict(),
          ])
          .optional(),
        objectTranslation: z
          .tuple([
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
          ])
          .optional(),
        objectRotation: z
          .tuple([
            finite.min(-180).max(180),
            finite.min(-180).max(180),
            finite.min(-180).max(180),
          ])
          .optional(),
      })
      .strict(),
    device: z
      .object({
        browser: z.enum(["Chrome", "Edge", "Firefox", "Safari", "Other"]),
        os: z.enum(["Windows", "macOS", "Linux", "Android", "iOS", "Other"]),
        gpu: z.string().min(1).max(200),
        devicePixelRatio: z.number().positive().max(10),
      })
      .strict(),
    stats: stat,
    repetitions: z.array(stat).min(1).max(3),
    loading: z
      .object({
        requestMs: finite.nonnegative().max(3600000).nullable(),
        readMs: finite.nonnegative().max(3600000).nullable(),
        prepareMs: finite.nonnegative().max(3600000),
        firstFrameMs: finite.nonnegative().max(3600000),
        totalMs: finite.nonnegative().max(3600000),
        bytes: z.number().int().positive().max(1073741824),
        gaussians: z.number().int().positive().max(100000000).nullable(),
        heapBefore: finite.nonnegative().nullable(),
        heapAfter: finite.nonnegative().nullable(),
      })
      .strict(),
    analysis: z.literal("rust-wasm"),
    valid: z.literal(true),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      s.renderer === "WebSplatter" &&
      (s.api !== "webgpu" ||
        s.scene.format !== "ply" ||
        s.rendererVersion !== "16bb06e-gaussmark.1")
    )
      issue("Unsupported WebSplatter configuration");
    if (
      s.renderer === "PlayCanvas" &&
      !/^\d+\.\d+\.\d+$/.test(s.rendererVersion)
    )
      issue("Invalid PlayCanvas version");
    if (
      s.repetitions.length !== s.config.repeats ||
      s.repetitions.reduce((n, r) => n + r.count, 0) !== s.stats.count
    )
      issue("Repeat/sample counts disagree");
    if (
      s.scene.source === "local" &&
      (s.scene.id !== "custom" ||
        s.scene.name !== "Local scene" ||
        s.loading.requestMs !== null ||
        s.scene.sha256)
    )
      issue("Local scene metadata must be anonymized");
    if (
      s.scene.source === "reference" &&
      (s.scene.id !== "orbital" ||
        s.scene.version !== "1" ||
        s.scene.format !== "ply" ||
        s.loading.readMs !== null)
    )
      issue("Unknown reference workload");
    for (const r of s.repetitions) {
      const elapsed = r.mean * r.count;
      if (
        elapsed < s.config.durationSeconds * 1000 * 0.85 ||
        elapsed > (s.config.durationSeconds + 10) * 1000
      )
        issue("Measurement duration is inconsistent");
    }
  });
export type CommunityRecord = z.infer<typeof submissionSchema> & {
  receivedAt?: string;
};
export function submissionPayload(r: BenchmarkResult): CommunityRecord {
  if ("localOnly" in r || "schema" in r)
    throw Error(
      "Practical suites are local-only; incompatible community schema.",
    );
  const { frames: _, invalidReason: __, ...rest } = r;
  // File hashes are used locally for A/B matching; keep custom hashes off the community API.
  return submissionSchema.parse({
    ...rest,
    scene: {
      ...rest.scene,
      name: rest.scene.source === "local" ? "Local scene" : rest.scene.name,
      sha256: rest.scene.source === "local" ? undefined : rest.scene.sha256,
    },
  });
}
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3015" : "");
export async function submitResult(r: BenchmarkResult) {
  const response = await fetch(`${API_BASE}/api/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submissionPayload(r)),
  });
  const data = (await response.json()) as { id?: string; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Submission failed");
  return data;
}
export async function getCommunity(params = new URLSearchParams()) {
  const response = await fetch(`${API_BASE}/api/results?${params}`);
  if (!response.ok)
    throw new Error(
      "Results API unavailable. Start the local Worker with npm run dev.",
    );
  return response.json() as Promise<{
    results: CommunityRecord[];
    total: number;
    configurations: number;
    renderers: number;
    scope: string;
  }>;
}
