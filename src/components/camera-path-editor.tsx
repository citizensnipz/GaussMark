"use client";
import { useState } from "react";
import type { CameraPath, RendererAdapter } from "@/core/types";
export function CameraPathEditor({
  path,
  onChange,
  adapter,
  disabled,
  sceneKey,
  rotation,
  onRotation,
}: {
  path: CameraPath | undefined;
  onChange: (p: CameraPath | undefined) => void;
  adapter: RendererAdapter | null;
  disabled: boolean;
  sceneKey?: string;
  rotation: [number, number, number];
  onRotation: (r: [number, number, number]) => void;
}) {
  const [message, setMessage] = useState("");
  const centerHere = () => {
    if (!adapter) return;
    const pose = adapter.captureCamera();
    onChange({
      mode: "orbit",
      center: [pose.eye[0], pose.eye[1] - 1.6, pose.eye[2]],
      radius: 1,
      height: 1.6,
      startAngle: 0,
    });
  };
  const update = (key: "radius" | "height" | "startAngle", value: number) => {
    if (path?.mode === "orbit" && Number.isFinite(value))
      onChange({
        ...path,
        [key]: key === "radius" ? Math.max(0.01, value) : value,
      });
  };
  return (
    <section className="camera-path-editor">
      <h3 className="section-label">CAMERA SETUP</h3>
      <label>
        Benchmark view
        <select
          aria-label="Benchmark view"
          disabled={disabled}
          value={path?.mode ?? "automatic"}
          onChange={(e) => {
            setMessage("");
            if (e.target.value === "automatic") onChange(undefined);
            else if (e.target.value === "frozen" && adapter)
              onChange(adapter.captureCamera());
            else centerHere();
          }}
        >
          <option value="automatic">Automatic scene framing</option>
          <option value="orbit">Interior circle</option>
          <option value="frozen">Freeze current view</option>
        </select>
      </label>
      {path?.mode === "orbit" && (
        <>
          <p>
            Drag the gold center on the grid to position the orbit; drag the
            circle to resize. Values use scene units.
          </p>
          <div className="path-fields">
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <label key={axis}>
                Center {axis}
                <input
                  aria-label={`Orbit center ${axis}`}
                  disabled={disabled}
                  type="number"
                  step="0.1"
                  value={Number(path.center[index].toFixed(3))}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    if (Number.isFinite(n))
                      onChange({
                        ...path,
                        center: path.center.map((v, i) =>
                          i === index ? n : v,
                        ) as [number, number, number],
                      });
                  }}
                />
              </label>
            ))}
            <label>
              Radius
              <input
                aria-label="Orbit radius"
                disabled={disabled}
                type="number"
                min="0.01"
                max="1000000"
                step="0.1"
                value={Number(path.radius.toFixed(3))}
                onChange={(e) => update("radius", e.target.valueAsNumber)}
              />
            </label>
            <label>
              Camera height
              <input
                aria-label="Orbit camera height"
                disabled={disabled}
                type="number"
                step="0.1"
                value={path.height}
                onChange={(e) => update("height", e.target.valueAsNumber)}
              />
            </label>
            <label>
              Start angle °
              <input
                aria-label="Orbit start angle"
                disabled={disabled}
                type="number"
                step="15"
                value={Math.round((path.startAngle * 180) / Math.PI)}
                onChange={(e) =>
                  update("startAngle", (e.target.valueAsNumber * Math.PI) / 180)
                }
              />
            </label>
          </div>
          <button className="button" disabled={disabled} onClick={centerHere}>
            Center grid beneath camera
          </button>
          <p>
            The camera travels above this circle, always facing inward. Orbit
            stress makes one full turn; slow/fast retain their turn counts.
          </p>
        </>
      )}
      {path?.mode === "frozen" && (
        <>
          <p>
            The exact position and viewing direction are held for the entire
            run.
          </p>
          <button
            className="button"
            disabled={disabled}
            onClick={() => adapter && onChange(adapter.captureCamera())}
          >
            Capture current view again
          </button>
        </>
      )}
      {path && (
        <button
          className="button"
          disabled={disabled}
          onClick={() => adapter?.previewCameraPath()}
        >
          Preview saved camera
        </button>
      )}
      <div className="actions">
        <button
          className="button"
          disabled={disabled || !sceneKey}
          onClick={() => {
            try {
              localStorage.setItem(
                `gaussmark.camera.${sceneKey}`,
                JSON.stringify({ path, rotation }),
              );
              setMessage(
                "Camera setup and object rotation saved for this file.",
              );
            } catch {
              setMessage("Could not save: browser storage unavailable.");
            }
          }}
        >
          Save setup
        </button>
        <button
          className="button"
          disabled={disabled || !sceneKey}
          onClick={() => {
            try {
              const saved = JSON.parse(
                localStorage.getItem(`gaussmark.camera.${sceneKey}`) || "null",
              );
              if (!saved) throw Error("No saved setup for this file.");
              if (
                !Array.isArray(saved.rotation) ||
                saved.rotation.length !== 3 ||
                !saved.rotation.every(Number.isFinite)
              )
                throw Error("Invalid saved setup.");
              const p = saved.path;
              const vec = (v: unknown) =>
                Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
              if (
                p &&
                !(
                  (p.mode === "orbit" &&
                    vec(p.center) &&
                    Number.isFinite(p.radius) &&
                    p.radius > 0 &&
                    Number.isFinite(p.height) &&
                    Number.isFinite(p.startAngle)) ||
                  (p.mode === "frozen" &&
                    vec(p.eye) &&
                    vec(p.target) &&
                    vec(p.up))
                )
              )
                throw Error("Invalid saved camera.");
              onRotation(saved.rotation);
              onChange(p);
              setMessage("Saved setup restored. Preview it before running.");
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Restore setup
        </button>
      </div>
      <small role="status">
        {message ||
          "Setup is included in results and copied with saved A’s settings."}
      </small>
    </section>
  );
}
