import { afterEach, expect, it, vi } from "vitest";
import { LocalWorkerProvider, mockProvider } from "../../src/core/provider";
import { LocalByteSource } from "../../src/core/delivery";
import { AllocationLedger } from "../../src/core/measurements";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("handshakes declared support, routes range reads and tears down a public test worker", async () => {
  const attributes = await mockProvider().decode(
    new LocalByteSource(new Blob([])),
    "synthetic",
    new AbortController().signal,
  );
  const instances: FakeWorker[] = [];
  const allocations = new AllocationLedger();
  class FakeWorker {
    onmessage?: (e: { data: unknown }) => void;
    onerror?: () => void;
    terminate = vi.fn();
    constructor() {
      instances.push(this);
    }
    postMessage(m: { type: string; data?: Uint8Array }) {
      queueMicrotask(() => {
        if (m.type === "describe")
          this.onmessage?.({
            data: {
              type: "capabilities",
              protocol: "gaussmark.readonly.v1",
              formats: ["ply"],
              version: "1.2.3",
              publicVersion: true,
              execution: "local-service",
            },
          });
        if (m.type === "decode")
          this.onmessage?.({ data: { type: "read", id: 7, start: 2, end: 5 } });
        if (m.type === "bytes") {
          expect([...m.data!]).toEqual([2, 3, 4]);
          expect(allocations.totals().worker).toBe(3);
          this.onmessage?.({ data: { type: "decoded", attributes } });
        }
      });
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  // The synthetic transport stub does not claim to implement a file decoder.
  const provider = new LocalWorkerProvider(
    new File(["public transport test"], "public-worker.js"),
  );
  expect(provider.formats).toEqual([]);
  await provider.connect();
  expect(provider.formats).toEqual(["ply"]);
  expect(provider.version).toBe("1.2.3");
  expect(provider.execution).toBe("local-service");
  const source = new LocalByteSource(
    new Blob([new Uint8Array([0, 1, 2, 3, 4, 5])]),
  );
  const result = await provider.decode(
    source,
    "ply",
    new AbortController().signal,
    allocations,
  );
  expect(result.metadata.splats).toBe(512);
  expect(allocations.totals().worker).toBe(0);
  expect(source.stats.deliveredBytes).toBe(3);
  expect(source.stats.ranges[0]).toMatchObject({ start: 2, end: 5 });
  expect(instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(
    true,
  );
  provider.dispose();
  expect(revoke).toHaveBeenCalledTimes(1);
});
it("terminates an aborted external task and excludes provider error details", async () => {
  const terminated = vi.fn();
  let errorMode = false;
  class FakeWorker {
    onmessage?: (e: { data: unknown }) => void;
    terminate = terminated;
    postMessage(m: { type: string }) {
      if (m.type === "describe")
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              type: "capabilities",
              protocol: "gaussmark.readonly.v1",
              formats: ["ply"],
              version: "private-identifier",
              publicVersion: false,
            },
          }),
        );
      if (m.type === "decode" && errorMode)
        queueMicrotask(() =>
          this.onmessage?.({
            data: { type: "error", message: "PRIVATE_DETAIL_SENTINEL" },
          }),
        );
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const provider = new LocalWorkerProvider(
    new File(["public test"], "test.js"),
  );
  await provider.connect();
  expect(provider.version).toBe("external-local-v1");
  const c = new AbortController(),
    source = new LocalByteSource(new Blob([]));
  const task = provider.decode(source, "ply", c.signal);
  const cancelled = expect(task).rejects.toMatchObject({ name: "AbortError" });
  c.abort();
  await cancelled;
  expect(terminated).toHaveBeenCalledTimes(2);
  errorMode = true;
  await expect(
    provider.decode(source, "ply", new AbortController().signal),
  ).rejects.toThrow("Private error details omitted".toLowerCase());
  errorMode = false;
  const pending = provider.decode(source, "ply", new AbortController().signal);
  const stopped = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  provider.dispose();
  await stopped;
});
