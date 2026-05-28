/**
 * Task Planner Type Definitions
 * Structured plan, actions, verification, summary
 */

export interface ActionStep {
  id: string;
  description: string;
  toolId: string;
  parameters: Record<string, any>;
  dependencies?: string[]; // IDs of steps that must complete first
  optional?: boolean;
  timeout?: number;
}

export interface VerificationStep {
  id: string;
  description: string;
  type: 'command' | 'file_check' | 'output_validation' | 'manual';
  command?: string;
  filePath?: string;
  expectedOutput?: string;
  timeout?: number;
}

export interface TaskPlan {
  id: string;
  title: string;
  description: string;
  userRequest: string;
  mode?: string;
  targetFolder?: string;
  estimatedDuration?: number; // milliseconds
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  actions: ActionStep[];
  verifications: VerificationStep[];
  rollbackSteps?: ActionStep[];
  timestamp: number;
}

export interface TaskExecution {
  planId: string;
  startTime: number;
  endTime?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
  completedActions: string[]; // action IDs
  failedActions: string[];
  verificationResults: Map<string, boolean>;
  error?: {
    actionId: string;
    message: string;
    details?: string;
  };
}

export interface TaskSummary {
  planId: string;
  title: string;
  status: 'success' | 'partial' | 'failed';
  actionsCompleted: number;
  actionsFailed: number;
  verificationsCompleted: number;
  verificationsFailed: number;
  duration: number;
  filesChanged: string[];
  commandsExecuted: string[];
  errors: string[];
  nextSteps?: string[];
  recommendations?: string[];
}

export interface TaskPlanner {
  parseRequest(request: string, context?: any): Promise<TaskPlan>;
  validatePlan(plan: TaskPlan): { valid: boolean; errors: string[] };
  estimateDuration(plan: TaskPlan): number;
  assessRisk(plan: TaskPlan): 'low' | 'medium' | 'high';
}

export interface TaskExecutor {
  execute(plan: TaskPlan): Promise<TaskExecution>;
  executeAction(action: ActionStep): Promise<any>;
  rollback(execution: TaskExecution): Promise<boolean>;
  pause(): void;
  resume(): void;
  cancel(): void;
}

export interface VerificationEngine {
  runVerifications(steps: VerificationStep[]): Promise<Map<string, boolean>>;
  runVerification(step: VerificationStep): Promise<boolean>;
}

export interface TaskSummarizer {
  generateSummary(execution: TaskExecution, plan: TaskPlan): TaskSummary;
  formatSummary(summary: TaskSummary): string;
}
