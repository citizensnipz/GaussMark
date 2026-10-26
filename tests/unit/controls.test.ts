import { describe, it, expect, vi, afterEach } from "vitest";
import { SceneControls } from "../../src/renderers/controls";
import { Vec3 } from "playcanvas";
function setup(profile: "PlayCanvas" | "WebSplatter") {
  const element = () => ({
    classList: { add() {} },
    style: {},
    setAttribute() {},
    addEventListener() {},
    appendChild() {},
    remove() {},
  });
  vi.stubGlobal("document", {
    createElementNS: element,
    pointerLockElement: null,
  });
  vi.stubGlobal("window", new EventTarget());
  const canvas = Object.assign(new EventTarget(), {
    clientWidth: 1000,
    clientHeight: 600,
    parentElement: element(),
  }) as unknown as HTMLCanvasElement;
  let last: { eye: Vec3; up: Vec3 } | undefined;
  const c = new SceneControls(
    canvas,
    (eye, target, up) => {
      last = { eye: eye.clone(), up: up.clone() };
    },
    profile,
  );
  const key = (code: string, type = "keydown") => {
    const e = new Event(type);
    Object.defineProperty(e, "code", { value: code });
    canvas.dispatchEvent(e);
  };
  return { c, key, last: () => last! };
}
afterEach(() => vi.unstubAllGlobals());
describe("renderer camera bindings", () => {
  it("PlayCanvas Q/E move vertically in the default orbit mode", () => {
    const { c, key } = setup("PlayCanvas");
    const y = c.position.y;
    key("KeyE");
    c.tick(0.1);
    expect(c.position.y).toBeGreaterThan(y);
    key("KeyE", "keyup");
    key("KeyQ");
    c.tick(0.1);
    expect(c.position.y).toBeCloseTo(y);
    c.dispose();
  });
  it("WebSplatter Q rolls without translating and Space moves camera up", () => {
    const { c, key, last } = setup("WebSplatter");
    const pos = c.position.clone(),
      up = last().up.clone();
    key("KeyQ");
    c.tick(0.1);
    expect(c.position.equals(pos)).toBe(true);
    expect(last().up.equals(up)).toBe(false);
    key("KeyQ", "keyup");
    key("Space");
    c.tick(0.1);
    expect(c.position.y).toBeGreaterThan(pos.y);
    c.dispose();
  });
  it("inspection roll and held keys cannot change the benchmark route", () => {
    const a = setup("WebSplatter");
    a.key("KeyQ");
    a.c.tick(0.1);
    a.c.setInteractive(false);
    a.c.benchmark(0.5, "orbit");
    const expected = a.last();
    a.key("Space");
    a.c.tick(0.1);
    expect(a.last().eye.equals(expected.eye)).toBe(true);
    a.c.reset();
    a.c.benchmark(0.5, "orbit");
    expect(a.last().eye.equals(expected.eye)).toBe(true);
    expect(a.last().up.equals(expected.up)).toBe(true);
    a.c.dispose();
  });
});

describe("interior paths", () => {
  it("keeps radius and height constant and restores the inspection camera", () => {
    const { c, last } = setup("PlayCanvas"),
      before = c.position.clone();
    c.setCameraPath({
      mode: "orbit",
      center: [10, 2, -4],
      radius: 1.25,
      height: 1.6,
      startAngle: 0,
    });
    c.setInteractive(false);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      c.benchmark(t, "orbit");
      const eye = last().eye;
      expect(Math.hypot(eye.x - 10, eye.z + 4)).toBeCloseTo(1.25);
      expect(eye.y).toBeCloseTo(3.6);
    }
    c.setInteractive(true);
    expect(c.position.equals(before)).toBe(true);
    c.dispose();
  });
  it("holds frozen position and up direction even under fast motion", () => {
    const { c, last, key } = setup("WebSplatter");
    key("KeyQ");
    c.tick(0.1);
    key("KeyQ", "keyup");
    const pose = c.captureCamera();
    c.setCameraPath(pose);
    c.setInteractive(false);
    for (const t of [0, 0.5, 1]) {
      c.benchmark(t, "fast");
      expect(last().eye.equals(new Vec3(...pose.eye))).toBe(true);
      expect(last().up.equals(new Vec3(...pose.up))).toBe(true);
    }
    c.dispose();
  });
});

describe("object centering", () => {
  it("rebases an offset scene while preserving its rendered camera position", () => {
    const { c, last } = setup("PlayCanvas");
    c.origin.set(100, 20, -50);
    c.reset();
    const before = last().eye.clone();
    c.normalizeOrigin();
    expect(c.origin.equals(Vec3.ZERO)).toBe(true);
    expect(last().eye.distance(before)).toBeLessThan(0.00001);
    c.centerObject();
    expect(c.gridOrigin.equals(Vec3.ZERO)).toBe(true);
    c.setCameraPath({
      mode: "orbit",
      center: [0, 0, 0],
      radius: 2,
      height: 1,
      startAngle: 0,
    });
    c.benchmark(0, "orbit");
    expect(last().eye.equals(new Vec3(100, 21, -48))).toBe(true);
  });
});
