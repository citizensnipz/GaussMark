"use client";
import { useEffect, useRef, useState } from "react";

type Sample = {
  t: number;
  heapBytes: number | null;
  cpuBusyPercent: number | null;
  bytesPerSecond: number | null;
};
type Attempt = {
  variant: string;
  cycle: number;
  status: string;
  navigationMs?: number;
  transferredBytes?: number;
  peakHeapBytes?: number;
  samples: Sample[];
  requests: {
    id: number;
    type: string;
    bytes: number;
    status: number | null;
    cached: boolean;
    failed: boolean;
  }[];
  events: { name: string; t: number; value?: number }[];
  unavailable: string[];
  frameIntervals?: { median: number; p95: number; count: number };
  instrumented?: boolean;
};
type Report = {
  schema: string;
  startedAt: string;
  browser: string;
  cache: string;
  notes: string[];
  attempts: Attempt[];
};
function Chart({
  samples,
  field,
  title,
  divisor = 1,
}: {
  samples: Sample[];
  field: keyof Sample;
  title: string;
  divisor?: number;
}) {
  const values = samples
    .map((s) => s[field])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const max = Math.max(1, ...values);
  return (
    <div>
      <strong>{title}</strong>
      <svg
        viewBox="0 0 600 100"
        role="img"
        aria-label={title}
        style={{
          width: "100%",
          height: 100,
          background: "var(--bg-secondary)",
        }}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={samples
            .map((s, i) =>
              s[field] === null
                ? ""
                : `${(i / Math.max(1, samples.length - 1)) * 600},${95 - (Number(s[field]) / max) * 90}`,
            )
            .join(" ")}
        />
      </svg>
      <small>Peak {(max / divisor).toFixed(1)} · sampled every ~500 ms</small>
    </div>
  );
}
export function ExternalLink({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(""),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [repeats, setRepeats] = useState(3),
    [seconds, setSeconds] = useState(15),
    [cache, setCache] = useState("cold");
  const [connected, setConnected] = useState(false),
    [running, setRunning] = useState(false),
    [report, setReport] = useState<Report | null>(null),
    [message, setMessage] = useState("");
  const busy = useRef(false);
  async function request(path: string, body?: unknown) {
    const res = await fetch("http://127.0.0.1:3027" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok)
      throw Error(
        "Runner request failed. Check the pairing token and whether another run is active.",
      );
    return res.json();
  }
  async function poll() {
    if (busy.current) return;
    busy.current = true;
    try {
      const s = await request("/status");
      setReport(s.report);
      if (s.error)
        setMessage(
          "Browser could not start or the run failed. Check that Chrome is installed and the runner can launch it.",
        );
      setRunning(s.running);
      setConnected(true);
    } catch {
      setConnected(false);
      setMessage(
        "Cannot reach runner. Start npm run external:runner and pair again.",
      );
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => void poll(), 1000);
    return () => clearInterval(id);
  }, [connected, token]); // Session credentials remain in memory.
  async function run() {
    try {
      setMessage("");
      await request("/run", { a, b, repeats, seconds, cache });
      setRunning(true);
      await poll();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function exportReport() {
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = u;
    link.download = "external-benchmark.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <div
      className="external-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="External Link benchmark"
    >
      <section className="external-panel">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>External Link</h2>
          <button className="button" disabled={running} onClick={onClose}>
            Close
          </button>
        </div>
        <p>
          Open your editor or viewer in a controlled Chrome window. Keep that
          window visible during measurement. Links and tokens are held only for
          this session and excluded from reports.
        </p>
        <p>
          Start the local runner: <code>npm run external:runner</code>. Paste
          its pairing token below.
        </p>
        <div className="external-fields">
          <label>
            Pairing token
            <input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setConnected(false);
              }}
              disabled={running}
            />
          </label>
          <button
            className="button"
            disabled={running || !token}
            onClick={() => void poll()}
          >
            {connected ? "Connected" : "Connect"}
          </button>
          <label>
            Scene A URL
            <input
              type="password"
              autoComplete="off"
              value={a}
              onChange={(e) => setA(e.target.value)}
              disabled={running}
            />
          </label>
          <label>
            Scene B URL (optional)
            <input
              type="password"
              autoComplete="off"
              value={b}
              onChange={(e) => setB(e.target.value)}
              disabled={running}
            />
          </label>
          <label>
            Runs per variant
            <input
              type="number"
              min={1}
              max={10}
              value={repeats}
              onChange={(e) => setRepeats(+e.target.value)}
              disabled={running}
            />
          </label>
          <label>
            Observation seconds after DOM ready
            <input
              type="number"
              min={5}
              max={120}
              value={seconds}
              onChange={(e) => setSeconds(+e.target.value)}
              disabled={running}
            />
          </label>
          <label>
            Cache
            <select
              value={cache}
              onChange={(e) => setCache(e.target.value)}
              disabled={running}
            >
              <option value="cold">
                Fresh context / browser cache disabled
              </option>
              <option value="warm">
                Reuse context per variant (first run unprimed)
              </option>
            </select>
          </label>
        </div>
        <p>
          DOM ready is not scene readiness. Without viewer instrumentation, this
          records a fixed observation window, not a successful scene-load time.
          Authentication must work in a fresh browser context.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="button primary"
            disabled={!connected || running || !a}
            onClick={() => void run()}
          >
            Run external benchmark
          </button>
          <button
            className="button"
            disabled={!running}
            onClick={() =>
              void request("/stop", {})
                .then(poll)
                .catch(() =>
                  setMessage(
                    "Unable to stop; close the controlled Chrome window.",
                  ),
                )
            }
          >
            Stop
          </button>
          <button className="button" disabled={!report} onClick={exportReport}>
            Export sanitized JSON
          </button>
        </div>
        <p role="status">
          {message || (running ? "Recording in Chrome…" : "")}
        </p>
        {report && (
          <>
            <p>
              {report.browser} · {report.cache} · serial alternating A/B order.
              Results describe the viewer and delivery path, not isolated format
              efficiency.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Variant / run</th>
                  <th>Status</th>
                  <th>DOM ready</th>
                  <th>Page transfer</th>
                  <th>Peak JS heap</th>
                  <th>Callback p95</th>
                </tr>
              </thead>
              <tbody>
                {report.attempts.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.variant} / {r.cycle}
                    </td>
                    <td>{r.status}</td>
                    <td>{r.navigationMs?.toFixed(0) ?? "—"} ms</td>
                    <td>
                      {r.transferredBytes === undefined
                        ? "—"
                        : (r.transferredBytes / 1e6).toFixed(2)}{" "}
                      MB
                    </td>
                    <td>
                      {r.peakHeapBytes === undefined
                        ? "—"
                        : (r.peakHeapBytes / 1e6).toFixed(1)}{" "}
                      MB
                    </td>
                    <td>{r.frameIntervals?.p95.toFixed(1) ?? "—"} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.attempts.map((r, i) => (
              <details key={i} open={i === report.attempts.length - 1}>
                <summary>
                  {r.variant} / {r.cycle} —{" "}
                  {r.instrumented
                    ? "Viewer milestones received"
                    : "Browser measurements; scene readiness unverified"}
                </summary>
                <Chart
                  samples={r.samples}
                  field="heapBytes"
                  title="JS heap (MB)"
                  divisor={1e6}
                />
                <Chart
                  samples={r.samples}
                  field="cpuBusyPercent"
                  title="Main-thread busy (%)"
                />
                <Chart
                  samples={r.samples}
                  field="bytesPerSecond"
                  title="Received payload throughput (MB/s)"
                  divisor={1e6}
                />
                <h3>Viewer timeline</h3>
                {r.events.length ? (
                  <ul>
                    {r.events.map((e, j) => (
                      <li key={j}>
                        {e.name}: {e.t.toFixed(1)} ms{" "}
                        {e.value === undefined ? "" : `· ${e.value}`}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No instrumented viewer milestones.</p>
                )}
                <p>Unavailable: {r.unavailable.join("; ")}</p>
                <details>
                  <summary>Network requests (URLs removed)</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Bytes</th>
                        <th>Cache</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.requests.map((q, j) => (
                        <tr key={j}>
                          <td>{q.id}</td>
                          <td>{q.type}</td>
                          <td>{q.failed ? "Failed" : q.status}</td>
                          <td>{q.bytes}</td>
                          <td>{q.cached ? "Yes" : "No / unknown"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </details>
            ))}
            <ul>
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
