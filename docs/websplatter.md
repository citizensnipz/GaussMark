# WebSplatter integration

**Status: implemented and browser-tested for uncompressed Gaussian PLY, WebGPU only.**

The adapter runs the actual MIT WebSplatter cull, preprocess, GPU radix-sort and Gaussian draw pipeline, pinned to upstream revision `16bb06e86b8fb12193d4bb4cd2b0b3d4f3ab62be`. See [vendor notes](../vendor/websplatter/README.md) for the exact source subset, attribution and host adaptations. This is not an iframe or another renderer under the WebSplatter name.

The same local PLY blob survives renderer switches. Both adapters use SceneControls for the deterministic camera route, a 52-degree vertical field of view, near/far 0.01/1000, render-target size and object orientation. Local-file framing uses the same conservative bounds calculation. WebSplatter's +Z-forward, Y-down camera convention is converted from the shared camera pose.

SOG remains PlayCanvas-only. The WebSplatter adapter displays an explicit unsupported-format error, and never silently substitutes or converts the scene. WebGPU availability, parsing errors, oversized storage buffers and GPU validation failures prevent a completed result. Each switch cancels the worker/load and animation loop and destroys its dedicated device.

The host uses WebSplatter's f32 pipeline with SH through degree 3, default culling and kernel. It writes to the canvas format directly instead of the upstream viewer's HDR presentation path. PlayCanvas has its own packing, sort, culling and colour behavior. A/B is a comparison of these documented renderer configurations; matching camera/workload does not establish equivalent image quality. Frame intervals are measured at command submission/frame-end boundaries, not GPU completion durations.

Local saved slots A and B retain full measurements separately from the rolling session archive. SHA-256 identifies the file; custom filenames are retained locally and anonymized only for community submissions. Custom hashes are stripped before community submission. Comparison checks file identity, benchmark/methodology, camera motion, duration, warmup, repeats, target size, render scale, object rotation and browser/OS/DPR. Different APIs are allowed and identified. GPU strings are shown for the user to check. Missing identities, mismatches and selecting the same run suppress percentage comparisons.
