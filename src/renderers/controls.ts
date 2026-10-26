import { Vec3, Quat } from "playcanvas";
import { RotationGizmo } from "./rotation-gizmo";
import { cameraPose } from "../core/math";
import type { MotionMode, CameraPath } from "@/core/types";
export type NavigationMode = "orbit" | "fly";
export type Rotation = [number, number, number];
/** Shared camera/scene transform, so both renderers use the identical route. */
export class SceneControls {
  gridVisible = true;
  gridOrigin = new Vec3();
  private sourceOrigin = new Vec3();
  private normalized = false;
  normalizeOrigin() {
    this.sourceOrigin.copy(this.origin);
    this.normalized = true;
    this.origin.set(0, 0, 0);
    this.gridOrigin.set(0, 0, 0);
    this.reset();
  }
  onTranslationChange?: (value: Rotation) => void;
  setTranslation(value: Rotation) {
    this.origin.set(...value);
    this.update();
  }
  centerObject() {
    this.origin.set(0, 0, 0);
    this.onTranslationChange?.([0, 0, 0]);
    this.gridOrigin.copy(this.origin);
    this.reset();
  }
  origin = new Vec3(0, 0.1, 0);
  center = this.origin.clone();
  position = new Vec3();
  radius = 5.6;
  baseRadius = 5.6;
  fitScale = 1;
  angle = 0.65;
  elevation = 0.34;
  interactive = true;
  mode: NavigationMode = "orbit";
  speed = 1;
  rotation: Rotation = [0, 0, 0];
  readonly gizmo: RotationGizmo;
  viewTarget = new Vec3();
  viewUp = new Vec3(0, 1, 0);
  cameraPath?: CameraPath;
  onPathChange?: (path: CameraPath) => void;
  private inspection?: {
    eye: Vec3;
    center: Vec3;
    angle: number;
    elevation: number;
    roll: number;
    radius: number;
  };
  captureCamera(): Extract<CameraPath, { mode: "frozen" }> {
    return {
      mode: "frozen",
      eye: [this.position.x, this.position.y, this.position.z],
      target: [this.viewTarget.x, this.viewTarget.y, this.viewTarget.z],
      up: [this.viewUp.x, this.viewUp.y, this.viewUp.z],
    };
  }
  setCameraPath(path: CameraPath | undefined) {
    this.cameraPath = path;
    this.gizmo.update();
  }
  previewCameraPath() {
    this.benchmark(0, "orbit");
    this.mode = "fly";
    this.center.copy(this.viewTarget);
    const d = this.position.clone().sub(this.center);
    this.radius = d.length();
    this.angle = Math.atan2(d.x, d.z);
    this.elevation = Math.asin(d.y / Math.max(0.0001, this.radius));
  }
  private roll = 0;
  private keys = new Set<string>();
  private cleanup: () => void;
  constructor(
    private canvas: HTMLCanvasElement,
    private apply: (eye: Vec3, target: Vec3, up: Vec3) => void,
    private profile: "PlayCanvas" | "WebSplatter" = "PlayCanvas",
  ) {
    this.gizmo = new RotationGizmo(canvas, this);
    if (profile === "WebSplatter") this.mode = "fly";
    let dragging = false,
      x = 0,
      y = 0;
    const down = (e: PointerEvent) => {
      if (!this.interactive) return;
      canvas.focus();
      dragging = true;
      x = e.clientX;
      y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (
        (!dragging && document.pointerLockElement !== canvas) ||
        !this.interactive
      )
        return;
      const locked = document.pointerLockElement === canvas;
      const dx = locked ? e.movementX : e.clientX - x,
        dy = locked ? e.movementY : e.clientY - y;
      x = e.clientX;
      y = e.clientY;
      if (
        e.buttons === 4 ||
        (this.profile === "WebSplatter" && e.buttons === 2) ||
        (this.profile === "PlayCanvas" && e.shiftKey && e.buttons === 1)
      ) {
        const forward = this.forward();
        const right = new Vec3().cross(forward, this.viewUp).normalize();
        const up = new Vec3().cross(right, forward).normalize();
        const delta = right
          .mulScalar(-dx * this.radius * 0.0015)
          .add(up.mulScalar(dy * this.radius * 0.0015));
        this.center.add(delta);
        this.position.add(delta);
      } else {
        if (this.profile === "PlayCanvas" && e.buttons === 2)
          this.setMode("fly");
        if (this.profile === "PlayCanvas" && e.buttons === 1)
          this.setMode("orbit");
        this.angle -= dx * 0.007;
        this.elevation = Math.max(
          -1.55,
          Math.min(1.55, this.elevation + dy * 0.007),
        );
      }
      this.update();
    };
    const release = () => {
      dragging = false;
    };
    const clear = () => {
      release();
      this.keys.clear();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!this.interactive) return;
      if (this.mode === "orbit")
        this.radius = Math.max(
          this.baseRadius * 0.001,
          Math.min(
            this.baseRadius * 20,
            this.radius * Math.exp(e.deltaY * 0.001),
          ),
        );
      else
        this.position.add(
          this.forward().mulScalar(
            -e.deltaY * this.baseRadius * 0.0005 * this.speed,
          ),
        );
      this.update();
    };
    const key = (e: KeyboardEvent) => {
      if (!this.interactive) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "KeyQ",
          "KeyE",
          "ShiftLeft",
          "ShiftRight",
          ...(this.profile === "WebSplatter"
            ? ["Space", "ControlLeft", "ControlRight"]
            : []),
        ].includes(e.code)
      ) {
        e.preventDefault();
        this.keys.add(e.code);
      }
      if (e.code === (this.profile === "WebSplatter" ? "KeyR" : "KeyF")) {
        e.preventDefault();
        this.reset();
      }
      if (this.profile === "WebSplatter" && e.code === "Backquote") {
        e.preventDefault();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        else void canvas.requestPointerLock()?.catch(() => {});
      }
    };
    const keyup = (e: KeyboardEvent) => this.keys.delete(e.code);
    const context = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", clear);
    canvas.addEventListener("lostpointercapture", release);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", context);
    canvas.addEventListener("keydown", key);
    canvas.addEventListener("keyup", keyup);
    canvas.addEventListener("blur", clear);
    window.addEventListener("blur", clear);
    this.cleanup = () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointercancel", clear);
      canvas.removeEventListener("lostpointercapture", release);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", context);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("keyup", keyup);
      canvas.removeEventListener("blur", clear);
      window.removeEventListener("blur", clear);
    };
    this.reset();
  }
  private forward() {
    return new Vec3(
      -Math.sin(this.angle) * Math.cos(this.elevation),
      -Math.sin(this.elevation),
      -Math.cos(this.angle) * Math.cos(this.elevation),
    );
  }
  private emit(target: Vec3, benchmark = false, up?: Vec3) {
    // Rotate the object around its center by applying the inverse transform to
    // the camera. Equivalent for Gaussian rendering; also rotates SH directions.
    const q = new Quat().setFromEulerAngles(...this.rotation).invert();
    const eye = q
      .transformVector(this.position.clone().sub(this.origin))
      .add(this.normalized ? this.sourceOrigin : this.origin);
    const aim = q
      .transformVector(target.clone().sub(this.origin))
      .add(this.normalized ? this.sourceOrigin : this.origin);
    this.viewTarget.copy(target);
    const direction = target.clone().sub(this.position).normalize();
    this.viewUp.copy(
      new Quat()
        .setFromAxisAngle(direction, benchmark ? 0 : this.roll)
        .transformVector(Vec3.UP),
    );
    if (up) this.viewUp.copy(up);
    this.apply(eye, aim, q.transformVector(this.viewUp));
    if (this.interactive) this.gizmo.update();
  }
  update() {
    if (this.mode === "orbit")
      this.position
        .copy(this.center)
        .sub(this.forward().mulScalar(this.radius));
    this.emit(
      this.mode === "orbit"
        ? this.center
        : this.position.clone().add(this.forward()),
    );
  }
  tick(dt: number) {
    if (!this.interactive || !this.keys.size) return;
    const forward = this.forward(),
      right = new Vec3().cross(forward, this.viewUp).normalize();
    const v = new Vec3();
    if (this.keys.has("KeyW")) v.add(forward);
    if (this.keys.has("KeyS")) v.sub(forward);
    if (this.keys.has("KeyD")) v.add(right);
    if (this.keys.has("KeyA")) v.sub(right);
    if (this.profile === "PlayCanvas") {
      if (this.keys.has("KeyE")) v.y++;
      if (this.keys.has("KeyQ")) v.y--;
    } else {
      const up = new Vec3().cross(right, forward).normalize();
      if (this.keys.has("Space")) v.add(up);
      if (this.keys.has("ControlLeft") || this.keys.has("ControlRight"))
        v.sub(up);
      this.roll +=
        ((this.keys.has("KeyQ") ? 1 : 0) - (this.keys.has("KeyE") ? 1 : 0)) *
        90 *
        Math.min(dt, 0.1);
    }
    const boost =
      this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3 : 1;
    if (v.lengthSq()) {
      const delta = v
        .normalize()
        .mulScalar(
          Math.min(dt, 0.1) * this.baseRadius * 0.35 * this.speed * boost,
        );
      this.position.add(delta);
      this.center.add(delta);
    }
    this.update();
  }
  setMode(mode: NavigationMode) {
    if (this.mode === mode) return;
    if (mode === "orbit")
      this.center
        .copy(this.position)
        .add(this.forward().mulScalar(this.radius));
    this.mode = mode;
    this.keys.clear();
    this.update();
  }
  setInteractive(enabled: boolean) {
    if (!enabled && this.interactive)
      this.inspection = {
        eye: this.position.clone(),
        center: this.center.clone(),
        angle: this.angle,
        elevation: this.elevation,
        roll: this.roll,
        radius: this.radius,
      };
    if (enabled && this.inspection) {
      const s = this.inspection;
      this.position.copy(s.eye);
      this.center.copy(s.center);
      this.angle = s.angle;
      this.elevation = s.elevation;
      this.roll = s.roll;
      this.radius = s.radius;
      this.inspection = undefined;
    }
    this.interactive = enabled;
    if (!enabled && document.pointerLockElement === this.canvas)
      document.exitPointerLock();
    this.gizmo.update();
    this.keys.clear();
    if (enabled) this.update();
  }
  reset() {
    this.roll = 0;
    this.center.copy(this.origin);
    this.angle = 0.65;
    this.elevation = 0.34;
    this.radius = this.baseRadius * this.fitScale;
    this.position.copy(this.center).sub(this.forward().mulScalar(this.radius));
    this.update();
  }
  resize(width: number, height: number) {
    const scale = Math.max(1, height / width);
    this.radius *= scale / this.fitScale;
    this.fitScale = scale;
    if (this.interactive) this.update();
  }
  benchmark(progress: number, mode: MotionMode) {
    const path = this.cameraPath;
    if (path?.mode === "frozen") {
      this.position.set(...path.eye);
      this.emit(new Vec3(...path.target), true, new Vec3(...path.up));
      return;
    }
    if (path?.mode === "orbit") {
      const turns =
        mode === "stationary"
          ? 0
          : mode === "slow"
            ? 0.28
            : mode === "fast"
              ? 1.5
              : 1;
      const angle = path.startAngle + progress * Math.PI * 2 * turns;
      const [x, y, z] = path.center;
      this.position.set(
        x + Math.sin(angle) * path.radius,
        y + path.height,
        z + Math.cos(angle) * path.radius,
      );
      this.emit(new Vec3(x, y + path.height, z), true);
      return;
    }
    const r = this.baseRadius * this.fitScale,
      p = cameraPose(progress, mode, r);
    this.position.set(
      this.origin.x + p[0],
      this.origin.y + (p[1] * r) / 5.3,
      this.origin.z + p[2],
    );
    this.emit(this.origin, true);
  }
  dispose() {
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.gizmo.dispose();
    this.cleanup();
  }
}
