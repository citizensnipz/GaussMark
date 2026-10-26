import type { BenchmarkResult } from "./types";
const KEY = "gaussmark.sessions.v1";
export function readSessions(): BenchmarkResult[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is BenchmarkResult =>
        !!r &&
        r.valid === true &&
        r.methodology === "frame-interval-v1" &&
        r.stats?.count > 0 &&
        r.stats?.median > 0 &&
        Array.isArray(r.frames) &&
        r.frames.every((f: unknown) => Array.isArray(f)) &&
        !!r.scene &&
        !!r.config &&
        !!r.device &&
        !!r.loading,
    );
  } catch {
    return [];
  }
}
export function saveSession(result: BenchmarkResult) {
  const list = [result, ...readSessions()].slice(0, 20);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
export function downloadResult(result: BenchmarkResult) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `gaussmark-${result.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
