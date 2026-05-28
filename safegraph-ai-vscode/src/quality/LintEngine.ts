/**
 * Lint Engine - ESLint, Prettier, TypeScript strict mode enforcement
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface LintResult {
  filePath: string;
  errors: LintError[];
  warnings: LintWarning[];
  fixed: boolean;
}

export interface LintError {
  line: number;
  column: number;
  message: string;
  rule: string;
  severity: 'error';
}

export interface LintWarning {
  line: number;
  column: number;
  message: string;
  rule: string;
  severity: 'warning';
}

export class LintEngine {
  private workspaceFolder: string;
  private results: LintResult[] = [];
  private eslintConfig: any;
  private prettierConfig: any;

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
    this.loadConfigs();
  }

  /**
   * Lint a single file
   */
  async lintFile(filePath: string, fix: boolean = false): Promise<LintResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const result: LintResult = {
      filePath,
      errors: [],
      warnings: [],
      fixed: false,
    };

    // Run ESLint
    const eslintErrors = await this.runESLint(filePath, fix);
    result.errors.push(...eslintErrors.errors);
    result.warnings.push(...eslintErrors.warnings);

    // Run Prettier
    const prettierFixed = await this.runPrettier(filePath, fix);
    if (prettierFixed) {
      result.fixed = true;
    }

    // Check TypeScript strict mode
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const tsErrors = await this.checkTypeScriptStrict(filePath);
      result.errors.push(...tsErrors);
    }

    this.results.push(result);
    return result;
  }

  /**
   * Lint all files in a directory
   */
  async lintDirectory(dirPath: string, fix: boolean = false): Promise<LintResult[]> {
    const results: LintResult[] = [];
    const files = this.getFilesToLint(dirPath);

    for (const file of files) {
      const result = await this.lintFile(file, fix);
      results.push(result);
    }

    return results;
  }

  /**
   * Run ESLint
   */
  private async runESLint(
    filePath: string,
    fix: boolean = false
  ): Promise<{ errors: LintError[]; warnings: LintWarning[] }> {
    const errors: LintError[] = [];
    const warnings: LintWarning[] = [];

    try {
      const fixFlag = fix ? '--fix' : '';
      const cmd = `npx eslint ${filePath} ${fixFlag} --format json`;

      try {
        const output = execSync(cmd, {
          cwd: this.workspaceFolder,
          encoding: 'utf-8',
        });

        const results = JSON.parse(output);
        if (results.length > 0) {
          const fileResult = results[0];
          for (const message of fileResult.messages) {
            if (message.severity === 2) {
              errors.push({
                line: message.line,
                column: message.column,
                message: message.message,
                rule: message.ruleId || 'unknown',
                severity: 'error',
              });
            } else if (message.severity === 1) {
              warnings.push({
                line: message.line,
                column: message.column,
                message: message.message,
                rule: message.ruleId || 'unknown',
                severity: 'warning',
              });
            }
          }
        }
      } catch (error: any) {
        // ESLint returns exit code 1 if there are errors, but still outputs JSON
        if (error.stdout) {
          const results = JSON.parse(error.stdout);
          if (results.length > 0) {
            const fileResult = results[0];
            for (const message of fileResult.messages) {
              if (message.severity === 2) {
                errors.push({
                  line: message.line,
                  column: message.column,
                  message: message.message,
                  rule: message.ruleId || 'unknown',
                  severity: 'error',
                });
              } else if (message.severity === 1) {
                warnings.push({
                  line: message.line,
                  column: message.column,
                  message: message.message,
                  rule: message.ruleId || 'unknown',
                  severity: 'warning',
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error running ESLint:', error);
    }

    return { errors, warnings };
  }

  /**
   * Run Prettier
   */
  private async runPrettier(filePath: string, fix: boolean = false): Promise<boolean> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const cmd = fix
        ? `npx prettier --write ${filePath}`
        : `npx prettier --check ${filePath}`;

      try {
        execSync(cmd, {
          cwd: this.workspaceFolder,
          encoding: 'utf-8',
        });
        return false; // Already formatted
      } catch (error: any) {
        if (fix) {
          return true; // Fixed
        }
        return true; // Needs formatting
      }
    } catch (error) {
      console.error('Error running Prettier:', error);
      return false;
    }
  }

  /**
   * Check TypeScript strict mode
   */
  private async checkTypeScriptStrict(filePath: string): Promise<LintError[]> {
    const errors: LintError[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Check for 'any' type usage
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/:\s*any\b/.test(line) && !line.includes('// @ts-ignore')) {
          errors.push({
            line: i + 1,
            column: line.indexOf('any'),
            message: "Avoid using 'any' type, use explicit types instead",
            rule: 'no-implicit-any',
            severity: 'error',
          });
        }
      }

      // Check for implicit any in function parameters
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\(\s*\w+\s*\)/.test(line) && !line.includes(':') && !line.includes('// @ts-ignore')) {
          errors.push({
            line: i + 1,
            column: 0,
            message: 'Function parameter missing type annotation',
            rule: 'no-implicit-any',
            severity: 'error',
          });
        }
      }
    } catch (error) {
      console.error('Error checking TypeScript strict mode:', error);
    }

    return errors;
  }

  /**
   * Get files to lint
   */
  private getFilesToLint(dirPath: string): string[] {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules and other common directories
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    walk(dirPath);
    return files;
  }

  /**
   * Load ESLint and Prettier configs
   */
  private loadConfigs(): void {
    try {
      const eslintPath = path.join(this.workspaceFolder, '.eslintrc.json');
      if (fs.existsSync(eslintPath)) {
        this.eslintConfig = JSON.parse(fs.readFileSync(eslintPath, 'utf-8'));
      }
    } catch (error) {
      console.error('Error loading ESLint config:', error);
    }

    try {
      const prettierPath = path.join(this.workspaceFolder, '.prettierrc.json');
      if (fs.existsSync(prettierPath)) {
        this.prettierConfig = JSON.parse(fs.readFileSync(prettierPath, 'utf-8'));
      }
    } catch (error) {
      console.error('Error loading Prettier config:', error);
    }
  }

  /**
   * Get summary
   */
  getSummary(): {
    totalFiles: number;
    totalErrors: number;
    totalWarnings: number;
    filesWithErrors: number;
  } {
    let totalErrors = 0;
    let totalWarnings = 0;
    let filesWithErrors = 0;

    for (const result of this.results) {
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
      if (result.errors.length > 0) {
        filesWithErrors++;
      }
    }

    return {
      totalFiles: this.results.length,
      totalErrors,
      totalWarnings,
      filesWithErrors,
    };
  }

  /**
   * Get results
   */
  getResults(): LintResult[] {
    return this.results;
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }
}
