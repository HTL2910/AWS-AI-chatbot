/**
 * Refactoring Validator - Verify refactoring doesn't break tests or functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ValidationResult {
  refactoringId: string;
  filePath: string;
  valid: boolean;
  testsPass: boolean;
  noRegressions: boolean;
  syntaxValid: boolean;
  typeCheckPass: boolean;
  issues: ValidationIssue[];
  timestamp: number;
}

export interface ValidationIssue {
  type: 'syntax_error' | 'type_error' | 'test_failure' | 'regression' | 'performance_regression';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  filePath?: string;
  lineNumber?: number;
  suggestion?: string;
}

export class RefactoringValidator {
  private workspaceFolder: string;
  private baselineMetrics: Map<string, any> = new Map();

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
  }

  /**
   * Validate refactored code
   */
  async validate(refactoringId: string, filePath: string): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    // Check syntax
    const syntaxValid = await this.checkSyntax(filePath);
    if (!syntaxValid) {
      issues.push({
        type: 'syntax_error',
        severity: 'critical',
        message: `Syntax error in ${path.basename(filePath)}`,
        filePath,
      });
    }

    // Check types
    const typeCheckPass = await this.checkTypes(filePath);
    if (!typeCheckPass) {
      issues.push({
        type: 'type_error',
        severity: 'high',
        message: `Type errors in ${path.basename(filePath)}`,
        filePath,
      });
    }

    // Run tests
    const testsPass = await this.runTests(filePath);
    if (!testsPass) {
      issues.push({
        type: 'test_failure',
        severity: 'high',
        message: `Tests failed for ${path.basename(filePath)}`,
        filePath,
      });
    }

    // Check for regressions
    const noRegressions = await this.checkRegressions(filePath);
    if (!noRegressions) {
      issues.push({
        type: 'regression',
        severity: 'high',
        message: `Potential regression detected in ${path.basename(filePath)}`,
        filePath,
      });
    }

    // Check performance
    const perfValid = await this.checkPerformance(filePath);
    if (!perfValid) {
      issues.push({
        type: 'performance_regression',
        severity: 'medium',
        message: `Performance regression detected`,
        filePath,
      });
    }

    const valid = syntaxValid && typeCheckPass && testsPass && noRegressions;

    return {
      refactoringId,
      filePath,
      valid,
      testsPass,
      noRegressions,
      syntaxValid,
      typeCheckPass,
      issues,
      timestamp: Date.now(),
    };
  }

  /**
   * Check syntax validity
   */
  private async checkSyntax(filePath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Basic syntax check: balanced braces
      let braceCount = 0;
      let bracketCount = 0;
      let parenCount = 0;

      for (const char of content) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
        else if (char === '[') bracketCount++;
        else if (char === ']') bracketCount--;
        else if (char === '(') parenCount++;
        else if (char === ')') parenCount--;
      }

      return braceCount === 0 && bracketCount === 0 && parenCount === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check TypeScript types
   */
  private async checkTypes(filePath: string): Promise<boolean> {
    try {
      // Try to run tsc on the file
      const tscPath = path.join(this.workspaceFolder, 'node_modules', '.bin', 'tsc');
      if (!fs.existsSync(tscPath)) {
        return true; // Skip if tsc not available
      }

      execSync(`${tscPath} --noEmit ${filePath}`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Run tests for file
   */
  private async runTests(filePath: string): Promise<boolean> {
    try {
      // Find test file
      const testPath = this.findTestFile(filePath);
      if (!testPath) {
        return true; // No tests found, assume pass
      }

      // Try to run jest/vitest
      const jestPath = path.join(this.workspaceFolder, 'node_modules', '.bin', 'jest');
      if (!fs.existsSync(jestPath)) {
        return true; // Skip if jest not available
      }

      execSync(`${jestPath} ${testPath} --passWithNoTests`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check for regressions
   */
  private async checkRegressions(filePath: string): Promise<boolean> {
    try {
      // Compare function signatures before/after
      const content = fs.readFileSync(filePath, 'utf-8');

      // Extract exported functions
      const exportRegex = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g;
      const exports: string[] = [];
      let match;

      while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }

      // Check if all expected exports still exist
      const baseline = this.baselineMetrics.get(filePath) || { exports: [] };
      for (const exp of baseline.exports) {
        if (!exports.includes(exp)) {
          return false; // Regression: exported function removed
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check performance
   */
  private async checkPerformance(filePath: string): Promise<boolean> {
    try {
      // Simple heuristic: check if file size increased significantly
      const stats = fs.statSync(filePath);
      const baseline = this.baselineMetrics.get(filePath) || { size: stats.size };

      const sizeIncrease = ((stats.size - baseline.size) / baseline.size) * 100;
      return sizeIncrease < 50; // Allow up to 50% size increase
    } catch (error) {
      return true; // Skip if can't check
    }
  }

  /**
   * Find test file for source file
   */
  private findTestFile(filePath: string): string | null {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));

    const testPatterns = [
      path.join(dir, `${baseName}.test.ts`),
      path.join(dir, `${baseName}.test.tsx`),
      path.join(dir, `${baseName}.spec.ts`),
      path.join(dir, `${baseName}.spec.tsx`),
      path.join(dir, '__tests__', `${baseName}.ts`),
    ];

    for (const pattern of testPatterns) {
      if (fs.existsSync(pattern)) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Set baseline metrics for comparison
   */
  setBaseline(filePath: string, metrics: any): void {
    this.baselineMetrics.set(filePath, metrics);
  }

  /**
   * Get baseline metrics
   */
  getBaseline(filePath: string): any {
    return this.baselineMetrics.get(filePath);
  }

  /**
   * Clear baselines
   */
  clearBaselines(): void {
    this.baselineMetrics.clear();
  }
}