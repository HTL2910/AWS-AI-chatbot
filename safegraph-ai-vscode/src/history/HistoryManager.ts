/**
 * History Manager - Manages task history and provides UI integration
 */

import * as vscode from 'vscode';
import { HistoryStorage, TaskHistoryEntry, HistoryQuery } from './HistoryStorage';

export class HistoryManager {
  private storage: HistoryStorage;
  private currentTaskId: string | null = null;
  private taskStartTime: number = 0;

  constructor(historyDir?: string) {
    this.storage = new HistoryStorage(historyDir);
  }

  /**
   * Start tracking a new autonomous task
   */
  startTask(title: string, description?: string): string {
    const taskId = this.storage.addEntry({
      taskId: `task_${Date.now()}`,
      type: 'TASK_START',
      title,
      description,
      status: 'in_progress',
      tags: ['autonomous'],
    });

    this.currentTaskId = taskId;
    this.taskStartTime = Date.now();

    vscode.window.showInformationMessage(`📝 Task started: ${title}`);
    return taskId;
  }

  /**
   * Log an action within current task
   */
  logAction(
    description: string,
    actionType: 'diff' | 'command' | 'file_create' | 'file_delete' | 'tool',
    content?: string,
    exitCode?: number,
    output?: string
  ): void {
    if (!this.currentTaskId) return;

    this.storage.addEntry({
      taskId: this.currentTaskId,
      type: 'ACTION',
      title: `Action: ${actionType}`,
      description,
      status: 'completed',
      actions: [
        {
          type: actionType,
          description,
          content,
          exitCode,
          output,
        },
      ],
    });
  }

  /**
   * Log verification result
   */
  logVerification(passed: boolean, details: string): void {
    if (!this.currentTaskId) return;

    this.storage.addEntry({
      taskId: this.currentTaskId,
      type: 'VERIFICATION',
      title: `Verification: ${passed ? 'PASSED' : 'FAILED'}`,
      status: passed ? 'completed' : 'failed',
      verification: { passed, details },
    });
  }

  /**
   * Complete current task
   */
  completeTask(summary: string, success: boolean = true): void {
    if (!this.currentTaskId) return;

    const duration = Date.now() - this.taskStartTime;
    this.storage.updateEntry(this.currentTaskId, {
      type: 'TASK_COMPLETE',
      status: success ? 'completed' : 'failed',
      summary,
      duration,
    });

    const icon = success ? '✅' : '❌';
    vscode.window.showInformationMessage(
      `${icon} Task completed in ${Math.round(duration / 1000)}s`
    );

    this.currentTaskId = null;
  }

  /**
   * Query history
   */
  queryHistory(filter: HistoryQuery): TaskHistoryEntry[] {
    return this.storage.query(filter);
  }

  /**
   * Get task history
   */
  getTaskHistory(taskId: string): TaskHistoryEntry[] {
    return this.storage.getTaskHistory(taskId);
  }

  /**
   * Export history
   */
  exportHistory(format: 'json' | 'csv'): string {
    return this.storage.exportHistory(format);
  }
}
