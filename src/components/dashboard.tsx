"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Box,
  Clock3,
  Filter,
  Globe2,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  Users,
  WifiOff,
} from "lucide-react";
import { getCommunity, type CommunityRecord } from "@/core/community";
import { DataBars, FrameChart } from "./charts";
import { Empty, Footer, Header, Metric, ms } from "./ui";
import { Report } from "./report";
const tabs = [
  "Frame pacing",
  "Loading",
  "Graphics API",
  "Browsers",
  "Hardware",
  "Trends",
  "Activity",
];
export function Dashboard() {
  const [data, setData] = useState<Awaited<
      ReturnType<typeof getCommunity>
    > | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(true),
    [filters, setFilters] = useState<Record<string, string>>({
      source: "reference",
    }),
    [tab, setTab] = useState(tabs[0]),
    [selected, setSelected] = useState<CommunityRecord | null>(null);
  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value) params.set(key, value);
      setData(await getCommunity(params));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }, [filters]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const rows = data?.results ?? [];
  const groups = useMemo(() => {
    const grouped = new Map<string, CommunityRecord[]>();
    for (const r of rows) {
      const label =
        tab === "Loading"
          ? r.scene.format.toUpperCase()
          : tab === "Graphics API"
            ? r.api.toUpperCase()
            : tab === "Browsers"
              ? r.device.browser
              : tab === "Hardware"
                ? r.device.gpu
                : r.renderer;
      grouped.set(label, [...(grouped.get(label) ?? []), r]);
    }
    return Array.from(grouped, ([label, list]) => ({
      label,
      value:
        tab === "Hardware"
          ? list.length
          : list.reduce(
              (s, r) =>
                s +
                (tab === "Loading" ? r.loading.totalMs : 1000 / r.stats.median),
              0,
            ) / list.length,
      n: list.length,
    }));
  }, [rows, tab]);
  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of [...rows].reverse()) {
      const day = (r.receivedAt ?? r.createdAt).slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return Array.from(map, ([label, n]) => ({ label, value: n, n }));
  }, [rows]);
  const filter = (key: string, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  return (
    <div className="application">
      <Header active="Dashboard" />
      <main className="dashboard">
        <div className="dashboard-heading">
          <div>
            <div className="eyebrow">
              COMMUNITY OBSERVATORY{" "}
              <span className="live-tag">
                <i className="status-dot" />
                LIVE DATA
              </span>
            </div>
            <h1>Rendering, in perspective.</h1>
            <p>
              Explore Gaussian performance across engines, browsers, and
              hardware.
            </p>
          </div>
          <button className="button quiet" disabled={pending} onClick={refresh}>
            <RefreshCw size={14} className={pending ? "spin" : ""} />
            Refresh
          </button>
        </div>
        <div className="filter-bar">
          <Filter size={15} />
          <span className="filter-label">EXPLORE</span>
          <FilterSelect
            label="Date range"
            value={filters.days}
            onChange={(v) => filter("days", v)}
            options={[
              ["", "All time"],
              ["7", "Last 7 days"],
              ["30", "Last 30 days"],
              ["90", "Last 90 days"],
            ]}
          />
          <FilterSelect
            label="Renderer filter"
            value={filters.renderer}
            onChange={(v) => filter("renderer", v)}
            options={[
              ["", "All renderers"],
              ["PlayCanvas", "PlayCanvas"],
            ]}
          />
          <FilterSelect
            label="API filter"
            value={filters.api}
            onChange={(v) => filter("api", v)}
            options={[
              ["", "All APIs"],
              ["webgl2", "WebGL2"],
              ["webgpu", "WebGPU"],
            ]}
          />
          <FilterSelect
            label="Browser filter"
            value={filters.browser}
            onChange={(v) => filter("browser", v)}
            options={["", "Chrome", "Edge", "Firefox", "Safari"].map((s) => [
              s,
              s || "All browsers",
            ])}
          />
          <FilterSelect
            label="GPU family"
            value={filters.gpu}
            onChange={(v) => filter("gpu", v)}
            options={[
              ["", "All GPUs"],
              ["NVIDIA", "NVIDIA"],
              ["AMD", "AMD"],
              ["Intel", "Intel"],
              ["Apple", "Apple"],
            ]}
          />
          <FilterSelect
            label="Scene filter"
            value={filters.source}
            onChange={(v) => filter("source", v)}
            options={[
              ["reference", "Reference scenes"],
              ["local", "Custom scenes"],
            ]}
          />
          <FilterSelect
            label="Format filter"
            value={filters.format}
            onChange={(v) => filter("format", v)}
            options={[
              ["", "All formats"],
              ["ply", "PLY"],
              ["sog", "SOG"],
            ]}
          />
        </div>
        {error && (
          <div className="api-error" role="alert">
            <WifiOff size={15} />
            {error}
            <button onClick={refresh}>Retry</button>
          </div>
        )}
        <div className="summary-strip">
          <Metric
            label="Benchmark submissions"
            value={data ? data.total.toLocaleString() : "—"}
            hint="Matching current filters"
          />
          <Metric
            label="Unique configurations"
            value={data ? data.configurations.toLocaleString() : "—"}
            hint="Version, device, scene & protocol"
          />
          <Metric
            label="Rendering engines"
            value={data ? String(data.renderers).padStart(2, "0") : "—"}
            hint="Represented in submissions"
          />
          <Metric
            label="Latest submission"
            value={
              rows.length
                ? new Date(
                    rows[0].receivedAt ?? rows[0].createdAt,
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : "—"
            }
            hint={rows.length ? rows[0].renderer : "Waiting for a first result"}
          />
        </div>
        <div className="dashboard-grid">
          <section className="panel analytics-panel">
            <div className="panel-top">
              <div>
                <BarChart3 size={17} />
                <h2>Performance explorer</h2>
              </div>
              <span className="tag">n = {rows.length}</span>
            </div>
            <div className="chart-tabs" role="tablist" aria-label="Analytics">
              {tabs.map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="analytics-content">
              {pending && !data ? (
                <Empty
                  title="Connecting to the observatory"
                  description="Reading the results API…"
                />
              ) : !rows.length ? (
                <div className="empty-chart">
                  <div className="empty-axis">
                    <span>FPS</span>
                    <span>—</span>
                    <span>—</span>
                    <span>—</span>
                  </div>
                  <Empty
                    title={
                      error
                        ? "The observatory is offline"
                        : "A clear view starts with real data."
                    }
                    description={
                      error
                        ? "Your local benchmarks still work. Start the results service to connect the dashboard."
                        : "No submissions match this view yet. Run the reference scene and contribute the first measurement."
                    }
                    action={!error}
                  />
                </div>
              ) : tab === "Frame pacing" ? (
                <div className="scatter-chart">
                  <p className="panel-note">
                    Each mark is one submitted session. Hover or select to
                    inspect; hardware and protocol differ.
                  </p>
                  <svg
                    viewBox="0 0 720 160"
                    role="img"
                    aria-label="Individual session median FPS by renderer"
                  >
                    {[0, 1, 2, 3, 4].map((i) => (
                      <g key={i}>
                        <line
                          x1={50 + i * 155}
                          x2={50 + i * 155}
                          y1="20"
                          y2="130"
                          className="chart-grid"
                        />
                        <text x={50 + i * 155} y="152">
                          {(
                            (Math.max(
                              ...rows.map((r) => 1000 / r.stats.median),
                            ) *
                              i) /
                            4
                          ).toFixed(0)}
                        </text>
                      </g>
                    ))}
                    {rows.map((r, i) => (
                      <circle
                        role="button"
                        tabIndex={0}
                        aria-label={`${r.renderer}, ${(1000 / r.stats.median).toFixed(1)} FPS, ${r.device.gpu}`}
                        key={r.id}
                        cx={
                          50 +
                          (1000 /
                            r.stats.median /
                            Math.max(
                              ...rows.map((r) => 1000 / r.stats.median),
                            )) *
                            620
                        }
                        cy={40 + (i % 6) * 14}
                        r="5"
                        onClick={() => setSelected(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setSelected(r);
                        }}
                      >
                        <title>
                          {r.renderer} · {(1000 / r.stats.median).toFixed(1)}{" "}
                          FPS · {r.device.gpu}
                        </title>
                      </circle>
                    ))}
                  </svg>
                  <div className="chart-caption">
                    <span>Session median FPS →</span>
                    <span>Select a point for report</span>
                  </div>
                </div>
              ) : tab === "Trends" || tab === "Activity" ? (
                <>
                  <p className="panel-note">
                    Submissions by day. Performance trends need a matched
                    device, scene, renderer version and protocol; no
                    mixed-workload trend is inferred.
                  </p>
                  <DataBars data={daily} unit="runs" />
                </>
              ) : (
                <>
                  <p className="panel-note">
                    {tab === "Hardware"
                      ? "Submitted GPU distribution."
                      : "Descriptive means across filtered submissions; not a controlled comparison. Select results below to inspect configurations."}
                  </p>
                  <DataBars
                    data={groups}
                    unit={
                      tab === "Loading"
                        ? "ms to frame"
                        : tab === "Hardware"
                          ? "runs"
                          : "FPS"
                    }
                  />
                </>
              )}
            </div>
            <div className="panel-foot">
              <span>
                <i className="legend-dot" />
                Self-reported measurements
              </span>
              <span>Latest 200 · methodology v1</span>
            </div>
          </section>
          <section className="panel reference-card">
            <div className="panel-top">
              <div>
                <Box size={17} />
                <h2>The reference workload</h2>
              </div>
              <span className="tag">01</span>
            </div>
            <div className="reference-art" aria-hidden="true">
              <div className="orbit-art one" />
              <div className="orbit-art two" />
              <div className="orbit-art three" />
              <div className="orbit-base" />
              <span>ORBITAL / V1</span>
            </div>
            <div className="reference-description">
              <span className="eyebrow">SMALL SCENE. REPEATABLE TEST.</span>
              <h3>Orbital study</h3>
              <p>
                47,000 Gaussians. Three interlocking forms. One shared starting
                point.
              </p>
              <div className="reference-tags">
                <span>PLY</span>
                <span>3.05 MiB</span>
                <span>MIT</span>
              </div>
              <Link href="/benchmark/" className="button full-width">
                Open in the laboratory
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </section>
          <section className="panel recent-panel">
            <div className="panel-top">
              <div>
                <Layers size={17} />
                <h2>Recent measurements</h2>
                <span className="tag">{rows.length}</span>
              </div>
              <Link href="/results/">
                Explore results
                <ArrowRight size={14} />
              </Link>
            </div>
            <ResultsTable rows={rows.slice(0, 6)} onSelect={setSelected} />
          </section>
          <section className="panel community-note">
            <div className="eyebrow">
              <Globe2 size={14} /> BUILT IN THE OPEN
            </div>
            <h3>Your hardware adds a perspective.</h3>
            <p>
              Benchmark without an account. Inspect every field before sharing.
              Local scene files stay on your device.
            </p>
            <div>
              <span>
                <i className="status-dot" />
                No universal score
              </span>
              <span>Raw metrics. Clear methodology.</span>
            </div>
          </section>
        </div>
      </main>
      <Footer />
      {selected && (
        <Report result={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (s: string) => void;
  options: string[][];
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map(([v, l]) => (
        <option value={v} key={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
export function ResultsTable({
  rows,
  onSelect,
}: {
  rows: CommunityRecord[];
  onSelect: (r: CommunityRecord) => void;
}) {
  const [sort, setSort] = useState<"date" | "fps" | "renderer">("date"),
    [ascending, setAscending] = useState(false);
  const sorted = [...rows].sort((a, b) => {
    const diff =
      sort === "fps"
        ? 1000 / a.stats.median - 1000 / b.stats.median
        : sort === "renderer"
          ? a.renderer.localeCompare(b.renderer)
          : Date.parse(a.receivedAt ?? a.createdAt) -
            Date.parse(b.receivedAt ?? b.createdAt);
    return diff * (ascending ? 1 : -1);
  });
  function change(next: typeof sort) {
    if (sort === next) setAscending(!ascending);
    else {
      setSort(next);
      setAscending(false);
    }
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th
              aria-sort={
                sort === "renderer"
                  ? ascending
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button onClick={() => change("renderer")}>
                Renderer
                <ArrowDownUp size={11} />
              </button>
            </th>
            <th>Scene / format</th>
            <th>Browser / GPU</th>
            <th
              aria-sort={
                sort === "fps"
                  ? ascending
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button onClick={() => change("fps")}>
                Median FPS
                <ArrowDownUp size={11} />
              </button>
            </th>
            <th>P95 ms</th>
            <th
              aria-sort={
                sort === "date"
                  ? ascending
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button onClick={() => change("date")}>
                Date
                <ArrowDownUp size={11} />
              </button>
            </th>
            <th>
              <span className="sr-only">Report</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.renderer}</b>
                <small>{r.api.toUpperCase()}</small>
              </td>
              <td>
                {r.scene.source === "reference" ? "Orbital v1" : "Custom"}
                <small>
                  {r.scene.format.toUpperCase()} · {r.config.motion}
                </small>
              </td>
              <td className="gpu-cell">
                {r.device.browser}
                <small title={r.device.gpu}>{r.device.gpu}</small>
              </td>
              <td className="numeric">{(1000 / r.stats.median).toFixed(1)}</td>
              <td className="numeric muted">{ms(r.stats.p95)}</td>
              <td>
                {new Date(r.receivedAt ?? r.createdAt).toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric" },
                )}
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`View report ${r.id}`}
                  onClick={() => onSelect(r)}
                >
                  <ArrowUpRight size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="table-empty">
          <Layers size={20} />
          <span>No measurements yet</span>
          <small>Completed and submitted runs appear here.</small>
        </div>
      )}
    </div>
  );
}
