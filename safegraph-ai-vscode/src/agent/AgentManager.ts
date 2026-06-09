/**
 * Agent Manager
 * Main orchestration system for managing multiple agents
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { AgentType, AgentConfig, AgentState, AgentMetrics, AGENT_CONFIGS } from './AgentTypes';
import { AgentStateStore } from './AgentStateStore';
import { AgentCommunication } from './AgentCommunication';

export interface AgentTask {
  id: string;
  type: AgentType;
  description: string;
  priority: number;
  assignedTo?: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentState> = new Map();
  private taskQueue: AgentTask[] = [];
  private activeTasks: Map<string, AgentTask> = new Map();
  private stateStore: AgentStateStore;
  private communication: AgentCommunication;
  private output: vscode.OutputChannel;
  private maxConcurrentAgents: number;

  constructor(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    maxConcurrentAgents: number = 3
  ) {
    super();
    this.stateStore = new AgentStateStore(context);
    this.communication = new AgentCommunication();
    this.output = output;
    this.maxConcurrentAgents = maxConcurrentAgents;
    
    this.initializeAgents();
    this.setupEventHandlers();
  }

  private initializeAgents(): void {
    // Initialize agent states from configs
    for (const [type, config] of Object.entries(AGENT_CONFIGS)) {
      const existingState = this.stateStore.getState(config.id);
      
      if (!existingState) {
        const initialState: AgentState = {
          id: config.id,
          type: config.type,
          status: 'idle',
          completedTasks: [],
          failedTasks: [],
          lastActivity: Date.now(),
          metrics: {
            tasksCompleted: 0,
            tasksFailed: 0,
            averageTaskDuration: 0,
            totalTokensUsed: 0,
            successRate: 1.0
          }
        };
        
        this.stateStore.setState(config.id, initialState);
        this.agents.set(config.id, initialState);
      } else {
        this.agents.set(config.id, existingState);
      }
    }
    
    this.output.appendLine('[AgentManager] Initialized agents');
  }

  private setupEventHandlers(): void {
    this.communication.on('message', (message) => {
      this.handleAgentMessage(message);
    });
  }

  private handleAgentMessage(message: any): void {
    this.output.appendLine(`[AgentManager] Message from ${message.from} to ${message.to}: ${message.type}`);
    
    // Handle different message types
    switch (message.type) {
      case 'request':
        this.handleRequest(message);
        break;
      case 'response':
        this.handleResponse(message);
        break;
      case 'notification':
        this.handleNotification(message);
        break;
      case 'error':
        this.handleError(message);
        break;
    }
  }

  private handleRequest(message: any): void {
    // Process agent requests
    const agent = this.agents.get(message.to);
    if (agent) {
      // Update agent state to busy
      this.updateAgentStatus(message.to, 'busy');
    }
  }

  private handleResponse(message: any): void {
    // Process agent responses
    const agent = this.agents.get(message.to);
    if (agent) {
      // Update agent state to idle if task is complete
      this.updateAgentStatus(message.to, 'idle');
    }
  }

  private handleNotification(message: any): void {
    // Process agent notifications
    this.emit('notification', message);
  }

  private handleError(message: any): void {
    // Process agent errors
    this.output.appendLine(`[AgentManager] Error from ${message.from}: ${message.content.message}`);
    
    const agent = this.agents.get(message.from);
    if (agent) {
      this.updateAgentStatus(message.from, 'error');
      agent.failedTasks.push(message.content.message || 'Unknown error');
      this.stateStore.setState(agent.id, agent);
    }
  }

  private updateAgentStatus(agentId: string, status: AgentState['status']): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastActivity = Date.now();
      this.stateStore.setState(agentId, agent);
      this.emit('agentStatusChanged', { agentId, status });
    }
  }

  public assignTask(task: AgentTask): string {
    // Find best agent for the task
    const agentId = this.findAvailableAgent(task.type);
    
    if (!agentId) {
      // Queue the task if no agent is available
      this.taskQueue.push(task);
      this.output.appendLine(`[AgentManager] Task queued: ${task.description}`);
      return 'queued';
    }

    // Assign task to agent
    task.assignedTo = agentId;
    task.status = 'assigned';
    task.startedAt = Date.now();
    
    this.activeTasks.set(task.id, task);
    
    // Update agent state
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'busy';
      agent.currentTask = task.id;
      this.stateStore.setState(agentId, agent);
    }

    // Send task to agent via communication
    this.communication.sendRequest('manager', agentId, {
      type: 'task',
      task
    });

    this.output.appendLine(`[AgentManager] Task assigned to ${agentId}: ${task.description}`);
    this.emit('taskAssigned', { taskId: task.id, agentId });
    
    return agentId;
  }

  private findAvailableAgent(type: AgentType): string | null {
    // First, try to find an idle agent of the exact type
    for (const [id, agent] of this.agents) {
      if (agent.type === type && agent.status === 'idle') {
        return id;
      }
    }

    // If no exact match, try to find any idle agent
    const activeCount = this.getActiveAgentCount();
    if (activeCount < this.maxConcurrentAgents) {
      for (const [id, agent] of this.agents) {
        if (agent.status === 'idle') {
          return id;
        }
      }
    }

    return null;
  }

  private getActiveAgentCount(): number {
    return Array.from(this.agents.values()).filter(a => a.status === 'busy').length;
  }

  public completeTask(taskId: string, result: any): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;

    // Update agent metrics
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.completedTasks.push(taskId);
        
        const duration = task.completedAt - (task.startedAt || task.createdAt);
        agent.metrics.tasksCompleted++;
        agent.metrics.averageTaskDuration = 
          (agent.metrics.averageTaskDuration * (agent.metrics.tasksCompleted - 1) + duration) / 
          agent.metrics.tasksCompleted;
        agent.metrics.successRate = 
          agent.metrics.tasksCompleted / (agent.metrics.tasksCompleted + agent.metrics.tasksFailed);
        
        this.stateStore.setState(task.assignedTo, agent);
      }
    }

    this.activeTasks.delete(taskId);
    this.emit('taskCompleted', { taskId, result });
    
    // Process queued tasks
    this.processQueue();
  }

  public failTask(taskId: string, error: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;

    // Update agent metrics
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.failedTasks.push(taskId);
        agent.metrics.tasksFailed++;
        agent.metrics.successRate = 
          agent.metrics.tasksCompleted / (agent.metrics.tasksCompleted + agent.metrics.tasksFailed);
        
        this.stateStore.setState(task.assignedTo, agent);
      }
    }

    this.activeTasks.delete(taskId);
    this.emit('taskFailed', { taskId, error });
    
    // Process queued tasks
    this.processQueue();
  }

  private processQueue(): void {
    // Process queued tasks in priority order
    this.taskQueue.sort((a, b) => b.priority - a.priority);
    
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      const agentId = this.findAvailableAgent(task.type);
      
      if (agentId) {
        this.assignTask(task);
      } else {
        // Put task back if no agent available
        this.taskQueue.unshift(task);
        break;
      }
    }
  }

  public getAgentState(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  public getAllAgentStates(): AgentState[] {
    return Array.from(this.agents.values());
  }

  public getTaskStatus(taskId: string): AgentTask | undefined {
    return this.activeTasks.get(taskId);
  }

  public getActiveTasks(): AgentTask[] {
    return Array.from(this.activeTasks.values());
  }

  public getCommunication(): AgentCommunication {
    return this.communication;
  }

  public shutdown(): void {
    // Save all agent states
    for (const [id, agent] of this.agents) {
      this.stateStore.setState(id, agent);
    }
    
    this.output.appendLine('[AgentManager] Shutdown complete');
  }
}
