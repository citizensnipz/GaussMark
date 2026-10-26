import { test, expect } from "@playwright/test";
import path from "node:path";
test("local filenames, interior path, preset restore, frozen camera and A/B settings", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  const grid = page.getByRole("button", { name: "Grid", exact: true });
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await grid.click();
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  await grid.click();
  await page.getByRole("button", { name: "Center the object", exact: true }).click();
  await page.getByLabel("Benchmark view").selectOption("orbit");
  await page.getByLabel("Orbit radius", { exact: true }).fill("2");
  await page.getByLabel("Orbit center X").fill("15");
  await page.getByRole("button", { name: "Center circle on object" }).click();
  await expect(page.getByLabel("Orbit center X")).toHaveValue("0");
  await expect(page.getByLabel("Orbit radius", { exact: true })).toHaveValue("2");
  await page.getByLabel("Orbit center X").fill("0");
  await page.getByLabel("Orbit center Y").fill("-1");
  await page.getByLabel("Orbit center Z").fill("0");
  await page.getByLabel("Orbit radius", { exact: true }).fill("2");
  await expect(
    page.locator('[aria-label="Orbit radius handle"]'),
  ).toBeVisible();

  const pivot = page.locator('[aria-label="Orbit center handle"]');
  const box = (await pivot.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  expect(Number(await page.getByLabel("Orbit center X").inputValue())).not.toBe(
    0,
  );
  await page.getByLabel("Orbit center X").fill("0");
  await page.getByLabel("Orbit center Z").fill("0");
  await page.getByRole("button", { name: "Save setup", exact: true }).click();
  await page.getByLabel("Orbit radius", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Restore setup", exact: true })
    .click();
  await expect(page.getByLabel("Orbit radius", { exact: true })).toHaveValue(
    "2",
  );
  await page.screenshot({
    path: "docs/screenshots/interior-path.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Preview saved camera", exact: true })
    .click();
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByLabel("Repetitions", { exact: true }).selectOption("1");
  await run.click();
  await expect(page.locator(".rotation-gizmo")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "View session report" }),
  ).toBeVisible();
  const result = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.sessions.v1")!)[0],
  );
  expect(result.scene.name).toBe("orbital-v1.ply");
  expect(result.config.cameraPath).toMatchObject({
    mode: "orbit",
    radius: 2,
    center: [0, -1, 0],
  });
  await page.getByRole("button", { name: "Save as A", exact: true }).click();
  await page.getByRole("button", { name: "View session report" }).click();
  await expect(page.getByRole("dialog")).toContainText("orbital-v1.ply");
  await expect(page.getByRole("dialog")).toContainText("Interior circle");
  await page.getByRole("button", { name: "Preview submission" }).click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "Local scene",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByLabel("Renderer", { exact: true })
    .selectOption("WebSplatter");
  await expect(run).toBeEnabled();
  await page
    .getByRole("button", { name: "Use saved A’s test settings" })
    .click();
  await expect(run).toBeEnabled();
  await expect(page.getByLabel("Orbit radius", { exact: true })).toHaveValue(
    "2",
  );
  await page.getByLabel("Benchmark view").selectOption("frozen");
  await run.click();
  await expect(
    page.getByRole("button", { name: "View session report" }),
  ).toBeVisible();
  const frozen = await page.evaluate(
    () => JSON.parse(localStorage.getItem("gaussmark.sessions.v1")!)[0],
  );
  expect(frozen.config.cameraPath.mode).toBe("frozen");
  expect(frozen.scene.name).toBe("orbital-v1.ply");
  expect(errors).toEqual([]);
});
