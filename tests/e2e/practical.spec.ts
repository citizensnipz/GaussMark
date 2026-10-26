import { test, expect } from "@playwright/test";
import path from "node:path";
const file = path.resolve("public/scenes/orbital-v1.ply");
async function open(page: import("@playwright/test").Page) {
  await page.goto("/benchmark/");
  await page
    .getByRole("button", { name: "Practical suites", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
test("WebSplatter cancels at decode and GPU preparation entry without retaining worker buffers", async ({
  page,
}) => {
  await open(page);
  const supported = await page.evaluate(
    async () => !!(navigator.gpu && (await navigator.gpu.requestAdapter())),
  );
  test.skip(
    !supported,
    "WebGPU unavailable; not hardware performance evidence",
  );
  await page.getByLabel("Scene A", { exact: true }).setInputFiles(file);
  await page.getByLabel("Suite renderer").selectOption("WebSplatter");
  await page.getByLabel("Load cycles").selectOption("1");
  await page
    .getByText("Delivery, cancellation and instrumentation", { exact: true })
    .click();
  await page.getByLabel("Cancel delay after stage entry (ms)").fill("0");
  await page.getByLabel("Post-disposal checkpoint wait (ms)").fill("0");
  for (const stage of ["decode", "gpu-preparation"]) {
    await page.getByLabel("Cancellation target").selectOption(stage);
    await page
      .getByRole("button", { name: "Run lifecycle suite", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Run lifecycle suite", exact: true }),
    ).toBeEnabled({ timeout: 45000 });
    const r = await page.evaluate(
      () => JSON.parse(localStorage.getItem("gaussmark.practical.v1")!)[0],
    );
    expect(r.repeats.map((x: { status: string }) => x.status)).toEqual([
      "cancelled",
      "complete",
    ]);
    expect(r.repeats[0].memory.at(-1).worker).toBe(0);
    expect(r.repeats[0].memory.at(-1).gpu).toBe(0);
    expect(r.repeats[0].cancellation.replacementReadyMs).toBeGreaterThan(0);
  }
});
test("production lifecycle: repeated loads, unload checkpoints, raw export and legacy resume", async ({
  page,
}) => {
  const posts: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.getByLabel("Scene A", { exact: true }).setInputFiles(file);
  await page.getByLabel("Renderer lifecycle").selectOption("reused");
  await page
    .getByRole("button", { name: "Run lifecycle suite", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Lifecycle results" }),
  ).toBeVisible({ timeout: 45000 });
  const r = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.practical.v1")!)[0],
  );
  expect(r.repeats.map((x: { status: string }) => x.status)).toEqual([
    "complete",
    "complete",
    "complete",
  ]);
  expect(r.repeats[0].milestones["first-visible-content"].ms).toBeNull();
  expect(r.repeats[0].milestones["first-submitted-frame"].ms).toBeGreaterThan(
    r.repeats[0].milestones["first-bytes"].ms,
  );
  expect(r.repeats[1].pipelineWarmState).toContain("Reused");
  expect(r.repeats[2].memory.at(-1).checkpoint).toBe(
    "post-disposal-checkpoint",
  );
  expect(r.variants[0].preReadBytes).toBe(0);
  if (r.capabilities.gpuTimestamps.supported)
    expect(r.repeats[0].gpu.length).toBeGreaterThan(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export lifecycle CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.screenshot({ path: "test-results/practical-production.png" });
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
});
test("simulated delivery cancellation is followed by a successful replacement", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Scene A", { exact: true }).setInputFiles(file);
  await page
    .getByLabel("Workflow preset")
    .selectOption("Scene switching and cancellation");
  await page.getByLabel("Load cycles").selectOption("1");
  await page
    .getByText("Delivery, cancellation and instrumentation", { exact: true })
    .click();
  await page.getByLabel("Byte delivery").selectOption("simulated");
  await page
    .getByRole("button", { name: "Run lifecycle suite", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Lifecycle results" }),
  ).toBeVisible({ timeout: 45000 });
  const r = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.practical.v1")!)[0],
  );
  expect(r.repeats.map((x: { status: string }) => x.status)).toEqual([
    "cancelled",
    "complete",
  ]);
  expect(r.repeats[0].cancellation.deliveredAfter).toBe(0);
  expect(r.repeats[0].cancellation.replacementReadyMs).toBeGreaterThan(0);
  expect(r.repeats[1].delivery.label).toBe("simulated delivery");
});
test("capability-dependent presets return inspectable unsupported rows", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Scene A", { exact: true }).setInputFiles(file);
  await page.getByLabel("Load cycles").selectOption("1");
  await page.getByLabel("Workflow preset").selectOption("Editor interactions");
  await page
    .getByRole("button", { name: "Run lifecycle suite", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Lifecycle results" }),
  ).toBeVisible();
  const r = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.practical.v1")!)[0],
  );
  expect(r.repeats[0].status).toBe("unsupported");
  expect(r.repeats[0].frames).toEqual([]);
  expect(r.repeats[0].error).toContain("not splat edits");
});
test("synthetic provider uses the real WebGPU bridge, unloads resources and preserves its label", async ({
  page,
}) => {
  await open(page);
  const supported = await page.evaluate(
    async () => !!(navigator.gpu && (await navigator.gpu.requestAdapter())),
  );
  test.skip(
    !supported,
    "WebGPU unavailable; not hardware performance evidence",
  );
  await page
    .getByText("External read-only provider · GPC / SGPC / unverified SSOG", {
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Use public synthetic mock" }).click();
  await page.getByLabel("Renderer lifecycle").selectOption("reused");
  await page
    .getByRole("button", { name: "Run lifecycle suite", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Lifecycle results" }),
  ).toBeVisible({ timeout: 45000 });
  const r = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.practical.v1")!)[0],
  );
  expect(r.repeats.map((x: { status: string }) => x.status)).toEqual([
    "complete",
    "complete",
    "complete",
  ]);
  expect(r.repeats[0].metadata.splats).toBe(512);
  expect(r.repeats[0].path.native).toBe(false);
  expect(r.repeats[0].path.format).toBe("synthetic");
  expect(r.repeats[0].memory.some((m: { gpu: number }) => m.gpu > 272)).toBe(
    true,
  );
  expect(r.repeats[2].memory.at(-1).gpu).toBe(272); // persistent camera uniform only
});
