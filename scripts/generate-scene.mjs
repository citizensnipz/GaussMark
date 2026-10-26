import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
// Original procedural asset, MIT. No captured or third-party content.
const points = [];
const add = (x, y, z, c, s = 0.025) =>
  points.push([
    x,
    y,
    z,
    0,
    0,
    0,
    ...c.map((v) => (v - 0.5) / 0.28209479177387814),
    3.5,
    Math.log(s),
    Math.log(s),
    Math.log(s),
    1,
    0,
    0,
    0,
  ]);
let seed = 42;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 4294967296;
};
// Interlocking brushed-metal toroids; lighting is baked into SH DC colour.
for (let ring = 0; ring < 3; ring++)
  for (let i = 0; i < 8000; i++) {
    const u = random() * Math.PI * 2,
      v = random() * Math.PI * 2;
    const r = 1.28 + 0.19 * Math.cos(v);
    let x = r * Math.cos(u),
      y = 0.19 * Math.sin(v),
      z = r * Math.sin(u);
    const tilt = [0.92, -0.92, 0][ring],
      yy = y * Math.cos(tilt) - z * Math.sin(tilt),
      zz = y * Math.sin(tilt) + z * Math.cos(tilt);
    const light =
      0.55 +
      0.45 *
        Math.max(
          0,
          0.3 * Math.cos(u) * Math.cos(v) +
            0.8 * Math.sin(v) +
            0.4 * Math.sin(u) * Math.cos(v),
        );
    const col = [
      [0.84, 0.68, 0.44],
      [0.51, 0.75, 0.68],
      [0.8, 0.81, 0.79],
    ][ring].map((t) => t * light);
    add(x, yy + 0.55, zz, col, 0.027);
  }
// Low circular stone plinth and concentric engraved rings.
for (let i = 0; i < 14000; i++) {
  const a = random() * Math.PI * 2,
    r = 1.95 * Math.sqrt(random()),
    edge = i % 5 === 0;
  const x = (edge ? 1.95 : r) * Math.cos(a),
    z = (edge ? 1.95 : r) * Math.sin(a);
  const y = edge ? -0.97 - random() * 0.35 : -0.97;
  const c = 0.28 + 0.045 * random();
  add(x, y, z, [c, c * 1.02, c * 1.01], 0.031);
}
for (let i = 0; i < 9000; i++) {
  const x = (random() - 0.5) * 8,
    z = (random() - 0.5) * 8,
    c = 0.1 + 0.025 * random();
  add(x, -1.36, z, [c, c * 1.04, c * 1.03], 0.048);
}
const fields = [
  "x",
  "y",
  "z",
  "nx",
  "ny",
  "nz",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
];
const header = Buffer.from(
  `ply\nformat binary_little_endian 1.0\ncomment GaussMark Orbital v1 - original procedural scene - MIT\nelement vertex ${points.length}\n${fields.map((f) => `property float ${f}`).join("\n")}\nend_header\n`,
);
const body = Buffer.alloc(points.length * fields.length * 4);
points.forEach((p, i) =>
  p.forEach((v, j) => body.writeFloatLE(v, (i * fields.length + j) * 4)),
);
const file = Buffer.concat([header, body]);
mkdirSync("public/scenes", { recursive: true });
writeFileSync("public/scenes/orbital-v1.ply", file);
writeFileSync(
  "public/scenes/orbital-v1.json",
  JSON.stringify(
    {
      id: "orbital",
      version: "1",
      name: "Orbital study",
      license: "MIT",
      source: "scripts/generate-scene.mjs",
      seed: 42,
      gaussians: points.length,
      bytes: file.length,
      sha256: createHash("sha256").update(file).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Generated ${points.length} Gaussians, ${file.length} bytes.`);
