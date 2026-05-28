/**
 * Audit Log Type Definitions
 * Track every action, approval, and result
 */

export enum AuditEventType {
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  APPROVAL = 'approval',
  REJECTION = 'rejection',
  FILE_CHANGE = 'file_change',
  COMMAND_EXECUTION = 'command_execution',
  ERROR = 'error',
  TRANSACTION_BEGIN = 'transaction_begin',
  TRANSACTION_COMMIT = 'transaction_commit',
  TRANSACTION_ROLLBACK = 'transaction_rollback',
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  userId?: string;
  action: string;
  details: Record<string, any>;
  result?: {
    success: boolean;
    message?: string;
    duration?: number;
  };
  filesAffected?: string[];
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: number;
}

export interface ActionLog {
  id: string;
  toolId: string;
  parameters: Record<string, any>;
  result?: any;
  error?: string;
  duration: number;
  timestamp: number;
  approved: boolean;
}

export interface AuditLogger {
  log(entry: AuditEntry): void;
  logToolCall(toolId: string, parameters: Record<string, any>): string;
  logToolResult(callId: string, success: boolean, result?: any, error?: string): void;
  logApproval(actionId: string, approved: boolean, approvedBy?: string): void;
  logFileChange(filePath: string, changeType: string, details?: any): void;
  logCommandExecution(command: string, exitCode: number, output?: string): void;
  logError(error: Error, context?: any): void;
  getEntries(filter?: { eventType?: AuditEventType; startTime?: number; endTime?: number }): AuditEntry[];
  exportLog(format: 'json' | 'csv'): string;
  clearLog(): void;
}

export interface AuditViewer {
  displayLog(entries: AuditEntry[]): void;
  showLogPanel(): void;
  filterByEventType(eventType: AuditEventType): AuditEntry[];
  filterByTimeRange(startTime: number, endTime: number): AuditEntry[];
  searchLog(query: string): AuditEntry[];
  exportLog(format: 'json' | 'csv'): Promise<void>;
}