import type { CameraPath } from "@/core/types";
import * as pc from "playcanvas";
import { SceneControls, type NavigationMode, type Rotation } from "./controls";
import type {
  GraphicsApi,
  LoadMetrics,
  MotionMode,
  RendererAdapter,
  Scene,
} from "@/core/types";

export const playcanvasCapabilities = {
  name: "PlayCanvas",
  formats: ["ply", "sog"],
  apis: ["webgl2", "webgpu"],
  loading: "Whole-file download, then renderer preparation",
  gpuTiming: false,
  progressive: false,
  metrics: [
    "frame intervals",
    "asset bytes",
    "request wall time",
    "preparation wall time",
    "optional JS heap",
  ],
};
export function heapBytes(): number | null {
  return (
    (performance as Performance & { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize ?? null
  );
}
export class PlayCanvasAdapter implements RendererAdapter {
  readonly name = "PlayCanvas";
  readonly version = pc.version;
  private app?: pc.Application;
  private camera?: pc.Entity;
  private asset?: pc.Asset;
  private canvas?: HTMLCanvasElement;
  private splat?: pc.Entity;
  private controls?: SceneControls;
  private destroyed = false;
  constructor(readonly api: GraphicsApi) {}
  async initialize(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const device = await pc.createGraphicsDevice(canvas, {
      deviceTypes: [this.api],
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (this.destroyed) {
      device.destroy();
      throw new Error("Renderer initialization cancelled.");
    }
    if (device.deviceType !== this.api) {
      device.destroy();
      throw new Error(
        `${this.api.toUpperCase()} is not available. Choose WebGL2.`,
      );
    }
    const app = (this.app = new pc.Application(canvas, {
      graphicsDevice: device,
    }));
    app.setCanvasFillMode(
      pc.FILLMODE_NONE,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    app.setCanvasResolution(
      pc.RESOLUTION_FIXED,
      Math.max(64, canvas.clientWidth),
      Math.max(64, canvas.clientHeight),
    );
    this.camera = new pc.Entity("Benchmark camera");
    this.camera.addComponent("camera", {
      clearColor: new pc.Color(0.048, 0.055, 0.053),
      fov: 52,
      nearClip: 0.01,
      farClip: 1000,
    });
    app.root.addChild(this.camera);
    this.controls = new SceneControls(canvas, (eye, target, up) => {
      this.camera!.setPosition(eye);
      this.camera!.lookAt(target, up);
    });
    app.on("update", (dt: number) => this.controls?.tick(dt));
    app.start();
  }
  async load(scene: Scene, signal: AbortSignal): Promise<LoadMetrics> {
    const app = this.app;
    if (!app) throw new Error("Renderer is not initialized.");
    const heapBefore = heapBytes(),
      start = performance.now();
    const response = await fetch(scene.url, { signal });
    if (!response.ok)
      throw new Error(`Scene request failed (${response.status}).`);
    const blob = await response.blob(),
      requestEnd = performance.now();
    if (signal.aborted || this.destroyed)
      throw new DOMException("Cancelled", "AbortError");
    const url = URL.createObjectURL(blob);
    const asset = (this.asset = new pc.Asset(scene.name, "gsplat", {
      url,
      filename: `scene.${scene.format}`,
    }));
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clean();
          reject(new DOMException("Cancelled", "AbortError"));
        };
        const loaded = () => {
          clean();
          resolve();
        };
        const failed = (e: unknown) => {
          clean();
          reject(new Error(String(e)));
        };
        const clean = () => {
          signal.removeEventListener("abort", abort);
          asset.off("load", loaded);
          asset.off("error", failed);
        };
        asset.once("load", loaded);
        asset.once("error", failed);
        signal.addEventListener("abort", abort, { once: true });
        app.assets.add(asset);
        app.assets.load(asset);
      });
      if (signal.aborted || this.destroyed)
        throw new DOMException("Cancelled", "AbortError");
      const splat = (this.splat = new pc.Entity(scene.name));
      splat.addComponent("gsplat", { asset });
      app.root.addChild(splat);
      const resource = asset.resource as
        | {
            aabb?: pc.BoundingBox;
            numSplats?: number;
            gsplatData?: { numSplats: number };
          }
        | undefined;
      if (scene.source === "local" && resource?.aabb) {
        this.controls!.origin.copy(resource.aabb.center);
        this.controls!.baseRadius = Math.max(
          0.1,
          resource.aabb.halfExtents.length() * 2.2,
        );
      }
      this.controls!.normalizeOrigin();
      const prepared = performance.now();
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          app.off("frameend", done);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        app.once("frameend", done);
        signal.addEventListener("abort", abort, { once: true });
      });
      const end = performance.now();
      return {
        requestMs: scene.source === "local" ? null : requestEnd - start,
        readMs: scene.source === "local" ? requestEnd - start : null,
        prepareMs: prepared - requestEnd,
        firstFrameMs: end - start,
        totalMs: end - start,
        bytes: blob.size,
        gaussians:
          resource?.numSplats ?? resource?.gsplatData?.numSplats ?? null,
        heapBefore,
        heapAfter: heapBytes(),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  resize(width: number, height: number) {
    if (this.app)
      this.app.setCanvasResolution(pc.RESOLUTION_FIXED, width, height);
    this.controls?.resize(width, height);
  }
  setCamera(progress: number, mode: MotionMode) {
    this.controls?.benchmark(progress, mode);
  }
  setCameraPath(path: CameraPath | undefined) {
    this.controls?.setCameraPath(path);
  }
  captureCamera() {
    if (!this.controls) throw Error("Scene not ready");
    return this.controls.captureCamera();
  }
  previewCameraPath() {
    this.controls?.previewCameraPath();
  }
  onPathChange(callback: (path: CameraPath) => void) {
    if (this.controls) this.controls.onPathChange = callback;
    return () => {
      if (this.controls) this.controls.onPathChange = undefined;
    };
  }
  resetCamera() {
    this.controls?.reset();
  }
  setInteractive(enabled: boolean) {
    this.controls?.setInteractive(enabled);
  }
  setNavigation(mode: NavigationMode, speed: number) {
    if (this.controls) {
      this.controls.speed = speed;
      this.controls.setMode(mode);
    }
  }
  setObjectTranslation(value: Rotation) {
    this.controls?.setTranslation(value);
  }
  setGizmoMode(mode: "rotate" | "translate") {
    if (this.controls) {
      this.controls.gizmo.mode = mode;
      this.controls.gizmo.update();
    }
  }
  onTranslationChange(callback: (value: Rotation) => void) {
    if (this.controls) this.controls.onTranslationChange = callback;
    return () => {
      if (this.controls) this.controls.onTranslationChange = undefined;
    };
  }
  setObjectRotation(rotation: Rotation) {
    if (this.controls) {
      this.controls.rotation = rotation;
      this.controls.update();
    }
  }
  setGridVisible(visible: boolean) {
    if (this.controls) {
      this.controls.gridVisible = visible;
      this.controls.gizmo.update();
    }
  }
  centerObject() {
    this.controls?.centerObject();
  }
  objectPivot(): [number, number, number] {
    const p = this.controls?.origin;
    return p ? [p.x, p.y, p.z] : [0, 0, 0];
  }
  setGizmoVisible(visible: boolean) {
    if (this.controls) {
      this.controls.gizmo.enabled = visible;
      this.controls.gizmo.update();
    }
  }
  onRotationChange(callback: (rotation: Rotation) => void) {
    if (this.controls) this.controls.gizmo.onChange = callback;
    return () => {
      if (this.controls) this.controls.gizmo.onChange = undefined;
    };
  }
  onFrame(callback: (time: number) => void) {
    const app = this.app;
    if (!app) return () => {};
    const fn = () => callback(performance.now());
    app.on("frameend", fn);
    return () => app.off("frameend", fn);
  }
  getGpu() {
    const device = this.app?.graphicsDevice as
      | (pc.GraphicsDevice & {
          unmaskedRenderer?: string;
          gpuAdapter?: {
            info?: {
              vendor?: string;
              architecture?: string;
              description?: string;
            };
          };
        })
      | undefined;
    const info = device?.gpuAdapter?.info;
    return (
      device?.unmaskedRenderer ||
      [info?.vendor, info?.architecture, info?.description]
        .filter(Boolean)
        .join(" / ") ||
      "Unavailable"
    );
  }
  dispose() {
    this.destroyed = true;
    this.controls?.dispose();
    this.splat?.destroy();
    this.asset?.unload();
    if (this.asset) this.app?.assets.remove(this.asset);
    this.app?.destroy();
    this.app = undefined;
    this.camera = undefined;
  }
}
