/**
 * Task Progress Tracker
 * Track task progress and provide updates
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export interface TaskProgress {
  taskId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  message?: string;
  details?: any;
  startedAt?: number;
  estimatedCompletion?: number;
  subtasks?: {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    progress: number;
  }[];
}

export class TaskProgressTracker extends EventEmitter {
  private progress: Map<string, TaskProgress> = new Map();
  private statusBarItem: vscode.StatusBarItem;
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    super();
    this.output = output;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'safegraph.showTaskProgress';
    this.statusBarItem.show();
  }

  public createTask(taskId: string, title: string): TaskProgress {
    const progress: TaskProgress = {
      taskId,
      title,
      status: 'pending',
      progress: 0
    };

    this.progress.set(taskId, progress);
    this.emit('taskCreated', progress);
    this.updateStatusBar();

    return progress;
  }

  public startTask(taskId: string): void {
    const progress = this.progress.get(taskId);
    if (progress) {
      progress.status = 'in_progress';
      progress.startedAt = Date.now();
      this.progress.set(taskId, progress);
      this.emit('taskStarted', progress);
      this.updateStatusBar();
    }
  }

  public updateProgress(taskId: string, progress: number, message?: string): void {
    const taskProgress = this.progress.get(taskId);
    if (taskProgress) {
      taskProgress.progress = Math.max(0, Math.min(100, progress));
      if (message) {
        taskProgress.message = message;
      }
      this.progress.set(taskId, taskProgress);
      this.emit('taskProgress', taskProgress);
      this.updateStatusBar();
    }
  }

  public updateDetails(taskId: string, details: any): void {
    const taskProgress = this.progress.get(taskId);
    if (taskProgress) {
      taskProgress.details = details;
      this.progress.set(taskId, taskProgress);
      this.emit('taskDetailsUpdated', taskProgress);
    }
  }

  public addSubtask(
    taskId: string,
    subtaskId: string,
    title: string
  ): void {
    const taskProgress = this.progress.get(taskId);
    if (taskProgress) {
      if (!taskProgress.subtasks) {
        taskProgress.subtasks = [];
      }
      taskProgress.subtasks.push({
        id: subtaskId,
        title,
        status: 'pending',
        progress: 0
      });
      this.progress.set(taskId, taskProgress);
      this.emit('subtaskAdded', { taskId, subtaskId, title });
    }
  }

  public updateSubtaskProgress(
    taskId: string,
    subtaskId: string,
    progress: number,
    status?: 'pending' | 'in_progress' | 'completed' | 'failed'
  ): void {
    const taskProgress = this.progress.get(taskId);
    if (taskProgress && taskProgress.subtasks) {
      const subtask = taskProgress.subtasks.find(s => s.id === subtaskId);
      if (subtask) {
        subtask.progress = Math.max(0, Math.min(100, progress));
        if (status) {
          subtask.status = status;
        }
        
        // Recalculate overall progress
        const totalProgress = taskProgress.subtasks.reduce(
          (sum, s) => sum + s.progress,
          0
        );
        taskProgress.progress = totalProgress / taskProgress.subtasks.length;
        
        this.progress.set(taskId, taskProgress);
        this.emit('subtaskProgress', { taskId, subtaskId, progress, status });
        this.updateStatusBar();
      }
    }
  }

  public completeTask(taskId: string, result?: any): void {
    const progress = this.progress.get(taskId);
    if (progress) {
      progress.status = 'completed';
      progress.progress = 100;
      if (result) {
        progress.details = result;
      }
      this.progress.set(taskId, progress);
      this.emit('taskCompleted', progress);
      this.updateStatusBar();
    }
  }

  public failTask(taskId: string, error: string): void {
    const progress = this.progress.get(taskId);
    if (progress) {
      progress.status = 'failed';
      progress.message = error;
      this.progress.set(taskId, progress);
      this.emit('taskFailed', progress);
      this.updateStatusBar();
    }
  }

  public cancelTask(taskId: string): void {
    const progress = this.progress.get(taskId);
    if (progress) {
      progress.status = 'cancelled';
      this.progress.set(taskId, progress);
      this.emit('taskCancelled', progress);
      this.updateStatusBar();
    }
  }

  public getTaskProgress(taskId: string): TaskProgress | undefined {
    return this.progress.get(taskId);
  }

  public getAllProgress(): TaskProgress[] {
    return Array.from(this.progress.values());
  }

  public getActiveTasks(): TaskProgress[] {
    return this.getAllProgress().filter(p => p.status === 'in_progress');
  }

  public deleteTask(taskId: string): void {
    this.progress.delete(taskId);
    this.emit('taskDeleted', taskId);
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const activeTasks = this.getActiveTasks();
    
    if (activeTasks.length === 0) {
      this.statusBarItem.text = '$(check) Safegraph: Ready';
      this.statusBarItem.tooltip = 'No active tasks';
      return;
    }

    const totalProgress = activeTasks.reduce(
      (sum, task) => sum + task.progress,
      0
    ) / activeTasks.length;

    this.statusBarItem.text = `$(loading~spin) Safegraph: ${Math.round(totalProgress)}% (${activeTasks.length} active)`;
    this.statusBarItem.tooltip = activeTasks
      .map(t => `${t.title}: ${Math.round(t.progress)}%`)
      .join('\n');
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
