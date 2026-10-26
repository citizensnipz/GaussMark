import { test, expect } from "@playwright/test";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
const scenePath = path.resolve("public/scenes/orbital-v1.ply");
async function ready(page: import("@playwright/test").Page) {
  await page.goto("/benchmark/");
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("canvas")).toHaveJSProperty("width", 1047);
}
test("reference Gaussian scene renders, camera moves, themes persist, desktop fits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(
    page.getByText("47,000 Gaussians", { exact: false }),
  ).toBeVisible();
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, {
    steps: 15,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  await page.getByRole("button", { name: "Reset camera" }).click();
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/benchmark-dark.png",
  });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/benchmark-light.png",
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(() => ({
        h: document.documentElement.scrollHeight,
        w: document.documentElement.scrollWidth,
      })),
    ).toEqual({ h: size.height, w: size.width });
  }
  expect(errors).toEqual([]);
});
test("real repeated measurements, WASM aggregation, report, export, session state", async ({
  page,
}) => {
  await ready(page);
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByLabel("Repetitions", { exact: true }).selectOption("3");
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View session report" }),
  ).toBeVisible({ timeout: 45000 });
  const result = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.sessions.v1")!)[0],
  );
  expect(result.stats.count).toBeGreaterThan(30);
  expect(result.repetitions).toHaveLength(3);
  expect(result.frames).toHaveLength(3);
  expect(result.analysis).toBe("rust-wasm");
  expect(result.stats.p99).toBeGreaterThanOrEqual(result.stats.median);
  expect(result.loading.gaussians).toBe(47000);
  expect(result.config.width).toBe(1047);
  for (const frames of result.frames)
    expect(frames.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThan(
      4900,
    );
  const sorted = result.frames.flat().sort((a: number, b: number) => a - b);
  const k = (sorted.length - 1) * 0.5;
  expect(result.stats.median).toBeCloseTo(
    sorted[Math.floor(k)] +
      (sorted[Math.ceil(k)] - sorted[Math.floor(k)]) * (k % 1),
    8,
  );
  await page.getByRole("button", { name: "Motion", exact: true }).click();
  await expect(page.getByText("Frames > 50 ms")).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View session report" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View session report" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export full JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(
    /^gaussmark-.*\.json$/,
  );
  await page.getByRole("button", { name: "Preview submission" }).click();
  await expect(
    page.getByRole("button", { name: "Submit result", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(page.getByRole("cell", { name: "PlayCanvas" })).toBeVisible();
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/measured-session.json",
    JSON.stringify(result, null, 2),
  );
});
test("stop and resize cancel runs without saving partial measurements", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop run", exact: true }).click();
  await expect(page.locator(".workspace-alert")).toContainText("stopped");
  expect(
    await page.evaluate(() => localStorage.getItem("gaussmark.sessions.v1")),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator(".workspace-alert")).toContainText("resized");
  expect(
    await page.evaluate(() => localStorage.getItem("gaussmark.sessions.v1")),
  ).toBeNull();
});
test("local PLY stays local, network timing is unavailable, invalid files rejected", async ({
  page,
}) => {
  await ready(page);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  await page.getByLabel("Local Gaussian file").setInputFiles(scenePath);
  await expect(
    page.getByRole("heading", { name: "orbital-v1.ply", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Streaming", exact: true }).click();
  await expect(
    page.getByText("Local file test. No network transfer is measured."),
  ).toBeVisible();
  await expect(
    page.getByText("Local blob read", { exact: false }),
  ).toBeVisible();
  expect(posts).toEqual([]);
  await page.getByLabel("Local Gaussian file").setInputFiles({
    name: "mesh.ply",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("ply\nformat ascii 1.0\nelement vertex 0\nend_header"),
  });
  await expect(page.locator(".workspace-alert")).toContainText(
    "not an uncompressed Gaussian PLY",
  );
  await page.getByLabel("Scene", { exact: true }).selectOption("reference");
  await expect(
    page.getByRole("heading", { name: "Orbital study", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
});
test("spatial WASM workload validates reference cases and equivalent outputs", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Spatial", exact: true }).click();
  await page.getByRole("button", { name: "Run coordinate test" }).click();
  await expect(
    page.getByText("Reference cases passed", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Cross-implementation max error:", { exact: false }),
  ).toBeVisible();
});
test("WebGPU renders when available and WebGL2 can be restored", async ({
  page,
}) => {
  await ready(page);
  const supported = await page.evaluate(
    async () =>
      !!(await (
        navigator as Navigator & {
          gpu?: { requestAdapter: () => Promise<unknown> };
        }
      ).gpu?.requestAdapter()),
  );
  await page.getByLabel("Graphics API", { exact: true }).selectOption("webgpu");
  if (supported) {
    await expect(
      page.getByRole("button", { name: "Run benchmark", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("Duration", { exact: true }).selectOption("5");
    await page.getByLabel("Repetitions", { exact: true }).selectOption("1");
    await page
      .getByRole("button", { name: "Run benchmark", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "View session report" }),
    ).toBeVisible({ timeout: 20000 });
    const record = await page.evaluate(
      () => JSON.parse(localStorage.getItem("gaussmark.sessions.v1")!)[0],
    );
    expect(record.api).toBe("webgpu");
    expect(record.stats.count).toBeGreaterThan(10);
  } else
    await expect(
      page.getByText("Renderer unavailable", { exact: true }),
    ).toBeVisible();
  await page.getByLabel("Graphics API", { exact: true }).selectOption("webgl2");
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  test.info().annotations.push({
    type: "WebGPU",
    description: supported
      ? "Rendered and measured"
      : "Unavailable; graceful failure tested",
  });
});
test("dashboard API, both themes and mobile layout", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Rendering, in perspective." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".api-error")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/dashboard-dark.png",
  });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/dashboard-light.png",
  });
  for (const size of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(size.width);
  }
  await page.goto("/benchmark/");
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Motion", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Motion", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(
    page.getByRole("heading", { name: "Motion", exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/benchmark-mobile.png",
  });
});
