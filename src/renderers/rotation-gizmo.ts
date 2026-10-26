import { Vec3, Quat } from "playcanvas";
import type { SceneControls, Rotation } from "./controls";
const NS = "http://www.w3.org/2000/svg";
/** World-axis rotation handles projected through the same camera as the scene. */
export class RotationGizmo {
  private svg = document.createElementNS(NS, "svg");
  private guide = document.createElementNS(NS, "g");
  private grid = document.createElementNS(NS, "path");
  private circle = document.createElementNS(NS, "path");
  private pivot = document.createElementNS(NS, "circle");
  private paths: SVGPathElement[] = [];
  private active: {
    axis: number;
    vector: Vec3;
    rotation: Quat;
    pointer: number;
  } | null = null;
  enabled = true;
  onChange?: (rotation: Rotation) => void;
  constructor(
    private canvas: HTMLCanvasElement,
    private controls: SceneControls,
  ) {
    this.svg.classList.add("rotation-gizmo");
    this.svg.setAttribute("aria-label", "Object rotation gizmo");
    for (let axis = 0; axis < 3; axis++) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("stroke", ["#ef7272", "#88d887", "#70abff"][axis]);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-width", "3");
      path.setAttribute("role", "slider");
      path.setAttribute("aria-label", `Rotate object ${"XYZ"[axis]}`);
      path.setAttribute("aria-valuemin", "-180");
      path.setAttribute("aria-valuemax", "180");
      path.setAttribute("tabindex", "0");
      path.addEventListener("keydown", (e) => {
        if (!this.enabled || !this.controls.interactive) return;
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        this.rotate(
          axis,
          (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1) *
            (e.shiftKey ? 15 : 1),
          new Quat().setFromEulerAngles(...this.controls.rotation),
        );
      });
      path.addEventListener("pointerdown", (e) => {
        if (!this.enabled || !this.controls.interactive || e.button !== 0)
          return;
        e.stopPropagation();
        e.preventDefault();
        const vector = this.hit(e, axis);
        if (!vector) return;
        this.active = {
          axis,
          vector,
          rotation: new Quat().setFromEulerAngles(...this.controls.rotation),
          pointer: e.pointerId,
        };
        path.setPointerCapture(e.pointerId);
        path.setAttribute("stroke-width", "6");
      });
      path.addEventListener("pointermove", (e) => {
        const drag = this.active;
        if (!drag || drag.axis !== axis) return;
        e.stopPropagation();
        const v = this.hit(e, axis);
        if (!v) return;
        const normal = this.axis(axis),
          cross = new Vec3().cross(drag.vector, v);
        let angle =
          (Math.atan2(normal.dot(cross), drag.vector.dot(v)) * 180) / Math.PI;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15;
        this.rotate(axis, angle, drag.rotation);
      });
      const end = () => {
        this.active = null;
        path.setAttribute("stroke-width", "3");
      };
      path.addEventListener("pointerup", end);
      path.addEventListener("pointercancel", end);
      path.addEventListener("lostpointercapture", end);
      this.svg.appendChild(path);
      this.paths.push(path);
    }
    this.grid.setAttribute("stroke", "#a0b5ac66");
    this.grid.setAttribute("fill", "none");
    this.grid.style.pointerEvents = "none";
    this.circle.setAttribute("stroke", "#f1c76d");
    this.circle.setAttribute("fill", "none");
    this.circle.setAttribute("stroke-width", "3");
    this.circle.setAttribute("aria-label", "Orbit radius handle");
    this.pivot.setAttribute("r", "8");
    this.pivot.setAttribute("fill", "#f1c76d");
    this.pivot.setAttribute("aria-label", "Orbit center handle");
    this.pivot.style.pointerEvents = "all";
    this.pivot.style.cursor = "move";
    this.guide.appendChild(this.grid);
    this.guide.appendChild(this.circle);
    this.guide.appendChild(this.pivot);
    this.svg.appendChild(this.guide);
    for (const [element, resize] of [
      [this.circle, true],
      [this.pivot, false],
    ] as const) {
      let drag = false;
      element.addEventListener("pointerdown", (e) => {
        if (!this.controls.interactive) return;
        e.preventDefault();
        e.stopPropagation();
        drag = true;
        element.setPointerCapture((e as PointerEvent).pointerId);
      });
      element.addEventListener("pointermove", (e) => {
        const path = this.controls.cameraPath;
        if (!drag || path?.mode !== "orbit") return;
        const point = this.hitGrid(e as PointerEvent, path.center[1]);
        if (!point) return;
        const next = resize
          ? {
              ...path,
              radius: Math.max(
                0.01,
                Math.hypot(point.x - path.center[0], point.z - path.center[2]),
              ),
            }
          : {
              ...path,
              center: [point.x, path.center[1], point.z] as [
                number,
                number,
                number,
              ],
            };
        this.controls.cameraPath = next;
        this.controls.onPathChange?.(next);
        this.update();
      });
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
        element.addEventListener(event, () => {
          drag = false;
        });
    }
    canvas.parentElement!.appendChild(this.svg);
  }
  private axis(i: number) {
    return new Vec3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
  }
  private basis() {
    const c = this.controls,
      forward = c.viewTarget.clone().sub(c.position).normalize();
    const right = new Vec3().cross(forward, c.viewUp).normalize();
    return { forward, right, up: new Vec3().cross(right, forward).normalize() };
  }
  private project(point: Vec3) {
    const { forward, right, up } = this.basis(),
      v = point.clone().sub(this.controls.position);
    const depth = v.dot(forward);
    if (depth <= 0.01) return null;
    const h = this.canvas.clientHeight,
      w = this.canvas.clientWidth,
      f = h / (2 * Math.tan((52 * Math.PI) / 360));
    return [
      w / 2 +
        (v.dot(right) * f * (w / h)) /
          (this.canvas.width / this.canvas.height) /
          depth,
      h / 2 - (v.dot(up) * f) / depth,
    ];
  }
  private hit(e: PointerEvent, axis: number) {
    const rect = this.canvas.getBoundingClientRect(),
      { forward, right, up } = this.basis();
    const f = rect.height / (2 * Math.tan((52 * Math.PI) / 360));
    const ray = forward
      .add(
        right.mulScalar(
          (e.clientX - rect.left - rect.width / 2) /
            ((f * (rect.width / rect.height)) /
              (this.canvas.width / this.canvas.height)),
        ),
      )
      .add(up.mulScalar(-(e.clientY - rect.top - rect.height / 2) / f))
      .normalize();
    const normal = this.axis(axis),
      den = normal.dot(ray);
    if (Math.abs(den) < 0.0001) return null;
    const t =
      normal.dot(this.controls.origin.clone().sub(this.controls.position)) /
      den;
    if (t <= 0) return null;
    return this.controls.position
      .clone()
      .add(ray.mulScalar(t))
      .sub(this.controls.origin)
      .normalize();
  }
  private rotate(axis: number, degrees: number, start: Quat) {
    const q = new Quat().setFromAxisAngle(this.axis(axis), degrees).mul(start),
      e = q.getEulerAngles();
    const rotation: Rotation = [e.x, e.y, e.z];
    this.controls.rotation = rotation;
    this.controls.update();
    this.onChange?.(rotation);
  }
  private hitGrid(e: PointerEvent, y: number) {
    const rect = this.canvas.getBoundingClientRect(),
      { forward, right, up } = this.basis(),
      f = rect.height / (2 * Math.tan((52 * Math.PI) / 360));
    const ray = forward
      .add(
        right.mulScalar(
          (e.clientX - rect.left - rect.width / 2) /
            ((f * (rect.width / rect.height)) /
              (this.canvas.width / this.canvas.height)),
        ),
      )
      .add(up.mulScalar(-(e.clientY - rect.top - rect.height / 2) / f));
    if (Math.abs(ray.y) < 0.00001) return null;
    const t = (y - this.controls.position.y) / ray.y;
    if (t <= 0) return null;
    return this.controls.position.clone().add(ray.mulScalar(t));
  }
  private drawGuide() {
    const path = this.controls.cameraPath;
    this.guide.style.display = path?.mode === "orbit" ? "block" : "none";
    if (path?.mode !== "orbit") return;
    const [x, y, z] = path.center,
      r = path.radius;
    const line = (a: Vec3, b: Vec3) => {
      const p = this.project(a),
        q = this.project(b);
      return p && q ? `M${p[0]},${p[1]}L${q[0]},${q[1]} ` : "";
    };
    let grid = "",
      circle = "";
    for (let i = -5; i <= 5; i++) {
      const n = (i * r) / 5;
      grid += line(new Vec3(x + n, y, z - r), new Vec3(x + n, y, z + r));
      grid += line(new Vec3(x - r, y, z + n), new Vec3(x + r, y, z + n));
    }
    for (let i = 0; i < 128; i++) {
      const a = (i * Math.PI) / 64,
        b = ((i + 1) * Math.PI) / 64;
      circle += line(
        new Vec3(x + Math.sin(a) * r, y, z + Math.cos(a) * r),
        new Vec3(x + Math.sin(b) * r, y, z + Math.cos(b) * r),
      );
    }
    this.grid.setAttribute("d", grid);
    this.circle.setAttribute("d", circle);
    const p = this.project(new Vec3(x, y, z));
    this.pivot.style.display = p ? "block" : "none";
    if (p) {
      this.pivot.setAttribute("cx", String(p[0]));
      this.pivot.setAttribute("cy", String(p[1]));
    }
  }
  update() {
    const visible =
      this.controls.interactive &&
      (this.enabled || this.controls.cameraPath?.mode === "orbit");
    this.svg.style.display = visible ? "block" : "none";
    if (!visible) {
      this.active = null;
      return;
    }
    this.drawGuide();
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    // Constant screen-size handles centered on the scene's real pivot.
    const depth = this.controls.origin
      .clone()
      .sub(this.controls.position)
      .dot(this.basis().forward);
    const radius = (depth * 2 * Math.tan((52 * Math.PI) / 360) * 85) / h;
    for (let axis = 0; axis < 3; axis++) {
      this.paths[axis].style.display = this.enabled ? "block" : "none";
      let d = "";
      for (let i = 0; i <= 96; i++) {
        const a = (i * Math.PI * 2) / 96,
          v = new Vec3();
        if (axis === 0) v.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
        if (axis === 1) v.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        if (axis === 2) v.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
        const p = this.project(v.add(this.controls.origin));
        if (!p) {
          d = "";
          break;
        }
        d += `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)} `;
      }
      this.paths[axis].setAttribute("d", d);
      this.paths[axis].setAttribute(
        "aria-valuenow",
        this.controls.rotation[axis].toFixed(1),
      );
    }
  }
  dispose() {
    this.svg.remove();
  }
}
