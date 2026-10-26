export const BENCHMARK_VERSION = "0.1.0";
export const METHODOLOGY = "frame-interval-v1";
export type GraphicsApi = "webgl2" | "webgpu";
export type MotionMode = "stationary" | "slow" | "fast" | "orbit";
export type Category =
  | "Overview"
  | "Streaming"
  | "CPU"
  | "GPU"
  | "Memory"
  | "Motion"
  | "Spatial"
  | "Fidelity";
export type Stats = {
  count: number;
  median: number;
  p95: number;
  p99: number;
  mean: number;
  variance: number;
  min: number;
  max: number;
};
export type Scene = {
  id: string;
  version: string;
  name: string;
  url: string;
  format: "ply" | "sog";
  source: "reference" | "local";
  bytes?: number;
  sha256?: string;
};
export type LoadMetrics = {
  requestMs: number | null;
  readMs: number | null;
  prepareMs: number;
  firstFrameMs: number;
  totalMs: number;
  bytes: number;
  gaussians: number | null;
  heapBefore: number | null;
  heapAfter: number | null;
};
export type CameraPath =
  | {
      mode: "orbit";
      center: [number, number, number];
      radius: number;
      height: number;
      startAngle: number;
    }
  | {
      mode: "frozen";
      eye: [number, number, number];
      target: [number, number, number];
      up: [number, number, number];
    };
export type RunConfig = {
  motion: MotionMode;
  durationSeconds: number;
  warmupSeconds: number;
  repeats: number;
  width: number;
  height: number;
  renderScale: number;
  cameraCoordinates?: "object-centered";
  cameraPath?: CameraPath;
  objectTranslation?: [number, number, number];
  objectRotation?: [number, number, number];
};
export type DeviceInfo = {
  browser: string;
  os: string;
  gpu: string;
  devicePixelRatio: number;
};
export type BenchmarkResult = {
  id: string;
  createdAt: string;
  benchmarkVersion: string;
  methodology: string;
  renderer: string;
  rendererVersion: string;
  api: GraphicsApi;
  scene: Omit<Scene, "url">;
  config: RunConfig;
  device: DeviceInfo;
  stats: Stats;
  repetitions: Stats[];
  frames: number[][];
  loading: LoadMetrics;
  analysis: "rust-wasm";
  valid: boolean;
  invalidReason?: string;
};
export type Telemetry = {
  phase:
    | "idle"
    | "initializing"
    | "loading"
    | "ready"
    | "warmup"
    | "measuring"
    | "complete"
    | "stopped"
    | "error";
  progress: number;
  repeat: number;
  fps: number;
  frameMs: number;
  history: number[];
  message?: string;
};
export interface RendererAdapter {
  readonly name: string;
  readonly version: string;
  readonly api: GraphicsApi;
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  load(scene: Scene, signal: AbortSignal): Promise<LoadMetrics>;
  resize(width: number, height: number): void;
  setCamera(progress: number, mode: MotionMode): void;
  resetCamera(): void;
  setCameraPath(path: CameraPath | undefined): void;
  captureCamera(): Extract<CameraPath, { mode: "frozen" }>;
  previewCameraPath(): void;
  onPathChange(callback: (path: CameraPath) => void): () => void;
  setInteractive(enabled: boolean): void;
  setNavigation(mode: "orbit" | "fly", speed: number): void;
  setObjectTranslation(value: [number, number, number]): void;
  setGizmoMode(mode: "rotate" | "translate"): void;
  onTranslationChange(
    callback: (value: [number, number, number]) => void,
  ): () => void;
  setObjectRotation(rotation: [number, number, number]): void;
  setGridVisible(visible: boolean): void;
  centerObject(): void;
  objectPivot(): [number, number, number];
  setGizmoVisible(visible: boolean): void;
  onRotationChange(
    callback: (rotation: [number, number, number]) => void,
  ): () => void;
  onFrame(callback: (time: number) => void): () => void;
  onError?(callback: (error: Error) => void): () => void;
  getGpu(): string;
  dispose(): void;
}
