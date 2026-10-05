#!/usr/bin/env node
// Builds a self-contained .vsix: bundles src/ into a single out/extension.js
// with esbuild (no node_modules shipped), then packages it with vsce.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outFile = `safegraph-ai-${pkg.version}.vsix`;
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Drop tsc output so only the bundle ends up in the package.
fs.rmSync(path.join(root, "out"), { recursive: true, force: true });

run(bin("esbuild"), [
  "src/extension.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node18",
  "--external:vscode",
  "--minify",
  "--outfile=out/extension.js",
  "--log-level=warning"
]);

run(bin("vsce"), ["package", "--no-dependencies", "--out", outFile]);
