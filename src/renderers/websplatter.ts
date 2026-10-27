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
import {
  rendererCapabilities,
  type LoadContext,
  type GpuSample,
} from "@/core/practical-types";
import { validateAttributes } from "@/core/provider";
import type { AllocationLedger } from "@/core/measurements";
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
  readBreakdown(): Promise<Record<string, number[]>>;
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
  private timing = false;
  private resources = new Set<GPUBuffer | GPUQuerySet>();
  private sceneListeners: {
    type: string;
    listener: EventListenerOrEventListenerObject;
  }[] = [];
  private cpuBuffers: ArrayBuffer[] = [];
  private ledger?: AllocationLedger;
  capabilities() {
    const c = rendererCapabilities("WebSplatter", "webgpu");
    c.gpuTimestamps = {
      supported: !!this.device?.features.has("timestamp-query"),
      reason:
        "WebGPU timestamp-query feature, deferred readback of up to 200 final frames",
    };
    return c;
  }
  setInstrumentation(enabled: boolean) {
    this.timing = enabled;
  }
  async gpuSamples(): Promise<GpuSample[]> {
    if (
      !this.timing ||
      !this.capabilities().gpuTimestamps.supported ||
      !this.renderer
    )
      return [];
    // End the observation window before readback; no frame counter can race mapping.
    cancelAnimationFrame(this.animation);
    const values = await this.renderer.readBreakdown();
    return Object.entries(values).flatMap(([stage, values]) =>
      values
        .filter((v) => Number.isFinite(v) && v >= 0)
        .map((durationMs) => ({
          stage,
          durationMs,
          method: "webgpu-timestamp" as const,
        })),
    );
  }
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
      requiredFeatures: adapter.features.has("timestamp-query")
        ? ["timestamp-query"]
        : [],
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
  async load(
    scene: Scene,
    signal: AbortSignal,
    context?: LoadContext,
  ): Promise<LoadMetrics> {
    signal.throwIfAborted();
    this.unload();
    if (this.cameraBuffer) this.ledger?.release(this.cameraBuffer);
    this.ledger = context?.allocations;
    if (this.cameraBuffer)
      this.ledger?.track(this.cameraBuffer, this.cameraBuffer.size, "gpu");
    try {
      if (scene.format !== "ply" && !context?.provider)
        throw Error(
          scene.format === "sog"
            ? "SOG is supported by PlayCanvas only in native mode. WebSplatter requires an external read-only provider for converted SOG rendering."
            : "Requires external read-only provider. Native WebSplatter accepts uncompressed Gaussian PLY only; SSOG is unverified.",
        );
      const start = performance.now(),
        heapBefore = heapBytes();
      let parsed: Parsed,
        bytes = 0,
        readEnd = start;
      if (context?.provider) {
        if (!context.provider.formats.includes(scene.format))
          throw Error("Selected provider does not declare this format");
        context.onStage?.("decode");
        const decodeEnd = context.timeline.begin(
          "external decode",
          context.provider.synthetic ? "elapsed" : "worker-elapsed",
        );
        let attributes;
        try {
          attributes = validateAttributes(
            await context.provider.decode(
              context.source,
              scene.format,
              signal,
              context.allocations,
            ),
          );
        } finally {
          decodeEnd();
        }
        signal.throwIfAborted();
        context.metadata = attributes.metadata;
        const conversionEnd = context.timeline.begin(
          "decoded attributes to WebSplatter f32",
          "synchronous",
        );
        const { metadata: m, positions, opacity, covariance, sh } = attributes;
        for (const v of [positions, opacity, covariance, sh])
          context.allocations.buffer(v);
        const gaussian = new Float32Array(m.splats * 10);
        for (let i = 0; i < m.splats; i++) {
          gaussian.set(positions.subarray(i * 3, i * 3 + 3), i * 10);
          gaussian[i * 10 + 3] = opacity[i];
          gaussian.set(covariance.subarray(i * 6, i * 6 + 6), i * 10 + 4);
        }
        parsed = {
          num_points: m.splats,
          final_sh_degree: m.shDegree,
          gaussian_cpu: gaussian.buffer,
          sh_cpu: sh.buffer,
          gs_stride: 10,
          sh_stride: 3 * (m.shDegree + 1) ** 2,
          boundsMin: m.bounds.slice(0, 3),
          boundsMax: m.bounds.slice(3),
        };
        context.allocations.buffer(gaussian);
        for (const v of [positions, opacity, covariance])
          context.allocations.release(v.buffer);
        conversionEnd();
        context.path = {
          format: scene.format,
          decoder: context.provider.synthetic
            ? "Public synthetic provider"
            : context.provider.execution === "local-service"
              ? "Local Python service via external worker (includes loopback transfer, process startup, temporary file I/O and decode; server memory untracked)"
              : "External read-only provider",
          providerVersion: context.provider.version,
          conversion:
            "Decoded position/opacity/covariance/SH to public WebSplatter f32 layout; SH degree preserved",
          representation: "WebSplatter f32 GPU storage buffers",
          native: false,
        };
        bytes = context.source.stats.deliveredBytes;
        readEnd = performance.now();
      } else {
        context?.onStage?.("delivery");
        const deliveryEnd = context?.timeline.begin("byte delivery");
        let buffer: ArrayBuffer;
        if (context)
          buffer = (
            await context.source.readRange(0, context.source.size, signal)
          ).buffer;
        else {
          const response = await fetch(scene.url, { signal });
          if (!response.ok)
            throw Error(`Scene request failed (${response.status}).`);
          buffer = await response.arrayBuffer();
        }
        bytes = buffer.byteLength;
        readEnd = performance.now();
        deliveryEnd?.();
        signal.throwIfAborted();
        const header = new TextDecoder().decode(buffer.slice(0, 8192));
        if (!/^format binary_little_endian 1\.0\r?$/m.test(header))
          throw Error(
            "WebSplatter requires a binary little-endian Gaussian PLY.",
          );
        context?.onStage?.("decode");
        signal.throwIfAborted();
        const decodeEnd = context?.timeline.begin(
          "PLY worker parse and conversion",
          "worker-elapsed",
        );
        context?.allocations.buffer(buffer, "worker");
        try {
          parsed = await new Promise<Parsed>((resolve, reject) => {
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
        } finally {
          decodeEnd?.();
          context?.allocations.release(buffer);
        }
        if (context)
          context.path = {
            format: scene.format,
            decoder: "Public WebSplatter PLY worker",
            conversion: "PLY to covariance + SH f32 in worker (inseparable)",
            representation: "WebSplatter f32 GPU storage buffers",
            native: true,
          };
      }
      signal.throwIfAborted();
      if (this.destroyed) throw Error("Renderer cancelled.");
      if (!parsed.num_points) throw Error("The PLY contains no Gaussians.");
      const device = this.device!;
      this.cpuBuffers = [parsed.gaussian_cpu, parsed.sh_cpu];
      for (const b of this.cpuBuffers) context?.allocations.buffer(b);
      if (context)
        context.metadata ??= {
          splats: parsed.num_points,
          shDegree: parsed.final_sh_degree,
          bounds: [...parsed.boundsMin, ...parsed.boundsMax] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ],
          precision: "f32",
          verifiedBy: "decoder",
        };
      context?.onStage?.("gpu-preparation");
      signal.throwIfAborted();
      const prepareEnd = context?.timeline.begin(
        "GPU resource construction and upload submission",
        "synchronous",
      );
      const trackBuffer = (descriptor: GPUBufferDescriptor) => {
        const b = device.createBuffer(descriptor);
        this.resources.add(b);
        this.ledger?.track(b, b.size, "gpu");
        return b;
      };
      const scopedDevice = new Proxy(device, {
        get: (target, key) => {
          if (key === "createBuffer") return trackBuffer;
          if (key === "createQuerySet")
            return (descriptor: GPUQuerySetDescriptor) => {
              const q = device.createQuerySet(descriptor);
              this.resources.add(q);
              return q;
            };
          if (key === "addEventListener")
            return (
              type: string,
              listener: EventListenerOrEventListenerObject,
            ) => {
              this.sceneListeners.push({ type, listener });
              device.addEventListener(type, listener);
            };
          const v = Reflect.get(target, key, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      const upload = (data: ArrayBuffer) => {
        if (data.byteLength > device.limits.maxStorageBufferBindingSize)
          throw Error("Scene exceeds this GPU’s storage buffer limit.");
        const b = trackBuffer({
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
        scopedDevice,
        this.format,
        this.cameraBuffer!,
        this.timing && device.features.has("timestamp-query")
          ? ["timestamp-query"]
          : [],
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
      prepareEnd?.();
      context?.timeline.mark(
        "gpu-upload-submitted",
        "queue.writeBuffer calls returned; not GPU completion",
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
      context?.configureScene?.();
      const prepared = performance.now();
      context?.timeline.mark(
        "renderer-prepared",
        "GPU resource/pipeline construction returned",
      );
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
          context?.timeline.mark(
            "first-submitted-frame",
            "First scene command buffer submitted; visibility unverified",
          );
          for (const cb of this.callbacks) cb(performance.now());
          this.animation = requestAnimationFrame(render);
        } catch (e) {
          this.fail(e as Error);
        }
      };
      render(performance.now());
      const completionEnd = context?.timeline.begin(
        "submitted GPU work completion",
        "gpu-completion-latency",
      );
      await device.queue.onSubmittedWorkDone();
      completionEnd?.();
      context?.timeline.mark(
        "gpu-preparation-complete",
        "onSubmittedWorkDone resolved, including first frame and any queued work; not execution duration",
      );
      signal.throwIfAborted();
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
    } catch (e) {
      this.unload();
      throw e;
    }
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
  unload() {
    cancelAnimationFrame(this.animation);
    this.previous = 0;
    for (const resource of this.resources) {
      resource.destroy();
      this.ledger?.release(resource);
    }
    this.resources.clear();
    for (const b of this.cpuBuffers) this.ledger?.release(b);
    this.cpuBuffers = [];
    for (const { type, listener } of this.sceneListeners)
      this.device?.removeEventListener(type, listener);
    this.sceneListeners = [];
    this.renderer = undefined;
  }
  dispose() {
    this.destroyed = true;
    this.unload();
    if (this.cameraBuffer) this.ledger?.release(this.cameraBuffer);
    cancelAnimationFrame(this.animation);
    this.callbacks.clear();
    this.errorCallbacks.clear();
    this.controls?.dispose();
    this.context?.unconfigure();
    this.device?.destroy();
    this.renderer = undefined;
  }
}
