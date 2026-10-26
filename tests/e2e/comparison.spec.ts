import { test, expect } from "@playwright/test";
import path from "node:path";
test("scene fly/rotation controls and persistent cross-renderer A/B on the same local PLY", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /WebGPU|Validation|shader/i.test(m.text()))
      errors.push(m.text());
  });
  await page.goto("/benchmark/");
  const run = page.getByRole("button", { name: "Run benchmark", exact: true });
  await expect(run).toBeEnabled();
  await page
    .getByLabel("Local Gaussian file")
    .setInputFiles(path.resolve("public/scenes/orbital-v1.ply"));
  await expect(
    page.getByRole("heading", { name: "orbital-v1.ply", exact: true }),
  ).toBeVisible();
  await expect(run).toBeEnabled();
  await page
    .getByRole("button", { name: "Scene controls", exact: true })
    .click();
  const ring = page.getByRole("slider", {
    name: "Rotate object Y",
    exact: true,
  });
  await ring.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  const canvas = page.locator("canvas");
  await canvas.focus();
  const before = await canvas.screenshot();
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await page.waitForTimeout(100);
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  await page.keyboard.press("f");
  await page.screenshot({
    path: "docs/screenshots/scene-controls.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Scene controls", exact: true })
    .click();
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByLabel("Repetitions", { exact: true }).selectOption("1");
  await run.click();
  await expect(page.getByLabel("Renderer", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save as A", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Save as A", exact: true }).click();
  await page
    .getByLabel("Renderer", { exact: true })
    .selectOption("WebSplatter");
  await expect(run).toBeEnabled();
  await page
    .getByRole("button", { name: "Use saved A’s test settings" })
    .click();
  await expect(run).toBeEnabled();
  await expect(page.getByLabel("Graphics API", { exact: true })).toHaveValue(
    "webgpu",
  );
  await page.screenshot({
    path: "docs/screenshots/websplatter-local.png",
    animations: "disabled",
  });
  await run.click();
  await expect(
    page.getByRole("button", { name: "Save as B", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Save as B", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gaussmark.comparison.v1")!),
  );
  expect(saved.A.renderer).toBe("PlayCanvas");
  expect(saved.B.renderer).toBe("WebSplatter");
  expect(saved.A.scene.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(saved.A.scene.sha256).toBe(saved.B.scene.sha256);
  expect(saved.A.config).toEqual(saved.B.config);
  expect(saved.A.config.objectRotation[1]).toBeCloseTo(45, 4);
  expect(saved.B.stats.count).toBeGreaterThan(30);
  expect(saved.B.loading.gaussians).toBe(47000);
  await page.getByRole("link", { name: "Compare A/B", exact: true }).click();
  await expect(page.locator("#comparison")).toContainText(
    "Same file and test settings.",
  );
  await expect(page.locator("#comparison")).toContainText(
    "Graphics APIs differ",
  );
  await expect(page.locator("#comparison")).toHaveJSProperty(
    "clientHeight",
    await page.locator("#comparison").evaluate((el) => el.scrollHeight),
  );
  await page.reload();
  await expect(page.locator("#comparison")).toContainText("WebSplatter");
  await page.screenshot({
    path: "docs/screenshots/comparison.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/benchmark/");
  await expect(run).toBeEnabled();
  await page
    .getByLabel("Renderer", { exact: true })
    .selectOption("WebSplatter");
  await expect(run).toBeEnabled();
  await page.getByLabel("Renderer", { exact: true }).selectOption("PlayCanvas");
  await expect(run).toBeEnabled();
  await page
    .getByLabel("Renderer", { exact: true })
    .selectOption("WebSplatter");
  await expect(run).toBeEnabled();
  await page.getByLabel("Local Gaussian file").setInputFiles({
    name: "unsupported.sog",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("unsupported"),
  });
  await expect(
    page.getByText("Renderer unavailable", { exact: true }),
  ).toBeVisible();
  await expect(run).toBeDisabled();
  await expect(page.locator(".viewport-loading")).toContainText(
    "SOG is supported by PlayCanvas only",
  );
  expect(errors).toEqual([]);
});
