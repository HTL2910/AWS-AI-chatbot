#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read version from package.json
const packageJsonPath = path.join(__dirname, '..', 'safegraph-ai-vscode', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`📦 Packaging Safegraph AI v${version}...`);

// Create releases directory if it doesn't exist
const releasesDir = path.join(__dirname, '..', 'releases');
if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
  console.log(`✅ Created releases directory`);
}

try {
  // Change to safegraph-ai-vscode directory and run vsce package
  const vscodeDir = path.join(__dirname, '..', 'safegraph-ai-vscode');
  process.chdir(vscodeDir);
  
  console.log(`📍 Working directory: ${process.cwd()}`);
  console.log(`🔨 Running vsce package...`);
  
  // Run vsce package
  execSync('npx vsce package', { stdio: 'inherit' });
  
  // Move VSIX to releases folder
  const vsixFile = `safegraph-ai-${version}.vsix`;
  const sourcePath = path.join(vscodeDir, vsixFile);
  const destPath = path.join(releasesDir, vsixFile);
  
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✅ Packaged: ${destPath}`);
  }
} catch (error) {
  console.error(`❌ Packaging failed: ${error.message}`);
  process.exit(1);
}