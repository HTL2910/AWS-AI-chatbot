/**
 * Task Scheduler
 * Schedule and manage background tasks
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { TaskQueue, QueuedTask } from './TaskQueue';

export interface ScheduledTask {
  id: string;
  type: string;
  data: any;
  schedule: 'immediate' | 'delayed' | 'recurring';
  delay?: number;
  interval?: number;
  priority: number;
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  scheduledAt?: number;
  nextRunAt?: number;
  lastRunAt?: number;
  runCount: number;
}

export class TaskScheduler extends EventEmitter {
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private taskQueue: TaskQueue;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private output: vscode.OutputChannel;

  constructor(taskQueue: TaskQueue, output: vscode.OutputChannel) {
    super();
    this.taskQueue = taskQueue;
    this.output = output;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.taskQueue.on('taskCompleted', (task: QueuedTask) => {
      this.handleTaskCompletion(task);
    });

    this.taskQueue.on('taskFailed', (task: QueuedTask) => {
      this.handleTaskFailure(task);
    });
  }

  public schedule(
    type: string,
    data: any,
    options: {
      schedule?: 'immediate' | 'delayed' | 'recurring';
      delay?: number;
      interval?: number;
      priority?: number;
    } = {}
  ): string {
    const taskId = this.generateTaskId();
    const now = Date.now();

    const scheduledTask: ScheduledTask = {
      id: taskId,
      type,
      data,
      schedule: options.schedule || 'immediate',
      delay: options.delay,
      interval: options.interval,
      priority: options.priority || 5,
      status: 'pending',
      createdAt: now,
      runCount: 0
    };

    this.scheduledTasks.set(taskId, scheduledTask);
    this.output.appendLine(`[TaskScheduler] Scheduled task: ${type} (${taskId})`);

    switch (scheduledTask.schedule) {
      case 'immediate':
        this.executeImmediately(scheduledTask);
        break;
      case 'delayed':
        this.executeDelayed(scheduledTask);
        break;
      case 'recurring':
        this.executeRecurring(scheduledTask);
        break;
    }

    return taskId;
  }

  private executeImmediately(task: ScheduledTask): void {
    task.status = 'scheduled';
    task.scheduledAt = Date.now();
    this.emit('taskScheduled', task);

    const queueId = this.taskQueue.enqueue(task.type, task.data, task.priority);
    this.output.appendLine(`[TaskScheduler] Enqueued immediate task: ${task.id} -> ${queueId}`);
  }

  private executeDelayed(task: ScheduledTask): void {
    if (!task.delay) {
      this.executeImmediately(task);
      return;
    }

    task.status = 'scheduled';
    task.scheduledAt = Date.now();
    task.nextRunAt = Date.now() + task.delay;
    this.emit('taskScheduled', task);

    const timer = setTimeout(() => {
      const queueId = this.taskQueue.enqueue(task.type, task.data, task.priority);
      this.output.appendLine(`[TaskScheduler] Enqueued delayed task: ${task.id} -> ${queueId}`);
      this.timers.delete(task.id);
    }, task.delay);

    this.timers.set(task.id, timer);
  }

  private executeRecurring(task: ScheduledTask): void {
    if (!task.interval) {
      this.executeImmediately(task);
      return;
    }

    task.status = 'scheduled';
    task.scheduledAt = Date.now();
    task.nextRunAt = Date.now() + task.interval;
    this.emit('taskScheduled', task);

    const executeAndSchedule = () => {
      const queueId = this.taskQueue.enqueue(task.type, task.data, task.priority);
      this.output.appendLine(`[TaskScheduler] Enqueued recurring task: ${task.id} -> ${queueId}`);
      
      // Update task stats
      task.lastRunAt = Date.now();
      task.runCount++;
      task.nextRunAt = Date.now() + (task.interval || 0);

      // Schedule next run
      const timer = setTimeout(executeAndSchedule, task.interval || 0);
      this.timers.set(task.id, timer);
    };

    const timer = setTimeout(executeAndSchedule, task.interval);
    this.timers.set(task.id, timer);
  }

  private handleTaskCompletion(task: QueuedTask): void {
    // Find the scheduled task that corresponds to this queued task
    for (const [id, scheduledTask] of this.scheduledTasks) {
      if (scheduledTask.type === task.type && scheduledTask.status === 'scheduled') {
        if (scheduledTask.schedule !== 'recurring') {
          scheduledTask.status = 'completed';
          this.emit('scheduledTaskCompleted', scheduledTask);
        }
        break;
      }
    }
  }

  private handleTaskFailure(task: QueuedTask): void {
    // Find the scheduled task that corresponds to this queued task
    for (const [id, scheduledTask] of this.scheduledTasks) {
      if (scheduledTask.type === task.type && scheduledTask.status === 'scheduled') {
        if (scheduledTask.schedule !== 'recurring') {
          scheduledTask.status = 'failed';
          this.emit('scheduledTaskFailed', scheduledTask);
        }
        break;
      }
    }
  }

  public cancel(taskId: string): boolean {
    const task = this.scheduledTasks.get(taskId);
    if (!task) return false;

    // Cancel timer if exists
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    // Cancel in queue if running
    this.taskQueue.cancel(taskId);

    task.status = 'cancelled';
    this.emit('scheduledTaskCancelled', task);
    this.output.appendLine(`[TaskScheduler] Cancelled task: ${taskId}`);

    return true;
  }

  public getScheduledTask(taskId: string): ScheduledTask | undefined {
    return this.scheduledTasks.get(taskId);
  }

  public getAllScheduledTasks(): ScheduledTask[] {
    return Array.from(this.scheduledTasks.values());
  }

  public getScheduledTasksByType(type: string): ScheduledTask[] {
    return this.getAllScheduledTasks().filter(t => t.type === type);
  }

  public pause(taskId: string): boolean {
    const task = this.scheduledTasks.get(taskId);
    if (!task || task.status !== 'scheduled') return false;

    // Cancel timer
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    task.status = 'pending';
    this.emit('scheduledTaskPaused', task);
    this.output.appendLine(`[TaskScheduler] Paused task: ${taskId}`);

    return true;
  }

  public resume(taskId: string): boolean {
    const task = this.scheduledTasks.get(taskId);
    if (!task || task.status !== 'pending') return false;

    // Reschedule based on original schedule type
    switch (task.schedule) {
      case 'immediate':
        this.executeImmediately(task);
        break;
      case 'delayed':
        this.executeDelayed(task);
        break;
      case 'recurring':
        this.executeRecurring(task);
        break;
    }

    this.emit('scheduledTaskResumed', task);
    this.output.appendLine(`[TaskScheduler] Resumed task: ${taskId}`);

    return true;
  }

  public shutdown(): void {
    // Cancel all timers
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Cancel all scheduled tasks
    for (const [id, task] of this.scheduledTasks) {
      if (task.status === 'scheduled') {
        task.status = 'cancelled';
      }
    }

    this.output.appendLine('[TaskScheduler] Shutdown complete');
  }

  private generateTaskId(): string {
    return `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
