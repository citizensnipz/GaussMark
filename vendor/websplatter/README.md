# WebSplatter source subset

Pinned upstream: https://github.com/websplatter/WebSplatter/tree/16bb06e86b8fb12193d4bb4cd2b0b3d4f3ab62be (MIT; see LICENSE).

The Gaussian renderer, WGSL shaders, PLY worker/parser, utilities and their dependencies are vendored. Upstream type-only imports referring to the full application are erased by esbuild; the application itself is not included.

GaussMark modifications:
- PLY worker returns conservative scene bounds (same algorithm as PlayCanvas GSplatData.calcAabb) alongside parsed arrays.
- scripts/build-websplatter.mjs replaces the upstream DOM logger with console.debug, changes the render attachment from upstream HDR rgba16float to the supplied canvas presentation format, and supplies the matching GaussMark background clear colour. These are build-time source substitutions; upstream shader math and GPU cull/preprocess/radix-sort/draw passes remain intact.
- Host adapter uses f32 storage/arithmetic, SH through degree 3, no offline reordering, upstream default kernel 0.3, culling enabled, opacity-dependent radius enabled, and no GPU timing query instrumentation.
- Host owns the device, canvas, camera, worker and animation loop. Disposal destroys the entire dedicated device to release all upstream buffers, including intermediate buffers not exposed by the upstream class.

Build locally with npm run build:websplatter (also run by predev/prebuild). Generated JS is served from public/vendor. No runtime CDN dependency. The original upstream standalone viewer and HDR postprocess are not used. Results use rendererVersion 16bb06e-gaussmark.1 to identify these integration choices.
