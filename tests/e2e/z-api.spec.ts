import { test, expect } from "@playwright/test";
test("explicit consent, D1 persistence, filters, validation, duplicate handling and rate limit", async ({
  page,
  request,
  baseURL,
}) => {
  test.skip(
    !baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname),
    "Submission tests are local only",
  );
  const api = baseURL!.includes(":3005") ? "http://127.0.0.1:3015" : baseURL!;
  const before = await (await request.get(`${api}/api/results`)).json();
  await page.goto("/benchmark/");
  await expect(
    page.getByRole("button", { name: "Run benchmark", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByLabel("Repetitions", { exact: true }).selectOption("1");
  let submissions = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/results"))
      submissions++;
  });
  await page
    .getByRole("button", { name: "Run benchmark", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View session report" }),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await page.getByRole("button", { name: "View session report" }).click();
  await page.getByRole("button", { name: "Preview submission" }).click();
  await expect(
    page.getByRole("button", { name: "Submit result", exact: true }),
  ).toBeDisabled();
  const body = JSON.parse(await page.locator(".submission pre").innerText());
  expect(body.frames).toBeUndefined();
  expect(body.scene.url).toBeUndefined();
  await page.getByLabel("Share this technical record publicly").check();
  await page
    .getByRole("button", { name: "Submit result", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("status")
      .filter({ hasText: "Submitted." }),
  ).toContainText("Submitted.");
  expect(submissions).toBe(1);
  const after = await (
    await request.get(`${api}/api/results?source=reference`)
  ).json();
  expect(after.total).toBe(before.total + 1);
  expect(after.results.some((r: { id: string }) => r.id === body.id)).toBe(
    true,
  );
  const duplicate = await request.post(`${api}/api/results`, { data: body });
  expect(duplicate.status()).toBe(200);
  expect((await duplicate.json()).stored).toBe(false);
  expect(
    (
      await request.post(`${api}/api/results`, {
        data: { ...body, methodology: "wrong" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`${api}/api/results`, {
        data: { ...body, scene: { ...body.scene, sha256: "a".repeat(64) } },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`${api}/api/results`, {
        data: body,
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`${api}/api/results`, {
        data: "x".repeat(40000),
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(413);
  expect((await request.get(`${api}/api/results?days=NaN`)).status()).toBe(400);
  const locals = await (
    await request.get(`${api}/api/results?source=local`)
  ).json();
  expect(
    locals.results.every(
      (r: { scene: { source: string } }) => r.scene.source === "local",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "PlayCanvas" }).first(),
  ).toBeVisible();
  let limited = false;
  for (let i = 0; i < 11; i++) {
    const response = await request.post(`${api}/api/results`, { data: body });
    if (response.status() === 429) {
      limited = true;
      expect(response.headers()["retry-after"]).toBeTruthy();
      break;
    }
  }
  expect(limited).toBe(true);
});
