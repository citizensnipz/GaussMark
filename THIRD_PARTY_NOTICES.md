# Third-party notices

GaussMark's original code and `Orbital study v1` procedural scene use the repository's MIT license. The existing copyright was retained. The scene is generated entirely from mathematical geometry in `scripts/generate-scene.mjs`; it contains no third-party scans or images.

Direct runtime dependencies as installed in the lockfile:

| Dependency        | Version | License |
| ----------------- | ------- | ------- |
| PlayCanvas Engine | 2.23.3  | MIT     |
| Next.js           | 16.4.3  | MIT     |
| React / React DOM | 19.3.1  | MIT     |
| Tailwind CSS      | 4.3.3   | MIT     |
| Lucide React      | 0.468.0 | ISC     |
| Zod               | 4.6.7   | MIT     |

Rust bindings use wasm-bindgen (MIT OR Apache-2.0). wasm-pack is also MIT OR Apache-2.0. Rust transitive dependencies and versions are locked in `crates/gaussmark-core/Cargo.lock`; Node dependencies are locked in `package-lock.json`. Package distributions retain their own license notices. The build's third-party JavaScript license comments are retained by the bundler.

Playwright, Vitest, TypeScript, Prettier, Wrangler and associated build tools are development dependencies. WebSplatter is referenced in design notes only; none of its source, assets or branding are bundled in this version.

The generated browser WASM is compiled from GaussMark's Rust core plus wasm-bindgen. It is not a downloaded third-party benchmark binary.

## WebSplatter
Pinned MIT source subset: revision 16bb06e86b8fb12193d4bb4cd2b0b3d4f3ab62be (see vendor/websplatter/LICENSE and README.md for exact revision and modifications). Source: https://github.com/websplatter/WebSplatter. Gaussian GPU pipeline and PLY parser used in the WebGPU adapter.
