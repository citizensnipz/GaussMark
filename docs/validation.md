# Initial build validation

Validation performed locally on **2026-10-26 (Asia/Taipei)**. Windows host, installed Google Chrome, NVIDIA GeForce RTX 5070 reported through ANGLE. No public deployment, cloud database, DNS or account changes were made.

## Automated checks

| Check                                              | Outcome                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Production static export (`npm run build`)         | Passed; `/`, `/benchmark/`, `/results/`, icon                                                         |
| Frontend + Worker TypeScript (`npm run typecheck`) | Passed                                                                                                |
| TypeScript unit tests                              | 10 passed                                                                                             |
| Native Rust unit tests                             | 5 passed                                                                                              |
| Rust → WASM release build                          | Passed; 31,145-byte WASM binary                                                                       |
| Browser WASM execution                             | Passed: statistics self-check, actual run aggregation, ECEF reference and cross-implementation checks |
| Playwright production browser flows                | 8 passed                                                                                              |
| Dependency audit                                   | Zero reported vulnerabilities after dependency updates/override                                       |
| Reference asset hash/regeneration                  | Passed; same seed and SHA-256                                                                         |

The browser suite runs one worker at a time against the **production export served by the actual Cloudflare local emulator**. It uses a separate local D1 directory. Submission tests do not send data to a public endpoint or pollute the normal local database.

Browser coverage:

- Reference PLY renders at nonzero pixel dimensions; orbit changes the rendered canvas; reset works.
- Theme toggle survives reload; screenshots capture both themes.
- No document overflow at 1440×900 or 1366×768 in the workspace.
- Three real five-second passes after individual warm-ups produce per-pass and pooled raw measurements; the Rust median agrees with an independently calculated interpolation.
- Category switching preserves results; report dialog, JSON download and local archive work.
- Manual stop and resize cancel without saving a partial session.
- Local PLY loading, local-only read timeline, unsupported mesh rejection, return to reference scene.
- Rust and TypeScript WGS84/ECEF workloads pass correctness checks.
- WebGPU renders and completes a benchmark on this host; switching back to WebGL2 works.
- Dashboard loads its real API; mobile layout and inspector drawer are exercised at 390×844.
- Submission requires preview and explicit consent. API persists a real measured record, surfaces it on the dashboard, handles duplicate IDs, rejects mismatched methodology/hash and foreign origins, enforces payload bounds, accepts filters, and returns 429 after the hourly limit.

## Visual evidence

- [Benchmark — dark](screenshots/benchmark-dark.png)
- [Benchmark — light](screenshots/benchmark-light.png)
- [Dashboard — dark](screenshots/dashboard-dark.png)
- [Dashboard — light](screenshots/dashboard-light.png)
- [Mobile viewport](screenshots/benchmark-mobile.png)

The dashboard screenshots intentionally show an empty community database, not fabricated activity. The default reference scene is a real procedural Gaussian PLY, while the small dashboard reference-card icon is an illustration.

## Fixes from verification

Browser inspection found a zero-sized PlayCanvas drawing buffer despite frame callbacks; setting explicit fixed render-target dimensions corrected it. Changing API initially reused an incompatible browser canvas context; API changes now replace the canvas and dispose the old device. Narrow aspect ratios now fit the camera, theme contrast was corrected, and user inspection pan is reset before the deterministic benchmark path. Tests distinguish the app's alerts from Next.js's route announcer.

This machine already used port 3000. Local dev now uses 3005, and the API/production preview uses 3015. Early emulator ports 8787/8791 were unreachable in this tool environment; the alternate port worked. Temporary sandbox/cache permission issues were resolved without changing unrelated processes. A development-only manifest parsing failure during reload did not occur in the production export; final verification targets the production build.

## Limits of this evidence

Headless Chrome tests verify functionality and integrity, not a published hardware performance rating. The small reference is display-refresh-limited on this GPU. No measured FPS is presented as a performance recommendation. Firefox, Safari, real mobile devices, SOG decoding and native renderer integration were not verified. Native Rust mathematics and both PlayCanvas browser graphics APIs were verified. WebSplatter and fidelity metrics remain incomplete, as documented in the README.


## Scene controls and saved cross-renderer comparisons — 2026-10-26

- Production build and frontend/Worker TypeScript checks passed.
- 14 unit tests passed, including content identity, configuration/rotation mismatch detection and cross-renderer matching.
- All 9 browser/API cases passed across the regression run and the submission-selector rerun. The first submission check needed its status locator scoped because the new A/B controls also expose accessible status messages; submission itself remained successful.
- Actual PlayCanvas WebGL2 and WebSplatter WebGPU runs used the same local reference PLY, 45-degree Y orientation, 5-second single-pass protocol and identical 1047×650 target. Verified content hashes and configs matched, full samples were retained and saved slots survived reload.
- Verified fly movement changes the rendered image, object rotation, focus/reset controls, repeated renderer switches, SOG rejection on WebSplatter, and no page/GPU validation errors in the new end-to-end test.
- Visually inspected the real WebSplatter output against the PlayCanvas reference view. This is a framing/smoke check, not image-quality equivalence validation.
- Fixed comparison panel flex shrinking after screenshot review; its full content is reachable through the Results page scroll area.
- API tests used a separate local database under `.wrangler/ab-validation-20261026`. No test records were added to the normal preview database. Nothing was deployed or pushed.

New screenshots: `scene-controls.png`, `websplatter-local.png`, `comparison.png` under `docs/screenshots/`.


## In-scene rotation gizmos and renderer-specific navigation

17 unit tests pass, including default-mode PlayCanvas Q/E vertical movement, WebSplatter Q/E roll versus Space/Ctrl movement, and excluding inspection roll/held keys from benchmark routes. Production build and type checks pass. The new browser gizmo test and updated saved-comparison test both pass: real pointer dragging changes rotation and rendered pixels, accessible ring keyboard adjustment persists into A/B metadata, renderer-specific help changes correctly, gizmos hide during runs, and only one overlay remains after renderer switching. Screenshots: `gizmo-playcanvas.png` and `gizmo-websplatter.png`. The old slider/navigation-mode panel was replaced by read-only help.


## Interior route and local filename update

Production build, frontend/Worker type checks and 19 unit tests passed. Interior tests verify fixed radius/height across a full orbit, frozen up/eye under fast-mode requests, and inspection-camera restoration. Real browser runs passed for local filename reports, anonymized submission preview, saved circle restore, cross-renderer A settings and WebSplatter frozen-camera measurement. Existing saved A/B browser test also passed. Visual grid/circle inspection used the bundled sculpture as a local PLY; no room scan was available for testing, so route containment in a real interior remains a user placement check.
