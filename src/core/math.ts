import type { Stats } from "./types";
export function statsFromArray(s: ArrayLike<number>): Stats {
  if (s.length !== 8)
    throw new Error("Statistics rejected invalid frame samples.");
  return {
    count: s[0],
    median: s[1],
    p95: s[2],
    p99: s[3],
    mean: s[4],
    variance: s[5],
    min: s[6],
    max: s[7],
  };
}
export function ecefTs(lat: number, lon: number, h: number): number[] {
  const a = 6378137,
    f = 1 / 298.257223563,
    e2 = f * (2 - f),
    phi = (lat * Math.PI) / 180,
    lambda = (lon * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [
    (n + h) * Math.cos(phi) * Math.cos(lambda),
    (n + h) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - e2) + h) * Math.sin(phi),
  ];
}
export function cameraPose(
  t: number,
  mode: string,
  radius = 5.3,
): [number, number, number] {
  const turns =
    mode === "stationary"
      ? 0
      : mode === "slow"
        ? 0.28
        : mode === "fast"
          ? 1.5
          : 1;
  const a = 0.65 + t * Math.PI * 2 * turns;
  const height = mode === "fast" ? 1.9 + Math.sin(t * Math.PI * 4) * 0.9 : 1.9;
  return [Math.sin(a) * radius, height, Math.cos(a) * radius];
}
