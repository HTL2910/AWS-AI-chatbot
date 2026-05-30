import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface Change {
  type: 'feature' | 'fix' | 'breaking' | 'docs' | 'refactor' | 'perf' | 'test';
  description: string;
  file?: string;
  commit?: string;
}

export interface ChangeSet {
  breaking: Change[];
  features: Change[];
  fixes: Change[];
  other: Change[];
}

/**
 * Detects changes between two git commits/tags
 * Parses conventional commit messages to categorize changes
 */
export class ChangeDetector {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get all commits between two refs (tags/branches)
   */
  getCommitsBetween(fromRef: string, toRef: string = 'HEAD'): string[] {
    try {
      const output = execSync(
        `cd "${this.workspaceRoot}" && git log ${fromRef}..${toRef} --oneline`,
        { encoding: 'utf-8' }
      );
      return output.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
      console.error(`Failed to get commits between ${fromRef} and ${toRef}:`, error);
      return [];
    }
  }

  /**
   * Parse conventional commit message
   * Format: type(scope): description
   * Breaking changes indicated by ! before colon or BREAKING CHANGE: in body
   */
  parseCommitMessage(message: string): Change | null {
    const lines = message.split('\n');
    const firstLine = lines[0];

    // Match: type(scope): description or type: description
    const match = firstLine.match(/^(feat|fix|docs|style|refactor|perf|test|chore|ci)(\(.+?\))?!?:\s*(.+)$/);
    if (!match) {
      return null;
    }

    const [, type, , description] = match;
    const isBreaking = firstLine.includes('!:') || message.includes('BREAKING CHANGE:');

    return {
      type: isBreaking ? 'breaking' : (type as any),
      description: description.trim(),
    };
  }

  /**
   * Detect all changes between two refs
   */
  detectChanges(fromRef: string, toRef: string = 'HEAD'): ChangeSet {
    const commits = this.getCommitsBetween(fromRef, toRef);
    const changeSet: ChangeSet = {
      breaking: [],
      features: [],
      fixes: [],
      other: [],
    };

    for (const commit of commits) {
      // Extract commit hash and message
      const [hash, ...messageParts] = commit.split(' ');
      const message = messageParts.join(' ');

      const change = this.parseCommitMessage(message);
      if (!change) {
        continue;
      }

      change.commit = hash;

      if (change.type === 'breaking') {
        changeSet.breaking.push(change);
      } else if (change.type === 'feature') {
        changeSet.features.push(change);
      } else if (change.type === 'fix') {
        changeSet.fixes.push(change);
      } else {
        changeSet.other.push(change);
      }
    }

    return changeSet;
  }

  /**
   * Get latest git tag
   */
  getLatestTag(): string | null {
    try {
      const output = execSync(
        `cd "${this.workspaceRoot}" && git describe --tags --abbrev=0 2>/dev/null || echo ""`,
        { encoding: 'utf-8' }
      );
      return output.trim() || null;
    } catch (error) {
      return null;
    }
  }
}
