/**
 * Agent Orchestrator
 * Coordinates multiple agents for complex tasks
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { AgentManager, AgentTask } from './AgentManager';
import { AgentType } from './AgentTypes';

export interface OrchestratedTask {
  id: string;
  description: string;
  subtasks: AgentTask[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export class AgentOrchestrator extends EventEmitter {
  private agentManager: AgentManager;
  private orchestratedTasks: Map<string, OrchestratedTask> = new Map();
  private output: vscode.OutputChannel;

  constructor(agentManager: AgentManager, output: vscode.OutputChannel) {
    super();
    this.agentManager = agentManager;
    this.output = output;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.agentManager.on('taskCompleted', (data) => {
      this.handleSubtaskCompletion(data.taskId);
    });

    this.agentManager.on('taskFailed', (data) => {
      this.handleSubtaskFailure(data.taskId, data.error);
    });
  }

  public async orchestrateTask(description: string, context?: any): Promise<string> {
    const taskId = this.generateTaskId();
    
    // Analyze the task and break it down into subtasks
    const subtasks = await this.breakdownTask(description, context);
    
    const orchestratedTask: OrchestratedTask = {
      id: taskId,
      description,
      subtasks,
      status: 'pending',
      dependencies: this.calculateDependencies(subtasks),
      createdAt: Date.now()
    };

    this.orchestratedTasks.set(taskId, orchestratedTask);
    this.output.appendLine(`[AgentOrchestrator] Orchestrated task: ${description} with ${subtasks.length} subtasks`);

    // Start executing the orchestrated task
    await this.executeOrchestratedTask(taskId);

    return taskId;
  }

  private async breakdownTask(description: string, context?: any): Promise<AgentTask[]> {
    const subtasks: AgentTask[] = [];

    // Analyze the task description to determine required agent types
    const taskAnalysis = this.analyzeTask(description);

    // Create planning subtask
    if (taskAnalysis.requiresPlanning) {
      subtasks.push({
        id: this.generateTaskId(),
        type: 'planner',
        description: `Plan execution for: ${description}`,
        priority: 1,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    // Create coding subtasks
    if (taskAnalysis.requiresCoding) {
      subtasks.push({
        id: this.generateTaskId(),
        type: 'coder',
        description: `Implement code changes for: ${description}`,
        priority: 2,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    // Create testing subtasks
    if (taskAnalysis.requiresTesting) {
      subtasks.push({
        id: this.generateTaskId(),
        type: 'tester',
        description: `Test implementation for: ${description}`,
        priority: 3,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    // Create review subtasks
    if (taskAnalysis.requiresReview) {
      subtasks.push({
        id: this.generateTaskId(),
        type: 'reviewer',
        description: `Review implementation for: ${description}`,
        priority: 4,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    // Create debugging subtasks if needed
    if (taskAnalysis.requiresDebugging) {
      subtasks.push({
        id: this.generateTaskId(),
        type: 'debugger',
        description: `Debug issues for: ${description}`,
        priority: 5,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    // Create architecture subtasks if needed
    if (taskAnalysis.requiresArchitecture) {
      subtasks.push({
        id: this.generateTaskId(),
        type: 'architect',
        description: `Analyze architecture for: ${description}`,
        priority: 6,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    return subtasks;
  }

  private analyzeTask(description: string): {
    requiresPlanning: boolean;
    requiresCoding: boolean;
    requiresTesting: boolean;
    requiresReview: boolean;
    requiresDebugging: boolean;
    requiresArchitecture: boolean;
  } {
    const lowerDesc = description.toLowerCase();

    return {
      requiresPlanning: true, // Always plan for complex tasks
      requiresCoding: /implement|create|build|add|write|code|develop/i.test(lowerDesc),
      requiresTesting: /implement|create|build|add|write|fix|bug/i.test(lowerDesc),
      requiresReview: /implement|refactor|architecture|design/i.test(lowerDesc),
      requiresDebugging: /fix|bug|error|debug|issue|problem/i.test(lowerDesc),
      requiresArchitecture: /architecture|design|refactor|structure|pattern/i.test(lowerDesc)
    };
  }

  private calculateDependencies(subtasks: AgentTask[]): string[] {
    // Calculate dependencies between subtasks
    const dependencies: string[] = [];

    // Planning should come first
    const plannerTask = subtasks.find(t => t.type === 'planner');
    if (plannerTask) {
      subtasks.forEach(t => {
        if (t.type !== 'planner') {
          dependencies.push(`${t.id}:${plannerTask.id}`);
        }
      });
    }

    // Coding should come before testing and review
    const coderTask = subtasks.find(t => t.type === 'coder');
    if (coderTask) {
      subtasks.forEach(t => {
        if (t.type === 'tester' || t.type === 'reviewer') {
          dependencies.push(`${t.id}:${coderTask.id}`);
        }
      });
    }

    return dependencies;
  }

  private async executeOrchestratedTask(taskId: string): Promise<void> {
    const task = this.orchestratedTasks.get(taskId);
    if (!task) return;

    task.status = 'in_progress';
    task.startedAt = Date.now();

    this.output.appendLine(`[AgentOrchestrator] Starting execution of task: ${task.description}`);

    // Execute subtasks in dependency order
    for (const subtask of task.subtasks) {
      if (this.canExecuteSubtask(task, subtask)) {
        this.agentManager.assignTask(subtask);
      }
    }
  }

  private canExecuteSubtask(task: OrchestratedTask, subtask: AgentTask): boolean {
    // Check if all dependencies are satisfied
    const dependencies = task.dependencies
      .filter(d => d.startsWith(`${subtask.id}:`))
      .map(d => d.split(':')[1]);

    for (const depId of dependencies) {
      const depTask = task.subtasks.find(t => t.id === depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  private handleSubtaskCompletion(subtaskId: string): void {
    // Find the orchestrated task containing this subtask
    for (const [taskId, task] of this.orchestratedTasks) {
      const subtask = task.subtasks.find(t => t.id === subtaskId);
      if (subtask) {
        subtask.status = 'completed';
        this.output.appendLine(`[AgentOrchestrator] Subtask completed: ${subtask.description}`);

        // Check if more subtasks can be executed
        this.checkAndExecuteReadySubtasks(task);

        // Check if the entire orchestrated task is complete
        this.checkOrchestratedTaskCompletion(taskId);
        break;
      }
    }
  }

  private handleSubtaskFailure(subtaskId: string, error: string): void {
    // Find the orchestrated task containing this subtask
    for (const [taskId, task] of this.orchestratedTasks) {
      const subtask = task.subtasks.find(t => t.id === subtaskId);
      if (subtask) {
        subtask.status = 'failed';
        subtask.error = error;
        this.output.appendLine(`[AgentOrchestrator] Subtask failed: ${subtask.description} - ${error}`);

        // Mark the entire orchestrated task as failed
        task.status = 'failed';
        task.completedAt = Date.now();
        this.emit('orchestratedTaskFailed', { taskId, error });
        break;
      }
    }
  }

  private checkAndExecuteReadySubtasks(task: OrchestratedTask): void {
    for (const subtask of task.subtasks) {
      if (subtask.status === 'pending' && this.canExecuteSubtask(task, subtask)) {
        this.agentManager.assignTask(subtask);
      }
    }
  }

  private checkOrchestratedTaskCompletion(taskId: string): void {
    const task = this.orchestratedTasks.get(taskId);
    if (!task) return;

    const allCompleted = task.subtasks.every(t => t.status === 'completed');
    if (allCompleted) {
      task.status = 'completed';
      task.completedAt = Date.now();
      this.output.appendLine(`[AgentOrchestrator] Orchestrated task completed: ${task.description}`);
      this.emit('orchestratedTaskCompleted', { taskId });
    }
  }

  public getOrchestratedTask(taskId: string): OrchestratedTask | undefined {
    return this.orchestratedTasks.get(taskId);
  }

  public getAllOrchestratedTasks(): OrchestratedTask[] {
    return Array.from(this.orchestratedTasks.values());
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
