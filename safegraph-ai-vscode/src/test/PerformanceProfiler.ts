/**
 * Performance Profiler - Benchmark, memory profiling, and leak detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { PerformanceMetric } from '../types/TestFramework';

export class PerformanceProfiler {
  private metrics: PerformanceMetric[] = [];
  private baselines: Map<string, number> = new Map();
  private thresholds: Map<string, number> = new Map();
  private memorySnapshots: Array<{ timestamp: number; heapUsed: number }> = [];

  constructor() {
    this.initializeThresholds();
  }

  /**
   * Benchmark a function
   */
  async benchmark(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 100
  ): Promise<PerformanceMetric> {
    const times: number[] = [];

    // Warm up
    for (let i = 0; i < 5; i++) {
      await fn();
    }

    // Measure
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    // Calculate statistics
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const stdDev = this.calculateStdDev(times, avgTime);

    const baseline = this.baselines.get(name) || avgTime;
    const threshold = this.thresholds.get(name) || baseline * 1.2; // 20% slower = fail
    const passed = avgTime <= threshold;

    const metric: PerformanceMetric = {
      name,
      value: avgTime,
      unit: 'ms',
      baseline,
      threshold,
      passed,
    };

    this.metrics.push(metric);
    return metric;
  }

  /**
   * Profile memory usage
   */
  async profileMemory(
    name: string,
    fn: () => Promise<void> | void
  ): Promise<PerformanceMetric> {
    // Take initial snapshot
    if (global.gc) {
      global.gc();
    }
    const initialMemory = process.memoryUsage().heapUsed;

    // Run function
    await fn();

    // Take final snapshot
    if (global.gc) {
      global.gc();
    }
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryDelta = finalMemory - initialMemory;

    const baseline = this.baselines.get(`${name}_memory`) || memoryDelta;
    const threshold = this.thresholds.get(`${name}_memory`) || baseline * 1.5; // 50% more = fail
    const passed = memoryDelta <= threshold;

    const metric: PerformanceMetric = {
      name: `${name}_memory`,
      value: memoryDelta / 1024 / 1024, // Convert to MB
      unit: 'MB',
      baseline: baseline / 1024 / 1024,
      threshold: threshold / 1024 / 1024,
      passed,
    };

    this.metrics.push(metric);
    return metric;
  }

  /**
   * Detect memory leaks
   */
  async detectMemoryLeaks(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 10
  ): Promise<{ leaked: boolean; trend: number[] }> {
    const snapshots: number[] = [];

    for (let i = 0; i < iterations; i++) {
      if (global.gc) {
        global.gc();
      }

      const before = process.memoryUsage().heapUsed;
      await fn();
      const after = process.memoryUsage().heapUsed;

      snapshots.push(after - before);

      // Small delay between iterations
      await this.delay(100);
    }

    // Analyze trend
    const trend = this.calculateTrend(snapshots);
    const leaked = trend > 0.8; // If memory consistently increases, likely leak

    return { leaked, trend: snapshots };
  }

  /**
   * Measure throughput (operations per second)
   */
  async measureThroughput(
    name: string,
    fn: () => Promise<void> | void,
    duration: number = 1000 // 1 second
  ): Promise<PerformanceMetric> {
    let count = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < duration) {
      await fn();
      count++;
    }

    const opsPerSec = (count / duration) * 1000;

    const baseline = this.baselines.get(`${name}_throughput`) || opsPerSec;
    const threshold = this.thresholds.get(`${name}_throughput`) || baseline * 0.8; // 20% slower = fail
    const passed = opsPerSec >= threshold;

    const metric: PerformanceMetric = {
      name: `${name}_throughput`,
      value: opsPerSec,
      unit: 'ops/sec',
      baseline,
      threshold,
      passed,
    };

    this.metrics.push(metric);
    return metric;
  }

  /**
   * Measure latency percentiles
   */
  async measureLatencyPercentiles(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 1000
  ): Promise<{
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    times.sort((a, b) => a - b);

    return {
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
      p999: times[Math.floor(times.length * 0.999)],
    };
  }

  /**
   * Set baseline for a metric
   */
  setBaseline(name: string, value: number): void {
    this.baselines.set(name, value);
  }

  /**
   * Set threshold for a metric
   */
  setThreshold(name: string, value: number): void {
    this.thresholds.set(name, value);
  }

  /**
   * Get all metrics
   */
  getMetrics(): PerformanceMetric[] {
    return this.metrics;
  }

  /**
   * Get passed metrics
   */
  getPassedMetrics(): PerformanceMetric[] {
    return this.metrics.filter((m) => m.passed);
  }

  /**
   * Get failed metrics
   */
  getFailedMetrics(): PerformanceMetric[] {
    return this.metrics.filter((m) => !m.passed);
  }

  /**
   * Get metrics summary
   */
  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  } {
    const total = this.metrics.length;
    const passed = this.metrics.filter((m) => m.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    return { total, passed, failed, passRate };
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(filePath: string): void {
    const data = {
      summary: this.getSummary(),
      metrics: this.metrics,
      timestamp: Date.now(),
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Export metrics as HTML report
   */
  exportHTMLReport(filePath: string): void {
    const summary = this.getSummary();
    const failedMetrics = this.getFailedMetrics();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Performance Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .summary { background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .passed { color: green; }
    .failed { color: red; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #4CAF50; color: white; }
    .metric-row { background: #f9f9f9; }
    .metric-row.failed { background: #ffcccc; }
  </style>
</head>
<body>
  <h1>Performance Report</h1>
  <div class="summary">
    <p><strong>Total Metrics:</strong> ${summary.total}</p>
    <p><strong class="passed">Passed:</strong> ${summary.passed}</p>
    <p><strong class="failed">Failed:</strong> ${summary.failed}</p>
    <p><strong>Pass Rate:</strong> ${summary.passRate.toFixed(2)}%</p>
  </div>

  <h2>Metrics</h2>
  <table>
    <tr>
      <th>Metric Name</th>
      <th>Value</th>
      <th>Baseline</th>
      <th>Threshold</th>
      <th>Status</th>
    </tr>
    ${this.metrics
      .map(
        (m) => `
    <tr class="metric-row ${!m.passed ? 'failed' : ''}">
      <td>${m.name}</td>
      <td>${m.value.toFixed(2)} ${m.unit}</td>
      <td>${m.baseline?.toFixed(2) || 'N/A'} ${m.unit}</td>
      <td>${m.threshold?.toFixed(2) || 'N/A'} ${m.unit}</td>
      <td>${m.passed ? '✓ PASS' : '✗ FAIL'}</td>
    </tr>
    `
      )
      .join('')}
  </table>
</body>
</html>
    `.trim();

    fs.writeFileSync(filePath, html, 'utf-8');
  }

  /**
   * Clear metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean: number): number {
    const squareDiffs = values.map((v) => Math.pow(v - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  }

  /**
   * Calculate trend (linear regression slope)
   */
  private calculateTrend(values: number[]): number {
    const n = values.length;
    const sumX = (n * (n + 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, i) => sum + (i + 1) * y, 0);
    const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Initialize default thresholds
   */
  private initializeThresholds(): void {
    // Default thresholds (can be overridden)
    this.thresholds.set('default', 1000); // 1 second
  }
}
