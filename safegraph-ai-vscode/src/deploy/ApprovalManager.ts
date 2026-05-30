import * as vscode from 'vscode';

/**
 * ApprovalManager: Request and manage deployment approvals
 * Supports: manual approval, auto-approval based on rules, approval workflows
 */
export class ApprovalManager {
  private outputChannel: vscode.OutputChannel;
  private approvalConfig: ApprovalConfig;
  private pendingApprovals: Map<string, PendingApproval>;

  constructor(outputChannel: vscode.OutputChannel, approvalConfig?: ApprovalConfig) {
    this.outputChannel = outputChannel;
    this.approvalConfig = approvalConfig || this.loadDefaultConfig();
    this.pendingApprovals = new Map();
  }

  /**
   * Request approval for deployment
   */
  async requestApproval(deploymentInfo: DeploymentInfo): Promise<ApprovalResult> {
    this.outputChannel.appendLine(`\n✋ [ApprovalManager] Requesting deployment approval...`);
    this.outputChannel.appendLine(`   Version: ${deploymentInfo.version}`);
    this.outputChannel.appendLine(`   Environment: ${deploymentInfo.environment}`);

    // Check if auto-approval is enabled
    if (this.shouldAutoApprove(deploymentInfo)) {
      this.outputChannel.appendLine(`   ✅ Auto-approved (rule matched)`);
      return {
        approved: true,
        approver: 'system',
        reason: 'Auto-approved by rule',
        timestamp: new Date().toISOString(),
      };
    }

    // Request manual approval
    return await this.requestManualApproval(deploymentInfo);
  }

  /**
   * Check if deployment should be auto-approved
   */
  private shouldAutoApprove(deploymentInfo: DeploymentInfo): boolean {
    // Auto-approve patch versions
    if (this.approvalConfig.autoApprovePatch && deploymentInfo.version.match(/^\d+\.\d+\.\d+$/)) {
      const parts = deploymentInfo.version.split('.');
      if (parts[2] !== '0') {
        return true;
      }
    }

    // Auto-approve if all tests passed
    if (this.approvalConfig.autoApproveIfTestsPassed && deploymentInfo.allTestsPassed) {
      return true;
    }

    // Auto-approve if no breaking changes
    if (this.approvalConfig.autoApproveIfNoBreakingChanges && !deploymentInfo.hasBreakingChanges) {
      return true;
    }

    return false;
  }

  /**
   * Request manual approval from user
   */
  private async requestManualApproval(deploymentInfo: DeploymentInfo): Promise<ApprovalResult> {
    this.outputChannel.appendLine(`   📋 Waiting for manual approval...`);

    const approvalId = `approval-${Date.now()}`;
    const pending: PendingApproval = {
      id: approvalId,
      deploymentInfo,
      createdAt: new Date(),
      status: 'pending',
    };

    this.pendingApprovals.set(approvalId, pending);

    // Show approval dialog
    const message = `Deploy ${deploymentInfo.version} to ${deploymentInfo.environment}?`;
    const detail = this.buildApprovalDetail(deploymentInfo);

    const result = await vscode.window.showInformationMessage(
      message,
      { modal: true, detail },
      'Approve',
      'Reject',
      'Review Changes'
    );

    if (result === 'Approve') {
      this.outputChannel.appendLine(`   ✅ Deployment approved`);
      pending.status = 'approved';
      pending.approvedAt = new Date();
      pending.approver = 'user';

      return {
        approved: true,
        approver: 'user',
        reason: 'Manually approved',
        timestamp: new Date().toISOString(),
      };
    } else if (result === 'Reject') {
      this.outputChannel.appendLine(`   ❌ Deployment rejected`);
      pending.status = 'rejected';
      pending.rejectedAt = new Date();

      return {
        approved: false,
        approver: 'user',
        reason: 'Manually rejected',
        timestamp: new Date().toISOString(),
      };
    } else if (result === 'Review Changes') {
      this.outputChannel.appendLine(`   📖 Opening change review...`);
      // In a real implementation, this would open a diff viewer
      return await this.requestManualApproval(deploymentInfo);
    }

    // User cancelled
    this.outputChannel.appendLine(`   ⏸️  Deployment approval cancelled`);
    pending.status = 'cancelled';

    return {
      approved: false,
      approver: 'user',
      reason: 'Cancelled by user',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Build approval detail message
   */
  private buildApprovalDetail(deploymentInfo: DeploymentInfo): string {
    const lines = [
      `Version: ${deploymentInfo.version}`,
      `Environment: ${deploymentInfo.environment}`,
      `Tests Passed: ${deploymentInfo.allTestsPassed ? '✅ Yes' : '❌ No'}`,
      `Breaking Changes: ${deploymentInfo.hasBreakingChanges ? '⚠️ Yes' : '✅ No'}`,
      `Changes: ${deploymentInfo.changeCount || 0} files`,
    ];

    if (deploymentInfo.changesSummary) {
      lines.push(`Summary: ${deploymentInfo.changesSummary}`);
    }

    return lines.join('\n');
  }

  /**
   * Get approval status
   */
  getApprovalStatus(approvalId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(approvalId);
  }

  /**
   * Load default approval configuration
   */
  private loadDefaultConfig(): ApprovalConfig {
    return {
      autoApprovePatch: true,
      autoApproveIfTestsPassed: false,
      autoApproveIfNoBreakingChanges: false,
      requireApprovalForMajor: true,
      requireApprovalForMinor: true,
      requireApprovalForPatch: false,
    };
  }
}

export interface ApprovalConfig {
  autoApprovePatch?: boolean;
  autoApproveIfTestsPassed?: boolean;
  autoApproveIfNoBreakingChanges?: boolean;
  requireApprovalForMajor?: boolean;
  requireApprovalForMinor?: boolean;
  requireApprovalForPatch?: boolean;
}

export interface DeploymentInfo {
  version: string;
  environment: string;
  allTestsPassed: boolean;
  hasBreakingChanges: boolean;
  changeCount?: number;
  changesSummary?: string;
}

export interface ApprovalResult {
  approved: boolean;
  approver: string;
  reason: string;
  timestamp: string;
}

export interface PendingApproval {
  id: string;
  deploymentInfo: DeploymentInfo;
  createdAt: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approver?: string;
}
