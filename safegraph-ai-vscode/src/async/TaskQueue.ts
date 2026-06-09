/**
 * Task Queue
 * Background task queue for long-running operations
 */

import { EventEmitter } from 'events';

export interface QueuedTask {
  id: string;
  type: string;
  priority: number;
  data: any;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
  progress?: number;
}

export class TaskQueue extends EventEmitter {
  private queue: QueuedTask[] = [];
  private running: Map<string, QueuedTask> = new Map();
  private maxConcurrent: number;
  private processors: Map<string, (task: QueuedTask) => Promise<any>> = new Map();

  constructor(maxConcurrent: number = 3) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  public registerProcessor(type: string, processor: (task: QueuedTask) => Promise<any>): void {
    this.processors.set(type, processor);
  }

  public enqueue(type: string, data: any, priority: number = 5): string {
    const task: QueuedTask = {
      id: this.generateTaskId(),
      type,
      priority,
      data,
      status: 'queued',
      createdAt: Date.now()
    };

    this.queue.push(task);
    this.sortQueue();
    this.emit('taskQueued', task);
    this.processQueue();

    return task.id;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private async processQueue(): Promise<void> {
    if (this.running.size >= this.maxConcurrent) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift()!;
    const processor = this.processors.get(task.type);

    if (!processor) {
      task.status = 'failed';
      task.error = `No processor registered for type: ${task.type}`;
      task.completedAt = Date.now();
      this.emit('taskFailed', task);
      return;
    }

    task.status = 'running';
    task.startedAt = Date.now();
    this.running.set(task.id, task);
    this.emit('taskStarted', task);

    try {
      const result = await processor(task);
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      task.progress = 100;
      this.running.delete(task.id);
      this.emit('taskCompleted', task);
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();
      this.running.delete(task.id);
      this.emit('taskFailed', task);
    }

    // Process next task
    this.processQueue();
  }

  public cancel(taskId: string): boolean {
    const queuedIndex = this.queue.findIndex(t => t.id === taskId);
    if (queuedIndex !== -1) {
      const task = this.queue.splice(queuedIndex, 1)[0];
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.emit('taskCancelled', task);
      return true;
    }

    const running = this.running.get(taskId);
    if (running) {
      running.status = 'cancelled';
      running.completedAt = Date.now();
      this.running.delete(taskId);
      this.emit('taskCancelled', running);
      return true;
    }

    return false;
  }

  public getTask(taskId: string): QueuedTask | undefined {
    const queued = this.queue.find(t => t.id === taskId);
    if (queued) return queued;

    return this.running.get(taskId);
  }

  public getQueueStatus(): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      completed: 0, // Would need to track completed tasks separately
      failed: 0
    };
  }

  public clearQueue(): void {
    // Cancel all queued tasks
    for (const task of this.queue) {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.emit('taskCancelled', task);
    }
    this.queue = [];
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public updateProgress(taskId: string, progress: number): void {
    const task = this.running.get(taskId);
    if (task) {
      task.progress = Math.max(0, Math.min(100, progress));
      this.emit('taskProgress', task);
    }
  }
}
