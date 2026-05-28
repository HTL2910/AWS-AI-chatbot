/**
 * Audit Logger - Log all actions, approvals, and results
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuditEntry, AuditEventType, AuditLogger as IAuditLogger } from '../types/AuditLog';

export class AuditLogger implements IAuditLogger {
  private entries: AuditEntry[] = [];
  private logFile: string;
  private maxEntries: number = 10000;

  constructor(logDir: string = '.safegraph-audit') {
    this.logFile = path.join(logDir, `audit_${Date.now()}.log`);
    this.ensureLogDir(logDir);
  }

  private ensureLogDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log(entry: AuditEntry): void {
    entry.id = entry.id || this.generateId();
    entry.timestamp = entry.timestamp || Date.now();

    this.entries.push(entry);

    // Persist to file
    this.persistEntry(entry);

    // Cleanup old entries if exceeding max
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  logToolCall(toolId: string, parameters: Record<string, any>): string {
    const callId = this.generateId();
    const entry: AuditEntry = {
      id: callId,
      timestamp: Date.now(),
      eventType: AuditEventType.TOOL_CALL,
      action: `Tool call: ${toolId}`,
      details: { toolId, parameters },
    };
    this.log(entry);
    return callId;
  }

  logToolResult(callId: string, success: boolean, result?: any, error?: string): void {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.TOOL_RESULT,
      action: `Tool result: ${success ? 'success' : 'failure'}`,
      details: { callId, result, error },
      result: {
        success,
        message: error,
      },
    };
    this.log(entry);
  }

  logApproval(actionId: string, approved: boolean, approvedBy?: string): void {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: approved ? AuditEventType.APPROVAL : AuditEventType.REJECTION,
      action: `Action ${approved ? 'approved' : 'rejected'}: ${actionId}`,
      details: { actionId, approvedBy },
      approved,
      approvedBy,
      approvedAt: Date.now(),
    };
    this.log(entry);
  }

  logFileChange(filePath: string, changeType: string, details?: any): void {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.FILE_CHANGE,
      action: `File ${changeType}: ${filePath}`,
      details: details || {},
      filesAffected: [filePath],
    };
    this.log(entry);
  }

  logCommandExecution(command: string, exitCode: number, output?: string): void {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.COMMAND_EXECUTION,
      action: `Command executed: ${command}`,
      details: { command, exitCode, output },
      result: {
        success: exitCode === 0,
        message: `Exit code: ${exitCode}`,
      },
    };
    this.log(entry);
  }

  logError(error: Error, context?: any): void {
    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      eventType: AuditEventType.ERROR,
      action: `Error: ${error.message}`,
      details: { error: error.message, stack: error.stack, context },
      result: {
        success: false,
        message: error.message,
      },
    };
    this.log(entry);
  }

  getEntries(filter?: { eventType?: AuditEventType; startTime?: number; endTime?: number }): AuditEntry[] {
    if (!filter) return [...this.entries];

    return this.entries.filter(entry => {
      if (filter.eventType && entry.eventType !== filter.eventType) return false;
      if (filter.startTime && entry.timestamp < filter.startTime) return false;
      if (filter.endTime && entry.timestamp > filter.endTime) return false;
      return true;
    });
  }

  exportLog(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.entries, null, 2);
    }

    // CSV format
    const headers = ['ID', 'Timestamp', 'EventType', 'Action', 'Success', 'Details'];
    const rows = this.entries.map(entry => [
      entry.id,
      new Date(entry.timestamp).toISOString(),
      entry.eventType,
      entry.action,
      entry.result?.success ? 'Yes' : 'No',
      JSON.stringify(entry.details),
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    return csv;
  }

  clearLog(): void {
    this.entries = [];
  }

  private persistEntry(entry: AuditEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logFile, line);
    } catch (error) {
      console.error('Error persisting audit entry:', error);
    }
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}