/**
 * History Integration Tests
 * Verifies that History System correctly tracks autonomous tasks
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { HistoryManager } from './HistoryManager';

describe('History System Integration', () => {
  let tempDir: string;
  let manager: HistoryManager;

  beforeAll(() => {
    // Create temporary directory for tests
    tempDir = path.join(__dirname, '.test-history-' + Date.now());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  beforeEach(() => {
    manager = new HistoryManager(tempDir);
  });

  describe('Task Lifecycle', () => {
    it('should start a task and return task ID', () => {
      const taskId = manager.startTask('Test Task', 'Test Description');
      assert.ok(taskId, 'Task ID should be returned');
      assert.match(taskId, /^task_/, 'Task ID should start with task_');
    });

    it('should log actions within a task', () => {
      manager.startTask('Test Task', 'Test Description');
      manager.logAction('Create file', 'file_create', 'console.log("hello");', 0, 'File created');
      
      const entries = manager.queryHistory({ limit: 100 });
      const actionEntry = entries.find(e => e.type === 'ACTION');
      assert.ok(actionEntry, 'Action should be logged');
      assert.strictEqual(actionEntry?.actions?.[0].type, 'file_create');
    });

    it('should log tool evidence within a task', () => {
      manager.startTask('Tool Task', 'Test tool memory');
      manager.logAction('Tool evidence: safegraph__read_file {"path":"src/app.ts"}', 'tool', 'summary');

      const entries = manager.queryHistory({ limit: 100 });
      const toolEntry = entries.find(e => e.type === 'ACTION' && e.actions?.[0].type === 'tool');
      assert.ok(toolEntry, 'Tool evidence should be logged');
      assert.strictEqual(toolEntry?.actions?.[0].content, 'summary');
    });

    it('should log verification results', () => {
      manager.startTask('Test Task', 'Test Description');
      manager.logVerification(true, 'All tests passed');
      
      const entries = manager.queryHistory({ limit: 100 });
      const verifyEntry = entries.find(e => e.type === 'VERIFICATION');
      assert.ok(verifyEntry, 'Verification should be logged');
      assert.strictEqual(verifyEntry?.verification?.passed, true);
    });

    it('should complete a task with summary', () => {
      manager.startTask('Test Task', 'Test Description');
      manager.logAction('Do something', 'command', 'echo test', 0, 'Done');
      manager.completeTask('Task completed successfully', true);
      
      const entries = manager.queryHistory({ status: 'completed', limit: 100 });
      assert.ok(entries.length > 0, 'Completed task should be queryable');
      const completeEntry = entries.find(e => e.type === 'TASK_COMPLETE');
      assert.notStrictEqual(completeEntry?.duration, undefined, 'Duration should be recorded');
    });
  });

  describe('Storage Persistence', () => {
    it('should persist entries to disk', () => {
      manager.startTask('Persist Test', 'Test persistence');
      manager.logAction('Test action', 'command', 'test', 0, 'output');
      manager.completeTask('Done', true);
      
      // Create new manager instance to verify persistence
      const newManager = new HistoryManager(tempDir);
      const entries = newManager.queryHistory({ limit: 100 });
      assert.ok(entries.length > 0, 'Entries should persist across instances');
    });

    it('should create index.json file', () => {
      manager.startTask('Index Test', 'Test index creation');
      manager.completeTask('Done', true);
      
      const indexPath = path.join(tempDir, 'index.json');
      assert.ok(fs.existsSync(indexPath), 'index.json should be created');
      
      const indexContent = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      assert.ok(Object.keys(indexContent).length > 0, 'Index should contain entries');
    });

    it('should create daily log files', () => {
      manager.startTask('Log File Test', 'Test log file creation');
      manager.completeTask('Done', true);
      
      const files = fs.readdirSync(tempDir);
      const logFiles = files.filter(f => f.startsWith('history_') && f.endsWith('.jsonl'));
      assert.ok(logFiles.length > 0, 'Daily log file should be created');
    });
  });

  describe('Querying', () => {
    beforeEach(() => {
      // Create multiple tasks
      manager.startTask('Task 1', 'First task');
      manager.logAction('Action 1', 'command', 'cmd1', 0, 'output1');
      manager.completeTask('Completed task 1', true);

      manager.startTask('Task 2', 'Second task');
      manager.logAction('Action 2', 'diff', 'diff content', 0, 'output2');
      manager.completeTask('Completed task 2', false);
    });

    it('should query by status', () => {
      const completed = manager.queryHistory({ status: 'completed', limit: 100 });
      assert.ok(completed.length > 0, 'Should find completed tasks');
    });

    it('should query by type', () => {
      const actions = manager.queryHistory({ type: 'ACTION', limit: 100 });
      assert.ok(actions.length > 0, 'Should find action entries');
    });

    it('should search by text', () => {
      const results = manager.queryHistory({ search: 'Task 1', limit: 100 });
      assert.ok(results.length > 0, 'Should find entries by search');
    });

    it('should support pagination', () => {
      const page1 = manager.queryHistory({ limit: 1, offset: 0 });
      const page2 = manager.queryHistory({ limit: 1, offset: 1 });
      assert.notStrictEqual(page1[0]?.id, page2[0]?.id, 'Pagination should work');
    });
  });

  describe('Export', () => {
    it('should export to JSON', () => {
      manager.startTask('Export Test', 'Test export');
      manager.completeTask('Done', true);
      
      const json = manager.exportHistory('json');
      const parsed = JSON.parse(json);
      assert.ok(Array.isArray(parsed), 'JSON export should be array');
      assert.ok(parsed.length > 0, 'JSON should contain entries');
    });

    it('should export to CSV', () => {
      manager.startTask('Export Test', 'Test export');
      manager.completeTask('Done', true);
      
      const csv = manager.exportHistory('csv');
      assert.ok(csv.includes('ID'), 'CSV should have headers');
      assert.ok(csv.includes('task_'), 'CSV should contain task IDs');
    });
  });
});
