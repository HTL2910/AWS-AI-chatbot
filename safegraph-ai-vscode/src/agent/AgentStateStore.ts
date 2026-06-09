/**
 * Agent State Store
 * Persistent storage for agent states
 */

import * as vscode from 'vscode';
import { AgentState } from './AgentTypes';

export class AgentStateStore {
  private static readonly STORAGE_KEY = 'safegraph.agentStates';
  private states: Map<string, AgentState> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadStates();
  }

  private loadStates(): void {
    try {
      const stored = this.context.globalState.get<Record<string, AgentState>>(
        AgentStateStore.STORAGE_KEY,
        {}
      );
      this.states = new Map(Object.entries(stored));
    } catch (error) {
      console.error('[AgentStateStore] Failed to load states:', error);
    }
  }

  private async saveStates(): Promise<void> {
    try {
      const obj = Object.fromEntries(this.states);
      await this.context.globalState.update(AgentStateStore.STORAGE_KEY, obj);
    } catch (error) {
      console.error('[AgentStateStore] Failed to save states:', error);
    }
  }

  getState(agentId: string): AgentState | undefined {
    return this.states.get(agentId);
  }

  setState(agentId: string, state: AgentState): void {
    this.states.set(agentId, state);
    this.saveStates();
  }

  updateState(agentId: string, updates: Partial<AgentState>): void {
    const current = this.states.get(agentId);
    if (current) {
      const updated = { ...current, ...updates };
      this.states.set(agentId, updated);
      this.saveStates();
    }
  }

  deleteState(agentId: string): void {
    this.states.delete(agentId);
    this.saveStates();
  }

  getAllStates(): AgentState[] {
    return Array.from(this.states.values());
  }

  getStatesByType(type: string): AgentState[] {
    return this.getAllStates().filter(s => s.type === type);
  }

  getActiveAgents(): AgentState[] {
    return this.getAllStates().filter(s => s.status === 'busy');
  }

  clearAllStates(): void {
    this.states.clear();
    this.saveStates();
  }
}
