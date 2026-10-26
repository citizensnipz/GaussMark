import { spawn } from "node:child_process";
import { resolve } from "node:path";
// Keep local emulator metadata in this checkout, including in restricted shells.
const child = spawn(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: resolve(".wrangler/config"),
      WRANGLER_LOG_PATH: resolve(".wrangler/logs"),
      WRANGLER_SEND_METRICS: "false",
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
