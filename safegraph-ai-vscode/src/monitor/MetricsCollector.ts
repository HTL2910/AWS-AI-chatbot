import * as vscode from 'vscode';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import * as os from 'os';

/**
 * MetricsCollector: Collect CPU, memory, latency, errors metrics
 * Supports: Prometheus, CloudWatch, Datadog, custom endpoints
 */
export class MetricsCollector {
  private outputChannel: vscode.OutputChannel;
  private client: AxiosInstance;
  private metricsEndpoint: string;
  private collectionInterval: number;
  private isCollecting: boolean;
  private metrics: MetricData[];

  constructor(
    outputChannel: vscode.OutputChannel,
    metricsEndpoint: string,
    collectionInterval: number = 60000
  ) {
    this.outputChannel = outputChannel;
    this.metricsEndpoint = metricsEndpoint;
    this.collectionInterval = collectionInterval;
    this.isCollecting = false;
    this.metrics = [];
    this.client = axios.create({
      baseURL: metricsEndpoint,
      timeout: 10000,
      validateStatus: () => true,
    });
  }

  /**
   * Start collecting metrics
   */
  async startCollection(): Promise<void> {
    this.outputChannel.appendLine(`\n📊 [MetricsCollector] Starting metrics collection...`);
    this.outputChannel.appendLine(`   Endpoint: ${this.metricsEndpoint}`);
    this.outputChannel.appendLine(`   Interval: ${this.collectionInterval}ms`);

    this.isCollecting = true;
    this.metrics = [];

    // Start collection loop
    this.collectionLoop();
  }

  /**
   * Stop collecting metrics
   */
  stopCollection(): void {
    this.outputChannel.appendLine(`⏹️  Stopping metrics collection...`);
    this.isCollecting = false;
  }

  /**
   * Collection loop
   */
  private async collectionLoop(): Promise<void> {
    while (this.isCollecting) {
      try {
        const data = await this.collectMetrics();
        this.metrics.push(data);

        // Keep only last 1000 metrics
        if (this.metrics.length > 1000) {
          this.metrics.shift();
        }

        this.logMetrics(data);
      } catch (error) {
        this.outputChannel.appendLine(`⚠️  Error collecting metrics: ${error}`);
      }

      await this.delay(this.collectionInterval);
    }
  }

  /**
   * Collect all metrics
   */
  private async collectMetrics(): Promise<MetricData> {
    const timestamp = new Date();

    const [cpu, memory, latency, errorRate, requestCount] = await Promise.all([
      this.collectCPUMetrics(),
      this.collectMemoryMetrics(),
      this.collectLatencyMetrics(),
      this.collectErrorRateMetrics(),
      this.collectRequestCountMetrics(),
    ]);

    return {
      timestamp,
      cpu,
      memory,
      latency,
      errorRate,
      requestCount,
    };
  }

  /**
   * Collect CPU metrics
   */
  private async collectCPUMetrics(): Promise<CPUMetrics> {
    try {
      // Get system CPU usage
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;

      cpus.forEach(cpu => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type as keyof typeof cpu.times];
        }
        totalIdle += cpu.times.idle;
      });

      const idle = totalIdle / cpus.length;
      const total = totalTick / cpus.length;
      const usage = 100 - ~~(100 * idle / total);

      // Try to get from metrics endpoint
      try {
        const response = await this.client.get('/metrics/cpu');
        if (response.status === 200 && response.data?.value) {
          return {
            usage: response.data.value,
            cores: cpus.length,
            timestamp: new Date(),
          };
        }
      } catch {
        // Fall back to system metrics
      }

      return {
        usage,
        cores: cpus.length,
        timestamp: new Date(),
      };
    } catch (error) {
      this.outputChannel.appendLine(`⚠️  Error collecting CPU metrics: ${error}`);
      return { usage: 0, cores: 0, timestamp: new Date() };
    }
  }

  /**
   * Collect memory metrics
   */
  private async collectMemoryMetrics(): Promise<MemoryMetrics> {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const usage = (usedMem / totalMem) * 100;

      // Try to get from metrics endpoint
      try {
        const response = await this.client.get('/metrics/memory');
        if (response.status === 200 && response.data?.value) {
          return {
            usage: response.data.value,
            total: totalMem,
            used: usedMem,
            free: freeMem,
            timestamp: new Date(),
          };
        }
      } catch {
        // Fall back to system metrics
      }

      return {
        usage,
        total: totalMem,
        used: usedMem,
        free: freeMem,
        timestamp: new Date(),
      };
    } catch (error) {
      this.outputChannel.appendLine(`⚠️  Error collecting memory metrics: ${error}`);
      return { usage: 0, total: 0, used: 0, free: 0, timestamp: new Date() };
    }
  }

  /**
   * Collect latency metrics
   */
  private async collectLatencyMetrics(): Promise<LatencyMetrics> {
    try {
      const response = await this.client.get('/metrics/latency');
      if (response.status === 200 && response.data) {
        return {
          p50: response.data.p50 || 0,
          p95: response.data.p95 || 0,
          p99: response.data.p99 || 0,
          max: response.data.max || 0,
          timestamp: new Date(),
        };
      }
    } catch (error) {
      this.outputChannel.appendLine(`⚠️  Error collecting latency metrics: ${error}`);
    }

    return { p50: 0, p95: 0, p99: 0, max: 0, timestamp: new Date() };
  }

  /**
   * Collect error rate metrics
   */
  private async collectErrorRateMetrics(): Promise<ErrorRateMetrics> {
    try {
      const response = await this.client.get('/metrics/error-rate');
      if (response.status === 200 && response.data) {
        return {
          rate: response.data.rate || 0,
          count: response.data.count || 0,
          timestamp: new Date(),
        };
      }
    } catch (error) {
      this.outputChannel.appendLine(`⚠️  Error collecting error rate metrics: ${error}`);
    }

    return { rate: 0, count: 0, timestamp: new Date() };
  }

  /**
   * Collect request count metrics
   */
  private async collectRequestCountMetrics(): Promise<RequestCountMetrics> {
    try {
      const response = await this.client.get('/metrics/requests');
      if (response.status === 200 && response.data) {
        return {
          total: response.data.total || 0,
          perSecond: response.data.perSecond || 0,
          timestamp: new Date(),
        };
      }
    } catch (error) {
      this.outputChannel.appendLine(`⚠️  Error collecting request count metrics: ${error}`);
    }

    return { total: 0, perSecond: 0, timestamp: new Date() };
  }

  /**
   * Get collected metrics
   */
  getMetrics(): MetricData[] {
    return this.metrics;
  }

  /**
   * Get latest metric
   */
  getLatestMetric(): MetricData | undefined {
    return this.metrics[this.metrics.length - 1];
  }

  /**
   * Get metrics summary
   */
  getSummary(): MetricsSummary {
    if (this.metrics.length === 0) {
      return {
        count: 0,
        avgCPU: 0,
        avgMemory: 0,
        avgLatency: 0,
        avgErrorRate: 0,
      };
    }

    const avgCPU = this.metrics.reduce((sum, m) => sum + m.cpu.usage, 0) / this.metrics.length;
    const avgMemory = this.metrics.reduce((sum, m) => sum + m.memory.usage, 0) / this.metrics.length;
    const avgLatency = this.metrics.reduce((sum, m) => sum + m.latency.p99, 0) / this.metrics.length;
    const avgErrorRate = this.metrics.reduce((sum, m) => sum + m.errorRate.rate, 0) / this.metrics.length;

    return {
      count: this.metrics.length,
      avgCPU,
      avgMemory,
      avgLatency,
      avgErrorRate,
    };
  }

  /**
   * Log metrics to output channel
   */
  private logMetrics(data: MetricData): void {
    const time = data.timestamp.toLocaleTimeString();
    this.outputChannel.appendLine(
      `   [${time}] CPU: ${data.cpu.usage.toFixed(1)}% | ` +
      `Memory: ${data.memory.usage.toFixed(1)}% | ` +
      `Latency P99: ${data.latency.p99}ms | ` +
      `Error Rate: ${data.errorRate.rate.toFixed(2)}%`
    );
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface CPUMetrics {
  usage: number;
  cores: number;
  timestamp: Date;
}

export interface MemoryMetrics {
  usage: number;
  total: number;
  used: number;
  free: number;
  timestamp: Date;
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  timestamp: Date;
}

export interface ErrorRateMetrics {
  rate: number;
  count: number;
  timestamp: Date;
}

export interface RequestCountMetrics {
  total: number;
  perSecond: number;
  timestamp: Date;
}

export interface MetricData {
  timestamp: Date;
  cpu: CPUMetrics;
  memory: MemoryMetrics;
  latency: LatencyMetrics;
  errorRate: ErrorRateMetrics;
  requestCount: RequestCountMetrics;
}

export interface MetricsSummary {
  count: number;
  avgCPU: number;
  avgMemory: number;
  avgLatency: number;
  avgErrorRate: number;
}
