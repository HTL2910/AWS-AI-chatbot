/**
 * Transaction Engine - Safe file operations with rollback
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Transaction,
  Operation,
  OperationType,
  TransactionEngine as ITransactionEngine,
} from '../types/Transaction';

export class TransactionEngine implements ITransactionEngine {
  private transactions: Map<string, Transaction> = new Map();
  private history: Transaction[] = [];
  private backupDir: string;

  constructor(backupDir: string = '.safegraph-backups') {
    this.backupDir = backupDir;
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  beginTransaction(): Transaction {
    const transaction: Transaction = {
      id: this.generateId(),
      operations: [],
      status: 'pending',
      startTime: Date.now(),
      backupDir: path.join(this.backupDir, `tx_${Date.now()}`),
    };

    if (transaction.backupDir) {
      fs.mkdirSync(transaction.backupDir, { recursive: true });
    }
    this.transactions.set(transaction.id, transaction);

    return transaction;
  }

  addOperation(transaction: Transaction, operation: Operation): void {
    if (transaction.status !== 'pending') {
      throw new Error(`Cannot add operation to transaction in ${transaction.status} state`);
    }

    operation.id = this.generateId();
    operation.timestamp = Date.now();
    operation.status = 'pending';

    // Backup original content if file exists
    if (fs.existsSync(operation.filePath)) {
      try {
        operation.originalContent = fs.readFileSync(operation.filePath, 'utf-8');
        const backupPath = path.join(transaction.backupDir!, path.basename(operation.filePath));
        fs.writeFileSync(backupPath, operation.originalContent);
      } catch (error) {
        console.error(`Error backing up ${operation.filePath}:`, error);
      }
    }

    transaction.operations.push(operation);
  }

  async commit(transaction: Transaction): Promise<boolean> {
    if (transaction.status !== 'pending') {
      throw new Error(`Cannot commit transaction in ${transaction.status} state`);
    }

    transaction.status = 'in_progress';

    try {
      for (const operation of transaction.operations) {
        await this.executeOperation(operation);
        operation.status = 'completed';
      }

      transaction.status = 'committed';
      transaction.endTime = Date.now();
      this.history.push(transaction);

      return true;
    } catch (error) {
      transaction.status = 'failed';
      transaction.error = String(error);
      transaction.endTime = Date.now();

      // Rollback on failure
      await this.rollback(transaction);

      return false;
    }
  }

  async rollback(transaction: Transaction): Promise<boolean> {
    if (transaction.status === 'rolled_back') {
      return true;
    }

    try {
      // Rollback in reverse order
      for (let i = transaction.operations.length - 1; i >= 0; i--) {
        const operation = transaction.operations[i];
        if (operation.status === 'completed') {
          await this.undoOperation(operation, transaction);
        }
      }

      transaction.status = 'rolled_back';
      transaction.endTime = Date.now();
      this.history.push(transaction);

      // Cleanup backup
      if (transaction.backupDir && fs.existsSync(transaction.backupDir)) {
        fs.rmSync(transaction.backupDir, { recursive: true });
      }

      return true;
    } catch (error) {
      console.error('Error during rollback:', error);
      return false;
    }
  }

  private async executeOperation(operation: Operation): Promise<void> {
    switch (operation.type) {
      case OperationType.CREATE:
        this.createFile(operation);
        break;
      case OperationType.UPDATE:
        this.updateFile(operation);
        break;
      case OperationType.DELETE:
        this.deleteFile(operation);
        break;
      case OperationType.MOVE:
        this.moveFile(operation);
        break;
      case OperationType.BACKUP:
        this.backupFile(operation);
        break;
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  private createFile(operation: Operation): void {
    const dir = path.dirname(operation.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(operation.filePath, operation.content || '');
  }

  private updateFile(operation: Operation): void {
    if (!fs.existsSync(operation.filePath)) {
      throw new Error(`File not found: ${operation.filePath}`);
    }
    fs.writeFileSync(operation.filePath, operation.content || '');
  }

  private deleteFile(operation: Operation): void {
    if (fs.existsSync(operation.filePath)) {
      fs.unlinkSync(operation.filePath);
    }
  }

  private moveFile(operation: Operation): void {
    if (!fs.existsSync(operation.filePath)) {
      throw new Error(`File not found: ${operation.filePath}`);
    }
    const newPath = operation.newPath;
    if (!newPath) {
      throw new Error('Move operation requires newPath');
    }
    const dir = path.dirname(newPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.renameSync(operation.filePath, newPath);
  }

  private backupFile(operation: Operation): void {
    if (!fs.existsSync(operation.filePath)) {
      throw new Error(`File not found: ${operation.filePath}`);
    }
    const content = fs.readFileSync(operation.filePath, 'utf-8');
    const backupPath = operation.newPath;
    if (!backupPath) {
      throw new Error('Backup operation requires newPath');
    }
    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(backupPath, content);
  }

  private async undoOperation(operation: Operation, transaction: Transaction): Promise<void> {
    switch (operation.type) {
      case OperationType.CREATE:
        if (fs.existsSync(operation.filePath)) {
          fs.unlinkSync(operation.filePath);
        }
        break;
      case OperationType.UPDATE:
      case OperationType.DELETE:
        if (operation.originalContent !== undefined) {
          fs.writeFileSync(operation.filePath, operation.originalContent);
        }
        break;
      case OperationType.MOVE:
        if (operation.newPath && fs.existsSync(operation.newPath)) {
          fs.renameSync(operation.newPath, operation.filePath);
        }
        break;
      case OperationType.BACKUP:
        if (operation.newPath && fs.existsSync(operation.newPath)) {
          fs.unlinkSync(operation.newPath);
        }
        break;
    }
    operation.status = 'rolled_back';
  }

  getTransaction(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  getHistory(): Transaction[] {
    return [...this.history];
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
