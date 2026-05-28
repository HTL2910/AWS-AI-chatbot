/**
 * Test Reporter - Generate test reports, badges, and metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestResult, TestSuite } from '../types/TestFramework';

export interface ReportConfig {
  title?: string;
  outputDir?: string;
  includeTimestamp?: boolean;
  includeCoverage?: boolean;
  includePerformance?: boolean;
}

export class TestReporter {
  private suites: TestSuite[] = [];
  private config: ReportConfig;

  constructor(config: ReportConfig = {}) {
    this.config = {
      title: 'Test Report',
      outputDir: './reports',
      includeTimestamp: true,
      includeCoverage: true,
      includePerformance: true,
      ...config,
    };
  }

  /**
   * Add test suite to report
   */
  addSuite(suite: TestSuite): void {
    this.suites.push(suite);
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(): string {
    const summary = this.calculateSummary();
    const timestamp = new Date().toISOString();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.config.title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }

    .timestamp {
      font-size: 0.9em;
      opacity: 0.9;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      text-align: center;
    }

    .summary-card h3 {
      color: #666;
      font-size: 0.9em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .summary-card .value {
      font-size: 2.5em;
      font-weight: bold;
      margin-bottom: 5px;
    }

    .summary-card.passed .value {
      color: #4caf50;
    }

    .summary-card.failed .value {
      color: #f44336;
    }

    .summary-card.total .value {
      color: #2196f3;
    }

    .summary-card.rate .value {
      color: #ff9800;
    }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 10px;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4caf50, #45a049);
      transition: width 0.3s ease;
    }

    .section {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .section h2 {
      color: #333;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }

    th {
      background: #f5f5f5;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #666;
      border-bottom: 2px solid #ddd;
    }

    td {
      padding: 12px;
      border-bottom: 1px solid #eee;
    }

    tr:hover {
      background: #f9f9f9;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
    }

    .status-badge.pass {
      background: #c8e6c9;
      color: #2e7d32;
    }

    .status-badge.fail {
      background: #ffcdd2;
      color: #c62828;
    }

    .duration {
      color: #999;
      font-size: 0.9em;
    }

    .error-message {
      background: #ffebee;
      border-left: 4px solid #f44336;
      padding: 12px;
      margin-top: 10px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
      color: #c62828;
      overflow-x: auto;
    }

    .coverage-bar {
      display: inline-block;
      width: 100px;
      height: 20px;
      background: #e0e0e0;
      border-radius: 3px;
      overflow: hidden;
      vertical-align: middle;
    }

    .coverage-fill {
      height: 100%;
      background: linear-gradient(90deg, #4caf50, #45a049);
    }

    .footer {
      text-align: center;
      color: #999;
      font-size: 0.9em;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }

    @media (max-width: 768px) {
      h1 {
        font-size: 1.8em;
      }

      .summary-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      table {
        font-size: 0.9em;
      }

      th, td {
        padding: 8px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${this.config.title}</h1>
      ${this.config.includeTimestamp ? `<div class="timestamp">Generated: ${timestamp}</div>` : ''}
    </header>

    <div class="summary-grid">
      <div class="summary-card total">
        <h3>Total Tests</h3>
        <div class="value">${summary.total}</div>
      </div>
      <div class="summary-card passed">
        <h3>Passed</h3>
        <div class="value">${summary.passed}</div>
      </div>
      <div class="summary-card failed">
        <h3>Failed</h3>
        <div class="value">${summary.failed}</div>
      </div>
      <div class="summary-card rate">
        <h3>Pass Rate</h3>
        <div class="value">${summary.passRate.toFixed(1)}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${summary.passRate}%"></div>
        </div>
      </div>
    </div>

    ${this.generateSuitesHTML(summary)}

    ${this.config.includeCoverage ? this.generateCoverageHTML() : ''}

    <div class="footer">
      <p>SafeGraph AI Test Report • Generated automatically</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return html;
  }

  /**
   * Generate suites HTML
   */
  private generateSuitesHTML(summary: any): string {
    const suitesHTML = this.suites
      .map((suite) => {
        const results = suite.results || [];
        const passed = results.filter((r) => r.passed).length;
        const failed = results.length - passed;
        const passRate = results.length > 0 ? (passed / results.length) * 100 : 0;

        const resultsHTML = results
          .map(
            (result) => `
        <tr>
          <td>${result.caseName}</td>
          <td><span class="status-badge ${result.passed ? 'pass' : 'fail'}">${result.passed ? '✓ PASS' : '✗ FAIL'}</span></td>
          <td><span class="duration">${result.duration}ms</span></td>
          ${
            result.coverage
              ? `<td><div class="coverage-bar"><div class="coverage-fill" style="width: ${result.coverage.lines}%"></div></div> ${result.coverage.lines.toFixed(1)}%</td>`
              : '<td>-</td>'
          }
          ${result.error ? `<td>${result.error.message}</td>` : '<td>-</td>'}
        </tr>
        ${result.error ? `<tr><td colspan="5"><div class="error-message">${result.error.stack}</div></td></tr>` : ''}
        `
          )
          .join('');

        return `
    <div class="section">
      <h2>${suite.name}</h2>
      <p>${suite.cases.length} test cases • ${passed} passed • ${failed} failed • ${passRate.toFixed(1)}% pass rate</p>
      <table>
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Coverage</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${resultsHTML}
        </tbody>
      </table>
    </div>
        `;
      })
      .join('');

    return suitesHTML;
  }

  /**
   * Generate coverage HTML
   */
  private generateCoverageHTML(): string {
    return `
    <div class="section">
      <h2>Coverage Summary</h2>
      <p>Code coverage metrics across all test suites</p>
      <!-- Coverage details would go here -->
    </div>
    `;
  }

  /**
   * Generate JSON report
   */
  generateJSONReport(): string {
    const summary = this.calculateSummary();
    const report = {
      title: this.config.title,
      timestamp: new Date().toISOString(),
      summary,
      suites: this.suites,
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate Markdown report
   */
  generateMarkdownReport(): string {
    const summary = this.calculateSummary();
    let md = `# ${this.config.title}\n\n`;

    if (this.config.includeTimestamp) {
      md += `**Generated:** ${new Date().toISOString()}\n\n`;
    }

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Tests | ${summary.total} |\n`;
    md += `| Passed | ${summary.passed} |\n`;
    md += `| Failed | ${summary.failed} |\n`;
    md += `| Pass Rate | ${summary.passRate.toFixed(2)}% |\n\n`;

    for (const suite of this.suites) {
      md += `## ${suite.name}\n\n`;
      md += `| Test | Status | Duration |\n`;
      md += `|------|--------|----------|\n`;

      for (const result of suite.results || []) {
        const status = result.passed ? '✓ PASS' : '✗ FAIL';
        md += `| ${result.caseName} | ${status} | ${result.duration}ms |\n`;
      }

      md += '\n';
    }

    return md;
  }

  /**
   * Generate badge (SVG)
   */
  generateBadge(): string {
    const summary = this.calculateSummary();
    const color = summary.passRate >= 80 ? '4caf50' : summary.passRate >= 50 ? 'ff9800' : 'f44336';
    const label = `${summary.passRate.toFixed(0)}%`;

    return `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="a">
    <rect width="120" height="20" rx="3"/>
  </clipPath>
  <g clip-path="url(#a)">
    <path fill="#555" d="M0 0h84v20H0z"/>
    <path fill="#${color}" d="M84 0h36v20H84z"/>
    <path fill="url(#b)" d="M0 0h120v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="42" y="15" fill="#010101" fill-opacity=".3">tests</text>
    <text x="42" y="14">tests</text>
    <text x="101" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="101" y="14">${label}</text>
  </g>
</svg>
    `.trim();
  }

  /**
   * Save report to file
   */
  saveReport(format: 'html' | 'json' | 'markdown' = 'html'): string {
    if (!fs.existsSync(this.config.outputDir!)) {
      fs.mkdirSync(this.config.outputDir!, { recursive: true });
    }

    let content: string;
    let filename: string;

    switch (format) {
      case 'json':
        content = this.generateJSONReport();
        filename = 'report.json';
        break;
      case 'markdown':
        content = this.generateMarkdownReport();
        filename = 'report.md';
        break;
      case 'html':
      default:
        content = this.generateHTMLReport();
        filename = 'report.html';
        break;
    }

    const filePath = path.join(this.config.outputDir!, filename);
    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(): {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  } {
    let total = 0;
    let passed = 0;

    for (const suite of this.suites) {
      for (const result of suite.results || []) {
        total++;
        if (result.passed) {
          passed++;
        }
      }
    }

    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    return { total, passed, failed, passRate };
  }
}
