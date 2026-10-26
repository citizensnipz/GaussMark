import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  loader: { ".wgsl": "text" },
  legalComments: "eof",
};
await build({
  ...common,
  stdin: {
    contents:
      "export {GaussianRenderer} from './vendor/websplatter/src/gaussian-renderer.ts'; export {setCanvasSize} from './vendor/websplatter/src/render-settings.ts';",
    resolveDir: process.cwd(),
  },
  outfile: "public/vendor/websplatter.js",
  plugins: [
    {
      name: "gaussmark-host",
      setup(b) {
        b.onLoad({ filter: /simple-console\.ts$/ }, () => ({
          contents: "export const log = console.debug;",
          loader: "ts",
        }));
        b.onLoad({ filter: /gaussian-renderer\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, "utf8"))
            .replace("format: 'rgba16float'", "format: this.presentationFormat")
            .replace(
              "clearValue: [0, 0, 0, 0]",
              "clearValue: [0.048, 0.055, 0.053, 1]",
            ),
          loader: "ts",
        }));
      },
    },
  ],
});
await build({
  ...common,
  entryPoints: ["vendor/websplatter/src/workers/ply-worker.ts"],
  outfile: "public/vendor/websplatter-ply-worker.js",
});
