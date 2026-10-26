import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Heuristic guardrails, not an NDA audit. Never open private locations.
const root = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const files = new Set(tracked);
async function walk(folder) {
  let entries;
  try {
    entries = await readdir(path.join(root, folder), { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const e of entries) {
    const file = `${folder}/${e.name}`;
    if (e.isDirectory()) await walk(file);
    else files.add(file);
  }
}
await walk("src");
await walk("public");
await walk("out");
for (const folder of ["tests", "vendor", "scripts", "docs", "crates", "worker"])
  await walk(folder);
await walk(".next/static");
await walk(".next/server");
const findings = [];
for (const file of files) {
  if (/\.(gpc|sgpc|ssog)$/i.test(file))
    findings.push(
      `${file}: encoded scene asset needs removal/manual authorization audit`,
    );
  if (!/\.(js|mjs|ts|tsx|map|json)$/i.test(file) || file.startsWith("tests/"))
    continue;
  const text = await readFile(path.join(root, file), "utf8");
  const patterns = [
    /(?:import|require)\s*\(?\s*["'][^"']+\.(?:gpc|sgpc|ssog)["']/i,
    /\b(?:encodeGpc|decodeGpc|parseGpc|serializeGpc|encodeSgpc|decodeSgpc|parseSgpc|serializeSgpc)\s*\(/,
    /(?:[A-Z]:[\\/](?:Users|Personal|Work)[\\/])(?!(?:[^\r\n]{0,80}check-public-artifacts))/,
  ];
  if (file.endsWith("check-public-artifacts.mjs")) continue;
  if (patterns.some((p) => p.test(text)))
    findings.push(
      `${file}: potential private implementation/path signature; inspect manually`,
    );
}
if (findings.length) {
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
} else
  console.log(
    `Checked ${files.size} tracked/source/public/export artifacts: no prohibited asset extensions or configured private-code/path signatures. This cannot certify NDA compliance.`,
  );
