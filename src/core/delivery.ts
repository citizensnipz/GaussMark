export interface DeliveryProfile {
  mode: "direct" | "simulated";
  bytesPerSecond: number;
  latencyMs: number;
  chunkBytes: number;
  concurrency: number;
  cacheBytes: number;
  jitterMs: number;
  seed: number;
}
export const directProfile: DeliveryProfile = {
  mode: "direct",
  bytesPerSecond: 10_000_000,
  latencyMs: 20,
  chunkBytes: 262144,
  concurrency: 4,
  cacheBytes: 16 * 1024 * 1024,
  jitterMs: 0,
  seed: 1,
};
export type RangeRecord = {
  start: number;
  end: number;
  requestedMs: number;
  endedMs: number | null;
  delivered: number;
  cacheHitBytes: number;
  cancelled: boolean;
};
export type DeliveryStats = {
  label: "direct local" | "simulated delivery";
  deliveredBytes: number;
  cacheHitBytes: number;
  redundantBytes: number;
  cancellations: number;
  firstByteMs: number | null;
  ranges: RangeRecord[];
};
export interface ByteSource {
  readonly size: number;
  readonly stats: DeliveryStats;
  readonly cachedBytes: number;
  readonly inFlightBytes: number;
  readRange(
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>>;
  stream(
    signal: AbortSignal,
    start?: number,
    end?: number,
  ): AsyncIterable<Uint8Array<ArrayBuffer>>;
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Stops waiting on non-interruptible browser work. Its actual completion stays unobservable. */
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", abort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
    if (signal.aborted) abort();
  });
}
type Transfer = {
  remaining: number;
  resolve: () => void;
  reject: (e: unknown) => void;
  signal: AbortSignal;
  abort: () => void;
};
/** One connection clock, with no idle credit. All active requests share its budget. */
export class SharedConnection {
  private jobs = new Set<Transfer>();
  private timer?: ReturnType<typeof setTimeout>;
  private last = 0;
  constructor(readonly bytesPerSecond: number) {
    if (!(bytesPerSecond > 0) || !Number.isFinite(bytesPerSecond))
      throw Error("Invalid bandwidth");
  }
  transfer(bytes: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!bytes) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const job: Transfer = {
        remaining: bytes,
        resolve,
        reject,
        signal,
        abort: () => {
          this.jobs.delete(job);
          reject(signal.reason);
          if (!this.jobs.size) {
            clearTimeout(this.timer);
            this.timer = undefined;
          }
        },
      };
      // Account elapsed work before admitting a new job, so it receives no prior credit.
      if (this.jobs.size) this.advance();
      else this.last = performance.now();
      this.jobs.add(job);
      signal.addEventListener("abort", job.abort, { once: true });
      this.schedule();
    });
  }
  private schedule() {
    if (!this.timer && this.jobs.size)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.advance();
        this.schedule();
      }, 10);
  }
  private advance() {
    const now = performance.now();
    let budget = ((now - this.last) * this.bytesPerSecond) / 1000;
    this.last = now;
    while (budget > 0 && this.jobs.size) {
      const share = budget / this.jobs.size;
      let used = 0;
      for (const job of this.jobs) {
        const amount = Math.min(job.remaining, share);
        job.remaining -= amount;
        used += amount;
        if (job.remaining <= 0) {
          this.jobs.delete(job);
          job.signal.removeEventListener("abort", job.abort);
          job.resolve();
        }
      }
      budget -= used;
      if (!used) break;
    }
  }
}
/** Exact-range LRU. A covering entry may serve a smaller request. Never prefetches. */
export class LocalByteSource implements ByteSource {
  readonly size: number;
  stats!: DeliveryStats;
  private epoch = performance.now();
  private cache = new Map<
    string,
    { start: number; end: number; data: Uint8Array<ArrayBuffer> }
  >();
  private seen: [number, number][] = [];
  private active = 0;
  inFlightBytes = 0;
  onRequest?: () => void;
  private waiters = new Set<() => void>();
  private random: number;
  readonly connection: SharedConnection;
  constructor(
    private blob: Blob,
    readonly profile: DeliveryProfile = directProfile,
    connection?: SharedConnection,
  ) {
    for (const key of ["chunkBytes", "concurrency"] as const)
      if (!Number.isSafeInteger(profile[key]) || profile[key] < 1)
        throw Error(`Invalid ${key}`);
    for (const key of ["latencyMs", "cacheBytes", "jitterMs", "seed"] as const)
      if (!Number.isFinite(profile[key]) || profile[key] < 0)
        throw Error(`Invalid ${key}`);
    this.size = blob.size;
    this.random = profile.seed;
    this.connection =
      connection ?? new SharedConnection(profile.bytesPerSecond);
    this.resetStats();
  }
  get cachedBytes() {
    return [...this.cache.values()].reduce((n, e) => n + e.data.byteLength, 0);
  }
  get startedAt() {
    return this.epoch;
  }
  get pending() {
    return this.active > 0 || this.waiters.size > 0;
  }
  resetStats() {
    if (this.active) throw Error("Cannot reset active delivery");
    this.epoch = performance.now();
    this.seen = [];
    this.random = this.profile.seed;
    this.stats = {
      label:
        this.profile.mode === "simulated"
          ? "simulated delivery"
          : "direct local",
      deliveredBytes: 0,
      cacheHitBytes: 0,
      redundantBytes: 0,
      cancellations: 0,
      firstByteMs: null,
      ranges: [],
    };
  }
  clearCache() {
    this.cache.clear();
  }
  private async acquire(signal: AbortSignal) {
    while (this.active >= this.profile.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        const cleanup = () => {
          this.waiters.delete(wake);
          signal.removeEventListener("abort", abort);
        };
        this.waiters.add(wake);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    this.active++;
  }
  async readRange(
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.size
    )
      throw new RangeError("Expected a half-open range within the file");
    this.onRequest?.();
    const rec: RangeRecord = {
      start,
      end,
      requestedMs: performance.now() - this.epoch,
      endedMs: null,
      delivered: 0,
      cacheHitBytes: 0,
      cancelled: false,
    };
    this.stats.ranges.push(rec);
    let acquired = false,
      allocated = 0;
    try {
      await this.acquire(signal);
      acquired = true;
      const out = new Uint8Array(end - start);
      allocated = out.byteLength;
      this.inFlightBytes += allocated;
      for (let p = start; p < end; p += this.profile.chunkBytes) {
        signal.throwIfAborted();
        const q = Math.min(end, p + this.profile.chunkBytes);
        let data: Uint8Array<ArrayBuffer> | undefined;
        for (const [key, entry] of this.cache)
          if (entry.start <= p && entry.end >= q) {
            data = entry.data.slice(p - entry.start, q - entry.start);
            this.cache.delete(key);
            this.cache.set(key, entry);
            break;
          }
        if (data) {
          rec.cacheHitBytes += data.length;
          this.stats.cacheHitBytes += data.length;
        } else {
          if (this.profile.mode === "simulated") {
            if (p === start) {
              this.random =
                (Math.imul(1664525, this.random) + 1013904223) >>> 0;
              await delay(
                Math.max(
                  0,
                  this.profile.latencyMs +
                    ((this.random / 4294967296) * 2 - 1) *
                      this.profile.jitterMs,
                ),
                signal,
              );
            }
            await this.connection.transfer(q - p, signal);
          }
          const buffer = await this.blob.slice(p, q).arrayBuffer();
          // Blob reads cannot be interrupted; do not deliver their contents after cancellation.
          signal.throwIfAborted();
          data = new Uint8Array(buffer);
          rec.delivered += data.length;
          this.stats.deliveredBytes += data.length;
          let overlap = 0;
          for (const [a, b] of this.seen)
            overlap += Math.max(0, Math.min(q, b) - Math.max(p, a));
          this.stats.redundantBytes += overlap;
          const merged: [number, number][] = [];
          let lo = p,
            hi = q;
          for (const [a, b] of this.seen) {
            if (b < lo || a > hi) merged.push([a, b]);
            else {
              lo = Math.min(lo, a);
              hi = Math.max(hi, b);
            }
          }
          merged.push([lo, hi]);
          this.seen = merged.sort((a, b) => a[0] - b[0]);
          if (data.length <= this.profile.cacheBytes) {
            while (this.cachedBytes + data.length > this.profile.cacheBytes)
              this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(`${p}:${q}`, { start: p, end: q, data });
          }
        }
        this.stats.firstByteMs ??= performance.now() - this.epoch;
        out.set(data, p - start);
      }
      return out;
    } catch (e) {
      if (signal.aborted) {
        rec.cancelled = true;
        this.stats.cancellations++;
      }
      throw e;
    } finally {
      rec.endedMs = performance.now() - this.epoch;
      this.inFlightBytes -= allocated;
      if (acquired) {
        this.active--;
        for (const wake of [...this.waiters]) wake();
      }
    }
  }
  async *stream(signal: AbortSignal, start = 0, end = this.size) {
    if (start < 0 || end > this.size || end < start)
      throw new RangeError("Invalid stream range");
    for (let p = start; p < end; p += this.profile.chunkBytes)
      yield await this.readRange(
        p,
        Math.min(end, p + this.profile.chunkBytes),
        signal,
      );
  }
}
