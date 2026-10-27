"use client";
import { useEffect, useRef, useState } from "react";
import type { CameraPath, GraphicsApi } from "@/core/types";
import { directProfile } from "@/core/delivery";
import { distribution, memorySlope } from "@/core/measurements";
import { formatComparison } from "@/core/format-comparison";
import { runPractical, type LocalVariant } from "@/core/practical-runner";
import {
  LocalWorkerProvider,
  mockProvider,
  type ReadOnlyProvider,
} from "@/core/provider";
import {
  downloadPractical,
  parsePractical,
  readPractical,
  savePractical,
} from "@/core/practical-storage";
import {
  rendererCapabilities,
  type GaussianFormat,
  type PracticalResult,
  type PracticalSettings,
  type Preset,
} from "@/core/practical-types";
import { Modal, bytes, ms } from "./ui";

const presets: Preset[] = [
  "Website initial load",
  "Website exploration",
  "Scene switching and cancellation",
  "Editor interactions",
  "Memory lifecycle",
];
export function PracticalBenchmarks({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial: {
    renderer: string;
    api: GraphicsApi;
    width: number;
    height: number;
    cameraPath?: CameraPath;
    objectTranslation: [number, number, number];
    objectRotation: [number, number, number];
  };
}) {
  const [renderer, setRenderer] = useState(initial.renderer);
  const [api, setApi] = useState(initial.api);
  const [settings, setSettings] = useState<PracticalSettings>({
    preset: "Website initial load",
    repeats: 3,
    rendererState: "fresh",
    cacheState: "cold",
    delivery: { ...directProfile },
    observationMs: 2000,
    frameTargetMs: 20,
    consecutiveFrames: 5,
    disposalWaitMs: 250,
    sampleIntervalMs: 50,
    warmupCycles: 1,
    swap: "unload-first",
    cancellation: "none",
    cancelDelayMs: 5,
    gpuTiming: true,
    width: initial.width || 1024,
    height: initial.height || 640,
    cameraPath: initial.cameraPath,
    objectTranslation: initial.objectTranslation,
    objectRotation: initial.objectRotation,
    applicationBudgetBytes: 64 * 1024 * 1024,
  });
  const [variants, setVariants] = useState<LocalVariant[]>([]);
  const [providerKind, setProviderKind] = useState("none");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [result, setResult] = useState<PracticalResult>();
  const [history, setHistory] = useState<PracticalResult[]>([]),
    [equivalent, setEquivalent] = useState(false),
    [aligned, setAligned] = useState(false);
  const [groupId, setGroupId] = useState(""),
    [comparisonB, setComparisonB] = useState("");
  const [intended, setIntended] = useState<("format" | "renderer" | "api")[]>([
    "format",
  ]);
  const host = useRef<HTMLDivElement>(null),
    closeRequested = useRef(false),
    controller = useRef<AbortController | null>(null),
    provider = useRef<ReadOnlyProvider | undefined>(undefined);
  useEffect(() => {
    setHistory(readPractical());
    setGroupId(crypto.randomUUID());
    return () => {
      controller.current?.abort();
      provider.current?.dispose();
      provider.current = undefined;
    };
  }, []);
  const set = <K extends keyof PracticalSettings>(
    key: K,
    value: PracticalSettings[K],
  ) => setSettings((s) => ({ ...s, [key]: value }));
  function chooseFile(slot: number, file?: File) {
    if (!file) return;
    const format = file.name.split(".").pop()?.toLowerCase() as GaussianFormat;
    if (!["ply", "sog", "ssog", "gpc", "sgpc"].includes(format)) {
      setMessage(
        "Choose PLY, SOG, SSOG, GPC or SGPC. Extension alone does not establish support.",
      );
      return;
    }
    setVariants((v) => {
      const id = slot ? "B" : "A";
      const next = v.filter((x) => x.id !== id);
      next.push({
        id,
        identity: crypto.randomUUID(),
        file,
        name: file.name,
        format,
        preReadBytes: 0,
        preReadMs: 0,
      });
      return next.sort((a, b) => a.id.localeCompare(b.id));
    });
    setMessage(
      "File selected without hashing or decoding. Names and comparison identities remain local.",
    );
  }
  function synthetic() {
    provider.current?.dispose();
    provider.current = mockProvider();
    setProviderKind("synthetic");
    setRenderer("WebSplatter");
    setApi("webgpu");
    setVariants([
      {
        id: "A",
        identity: "public-synthetic-512-v1",
        file: new Blob([]),
        name: "Public synthetic attributes (512 splats)",
        format: "synthetic",
        preReadBytes: 0,
        preReadMs: 0,
      },
    ]);
    setMessage(
      "Mock integration only. No GPC/SGPC file is generated, decoded or benchmarked.",
    );
  }
  async function run() {
    if (busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setResult(undefined);
    setMessage("Initializing lifecycle suite…");
    try {
      const { PlayCanvasAdapter } = await import("@/renderers/playcanvas");
      const { WebSplatterAdapter } = await import("@/renderers/websplatter");
      const r = await runPractical({
        variants,
        settings,
        provider: provider.current,
        signal: abort.signal,
        group: {
          id: groupId,
          equivalent: equivalent ? "user-declared" : "undeclared",
          alignmentConfirmed: aligned,
          intendedVariables: intended,
        },
        progress: setMessage,
        checkpoint: (r) => {
          savePractical(r);
        },
        create: () =>
          renderer === "WebSplatter"
            ? new WebSplatterAdapter()
            : new PlayCanvasAdapter(api),
        canvas: () => {
          const c = document.createElement("canvas");
          c.setAttribute("aria-label", "Lifecycle benchmark canvas");
          c.width = settings.width;
          c.height = settings.height;
          host.current!.replaceChildren(c);
          return c;
        },
      });
      setResult(r);
      const saved = savePractical(r);
      setHistory(readPractical());
      setMessage(
        saved
          ? "Results saved locally, including unavailable and failed attempts."
          : "Local storage is full. Export JSON to retain this result.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Suite failed");
    } finally {
      setBusy(false);
      controller.current = null;
      if (closeRequested.current) onClose();
    }
  }
  const caps =
    result?.capabilities ??
    rendererCapabilities(
      renderer === "WebSplatter" ? "WebSplatter" : "PlayCanvas",
      api,
    );
  const compareTarget = history.find((r) => r.id === comparisonB);
  const comparison =
    result && (compareTarget || result.variants.length > 1)
      ? formatComparison(
          result,
          result.variants[0].id,
          compareTarget ?? result,
          compareTarget?.variants[0].id ?? result.variants[1].id,
        )
      : null;
  return (
    <Modal
      title="Practical benchmarks · local only"
      onClose={() => {
        if (busy) {
          closeRequested.current = true;
          controller.current?.abort(Error("Closed by user"));
        } else onClose();
      }}
    >
      <div className="practical-suite">
        <p>
          Repeated loading, responsiveness, memory and cancellation. Existing
          warmed-render results remain separate. New suites never submit to the
          community API.
        </p>
        <fieldset disabled={busy}>
          <div className="practical-grid">
            <label>
              Workflow preset
              <select
                value={settings.preset}
                onChange={(e) => {
                  const preset = e.target.value as Preset;
                  setSettings((s) => ({
                    ...s,
                    preset,
                    rendererState:
                      preset === "Website initial load" ? "fresh" : "reused",
                    cancellation:
                      preset === "Scene switching and cancellation"
                        ? "delivery"
                        : "none",
                  }));
                }}
              >
                {presets.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Suite renderer
              <select
                value={renderer}
                onChange={(e) => {
                  setRenderer(e.target.value);
                  if (e.target.value === "WebSplatter") setApi("webgpu");
                }}
              >
                <option>PlayCanvas</option>
                <option>WebSplatter</option>
              </select>
            </label>
            <label>
              Suite graphics API
              <select
                value={api}
                disabled={renderer === "WebSplatter"}
                onChange={(e) => setApi(e.target.value as GraphicsApi)}
              >
                <option value="webgl2">WebGL2</option>
                <option value="webgpu">WebGPU</option>
              </select>
            </label>
            <label>
              Load cycles
              <select
                value={settings.repeats}
                onChange={(e) => set("repeats", +e.target.value)}
              >
                {[1, 3, 5, 10, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {n === 50 ? " · memory trend preset" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scene A
              <input
                type="file"
                accept=".ply,.sog,.ssog,.gpc,.sgpc"
                onChange={(e) => {
                  chooseFile(0, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              Scene B (optional)
              <input
                type="file"
                accept=".ply,.sog,.ssog,.gpc,.sgpc"
                onChange={(e) => {
                  chooseFile(1, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label>
              Renderer lifecycle
              <select
                value={settings.rendererState}
                onChange={(e) =>
                  set("rendererState", e.target.value as "fresh" | "reused")
                }
              >
                <option value="fresh">Full teardown after each load</option>
                <option value="reused">Unload scene, reuse device</option>
              </select>
            </label>
            <label>
              Swap strategy
              <select
                value={settings.swap}
                onChange={(e) =>
                  set("swap", e.target.value as "unload-first" | "concurrent")
                }
              >
                <option value="unload-first">Unload A then load B</option>
                <option value="concurrent">
                  Load B while A renders (capability gated)
                </option>
              </select>
            </label>
          </div>
          <p>
            {variants.length
              ? variants
                  .map((v) => `${v.id}: ${v.name} (${v.format})`)
                  .join(" · ")
              : "Select local scene files. No eager read, hash, or decode occurs here."}
          </p>
          <button className="button" onClick={() => setVariants([])}>
            Clear scene choices
          </button>
          <details>
            <summary>Delivery, cancellation and instrumentation</summary>
            <div className="practical-grid">
              <label>
                Byte delivery
                <select
                  value={settings.delivery.mode}
                  onChange={(e) =>
                    set("delivery", {
                      ...settings.delivery,
                      mode: e.target.value as "direct" | "simulated",
                    })
                  }
                >
                  <option value="direct">Direct local reads</option>
                  <option value="simulated">Simulated delivery</option>
                </select>
              </label>
              <label>
                Simulator cache state
                <select
                  value={settings.cacheState}
                  onChange={(e) =>
                    set("cacheState", e.target.value as "cold" | "warm")
                  }
                >
                  <option value="cold">Clear own cache before each load</option>
                  <option value="warm">Retain own cache across loads</option>
                </select>
              </label>
              {(
                [
                  ["bytesPerSecond", "Shared bandwidth (bytes/s)"],
                  ["latencyMs", "Request latency (ms)"],
                  ["chunkBytes", "Chunk size (bytes)"],
                  ["concurrency", "Maximum concurrent reads"],
                  ["cacheBytes", "Total cache budget (bytes)"],
                  ["jitterMs", "Deterministic jitter ±ms"],
                  ["seed", "Jitter seed"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={
                      key === "bytesPerSecond" ||
                      key === "chunkBytes" ||
                      key === "concurrency"
                        ? 1
                        : 0
                    }
                    value={settings.delivery[key]}
                    onChange={(e) =>
                      set("delivery", {
                        ...settings.delivery,
                        [key]: +e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Cancellation target
                <select
                  value={settings.cancellation}
                  onChange={(e) =>
                    set(
                      "cancellation",
                      e.target.value as PracticalSettings["cancellation"],
                    )
                  }
                >
                  <option value="none">None</option>
                  <option value="delivery">Delivery</option>
                  <option value="decode">Decode</option>
                  <option value="gpu-preparation">
                    GPU preparation (WebSplatter)
                  </option>
                </select>
              </label>
              {(
                [
                  ["cancelDelayMs", "Cancel delay after stage entry (ms)"],
                  ["observationMs", "Post-load observation (ms)"],
                  ["frameTargetMs", "Frame response target (ms)"],
                  ["consecutiveFrames", "Consecutive frames for readiness"],
                  ["sampleIntervalMs", "Memory sampling interval (ms)"],
                  ["disposalWaitMs", "Post-disposal checkpoint wait (ms)"],
                  ["warmupCycles", "Discard initial checkpoints for slope"],
                  [
                    "applicationBudgetBytes",
                    "Navigation application budget (bytes)",
                  ],
                  ["width", "Target width (px)"],
                  ["height", "Target height (px)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min="0"
                    value={settings[key]}
                    onChange={(e) => set(key, +e.target.value)}
                  />
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={settings.gpuTiming}
                  onChange={(e) => set("gpuTiming", e.target.checked)}
                />{" "}
                GPU timestamps when available
              </label>
            </div>
            <p>
              Simulated delivery does not model DNS, TLS, HTTP/CDN, browser
              network caches or OS disk caches. “Warm” retains only this
              simulator’s cache; its first load is empty. Zero cancellation
              delay means stage entry; positive delays may fire after the target
              stage. Actual spans are exported.
            </p>
            <p>
              Saved camera path and object transforms are copied from the
              workspace. Whole-scene renderers cannot enforce streaming budgets.
              No driver shader-cache eviction is claimed.
            </p>
          </details>
          <details>
            <summary>
              External read-only provider · GPC / SGPC / unverified SSOG
            </summary>
            <p>
              Requires external read-only provider. Select only authorized,
              trusted, self-contained JavaScript outside this repository. It
              runs as a local worker; this interface is not a security sandbox.
              No provider code, paths or binaries are copied into the build or
              saved. The public bridge renders decoded attributes through
              WebSplatter, including SH through degree 3; this is converted
              rendering.
            </p>
            <label>
              Authorized local provider
              <input
                type="file"
                accept=".js,.mjs"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  provider.current?.dispose();
                  const p = new LocalWorkerProvider(f);
                  provider.current = p;
                  setProviderKind("connecting");
                  try {
                    await p.connect();
                    if (provider.current !== p) return;
                    setProviderKind(
                      `external read-only; declares ${p.formats.join(", ")}; ${p.execution === "local-service" ? "local Python service — transfer, process startup and file I/O included; server memory untracked" : "browser worker"}`,
                    );
                    setRenderer("WebSplatter");
                    setApi("webgpu");
                  } catch {
                    p.dispose();
                    if (provider.current === p) {
                      provider.current = undefined;
                      setProviderKind("none");
                      setMessage(
                        "Provider handshake failed. Requires an authorized gaussmark.readonly.v1 worker.",
                      );
                    }
                  }
                }}
              />
            </label>
            <p>Provider: {providerKind}</p>
            <div className="practical-actions">
              <button className="button" onClick={synthetic}>
                Use public synthetic mock
              </button>
              <button
                className="button"
                onClick={() => {
                  provider.current?.dispose();
                  provider.current = undefined;
                  setProviderKind("none");
                }}
              >
                Remove provider
              </button>
            </div>
          </details>
          <details>
            <summary>Local format comparison group</summary>
            <label>
              Group ID
              <input
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={equivalent}
                onChange={(e) => setEquivalent(e.target.checked)}
              />{" "}
              I declare these variants represent the same source scene
            </label>
            <label>
              <input
                type="checkbox"
                checked={aligned}
                onChange={(e) => setAligned(e.target.checked)}
              />{" "}
              Coordinates and bounds are aligned
            </label>
            <p>Intended comparison variables:</p>
            {(["format", "renderer", "api"] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={intended.includes(key)}
                  onChange={(e) =>
                    setIntended((v) =>
                      e.target.checked
                        ? [...v, key]
                        : v.filter((k) => k !== key),
                    )
                  }
                />{" "}
                {key}
              </label>
            ))}
            <p>
              Declarations are not verified equivalence. Normalized deltas also
              require matching decoded metadata, settings and environment.
              Legacy same-file A/B safeguards remain unchanged.
              Precision/compression metadata and native/converted paths appear
              in each repeat’s JSON.
            </p>
          </details>
        </fieldset>
        <div className="practical-actions">
          <button
            className="button primary"
            disabled={busy || !variants.length}
            onClick={run}
          >
            Run lifecycle suite
          </button>
          {busy && (
            <button
              className="button stop"
              onClick={() =>
                controller.current?.abort(Error("Stopped by user"))
              }
            >
              Stop lifecycle suite
            </button>
          )}
        </div>
        <p role="status">{message}</p>
        <div className="practical-canvas" ref={host} />
        <details>
          <summary>Renderer capability matrix</summary>
          <div className="practical-table">
            <table>
              <thead>
                <tr>
                  <th>Renderer / API</th>
                  <th>Verified native formats</th>
                  <th>Loading / unload</th>
                  <th>Dependent suites</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>PlayCanvas / WebGL2, WebGPU</td>
                  <td>PLY, SOG</td>
                  <td>Whole-file / scene unload</td>
                  <td>
                    Regions, streaming, edits, concurrent scenes unavailable
                  </td>
                </tr>
                <tr>
                  <td>WebSplatter / WebGPU</td>
                  <td>Binary Gaussian PLY</td>
                  <td>Whole-file / scene unload</td>
                  <td>
                    External decoded bridge; regions, streaming, edits
                    unavailable
                  </td>
                </tr>
                <tr>
                  <td>External provider → WebSplatter</td>
                  <td>
                    Provider-dependent; GPC/SGPC require authorization, SSOG
                    unverified
                  </td>
                  <td>Whole decoded scene / converted f32 + SH</td>
                  <td>Mock supports synthetic data only</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Current GPU timing: {caps.gpuTimestamps.reason}. Memory:{" "}
            {caps.memory.gpu}.
          </p>
        </details>
        {result && <PracticalReport result={result} />}
        {result && (
          <>
            <label>
              Compare with a saved local suite
              <select
                value={comparisonB}
                onChange={(e) => setComparisonB(e.target.value)}
              >
                <option value="">A/B within current suite</option>
                {history
                  .filter((r) => r.id !== result.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.createdAt} · {r.renderer} / {r.api}
                    </option>
                  ))}
              </select>
            </label>
            {comparison && (
              <div className="practical-comparison">
                <p>{comparison.evidence}</p>
                <p>
                  Intended variables:{" "}
                  {result.comparisonGroup?.intendedVariables.join(", ")}
                </p>
                {comparison.issues.length ? (
                  <>
                    <strong>
                      Descriptive comparison only; normalized delta unavailable
                    </strong>
                    <ul>
                      {comparison.issues.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>
                    B versus A load-to-submission median:{" "}
                    {comparison.deltaPercent?.toFixed(1)}%. This is an
                    end-to-end path comparison, not proof of a format-only
                    advantage.
                  </p>
                )}
              </div>
            )}
          </>
        )}
        <details>
          <summary>Local result archive and import</summary>
          <label>
            Import practical JSON
            <input
              type="file"
              accept=".json"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const r = parsePractical(await f.text());
                  setResult(r);
                  if (!savePractical(r))
                    throw Error(
                      "Storage full; result remains available for export",
                    );
                  setHistory(readPractical());
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "Import failed");
                }
              }}
            />
          </label>
          {history.map((r) => (
            <button
              className="button"
              key={r.id}
              disabled={busy}
              onClick={() => setResult(r)}
            >
              {r.createdAt} · {r.renderer} · {r.repeats.length} attempts
            </button>
          ))}
        </details>
      </div>
    </Modal>
  );
}

function PracticalReport({ result: r }: { result: PracticalResult }) {
  const complete = r.repeats.filter((x) => x.status === "complete");
  const loadValues = complete.flatMap((x) => {
    const start = x.milestones["load-requested"]?.ms,
      end = x.milestones["first-submitted-frame"]?.ms;
    return start != null && end != null ? [end - start] : [];
  });
  const loads = distribution(loadValues);
  const checkpoints = complete
    .map((x) =>
      x.memory.findLast((m) => m.checkpoint === "post-disposal-checkpoint"),
    )
    .filter((x) => x !== undefined);
  const slope = memorySlope(
    checkpoints.map((m) => m.application + m.worker + m.gpu),
    r.settings.warmupCycles,
  );
  return (
    <section className="practical-report" aria-label="Lifecycle results">
      <h3>
        Lifecycle results · {r.renderer} / {r.api}
      </h3>
      <p>
        {r.repeats.length} attempts · {complete.length} complete ·{" "}
        {r.repeats.length - complete.length} failed, cancelled or unavailable.
        No universal score.
      </p>
      <div className="practical-actions">
        <button className="button" onClick={() => downloadPractical(r, "json")}>
          Export lifecycle JSON
        </button>
        <button className="button" onClick={() => downloadPractical(r, "csv")}>
          Export lifecycle CSV
        </button>
      </div>
      <p>
        Descriptive pooled load-to-submission: {ms(loads?.median)} ms median ·{" "}
        {ms(loads?.iqr)} ms IQR · range {ms(loads?.min)}–{ms(loads?.max)} ms.
        Variants and warm states are retained per repeat; pooling is not a
        comparison score.
      </p>
      <p>
        Tracked post-disposal slope after {r.settings.warmupCycles} checkpoints:{" "}
        {slope === null
          ? "Unavailable (need 3 remaining checkpoints)"
          : `${slope.toFixed(0)} bytes/load`}
        . Retained allocations alone do not establish a leak.
      </p>
      <div className="practical-table">
        <table>
          <thead>
            <tr>
              <th>Attempt</th>
              <th>Status</th>
              <th>Delivered</th>
              <th>Cache hits</th>
              <th>Frame median / p95</th>
              <th>Deadline misses</th>
              <th>Tracked GPU peak</th>
            </tr>
          </thead>
          <tbody>
            {r.repeats.map((x) => {
              const f = distribution(x.frames);
              return (
                <tr key={x.index}>
                  <td>
                    {x.index + 1} · {x.variant}
                  </td>
                  <td>{x.status}</td>
                  <td>{bytes(x.delivery.deliveredBytes)}</td>
                  <td>{bytes(x.delivery.cacheHitBytes)}</td>
                  <td>
                    {ms(f?.median)} / {ms(f?.p95)} ms
                  </td>
                  <td>
                    {
                      x.frames.filter((v) => v > r.settings.frameTargetMs)
                        .length
                    }{" "}
                    / {x.frames.length}
                  </td>
                  <td>
                    {r.capabilities.memory.gpu.startsWith("Unavailable")
                      ? "Unavailable"
                      : bytes(Math.max(0, ...x.memory.map((m) => m.gpu)))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.repeats.map((x) => (
        <details key={x.index}>
          <summary>
            Attempt {x.index + 1} · {x.variant} · {x.status}
          </summary>
          {x.error && <p>{x.error}</p>}
          <p>{x.pipelineWarmState}</p>
          {x.path && (
            <p>
              {x.path.format} → {x.path.decoder} → {x.path.conversion} →{" "}
              {x.path.representation}.{" "}
              {x.path.native ? "Native public loader path" : "Converted path"}.
            </p>
          )}
          <div className="practical-table">
            <table>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Time from attempt start</th>
                  <th>Criterion / reason</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(x.milestones).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{ms(v.ms)} ms</td>
                    <td>{v.unavailable ?? v.criterion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>Span</th>
                  <th>Start–end (ms)</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {x.stages.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td>
                      {ms(s.startMs)}–{ms(s.endMs)}
                    </td>
                    <td>
                      {s.kind}
                      {s.incomplete ? " · incomplete at observation end" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Spans overlap and must not be added. Instrumentation callback time:{" "}
            {ms(x.instrumentationMs)} ms (partial overhead, not calibrated
            total). Long-task entries:{" "}
            {x.longTasksAvailable ? x.longTasks.length : "Unavailable"}. GPU
            duration samples: {x.gpu.length}; frame intervals are separate.
          </p>
          {x.cancellation && (
            <p>
              Cancellation settled after{" "}
              {ms(x.cancellation.settledMs - x.cancellation.requestedMs)} ms;{" "}
              {x.cancellation.deliveredAfter} bytes delivered after
              cancellation; replacement first submission after{" "}
              {ms(x.cancellation.replacementReadyMs)} ms.{" "}
              {x.cancellation.continuingWork} Orphaned resources: unobservable.
            </p>
          )}
          <ul>
            {Object.entries(x.unavailable).map(([k, v]) => (
              <li key={k}>
                {k}: {v}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
