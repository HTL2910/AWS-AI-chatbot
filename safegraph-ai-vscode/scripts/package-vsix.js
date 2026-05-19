#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const outFile = `safegraph-ai-${pkg.version}.vsix`;

const result = spawnSync("vsce", ["package", "--out", outFile], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
