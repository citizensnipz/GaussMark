import { submissionSchema } from "../src/core/community";
import reference from "../public/scenes/orbital-v1.json";
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RATE_LIMIT_SALT?: string;
}
const localhost = (url: URL) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const origin = request.headers.get("Origin");
    const allowed =
      !origin ||
      origin === url.origin ||
      (localhost(url) &&
        /^http:\/\/(127\.0\.0\.1|localhost):3005$/.test(origin));
    if (!allowed) return json({ error: "Origin not allowed" }, 403);
    const cors: Record<string, string> = origin
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    try {
      if (url.pathname !== "/api/results")
        return json({ error: "Not found" }, 404, cors);
      if (request.method === "GET") {
        const parts = ["methodology = ?"],
          values: unknown[] = ["frame-interval-v1"];
        const mapping: Record<string, string> = {
          renderer: "renderer",
          api: "api",
          browser: "browser",
          scene: "scene_id",
          format: "format",
          source: "scene_source",
        };
        for (const [key, col] of Object.entries(mapping)) {
          const value = url.searchParams.get(key);
          if (value) {
            if (value.length > 40)
              return json({ error: "Invalid filter" }, 400, cors);
            parts.push(`${col} = ?`);
            values.push(value);
          }
        }
        const gpu = url.searchParams.get("gpu");
        if (gpu) {
          if (gpu.length > 100)
            return json({ error: "Invalid GPU filter" }, 400, cors);
          parts.push("gpu LIKE ? ESCAPE '\\'");
          values.push("%" + gpu.replace(/[\\%_]/g, "\\$&") + "%");
        }
        const days = url.searchParams.get("days");
        if (days) {
          if (!["7", "30", "90"].includes(days))
            return json({ error: "Invalid date range" }, 400, cors);
          parts.push("received_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now',?)");
          values.push(`-${days} days`);
        }
        const where = parts.join(" AND ");
        const [rows, summary] = await Promise.all([
          env.DB.prepare(
            `SELECT payload, received_at FROM results WHERE ${where} ORDER BY received_at DESC LIMIT 200`,
          )
            .bind(...values)
            .all<{ payload: string; received_at: string }>(),
          env.DB.prepare(
            `SELECT COUNT(*) total, COUNT(DISTINCT configuration) configurations, COUNT(DISTINCT renderer) renderers FROM results WHERE ${where}`,
          )
            .bind(...values)
            .first<{
              total: number;
              configurations: number;
              renderers: number;
            }>(),
        ]);
        return json(
          {
            results: rows.results.map((row) => ({
              ...JSON.parse(row.payload),
              receivedAt: row.received_at,
            })),
            ...summary,
            scope:
              "Latest 200 matching, self-reported submissions · frame-interval-v1",
          },
          200,
          cors,
        );
      }
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405, cors);
      if (!request.headers.get("Content-Type")?.startsWith("application/json"))
        return json({ error: "JSON required" }, 415, cors);
      if (!localhost(url) && !env.RATE_LIMIT_SALT)
        return json(
          { error: "Submission service is not configured" },
          503,
          cors,
        );
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Empty body" }, 400, cors);
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 32768) {
          await reader.cancel();
          return json({ error: "Payload exceeds 32 KB" }, 413, cors);
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json({ error: "Invalid JSON" }, 400, cors);
      }
      const parsed = submissionSchema.safeParse(body);
      if (!parsed.success)
        return json(
          {
            error: "Invalid benchmark record",
            details: parsed.error.issues.map((i) => i.message),
          },
          400,
          cors,
        );
      const data = parsed.data;
      if (
        data.scene.source === "reference" &&
        (data.scene.sha256 !== reference.sha256 ||
          data.loading.bytes !== reference.bytes ||
          data.loading.gaussians !== reference.gaussians)
      )
        return json({ error: "Reference scene identity mismatch" }, 400, cors);
      const now = Date.now(),
        hour = Math.floor(now / 3600000),
        ip = request.headers.get("CF-Connecting-IP") ?? "local";
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          `${env.RATE_LIMIT_SALT ?? "local-only"}:${hour}:${ip}`,
        ),
      );
      const key = Array.from(new Uint8Array(digest))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      await env.DB.prepare("DELETE FROM rate_limits WHERE expires < ?")
        .bind(now)
        .run();
      const limit = await env.DB.prepare(
        "INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
      )
        .bind(key, (hour + 1) * 3600000)
        .first<{ count: number }>();
      if (!limit || limit.count > 10)
        return json(
          { error: "Submission limit reached. Try again next hour." },
          429,
          {
            ...cors,
            "Retry-After": String(
              Math.ceil(((hour + 1) * 3600000 - now) / 1000),
            ),
          },
        );
      const configuration = JSON.stringify([
        data.benchmarkVersion,
        data.renderer,
        data.rendererVersion,
        data.api,
        data.scene.id,
        data.scene.version,
        data.scene.source,
        data.config,
        data.device,
      ]);
      const result = await env.DB.prepare(
        "INSERT OR IGNORE INTO results(id,methodology,benchmark_version,renderer,api,browser,gpu,scene_id,scene_version,scene_source,format,configuration,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          data.id,
          data.methodology,
          data.benchmarkVersion,
          data.renderer,
          data.api,
          data.device.browser,
          data.device.gpu,
          data.scene.id,
          data.scene.version,
          data.scene.source,
          data.scene.format,
          configuration,
          JSON.stringify(data),
        )
        .run();
      return json(
        { id: data.id, stored: result.meta.changes > 0 },
        result.meta.changes ? 201 : 200,
        cors,
      );
    } catch (error) {
      console.error(
        "Results API:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return json(
        { error: "Results database unavailable. Apply the D1 migrations." },
        503,
        cors,
      );
    }
  },
} satisfies ExportedHandler<Env>;
