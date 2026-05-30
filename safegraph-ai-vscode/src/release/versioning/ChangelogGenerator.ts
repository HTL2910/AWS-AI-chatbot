import * as fs from 'fs';
import * as path from 'path';
import { ChangeSet, Change } from './ChangeDetector';
import { Version, VersionBumper } from './VersionBumper';

export interface ChangelogEntry {
  version: string;
  date: string;
  breaking: Change[];
  features: Change[];
  fixes: Change[];
  other: Change[];
}

/**
 * Generates and maintains CHANGELOG.md file
 * Follows Keep a Changelog format: https://keepachangelog.com/
 */
export class ChangelogGenerator {
  private changelogPath: string;

  constructor(workspaceRoot: string) {
    this.changelogPath = path.join(workspaceRoot, 'CHANGELOG.md');
  }

  /**
   * Read existing CHANGELOG.md
   */
  readChangelog(): string {
    if (fs.existsSync(this.changelogPath)) {
      return fs.readFileSync(this.changelogPath, 'utf-8');
    }
    return this.getDefaultHeader();
  }

  /**
   * Get default CHANGELOG header
   */
  private getDefaultHeader(): string {
    return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;
  }

  /**
   * Format a single change entry
   */
  private formatChange(change: Change): string {
    let line = `- ${change.description}`;
    if (change.commit) {
      line += ` ([${change.commit.substring(0, 7)}](https://github.com/safegraph/aws-ai-chatbot/commit/${change.commit}))`;
    }
    return line;
  }

  /**
   * Generate changelog entry for a version
   */
  generateEntry(
    version: string,
    changeSet: ChangeSet,
    date: string = new Date().toISOString().split('T')[0]
  ): string {
    let entry = `## [${version}] - ${date}\n\n`;

    if (changeSet.breaking.length > 0) {
      entry += `### ⚠️ Breaking Changes\n\n`;
      for (const change of changeSet.breaking) {
        entry += this.formatChange(change) + '\n';
      }
      entry += '\n';
    }

    if (changeSet.features.length > 0) {
      entry += `### ✨ Features\n\n`;
      for (const change of changeSet.features) {
        entry += this.formatChange(change) + '\n';
      }
      entry += '\n';
    }

    if (changeSet.fixes.length > 0) {
      entry += `### 🐛 Bug Fixes\n\n`;
      for (const change of changeSet.fixes) {
        entry += this.formatChange(change) + '\n';
      }
      entry += '\n';
    }

    if (changeSet.other.length > 0) {
      entry += `### 📝 Other Changes\n\n`;
      for (const change of changeSet.other) {
        entry += this.formatChange(change) + '\n';
      }
      entry += '\n';
    }

    return entry;
  }

  /**
   * Prepend new entry to CHANGELOG.md
   */
  prependEntry(entry: string): void {
    const currentContent = this.readChangelog();
    const newContent = currentContent + entry + '\n';
    fs.writeFileSync(this.changelogPath, newContent, 'utf-8');
  }

  /**
   * Update CHANGELOG with new version
   */
  updateChangelog(
    version: string,
    changeSet: ChangeSet,
    date?: string
  ): void {
    const entry = this.generateEntry(version, changeSet, date);
    this.prependEntry(entry);
  }

  /**
   * Extract changelog for a specific version
   */
  getVersionChangelog(version: string): string | null {
    const content = this.readChangelog();
    const versionRegex = new RegExp(
      `## \\[${version}\\].*?(?=## \\[|$)`,
      's'
    );
    const match = content.match(versionRegex);
    return match ? match[0].trim() : null;
  }

  /**
   * Get all versions from CHANGELOG
   */
  getAllVersions(): string[] {
    const content = this.readChangelog();
    const matches = content.match(/## \[([^\]]+)\]/g) || [];
    return matches.map(m => m.replace(/## \[|\]/g, ''));
  }

  /**
   * Generate release notes from changelog entry
   */
  generateReleaseNotes(version: string): string {
    const changelog = this.getVersionChangelog(version);
    if (!changelog) {
      return '';
    }

    return `# Release Notes - v${version}\n\n${changelog}`;
  }
}
