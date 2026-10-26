import { writeFileSync } from "node:fs";
// wasm-pack writes an ignore-all file. These small browser artifacts ship with GaussMark.
writeFileSync(
  "public/wasm/.gitignore",
  "# Generated browser artifacts are deliberately versioned for a zero-Rust local start.\n",
);
