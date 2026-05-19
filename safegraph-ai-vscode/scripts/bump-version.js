#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const packageJsonPath = path.join(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const [major, minor, patch] = pkg.version.split(".").map(Number);

let newMajor = major;
let newMinor = minor;
let newPatch = patch + 1;

// Auto increment: 0.0.1 -> ... -> 0.9.9 -> 1.0.0
if (newPatch >= 10) {
  newPatch = 0;
  newMinor += 1;
}
if (newMinor >= 10) {
  newMinor = 0;
  newMajor += 1;
}

const newVersion = `${newMajor}.${newMinor}.${newPatch}`;
pkg.version = newVersion;
pkg.displayName = `Safegraph AI v${newVersion}`;

const activityBar = pkg.contributes?.viewsContainers?.activitybar?.[0];
if (activityBar) {
  activityBar.title = `Safegraph AI v${newVersion}`;
}

const configuration = pkg.contributes?.configuration;
if (configuration) {
  configuration.title = `Safegraph AI v${newVersion}`;
}

fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Version bumped: ${newVersion}`);
