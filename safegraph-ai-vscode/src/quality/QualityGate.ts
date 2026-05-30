/**
 * Quality Gate - Aggregate quality checks and enforce standards
 */
import * as path from 'path';

import { LintResult } from './LintEngine';
import { FileComplexity } from './ComplexityAnalyzer';
import { FileDocumentation } from './DocumentationChecker';
import { SecurityIssue, QualityMetrics } from '../types/TestFramework';

export interface QualityCheckResult {
  name: string;
  passed: boolean;
  score: number; // 0-100
  threshold: number;
  details: string;
  issues?: string[];
}

export interface QualityGateReport {
  timestamp: number;
  overallPassed: boolean;
  overallScore: number; // 0-100
  checks: QualityCheckResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  recommendations: string[];
  blockers: string[];
}

export class QualityGate {
  private thresholds = {
    coverage: 80,
    complexity: 10,
    documentation: 90,
    lintErrors: 0,
    securityCritical: 0,
    securityHigh: 0,
  };

  private checks: QualityCheckResult[] = [];

  constructor(thresholds?: Partial<typeof QualityGate.prototype.thresholds>) {
    if (thresholds) {
      this.thresholds = { ...this.thresholds, ...thresholds };
    }
  }

  /**
   * Run all quality checks
   */
  async runAllChecks(
    lintResults: LintResult[],
    complexityResults: FileComplexity[],
    docResults: FileDocumentation[],
    securityIssues: SecurityIssue[],
    testMetrics: QualityMetrics
  ): Promise<QualityGateReport> {
    this.checks = [];

    // Run individual checks
    this.checkTestCoverage(testMetrics);
    this.checkLintResults(lintResults);
    this.checkComplexity(complexityResults);
    this.checkDocumentation(docResults);
    this.checkSecurity(securityIssues);

    // Generate report
    return this.generateReport();
  }

  /**
   * Check test coverage
   */
  private checkTestCoverage(metrics: QualityMetrics): void {
    const coverage = metrics.testCoverage || 0;
    const passed = coverage >= this.thresholds.coverage;

    const issues: string[] = [];
    if (!passed) {
      issues.push(`Coverage ${coverage}% is below threshold ${this.thresholds.coverage}%`);
    }

    this.checks.push({
      name: 'Test Coverage',
      passed,
      score: Math.min(coverage, 100),
      threshold: this.thresholds.coverage,
      details: `${coverage}% of code covered by tests (${metrics.testCount} tests, ${metrics.passRate}% pass rate)`,
      issues: issues.length > 0 ? issues : undefined,
    });
  }

  /**
   * Check lint results
   */
  private checkLintResults(results: LintResult[]): void {
    let totalErrors = 0;
    let totalWarnings = 0;
    const errorFiles: string[] = [];

    for (const result of results) {
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;

      if (result.errors.length > 0) {
        errorFiles.push(`${result.filePath}: ${result.errors.length} errors`);
      }
    }

    const passed = totalErrors <= this.thresholds.lintErrors;

    this.checks.push({
      name: 'Lint Errors',
      passed,
      score: passed ? 100 : Math.max(0, 100 - totalErrors * 10),
      threshold: this.thresholds.lintErrors,
      details: `${totalErrors} lint errors, ${totalWarnings} warnings across ${results.length} files`,
      issues: errorFiles.length > 0 ? errorFiles.slice(0, 5) : undefined,
    });
  }

  /**
   * Check code complexity
   */
  private checkComplexity(results: FileComplexity[]): void {
    let highComplexityCount = 0;
    const issues: string[] = [];

    for (const file of results) {
      for (const func of file.functions) {
        if (func.cyclomaticComplexity > this.thresholds.complexity) {
          highComplexityCount++;
          if (issues.length < 5) {
            issues.push(`${func.functionName}: complexity ${func.cyclomaticComplexity}`);
          }
        }
      }
    }

    const passed = highComplexityCount === 0;
    const score = passed ? 100 : Math.max(0, 100 - highComplexityCount * 5);

    this.checks.push({
      name: 'Code Complexity',
      passed,
      score,
      threshold: this.thresholds.complexity,
      details: `${highComplexityCount} functions exceed complexity threshold of ${this.thresholds.complexity}`,
      issues: issues.length > 0 ? issues : undefined,
    });
  }

  /**
   * Check documentation
   */
  private checkDocumentation(results: FileDocumentation[]): void {
    let totalPublic = 0;
    let totalDocumented = 0;
    const undocumentedFiles: string[] = [];

    for (const file of results) {
      totalPublic += file.totalPublicItems;
      totalDocumented += file.documentedItems;

      if (file.completeness < this.thresholds.documentation) {
        undocumentedFiles.push(`${path.basename(file.filePath)}: ${file.completeness}%`);
      }
    }

    const completeness = totalPublic > 0 ? (totalDocumented / totalPublic) * 100 : 100;
    const passed = completeness >= this.thresholds.documentation;

    this.checks.push({
      name: 'Documentation',
      passed,
      score: Math.round(completeness),
      threshold: this.thresholds.documentation,
      details: `${Math.round(completeness)}% of public APIs documented (${totalDocumented}/${totalPublic})`,
      issues: undocumentedFiles.length > 0 ? undocumentedFiles.slice(0, 5) : undefined,
    });
  }

  /**
   * Check security issues
   */
  private checkSecurity(issues: SecurityIssue[]): void {
    let criticalCount = 0;
    let highCount = 0;
    const criticalIssues: string[] = [];

    for (const issue of issues) {
      if (issue.severity === 'critical') {
        criticalCount++;
        if (criticalIssues.length < 5) {
          criticalIssues.push(`${issue.title} (${issue.cveId || 'N/A'})`);
        }
      } else if (issue.severity === 'high') {
        highCount++;
      }
    }

    const passed = criticalCount <= this.thresholds.securityCritical && highCount <= this.thresholds.securityHigh;
    const score = passed ? 100 : Math.max(0, 100 - criticalCount * 20 - highCount * 5);

    this.checks.push({
      name: 'Security',
      passed,
      score,
      threshold: 0,
      details: `${criticalCount} critical, ${highCount} high severity issues found`,
      issues: criticalIssues.length > 0 ? criticalIssues : undefined,
    });
  }

  /**
   * Generate quality gate report
   */
  private generateReport(): QualityGateReport {
    const passed = this.checks.filter((c) => c.passed).length;
    const failed = this.checks.filter((c) => !c.passed).length;
    const total = this.checks.length;

    const overallScore = this.checks.length > 0 ? Math.round(this.checks.reduce((sum, c) => sum + c.score, 0) / this.checks.length) : 0;
    const overallPassed = failed === 0;

    const recommendations: string[] = [];
    const blockers: string[] = [];

    for (const check of this.checks) {
      if (!check.passed) {
        if (check.name === 'Security' || check.name === 'Lint Errors') {
          blockers.push(`Fix ${check.name}: ${check.details}`);
        } else {
          recommendations.push(`Improve ${check.name}: ${check.details}`);
        }
      }
    }

    return {
      timestamp: Date.now(),
      overallPassed,
      overallScore,
      checks: this.checks,
      summary: {
        passed,
        failed,
        total,
      },
      recommendations,
      blockers,
    };
  }

  /**
   * Set thresholds
   */
  setThresholds(thresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Get thresholds
   */
  getThresholds() {
    return { ...this.thresholds };
  }

  /**
   * Get checks
   */
  getChecks(): QualityCheckResult[] {
    return [...this.checks];
  }
}
