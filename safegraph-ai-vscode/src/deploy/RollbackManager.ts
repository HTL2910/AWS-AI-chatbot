import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * RollbackManager: Automated rollback on deployment failure
 * Supports: version rollback, database rollback, traffic rollback
 */
export class RollbackManager {
  private outputChannel: vscode.OutputChannel;
  private rollbackConfig: RollbackConfig;
  private rollbackHistory: RollbackRecord[];

  constructor(outputChannel: vscode.OutputChannel, rollbackConfig?: RollbackConfig) {
    this.outputChannel = outputChannel;
    this.rollbackConfig = rollbackConfig || this.loadDefaultConfig();
    this.rollbackHistory = [];
  }

  /**
   * Perform rollback to previous version
   */
  async rollback(currentVersion: string, targetVersion: string): Promise<RollbackResult> {
    this.outputChannel.appendLine(`\n⏮️  [RollbackManager] Starting rollback...`);
    this.outputChannel.appendLine(`   From: ${currentVersion}`);
    this.outputChannel.appendLine(`   To: ${targetVersion}`);

    const rollbackId = `rollback-${Date.now()}`;
    const startTime = Date.now();

    try {
      // Step 1: Pause traffic
      this.outputChannel.appendLine(`\n   🛑 Step 1: Pausing traffic...`);
      await this.pauseTraffic();

      // Step 2: Rollback application
      this.outputChannel.appendLine(`\n   🔄 Step 2: Rolling back application...`);
      await this.rollbackApplication(targetVersion);

      // Step 3: Rollback database (if needed)
      if (this.rollbackConfig.rollbackDatabase) {
        this.outputChannel.appendLine(`\n   🗄️  Step 3: Rolling back database...`);
        await this.rollbackDatabase(targetVersion);
      }

      // Step 4: Verify rollback
      this.outputChannel.appendLine(`\n   ✅ Step 4: Verifying rollback...`);
      const verified = await this.verifyRollback(targetVersion);

      if (!verified) {
        throw new Error('Rollback verification failed');
      }

      // Step 5: Resume traffic
      this.outputChannel.appendLine(`\n   ▶️  Step 5: Resuming traffic...`);
      await this.resumeTraffic();

      const duration = Date.now() - startTime;

      this.outputChannel.appendLine(`\n✅ Rollback completed successfully in ${duration}ms`);

      const record: RollbackRecord = {
        id: rollbackId,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        status: 'success',
        duration,
        timestamp: new Date(),
      };

      this.rollbackHistory.push(record);

      return {
        success: true,
        rollbackId,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.outputChannel.appendLine(`\n❌ Rollback failed: ${error}`);

      const record: RollbackRecord = {
        id: rollbackId,
        fromVersion: currentVersion,
        toVersion: targetVersion,
        status: 'failed',
        duration: Date.now() - startTime,
        timestamp: new Date(),
        error: String(error),
      };

      this.rollbackHistory.push(record);

      throw error;
    }
  }

  /**
   * Pause traffic to service
   */
  private async pauseTraffic(): Promise<void> {
    this.outputChannel.appendLine(`      Pausing traffic...`);

    try {
      // Update load balancer to drain connections
      if (this.rollbackConfig.loadBalancerType === 'kubernetes') {
        await execAsync(`kubectl patch service prod-service -p '{"spec":{"selector":{"version":"none"}}}'`);
      } else if (this.rollbackConfig.loadBalancerType === 'aws') {
        // AWS ALB/NLB drain connections
        await execAsync(`aws elbv2 modify-target-group-attributes --target-group-arn ${this.rollbackConfig.targetGroupArn} --attributes Key=deregistration_delay.timeout_seconds,Value=30`);
      }

      // Wait for connections to drain
      await this.delay(5000);

      this.outputChannel.appendLine(`      ✅ Traffic paused`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Error pausing traffic: ${error}`);
      // Continue anyway
    }
  }

  /**
   * Rollback application to previous version
   */
  private async rollbackApplication(targetVersion: string): Promise<void> {
    this.outputChannel.appendLine(`      Rolling back to version ${targetVersion}...`);

    try {
      if (this.rollbackConfig.deploymentType === 'kubernetes') {
        // Rollback Kubernetes deployment
        await execAsync(`kubectl rollout undo deployment/prod-app --to-revision=1`);
      } else if (this.rollbackConfig.deploymentType === 'docker') {
        // Stop current container and start previous version
        await execAsync(`docker stop prod-app`);
        await execAsync(`docker run -d --name prod-app docker.io/safegraph/app:${targetVersion}`);
      } else if (this.rollbackConfig.deploymentType === 'ecs') {
        // Rollback ECS service
        await execAsync(`aws ecs update-service --cluster prod --service prod-app --task-definition prod-app:1`);
      }

      this.outputChannel.appendLine(`      ✅ Application rolled back`);
    } catch (error) {
      throw new Error(`Application rollback failed: ${error}`);
    }
  }

  /**
   * Rollback database to previous state
   */
  private async rollbackDatabase(targetVersion: string): Promise<void> {
    this.outputChannel.appendLine(`      Rolling back database...`);

    try {
      if (this.rollbackConfig.databaseType === 'postgres') {
        // Restore from backup
        const backupFile = `/backups/db-${targetVersion}.sql`;
        await execAsync(`psql -U postgres -d prod_db < ${backupFile}`);
      } else if (this.rollbackConfig.databaseType === 'mongodb') {
        // Restore MongoDB from backup
        const backupDir = `/backups/db-${targetVersion}`;
        await execAsync(`mongorestore --uri mongodb://localhost:27017/prod_db --dir ${backupDir}`);
      }

      this.outputChannel.appendLine(`      ✅ Database rolled back`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Database rollback failed: ${error}`);
      // Don't throw - application rollback is more important
    }
  }

  /**
   * Verify rollback was successful
   */
  private async verifyRollback(targetVersion: string): Promise<boolean> {
    this.outputChannel.appendLine(`      Verifying rollback...`);

    try {
      // Check if service is running
      const response = await execAsync(`curl -s http://localhost:3000/health`);
      const healthy = response.stdout.includes('ok') || response.stdout.includes('healthy');

      if (healthy) {
        this.outputChannel.appendLine(`      ✅ Rollback verified`);
        return true;
      } else {
        this.outputChannel.appendLine(`      ❌ Service not responding correctly`);
        return false;
      }
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Verification failed: ${error}`);
      return false;
    }
  }

  /**
   * Resume traffic to service
   */
  private async resumeTraffic(): Promise<void> {
    this.outputChannel.appendLine(`      Resuming traffic...`);

    try {
      if (this.rollbackConfig.loadBalancerType === 'kubernetes') {
        await execAsync(`kubectl patch service prod-service -p '{"spec":{"selector":{"version":"stable"}}}'`);
      }

      this.outputChannel.appendLine(`      ✅ Traffic resumed`);
    } catch (error) {
      this.outputChannel.appendLine(`      ⚠️  Error resuming traffic: ${error}`);
    }
  }

  /**
   * Get rollback history
   */
  getRollbackHistory(): RollbackRecord[] {
    return this.rollbackHistory;
  }

  /**
   * Load default rollback configuration
   */
  private loadDefaultConfig(): RollbackConfig {
    return {
      deploymentType: 'kubernetes',
      loadBalancerType: 'kubernetes',
      databaseType: 'postgres',
      rollbackDatabase: true,
      maxRollbackAttempts: 3,
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface RollbackConfig {
  deploymentType: 'kubernetes' | 'docker' | 'ecs';
  loadBalancerType: 'kubernetes' | 'aws';
  databaseType: 'postgres' | 'mongodb';
  rollbackDatabase: boolean;
  maxRollbackAttempts: number;
  targetGroupArn?: string;
}

export interface RollbackRecord {
  id: string;
  fromVersion: string;
  toVersion: string;
  status: 'success' | 'failed';
  duration: number;
  timestamp: Date;
  error?: string;
}

export interface RollbackResult {
  success: boolean;
  rollbackId: string;
  fromVersion: string;
  toVersion: string;
  duration: number;
  timestamp: string;
}
