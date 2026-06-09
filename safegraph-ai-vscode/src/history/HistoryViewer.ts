/**
 * History Viewer - Display task history in VS Code sidebar
 */

import * as vscode from 'vscode';
import { HistoryManager } from './HistoryManager';
import { TaskHistoryEntry } from './HistoryStorage';

export class HistoryViewer {
  private manager: HistoryManager;
  private panel: vscode.WebviewPanel | undefined;

  constructor(manager: HistoryManager) {
    this.manager = manager;
  }

  showHistoryPanel(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'safegraph.taskHistory',
        'SafeGraph Task History',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.refreshPanel();
  }

  private refreshPanel(): void {
    if (!this.panel) return;

    const entries = this.manager.queryHistory({
      limit: 100,
      offset: 0,
    });

    const html = this.generateHtml(entries);
    this.panel.webview.html = html;
  }

  private generateHtml(entries: TaskHistoryEntry[]): string {
    const statusColors: Record<string, string> = {
      completed: '#107C10',
      failed: '#E81123',
      in_progress: '#FFB900',
      pending: '#0078D4',
    };

    const typeIcons: Record<string, string> = {
      TASK_START: 'START',
      TASK_COMPLETE: 'DONE',
      TASK_FAILED: 'FAIL',
      ACTION: 'ACTION',
      VERIFICATION: '✓',
      SUMMARY: 'SUMMARY',
    };

    const esc = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const rows = entries
      .map(entry => {
        const color = statusColors[entry.status];
        const icon = typeIcons[entry.type] || '•';
        const time = new Date(entry.timestamp).toLocaleString();
        const duration = entry.duration ? `${Math.round(entry.duration / 1000)}s` : '-';
        const detailsId = `details_${esc(entry.id)}`;

        return `
      <tr onclick="toggleDetails('${detailsId}')" style="cursor: pointer;">
        <td style="color: ${color}; font-weight: bold;">${icon} ${esc(entry.type)}</td>
        <td>${esc(entry.title)}</td>
        <td>${esc(time)}</td>
        <td>${esc(duration)}</td>
      </tr>
      <tr id="${detailsId}" style="display: none;">
        <td colspan="4" style="padding: 12px; background: #252526; border-left: 3px solid ${color};">
          <div style="font-size: 12px; line-height: 1.6;">
            ${entry.description ? `<p><strong>Description:</strong> ${esc(entry.description)}</p>` : ''}
            ${entry.summary ? `<p><strong>Summary:</strong> ${esc(entry.summary)}</p>` : ''}
            ${entry.verification ? `<p><strong>Verification:</strong> <pre>${esc(entry.verification.details)}</pre></p>` : ''}
            ${entry.actions ? `<p><strong>Actions:</strong> ${entry.actions.length} action(s)</p>` : ''}
          </div>
        </td>
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
        .search-box {
          width: 100%;
          padding: 6px;
          background: #3c3c3c;
          color: #d4d4d4;
          border: 1px solid #3e3e42;
          border-radius: 4px;
          margin-bottom: 12px;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <h2>Task History</h2>
      <div class="controls">
        <input type="text" class="search-box" placeholder="Search tasks..." id="searchBox">
        <button onclick="location.reload()">Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Title</th>
            <th>Time</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="4" style="text-align: center; color: #858585;">No task history yet</td></tr>'}
        </tbody>
      </table>
      <script>
        function toggleDetails(id) {
          const elem = document.getElementById(id);
          if (!elem) return;
          elem.style.display = elem.style.display === 'none' ? 'table-row' : 'none';
        }
      </script>
    </body>
    </html>
    `;
  }
}
