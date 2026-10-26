import type { CameraPath, DeviceInfo, GraphicsApi } from "./types";
import type { ByteSource, DeliveryProfile, DeliveryStats } from "./delivery";
import type { AllocationLedger, Timeline } from "./measurements";
import type { ReadOnlyProvider } from "./provider";

export type GaussianFormat =
  "ply" | "sog" | "ssog" | "gpc" | "sgpc" | "synthetic";
export type Support = { supported: boolean; reason: string };
export type EditOperation =
  | "select-region"
  | "hide-show"
  | "opacity-color"
  | "selection-transform"
  | "undo-redo";
export interface Capabilities {
  formats: GaussianFormat[];
  api: GraphicsApi;
  loading: "whole-file" | "progressive";
  byteRanges: Support;
  spatialRegions: Support;
  gpuTimestamps: Support;
  memory: { application: string; worker: string; gpu: string };
  unload: Support;
  concurrentScenes: Support;
  edits: EditOperation[];
  streaming: Support;
}
export type Stage = {
  name: string;
  startMs: number;
  endMs: number;
  incomplete?: boolean;
  kind: "elapsed" | "synchronous" | "worker-elapsed" | "gpu-completion-latency";
};
export type Milestone = {
  ms: number | null;
  criterion: string;
  unavailable?: string;
};
export type MemorySample = {
  atMs: number;
  checkpoint: string;
  jsHeap: number | null;
  application: number;
  worker: number;
  gpu: number;
  cache: number;
};
export type DecodedMetadata = {
  splats: number;
  shDegree: number;
  bounds: [number, number, number, number, number, number];
  precision: string;
  compression?: string;
  verifiedBy: "decoder" | "user";
};
export type PipelinePath = {
  format: GaussianFormat;
  decoder: string;
  conversion: string;
  representation: string;
  native: boolean;
  providerVersion?: string;
};
export interface LoadContext {
  source: ByteSource;
  timeline: Timeline;
  allocations: AllocationLedger;
  provider?: ReadOnlyProvider;
  metadata?: DecodedMetadata;
  path?: PipelinePath;
  configureScene?: () => void;
  onStage?: (name: "delivery" | "decode" | "gpu-preparation") => void;
}
export type GpuSample = {
  stage: string;
  durationMs: number;
  method: "webgpu-timestamp" | "webgl2-disjoint-query";
};
export type Preset =
  | "Website initial load"
  | "Website exploration"
  | "Scene switching and cancellation"
  | "Editor interactions"
  | "Memory lifecycle";
export interface PracticalSettings {
  preset: Preset;
  repeats: number;
  rendererState: "fresh" | "reused";
  cacheState: "cold" | "warm";
  delivery: DeliveryProfile;
  observationMs: number;
  frameTargetMs: number;
  consecutiveFrames: number;
  disposalWaitMs: number;
  sampleIntervalMs: number;
  warmupCycles: number;
  swap: "unload-first" | "concurrent";
  cancellation: "none" | "delivery" | "decode" | "gpu-preparation";
  cancelDelayMs: number;
  gpuTiming: boolean;
  width: number;
  height: number;
  cameraPath?: CameraPath;
  objectTranslation: [number, number, number];
  objectRotation: [number, number, number];
  applicationBudgetBytes: number;
}
export interface PracticalRepeat {
  index: number;
  variant: string;
  status: "complete" | "failed" | "cancelled" | "unsupported";
  error?: string;
  pipelineWarmState: string;
  milestones: Record<string, Milestone>;
  stages: Stage[];
  delivery: DeliveryStats;
  memory: MemorySample[];
  frames: number[];
  gpu: GpuSample[];
  longTasks: { startMs: number; durationMs: number }[];
  longTasksAvailable: boolean;
  instrumentationMs: number;
  disposal?: {
    requestMs: number;
    completionMs: number | null;
    criterion: string;
  };
  cancellation?: {
    requestedMs: number;
    settledMs: number;
    deliveredAfter: number;
    replacementReadyMs: number | null;
    continuingWork: string;
    orphanedResources: number | null;
  };
  metadata?: DecodedMetadata;
  path?: PipelinePath;
  unavailable: Record<string, string>;
}
export interface ComparisonGroup {
  id: string;
  equivalent: "undeclared" | "user-declared";
  alignmentConfirmed: boolean;
  intendedVariables: ("format" | "renderer" | "api")[];
}
export interface PracticalResult {
  schema: "gaussmark.practical.v1";
  id: string;
  createdAt: string;
  localOnly: true;
  renderer: string;
  rendererVersion: string;
  api: GraphicsApi;
  device: DeviceInfo;
  capabilities: Capabilities;
  settings: PracticalSettings;
  variants: {
    id: string;
    name: string;
    format: GaussianFormat;
    bytes: number;
    identity: string;
    preReadBytes: number;
    preReadMs: number;
  }[];
  comparisonGroup?: ComparisonGroup;
  repeats: PracticalRepeat[];
  unavailable: Record<string, string>;
  notes: string[];
}

export const no = (reason: string): Support => ({ supported: false, reason });
export function rendererCapabilities(
  renderer: "PlayCanvas" | "WebSplatter",
  api: GraphicsApi,
): Capabilities {
  return {
    formats: renderer === "PlayCanvas" ? ["ply", "sog"] : ["ply"],
    api,
    loading: "whole-file",
    byteRanges: no(
      "The byte source supports ranges; this renderer consumes the complete scene.",
    ),
    spatialRegions: no("No region-to-renderer integration is available."),
    gpuTimestamps: no(
      "Feature detection runs on the initialized graphics device.",
    ),
    memory: {
      application:
        "Explicitly registered buffers only; Blob/browser copies unobservable",
      worker: "Transferred input tracked; worker internals unobservable",
      gpu:
        renderer === "WebSplatter"
          ? "Scene GPU buffers tracked by create/destroy; excludes driver and canvas"
          : "Unavailable: engine allocations not instrumented",
    },
    unload: {
      supported: true,
      reason: "Destroy scene resources; keep renderer/device",
    },
    concurrentScenes: no("The integration owns one scene at a time."),
    edits: [],
    streaming: no(
      "Whole-scene renderer; no eviction or region readiness contract.",
    ),
  };
}
