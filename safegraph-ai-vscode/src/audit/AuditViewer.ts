/**
 * Audit Viewer - Display audit log in VS Code sidebar
 */

import * as vscode from 'vscode';
import { AuditEntry, AuditEventType, AuditViewer as IAuditViewer } from '../types/AuditLog';
import { AuditLogger } from './AuditLogger';

export class AuditViewer implements IAuditViewer {
  private auditLogger: AuditLogger;
  private panel: vscode.WebviewPanel | undefined;

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
  }

  displayLog(entries: AuditEntry[]): void {
    if (!this.panel) {
      this.showLogPanel();
    }

    if (this.panel) {
      const html = this.generateHtml(entries);
      this.panel.webview.html = html;
    }
  }

  showLogPanel(): void {
    this.panel = vscode.window.createWebviewPanel(
      'safegraph.auditLog',
      'SafeGraph Audit Log',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    const entries = this.auditLogger.getEntries();
    const html = this.generateHtml(entries);
    this.panel.webview.html = html;

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  filterByEventType(eventType: AuditEventType): AuditEntry[] {
    return this.auditLogger.getEntries({ eventType });
  }

  filterByTimeRange(startTime: number, endTime: number): AuditEntry[] {
    return this.auditLogger.getEntries({ startTime, endTime });
  }

  searchLog(query: string): AuditEntry[] {
    const entries = this.auditLogger.getEntries();
    const lowerQuery = query.toLowerCase();
    return entries.filter(
      entry =>
        entry.action.toLowerCase().includes(lowerQuery) ||
        JSON.stringify(entry.details).toLowerCase().includes(lowerQuery)
    );
  }

  async exportLog(format: 'json' | 'csv'): Promise<void> {
    const content = this.auditLogger.exportLog(format);
    const ext = format === 'json' ? 'json' : 'csv';
    const fileName = `audit_${Date.now()}.${ext}`;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      filters: { [format.toUpperCase()]: [ext] },
    });

    if (uri) {
      const fs = await import('fs');
      fs.writeFileSync(uri.fsPath, content);
      vscode.window.showInformationMessage(`Audit log exported to ${uri.fsPath}`);
    }
  }

  private generateHtml(entries: AuditEntry[]): string {
    const eventTypeColors: Record<AuditEventType, string> = {
      [AuditEventType.TOOL_CALL]: '#0078D4',
      [AuditEventType.TOOL_RESULT]: '#107C10',
      [AuditEventType.APPROVAL]: '#107C10',
      [AuditEventType.REJECTION]: '#E81123',
      [AuditEventType.FILE_CHANGE]: '#FFB900',
      [AuditEventType.COMMAND_EXECUTION]: '#0078D4',
      [AuditEventType.ERROR]: '#E81123',
      [AuditEventType.TRANSACTION_BEGIN]: '#0078D4',
      [AuditEventType.TRANSACTION_COMMIT]: '#107C10',
      [AuditEventType.TRANSACTION_ROLLBACK]: '#E81123',
    };

    const rows = entries
      .slice(-100) // Show last 100 entries
      .reverse()
      .map(entry => {
        const color = eventTypeColors[entry.eventType];
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const success = entry.result?.success ? '✓' : '✗';
        return `
      <tr>
        <td style="color: ${color}; font-weight: bold;">${entry.eventType}</td>
        <td>${entry.action}</td>
        <td>${time}</td>
        <td>${success}</td>
      </tr>
    `;
      })
      .join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 16px;
          background: #1e1e1e;
          color: #d4d4d4;
        }
        h2 {
          margin-top: 0;
          color: #4ec9b0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        th {
          background: #252526;
          padding: 8px;
          text-align: left;
          border-bottom: 1px solid #3e3e42;
          font-weight: 600;
        }
        td {
          padding: 8px;
          border-bottom: 1px solid #3e3e42;
        }
        tr:hover {
          background: #2d2d30;
        }
        .controls {
          margin-bottom: 16px;
          display: flex;
          gap: 8px;
        }
        button {
          padding: 6px 12px;
          background: #0078d4;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        button:hover {
          background: #106ebe;
        }
      </style>
    </head>
    <body>
      <h2>📋 Audit Log</h2>
      <div class="controls">
        <button onclick="location.reload()">Refresh</button>
        <button onclick="alert('Export feature coming soon')">Export</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Action</th>
            <th>Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="4" style="text-align: center; color: #858585;">No audit entries yet</td></tr>'}
        </tbody>
      </table>
    </body>
    </html>
    `;
  }
}