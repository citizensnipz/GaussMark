import { test, expect } from "@playwright/test";
test("External Link pairing, report display and stop", async ({ page }) => {
  await page.route("http://127.0.0.1:3027/**", async (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      json: {
        running: false,
        report: {
          schema: "gaussmark.external.v1",
          browser: "Chrome fixture",
          cache: "cold",
          notes: [],
          attempts: [
            {
              variant: "A",
              cycle: 1,
              status: "complete",
              samples: [
                {
                  t: 0,
                  heapBytes: 1e6,
                  cpuBusyPercent: 3,
                  bytesPerSecond: 100,
                },
              ],
              requests: [],
              events: [],
              unavailable: ["Scene readiness"],
              transferredBytes: 1000,
              peakHeapBytes: 1e6,
            },
          ],
        },
      },
      headers,
    });
  });
  await page.goto("/benchmark/");
  await page
    .getByLabel("Renderer", { exact: true })
    .selectOption("External Link");
  const dialog = page.getByRole("dialog", { name: "External Link benchmark" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Pairing token").fill("public-test-token");
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Connected", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Browser measurements; scene readiness unverified", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Export sanitized JSON" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});
