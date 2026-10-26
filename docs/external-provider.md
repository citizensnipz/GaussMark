# External read-only provider protocol

GaussMark builds and works without a provider. A provider is explicitly selected by the user using a File picker for an **authorized, trusted, self-contained JavaScript module outside this repository**. The browser creates an ephemeral Blob URL and a module Worker; no dynamic import, build step, server upload, dependency installation, or persistence copies this module into GaussMark. Relative module imports from the local filesystem will not resolve. Supply authorized code as a self-contained local worker without changing public build tooling.

This boundary avoids publishing proprietary code; it is **not a security sandbox** for untrusted code. Workers can use browser networking. The user must trust the selected provider to keep data local. GaussMark gives the worker range access through messages rather than passing the original file or path. Do not log private input, SDK details, paths, algorithms or binary contents. The host suppresses provider error details in saved results. No private provider is included in the project or in the tests.

## Handshake

The host creates a temporary worker and sends:

```ts
{ type: "describe", protocol: "gaussmark.readonly.v1" }
```

The provider replies:

```ts
{
  type: "capabilities",
  protocol: "gaussmark.readonly.v1",
  formats: [/* only formats the authorized provider actually decodes */],
  version: "1.0.0",      // optional semantic version
  publicVersion: true   // optional explicit declaration this version is safe to export
}
```

Accepted format identifiers are `ply`, `sog`, `ssog`, `gpc`, `sgpc`. The host does not infer support from file extension. It records the provider's declaration, not an independent verification. Only public semantic versions are exported; other provider identifiers are omitted. Handshake timeout is 10 seconds. The handshake worker is terminated before benchmarking.

## Decode

Each measured decode uses a fresh worker. The host sends:

```ts
{ type: "decode", protocol: "gaussmark.readonly.v1", format, size }
```

The provider requests bytes with `{type:"read", id, start, end}`. Ranges are integer, half-open, within `[0,size]`. It can issue concurrent reads; all use the same measured byte source and shared connection. The host responds `{type:"bytes", id, data: Uint8Array}` with a transferred ArrayBuffer. The provider must apply backpressure and stop requesting ranges it no longer needs. Do not read a full file merely to prepare a partial-access test. The current bridge still requires a full decoded scene and never claims progressive rendering.

Completion is `{type:"decoded", attributes}` with the following **public decoded representation** (not any proprietary file layout):

```ts
interface DecodedAttributes {
  metadata: {
    splats: number;
    shDegree: number; // 0–3 supported; higher degrees rejected
    bounds: [number, number, number, number, number, number]; // min xyz, max xyz
    precision: string;
    compression?: string; // only non-sensitive, safely disclosable settings
    verifiedBy: "decoder";
  };
  positions: Float32Array;  // 3 values/splat
  opacity: Float32Array;    // 1 linear value/splat in [0,1]
  covariance: Float32Array;// 6 values/splat: xx, xy, xz, yy, yz, zz
  sh: Float32Array;         // splat-major, coefficient-major RGB, including DC;
                           // 3 * (degree + 1)^2 values/splat
}
```

Use transferable, whole ArrayBuffers for arrays; offset views and SharedArrayBuffer-backed attributes are rejected by this bridge. The generic allocation ledger can account for shared allocations without counting views twice. All values must be finite and lengths must match. Bounds/coordinates and SH conventions must match the public renderer. This interface contains no proprietary layout, codec, bitstream or algorithm knowledge. It preserves the attributes supported by WebSplatter; other source attributes have no supported renderer representation and must not be represented as preserved. Invalid output fails visibly. No SH degree is silently lowered.

Errors may be sent as `{type:"error"}`. The host records a generic error. A worker is terminated on success, error or cancellation; no writer/save method exists. Source File handles and provider Blob URLs are held only in memory until the dialog closes. The host has no authority to certify provider code publication rights.

## Rendering path and tests

The result records `source format → external read-only decode → decoded attribute interleaving → WebSplatter float32 GPU buffers`, `native: false`, and conversion time. Worker elapsed time can overlap byte delivery and includes startup and IPC. This path is **not native compressed-format rendering**. GPU preparation and conversion costs remain included.

The built-in public mock returns 512 synthetic decoded splats, supports only `synthetic`, and never reads or produces a GPC/SGPC/SSOG file. It exercises the bridge and cleanup. The mock cannot support claims about private formats.

The optional `RegionProvider`, `StreamingSession`, and `EditProvider` TypeScript contracts in `src/core/provider.ts` are extension points. A future adapter must expose matching capabilities, operate on the renderer's actual scene, return verified visible-result criteria, and implement cleanup before those suites can run. Supplying the current worker alone does not enable these suites.
