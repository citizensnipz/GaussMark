"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Box,
  Check,
  Cpu,
  Database,
  Download,
  Expand,
  Eye,
  Layers,
  LoaderCircle,
  Maximize,
  MemoryStick,
  Move3D,
  Orbit,
  Play,
  RotateCcw,
  Route,
  Settings2,
  Square,
  Upload,
  X,
} from "lucide-react";
import { BenchmarkRunner } from "@/core/runner";
import { loadWasm, spatialBenchmark } from "@/core/wasm";
import { readSessions, saveSession, downloadResult } from "@/core/storage";
import type {
  BenchmarkResult,
  CameraPath,
  Category,
  GraphicsApi,
  LoadMetrics,
  MotionMode,
  RendererAdapter,
  Scene,
  Telemetry,
} from "@/core/types";
import reference from "../../public/scenes/orbital-v1.json";
import { Footer, Header, Metric, bytes, ms } from "./ui";
import { FrameChart, Histogram } from "./charts";
import { Report } from "./report";
import { CameraPathEditor } from "./camera-path-editor";
import { SaveComparison } from "./comparison";
import { readComparison } from "@/core/comparison";
import type { Rotation } from "@/renderers/controls";
const SAMPLE: Scene = {
  id: reference.id,
  version: reference.version,
  name: reference.name,
  url: "/scenes/orbital-v1.ply",
  format: "ply",
  source: "reference",
  sha256: reference.sha256,
  bytes: reference.bytes,
};
const categories: { name: Category; icon: typeof Activity }[] = [
  { name: "Overview", icon: Layers },
  { name: "Streaming", icon: ArrowDownToLine },
  { name: "CPU", icon: Cpu },
  { name: "GPU", icon: Box },
  { name: "Memory", icon: MemoryStick },
  { name: "Motion", icon: Route },
  { name: "Spatial", icon: Move3D },
  { name: "Fidelity", icon: Eye },
];
const idle: Telemetry = {
  phase: "initializing",
  progress: 0,
  repeat: 0,
  fps: 0,
  frameMs: 0,
  history: [],
};
export function Workspace() {
  const [category, setCategory] = useState<Category>("Overview"),
    [api, setApi] = useState<GraphicsApi>("webgl2"),
    [scene, setScene] = useState<Scene>(SAMPLE),
    [scale, setScale] = useState(1),
    [motion, setMotion] = useState<MotionMode>("orbit"),
    [duration, setDuration] = useState(10),
    [repeats, setRepeats] = useState(3);
  const [telemetry, setTelemetry] = useState<Telemetry>(idle),
    [loading, setLoading] = useState<LoadMetrics | null>(null),
    [result, setResult] = useState<BenchmarkResult | null>(null),
    [report, setReport] = useState(false),
    [error, setError] = useState(""),
    [wasm, setWasm] = useState(false),
    [showTelemetry, setShowTelemetry] = useState(true),
    [drawer, setDrawer] = useState(false),
    [dimensions, setDimensions] = useState({ width: 0, height: 0 }),
    [spatial, setSpatial] = useState<Awaited<
      ReturnType<typeof spatialBenchmark>
    > | null>(null),
    [spatialBusy, setSpatialBusy] = useState(false),
    [runBusy, setRunBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    adapter = useRef<RendererAdapter | null>(null),
    runner = useRef(new BenchmarkRunner()),
    busyRef = useRef(false),
    mounted = useRef(true),
    [generation, setGeneration] = useState(0);
  const [renderer, setRenderer] = useState("PlayCanvas");
  const [gridVisible, setGridVisible] = useState(true);
  const [gizmoVisible, setGizmoVisible] = useState(true);
  const [cameraPath, setCameraPath] = useState<CameraPath>();
  const [rotation, setRotation] = useState<Rotation>([0, 0, 0]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [lockedTarget, setLockedTarget] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [comparisonMessage, setComparisonMessage] = useState("");
  const controlsRef = useRef({
    gizmoVisible,
    gridVisible,
    rotation,
    cameraPath,
  });
  controlsRef.current = { gizmoVisible, gridVisible, rotation, cameraPath };
  useEffect(() => {
    adapter.current?.setGridVisible(gridVisible);
    adapter.current?.setGizmoVisible(gizmoVisible);
    adapter.current?.setObjectRotation(rotation);
    adapter.current?.setCameraPath(cameraPath);
  }, [gizmoVisible, gridVisible, rotation, cameraPath]);
  function useBaseline() {
    const baseline = readComparison().A;
    if (!baseline) {
      setComparisonMessage("Save a completed run as A first.");
      return;
    }
    setCameraPath(baseline.config.cameraPath);
    setMotion(baseline.config.motion);
    setDuration(baseline.config.durationSeconds);
    setRepeats(baseline.config.repeats);
    setScale(baseline.config.renderScale);
    setRotation(baseline.config.objectRotation ?? [0, 0, 0]);
    setLockedTarget({
      width: baseline.config.width,
      height: baseline.config.height,
    });
    setComparisonMessage(
      scene.sha256 === baseline.scene.sha256
        ? "A’s settings applied. Choose your renderer and run B."
        : "A’s settings applied. Load the same scene file as A before running B.",
    );
  }
  const busy = runBusy || spatialBusy;
  busyRef.current = busy;
  useEffect(() => {
    mounted.current = true;
    loadWasm()
      .then(() => {
        if (mounted.current) setWasm(true);
      })
      .catch((e) => {
        if (mounted.current)
          setError(`WASM unavailable: ${e.message}. Run npm run build:wasm.`);
      });
    return () => {
      mounted.current = false;
      runner.current.stop();
    };
  }, []);
  useEffect(
    () => () => {
      if (scene.source === "local") URL.revokeObjectURL(scene.url);
    },
    [scene],
  );
  useEffect(() => {
    const controller = new AbortController();
    let current: RendererAdapter | undefined,
      off: () => void = () => {},
      offError: () => void = () => {},
      offRotation: () => void = () => {},
      offPath: () => void = () => {},
      observer: ResizeObserver | undefined;
    setTelemetry(idle);
    setLoading(null);
    setError("");
    setResult(null);
    (async () => {
      if (renderer === "WebSplatter") {
        const { WebSplatterAdapter } = await import("@/renderers/websplatter");
        if (controller.signal.aborted) return;
        current = new WebSplatterAdapter();
      } else {
        const { PlayCanvasAdapter } = await import("@/renderers/playcanvas");
        if (controller.signal.aborted) return;
        current = new PlayCanvasAdapter(api);
      }
      adapter.current = current;
      offError =
        current.onError?.((error) => {
          if (controller.signal.aborted) return;
          runner.current.stop();
          setLoading(null);
          setError(error.message);
          setTelemetry((t) => ({
            ...t,
            phase: "error",
            message: error.message,
          }));
        }) ?? (() => {});
      await current.initialize(canvas.current!);
      if (controller.signal.aborted) return;
      offRotation = current.onRotationChange(setRotation);
      offPath = current.onPathChange(setCameraPath);
      const resize = () => {
        const box = viewport.current?.getBoundingClientRect();
        if (!box || !current) return;
        const width =
            lockedTarget?.width ?? Math.max(64, Math.round(box.width * scale)),
          height =
            lockedTarget?.height ??
            Math.max(64, Math.round(box.height * scale));
        current.resize(width, height);
        setDimensions({ width, height });
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(viewport.current!);
      setTelemetry({ ...idle, phase: "loading" });
      const loaded = await current.load(scene, controller.signal);
      if (controller.signal.aborted) return;
      current.setGridVisible(controlsRef.current.gridVisible);
      current.setGizmoVisible(controlsRef.current.gizmoVisible);
      current.setObjectRotation(controlsRef.current.rotation);
      current.setCameraPath(controlsRef.current.cameraPath);
      setLoading(loaded);
      setTelemetry({ ...idle, phase: "ready" });
      let previous = 0,
        lastUi = 0;
      const history: number[] = [];
      off = current.onFrame((now) => {
        const dt = previous ? now - previous : 0;
        previous = now;
        if (dt > 0) {
          history.push(dt);
          if (history.length > 90) history.shift();
        }
        if (!busyRef.current && now - lastUi > 500) {
          lastUi = now;
          setTelemetry((t) => ({
            ...t,
            fps: dt ? 1000 / dt : 0,
            frameMs: dt,
            history: [...history],
          }));
        }
      });
    })().catch((e) => {
      if (!controller.signal.aborted) {
        current?.dispose();
        setError((e as Error).message);
        setTelemetry((t) => ({ ...t, phase: "error" }));
      }
    });
    return () => {
      controller.abort();
      runner.current.stop();
      off();
      offError();
      offRotation();
      offPath();
      observer?.disconnect();
      current?.dispose();
      if (adapter.current === current) adapter.current = null;
    };
  }, [api, renderer, scene, scale, generation, lockedTarget]);
  async function loadFile(f: File | undefined) {
    if (!f || busy) return;
    setError("");
    const extension = f.name.split(".").pop()?.toLowerCase();
    if (extension !== "ply" && extension !== "sog") {
      setError(
        "Choose a Gaussian .ply or .sog file. Mesh PLY files are not supported.",
      );
      return;
    }
    if (f.size > 256 * 1024 * 1024) {
      setError("This first build accepts local scenes up to 256 MiB.");
      return;
    }
    if (extension === "ply") {
      const header = await f.slice(0, 8192).text();
      if (
        !header.startsWith("ply") ||
        !header.includes("scale_0") ||
        !header.includes("f_dc_0")
      ) {
        setError(
          "This is not an uncompressed Gaussian PLY. Required Gaussian scale and colour properties are missing.",
        );
        return;
      }
    }
    const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    setRotation([0, 0, 0]);
    setCameraPath(undefined);
    setScene({
      sha256,
      id: "custom",
      version: "local",
      name: f.name,
      url: URL.createObjectURL(f),
      format: extension,
      source: "local",
      bytes: f.size,
    });
  }
  async function run() {
    if (!adapter.current || !loading || busy) return;
    setRunBusy(true);
    busyRef.current = true;
    setError("");
    setResult(null);
    try {
      const r = await runner.current.run(
        adapter.current,
        scene,
        loading,
        {
          motion,
          durationSeconds: duration,
          warmupSeconds: 2,
          repeats,
          ...dimensions,
          renderScale: scale,
          cameraCoordinates: "object-centered",
          objectRotation: rotation,
          ...(cameraPath ? { cameraPath } : {}),
        },
        (t) => {
          if (mounted.current) setTelemetry(t);
        },
      );
      if (mounted.current) {
        setResult(r);
        if (!saveSession(r))
          setError(
            "Result complete, but browser storage is full. Export this session to keep it.",
          );
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setTelemetry((t) => ({ ...t, phase: "stopped", progress: 0 }));
      }
    } finally {
      if (mounted.current) setRunBusy(false);
      busyRef.current = false;
    }
  }
  async function runSpatial() {
    setSpatialBusy(true);
    busyRef.current = true;
    setError("");
    try {
      setSpatial(await spatialBenchmark());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpatialBusy(false);
      busyRef.current = false;
    }
  }
  const status =
    telemetry.phase === "ready"
      ? "Scene ready"
      : telemetry.phase === "complete"
        ? "Run complete"
        : telemetry.phase;
  const frames = useMemo(() => result?.frames.flat() ?? [], [result]),
    stutters = frames.filter((v) => v > 50).length;
  const previous = useMemo(
    () =>
      result
        ? readSessions().find(
            (r) =>
              r.id !== result.id &&
              r.scene.sha256 === result.scene.sha256 &&
              r.scene.source === "reference" &&
              r.methodology === result.methodology &&
              r.rendererVersion === result.rendererVersion &&
              r.api === result.api &&
              JSON.stringify(r.config) === JSON.stringify(result.config) &&
              JSON.stringify(r.device) === JSON.stringify(result.device),
          )
        : undefined,
    [result],
  );
  return (
    <div className="application workspace">
      <Header active="Benchmark" />
      <div className="work-toolbar">
        <div className="toolbar-field">
          <span>RENDERER</span>
          <select
            aria-label="Renderer"
            disabled={busy}
            value={renderer}
            onChange={(e) => {
              setRenderer(e.target.value);
              if (e.target.value === "WebSplatter") setApi("webgpu");
            }}
          >
            <option>PlayCanvas</option>
            <option>WebSplatter</option>
          </select>
        </div>
        <div className="toolbar-field">
          <span>GRAPHICS API</span>
          <select
            aria-label="Graphics API"
            disabled={busy || renderer === "WebSplatter"}
            value={api}
            onChange={(e) => setApi(e.target.value as GraphicsApi)}
          >
            <option value="webgl2">WebGL2</option>
            <option value="webgpu">WebGPU</option>
          </select>
        </div>
        <div className="toolbar-field scene-field">
          <span>SCENE</span>
          <select
            aria-label="Scene"
            disabled={busy}
            value={scene.source === "reference" ? "reference" : "local"}
            onChange={(e) => {
              if (e.target.value === "reference") {
                setCameraPath(undefined);
                setScene(SAMPLE);
              }
            }}
          >
            <option value="reference">Orbital study · reference v1</option>
            {scene.source === "local" && (
              <option value="local">{scene.name}</option>
            )}
          </select>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          title="Load local scene"
          aria-label="Load local scene"
          onClick={() => file.current?.click()}
        >
          <Upload size={17} />
        </button>
        <input
          ref={file}
          type="file"
          accept=".ply,.sog"
          hidden
          aria-label="Local Gaussian file"
          onChange={(e) => {
            void loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="toolbar-field scale-field">
          <span>RENDER SCALE</span>
          <select
            aria-label="Render scale"
            disabled={busy}
            value={scale}
            onChange={(e) => {
              setScale(Number(e.target.value));
              setLockedTarget(null);
            }}
          >
            <option value={0.5}>50%</option>
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
          </select>
        </div>
        <div className="toolbar-spacer" />
        <span className={`run-status ${busy ? "running" : ""}`}>
          <i className="status-dot" />
          {status}
        </span>
        {runBusy ? (
          <button className="button stop" onClick={() => runner.current.stop()}>
            <Square size={13} />
            Stop run
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!loading || !wasm || busy}
            onClick={run}
          >
            <Play size={13} fill="currentColor" />
            Run benchmark
          </button>
        )}
      </div>
      <main className="work-main">
        <aside className="category-rail" aria-label="Benchmark categories">
          {categories.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={category === name ? "selected" : ""}
              aria-pressed={category === name}
              aria-label={name}
              title={name}
              onClick={() => {
                setCategory(name);
                setDrawer(true);
              }}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
          <div className="rail-bottom">
            <span title="Statistics module" className={wasm ? "wasm-ok" : ""}>
              WASM
            </span>
          </div>
        </aside>
        <div className="viewport-column">
          <div
            className="viewport"
            ref={viewport}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void loadFile(e.dataTransfer.files[0]);
            }}
          >
            <canvas
              key={`${renderer}-${api}-${generation}`}
              ref={canvas}
              aria-label="Interactive Gaussian scene"
              tabIndex={0}
            />
            <div className="viewport-top">
              <div className="scene-label">
                <span className="eyebrow">
                  GAUSSIAN RENDERING /{" "}
                  {scene.source === "reference" ? "REFERENCE 01" : "LOCAL FILE"}
                </span>
                <h1>
                  {scene.source === "reference" ? "Orbital study" : scene.name}
                </h1>
                <span>
                  {loading?.gaussians?.toLocaleString() ?? "—"} Gaussians{" "}
                  <i>·</i> {scene.format.toUpperCase()} <i>·</i>{" "}
                  {bytes(loading?.bytes ?? scene.bytes)}
                </span>
              </div>
              <div className="viewport-actions">
                <button
                  className="glass-button controls-toggle"
                  disabled={busy}
                  aria-pressed={gridVisible}
                  onClick={() => setGridVisible((v) => !v)}
                >
                  Grid
                </button>
                <button
                  className="glass-button controls-toggle"
                  disabled={busy}
                  onClick={() => adapter.current?.centerObject()}
                >
                  Center the object
                </button>
                <button
                  className="glass-button controls-toggle"
                  aria-expanded={controlsOpen}
                  onClick={() => setControlsOpen((v) => !v)}
                >
                  Scene controls
                </button>
                <button
                  className="glass-button"
                  aria-label="Reset camera"
                  title="Reset camera"
                  disabled={busy}
                  onClick={() => adapter.current?.resetCamera()}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  className="glass-button"
                  aria-label="Fullscreen viewport"
                  title="Fullscreen viewport"
                  disabled={busy}
                  onClick={() => {
                    void (document.fullscreenElement
                      ? document.exitFullscreen()
                      : viewport.current?.requestFullscreen());
                  }}
                >
                  <Expand size={16} />
                </button>
              </div>
            </div>
            <div className="gizmo-toolbar" aria-label="Viewport tools">
              <button
                className="glass-button controls-toggle"
                disabled={busy}
                aria-pressed={gizmoVisible}
                onClick={() => setGizmoVisible((v) => !v)}
              >
                Rotate object
              </button>
              <button
                className="glass-button controls-toggle"
                disabled={busy}
                onClick={() => {
                  setRotation([0, 0, 0]);
                  adapter.current?.resetCamera();
                }}
              >
                Reset view
              </button>
            </div>
            {controlsOpen && (
              <div className="scene-controls controls-reference">
                <h3>{renderer} controls</h3>
                <p>
                  Click the viewport to focus. Keyboard movement works
                  immediately.
                </p>
                <dl>
                  <dt>W / A / S / D</dt>
                  <dd>Move camera</dd>
                  {renderer === "PlayCanvas" ? (
                    <>
                      <dt>Q / E</dt>
                      <dd>Camera down / up</dd>
                      <dt>Left drag</dt>
                      <dd>Orbit scene</dd>
                      <dt>Right drag</dt>
                      <dd>Look around</dd>
                      <dt>Middle / Shift + drag</dt>
                      <dd>Pan camera</dd>
                      <dt>F</dt>
                      <dd>Frame scene</dd>
                    </>
                  ) : (
                    <>
                      <dt>Space / Ctrl</dt>
                      <dd>Camera up / down</dd>
                      <dt>Q / E</dt>
                      <dd>Roll camera left / right</dd>
                      <dt>Left drag</dt>
                      <dd>Look around</dd>
                      <dt>Right drag</dt>
                      <dd>Pan camera</dd>
                      <dt>Backtick / Esc</dt>
                      <dd>Capture / release mouse</dd>
                      <dt>R</dt>
                      <dd>Reset camera</dd>
                    </>
                  )}
                  <dt>Shift</dt>
                  <dd>Move faster</dd>
                  <dt>Wheel</dt>
                  <dd>Zoom / move forward</dd>
                  <dt>Red / green / blue rings</dt>
                  <dd>Rotate object on X / Y / Z</dd>
                  <dt>Shift + ring drag</dt>
                  <dd>Snap rotation to 15°</dd>
                  <dt>Focused ring + arrows</dt>
                  <dd>Rotate 1° (Shift: 15°)</dd>
                </dl>
                <small>
                  Rotation rings are GaussMark editor tools. They are hidden
                  during measurement; saved object rotation is preserved.
                </small>
              </div>
            )}
            <div className="axis-gizmo" aria-label="Coordinate orientation">
              <span>Y</span>
              <i />
              <b>X</b>
              <em>Z</em>
            </div>
            <div className="viewport-bottom">
              <span>
                {busy
                  ? "AUTOMATED CAMERA · INPUT LOCKED"
                  : renderer === "WebSplatter"
                    ? "WASD MOVE · SPACE/CTRL UP/DOWN · Q/E ROLL"
                    : "DRAG TO ORBIT · RIGHT DRAG LOOK · WASD MOVE · Q/E DOWN/UP"}
              </span>
              <span>
                {dimensions.width} × {dimensions.height} <i>·</i>{" "}
                {api.toUpperCase()}
              </span>
            </div>
            <div className="live-readout">
              <Activity size={14} />
              <strong>{telemetry.fps ? telemetry.fps.toFixed(0) : "—"}</strong>
              <span>FPS</span>
              <div />
              <strong>
                {telemetry.frameMs ? telemetry.frameMs.toFixed(1) : "—"}
              </strong>
              <span>ms</span>
              <i className="status-dot" />
            </div>
            {["initializing", "loading"].includes(telemetry.phase) && (
              <div className="viewport-loading">
                <LoaderCircle size={25} className="spin" />
                <b>
                  {telemetry.phase === "initializing"
                    ? "Starting graphics device"
                    : "Preparing Gaussians"}
                </b>
                <span>
                  {scene.source === "reference"
                    ? "Loading the bundled reference scene"
                    : "Your file stays in this browser"}
                </span>
              </div>
            )}
            {telemetry.phase === "error" && (
              <div className="viewport-loading">
                <Box size={28} />
                <b>Renderer unavailable</b>
                <span>{error}</span>
                <button
                  className="button"
                  onClick={() => setGeneration((g) => g + 1)}
                >
                  Retry renderer
                </button>
              </div>
            )}
            {runBusy && (
              <div className="run-progress">
                <span>
                  {telemetry.phase === "warmup"
                    ? "Warming up"
                    : `Measuring pass ${telemetry.repeat} / ${repeats}`}
                </span>
                <b>{Math.round(telemetry.progress * 100)}%</b>
                <div>
                  <i style={{ width: `${telemetry.progress * 100}%` }} />
                </div>
              </div>
            )}
          </div>
          <div className={`telemetry-strip ${showTelemetry ? "expanded" : ""}`}>
            <button
              disabled={busy}
              aria-expanded={showTelemetry}
              onClick={() => setShowTelemetry((v) => !v)}
            >
              <Activity size={14} />
              <span>LIVE FRAME PACING</span>
              <small>ms / frame</small>
              <span className="telemetry-toggle">
                {showTelemetry ? "−" : "+"}
              </span>
            </button>
            {showTelemetry && <FrameChart values={telemetry.history} compact />}
          </div>
          {error && telemetry.phase !== "error" && (
            <div className="workspace-alert" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={() => setError("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        <aside className={`results-panel ${drawer ? "drawer-open" : ""}`}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">BENCHMARK INSPECTOR</span>
              <h2>{category}</h2>
            </div>
            <button
              className="icon-button mobile-close"
              aria-label="Close inspector"
              onClick={() => setDrawer(false)}
            >
              <X size={18} />
            </button>
            <span className="tag">
              {category === "Fidelity" ? "PLANNED" : "LAB 01"}
            </span>
          </div>
          <div className="panel-content">
            <div className="comparison-setup">
              <button className="button" disabled={busy} onClick={useBaseline}>
                Use saved A’s test settings
              </button>
              {lockedTarget && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setLockedTarget(null)}
                >
                  Unlock resolution
                </button>
              )}
              <small role="status">
                {comparisonMessage ||
                  "Save A, switch renderer, then run and save B."}
                {lockedTarget
                  ? ` Target locked to ${lockedTarget.width} × ${lockedTarget.height}.`
                  : ""}
              </small>
            </div>
            {(category === "Motion" || category === "Overview") && (
              <CameraPathEditor
                path={cameraPath}
                onChange={(p) => {
                  setCameraPath(p);
                  if (p?.mode === "frozen") setMotion("stationary");
                  else if (p?.mode === "orbit") setMotion("orbit");
                }}
                adapter={adapter.current}
                disabled={busy || !loading}
                sceneKey={scene.sha256}
                rotation={rotation}
                onRotation={setRotation}
              />
            )}
            {category === "Overview" && (
              <>
                <div className="section-label">
                  SESSION PERFORMANCE
                  <span>{result ? "COMPLETE" : "AWAITING RUN"}</span>
                </div>
                <div className="primary-metric">
                  <span>Median framerate</span>
                  <strong>
                    {result ? (1000 / result.stats.median).toFixed(1) : "—"}
                    <small>FPS</small>
                  </strong>
                  <p>
                    {result
                      ? `${result.stats.count.toLocaleString()} frames · ${result.config.repeats} passes`
                      : "Run a benchmark to collect measurements"}
                  </p>
                </div>
                <div className="metric-grid">
                  <Metric
                    label="P95 frame time"
                    value={ms(result?.stats.p95)}
                    unit="ms"
                  />
                  <Metric
                    label="P99 frame time"
                    value={ms(result?.stats.p99)}
                    unit="ms"
                  />
                  <Metric
                    label="Load to frame¹"
                    value={ms(loading?.totalMs)}
                    unit="ms"
                  />
                  <Metric
                    label="Scene complexity"
                    value={
                      loading?.gaussians
                        ? `${(loading.gaussians / 1000).toFixed(0)}k`
                        : "—"
                    }
                    unit="splats"
                  />
                </div>
                <h3 className="section-label">FRAME DISTRIBUTION</h3>
                {result ? (
                  <Histogram values={frames} />
                ) : (
                  <div className="chart-placeholder">
                    <Activity size={20} />
                    <span>Your frame distribution will appear here</span>
                  </div>
                )}
                <Protocol
                  motion={motion}
                  setMotion={setMotion}
                  duration={duration}
                  setDuration={setDuration}
                  repeats={repeats}
                  setRepeats={setRepeats}
                  busy={busy}
                />
                {previous && (
                  <div className="notice">
                    {(
                      (previous.stats.median / result!.stats.median - 1) *
                      100
                    ).toFixed(1)}
                    % median FPS change from the last matching session.
                  </div>
                )}
              </>
            )}
            {category === "Motion" && (
              <>
                <div className="section-label">DETERMINISTIC CAMERA PATH</div>
                <div className="route-visual">
                  <svg
                    viewBox="0 0 260 130"
                    aria-label="Normalized orbit route"
                  >
                    <ellipse cx="130" cy="65" rx="100" ry="43" />
                    <ellipse
                      cx="130"
                      cy="65"
                      rx="52"
                      ry="23"
                      className="inner"
                    />
                    <circle
                      cx={
                        130 + 100 * Math.cos(telemetry.progress * Math.PI * 2)
                      }
                      cy={65 + 43 * Math.sin(telemetry.progress * Math.PI * 2)}
                      r="6"
                    />
                    <text x="130" y="69">
                      {motion.toUpperCase()}
                    </text>
                  </svg>
                  <span>Normalized path · deterministic time parameter</span>
                </div>
                <Protocol
                  motion={motion}
                  setMotion={setMotion}
                  duration={duration}
                  setDuration={setDuration}
                  repeats={repeats}
                  setRepeats={setRepeats}
                  busy={busy}
                />
                <div className="metric-grid">
                  <Metric
                    label="Frames > 50 ms"
                    value={result ? stutters : "—"}
                  />
                  <Metric
                    label="Stutter share"
                    value={
                      result
                        ? ((100 * stutters) / frames.length).toFixed(1)
                        : "—"
                    }
                    unit="%"
                  />
                </div>
                {result ? (
                  <FrameChart values={frames} />
                ) : (
                  <p className="panel-note">
                    Each pass repeats the same route after a two-second warm-up.
                    Stationary mode provides a fixed-camera baseline.
                  </p>
                )}
              </>
            )}
            {category === "Streaming" && (
              <>
                <div className="notice">
                  {scene.source === "local"
                    ? "Local file test. No network transfer is measured."
                    : "Bundled HTTP asset. Request time includes browser cache behavior; this is not a bandwidth test."}
                </div>
                <h3 className="section-label">LOAD WATERFALL</h3>
                {loading ? (
                  <>
                    <div className="waterfall">
                      {[
                        {
                          label:
                            scene.source === "local"
                              ? "Local blob read"
                              : "Request + body",
                          value: loading.requestMs ?? loading.readMs ?? 0,
                        },
                        { label: "Decode + prepare", value: loading.prepareMs },
                        {
                          label: "Next rendered frame¹",
                          value: Math.max(
                            0,
                            loading.totalMs -
                              (loading.requestMs ?? loading.readMs ?? 0) -
                              loading.prepareMs,
                          ),
                        },
                      ].map((m, i) => (
                        <div key={m.label}>
                          <span>
                            <i>{String(i + 1).padStart(2, "0")}</i>
                            {m.label}
                            <b>{ms(m.value)} ms</b>
                          </span>
                          <div>
                            <i
                              style={{
                                width: `${Math.max(1, (m.value / loading.totalMs) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="metric-grid">
                      <Metric
                        label="Asset size"
                        value={(loading.bytes / 1048576).toFixed(2)}
                        unit="MiB"
                      />
                      <Metric
                        label="Total to frame¹"
                        value={ms(loading.totalMs)}
                        unit="ms"
                      />
                    </div>
                  </>
                ) : (
                  <p className="panel-note">
                    Load a scene to inspect its lifecycle.
                  </p>
                )}
                <Availability
                  rows={[
                    "Decode-only timing: not exposed",
                    "Wire transfer bytes: not instrumented",
                    "First visible splat: not instrumented",
                    "Progressive loading: not enabled",
                  ]}
                />
              </>
            )}
            {category === "CPU" && (
              <>
                <div className="section-label">BROWSER-SIDE OPERATIONS</div>
                <Metric
                  label="Decode + scene preparation"
                  value={ms(loading?.prepareMs)}
                  unit="ms"
                  hint="Wall time; includes asynchronous renderer work"
                />
                <div className="notice">
                  Operation duration is not CPU utilisation. Browser scheduling
                  and worker activity are included.
                </div>
                <h3 className="section-label">PORTABLE COMPUTATION</h3>
                <div className="module-card">
                  <Cpu size={22} />
                  <div>
                    <b>Rust statistics engine</b>
                    <span>
                      {wasm
                        ? "WebAssembly loaded and self-tested"
                        : "Loading WebAssembly…"}
                    </span>
                  </div>
                  {wasm && <Check size={16} />}
                </div>
                <p className="panel-note">
                  Frame samples cross into WASM once per aggregation. No WASM
                  calls are made in the rendering loop.
                </p>
                <button
                  className="button full-width"
                  onClick={() => setCategory("Spatial")}
                >
                  <Move3D size={16} />
                  Open spatial workloads
                </button>
              </>
            )}
            {category === "GPU" && (
              <>
                <div className="section-label">RENDERED FRAME INTERVALS</div>
                {result ? (
                  <>
                    <FrameChart values={frames} />
                    <Histogram values={frames} />
                  </>
                ) : (
                  <div className="chart-placeholder tall">
                    <Box size={26} />
                    <span>Run a benchmark to measure frame pacing</span>
                  </div>
                )}
                <div className="metric-grid">
                  <Metric label="Graphics API" value={api.toUpperCase()} />
                  <Metric
                    label="Pixel count"
                    value={(
                      (dimensions.width * dimensions.height) /
                      1000000
                    ).toFixed(2)}
                    unit="MP"
                  />
                </div>
                <Availability
                  rows={[
                    "GPU execution time: not instrumented",
                    "Sort / compute time: not exposed",
                    "Timestamp queries: not enabled",
                  ]}
                />
                <p className="panel-note">
                  Frame intervals include CPU, GPU, browser scheduling, and
                  VSync. They must not be presented as GPU timings.
                </p>
              </>
            )}
            {category === "Memory" && (
              <>
                <div className="section-label">PARTIAL MEMORY OBSERVATIONS</div>
                <Metric
                  label="JS heap before loading"
                  value={
                    loading?.heapBefore
                      ? (loading.heapBefore / 1048576).toFixed(1)
                      : "—"
                  }
                  unit="MiB"
                />
                <Metric
                  label="JS heap after loading"
                  value={
                    loading?.heapAfter
                      ? (loading.heapAfter / 1048576).toFixed(1)
                      : "—"
                  }
                  unit="MiB"
                />
                <Metric
                  label="Input asset bytes"
                  value={loading ? (loading.bytes / 1048576).toFixed(2) : "—"}
                  unit="MiB"
                />
                <p className="panel-note">
                  Heap values are Chromium-specific, potentially coarse, and
                  shared with other same-process pages. Asset size is not
                  resident GPU allocation.
                </p>
                <Availability
                  rows={[
                    "Total physical VRAM: unavailable",
                    "System RAM usage: unavailable",
                    "Renderer allocation peak: not exposed",
                    "Retained allocations: not instrumented",
                  ]}
                />
              </>
            )}
            {category === "Spatial" && (
              <>
                <div className="section-label">COMPUTATIONAL BENCHMARK</div>
                <h3 className="spatial-title">From Earth to coordinates.</h3>
                <p className="panel-note">
                  WGS84 latitude, longitude, and altitude → Earth-centred,
                  Earth-fixed XYZ. Float64, 50,000 points, six alternating
                  batches.
                </p>
                <div className="module-card">
                  <Move3D size={24} />
                  <div>
                    <b>WGS84 → ECEF</b>
                    <span>Reference tolerance: 0.000001 m</span>
                  </div>
                </div>
                <button
                  className="button primary full-width"
                  disabled={!wasm || busy}
                  onClick={runSpatial}
                >
                  {spatialBusy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Play size={15} />
                  )}
                  Run coordinate test
                </button>
                {spatial && (
                  <>
                    <div className="metric-grid">
                      <Metric
                        label="Rust / WASM"
                        value={ms(spatial.wasmMs)}
                        unit="ms"
                      />
                      <Metric
                        label="TypeScript"
                        value={ms(spatial.tsMs)}
                        unit="ms"
                      />
                    </div>
                    <div className="notice success">
                      <Check size={15} />
                      Reference cases passed · max error{" "}
                      {spatial.referenceError.toExponential(2)} m
                    </div>
                    <p className="panel-note">
                      Cross-implementation max error:{" "}
                      {spatial.maxError.toExponential(2)} m. Median batch time
                      includes allocation and WASM copying.
                    </p>
                  </>
                )}
                <p className="panel-note">
                  Equator, pole, and altitude references validate the ellipsoid.
                  This is a small math workload, separate from renderer
                  measurements.
                </p>
              </>
            )}
            {category === "Fidelity" && (
              <>
                <div className="planned-visual">
                  <Eye size={40} />
                  <span>REFERENCE / CANDIDATE</span>
                </div>
                <h3>Quality needs a reference.</h3>
                <p className="panel-note">
                  A matched image-comparison pipeline is not implemented in this
                  build. No PSNR, SSIM, or visual fidelity score is reported.
                </p>
                <Availability
                  rows={[
                    "Fixed-camera image capture: planned",
                    "Colour-space matching: planned",
                    "PSNR / SSIM: planned",
                    "Compression comparisons: planned",
                  ]}
                />
              </>
            )}
          </div>
          <div className="panel-bottom">
            {result && <SaveComparison key={result.id} result={result} />}
            {result ? (
              <div className="actions">
                <button
                  className="button"
                  title="Export result"
                  aria-label="Export result"
                  onClick={() => downloadResult(result)}
                >
                  <Download size={15} />
                </button>
                <button
                  className="button primary"
                  onClick={() => setReport(true)}
                >
                  View session report
                  <Maximize size={13} />
                </button>
              </div>
            ) : (
              <>
                <span>
                  <i className="status-dot" />
                  {wasm ? "Rust / WASM ready" : "Starting analysis engine"}
                </span>
                <small>¹ First post-load frame, not verified visibility.</small>
              </>
            )}
          </div>
        </aside>
      </main>
      <Footer />
      {report && result && (
        <Report result={result} onClose={() => setReport(false)} />
      )}
    </div>
  );
}
function Protocol({
  motion,
  setMotion,
  duration,
  setDuration,
  repeats,
  setRepeats,
  busy,
}: {
  motion: MotionMode;
  setMotion: (m: MotionMode) => void;
  duration: number;
  setDuration: (n: number) => void;
  repeats: number;
  setRepeats: (n: number) => void;
  busy: boolean;
}) {
  return (
    <div className="protocol">
      <h3 className="section-label">
        TEST PROTOCOL
        <Settings2 size={13} />
      </h3>
      <label>
        Camera path
        <select
          aria-label="Camera path"
          value={motion}
          disabled={busy}
          onChange={(e) => setMotion(e.target.value as MotionMode)}
        >
          <option value="stationary">Stationary baseline</option>
          <option value="slow">Slow traversal</option>
          <option value="fast">Fast traversal</option>
          <option value="orbit">Orbit stress</option>
        </select>
      </label>
      <div className="protocol-row">
        <label>
          Duration
          <select
            aria-label="Duration"
            value={duration}
            disabled={busy}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
            <option value={20}>20 seconds</option>
          </select>
        </label>
        <label>
          Repetitions
          <select
            aria-label="Repetitions"
            value={repeats}
            disabled={busy}
            onChange={(e) => setRepeats(Number(e.target.value))}
          >
            <option value={1}>1 pass</option>
            <option value={3}>3 passes</option>
          </select>
        </label>
      </div>
    </div>
  );
}
function Availability({ rows }: { rows: string[] }) {
  return (
    <ul className="availability">
      {rows.map((r) => (
        <li key={r}>
          <span>—</span>
          {r}
        </li>
      ))}
    </ul>
  );
}
