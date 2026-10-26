import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalByteSource,
  SharedConnection,
  directProfile,
} from "../../src/core/delivery";
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
describe("local byte delivery", () => {
  it("shares one bandwidth budget and does not bank idle credit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const link = new SharedConnection(1000),
      done: number[] = [];
    const a = link
      .transfer(100, signal())
      .then(() => done.push(performance.now()));
    const b = link
      .transfer(100, signal())
      .then(() => done.push(performance.now()));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([a, b]);
    expect(done).toEqual([200, 200]);
    await vi.advanceTimersByTimeAsync(1000);
    const c = link
      .transfer(100, signal())
      .then(() => done.push(performance.now()));
    await vi.advanceTimersByTimeAsync(90);
    expect(done).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10);
    await c;
    expect(done.at(-1)).toBe(1300);
  });
  it("returns exact half-open ranges; cache hits do not become delivered bytes", async () => {
    const source = new LocalByteSource(
      new Blob([new Uint8Array([0, 1, 2, 3, 4, 5])]),
      { ...directProfile, chunkBytes: 4, cacheBytes: 8 },
    );
    expect([...(await source.readRange(1, 5, signal()))]).toEqual([1, 2, 3, 4]);
    expect([...(await source.readRange(2, 4, signal()))]).toEqual([2, 3]);
    expect(source.stats.deliveredBytes).toBe(4);
    expect(source.stats.cacheHitBytes).toBe(2);
    source.clearCache();
    await source.readRange(3, 6, signal());
    expect(source.stats.redundantBytes).toBe(2);
    await expect(source.readRange(-1, 4, signal())).rejects.toThrow(RangeError);
    await expect(source.readRange(0, 7, signal())).rejects.toThrow(RangeError);
    await expect(source.readRange(1.5, 3, signal())).rejects.toThrow(
      RangeError,
    );
  });
  it("uses bounded LRU and retains warm cache when resetting metrics", async () => {
    const source = new LocalByteSource(new Blob([new Uint8Array(16)]), {
      ...directProfile,
      chunkBytes: 4,
      cacheBytes: 8,
    });
    await source.readRange(0, 8, signal());
    await source.readRange(0, 4, signal());
    await source.readRange(8, 12, signal());
    expect(source.cachedBytes).toBe(8);
    source.resetStats();
    await source.readRange(0, 4, signal());
    expect(source.stats.cacheHitBytes).toBe(4);
    await source.readRange(4, 8, signal());
    expect(source.stats.deliveredBytes).toBe(4);
  });
  it("cancels active and queued requests without delivery after abort", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const source = new LocalByteSource(new Blob([new Uint8Array(1000)]), {
      ...directProfile,
      mode: "simulated",
      bytesPerSecond: 1000,
      latencyMs: 0,
      concurrency: 1,
    });
    const a = new AbortController(),
      b = new AbortController();
    const reads = [
      source.readRange(0, 500, a.signal),
      source.readRange(500, 1000, b.signal),
    ];
    const settled = Promise.allSettled(reads);
    await vi.advanceTimersByTimeAsync(50);
    b.abort();
    a.abort();
    expect((await settled).every((r) => r.status === "rejected")).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.stats.deliveredBytes).toBe(0);
    expect(source.stats.cancellations).toBe(2);
    const next = source.readRange(0, 10, signal());
    await vi.advanceTimersByTimeAsync(20);
    expect((await next).length).toBe(10);
  });
  it("stream has backpressure and no eager full read", async () => {
    const source = new LocalByteSource(new Blob([new Uint8Array(1024)]), {
      ...directProfile,
      chunkBytes: 64,
    });
    const iterator = source.stream(signal())[Symbol.asyncIterator]();
    expect(source.stats.ranges).toHaveLength(0);
    await iterator.next();
    expect(source.stats.deliveredBytes).toBe(64);
    expect(source.stats.ranges).toHaveLength(1);
    await iterator.return?.();
  });
  it("records cancellation of non-abortable Blob reads without delivering them", async () => {
    let finish!: (b: ArrayBuffer) => void;
    const blob = {
      size: 4,
      slice: () => ({
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((r) => {
            finish = r;
          }),
      }),
    } as Blob;
    const source = new LocalByteSource(blob);
    const abort = new AbortController();
    const pending = source.readRange(0, 4, abort.signal);
    const rejected = expect(pending).rejects.toBeDefined();
    await Promise.resolve();
    abort.abort();
    finish(new ArrayBuffer(4));
    await rejected;
    expect(source.stats.deliveredBytes).toBe(0);
  });
});
