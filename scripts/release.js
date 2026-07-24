const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: node release.js <new_version>");
  console.error("Example: node release.js 0.19.0");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'safegraph-ai-vscode');

// 1. safegraph-ai-vscode/package.json
const packageJsonPath = path.join(extDir, 'package.json');
let packageJson = fs.readFileSync(packageJsonPath, 'utf8');
packageJson = packageJson.replace(/"version": ".*?"/, `"version": "${newVersion}"`);
packageJson = packageJson.replace(/"displayName": "Safegraph AI v.*?"/, `"displayName": "Safegraph AI v${newVersion}"`);
packageJson = packageJson.replace(/"title": "Safegraph AI v.*?"/, `"title": "Safegraph AI v${newVersion}"`);
fs.writeFileSync(packageJsonPath, packageJson);
console.log(`Updated package.json`);

// 2. safegraph-ai-vscode/README.md
const extReadmePath = path.join(extDir, 'README.md');
let extReadme = fs.readFileSync(extReadmePath, 'utf8');
extReadme = extReadme.replace(/Current release: `v.*?`/g, `Current release: \`v${newVersion}\``);
extReadme = extReadme.replace(/safegraph-ai-.*?\.vsix/g, `safegraph-ai-${newVersion}.vsix`);
extReadme = extReadme.replace(/safegraph\.safegraph-ai@.*?(\n|\r)/g, `safegraph.safegraph-ai@${newVersion}$1`);
extReadme = extReadme.replace(/Safegraph AI v\d+\.\d+\.\d+/g, `Safegraph AI v${newVersion}`);
extReadme = extReadme.replace(/## New in v\d+\.\d+\.\d+/g, `## New in v${newVersion}`);
extReadme = extReadme.replace(/## v\d+\.\d+\.\d+ Highlights/g, `## v${newVersion} Highlights`);
fs.writeFileSync(extReadmePath, extReadme);
console.log(`Updated safegraph-ai-vscode/README.md`);

// 3. README.md
const rootReadmePath = path.join(rootDir, 'README.md');
let rootReadme = fs.readFileSync(rootReadmePath, 'utf8');
rootReadme = rootReadme.replace(/Current extension version: `.*?`/g, `Current extension version: \`${newVersion}\``);
rootReadme = rootReadme.replace(/safegraph-ai-.*?\.vsix/g, `safegraph-ai-${newVersion}.vsix`);
rootReadme = rootReadme.replace(/safegraph\.safegraph-ai@.*?(\n|\r)/g, `safegraph.safegraph-ai@${newVersion}$1`);
fs.writeFileSync(rootReadmePath, rootReadme);
console.log(`Updated README.md`);

// 4. bedrockClient.ts
const bedrockClientPath = path.join(extDir, 'src', 'bedrock', 'bedrockClient.ts');
let bedrockClient = fs.readFileSync(bedrockClientPath, 'utf8');
bedrockClient = bedrockClient.replace(/"safegraph-ai-vscode\/.*?"/g, `"safegraph-ai-vscode/${newVersion}"`);
fs.writeFileSync(bedrockClientPath, bedrockClient);
console.log(`Updated bedrockClient.ts`);

// 5. CHANGELOG.md (prepend stub)
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const dateStr = new Date().toISOString().split('T')[0];
  const stub = `## [${newVersion}] - ${dateStr}\n\n### Added\n- \n\n### Changed\n- \n\n### Fixed\n- \n\n`;
  if (!changelog.includes(`## [${newVersion}]`)) {
    // find first ## [
    const insertPos = changelog.indexOf('## [');
    if (insertPos !== -1) {
      fs.writeFileSync(changelogPath, changelog.slice(0, insertPos) + stub + changelog.slice(insertPos));
      console.log(`Added stub to CHANGELOG.md`);
    }
  }
}

console.log(`\nSuccessfully bumped version to ${newVersion}`);
