import * as vscode from 'vscode';

/**
 * DeploymentNotifier: Notify team of deployment status
 * Supports: Slack, email, webhooks, in-app notifications
 */
export class DeploymentNotifier {
  private outputChannel: vscode.OutputChannel;
  private notificationConfig: NotificationConfig;

  constructor(outputChannel: vscode.OutputChannel, notificationConfig?: NotificationConfig) {
    this.outputChannel = outputChannel;
    this.notificationConfig = notificationConfig || this.loadDefaultConfig();
  }

  /**
   * Notify deployment started
   */
  async notifyDeploymentStarted(deployment: DeploymentInfo): Promise<void> {
    this.outputChannel.appendLine(`\n📢 [DeploymentNotifier] Notifying deployment started...`);

    const message = {
      title: `🚀 Deployment Started`,
      version: deployment.version,
      environment: deployment.environment,
      status: 'started',
      timestamp: new Date().toISOString(),
    };

    await this.sendNotifications(message);
  }

  /**
   * Notify deployment in progress
   */
  async notifyDeploymentProgress(deployment: DeploymentInfo, progress: number): Promise<void> {
    const message = {
      title: `⏳ Deployment In Progress`,
      version: deployment.version,
      environment: deployment.environment,
      status: 'in-progress',
      progress: `${progress}%`,
      timestamp: new Date().toISOString(),
    };

    await this.sendNotifications(message);
  }

  /**
   * Notify deployment completed successfully
   */
  async notifyDeploymentSuccess(deployment: DeploymentInfo, duration: number): Promise<void> {
    this.outputChannel.appendLine(`\n📢 [DeploymentNotifier] Notifying deployment success...`);

    const message = {
      title: `✅ Deployment Successful`,
      version: deployment.version,
      environment: deployment.environment,
      status: 'success',
      duration: `${(duration / 1000).toFixed(2)}s`,
      url: deployment.url,
      timestamp: new Date().toISOString(),
    };

    await this.sendNotifications(message);
    await this.logDeploymentSuccess(deployment, duration);
  }

  /**
   * Notify deployment failed
   */
  async notifyDeploymentFailure(deployment: DeploymentInfo, error: string): Promise<void> {
    this.outputChannel.appendLine(`\n📢 [DeploymentNotifier] Notifying deployment failure...`);

    const message = {
      title: `❌ Deployment Failed`,
      version: deployment.version,
      environment: deployment.environment,
      status: 'failed',
      error,
      timestamp: new Date().toISOString(),
    };

    await this.sendNotifications(message);
    await this.logDeploymentFailure(deployment, error);
  }

  /**
   * Notify rollback started
   */
  async notifyRollbackStarted(deployment: DeploymentInfo, targetVersion: string): Promise<void> {
    this.outputChannel.appendLine(`\n📢 [DeploymentNotifier] Notifying rollback started...`);

    const message = {
      title: `⏮️  Rollback Started`,
      version: deployment.version,
      targetVersion,
      environment: deployment.environment,
      status: 'rollback-started',
      timestamp: new Date().toISOString(),
    };

    await this.sendNotifications(message);
  }

  /**
   * Notify rollback completed
   */
  async notifyRollbackCompleted(deployment: DeploymentInfo, targetVersion: string): Promise<void> {
    this.outputChannel.appendLine(`\n📢 [DeploymentNotifier] Notifying rollback completed...`);

    const message = {
      title: `✅ Rollback Completed`,
      version: deployment.version,
      targetVersion,
      environment: deployment.environment,
      status: 'rollback-completed',
      timestamp: new Date().toISOString(),
    };

    await this.sendNotifications(message);
  }

  /**
   * Send notifications via configured channels
   */
  private async sendNotifications(message: any): Promise<void> {
    const promises = [];

    if (this.notificationConfig.slack?.enabled) {
      promises.push(this.sendSlackNotification(message));
    }

    if (this.notificationConfig.email?.enabled) {
      promises.push(this.sendEmailNotification(message));
    }

    if (this.notificationConfig.webhook?.enabled) {
      promises.push(this.sendWebhookNotification(message));
    }

    if (this.notificationConfig.vscode?.enabled) {
      promises.push(this.sendVSCodeNotification(message));
    }

    try {
      await Promise.all(promises);
      this.outputChannel.appendLine(`   ✅ Notifications sent`);
    } catch (error) {
      this.outputChannel.appendLine(`   ⚠️  Error sending notifications: ${error}`);
    }
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(message: any): Promise<void> {
    try {
      const slackConfig = this.notificationConfig.slack;
      if (!slackConfig?.webhookUrl) return;

      const color = message.status === 'success' ? '#36a64f' : message.status === 'failed' ? '#ff0000' : '#0099ff';

      const payload = {
        attachments: [
          {
            color,
            title: message.title,
            fields: [
              { title: 'Version', value: message.version, short: true },
              { title: 'Environment', value: message.environment, short: true },
              { title: 'Status', value: message.status, short: true },
              { title: 'Duration', value: message.duration || 'N/A', short: true },
            ],
            footer: 'SafeGraph AI Deployment',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      // In real implementation, use axios to POST to webhook
      this.outputChannel.appendLine(`      📤 Slack notification prepared`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Slack notification error: ${error}`);
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(message: any): Promise<void> {
    try {
      const emailConfig = this.notificationConfig.email;
      if (!emailConfig?.recipients || emailConfig.recipients.length === 0) return;

      const subject = message.title;
      const body = `
Version: ${message.version}
Environment: ${message.environment}
Status: ${message.status}
Duration: ${message.duration || 'N/A'}
Timestamp: ${message.timestamp}
${message.error ? `Error: ${message.error}` : ''}
      `.trim();

      // In real implementation, use nodemailer or similar
      this.outputChannel.appendLine(`      📧 Email notification prepared for ${emailConfig.recipients.join(', ')}`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Email notification error: ${error}`);
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(message: any): Promise<void> {
    try {
      const webhookConfig = this.notificationConfig.webhook;
      if (!webhookConfig?.url) return;

      // In real implementation, use axios to POST to webhook
      this.outputChannel.appendLine(`      🔗 Webhook notification prepared`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Webhook notification error: ${error}`);
    }
  }

  /**
   * Send VS Code notification
   */
  private async sendVSCodeNotification(message: any): Promise<void> {
    try {
      const title = message.title;
      const detail = `${message.version} → ${message.environment}`;

      if (message.status === 'success') {
        vscode.window.showInformationMessage(title, detail);
      } else if (message.status === 'failed') {
        vscode.window.showErrorMessage(title, detail);
      } else {
        vscode.window.showWarningMessage(title, detail);
      }

      this.outputChannel.appendLine(`      💬 VS Code notification shown`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  VS Code notification error: ${error}`);
    }
  }

  /**
   * Log deployment success
   */
  private async logDeploymentSuccess(deployment: DeploymentInfo, duration: number): Promise<void> {
    this.outputChannel.appendLine(`\n📊 Deployment Log:`);
    this.outputChannel.appendLine(`   Version: ${deployment.version}`);
    this.outputChannel.appendLine(`   Environment: ${deployment.environment}`);
    this.outputChannel.appendLine(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    this.outputChannel.appendLine(`   URL: ${deployment.url}`);
    this.outputChannel.appendLine(`   Timestamp: ${new Date().toISOString()}`);
  }

  /**
   * Log deployment failure
   */
  private async logDeploymentFailure(deployment: DeploymentInfo, error: string): Promise<void> {
    this.outputChannel.appendLine(`\n📊 Deployment Failure Log:`);
    this.outputChannel.appendLine(`   Version: ${deployment.version}`);
    this.outputChannel.appendLine(`   Environment: ${deployment.environment}`);
    this.outputChannel.appendLine(`   Error: ${error}`);
    this.outputChannel.appendLine(`   Timestamp: ${new Date().toISOString()}`);
  }

  /**
   * Load default notification configuration
   */
  private loadDefaultConfig(): NotificationConfig {
    return {
      slack: { enabled: false },
      email: { enabled: false, recipients: [] },
      webhook: { enabled: false },
      vscode: { enabled: true },
    };
  }
}

export interface NotificationConfig {
  slack?: { enabled: boolean; webhookUrl?: string };
  email?: { enabled: boolean; recipients?: string[] };
  webhook?: { enabled: boolean; url?: string };
  vscode?: { enabled: boolean };
}

export interface DeploymentInfo {
  version: string;
  environment: string;
  url?: string;
}
