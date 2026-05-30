import * as vscode from 'vscode';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

/**
 * HealthChecker: Check service health and dependencies
 * Monitors: service status, dependencies, resource usage, error rates
 */
export class HealthChecker {
  private outputChannel: vscode.OutputChannel;
  private client: AxiosInstance;
  private baseURL: string;
  private checkInterval: number;
  private maxRetries: number;

  constructor(
    outputChannel: vscode.OutputChannel,
    baseURL: string,
    checkInterval: number = 30000,
    maxRetries: number = 3
  ) {
    this.outputChannel = outputChannel;
    this.baseURL = baseURL;
    this.checkInterval = checkInterval;
    this.maxRetries = maxRetries;
    this.client = axios.create({
      baseURL,
      timeout: 10000,
      validateStatus: () => true,
    });
  }

  /**
   * Perform comprehensive health check
   */
  async checkHealth(): Promise<HealthCheckResult> {
    this.outputChannel.appendLine(`\n🏥 [HealthChecker] Performing health check...`);

    const checks: HealthCheckItem[] = [];
    const startTime = Date.now();

    try {
      // 1. Service status
      checks.push(await this.checkServiceStatus());

      // 2. Dependencies
      checks.push(await this.checkDependencies());

      // 3. Resource usage
      checks.push(await this.checkResourceUsage());

      // 4. Error rate
      checks.push(await this.checkErrorRate());

      // 5. Response time
      checks.push(await this.checkResponseTime());

      const duration = Date.now() - startTime;
      const healthy = checks.every(c => c.healthy);
      const warnings = checks.filter(c => c.warning).length;

      this.outputChannel.appendLine(`\n📊 Health Check Summary:`);
      this.outputChannel.appendLine(`   Status: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
      this.outputChannel.appendLine(`   Warnings: ${warnings}`);
      this.outputChannel.appendLine(`   Duration: ${duration}ms`);

      return {
        healthy,
        timestamp: new Date().toISOString(),
        duration,
        checks,
      };
    } catch (error) {
      this.outputChannel.appendLine(`❌ Health check failed: ${error}`);
      throw error;
    }
  }

  /**
   * Check service status
   */
  private async checkServiceStatus(): Promise<HealthCheckItem> {
    this.outputChannel.appendLine(`   🔍 Checking service status...`);

    let retries = 0;
    while (retries < this.maxRetries) {
      try {
        const response = await this.client.get('/health');
        const healthy = response.status === 200;

        if (healthy) {
          this.outputChannel.appendLine(`      ✅ Service is running`);
          return {
            name: 'Service Status',
            healthy: true,
            message: 'Service is running',
          };
        } else {
          this.outputChannel.appendLine(`      ⚠️  Service returned status ${response.status}`);
          return {
            name: 'Service Status',
            healthy: false,
            warning: true,
            message: `Service returned status ${response.status}`,
          };
        }
      } catch (error) {
        retries++;
        if (retries < this.maxRetries) {
          this.outputChannel.appendLine(`      ⏳ Retry ${retries}/${this.maxRetries}...`);
          await this.delay(1000);
        } else {
          this.outputChannel.appendLine(`      ❌ Service is not responding`);
          return {
            name: 'Service Status',
            healthy: false,
            message: `Service is not responding: ${error}`,
          };
        }
      }
    }

    return {
      name: 'Service Status',
      healthy: false,
      message: 'Service check failed',
    };
  }

  /**
   * Check dependencies (database, cache, external APIs)
   */
  private async checkDependencies(): Promise<HealthCheckItem> {
    this.outputChannel.appendLine(`   🔗 Checking dependencies...`);

    try {
      const response = await this.client.get('/health/dependencies');
      const data = response.data || {};

      const allHealthy = Object.values(data).every((dep: any) => dep.healthy === true);
      const unhealthyDeps = Object.entries(data)
        .filter(([, dep]: [string, any]) => dep.healthy !== true)
        .map(([name]) => name);

      if (allHealthy) {
        this.outputChannel.appendLine(`      ✅ All dependencies healthy`);
      } else {
        this.outputChannel.appendLine(`      ⚠️  Unhealthy dependencies: ${unhealthyDeps.join(', ')}`);
      }

      return {
        name: 'Dependencies',
        healthy: allHealthy,
        warning: !allHealthy,
        message: allHealthy ? 'All dependencies healthy' : `Unhealthy: ${unhealthyDeps.join(', ')}`,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Could not check dependencies: ${error}`);
      return {
        name: 'Dependencies',
        healthy: true,
        warning: true,
        message: `Could not verify dependencies: ${error}`,
      };
    }
  }

  /**
   * Check resource usage (CPU, memory, disk)
   */
  private async checkResourceUsage(): Promise<HealthCheckItem> {
    this.outputChannel.appendLine(`   💾 Checking resource usage...`);

    try {
      const response = await this.client.get('/health/resources');
      const resources = response.data || {};

      const cpuUsage = resources.cpu || 0;
      const memoryUsage = resources.memory || 0;
      const diskUsage = resources.disk || 0;

      const thresholds = { cpu: 80, memory: 85, disk: 90 };
      const healthy = cpuUsage < thresholds.cpu && memoryUsage < thresholds.memory && diskUsage < thresholds.disk;
      const warning = cpuUsage > 70 || memoryUsage > 75 || diskUsage > 80;

      this.outputChannel.appendLine(`      CPU: ${cpuUsage}% | Memory: ${memoryUsage}% | Disk: ${diskUsage}%`);

      return {
        name: 'Resource Usage',
        healthy,
        warning,
        message: `CPU: ${cpuUsage}% | Memory: ${memoryUsage}% | Disk: ${diskUsage}%`,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Could not check resources: ${error}`);
      return {
        name: 'Resource Usage',
        healthy: true,
        warning: true,
        message: `Could not verify resources: ${error}`,
      };
    }
  }

  /**
   * Check error rate
   */
  private async checkErrorRate(): Promise<HealthCheckItem> {
    this.outputChannel.appendLine(`   📈 Checking error rate...`);

    try {
      const response = await this.client.get('/health/metrics');
      const metrics = response.data || {};

      const errorRate = metrics.errorRate || 0;
      const threshold = 5; // 5% error rate threshold
      const healthy = errorRate < threshold;
      const warning = errorRate > 2;

      this.outputChannel.appendLine(`      Error rate: ${errorRate.toFixed(2)}%`);

      return {
        name: 'Error Rate',
        healthy,
        warning,
        message: `Error rate: ${errorRate.toFixed(2)}%`,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Could not check error rate: ${error}`);
      return {
        name: 'Error Rate',
        healthy: true,
        warning: true,
        message: `Could not verify error rate: ${error}`,
      };
    }
  }

  /**
   * Check response time
   */
  private async checkResponseTime(): Promise<HealthCheckItem> {
    this.outputChannel.appendLine(`   ⏱️  Checking response time...`);

    try {
      const startTime = Date.now();
      await this.client.get('/health');
      const responseTime = Date.now() - startTime;

      const threshold = 1000; // 1 second
      const healthy = responseTime < threshold;
      const warning = responseTime > 500;

      this.outputChannel.appendLine(`      Response time: ${responseTime}ms`);

      return {
        name: 'Response Time',
        healthy,
        warning,
        message: `Response time: ${responseTime}ms`,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Response time check failed: ${error}`);
      return {
        name: 'Response Time',
        healthy: false,
        message: `Response time check failed: ${error}`,
      };
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface HealthCheckItem {
  name: string;
  healthy: boolean;
  warning?: boolean;
  message: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  timestamp: string;
  duration: number;
  checks: HealthCheckItem[];
}
