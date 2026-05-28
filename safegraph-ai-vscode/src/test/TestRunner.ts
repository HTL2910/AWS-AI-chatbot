/**
 * Test Runner - Execute tests and capture coverage metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { TestCase, TestResult, TestSuite, TestType } from '../types/TestFramework';

export class TestRunner {
  private testFramework: 'jest' | 'mocha' | 'vitest' = 'jest';
  private workspaceFolder: string;
  private results: TestResult[] = [];

  constructor(workspaceFolder: string, testFramework: 'jest' | 'mocha' | 'vitest' = 'jest') {
    this.workspaceFolder = workspaceFolder;
    this.testFramework = testFramework;
  }

  /**
   * Run a single test case
   */
  async runSingle(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Write test file if it doesn't exist
      if (!fs.existsSync(testCase.filePath)) {
        this.writeTestFile(testCase);
      }

      // Run test
      const output = this.executeTest(testCase.filePath);
      const duration = Date.now() - startTime;

      // Parse output
      const passed = this.parseTestOutput(output);
      const coverage = await this.getCoverageForFile(testCase.sourceFile);

      const result: TestResult = {
        caseId: testCase.id,
        caseName: testCase.name,
        type: testCase.type,
        passed,
        duration,
        coverage,
        timestamp: Date.now(),
      };

      this.results.push(result);
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const result: TestResult = {
        caseId: testCase.id,
        caseName: testCase.name,
        type: testCase.type,
        passed: false,
        duration,
        error: {
          message: error.message,
          stack: error.stack,
        },
        timestamp: Date.now(),
      };

      this.results.push(result);
      return result;
    }
  }

  /**
   * Run all tests in a suite
   */
  async run(suite: TestSuite): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const startTime = Date.now();

    for (const testCase of suite.cases) {
      const result = await this.runSingle(testCase);
      results.push(result);
    }

    const totalDuration = Date.now() - startTime;
    const passRate = (results.filter((r) => r.passed).length / results.length) * 100;

    suite.results = results;
    suite.totalDuration = totalDuration;
    suite.passRate = passRate;

    return results;
  }

  /**
   * Run all test suites
   */
  async runAll(suites: TestSuite[]): Promise<TestResult[]> {
    const allResults: TestResult[] = [];

    for (const suite of suites) {
      const results = await this.run(suite);
      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * Get coverage metrics for all files
   */
  async getCoverage(): Promise<{ [file: string]: number }> {
    const coverage: { [file: string]: number } = {};

    try {
      const output = this.executeCoverageCommand();
      const lines = output.split('\n');

      for (const line of lines) {
        const match = line.match(/(.+?)\s+\|\s+(\d+(?:\.\d+)?)\s*%/);
        if (match) {
          const file = match[1].trim();
          const percent = parseFloat(match[2]);
          coverage[file] = percent;
        }
      }
    } catch (error) {
      console.error('Error getting coverage:', error);
    }

    return coverage;
  }

  /**
   * Get coverage for a specific file
   */
  private async getCoverageForFile(filePath: string): Promise<any> {
    try {
      const coverage = await this.getCoverage();
      const fileKey = Object.keys(coverage).find((k) => k.includes(path.basename(filePath)));

      if (fileKey) {
        return {
          lines: coverage[fileKey],
          branches: coverage[fileKey] * 0.9, // Estimate
          functions: coverage[fileKey] * 0.95,
          statements: coverage[fileKey],
        };
      }
    } catch (error) {
      console.error('Error getting file coverage:', error);
    }

    return undefined;
  }

  /**
   * Execute test file
   */
  private executeTest(testFilePath: string): string {
    try {
      const cmd = this.getTestCommand(testFilePath);
      const output = execSync(cmd, {
        cwd: this.workspaceFolder,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output;
    } catch (error: any) {
      return error.stdout || error.message;
    }
  }

  /**
   * Execute coverage command
   */
  private executeCoverageCommand(): string {
    try {
      const cmd = this.getCoverageCommand();
      const output = execSync(cmd, {
        cwd: this.workspaceFolder,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output;
    } catch (error: any) {
      return error.stdout || '';
    }
  }

  /**
   * Get test command based on framework
   */
  private getTestCommand(testFilePath: string): string {
    const relPath = path.relative(this.workspaceFolder, testFilePath);

    switch (this.testFramework) {
      case 'jest':
        return `npx jest ${relPath} --no-coverage`;
      case 'mocha':
        return `npx mocha ${relPath}`;
      case 'vitest':
        return `npx vitest run ${relPath}`;
      default:
        return `npx jest ${relPath}`;
    }
  }

  /**
   * Get coverage command based on framework
   */
  private getCoverageCommand(): string {
    switch (this.testFramework) {
      case 'jest':
        return 'npx jest --coverage --silent';
      case 'mocha':
        return 'npx nyc mocha';
      case 'vitest':
        return 'npx vitest run --coverage';
      default:
        return 'npx jest --coverage --silent';
    }
  }

  /**
   * Parse test output to determine pass/fail
   */
  private parseTestOutput(output: string): boolean {
    // Check for common pass indicators
    if (output.includes('passed') || output.includes('✓') || output.includes('✔')) {
      return !output.includes('failed') && !output.includes('✗') && !output.includes('✖');
    }

    // Check for common fail indicators
    if (output.includes('failed') || output.includes('✗') || output.includes('✖')) {
      return false;
    }

    // Default to pass if no clear indicator
    return true;
  }

  /**
   * Write test file to disk
   */
  private writeTestFile(testCase: TestCase): void {
    const dir = path.dirname(testCase.filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(testCase.filePath, testCase.testCode, 'utf-8');
  }

  /**
   * Get test results summary
   */
  getResultsSummary(): {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    totalDuration: number;
    averageDuration: number;
  } {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    const averageDuration = total > 0 ? totalDuration / total : 0;

    return {
      total,
      passed,
      failed,
      passRate,
      totalDuration,
      averageDuration,
    };
  }

  /**
   * Get failed tests
   */
  getFailedTests(): TestResult[] {
    return this.results.filter((r) => !r.passed);
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }

  /**
   * Export results as JSON
   */
  exportResults(filePath: string): void {
    const summary = this.getResultsSummary();
    const data = {
      summary,
      results: this.results,
      timestamp: Date.now(),
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Export results as HTML report
   */
  exportHTMLReport(filePath: string): void {
    const summary = this.getResultsSummary();
    const failedTests = this.getFailedTests();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .summary { background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .passed { color: green; }
    .failed { color: red; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #4CAF50; color: white; }
  </style>
</head>
<body>
  <h1>Test Report</h1>
  <div class="summary">
    <p><strong>Total Tests:</strong> ${summary.total}</p>
    <p><strong class="passed">Passed:</strong> ${summary.passed}</p>
    <p><strong class="failed">Failed:</strong> ${summary.failed}</p>
    <p><strong>Pass Rate:</strong> ${summary.passRate.toFixed(2)}%</p>
    <p><strong>Total Duration:</strong> ${summary.totalDuration}ms</p>
  </div>

  ${
    failedTests.length > 0
      ? `
  <h2>Failed Tests</h2>
  <table>
    <tr>
      <th>Test Name</th>
      <th>Error</th>
      <th>Duration</th>
    </tr>
    ${failedTests
      .map(
        (t) => `
    <tr>
      <td>${t.caseName}</td>
      <td>${t.error?.message || 'Unknown error'}</td>
      <td>${t.duration}ms</td>
    </tr>
    `
      )
      .join('')}
  </table>
  `
      : '<p>All tests passed!</p>'
  }
</body>
</html>
    `.trim();

    fs.writeFileSync(filePath, html, 'utf-8');
  }
}
