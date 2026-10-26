/* tslint:disable */
/* eslint-disable */

/**
 * WGS84 geodetic degrees/metres to ECEF metres, double precision.
 */
export function ecef(latitude: number, longitude: number, height: number): Float64Array;

/**
 * Deterministic batched geodetic workload. One boundary crossing per batch.
 */
export function ecef_batch(points: Float64Array): Float64Array;

/**
 * [count, median, p95, p99, mean, population variance, min, max].
 * Empty output signals invalid data; never silently discard bad samples.
 */
export function statistics(samples: Float64Array): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly ecef: (a: number, b: number, c: number) => [number, number];
    readonly ecef_batch: (a: number, b: number) => [number, number];
    readonly statistics: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
