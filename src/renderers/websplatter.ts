/// <reference types="@webgpu/types" />
import type { CameraPath } from "@/core/types";
import { mat4 } from "wgpu-matrix";
import { Vec3 } from "playcanvas";
import { SceneControls, type NavigationMode, type Rotation } from "./controls";
import type {
  RendererAdapter,
  Scene,
  LoadMetrics,
  MotionMode,
} from "@/core/types";
import { heapBytes } from "./playcanvas";
type Parsed = {
  num_points: number;
  final_sh_degree: number;
  gaussian_cpu: ArrayBuffer;
  sh_cpu: ArrayBuffer;
  gs_stride: number;
  sh_stride: number;
  boundsMin: number[];
  boundsMax: number[];
};
type Renderer = {
  frame(encoder: GPUCommandEncoder, view: GPUTextureView): void;
  render_settings_buffer: GPUBuffer;
};
type Runtime = {
  GaussianRenderer: new (
    data: object,
    device: GPUDevice,
    format: GPUTextureFormat,
    camera: GPUBuffer,
    features: GPUFeatureName[],
    disableCull: boolean,
    disableOpacity: boolean,
    f16: boolean,
  ) => Renderer;
  setCanvasSize(
    w: number,
    h: number,
    device: GPUDevice,
    buffer: GPUBuffer,
  ): void;
};
export class WebSplatterAdapter implements RendererAdapter {
  readonly name = "WebSplatter";
  readonly version = "16bb06e-gaussmark.1";
  readonly api = "webgpu" as const;
  private device?: GPUDevice;
  private context?: GPUCanvasContext;
  private canvas?: HTMLCanvasElement;
  private renderer?: Renderer;
  private runtime?: Runtime;
  private cameraBuffer?: GPUBuffer;
  private controls?: SceneControls;
  private callbacks = new Set<(time: number) => void>();
  private animation = 0;
  private destroyed = false;
  private fault?: Error;
  private errorCallbacks = new Set<(error: Error) => void>();
  private previous = 0;
  private gpu = "Unavailable";
  private format: GPUTextureFormat = "bgra8unorm";
  private eye = new Vec3();
  private target = new Vec3();
  private up = new Vec3(0, 1, 0);
  async initialize(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    if (!navigator.gpu)
      throw Error(
        "WebSplatter requires WebGPU. Use a browser and GPU with WebGPU support.",
      );
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw Error("No WebGPU adapter available.");
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBuffersPerShaderStage: Math.min(
          10,
          adapter.limits.maxStorageBuffersPerShaderStage,
        ),
      },
    });
    if (this.destroyed) {
      device.destroy();
      throw Error("Renderer cancelled.");
    }
    this.device = device;
    this.gpu =
      [adapter.info.vendor, adapter.info.architecture, adapter.info.description]
        .filter(Boolean)
        .join(" / ") || "Unavailable";
    device.lost.then((info) => {
      if (!this.destroyed)
        this.fail(new Error(`WebGPU device lost: ${info.message}`));
    });
    device.addEventListener("uncapturederror", (e) =>
      this.fail(new Error(e.error.message)),
    );
    const runtimeUrl = "/vendor/websplatter.js";
    this.runtime = (await import(
      /* webpackIgnore: true */ runtimeUrl
    )) as Runtime;
    if (this.destroyed) throw Error("Renderer cancelled.");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = canvas.getContext("webgpu")!;
    if (!this.context) throw Error("Could not create WebGPU canvas.");
    this.context.configure({
      device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.cameraBuffer = device.createBuffer({
      size: 272,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.controls = new SceneControls(
      canvas,
      (eye, target, up) => {
        this.eye.copy(eye);
        this.target.copy(target);
        this.up.copy(up);
      },
      "WebSplatter",
    );
  }
  private fail(error: Error) {
    if (this.destroyed || this.fault) return;
    this.fault = error;
    cancelAnimationFrame(this.animation);
    for (const callback of this.errorCallbacks) callback(error);
  }
  private writeCamera() {
    const canvas = this.canvas!,
      device = this.device!;
    // Upstream uses +Z forward, +Y down camera coordinates; PlayCanvas uses -Z forward, +Y up.
    const e = [this.eye.x, this.eye.y, this.eye.z],
      t = [this.target.x, this.target.y, this.target.z],
      u = [this.up.x, this.up.y, this.up.z];
    const view = mat4.lookAt(e, t, u);
    for (let column = 0; column < 4; column++) {
      view[column * 4 + 1] *= -1;
      view[column * 4 + 2] *= -1;
    }
    const near = 0.01,
      far = 1000,
      f = 1 / Math.tan((52 * Math.PI) / 360);
    const proj = new Float32Array([
      f / (canvas.width / canvas.height),
      0,
      0,
      0,
      0,
      -f,
      0,
      0,
      0,
      0,
      far / (far - near),
      1,
      0,
      0,
      (-far * near) / (far - near),
      0,
    ]);
    const data = new Float32Array(68);
    data.set(view, 0);
    data.set(mat4.inverse(view), 16);
    data.set(proj, 32);
    data.set(mat4.inverse(proj), 48);
    data.set(
      [
        canvas.width,
        canvas.height,
        (canvas.height * f) / 2,
        (canvas.height * f) / 2,
      ],
      64,
    );
    device.queue.writeBuffer(this.cameraBuffer!, 0, data);
  }
  async load(scene: Scene, signal: AbortSignal): Promise<LoadMetrics> {
    if (scene.format !== "ply")
      throw Error(
        "WebSplatter currently accepts uncompressed Gaussian PLY. SOG is supported by PlayCanvas only; use the same PLY for A/B testing.",
      );
    const start = performance.now(),
      heapBefore = heapBytes(),
      response = await fetch(scene.url, { signal });
    if (!response.ok) throw Error(`Scene request failed (${response.status}).`);
    const buffer = await response.arrayBuffer(),
      bytes = buffer.byteLength,
      readEnd = performance.now();
    signal.throwIfAborted();
    const header = new TextDecoder().decode(buffer.slice(0, 8192));
    if (!/^format binary_little_endian 1\.0\r?$/m.test(header))
      throw Error("WebSplatter requires a binary little-endian Gaussian PLY.");
    const parsed = await new Promise<Parsed>((resolve, reject) => {
      const worker = new Worker("/vendor/websplatter-ply-worker.js", {
        type: "module",
      });
      const clean = () => {
        worker.terminate();
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        clean();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = (e) => {
        clean();
        reject(Error(e.message));
      };
      worker.onmessage = (e) => {
        if (e.data.type === "done") {
          clean();
          resolve(e.data);
        } else if (e.data.type === "error") {
          clean();
          reject(Error(e.data.message));
        }
      };
      worker.postMessage(
        {
          type: "start",
          plyBuffer: buffer,
          sh_degree: 3,
          sort: null,
          memoryPrecision: "f32",
        },
        [buffer],
      );
    });
    signal.throwIfAborted();
    if (this.destroyed) throw Error("Renderer cancelled.");
    if (!parsed.num_points) throw Error("The PLY contains no Gaussians.");
    const device = this.device!;
    const upload = (data: ArrayBuffer) => {
      if (data.byteLength > device.limits.maxStorageBufferBindingSize)
        throw Error("Scene exceeds this GPU’s storage buffer limit.");
      const b = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    device.pushErrorScope("validation");
    this.renderer = new this.runtime!.GaussianRenderer(
      {
        ...parsed,
        sh_degree: parsed.final_sh_degree,
        ply_precision: "f32",
        gaussian_cpu: new Float32Array(parsed.gaussian_cpu),
        sh_cpu: new Float32Array(parsed.sh_cpu),
        gaussian_3d_buffer: upload(parsed.gaussian_cpu),
        sh_buffer: upload(parsed.sh_cpu),
      },
      device,
      this.format,
      this.cameraBuffer!,
      [],
      false,
      false,
      false,
    );
    this.runtime!.setCanvasSize(
      this.canvas!.width,
      this.canvas!.height,
      device,
      this.renderer.render_settings_buffer,
    );
    const error = await device.popErrorScope();
    if (error) throw Error(error.message);
    if (scene.source === "local") {
      const min = parsed.boundsMin,
        max = parsed.boundsMax;
      if (!min.every(Number.isFinite) || !max.every(Number.isFinite))
        throw Error("Scene has invalid bounds.");
      this.controls!.origin.set(
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      );
      this.controls!.baseRadius = Math.max(
        0.1,
        Math.hypot(
          (max[0] - min[0]) / 2,
          (max[1] - min[1]) / 2,
          (max[2] - min[2]) / 2,
        ) * 2.2,
      );
    }
    this.controls!.normalizeOrigin();
    const prepared = performance.now();
    signal.throwIfAborted();
    if (this.destroyed) throw Error("Renderer cancelled.");
    const render = (now: number) => {
      if (this.destroyed || this.fault) return;
      try {
        this.controls!.tick(this.previous ? (now - this.previous) / 1000 : 0);
        this.previous = now;
        this.writeCamera();
        const encoder = device.createCommandEncoder();
        this.renderer!.frame(
          encoder,
          this.context!.getCurrentTexture().createView(),
        );
        device.queue.submit([encoder.finish()]);
        for (const cb of this.callbacks) cb(performance.now());
        this.animation = requestAnimationFrame(render);
      } catch (e) {
        this.fail(e as Error);
      }
    };
    render(performance.now());
    await device.queue.onSubmittedWorkDone();
    if (this.fault) throw this.fault;
    const end = performance.now();
    return {
      requestMs: scene.source === "local" ? null : readEnd - start,
      readMs: scene.source === "local" ? readEnd - start : null,
      prepareMs: prepared - readEnd,
      firstFrameMs: end - start,
      totalMs: end - start,
      bytes,
      gaussians: parsed.num_points,
      heapBefore,
      heapAfter: heapBytes(),
    };
  }
  resize(w: number, h: number) {
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.controls?.resize(w, h);
    if (this.renderer)
      this.runtime!.setCanvasSize(
        w,
        h,
        this.device!,
        this.renderer.render_settings_buffer,
      );
  }
  setCamera(p: number, m: MotionMode) {
    if (this.fault) throw this.fault;
    this.controls?.benchmark(p, m);
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
  onFrame(cb: (time: number) => void) {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }
  onError(callback: (error: Error) => void) {
    this.errorCallbacks.add(callback);
    return () => {
      this.errorCallbacks.delete(callback);
    };
  }
  getGpu() {
    return this.gpu;
  }
  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.animation);
    this.callbacks.clear();
    this.errorCallbacks.clear();
    this.controls?.dispose();
    this.context?.unconfigure();
    this.device?.destroy();
    this.renderer = undefined;
  }
}
