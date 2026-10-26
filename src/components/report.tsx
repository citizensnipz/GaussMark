"use client";
import { useState } from "react";
import { Download, Upload, Check, ShieldCheck } from "lucide-react";
import type { BenchmarkResult } from "@/core/types";
import type { CommunityRecord } from "@/core/community";
import { submissionPayload, submitResult } from "@/core/community";
import { downloadResult } from "@/core/storage";
import { FrameChart, Histogram } from "./charts";
import { Metric, Modal, ms, bytes } from "./ui";
import { SaveComparison } from "./comparison";
export function Report({
  result,
  onClose,
}: {
  result: BenchmarkResult | CommunityRecord;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState(false),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const local = "frames" in result;
  const frames = local ? result.frames.flat() : [];
  async function submit() {
    if (!local || !consent) return;
    setBusy(true);
    try {
      await submitResult(result);
      setMessage(
        "Submitted. Your result is now available on the community dashboard.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Benchmark report" onClose={onClose}>
      <div className="report-body">
        <div className="eyebrow">
          {result.scene.source === "reference"
            ? "STANDARD REFERENCE"
            : "CUSTOM SCENE"}{" "}
          · {result.methodology}
        </div>
        <h3>
          {result.scene.name}{" "}
          <span className="tag">{result.api.toUpperCase()}</span>
        </h3>
        <p className="muted">
          {result.renderer} {result.rendererVersion} · {result.device.browser} /{" "}
          {result.device.os} · {new Date(result.createdAt).toLocaleString()}
        </p>
        {local && <SaveComparison key={result.id} result={result} />}
        <div className="report-metrics">
          <Metric
            label="Median FPS"
            value={(1000 / result.stats.median).toFixed(1)}
          />
          <Metric
            label="P95 frame time"
            value={ms(result.stats.p95)}
            unit="ms"
          />
          <Metric
            label="P99 frame time"
            value={ms(result.stats.p99)}
            unit="ms"
          />
          <Metric label="Samples" value={result.stats.count.toLocaleString()} />
        </div>
        {frames.length > 0 && (
          <>
            <FrameChart values={frames} />
            <Histogram values={frames} />
          </>
        )}
        <dl className="details">
          <dt>Device GPU (reported)</dt>
          <dd>{result.device.gpu}</dd>
          <dt>Render target</dt>
          <dd>
            {result.config.width} × {result.config.height}
          </dd>
          <dt>Protocol</dt>
          <dd>
            {result.config.repeats} × {result.config.durationSeconds}s ·{" "}
            {result.config.warmupSeconds}s warm-up each · {result.config.motion}
          </dd>
          <dt>Camera setup</dt>
          <dd>
            {result.config.cameraPath?.mode === "orbit"
              ? `Interior circle · center ${result.config.cameraPath.center.join(", ")} · radius ${result.config.cameraPath.radius} · height ${result.config.cameraPath.height}`
              : result.config.cameraPath?.mode === "frozen"
                ? `Frozen view · position ${result.config.cameraPath.eye.join(", ")}`
                : "Automatic scene framing"}
          </dd>
          <dt>Asset</dt>
          <dd>
            {bytes(result.loading.bytes)} ·{" "}
            {result.loading.gaussians?.toLocaleString() ?? "Unknown"} Gaussians
          </dd>
          <dt>Analysis</dt>
          <dd>Rust / WebAssembly · interpolated percentiles</dd>
        </dl>
        <div className="notice">
          These are browser frame intervals, including scheduling and display
          pacing. They are not GPU execution times. Community submissions are
          self-reported.
        </div>
        {local && (
          <div className="actions">
            <button className="button" onClick={() => downloadResult(result)}>
              <Download size={15} />
              Export full JSON
            </button>
            <button
              className="button primary"
              onClick={() => setPreview(!preview)}
            >
              <Upload size={15} />
              Preview submission
            </button>
          </div>
        )}
        {preview && local && (
          <section className="submission">
            <h4>
              <ShieldCheck size={16} />
              Review technical data
            </h4>
            <p>
              No file contents, custom filenames, account identifiers, or raw
              frame samples are sent. The technical fields below will be public.
              Your IP is used only for a short-lived hashed rate-limit key.
            </p>
            <pre>{JSON.stringify(submissionPayload(result), null, 2)}</pre>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Share this technical record publicly
            </label>
            <button
              className="button primary"
              disabled={!consent || busy || message.startsWith("Submitted")}
              onClick={submit}
            >
              <Check size={15} />
              {busy ? "Submitting…" : "Submit result"}
            </button>
          </section>
        )}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
      </div>
    </Modal>
  );
}
