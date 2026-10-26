import { statsFromArray, ecefTs } from "./math";
type Wasm = {
  default: (options?: unknown) => Promise<unknown>;
  statistics: (s: Float64Array) => Float64Array;
  ecef: (lat: number, lon: number, h: number) => Float64Array;
  ecef_batch: (points: Float64Array) => Float64Array;
};
let pending: Promise<Wasm> | undefined;
export function loadWasm(): Promise<Wasm> {
  if (!pending)
    pending = (async () => {
      const modulePath = "/wasm/gaussmark_core.js";
      const module = (await import(
        /* webpackIgnore: true */ modulePath
      )) as Wasm;
      await module.default();
      const reference = module.statistics(new Float64Array([1, 2, 3, 4]));
      if (reference[1] !== 2.5)
        throw new Error("WASM statistics self-check failed.");
      return module;
    })().catch((e) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
export async function aggregate(frames: number[]) {
  const wasm = await loadWasm();
  return statsFromArray(wasm.statistics(new Float64Array(frames)));
}
export async function spatialBenchmark() {
  const wasm = await loadWasm();
  const cases = [
    { input: [0, 0, 0], expected: [6378137, 0, 0] },
    { input: [90, 0, 0], expected: [0, 0, 6356752.314245179] },
    { input: [0, 90, 100], expected: [0, 6378237, 0] },
  ];
  let referenceError = 0;
  for (const c of cases) {
    const out = wasm.ecef(c.input[0], c.input[1], c.input[2]);
    c.expected.forEach(
      (v, i) =>
        (referenceError = Math.max(referenceError, Math.abs(v - out[i]))),
    );
  }
  if (referenceError > 1e-6)
    throw new Error("WGS84 reference cases exceeded 1 micrometre tolerance.");
  const n = 50000,
    input = new Float64Array(n * 3),
    js = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    input[i * 3] = -80 + (i % 16000) / 100;
    input[i * 3 + 1] = -180 + (i % 36000) / 100;
    input[i * 3 + 2] = i % 3000;
  }
  wasm.ecef_batch(input);
  for (let i = 0; i < n; i++)
    js.set(ecefTs(input[i * 3], input[i * 3 + 1], input[i * 3 + 2]), i * 3);
  const wasmTimes: number[] = [],
    tsTimes: number[] = [];
  let output = new Float64Array();
  const runWasm = () => {
    const start = performance.now();
    output = wasm.ecef_batch(input) as Float64Array<ArrayBuffer>;
    wasmTimes.push(performance.now() - start);
  };
  const runTs = () => {
    const start = performance.now();
    for (let i = 0; i < n; i++)
      js.set(ecefTs(input[i * 3], input[i * 3 + 1], input[i * 3 + 2]), i * 3);
    tsTimes.push(performance.now() - start);
  };
  for (let repeat = 0; repeat < 6; repeat++) {
    if (repeat % 2) {
      runTs();
      runWasm();
    } else {
      runWasm();
      runTs();
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  let maxError = 0;
  for (let i = 0; i < js.length; i++)
    maxError = Math.max(maxError, Math.abs(js[i] - output[i]));
  if (maxError > 1e-6)
    throw new Error("Implementations disagree beyond 1 micrometre.");
  return {
    points: n,
    wasmMs: (await aggregate(wasmTimes)).median,
    tsMs: (await aggregate(tsTimes)).median,
    maxError,
    referenceError,
    tolerance: 1e-6,
  };
}
