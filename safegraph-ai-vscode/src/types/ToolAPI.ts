/**
 * Tool API Type Definitions
 * Structured tool calls replacing text-based chat
 */

export enum ToolType {
  CODE_ANALYZER = 'code_analyzer',
  FILE_MANAGER = 'file_manager',
  TERMINAL_EXECUTOR = 'terminal_executor',
  WEB_RESEARCH = 'web_research',
  DIFF_APPLIER = 'diff_applier',
  CONTEXT_RESOLVER = 'context_resolver',
  TASK_PLANNER = 'task_planner',
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  enum?: string[];
  default?: any;
}

export interface ToolDefinition {
  id: string;
  type: ToolType;
  name: string;
  description: string;
  parameters: ToolParameter[];
  category: 'analysis' | 'execution' | 'research' | 'planning' | 'apply';
  timeout?: number; // milliseconds
  requiresApproval?: boolean;
}

export interface ToolCall {
  id: string;
  toolId: string;
  toolType: ToolType;
  parameters: Record<string, any>;
  timestamp: number;
  context?: {
    targetFolder?: string;
    activeFile?: string;
    selectedText?: string;
    mode?: string;
  };
}

export interface ToolResult {
  callId: string;
  toolId: string;
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  duration: number; // milliseconds
  timestamp: number;
}

export interface ToolExecutionContext {
  workspaceFolder: string;
  activeFile?: string;
  selectedText?: string;
  targetFolder?: string;
  mode?: string;
  auditLog?: boolean;
  requiresApproval?: boolean;
}

export interface ToolResponse {
  toolCall: ToolCall;
  result: ToolResult;
  nextSteps?: string[];
  suggestions?: string[];
}

export interface ToolRegistry {
  register(definition: ToolDefinition): void;
  unregister(toolId: string): void;
  get(toolId: string): ToolDefinition | undefined;
  getAll(): ToolDefinition[];
  getByType(type: ToolType): ToolDefinition[];
  validate(call: ToolCall): { valid: boolean; errors: string[] };
}

export interface ToolExecutor {
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
  canExecute(call: ToolCall): boolean;
  getTimeout(toolId: string): number;
}

export interface ToolChain {
  addCall(call: ToolCall): void;
  execute(context: ToolExecutionContext): Promise<ToolResponse[]>;
  rollback(callId: string): Promise<boolean>;
  getHistory(): ToolCall[];
  getResults(): ToolResult[];
}

// Tool-specific parameter types

export interface CodeAnalysisParams {
  filePath: string;
  analysisType: 'refactor' | 'security' | 'performance' | 'style' | 'all';
  language?: string;
}

export interface FileOperationParams {
  operation: 'create' | 'read' | 'update' | 'delete' | 'move';
  filePath: string;
  content?: string;
  newPath?: string;
  createBackup?: boolean;
}

export interface TerminalCommandParams {
  command: string;
  cwd?: string;
  timeout?: number;
  captureOutput?: boolean;
  shell?: string;
}

export interface WebResearchParams {
  seedUrl: string;
  maxPages?: number;
  followLinks?: boolean;
  parseMarkdown?: boolean;
  cacheResults?: boolean;
}

export interface DiffApplyParams {
  diffContent: string;
  targetFile: string;
  dryRun?: boolean;
  createBackup?: boolean;
  autoResolveConflicts?: boolean;
}

export interface ContextResolverParams {
  detectGitRepo?: boolean;
  detectTargetFolder?: boolean;
  indexFiles?: boolean;
  maxFileCount?: number;
}

export interface TaskPlannerParams {
  userRequest: string;
  context?: ToolExecutionContext;
  mode?: string;
}
