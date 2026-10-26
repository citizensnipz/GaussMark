import type { BenchmarkResult } from "./types";
export type ComparisonSlots = Partial<Record<"A" | "B", BenchmarkResult>>;
const KEY = "gaussmark.comparison.v1";
export function readComparison(): ComparisonSlots {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    const result: ComparisonSlots = {};
    for (const key of ["A", "B"] as const)
      if (
        v[key]?.valid &&
        v[key]?.stats?.median > 0 &&
        v[key]?.config &&
        v[key]?.scene &&
        v[key]?.device &&
        Array.isArray(v[key]?.frames)
      )
        result[key] = v[key];
    return result;
  } catch {
    return {};
  }
}
export function saveComparison(slot: "A" | "B", result: BenchmarkResult) {
  const slots = readComparison();
  slots[slot] = result;
  // Keep the full samples independent of the rolling 20-session archive.
  localStorage.setItem(KEY, JSON.stringify(slots));
  window.dispatchEvent(new Event("gaussmark-comparison"));
}
export function comparisonIssues(
  a: BenchmarkResult,
  b: BenchmarkResult,
): string[] {
  const issues: string[] = [];
  if (!a.scene.sha256 || !b.scene.sha256)
    issues.push(
      "File identity is unknown. Rerun older local-file results to identify their contents.",
    );
  else if (a.scene.sha256 !== b.scene.sha256)
    issues.push("Different scene files.");
  if (a.scene.source !== b.scene.source || a.scene.version !== b.scene.version)
    issues.push(
      "Different scene framing profiles (reference/custom or scene version).",
    );
  if (a.scene.format !== b.scene.format) issues.push("Different file formats.");
  if (
    a.methodology !== b.methodology ||
    a.benchmarkVersion !== b.benchmarkVersion
  )
    issues.push("Different benchmark versions or methodology.");
  for (const key of [
    "motion",
    "durationSeconds",
    "warmupSeconds",
    "repeats",
    "width",
    "height",
    "renderScale",
  ] as const)
    if (a.config[key] !== b.config[key])
      issues.push(`Different ${key.replace(/([A-Z])/g, " $1").toLowerCase()}.`);
  if (
    JSON.stringify(a.config.objectRotation ?? [0, 0, 0]) !==
    JSON.stringify(b.config.objectRotation ?? [0, 0, 0])
  )
    issues.push("Different object rotation.");
  if (
    a.device.browser !== b.device.browser ||
    a.device.os !== b.device.os ||
    a.device.devicePixelRatio !== b.device.devicePixelRatio
  )
    issues.push("Different browser or device environment.");
  if (
    a.config.cameraCoordinates !== b.config.cameraCoordinates ||
    JSON.stringify(a.config.cameraPath ?? null) !==
      JSON.stringify(b.config.cameraPath ?? null)
  )
    issues.push("Different camera paths or frozen poses.");
  if (a.id === b.id) issues.push("A and B are the same run.");
  return issues;
}
