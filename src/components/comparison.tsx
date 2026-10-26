"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { BenchmarkResult } from "@/core/types";
import {
  readComparison,
  saveComparison,
  comparisonIssues,
  type ComparisonSlots,
} from "@/core/comparison";
import { downloadResult } from "@/core/storage";
export function SaveComparison({ result }: { result: BenchmarkResult }) {
  const [message, setMessage] = useState("");
  return (
    <div className="comparison-save">
      <div className="actions">
        {(["A", "B"] as const).map((slot) => (
          <button
            className="button"
            key={slot}
            onClick={() => {
              try {
                saveComparison(slot, result);
                setMessage(
                  `Saved as ${slot}. Kept in this browser until you replace it.`,
                );
              } catch {
                setMessage(
                  "Browser storage is full. Export this result to keep it.",
                );
              }
            }}
          >
            Save as {slot}
          </button>
        ))}
        <Link className="button" href="/results/#comparison">
          Compare A/B
        </Link>
      </div>
      <small role="status">
        {message ||
          "Saving replaces that comparison slot. Results stay on this device."}
      </small>
    </div>
  );
}
export function Comparison() {
  const [slots, setSlots] = useState<ComparisonSlots>({});
  useEffect(() => {
    const update = () => setSlots(readComparison());
    update();
    window.addEventListener("gaussmark-comparison", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("gaussmark-comparison", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const { A: a, B: b } = slots,
    issues = a && b ? comparisonIssues(a, b) : [];
  const metrics: [string, (r: BenchmarkResult) => number, string, boolean][] = [
    ["Median FPS", (r) => 1000 / r.stats.median, "fps", true],
    ["Median frame", (r) => r.stats.median, "ms", false],
    ["P95 frame", (r) => r.stats.p95, "ms", false],
    ["P99 frame", (r) => r.stats.p99, "ms", false],
    ["Load to frame", (r) => r.loading.totalMs, "ms", false],
    ["Samples", (r) => r.stats.count, "", true],
  ];
  return (
    <section className="panel comparison-panel" id="comparison">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">SAVED COMPARISON</span>
          <h2>A / B</h2>
          <p>
            Save a completed run into each slot from the benchmark or a session
            report.
          </p>
        </div>
        <Link className="button" href="/benchmark/">
          Run another test
        </Link>
      </div>
      <div className="comparison-cards">
        {(["A", "B"] as const).map((slot) => {
          const r = slots[slot];
          return (
            <article key={slot}>
              <span className="eyebrow">RUN {slot}</span>
              {r ? (
                <>
                  <h3>
                    {r.renderer} · {r.api.toUpperCase()}
                  </h3>
                  <p>
                    {r.rendererVersion} ·{" "}
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                  <p>
                    {r.scene.name} · {r.config.width} × {r.config.height} ·{" "}
                    {r.config.motion}
                  </p>
                  <p>
                    {r.config.repeats} × {r.config.durationSeconds}s · rotation{" "}
                    {(r.config.objectRotation ?? [0, 0, 0]).join(" / ")}°
                  </p>
                  <small>
                    File SHA-256: {r.scene.sha256 ?? "Unknown (older result)"}
                  </small>
                  <p>
                    {r.device.browser} / {r.device.os} · {r.device.gpu}
                  </p>
                  <button className="button" onClick={() => downloadResult(r)}>
                    Export {slot}
                  </button>
                </>
              ) : (
                <p>No run saved. Choose “Save as {slot}” after a benchmark.</p>
              )}
            </article>
          );
        })}
      </div>
      {a && b && (
        <>
          <div className="notice" role="status">
            {issues.length ? (
              <>
                <strong>Settings do not match</strong>
                <ul>
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
                Measurements are shown for inspection; percentage comparisons
                are hidden.
              </>
            ) : (
              <>
                <strong>Same file and test settings.</strong> B is compared
                against A below.{" "}
                {a.api !== b.api
                  ? "Graphics APIs differ; this compares renderer/API combinations. "
                  : ""}
                Renderer defaults, culling, colour and sorting can differ; these
                are performance measurements, not a visual-quality equivalence
                claim.
              </>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>A</th>
                  <th>B</th>
                  <th>B vs A</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(([label, get, unit, higher]) => {
                  const av = get(a),
                    bv = get(b),
                    change = (bv / av - 1) * 100;
                  const comparable =
                    !issues.length &&
                    label !== "Samples" &&
                    Number.isFinite(av) &&
                    Number.isFinite(bv);
                  const close =
                    Math.abs(av - bv) <=
                    Math.max(Math.abs(av), Math.abs(bv)) * 0.01;
                  const aBetter = higher ? av > bv : av < bv;
                  const aStatus = !comparable
                    ? undefined
                    : close
                      ? "similar"
                      : aBetter
                        ? "better"
                        : "worse";
                  const bStatus = !comparable
                    ? undefined
                    : close
                      ? "similar"
                      : aBetter
                        ? "worse"
                        : "better";
                  return (
                    <tr key={label}>
                      <th>{label}</th>
                      <td
                        className={
                          aStatus ? `comparison-${aStatus}` : undefined
                        }
                        title={aStatus === "similar" ? "Within 1%" : aStatus}
                      >
                        {av.toFixed(2)} {unit}
                      </td>
                      <td
                        className={
                          bStatus ? `comparison-${bStatus}` : undefined
                        }
                        title={bStatus === "similar" ? "Within 1%" : bStatus}
                      >
                        {bv.toFixed(2)} {unit}
                      </td>
                      <td>
                        {issues.length ||
                        !Number.isFinite(change) ||
                        label === "Samples"
                          ? "—"
                          : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% (${higher ? "higher is better" : "lower is better"})`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Green: better · Red: worse · Amber: within 1%. Sample counts and
            mismatched tests are unranked. Frame intervals include display
            pacing and browser scheduling. Load times include different parsers
            and cache conditions; they are not controlled cold-load comparisons.
          </p>
        </>
      )}
    </section>
  );
}
