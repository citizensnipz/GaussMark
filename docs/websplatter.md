# WebSplatter integration decision

**Status: investigated, not implemented in 0.1.0.** The selector is disabled; no WebSplatter capability or comparison is presented as working.

Inspected upstream on 2026-10-26: [WebSplatter](https://github.com/websplatter/WebSplatter), HEAD `16bb06e86b8fb12193d4bb4cd2b0b3d4f3ab62be`. [README](https://github.com/websplatter/WebSplatter/blob/16bb06e86b8fb12193d4bb4cd2b0b3d4f3ab62be/README.md), package manifest and `src/gaussian-renderer.ts` were read.

The project is MIT licensed and WebGPU-native. It is distributed as a Vite application (package name `webgpu-typescript-starter`), not a published renderer library with an exports entry. Its Gaussian renderer imports WGSL files, a PLY loader, camera/render settings, logging helpers, and application enums from `splat-app.ts`; it is not a drop-in React component. Upstream documents PLY and Gaussian glTF/GLB, including SPZ-compressed GLB. The release viewer uses a narrower GLB/SPZ path. None of these formats are advertised as supported by a GaussMark WebSplatter adapter yet.

Chosen next approach: vendor or fork a **pinned MIT source subset**, preserve its license and revision, extract the application-level enum/config dependencies, bundle WGSL as source, and implement `RendererAdapter` around its actual render loop. Do not embed the public viewer in an iframe, and do not substitute another renderer under the WebSplatter name.

Acceptance work for that adapter:

1. Import the same reference PLY with documented coordinate conventions, Gaussian scale/SH interpretation and colour handling.
2. Reuse GaussMark's deterministic camera position/target and exact render-target dimensions.
3. Define initialization/load/readiness events and a matching frame-interval boundary. Keep timestamp-query GPU timing separate.
4. Make animation/rendering stoppable and explicitly destroy buffers, pipelines, query sets, textures, workers and input handlers.
5. Exercise repeated renderer switching, device loss, unsupported devices, PLY loading, and output correctness in the browser.
6. Compare equivalent configurations only; report renderer quality/culling differences before treating frame rates as comparable.

The first build prioritizes the verified PlayCanvas/WASM vertical slice rather than wrapping a second viewer without validated lifecycle and measurement equivalence.
