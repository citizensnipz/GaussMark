"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  Github,
  Moon,
  Sun,
  X,
  Play,
  createLucideIcon,
  Activity,
} from "lucide-react";
// Lucide GPU icon, ISC license: https://github.com/lucide-icons/lucide/blob/main/icons/gpu.svg
export const Gpu = createLucideIcon("Gpu", [
  ["path", { d: "M2 17h18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H2", key: "board" }],
  ["path", { d: "M2 21V3", key: "bracket" }],
  ["path", { d: "M7 17v3a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-3", key: "connector" }],
  ["circle", { cx: "16", cy: "11", r: "2", key: "fan-right" }],
  ["circle", { cx: "8", cy: "11", r: "2", key: "fan-left" }],
]);
export function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(
    () => setTheme(document.documentElement.dataset.theme ?? "dark"),
    [],
  );
  return (
    <button
      className="icon-button"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      aria-label="Toggle theme"
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("gaussmark.theme", next);
        } catch {}
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
export function Header({
  active,
}: {
  active: "Dashboard" | "Benchmark" | "Results";
}) {
  return (
    <header className="app-header">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Gpu size={24} />
        </span>
        <span className="brand-wordmark">GaussMark</span>
        <span className="alpha">ALPHA</span>
      </Link>
      <nav aria-label="Main navigation">
        {[
          ["Dashboard", "/"],
          ["Benchmark", "/benchmark/"],
          ["Results", "/results/"],
        ].map(([name, url]) => (
          <Link
            key={name}
            className={name === active ? "active" : ""}
            href={url}
            aria-current={name === active ? "page" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      <div className="header-right">
        <span className="header-caption">OPEN GRAPHICS LABORATORY</span>
        <ThemeToggle />
        <a
          className="icon-button"
          aria-label="GaussMark on GitHub"
          href="https://github.com/citizensnipz/GaussMark"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={17} />
        </a>
        {active !== "Benchmark" && (
          <Link href="/benchmark/" className="button primary">
            <Play size={13} fill="currentColor" />
            Run benchmark
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="app-footer">
      <span>
        <i className="status-dot" />
        GaussMark 0.1.0 <span className="divider">/</span> frame-interval-v1
      </span>
      <span>Open source. Measured, not estimated.</span>
    </footer>
  );
}
export function Metric({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="metric" title={hint}>
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      {hint && <em>{hint}</em>}
    </div>
  );
}
export function Empty({
  title,
  description,
  action = false,
}: {
  title: string;
  description: string;
  action?: boolean;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Activity size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <Link className="button primary" href="/benchmark/">
          Run the first benchmark
          <ArrowUpRight size={15} />
        </Link>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const ms = (value: number | null | undefined) =>
  value == null ? "—" : value.toFixed(1);
export const bytes = (value: number | null | undefined) =>
  value == null ? "Unavailable" : `${(value / 1048576).toFixed(2)} MiB`;
