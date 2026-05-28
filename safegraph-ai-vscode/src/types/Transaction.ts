/**
 * Transaction Type Definitions
 * Safe file operations with rollback capability
 */

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  MOVE = 'move',
  BACKUP = 'backup',
}

export interface Operation {
  id: string;
  type: OperationType;
  filePath: string;
  newPath?: string;
  content?: string;
  originalContent?: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed' | 'rolled_back';
  error?: string;
}

export interface Transaction {
  id: string;
  operations: Operation[];
  status: 'pending' | 'in_progress' | 'committed' | 'rolled_back' | 'failed';
  startTime: number;
  endTime?: number;
  error?: string;
  backupDir?: string;
}

export interface Rollback {
  transactionId: string;
  operationId: string;
  originalContent?: string;
  originalPath?: string;
  timestamp: number;
}

export interface TransactionEngine {
  beginTransaction(): Transaction;
  addOperation(transaction: Transaction, operation: Operation): void;
  commit(transaction: Transaction): Promise<boolean>;
  rollback(transaction: Transaction): Promise<boolean>;
  getTransaction(id: string): Transaction | undefined;
  getHistory(): Transaction[];
}

export interface DiffApplier {
  parseDiff(diffContent: string): Operation[];
  applyDiff(filePath: string, diffContent: string, dryRun?: boolean): Promise<boolean>;
  validateDiff(filePath: string, diffContent: string): { valid: boolean; errors: string[] };
}

export interface FileBackup {
  backupFile(filePath: string, backupDir: string): Promise<string>;
  restoreFile(filePath: string, backupPath: string): Promise<void>;
  cleanupBackups(backupDir: string): Promise<void>;
}

export interface ApplyUI {
  showDiffPreview(diffContent: string): Promise<boolean>;
  showApprovalDialog(operation: Operation): Promise<boolean>;
  showRollbackUI(transaction: Transaction): Promise<boolean>;
  showTransactionStatus(transaction: Transaction): void;
}
