import { describe, it, expect } from "vitest";
import { cameraPose, ecefTs, statsFromArray } from "../../src/core/math";
describe("portable math conventions", () => {
  it("validates WGS84 against analytic equator and pole references", () => {
    expect(ecefTs(0, 0, 0)).toEqual([6378137, 0, 0]);
    expect(ecefTs(90, 0, 0)[2]).toBeCloseTo(6356752.314245179, 6);
    expect(ecefTs(0, 90, 100)[1]).toBeCloseTo(6378237, 6);
  });
  it("keeps the stationary camera fixed and closes the orbit", () => {
    expect(cameraPose(0, "stationary")).toEqual(cameraPose(0.9, "stationary"));
    const a = cameraPose(0, "orbit"),
      b = cameraPose(1, "orbit");
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 10));
  });
  it("rejects missing statistics instead of inventing metrics", () => {
    expect(() => statsFromArray([])).toThrow();
    expect(statsFromArray([4, 2.5, 3.85, 3.97, 2.5, 1.25, 1, 4]).p95).toBe(
      3.85,
    );
  });
});
