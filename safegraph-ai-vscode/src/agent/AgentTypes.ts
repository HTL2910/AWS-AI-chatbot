/**
 * Agent Type Definitions
 * Defines specialized agent types and their capabilities
 */

export type AgentType = 'planner' | 'coder' | 'tester' | 'reviewer' | 'debugger' | 'architect';

export interface AgentCapability {
  name: string;
  description: string;
  enabled: boolean;
}

export interface AgentConfig {
  id: string;
  type: AgentType;
  name: string;
  capabilities: AgentCapability[];
  maxConcurrentTasks: number;
  priority: number;
}

export interface AgentState {
  id: string;
  type: AgentType;
  status: 'idle' | 'busy' | 'paused' | 'error';
  currentTask?: string;
  completedTasks: string[];
  failedTasks: string[];
  lastActivity: number;
  metrics: AgentMetrics;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDuration: number;
  totalTokensUsed: number;
  successRate: number;
}

export interface AgentMessage {
  from: string;
  to: string;
  type: 'request' | 'response' | 'notification' | 'error';
  content: any;
  timestamp: number;
  correlationId?: string;
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  planner: {
    id: 'agent-planner',
    type: 'planner',
    name: 'Task Planner Agent',
    capabilities: [
      { name: 'task_breakdown', description: 'Break down complex tasks into subtasks', enabled: true },
      { name: 'dependency_analysis', description: 'Analyze task dependencies', enabled: true },
      { name: 'risk_assessment', description: 'Assess task risks', enabled: true },
      { name: 'resource_estimation', description: 'Estimate required resources', enabled: true }
    ],
    maxConcurrentTasks: 3,
    priority: 1
  },
  coder: {
    id: 'agent-coder',
    type: 'coder',
    name: 'Code Generation Agent',
    capabilities: [
      { name: 'code_generation', description: 'Generate code from specifications', enabled: true },
      { name: 'refactoring', description: 'Refactor existing code', enabled: true },
      { name: 'multi_file_edit', description: 'Edit multiple files coherently', enabled: true },
      { name: 'code_review', description: 'Review code for quality', enabled: true }
    ],
    maxConcurrentTasks: 5,
    priority: 2
  },
  tester: {
    id: 'agent-tester',
    type: 'tester',
    name: 'Testing Agent',
    capabilities: [
      { name: 'test_generation', description: 'Generate unit and integration tests', enabled: true },
      { name: 'test_execution', description: 'Execute tests and report results', enabled: true },
      { name: 'coverage_analysis', description: 'Analyze test coverage', enabled: true },
      { name: 'bug_reproduction', description: 'Reproduce reported bugs', enabled: true }
    ],
    maxConcurrentTasks: 4,
    priority: 3
  },
  reviewer: {
    id: 'agent-reviewer',
    type: 'reviewer',
    name: 'Code Review Agent',
    capabilities: [
      { name: 'security_review', description: 'Review for security issues', enabled: true },
      { name: 'performance_review', description: 'Review for performance issues', enabled: true },
      { name: 'style_review', description: 'Review for code style consistency', enabled: true },
      { name: 'best_practices', description: 'Review against best practices', enabled: true }
    ],
    maxConcurrentTasks: 3,
    priority: 4
  },
  debugger: {
    id: 'agent-debugger',
    type: 'debugger',
    name: 'Debugging Agent',
    capabilities: [
      { name: 'error_analysis', description: 'Analyze errors and stack traces', enabled: true },
      { name: 'root_cause', description: 'Identify root causes of issues', enabled: true },
      { name: 'fix_generation', description: 'Generate fixes for bugs', enabled: true },
      { name: 'log_analysis', description: 'Analyze logs for issues', enabled: true }
    ],
    maxConcurrentTasks: 2,
    priority: 5
  },
  architect: {
    id: 'agent-architect',
    type: 'architect',
    name: 'Architecture Agent',
    capabilities: [
      { name: 'architecture_analysis', description: 'Analyze system architecture', enabled: true },
      { name: 'design_patterns', description: 'Suggest design patterns', enabled: true },
      { name: 'dependency_mapping', description: 'Map system dependencies', enabled: true },
      { name: 'technical_debt', description: 'Identify technical debt', enabled: true }
    ],
    maxConcurrentTasks: 2,
    priority: 6
  }
};
