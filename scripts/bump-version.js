#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const newVersion = args[0];

if (!newVersion) {
  console.error('Usage: node scripts/bump-version.js <version>');
  console.error('Example: node scripts/bump-version.js 0.10.0');
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Invalid version format. Use semantic versioning: X.Y.Z');
  process.exit(1);
}

const files = [
  'pyproject.toml',
  'safegraph-ai-vscode/package.json',
];

let updated = 0;

files.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${file}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const oldContent = content;

  if (file.endsWith('.toml')) {
    content = content.replace(
      /version\s*=\s*"[\d.]+"/,
      `version = "${newVersion}"`
    );
  } else if (file.endsWith('.json')) {
    content = content.replace(
      /"version": "[\d.]+"/,
      `"version": "${newVersion}"`
    );
  }

  if (content !== oldContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Updated ${file} to v${newVersion}`);
    updated++;
  } else {
    console.warn(`⚠️  No version found in ${file}`);
  }
});

console.log(`\n✅ Bumped ${updated} file(s) to v${newVersion}`);
