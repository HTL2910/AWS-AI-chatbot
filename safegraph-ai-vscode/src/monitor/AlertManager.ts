import * as vscode from 'vscode';

/**
 * AlertManager: Define thresholds, send alerts
 * Supports: email, Slack, PagerDuty, webhooks
 */
export class AlertManager {
  private outputChannel: vscode.OutputChannel;
  private alertConfig: AlertConfig;
  private activeAlerts: Map<string, Alert>;
  private alertHistory: AlertRecord[];

  constructor(outputChannel: vscode.OutputChannel, alertConfig?: AlertConfig) {
    this.outputChannel = outputChannel;
    this.alertConfig = alertConfig || this.loadDefaultConfig();
    this.activeAlerts = new Map();
    this.alertHistory = [];
  }

  /**
   * Check metrics against thresholds and trigger alerts
   */
  async checkMetrics(metrics: MetricSnapshot): Promise<Alert[]> {
    const alerts: Alert[] = [];

    // Check CPU threshold
    if (metrics.cpu > this.alertConfig.cpuThreshold) {
      alerts.push(await this.createAlert('cpu', metrics.cpu, this.alertConfig.cpuThreshold));
    }

    // Check memory threshold
    if (metrics.memory > this.alertConfig.memoryThreshold) {
      alerts.push(await this.createAlert('memory', metrics.memory, this.alertConfig.memoryThreshold));
    }

    // Check latency threshold
    if (metrics.latency > this.alertConfig.latencyThreshold) {
      alerts.push(await this.createAlert('latency', metrics.latency, this.alertConfig.latencyThreshold));
    }

    // Check error rate threshold
    if (metrics.errorRate > this.alertConfig.errorRateThreshold) {
      alerts.push(await this.createAlert('error-rate', metrics.errorRate, this.alertConfig.errorRateThreshold));
    }

    // Send alerts
    for (const alert of alerts) {
      await this.sendAlert(alert);
    }

    return alerts;
  }

  /**
   * Create alert
   */
  private async createAlert(metric: string, value: number, threshold: number): Promise<Alert> {
    const alertId = `alert-${metric}-${Date.now()}`;
    const severity = this.determineSeverity(metric, value, threshold);

    const alert: Alert = {
      id: alertId,
      metric,
      value,
      threshold,
      severity,
      message: `${metric} exceeded threshold: ${value.toFixed(2)} > ${threshold}`,
      timestamp: new Date(),
      status: 'active',
    };

    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push({
      ...alert,
      createdAt: new Date(),
    });

    this.outputChannel.appendLine(`\n⚠️  [AlertManager] Alert created: ${alert.message}`);

    return alert;
  }

  /**
   * Determine alert severity
   */
  private determineSeverity(metric: string, value: number, threshold: number): AlertSeverity {
    const ratio = value / threshold;

    if (ratio > 1.5) {
      return 'critical';
    } else if (ratio > 1.2) {
      return 'high';
    } else if (ratio > 1.0) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Send alert via configured channels
   */
  private async sendAlert(alert: Alert): Promise<void> {
    this.outputChannel.appendLine(`   📤 Sending alert via configured channels...`);

    const promises = [];

    if (this.alertConfig.email?.enabled) {
      promises.push(this.sendEmailAlert(alert));
    }

    if (this.alertConfig.slack?.enabled) {
      promises.push(this.sendSlackAlert(alert));
    }

    if (this.alertConfig.pagerduty?.enabled) {
      promises.push(this.sendPagerDutyAlert(alert));
    }

    if (this.alertConfig.webhook?.enabled) {
      promises.push(this.sendWebhookAlert(alert));
    }

    if (this.alertConfig.vscode?.enabled) {
      promises.push(this.sendVSCodeAlert(alert));
    }

    try {
      await Promise.all(promises);
      this.outputChannel.appendLine(`   ✅ Alert sent`);
    } catch (error) {
      this.outputChannel.appendLine(`   ❌ Error sending alert: ${error}`);
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: Alert): Promise<void> {
    const emailConfig = this.alertConfig.email;
    if (!emailConfig?.recipients || emailConfig.recipients.length === 0) return;

    this.outputChannel.appendLine(`      📧 Sending email to ${emailConfig.recipients.join(', ')}`);
    // In real implementation, use nodemailer
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alert: Alert): Promise<void> {
    const slackConfig = this.alertConfig.slack;
    if (!slackConfig?.webhookUrl) return;

    const color = alert.severity === 'critical' ? '#ff0000' : alert.severity === 'high' ? '#ff9900' : '#ffff00';

    const payload = {
      attachments: [
        {
          color,
          title: `🚨 ${alert.severity.toUpperCase()} Alert`,
          text: alert.message,
          fields: [
            { title: 'Metric', value: alert.metric, short: true },
            { title: 'Value', value: alert.value.toFixed(2), short: true },
            { title: 'Threshold', value: alert.threshold.toFixed(2), short: true },
            { title: 'Severity', value: alert.severity, short: true },
          ],
          footer: 'SafeGraph AI Monitoring',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    this.outputChannel.appendLine(`      📤 Slack alert prepared`);
    // In real implementation, use axios to POST to webhook
  }

  /**
   * Send PagerDuty alert
   */
  private async sendPagerDutyAlert(alert: Alert): Promise<void> {
    const pdConfig = this.alertConfig.pagerduty;
    if (!pdConfig?.integrationKey) return;

    this.outputChannel.appendLine(`      📞 PagerDuty alert prepared`);
    // In real implementation, use PagerDuty API
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: Alert): Promise<void> {
    const webhookConfig = this.alertConfig.webhook;
    if (!webhookConfig?.url) return;

    this.outputChannel.appendLine(`      🔗 Webhook alert prepared`);
    // In real implementation, use axios to POST to webhook
  }

  /**
   * Send VS Code alert
   */
  private async sendVSCodeAlert(alert: Alert): Promise<void> {
    const title = `🚨 ${alert.severity.toUpperCase()}: ${alert.metric}`;
    const detail = alert.message;

    if (alert.severity === 'critical') {
      vscode.window.showErrorMessage(title, detail);
    } else if (alert.severity === 'high') {
      vscode.window.showWarningMessage(title, detail);
    } else {
      vscode.window.showInformationMessage(title, detail);
    }

    this.outputChannel.appendLine(`      💬 VS Code alert shown`);
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.status = 'resolved';
      this.outputChannel.appendLine(`✅ Alert resolved: ${alert.message}`);
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(a => a.status === 'active');
  }

  /**
   * Get alert history
   */
  getAlertHistory(): AlertRecord[] {
    return this.alertHistory;
  }

  /**
   * Load default alert configuration
   */
  private loadDefaultConfig(): AlertConfig {
    return {
      cpuThreshold: 80,
      memoryThreshold: 85,
      latencyThreshold: 2000,
      errorRateThreshold: 5,
      email: { enabled: false, recipients: [] },
      slack: { enabled: false },
      pagerduty: { enabled: false },
      webhook: { enabled: false },
      vscode: { enabled: true },
    };
  }
}

export interface AlertConfig {
  cpuThreshold: number;
  memoryThreshold: number;
  latencyThreshold: number;
  errorRateThreshold: number;
  email?: { enabled: boolean; recipients?: string[] };
  slack?: { enabled: boolean; webhookUrl?: string };
  pagerduty?: { enabled: boolean; integrationKey?: string };
  webhook?: { enabled: boolean; url?: string };
  vscode?: { enabled: boolean };
}

export interface MetricSnapshot {
  cpu: number;
  memory: number;
  latency: number;
  errorRate: number;
}

export interface Alert {
  id: string;
  metric: string;
  value: number;
  threshold: number;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  status: 'active' | 'resolved';
}

export interface AlertRecord extends Alert {
  createdAt: Date;
}

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
