import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  devIndicators: false,
  webpack(config) {
    config.module.rules.push({
      test: /playcanvas[\\/]src[\\/]framework[\\/]handlers[\\/]script\.js$/,
      enforce: "pre",
      use: [{ loader: path.resolve("scripts/public-script-base.cjs") }],
    });
    return config;
  },
};
export default config;
