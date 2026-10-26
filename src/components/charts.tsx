"use client";
import { useState } from "react";
export function FrameChart({
  values,
  compact = false,
  label = "Frame intervals",
}: {
  values: number[];
  compact?: boolean;
  label?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(20, ...values),
    w = 600,
    h = compact ? 62 : 135,
    pad = compact ? 0 : 22;
  const display =
    values.length > 600
      ? values.filter((_, i) => i % Math.ceil(values.length / 600) === 0)
      : values;
  const points = display
    .map(
      (v, i) =>
        `${pad + (i / Math.max(1, display.length - 1)) * (w - pad * 2)},${h - pad - (v / max) * (h - pad * 2)}`,
    )
    .join(" ");
  const select = (x: number, width: number) =>
    setSelected(
      Math.min(
        display.length - 1,
        Math.max(0, Math.round((x / width) * (display.length - 1))),
      ),
    );
  return (
    <div className={`frame-chart ${compact ? "compact" : ""}`}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${label}, ${values.length} samples, maximum ${max.toFixed(1)} milliseconds`}
        onMouseMove={(e) =>
          select(
            e.clientX - e.currentTarget.getBoundingClientRect().left,
            e.currentTarget.getBoundingClientRect().width,
          )
        }
        onMouseLeave={() => setSelected(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad}
              x2={w - pad}
              y1={h - pad - f * (h - pad * 2)}
              y2={h - pad - f * (h - pad * 2)}
              className="chart-grid"
            />
            {!compact && (
              <text x={1} y={h - pad - f * (h - pad * 2) - 3}>
                {(f * max).toFixed(0)}
              </text>
            )}
          </g>
        ))}
        {display.length > 1 && (
          <>
            <polygon
              points={`${pad},${h - pad} ${points} ${w - pad},${h - pad}`}
              className="chart-area"
            />
            <polyline points={points} className="chart-line" />
          </>
        )}
      </svg>
      {!compact && (
        <div className="chart-caption">
          <span>
            {selected != null && display[selected] != null
              ? `Sample ${selected + 1}: ${display[selected].toFixed(2)} ms`
              : "Frame interval · ms"}
          </span>
          <span>
            {values.length.toLocaleString()} samples
            {values.length > 600 ? " · display decimated" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
export function Histogram({ values }: { values: number[] }) {
  const ranges = [0, 8.33, 16.67, 33.33, 50, Infinity];
  const counts = ranges
    .slice(0, -1)
    .map(
      (min, i) => values.filter((v) => v >= min && v < ranges[i + 1]).length,
    );
  const max = Math.max(1, ...counts);
  return (
    <div className="histogram">
      {counts.map((count, i) => (
        <div
          key={i}
          className="hist-row"
          title={`${count} frames (${values.length ? ((100 * count) / values.length).toFixed(1) : 0}%)`}
        >
          <span>
            {i === 4
              ? "50+"
              : `${ranges[i].toFixed(0)}–${ranges[i + 1].toFixed(0)}`}{" "}
            ms
          </span>
          <div>
            <i style={{ width: `${(100 * count) / max}%` }} />
          </div>
          <b>{count.toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}
export function DataBars({
  data,
  unit,
}: {
  data: { label: string; value: number; n: number }[];
  unit: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="data-bars">
      {data.slice(0, 6).map((d, i) => (
        <div className="data-bar" key={d.label}>
          <div>
            <span>{d.label}</span>
            <b>
              {d.value.toFixed(1)} <small>{unit}</small>
            </b>
          </div>
          <div className="bar-track">
            <i
              style={{
                width: `${(100 * d.value) / max}%`,
                opacity: 1 - i * 0.1,
              }}
            />
          </div>
          <small>n = {d.n} submissions</small>
        </div>
      ))}
    </div>
  );
}
