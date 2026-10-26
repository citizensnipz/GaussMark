import type { ByteSource } from "./delivery";
import type { AllocationLedger } from "./measurements";
import type {
  DecodedMetadata,
  EditOperation,
  GaussianFormat,
} from "./practical-types";

/** Public decoded attributes. No encoded-format knowledge belongs in this project. */
export interface DecodedAttributes {
  metadata: DecodedMetadata;
  positions: Float32Array<ArrayBuffer>;
  opacity: Float32Array<ArrayBuffer>;
  covariance: Float32Array<ArrayBuffer>; // xx, xy, xz, yy, yz, zz
  sh: Float32Array<ArrayBuffer>; // splat-major, coefficient-major RGB; includes DC
}
export interface ReadOnlyProvider {
  readonly version: string;
  readonly formats: GaussianFormat[];
  readonly synthetic: boolean;
  decode(
    source: ByteSource,
    format: GaussianFormat,
    signal: AbortSignal,
    allocations?: AllocationLedger,
  ): Promise<DecodedAttributes>;
  dispose(): void;
}
/** Optional integration contracts. A decoder alone does not establish renderer support. */
export interface RegionProvider {
  region(
    source: ByteSource,
    bounds: number[],
    signal: AbortSignal,
  ): Promise<{
    attributes: DecodedAttributes;
    requestedSplats: number | null;
    decodedUnused: number | null;
  }>;
}
export interface EditProvider {
  operations: EditOperation[];
  apply(
    operation: EditOperation,
    signal: AbortSignal,
  ): Promise<{
    affectedSplats: number;
    bytesUpdated: number | null;
    bytesUploaded: number | null;
    temporaryBytes: number | null;
    visibleAt: number | null;
    visibleCriterion: string;
  }>;
}
export interface StreamingSession {
  navigate(
    pose: { eye: number[]; target: number[] },
    budgetBytes: number,
    signal: AbortSignal,
  ): Promise<{
    readyMs: number | null;
    evictions: number;
    refetchedBytes: number;
    decodedAgain: number;
    managedBytes: number;
  }>;
}
export const providerRequired = "Requires external read-only provider";
export function validateAttributes(a: DecodedAttributes): DecodedAttributes {
  const m = a?.metadata,
    n = m?.splats,
    d = m?.shDegree;
  if (
    !Number.isSafeInteger(n) ||
    n < 1 ||
    !Number.isInteger(d) ||
    d < 0 ||
    d > 3
  )
    throw Error(
      "Provider must supply positive splat count and SH degree 0–3; higher degrees are not silently truncated.",
    );
  for (const [v, size] of [
    [a.positions, n * 3],
    [a.opacity, n],
    [a.covariance, n * 6],
    [a.sh, n * 3 * (d + 1) ** 2],
  ] as const) {
    if (
      !(v instanceof Float32Array) ||
      v.length !== size ||
      !v.every(Number.isFinite)
    )
      throw Error("Invalid decoded attributes");
    if (
      !(v.buffer instanceof ArrayBuffer) ||
      v.byteOffset !== 0 ||
      v.byteLength !== v.buffer.byteLength
    )
      throw Error(
        "Provider attributes require whole transferable ArrayBuffers; offset/shared views are not supported by this bridge.",
      );
  }
  if (
    !Array.isArray(m.bounds) ||
    m.bounds.length !== 6 ||
    !m.bounds.every(Number.isFinite) ||
    m.bounds.slice(0, 3).some((v, i) => v > m.bounds[i + 3])
  )
    throw Error("Invalid decoded bounds");
  if (!a.opacity.every((v) => v >= 0 && v <= 1))
    throw Error("Opacity must be linear 0–1");
  return a;
}
export function mockProvider(): ReadOnlyProvider {
  return {
    version: "public-synthetic-1",
    formats: ["synthetic"],
    synthetic: true,
    async decode(_source, format, signal) {
      signal.throwIfAborted();
      if (format !== "synthetic")
        throw Error(
          "Mock provider only supports public synthetic attributes; it cannot decode files.",
        );
      const n = 512,
        positions = new Float32Array(n * 3),
        opacity = new Float32Array(n).fill(0.8),
        covariance = new Float32Array(n * 6),
        sh = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions.set(
          [
            ((i % 8) - 3.5) / 4,
            ((Math.floor(i / 8) % 8) - 3.5) / 4,
            (Math.floor(i / 64) - 3.5) / 4,
          ],
          i * 3,
        );
        covariance.set([0.003, 0, 0, 0.003, 0, 0.003], i * 6);
        sh.set([1, (i % 8) / 8, 0.2], i * 3);
      }
      return {
        metadata: {
          splats: n,
          shDegree: 0,
          bounds: [-1, -1, -1, 1, 1, 1],
          precision: "float32",
          verifiedBy: "decoder",
        },
        positions,
        opacity,
        covariance,
        sh,
      };
    },
    dispose() {},
  };
}

/** Explicitly selected, self-contained worker file. Its bytes never enter a build or persistence. */
export class LocalWorkerProvider implements ReadOnlyProvider {
  version = "external-local-v1";
  formats: GaussianFormat[] = [];
  readonly synthetic = false;
  private workers = new Set<Worker>();
  private cancellations = new Set<() => void>();
  private url: string;
  constructor(file: File) {
    this.url = URL.createObjectURL(file);
  }
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.url, { type: "module" });
      this.workers.add(worker);
      const clean = () => {
        clearTimeout(timeout);
        worker.terminate();
        this.workers.delete(worker);
      };
      const fail = () => {
        clean();
        reject(
          Error(
            "Provider handshake failed; expected gaussmark.readonly.v1 capabilities. Private details omitted.",
          ),
        );
      };
      const timeout = setTimeout(fail, 10000);
      worker.onerror = (e) => {
        e.preventDefault();
        fail();
      };
      worker.onmessage = (e) => {
        const m = e.data;
        if (
          m?.type !== "capabilities" ||
          m.protocol !== "gaussmark.readonly.v1" ||
          !Array.isArray(m.formats) ||
          !m.formats.length ||
          !m.formats.every(
            (f: unknown) =>
              typeof f === "string" &&
              ["gpc", "sgpc", "ssog", "ply", "sog"].includes(f),
          )
        ) {
          fail();
          return;
        }
        this.formats = [...new Set(m.formats)] as GaussianFormat[];
        // Only a non-identifying semantic version explicitly marked public can be exported.
        if (
          m.publicVersion === true &&
          typeof m.version === "string" &&
          /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(m.version)
        )
          this.version = m.version;
        clean();
        resolve();
      };
      worker.postMessage({
        type: "describe",
        protocol: "gaussmark.readonly.v1",
      });
    });
  }
  decode(
    source: ByteSource,
    format: GaussianFormat,
    signal: AbortSignal,
    allocations?: AllocationLedger,
  ): Promise<DecodedAttributes> {
    signal.throwIfAborted();
    if (!this.formats.includes(format))
      return Promise.reject(
        Error("Provider has not declared support for this format"),
      );
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.url, { type: "module" });
      this.workers.add(worker);
      const transferred = new Set<ArrayBuffer>();
      const clean = () => {
        worker.terminate();
        this.workers.delete(worker);
        for (const b of transferred) allocations?.release(b);
        transferred.clear();
        signal.removeEventListener("abort", abort);
        this.cancellations.delete(abort);
      };
      const fail = () => {
        clean();
        reject(
          Error("External provider failed; private error details omitted."),
        );
      };
      const abort = () => {
        clean();
        reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.cancellations.add(abort);
      worker.onerror = (e) => {
        e.preventDefault();
        fail();
      };
      worker.onmessageerror = fail;
      worker.onmessage = async (event: MessageEvent) => {
        try {
          const m = event.data;
          if (m.type === "read") {
            const data = await source.readRange(m.start, m.end, signal);
            if (!signal.aborted && this.workers.has(worker)) {
              allocations?.buffer(data, "worker");
              transferred.add(data.buffer);
              worker.postMessage({ type: "bytes", id: m.id, data }, [
                data.buffer,
              ]);
            }
          } else if (m.type === "decoded") {
            const a = validateAttributes(m.attributes);
            clean();
            resolve(a);
          } else if (m.type === "error") fail();
        } catch {
          if (signal.aborted) abort();
          else fail();
        }
      };
      worker.postMessage({
        type: "decode",
        protocol: "gaussmark.readonly.v1",
        format,
        size: source.size,
      });
    });
  }
  dispose() {
    for (const cancel of [...this.cancellations]) cancel();
    for (const w of this.workers) w.terminate();
    this.workers.clear();
    URL.revokeObjectURL(this.url);
  }
}
