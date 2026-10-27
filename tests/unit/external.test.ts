import { test, expect } from "vitest";
import { validateConfig, summarize } from "../../scripts/external-runner.mjs";
test("rejects unsafe navigation schemes and unbounded settings", () => {
  for (const a of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://name:secret@example.com/",
  ])
    expect(() => validateConfig({ a })).toThrow();
  expect(() =>
    validateConfig({ a: "https://example.com", repeats: 100 }),
  ).toThrow();
  expect(() =>
    validateConfig({ a: "https://example.com", seconds: NaN }),
  ).toThrow();
  expect(
    validateConfig({
      a: "https://example.com/?token=secret",
      repeats: 2,
      seconds: 5,
    }).urls,
  ).toHaveLength(1);
});
test("summaries distinguish absent samples", () => {
  expect(summarize([])).toBeNull();
  expect(summarize([1, 2, 3, NaN])).toEqual({ median: 2, p95: 3, count: 3 });
});

test("viewer payload sanitization strips arbitrary strings and extra fields", async () => {
  const { sanitizeEvents } = await import("../../scripts/external-runner.mjs");
  expect(
    sanitizeEvents([
      { name: "usable", t: 5, url: "https://private.example/token", value: 2 },
      { name: "https://private.example/token", t: 6 },
      { name: "gpu-bytes", t: 7, value: "secret" },
      { name: "decode-end", t: Infinity },
    ]),
  ).toEqual([{ name: "usable", t: 5, value: 2 }]);
});
