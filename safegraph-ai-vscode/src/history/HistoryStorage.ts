/**
 * History Storage - Persistent storage for autonomous tasks and audit logs
 * Stores complete task history with plan, actions, results, and metadata
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TaskHistoryEntry {
  id: string;
  taskId: string;
  timestamp: number;
  type: 'TASK_START' | 'TASK_COMPLETE' | 'TASK_FAILED' | 'ACTION' | 'VERIFICATION' | 'SUMMARY';
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  plan?: string;
  actions?: Array<{
    type: 'diff' | 'command' | 'file_create' | 'file_delete';
    description: string;
    content?: string;
    exitCode?: number;
    output?: string;
  }>;
  verification?: {
    passed: boolean;
    details: string;
  };
  summary?: string;
  duration?: number; // milliseconds
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface HistoryQuery {
  startTime?: number;
  endTime?: number;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  type?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export class HistoryStorage {
  private historyDir: string;
  private indexFile: string;
  private entries: Map<string, TaskHistoryEntry> = new Map();
  private maxEntriesPerFile: number = 1000;

  constructor(historyDir: string = '.safegraph-history') {
    this.historyDir = historyDir;
    this.indexFile = path.join(historyDir, 'index.json');
    this.ensureHistoryDir();
    this.loadIndex();
  }

  private ensureHistoryDir(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexFile)) {
        const indexData = fs.readFileSync(this.indexFile, 'utf-8');
        const index = JSON.parse(indexData);
        // Load entries from index
        Object.entries(index).forEach(([id, entry]) => {
          this.entries.set(id, entry as TaskHistoryEntry);
        });
      }
    } catch (error) {
      console.error('Error loading history index:', error);
    }
  }

  private saveIndex(): void {
    try {
      const index: Record<string, TaskHistoryEntry> = {};
      this.entries.forEach((entry, id) => {
        index[id] = entry;
      });
      fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2));
    } catch (error) {
      console.error('Error saving history index:', error);
    }
  }

  addEntry(entry: Omit<TaskHistoryEntry, 'id' | 'timestamp'>): string {
    const id = this.generateId();
    const fullEntry: TaskHistoryEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    };

    this.entries.set(id, fullEntry);
    this.saveIndex();
    this.persistEntry(fullEntry);

    return id;
  }

  updateEntry(id: string, updates: Partial<TaskHistoryEntry>): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const updated = { ...entry, ...updates, id: entry.id, timestamp: entry.timestamp };
    this.entries.set(id, updated);
    this.saveIndex();
    this.persistEntry(updated);

    return true;
  }

  getEntry(id: string): TaskHistoryEntry | undefined {
    return this.entries.get(id);
  }

  query(filter: HistoryQuery): TaskHistoryEntry[] {
    let results = Array.from(this.entries.values());

    // Filter by time range
    if (filter.startTime) {
      results = results.filter(e => e.timestamp >= filter.startTime!);
    }
    if (filter.endTime) {
      results = results.filter(e => e.timestamp <= filter.endTime!);
    }

    // Filter by status
    if (filter.status) {
      results = results.filter(e => e.status === filter.status);
    }

    // Filter by type
    if (filter.type) {
      results = results.filter(e => e.type === filter.type);
    }

    // Filter by tags
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(e =>
        filter.tags!.some(tag => e.tags?.includes(tag))
      );
    }

    // Search in title, description, summary
    if (filter.search) {
      const query = filter.search.toLowerCase();
      results = results.filter(e =>
        e.title.toLowerCase().includes(query) ||
        e.description?.toLowerCase().includes(query) ||
        e.summary?.toLowerCase().includes(query)
      );
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    // Pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    return results.slice(offset, offset + limit);
  }

  getTaskHistory(taskId: string): TaskHistoryEntry[] {
    return Array.from(this.entries.values())
      .filter(e => e.taskId === taskId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  exportHistory(format: 'json' | 'csv'): string {
    const entries = Array.from(this.entries.values());

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV format
    const headers = ['ID', 'TaskID', 'Timestamp', 'Type', 'Title', 'Status', 'Duration'];
    const rows = entries.map(e => [
      e.id,
      e.taskId,
      new Date(e.timestamp).toISOString(),
      e.type,
      e.title,
      e.status,
      e.duration || '-',
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    return csv;
  }

  private persistEntry(entry: TaskHistoryEntry): void {
    try {
      const fileName = `history_${Math.floor(entry.timestamp / 86400000)}.jsonl`;
      const filePath = path.join(this.historyDir, fileName);
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(filePath, line);
    } catch (error) {
      console.error('Error persisting history entry:', error);
    }
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
