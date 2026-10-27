import { createServer } from "node:http";
import assert from "node:assert/strict";
import { runSuite, validateConfig } from "./external-runner.mjs";
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<html><body>Public benchmark fixture<script>setTimeout(()=>{gaussmark.mark("scene-attached");gaussmark.mark("first-scene-frame");gaussmark.mark("gpu-bytes",4096);gaussmark.mark("https://private.example/?secret=bad",99);window.gaussmarkViewer={unload(){gaussmark.mark("unload-start");gaussmark.mark("unload-end");}}},100)</script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  const state = { running: true };
  await runSuite(
    validateConfig({
      a: "http://127.0.0.1:" + server.address().port + "/?token=DO_NOT_EXPORT",
      seconds: 5,
      repeats: 1,
    }),
    state,
    { headless: true },
  );
  const row = state.report.attempts[0];
  assert.equal(row.status, "complete");
  assert.ok(row.samples.length > 2);
  assert.ok(row.transferredBytes > 0);
  assert.ok(row.events.some((e) => e.name === "unload-end"));
  assert.ok(!JSON.stringify(state.report).includes("DO_NOT_EXPORT"));
  assert.ok(!JSON.stringify(state.report).includes("private.example"));
  assert.equal(state.running, false);
  console.log(
    "Chrome external-runner smoke passed: navigation, samples, network, viewer marks, unload, redaction.",
  );
} finally {
  server.close();
}
