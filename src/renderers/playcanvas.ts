import * as pc from "playcanvas";
import { cameraPose } from "@/core/math";
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
  private disposeEvents: () => void = () => {};
  private interactive = true;
  private destroyed = false;
  private angle = 0.65;
  private elevation = 0.34;
  private radius = 5.6;
  private baseRadius = 5.6;
  private fitScale = 1;
  private origin = new pc.Vec3(0, 0.1, 0);
  private center = new pc.Vec3(0, 0.1, 0);
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
    this.resetCamera();
    let dragging = false,
      x = 0,
      y = 0;
    const down = (e: PointerEvent) => {
      if (!this.interactive) return;
      dragging = true;
      x = e.clientX;
      y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging || !this.interactive) return;
      const dx = e.clientX - x,
        dy = e.clientY - y;
      x = e.clientX;
      y = e.clientY;
      if (e.shiftKey || e.buttons === 2) {
        const right = this.camera!.right.clone().mulScalar(
            -dx * this.radius * 0.0015,
          ),
          up = this.camera!.up.clone().mulScalar(dy * this.radius * 0.0015);
        this.center.add(right).add(up);
      } else {
        this.angle -= dx * 0.007;
        this.elevation = Math.max(
          -1.3,
          Math.min(1.3, this.elevation + dy * 0.007),
        );
      }
      this.orbit();
    };
    const up = () => {
      dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!this.interactive) return;
      this.radius = Math.max(
        this.baseRadius * 0.1,
        Math.min(this.baseRadius * 8, this.radius * Math.exp(e.deltaY * 0.001)),
      );
      this.orbit();
    };
    const context = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", context);
    this.disposeEvents = () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", context);
    };
    app.start();
  }
  private orbit() {
    if (!this.camera) return;
    this.camera.setPosition(
      this.center.x +
        Math.sin(this.angle) * Math.cos(this.elevation) * this.radius,
      this.center.y + Math.sin(this.elevation) * this.radius,
      this.center.z +
        Math.cos(this.angle) * Math.cos(this.elevation) * this.radius,
    );
    this.camera.lookAt(this.center);
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
        this.origin.copy(resource.aabb.center);
        this.baseRadius = Math.max(
          0.1,
          resource.aabb.halfExtents.length() * 2.2,
        );
      }
      this.resetCamera();
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
    const nextScale = Math.max(1, height / width);
    this.radius *= nextScale / this.fitScale;
    this.fitScale = nextScale;
    if (this.interactive) this.orbit();
  }
  setCamera(progress: number, mode: MotionMode) {
    if (!this.camera) return;
    // Inspection pan/zoom must never alter the reference benchmark path.
    this.center.copy(this.origin);
    const radius = this.baseRadius * this.fitScale;
    const p = cameraPose(progress, mode, radius);
    this.camera.setPosition(
      this.center.x + p[0],
      this.center.y + (p[1] * radius) / 5.3,
      this.center.z + p[2],
    );
    this.camera.lookAt(this.center);
  }
  resetCamera() {
    this.center.copy(this.origin);
    this.angle = 0.65;
    this.elevation = 0.34;
    this.radius = this.baseRadius * this.fitScale;
    this.orbit();
  }
  setInteractive(enabled: boolean) {
    this.interactive = enabled;
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
    this.disposeEvents();
    this.splat?.destroy();
    this.asset?.unload();
    if (this.asset) this.app?.assets.remove(this.asset);
    this.app?.destroy();
    this.app = undefined;
    this.camera = undefined;
  }
}
