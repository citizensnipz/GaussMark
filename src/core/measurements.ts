import type { MemorySample, Milestone, Stage } from "./practical-types";

export class Timeline {
  private closed = false;
  readonly origin = performance.now();
  readonly stages: Stage[] = [];
  readonly milestones: Record<string, Milestone> = {};
  now() {
    return performance.now() - this.origin;
  }
  mark(name: string, criterion: string) {
    if (this.closed) return;
    this.milestones[name] ??= { ms: this.now(), criterion };
  }
  unavailable(name: string, criterion: string, reason: string) {
    this.milestones[name] ??= { ms: null, criterion, unavailable: reason };
  }
  begin(name: string, kind: Stage["kind"] = "elapsed") {
    const startMs = this.now();
    const stage: Stage = {
      name,
      kind,
      startMs,
      endMs: startMs,
      incomplete: true,
    };
    if (!this.closed) this.stages.push(stage);
    return () => {
      if (!this.closed && stage.incomplete) {
        stage.endMs = this.now();
        delete stage.incomplete;
      }
    };
  }
  close() {
    for (const stage of this.stages)
      if (stage.incomplete) stage.endMs = this.now();
    this.closed = true;
  }
}
type Owner = "application" | "worker" | "gpu";
/** Identity is the underlying allocation, not a typed-array view. Transfers change owner. */
export class AllocationLedger {
  private entries = new Map<object, { bytes: number; owner: Owner }>();
  track(identity: object, bytes: number, owner: Owner) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw Error("Invalid allocation size");
    const existing = this.entries.get(identity);
    if (existing && existing.bytes !== bytes)
      throw Error("Allocation identity has inconsistent size");
    this.entries.set(identity, { bytes, owner });
  }
  buffer(
    view: ArrayBuffer | SharedArrayBuffer | ArrayBufferView,
    owner: Owner = "application",
  ) {
    const b = ArrayBuffer.isView(view) ? view.buffer : view;
    this.track(b, b.byteLength, owner);
    return b;
  }
  transfer(identity: object, owner: Owner) {
    const e = this.entries.get(identity);
    if (!e) throw Error("Unknown transfer");
    e.owner = owner;
  }
  release(identity: object) {
    this.entries.delete(identity);
  }
  clear() {
    this.entries.clear();
  }
  totals() {
    const total = { application: 0, worker: 0, gpu: 0 };
    for (const e of this.entries.values()) total[e.owner] += e.bytes;
    return total;
  }
  get count() {
    return this.entries.size;
  }
}
export function sampleMemory(
  ledger: AllocationLedger,
  atMs: number,
  checkpoint: string,
  cache: number,
): MemorySample {
  const jsHeap =
    (performance as Performance & { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize ?? null;
  return { atMs, checkpoint, jsHeap, ...ledger.totals(), cache };
}
export function distribution(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const x = (sorted.length - 1) * p;
    return (
      sorted[Math.floor(x)] +
      (sorted[Math.ceil(x)] - sorted[Math.floor(x)]) * (x % 1)
    );
  };
  return {
    count: values.length,
    median: q(0.5),
    min: sorted[0],
    max: sorted.at(-1)!,
    iqr: q(0.75) - q(0.25),
    p95: values.length >= 100 ? q(0.95) : null,
    p99: values.length >= 100 ? q(0.99) : null,
  };
}
export function memorySlope(values: number[], warmup: number): number | null {
  const v = values.slice(warmup);
  if (v.length < 3) return null;
  const mx = (v.length - 1) / 2,
    my = v.reduce((a, b) => a + b, 0) / v.length;
  return (
    v.reduce((s, y, i) => s + (i - mx) * (y - my), 0) /
    v.reduce((s, _, i) => s + (i - mx) ** 2, 0)
  );
}
export function amplification(
  numerator: number | null,
  denominator: number | null,
) {
  return numerator !== null && denominator !== null && denominator > 0
    ? numerator / denominator
    : null;
}
