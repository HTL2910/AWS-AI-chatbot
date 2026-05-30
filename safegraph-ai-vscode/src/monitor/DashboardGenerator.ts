import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DashboardGenerator: Generate Grafana/Datadog dashboards
 * Creates: JSON dashboard definitions, HTML dashboards
 */
export class DashboardGenerator {
  private outputChannel: vscode.OutputChannel;
  private dashboardConfig: DashboardConfig;

  constructor(outputChannel: vscode.OutputChannel, dashboardConfig?: DashboardConfig) {
    this.outputChannel = outputChannel;
    this.dashboardConfig = dashboardConfig || this.loadDefaultConfig();
  }

  /**
   * Generate Grafana dashboard
   */
  async generateGrafanaDashboard(outputPath: string): Promise<void> {
    this.outputChannel.appendLine(`\n📊 [DashboardGenerator] Generating Grafana dashboard...`);
    this.outputChannel.appendLine(`   Output: ${outputPath}`);

    try {
      const dashboard = this.buildGrafanaDashboard();
      const jsonPath = path.join(outputPath, 'grafana-dashboard.json');

      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(dashboard, null, 2));

      this.outputChannel.appendLine(`   ✅ Grafana dashboard generated: ${jsonPath}`);
    } catch (error) {
      this.outputChannel.appendLine(`   ❌ Error generating Grafana dashboard: ${error}`);
      throw error;
    }
  }

  /**
   * Generate Datadog dashboard
   */
  async generateDatadogDashboard(outputPath: string): Promise<void> {
    this.outputChannel.appendLine(`\n📊 [DashboardGenerator] Generating Datadog dashboard...`);
    this.outputChannel.appendLine(`   Output: ${outputPath}`);

    try {
      const dashboard = this.buildDatadogDashboard();
      const jsonPath = path.join(outputPath, 'datadog-dashboard.json');

      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(dashboard, null, 2));

      this.outputChannel.appendLine(`   ✅ Datadog dashboard generated: ${jsonPath}`);
    } catch (error) {
      this.outputChannel.appendLine(`   ❌ Error generating Datadog dashboard: ${error}`);
      throw error;
    }
  }

  /**
   * Generate HTML dashboard
   */
  async generateHTMLDashboard(outputPath: string, metrics: any[]): Promise<void> {
    this.outputChannel.appendLine(`\n📊 [DashboardGenerator] Generating HTML dashboard...`);
    this.outputChannel.appendLine(`   Output: ${outputPath}`);

    try {
      const html = this.buildHTMLDashboard(metrics);
      const htmlPath = path.join(outputPath, 'dashboard.html');

      fs.mkdirSync(outputPath, { recursive: true });
      fs.writeFileSync(htmlPath, html);

      this.outputChannel.appendLine(`   ✅ HTML dashboard generated: ${htmlPath}`);
    } catch (error) {
      this.outputChannel.appendLine(`   ❌ Error generating HTML dashboard: ${error}`);
      throw error;
    }
  }

  /**
   * Build Grafana dashboard JSON
   */
  private buildGrafanaDashboard(): any {
    return {
      dashboard: {
        title: 'SafeGraph AI - Production Monitoring',
        tags: ['safegraph', 'production', 'monitoring'],
        timezone: 'browser',
        panels: [
          {
            title: 'CPU Usage',
            targets: [
              {
                expr: 'rate(process_cpu_seconds_total[5m])',
                legendFormat: 'CPU %',
              },
            ],
            type: 'graph',
            gridPos: { h: 8, w: 12, x: 0, y: 0 },
          },
          {
            title: 'Memory Usage',
            targets: [
              {
                expr: 'process_resident_memory_bytes / 1024 / 1024',
                legendFormat: 'Memory MB',
              },
            ],
            type: 'graph',
            gridPos: { h: 8, w: 12, x: 12, y: 0 },
          },
          {
            title: 'Request Latency (P99)',
            targets: [
              {
                expr: 'histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))',
                legendFormat: 'Latency P99',
              },
            ],
            type: 'graph',
            gridPos: { h: 8, w: 12, x: 0, y: 8 },
          },
          {
            title: 'Error Rate',
            targets: [
              {
                expr: 'rate(http_requests_total{status=~"5.."}[5m])',
                legendFormat: 'Error Rate',
              },
            ],
            type: 'graph',
            gridPos: { h: 8, w: 12, x: 12, y: 8 },
          },
        ],
      },
    };
  }

  /**
   * Build Datadog dashboard JSON
   */
  private buildDatadogDashboard(): any {
    return {
      title: 'SafeGraph AI - Production Monitoring',
      description: 'Real-time monitoring dashboard for SafeGraph AI production environment',
      widgets: [
        {
          definition: {
            type: 'timeseries',
            requests: [
              {
                q: 'avg:system.cpu.user{*}',
                display_type: 'line',
              },
            ],
            title: 'CPU Usage',
          },
          layout: { x: 0, y: 0, width: 4, height: 2 },
        },
        {
          definition: {
            type: 'timeseries',
            requests: [
              {
                q: 'avg:system.mem.pct_usable{*}',
                display_type: 'line',
              },
            ],
            title: 'Memory Usage',
          },
          layout: { x: 4, y: 0, width: 4, height: 2 },
        },
        {
          definition: {
            type: 'timeseries',
            requests: [
              {
                q: 'avg:trace.web.request.duration{*}',
                display_type: 'line',
              },
            ],
            title: 'Request Latency',
          },
          layout: { x: 8, y: 0, width: 4, height: 2 },
        },
      ],
    };
  }

  /**
   * Build HTML dashboard
   */
  private buildHTMLDashboard(metrics: any[]): string {
    const metricsHTML = metrics
      .map(
        m => `
      <div class="metric-card">
        <h3>${m.name}</h3>
        <div class="metric-value">${m.value.toFixed(2)}</div>
        <div class="metric-unit">${m.unit}</div>
      </div>
    `
      )
      .join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <title>SafeGraph AI - Monitoring Dashboard</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: #333;
      margin-bottom: 30px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .metric-card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .metric-card h3 {
      margin: 0 0 10px 0;
      color: #666;
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .metric-value {
      font-size: 32px;
      font-weight: bold;
      color: #333;
      margin-bottom: 5px;
    }
    .metric-unit {
      font-size: 12px;
      color: #999;
    }
    .timestamp {
      color: #999;
      font-size: 12px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 SafeGraph AI - Monitoring Dashboard</h1>
    <div class="metrics-grid">
      ${metricsHTML}
    </div>
    <div class="timestamp">Last updated: ${new Date().toISOString()}</div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Load default dashboard configuration
   */
  private loadDefaultConfig(): DashboardConfig {
    return {
      grafanaEnabled: true,
      datadogEnabled: false,
      htmlEnabled: true,
      refreshInterval: 60000,
    };
  }
}

export interface DashboardConfig {
  grafanaEnabled: boolean;
  datadogEnabled: boolean;
  htmlEnabled: boolean;
  refreshInterval: number;
}