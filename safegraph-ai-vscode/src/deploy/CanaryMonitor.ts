import * as vscode from 'vscode';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

/**
 * CanaryMonitor: Monitor canary deployment metrics and auto-rollback
 * Tracks: error rate, latency, CPU, memory, custom metrics
 */
export class CanaryMonitor {
  private outputChannel: vscode.OutputChannel;
  private client: AxiosInstance;
  private metricsURL: string;
  private thresholds: MetricThresholds;
  private monitoringActive: boolean;

  constructor(
    outputChannel: vscode.OutputChannel,
    metricsURL: string,
    thresholds?: MetricThresholds
  ) {
    this.outputChannel = outputChannel;
    this.metricsURL = metricsURL;
    this.thresholds = thresholds || this.loadDefaultThresholds();
    this.monitoringActive = false;
    this.client = axios.create({
      baseURL: metricsURL,
      timeout: 10000,
      validateStatus: () => true,
    });
  }

  /**
   * Start monitoring canary deployment
   */
  async startMonitoring(duration: number): Promise<MonitoringResult> {
    this.outputChannel.appendLine(`\n📊 [CanaryMonitor] Starting canary monitoring...`);
    this.outputChannel.appendLine(`   Duration: ${duration}ms`);
    this.outputChannel.appendLine(`   Metrics URL: ${this.metricsURL}`);

    this.monitoringActive = true;
    const startTime = Date.now();
    const metrics: MetricSnapshot[] = [];
    const issues: HealthIssue[] = [];

    try {
      while (Date.now() - startTime < duration && this.monitoringActive) {
        const snapshot = await this.collectMetrics();
        metrics.push(snapshot);

        // Check for issues
        const newIssues = this.checkMetrics(snapshot);
        issues.push(...newIssues);

        // Log current metrics
        this.logMetrics(snapshot);

        // Check if we should rollback
        if (this.shouldRollback(issues)) {
          this.outputChannel.appendLine(`\n⚠️  Critical issues detected, triggering rollback...`);
          return {
            healthy: false,
            duration: Date.now() - startTime,
            metrics,
            issues,
            shouldRollback: true,
          };
        }

        // Wait before next collection
        await this.delay(5000); // Collect every 5 seconds
      }

      const healthy = issues.length === 0;
      this.outputChannel.appendLine(`\n✅ Monitoring completed. Status: ${healthy ? 'Healthy' : 'Issues detected'}`);

      return {
        healthy,
        duration: Date.now() - startTime,
        metrics,
        issues,
        shouldRollback: false,
      };
    } catch (error) {
      this.outputChannel.appendLine(`❌ Monitoring error: ${error}`);
      throw error;
    } finally {
      this.monitoringActive = false;
    }
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.outputChannel.appendLine(`⏹️  Stopping canary monitoring...`);
    this.monitoringActive = false;
  }

  /**
   * Collect current metrics
   */
  private async collectMetrics(): Promise<MetricSnapshot> {
    const timestamp = new Date();

    try {
      // Collect different metric types
      const [errorRate, latency, resources, customMetrics] = await Promise.all([
        this.getErrorRate(),
        this.getLatency(),
        this.getResourceUsage(),
        this.getCustomMetrics(),
      ]);

      return {
        timestamp,
        errorRate,
        latency,
        resources,
        customMetrics,
      };
    } catch (error) {
      this.outputChannel.appendLine(`⚠️  Error collecting metrics: ${error}`);
      return {
        timestamp,
        errorRate: 0,
        latency: 0,
        resources: { cpu: 0, memory: 0 },
        customMetrics: {},
      };
    }
  }

  /**
   * Get error rate from metrics
   */
  private async getErrorRate(): Promise<number> {
    try {
      const response = await this.client.get('/metrics/error-rate');
      return response.data?.value || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get latency from metrics
   */
  private async getLatency(): Promise<number> {
    try {
      const response = await this.client.get('/metrics/latency-p99');
      return response.data?.value || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get resource usage
   */
  private async getResourceUsage(): Promise<ResourceMetrics> {
    try {
      const response = await this.client.get('/metrics/resources');
      return response.data || { cpu: 0, memory: 0 };
    } catch {
      return { cpu: 0, memory: 0 };
    }
  }

  /**
   * Get custom metrics
   */
  private async getCustomMetrics(): Promise<Record<string, number>> {
    try {
      const response = await this.client.get('/metrics/custom');
      return response.data || {};
    } catch {
      return {};
    }
  }

  /**
   * Check metrics against thresholds
   */
  private checkMetrics(snapshot: MetricSnapshot): HealthIssue[] {
    const issues: HealthIssue[] = [];

    // Check error rate
    if (snapshot.errorRate > this.thresholds.errorRateMax) {
      issues.push({
        severity: 'critical',
        metric: 'error-rate',
        value: snapshot.errorRate,
        threshold: this.thresholds.errorRateMax,
        message: `Error rate ${snapshot.errorRate.toFixed(2)}% exceeds threshold ${this.thresholds.errorRateMax}%`,
      });
    }

    // Check latency
    if (snapshot.latency > this.thresholds.latencyMaxMs) {
      issues.push({
        severity: 'warning',
        metric: 'latency',
        value: snapshot.latency,
        threshold: this.thresholds.latencyMaxMs,
        message: `Latency ${snapshot.latency}ms exceeds threshold ${this.thresholds.latencyMaxMs}ms`,
      });
    }

    // Check CPU
    if (snapshot.resources.cpu > this.thresholds.cpuMaxPercent) {
      issues.push({
        severity: 'warning',
        metric: 'cpu',
        value: snapshot.resources.cpu,
        threshold: this.thresholds.cpuMaxPercent,
        message: `CPU usage ${snapshot.resources.cpu}% exceeds threshold ${this.thresholds.cpuMaxPercent}%`,
      });
    }

    // Check memory
    if (snapshot.resources.memory > this.thresholds.memoryMaxPercent) {
      issues.push({
        severity: 'warning',
        metric: 'memory',
        value: snapshot.resources.memory,
        threshold: this.thresholds.memoryMaxPercent,
        message: `Memory usage ${snapshot.resources.memory}% exceeds threshold ${this.thresholds.memoryMaxPercent}%`,
      });
    }

    return issues;
  }

  /**
   * Determine if rollback should be triggered
   */
  private shouldRollback(issues: HealthIssue[]): boolean {
    // Rollback if any critical issues
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      return true;
    }

    // Rollback if too many warnings
    const recentIssues = issues.slice(-10);
    const warningCount = recentIssues.filter(i => i.severity === 'warning').length;
    if (warningCount > 5) {
      return true;
    }

    return false;
  }

  /**
   * Log metrics to output channel
   */
  private logMetrics(snapshot: MetricSnapshot): void {
    const time = snapshot.timestamp.toLocaleTimeString();
    this.outputChannel.appendLine(
      `   [${time}] Error: ${snapshot.errorRate.toFixed(2)}% | ` +
      `Latency: ${snapshot.latency}ms | ` +
      `CPU: ${snapshot.resources.cpu}% | ` +
      `Memory: ${snapshot.resources.memory}%`
    );
  }

  /**
   * Load default thresholds
   */
  private loadDefaultThresholds(): MetricThresholds {
    return {
      errorRateMax: 5, // 5%
      latencyMaxMs: 2000, // 2 seconds
      cpuMaxPercent: 80,
      memoryMaxPercent: 85,
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface MetricThresholds {
  errorRateMax: number;
  latencyMaxMs: number;
  cpuMaxPercent: number;
  memoryMaxPercent: number;
}

export interface MetricSnapshot {
  timestamp: Date;
  errorRate: number;
  latency: number;
  resources: ResourceMetrics;
  customMetrics: Record<string, number>;
}

export interface ResourceMetrics {
  cpu: number;
  memory: number;
}

export interface HealthIssue {
  severity: 'critical' | 'warning';
  metric: string;
  value: number;
  threshold: number;
  message: string;
}

export interface MonitoringResult {
  healthy: boolean;
  duration: number;
  metrics: MetricSnapshot[];
  issues: HealthIssue[];
  shouldRollback: boolean;
}
