import { test, expect } from "@playwright/test";
test("in-scene rings drag, renderer hotkeys work without a mode selector, and gizmos lock during runs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/benchmark/");
  const run = page.getByRole("button", { name: "Run benchmark", exact: true });
  await expect(run).toBeEnabled();
  const ring = page.getByRole("slider", {
    name: "Rotate object Y",
    exact: true,
  });
  await expect(ring).toBeVisible();
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  const points = await ring.evaluate((node) => {
    const path = node as SVGPathElement,
      length = path.getTotalLength(),
      rect = path.ownerSVGElement!.getBoundingClientRect();
    for (let t = 0.1; t < 0.9; t += 0.07) {
      const p = path.getPointAtLength(length * t),
        end = path.getPointAtLength(length * (t + 0.08));
      if (document.elementFromPoint(rect.x + p.x, rect.y + p.y) === path)
        return {
          x: rect.x + p.x,
          y: rect.y + p.y,
          ex: rect.x + end.x,
          ey: rect.y + end.y,
        };
    }
    throw Error("No reachable ring handle");
  });
  await page.mouse.move(points.x, points.y);
  await page.mouse.down();
  await page.mouse.move(points.ex, points.ey, { steps: 12 });
  await page.mouse.up();
  expect(
    Math.abs(Number(await ring.getAttribute("aria-valuenow"))),
  ).toBeGreaterThan(5);
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  await canvas.focus();
  const moved = await canvas.screenshot();
  await page.keyboard.down("e");
  await page.waitForTimeout(350);
  await page.keyboard.up("e");
  expect(Buffer.compare(moved, await canvas.screenshot())).not.toBe(0);
  await page
    .getByRole("button", { name: "Scene controls", exact: true })
    .click();
  await expect(page.locator(".controls-reference")).toContainText(
    "PlayCanvas controls",
  );
  await expect(page.locator(".controls-reference")).toContainText(
    "Camera down / up",
  );
  await expect(page.getByLabel("Navigation mode")).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/gizmo-playcanvas.png",
    animations: "disabled",
  });
  await run.click();
  await expect(page.locator(".rotation-gizmo")).toBeHidden();
  await page.getByRole("button", { name: "Stop run", exact: true }).click();
  await expect(ring).toBeVisible();
  await page
    .getByLabel("Renderer", { exact: true })
    .selectOption("WebSplatter");
  await expect(run).toBeEnabled();
  await expect(page.locator(".rotation-gizmo")).toHaveCount(1);
  await expect(page.locator(".controls-reference")).toContainText(
    "WebSplatter controls",
  );
  await expect(page.locator(".controls-reference")).toContainText(
    "Space / Ctrl",
  );
  await expect(page.locator(".controls-reference")).toContainText(
    "Roll camera left / right",
  );
  await canvas.focus();
  const ws = await canvas.screenshot();
  await page.keyboard.down("q");
  await page.waitForTimeout(350);
  await page.keyboard.up("q");
  expect(Buffer.compare(ws, await canvas.screenshot())).not.toBe(0);
  await page.keyboard.press("r");
  const reset = await canvas.screenshot();
  await page.keyboard.down("Space");
  await page.waitForTimeout(350);
  await page.keyboard.up("Space");
  expect(Buffer.compare(reset, await canvas.screenshot())).not.toBe(0);
  await page.screenshot({
    path: "docs/screenshots/gizmo-websplatter.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
