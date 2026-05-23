#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const packageJsonPath = path.join(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const [major, minor, patch] = pkg.version.split(".").map(Number);

const newMajor = major;
const newMinor = minor;
const newPatch = patch + 1;

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
