import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

export function validateConfig(input) {
  const urls = [input.a, input.b].filter(Boolean);
  if (!urls.length || urls.length > 2) throw Error("Provide one or two links.");
  for (const link of urls) {
    const u = new URL(link);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw Error("Use HTTP(S) links without embedded user credentials.");
  }
  const repeats = Number(input.repeats ?? 3),
    seconds = Number(input.seconds ?? 15);
  if (
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    repeats > 10 ||
    !Number.isInteger(seconds) ||
    seconds < 5 ||
    seconds > 120
  )
    throw Error("Invalid run settings.");
  return {
    urls,
    repeats,
    seconds,
    cache: input.cache === "warm" ? "warm" : "cold",
  };
}
export function summarize(samples) {
  const values = samples.filter(Number.isFinite).sort((a, b) => a - b);
  return values.length
    ? {
        median: values[Math.floor(values.length / 2)],
        p95: values[Math.ceil(values.length * 0.95) - 1],
        count: values.length,
      }
    : null;
}
export function sanitizeEvents(events) {
  const allowed = new Set([
    "load-requested",
    "decode-start",
    "decode-end",
    "scene-attached",
    "first-scene-frame",
    "usable",
    "full-detail",
    "unload-start",
    "unload-end",
    "gpu-bytes",
    "cpu-buffer-bytes",
    "gpu-frame-ms",
    "splats",
  ]);
  return (Array.isArray(events) ? events : [])
    .slice(0, 10000)
    .filter(
      (e) =>
        e &&
        allowed.has(e.name) &&
        Number.isFinite(e.t) &&
        e.t >= 0 &&
        (e.value === undefined || (Number.isFinite(e.value) && e.value >= 0)),
    )
    .map((e) => ({
      name: e.name,
      t: e.t,
      ...(e.value === undefined ? {} : { value: e.value }),
    }));
}
// Runs in the viewer. Captures no URLs, headers, text, pixels or scene data.
export function installObserver() {
  const state = {
    frames: [],
    longTasks: [],
    events: [],
    hidden: false,
    resized: false,
  };
  let last;
  const frame = (t) => {
    if (last !== undefined && state.frames.length < 50000)
      state.frames.push(t - last);
    last = t;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) state.hidden = true;
  });
  addEventListener("resize", () => {
    state.resized = true;
  });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (state.longTasks.length < 5000)
          state.longTasks.push({ t: e.startTime, ms: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  const allowed = new Set([
    "load-requested",
    "decode-start",
    "decode-end",
    "scene-attached",
    "first-scene-frame",
    "usable",
    "full-detail",
    "unload-start",
    "unload-end",
    "gpu-bytes",
    "cpu-buffer-bytes",
    "gpu-frame-ms",
    "splats",
  ]);
  // Only fixed names and finite numeric values cross the reporting boundary.
  window.gaussmark = {
    protocol: "gaussmark.external.v1",
    mark(name, value) {
      if (
        allowed.has(name) &&
        state.events.length < 10000 &&
        (value === undefined ||
          (typeof value === "number" && Number.isFinite(value) && value >= 0))
      )
        state.events.push({
          name,
          t: performance.now(),
          ...(value === undefined ? {} : { value }),
        });
    },
  };
  window.__gaussmarkRead = () => ({
    ...state,
    frames: [...state.frames],
    events: [...state.events],
  });
}
export async function runSuite(config, state, options = {}) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: options.headless ?? false,
  });
  state.cancel = () => browser.close();
  const contexts = new Map();
  state.report = {
    schema: "gaussmark.external.v1",
    startedAt: new Date().toISOString(),
    browser: browser.version(),
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    cache: config.cache,
    seconds: config.seconds,
    repeats: config.repeats,
    attempts: [],
    notes: [
      "Whole-page network totals include editor assets and authentication traffic.",
      "CPU busy percent is sampled main-thread task time, not total system CPU.",
      "JS heap excludes native, worker and GPU memory; browser frame callbacks do not prove scene rendering.",
      "Cold uses fresh contexts with browser cache disabled; OS, CDN and driver caches are not cleared.",
      "Warm reuses a context per variant; its first run is unprimed.",
      "Scene readiness, decode, tracked GPU memory and unload require viewer instrumentation.",
      "No quality-equivalence or format-only performance claim is established.",
    ],
  };
  try {
    for (let cycle = 0; cycle < config.repeats; cycle++) {
      const order = config.urls.map((_, i) => i);
      if (cycle % 2) order.reverse();
      for (const variant of order) {
        const row = {
          variant: variant === 0 ? "A" : "B",
          cycle: cycle + 1,
          status: "running",
          samples: [],
          requests: [],
          events: [],
          unavailable: [
            "OS CPU / RSS",
            "Physical VRAM",
            "GPU upload execution time",
            "Scene quality equivalence",
            "Automated camera path",
          ],
        };
        state.report.attempts.push(row);
        let context = contexts.get(variant);
        if (!context || config.cache === "cold") {
          context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
            serviceWorkers: "block",
          });
          if (config.cache === "warm") contexts.set(variant, context);
        }
        const page = await context.newPage();
        await page.bringToFront();
        await page.addInitScript(installObserver);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Performance.enable");
        await cdp.send("Network.setCacheDisabled", {
          cacheDisabled: config.cache === "cold",
        });
        const requests = new Map();
        let start = performance.now(),
          previous;
        cdp.on("Network.requestWillBeSent", (e) => {
          const r = {
            id: row.requests.length + 1,
            startMs: performance.now() - start,
            type: e.type ?? "Other",
            bytes: 0,
            status: null,
            cached: false,
            failed: false,
          };
          if (row.requests.length < 10000) {
            requests.set(e.requestId, r);
            row.requests.push(r);
          }
        });
        cdp.on("Network.responseReceived", (e) => {
          const r = requests.get(e.requestId);
          if (r) {
            r.status = e.response.status;
            r.firstResponseMs = performance.now() - start;
            r.cached = !!(
              e.response.fromDiskCache || e.response.fromServiceWorker
            );
          }
        });
        cdp.on("Network.requestServedFromCache", (e) => {
          const r = requests.get(e.requestId);
          if (r) r.cached = true;
        });
        cdp.on("Network.loadingFinished", (e) => {
          const r = requests.get(e.requestId);
          if (r) {
            r.bytes = e.encodedDataLength;
            r.endMs = performance.now() - start;
          }
        });
        cdp.on("Network.loadingFailed", (e) => {
          const r = requests.get(e.requestId);
          if (r) {
            r.failed = true;
            r.endMs = performance.now() - start;
          }
        });
        let bytesWindow = 0;
        cdp.on("Network.dataReceived", (e) => {
          bytesWindow += e.encodedDataLength;
        });
        let sampling = true;
        const sampler = (async () => {
          while (sampling) {
            try {
              const m = Object.fromEntries(
                (await cdp.send("Performance.getMetrics")).metrics.map((x) => [
                  x.name,
                  x.value,
                ]),
              );
              const now = performance.now();
              row.samples.push({
                t: now - start,
                heapBytes: m.JSHeapUsedSize ?? null,
                cpuBusyPercent: previous
                  ? (100 * Math.max(0, m.TaskDuration - previous.task)) /
                    ((now - previous.t) / 1000)
                  : null,
                bytesPerSecond: previous
                  ? bytesWindow / ((now - previous.t) / 1000)
                  : null,
              });
              previous = { t: now, task: m.TaskDuration };
              bytesWindow = 0;
            } catch {
              break;
            }
            await new Promise((r) => setTimeout(r, 500));
          }
        })();
        try {
          const response = await page.goto(config.urls[variant], {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          row.navigationMs = performance.now() - start;
          if (response && response.status() >= 400) throw Error("HTTP failure");
          await page.waitForTimeout(config.seconds * 1000);
          const observed = await page.evaluate(() =>
            window.__gaussmarkRead?.(),
          );
          if (!observed) throw Error("Observation unavailable");
          row.events = sanitizeEvents(observed.events);
          row.frameIntervals = summarize(
            Array.isArray(observed.frames)
              ? observed.frames.slice(0, 50000)
              : [],
          );
          row.longTasks = (
            Array.isArray(observed.longTasks) ? observed.longTasks : []
          )
            .slice(0, 5000)
            .filter((e) => Number.isFinite(e.t) && Number.isFinite(e.ms))
            .map((e) => ({ t: e.t, ms: e.ms }));
          row.hidden = !!observed.hidden;
          row.resized = !!observed.resized;
          row.instrumented = row.events.length > 0;
          for (const [metric, names] of [
            ["Scene readiness", ["usable"]],
            ["Decode duration", ["decode-start", "decode-end"]],
            ["Tracked GPU allocations", ["gpu-bytes"]],
            ["Tracked CPU allocations", ["cpu-buffer-bytes"]],
            ["GPU frame timing", ["gpu-frame-ms"]],
          ]) {
            if (!names.every((name) => row.events.some((e) => e.name === name)))
              row.unavailable.push(metric);
          }
          const canUnload = await page.evaluate(
            () => typeof window.gaussmarkViewer?.unload === "function",
          );
          if (canUnload) {
            await Promise.race([
              page.evaluate(() => window.gaussmarkViewer.unload()),
              page.waitForTimeout(10000).then(() => {
                throw Error("Unload timeout");
              }),
            ]);
            await page.waitForTimeout(3000);
            row.events = sanitizeEvents(
              (await page.evaluate(() => window.__gaussmarkRead())).events,
            );
          } else
            row.unavailable.push(
              "Scene unload (closing page is not a scene-unload measurement)",
            );
          row.status =
            observed.hidden || observed.resized ? "invalid" : "complete";
        } catch {
          row.status = state.stopping ? "cancelled" : "failed";
          row.error =
            "Run interrupted or page failed; private error details omitted.";
        } finally {
          sampling = false;
          await sampler;
          row.transferredBytes = row.requests.reduce((s, r) => s + r.bytes, 0);
          row.peakHeapBytes = Math.max(
            0,
            ...row.samples.map((s) => s.heapBytes ?? 0),
          );
          await page.close().catch(() => {});
          if (config.cache === "cold") await context.close().catch(() => {});
        }
        if (state.stopping) return;
      }
    }
  } finally {
    await browser.close();
    state.running = false;
    state.cancel = undefined;
  }
}
export function startServer({
  port = 3027,
  token = randomBytes(24).toString("hex"),
  origins = [
    "http://127.0.0.1:3005",
    "http://127.0.0.1:3015",
    "http://127.0.0.1:3018",
  ],
} = {}) {
  const state = { running: false, report: null, stopping: false };
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(origins.includes(origin)
          ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
          : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (!origins.includes(origin) || req.headers.host !== "127.0.0.1:" + port)
      return send(403, { error: "Origin denied" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Private-Network": "true",
      });
      return res.end();
    }
    const auth = Buffer.from(req.headers.authorization ?? ""),
      expected = Buffer.from("Bearer " + token);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected))
      return send(403, { error: "Invalid pairing token" });
    if (req.method === "GET" && req.url === "/status")
      return send(200, {
        running: state.running,
        report: state.report,
        error: state.error,
      });
    if (req.method === "POST" && req.url === "/stop") {
      state.stopping = true;
      await state.cancel?.();
      return send(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/run") {
      if (state.running) return send(409, { error: "A run is active" });
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16384) throw Error("Request too large");
        }
        const config = validateConfig(JSON.parse(body));
        state.error = undefined;
        state.report = null;
        state.running = true;
        state.stopping = false;
        runSuite(config, state).catch(() => {
          state.running = false;
          state.error = "Browser runner failed";
        });
        return send(202, { ok: true });
      } catch {
        return send(400, { error: "Invalid links or settings" });
      }
    }
    return send(404, { error: "Not found" });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log("External Link runner: http://127.0.0.1:" + port);
    console.log("Pairing token: " + token);
  });
  return { server, state };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startServer();
