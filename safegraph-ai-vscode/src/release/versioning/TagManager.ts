import { execSync } from 'child_process';

export interface GitTag {
  name: string;
  commit: string;
  date: string;
  message?: string;
}

/**
 * Manages git tags for version releases
 */
export class TagManager {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Create an annotated git tag
   */
  createTag(
    tagName: string,
    message: string,
    commit: string = 'HEAD'
  ): boolean {
    try {
      execSync(
        `cd "${this.workspaceRoot}" && git tag -a "${tagName}" -m "${message}" ${commit}`,
        { encoding: 'utf-8' }
      );
      console.log(`✅ Tag created: ${tagName}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to create tag ${tagName}:`, error);
      return false;
    }
  }

  /**
   * Delete a git tag
   */
  deleteTag(tagName: string, remote: boolean = false): boolean {
    try {
      if (remote) {
        execSync(
          `cd "${this.workspaceRoot}" && git push origin --delete ${tagName}`,
          { encoding: 'utf-8' }
        );
      } else {
        execSync(
          `cd "${this.workspaceRoot}" && git tag -d ${tagName}`,
          { encoding: 'utf-8' }
        );
      }
      console.log(`✅ Tag deleted: ${tagName}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to delete tag ${tagName}:`, error);
      return false;
    }
  }

  /**
   * List all tags
   */
  listTags(): GitTag[] {
    try {
      const output = execSync(
        `cd "${this.workspaceRoot}" && git tag -l --format='%(refname:short)|%(objectname:short)|%(creatordate:short)|%(contents)'`,
        { encoding: 'utf-8' }
      );

      return output
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [name, commit, date, message] = line.split('|');
          return {
            name: name || '',
            commit: commit || '',
            date: date || '',
            message: message || undefined,
          };
        });
    } catch (error) {
      console.error('Failed to list tags:', error);
      return [];
    }
  }

  /**
   * Get tag info
   */
  getTag(tagName: string): GitTag | null {
    try {
      const output = execSync(
        `cd "${this.workspaceRoot}" && git show ${tagName} --format='%(refname:short)|%(objectname:short)|%(creatordate:short)|%(contents)' -s`,
        { encoding: 'utf-8' }
      );

      const [name, commit, date, message] = output.trim().split('|');
      return {
        name: name || '',
        commit: commit || '',
        date: date || '',
        message: message || undefined,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Push tags to remote
   */
  pushTags(remote: string = 'origin'): boolean {
    try {
      execSync(
        `cd "${this.workspaceRoot}" && git push ${remote} --tags`,
        { encoding: 'utf-8' }
      );
      console.log(`✅ Tags pushed to ${remote}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to push tags:`, error);
      return false;
    }
  }
}
