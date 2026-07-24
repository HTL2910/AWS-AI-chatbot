#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const extensionDir = path.join(rootDir, "safegraph-ai-vscode");
const paths = {
  packageJson: path.join(extensionDir, "package.json"),
  packageLock: path.join(extensionDir, "package-lock.json"),
  rootReadme: path.join(rootDir, "README.md"),
  extensionReadme: path.join(extensionDir, "README.md"),
  changelog: path.join(rootDir, "CHANGELOG.md"),
};

const versionPattern = /^\d+\.\d+\.\d+$/;
const vsixPattern = /safegraph-ai-(\d+\.\d+\.\d+)\.vsix/g;
const installedVersionPattern = /safegraph\.safegraph-ai@(\d+\.\d+\.\d+)/g;

function fail(messages) {
  for (const message of messages) {
    console.error(`ERROR: ${message}`);
  }
  process.exit(1);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${path.relative(rootDir, filePath)}`);
}

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not find ${label}`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function versionsFor(content, pattern) {
  pattern.lastIndex = 0;
  return [...content.matchAll(pattern)].map((match) => match[1]);
}

function check() {
  const pkg = JSON.parse(read(paths.packageJson));
  const lock = JSON.parse(read(paths.packageLock));
  const rootReadme = read(paths.rootReadme);
  const extensionReadme = read(paths.extensionReadme);
  const changelog = read(paths.changelog);
  const version = pkg.version;
  const errors = [];

  if (!versionPattern.test(version)) {
    errors.push(`Invalid extension package version: ${version}`);
  }
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    errors.push("safegraph-ai-vscode/package-lock.json differs from the extension package version");
  }
  if (!rootReadme.includes(`Current extension version: \`${version}\``)) {
    errors.push("Root README differs from the extension package version");
  }
  if (!extensionReadme.includes(`Current release: \`v${version}\``)) {
    errors.push("Extension README differs from the extension package version");
  }

  const rootVsixVersions = versionsFor(rootReadme, vsixPattern);
  const extensionVsixVersions = versionsFor(extensionReadme, vsixPattern);
  if (
    rootVsixVersions.length === 0 ||
    extensionVsixVersions.length === 0 ||
    [...rootVsixVersions, ...extensionVsixVersions].some((value) => value !== version)
  ) {
    errors.push("VSIX filename reference differs from the extension package version");
  }

  const rootInstalledVersions = versionsFor(rootReadme, installedVersionPattern);
  const extensionInstalledVersions = versionsFor(extensionReadme, installedVersionPattern);
  if (
    rootInstalledVersions.some((value) => value !== version) ||
    extensionInstalledVersions.some((value) => value !== version)
  ) {
    errors.push("Installed extension version reference differs from the extension package version");
  }
  if (
    !rootReadme.includes(`Current extension version: \`${version}\``) ||
    !extensionReadme.includes(`Current release: \`v${version}\``)
  ) {
    errors.push("Root and extension README versions differ");
  }
  if (!new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\](?:\\s|$)`, "m").test(changelog)) {
    errors.push(`CHANGELOG.md is missing version ${version}`);
  }

  if (errors.length > 0) {
    fail(errors);
  }
  console.log(`Release metadata is consistent at ${version}`);
}

function setVersion(newVersion) {
  if (!versionPattern.test(newVersion)) {
    fail(["Usage: node scripts/release.js <new_version>", "Example: node scripts/release.js 0.19.0"]);
  }

  const pkg = JSON.parse(read(paths.packageJson));
  pkg.version = newVersion;
  pkg.displayName = `Safegraph AI v${newVersion}`;
  if (pkg.contributes?.configuration) {
    pkg.contributes.configuration.title = `Safegraph AI v${newVersion}`;
  }
  const activityBar = pkg.contributes?.viewsContainers?.activitybar?.[0];
  if (activityBar) {
    activityBar.title = `Safegraph AI v${newVersion}`;
  }
  write(paths.packageJson, `${JSON.stringify(pkg, null, 2)}\n`);

  const lock = JSON.parse(read(paths.packageLock));
  lock.version = newVersion;
  if (lock.packages?.[""]) {
    lock.packages[""].version = newVersion;
  }
  write(paths.packageLock, `${JSON.stringify(lock, null, 2)}\n`);

  let rootReadme = read(paths.rootReadme);
  rootReadme = replaceRequired(
    rootReadme,
    /Current extension version: `\d+\.\d+\.\d+`/,
    `Current extension version: \`${newVersion}\``,
    "the root README version"
  );
  rootReadme = rootReadme
    .replace(vsixPattern, `safegraph-ai-${newVersion}.vsix`)
    .replace(installedVersionPattern, `safegraph.safegraph-ai@${newVersion}`);
  write(paths.rootReadme, rootReadme);

  let extensionReadme = read(paths.extensionReadme);
  extensionReadme = replaceRequired(
    extensionReadme,
    /Current release: `v\d+\.\d+\.\d+`/,
    `Current release: \`v${newVersion}\``,
    "the extension README version"
  );
  extensionReadme = extensionReadme
    .replace(vsixPattern, `safegraph-ai-${newVersion}.vsix`)
    .replace(installedVersionPattern, `safegraph.safegraph-ai@${newVersion}`)
    .replace(/Safegraph AI v\d+\.\d+\.\d+/g, `Safegraph AI v${newVersion}`)
    .replace(/## New in v\d+\.\d+\.\d+/g, `## New in v${newVersion}`)
    .replace(/## v\d+\.\d+\.\d+ Highlights/g, `## v${newVersion} Highlights`);
  write(paths.extensionReadme, extensionReadme);

  let changelog = read(paths.changelog);
  const heading = new RegExp(`^## \\[${newVersion.replace(/\./g, "\\.")}\\](?:\\s|$)`, "m");
  if (!heading.test(changelog)) {
    const date = new Date().toISOString().slice(0, 10);
    const entry = `## [${newVersion}] - ${date}\n\n### Changed\n- Prepare release ${newVersion}.\n\n`;
    const insertionPoint = changelog.search(/^## \[/m);
    changelog =
      insertionPoint >= 0
        ? `${changelog.slice(0, insertionPoint)}${entry}${changelog.slice(insertionPoint)}`
        : `${changelog.trimEnd()}\n\n${entry}`;
    write(paths.changelog, changelog);
  }

  check();
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--check") {
  check();
} else if (args.length === 1) {
  setVersion(args[0]);
} else {
  fail([
    "Usage: node scripts/release.js <new_version>",
    "       node scripts/release.js --check",
  ]);
}
