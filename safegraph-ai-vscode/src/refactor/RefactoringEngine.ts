/**
 * Refactoring Engine - Apply automated refactoring patterns
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RefactoringAction {
  id: string;
  type: 'extract_function' | 'extract_class' | 'rename' | 'move' | 'inline' | 'simplify' | 'consolidate';
  filePath: string;
  lineNumber: number;
  endLineNumber?: number;
  oldCode: string;
  newCode: string;
  description: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  affectedFiles?: string[];
}

export interface RefactoringResult {
  action: RefactoringAction;
  applied: boolean;
  error?: string;
  backupPath?: string;
  timestamp: number;
}

export class RefactoringEngine {
  private workspaceFolder: string;
  private results: RefactoringResult[] = [];
  private backupDir: string;

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
    this.backupDir = path.join(workspaceFolder, '.refactor-backups');
    this.ensureBackupDir();
  }

  /**
   * Extract function from code block
   */
  async extractFunction(
    filePath: string,
    startLine: number,
    endLine: number,
    functionName: string,
    parameters: string[] = []
  ): Promise<RefactoringAction> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Extract the code block
    const codeBlock = lines.slice(startLine - 1, endLine).join('\n');
    const indent = this.getIndentation(lines[startLine - 1]);

    // Generate new function
    const paramString = parameters.length > 0 ? parameters.join(', ') : '';
    const newFunction = `${indent}function ${functionName}(${paramString}) {\n${codeBlock}\n${indent}}\n`;

    // Generate call to new function
    const callString = `${indent}${functionName}(${parameters.join(', ')});`;

    // Build new code
    const newLines = [
      ...lines.slice(0, startLine - 1),
      callString,
      ...lines.slice(endLine),
    ];

    const newCode = newLines.join('\n');

    return {
      id: `extract_func_${startLine}_${endLine}`,
      type: 'extract_function',
      filePath,
      lineNumber: startLine,
      endLineNumber: endLine,
      oldCode: codeBlock,
      newCode: newFunction + '\n' + callString,
      description: `Extract function '${functionName}' from lines ${startLine}-${endLine}`,
      reason: 'Reduce code duplication and improve reusability',
      riskLevel: 'medium',
    };
  }

  /**
   * Rename function or variable
   */
  async rename(filePath: string, oldName: string, newName: string, lineNumber?: number): Promise<RefactoringAction> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find all occurrences
    const regex = new RegExp(`\\b${oldName}\\b`, 'g');
    const oldCode = content;
    const newCode = content.replace(regex, newName);

    const occurrences = (content.match(regex) || []).length;

    return {
      id: `rename_${oldName}_${newName}`,
      type: 'rename',
      filePath,
      lineNumber: lineNumber || 1,
      oldCode: oldName,
      newCode: newName,
      description: `Rename '${oldName}' to '${newName}' (${occurrences} occurrences)`,
      reason: 'Improve code clarity and naming consistency',
      riskLevel: 'high',
    };
  }

  /**
   * Inline function (replace calls with function body)
   */
  async inlineFunction(filePath: string, functionName: string): Promise<RefactoringAction> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find function definition
    const funcRegex = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+${functionName}\\s*(?:=\\s*)?(?:async\\s*)?\\(`, 'g');
    const match = funcRegex.exec(content);

    if (!match) {
      throw new Error(`Function '${functionName}' not found`);
    }

    const startLine = content.substring(0, match.index).split('\n').length;

    // Find function body
    let braceCount = 0;
    let endLine = startLine;
    let functionBody = '';

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
      }
      if (braceCount > 0) {
        functionBody += line + '\n';
      }
      if (braceCount === 0 && i > startLine - 1) {
        endLine = i + 1;
        break;
      }
    }

    return {
      id: `inline_${functionName}`,
      type: 'inline',
      filePath,
      lineNumber: startLine,
      endLineNumber: endLine,
      oldCode: functionBody,
      newCode: '',
      description: `Inline function '${functionName}'`,
      reason: 'Remove unnecessary function wrapper',
      riskLevel: 'high',
    };
  }

  /**
   * Simplify conditional logic
   */
  async simplifyConditional(filePath: string, lineNumber: number): Promise<RefactoringAction> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const line = lines[lineNumber - 1];

    // Detect patterns to simplify
    let oldCode = line;
    let newCode = line;

    // Pattern: if (condition) return true; else return false;
    if (line.includes('if') && line.includes('return true') && lines[lineNumber]?.includes('return false')) {
      const conditionMatch = line.match(/if\s*\(([^)]+)\)/);
      if (conditionMatch) {
        newCode = `return ${conditionMatch[1]};`;
      }
    }

    // Pattern: if (condition) { ... } else { ... } can be ternary
    if (line.includes('if') && !line.includes('else if')) {
      const conditionMatch = line.match(/if\s*\(([^)]+)\)/);
      if (conditionMatch) {
        newCode = `// Consider using ternary operator for this conditional`;
      }
    }

    return {
      id: `simplify_${lineNumber}`,
      type: 'simplify',
      filePath,
      lineNumber,
      oldCode,
      newCode,
      description: `Simplify conditional logic at line ${lineNumber}`,
      reason: 'Reduce code complexity and improve readability',
      riskLevel: 'low',
    };
  }

  /**
   * Consolidate similar methods
   */
  async consolidateMethods(
    filePath: string,
    methodNames: string[],
    consolidatedName: string
  ): Promise<RefactoringAction> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return {
      id: `consolidate_${methodNames.join('_')}`,
      type: 'consolidate',
      filePath,
      lineNumber: 1,
      oldCode: methodNames.join(', '),
      newCode: consolidatedName,
      description: `Consolidate methods [${methodNames.join(', ')}] into '${consolidatedName}'`,
      reason: 'Reduce code duplication and improve maintainability',
      riskLevel: 'high',
    };
  }

  /**
   * Apply refactoring action
   */
  async applyRefactoring(action: RefactoringAction): Promise<RefactoringResult> {
    try {
      if (!fs.existsSync(action.filePath)) {
        throw new Error(`File not found: ${action.filePath}`);
      }

      // Create backup
      const backupPath = await this.createBackup(action.filePath);

      // Read current content
      const content = fs.readFileSync(action.filePath, 'utf-8');
      const lines = content.split('\n');

      let newContent = content;

      // Apply refactoring based on type
      switch (action.type) {
        case 'rename':
          const regex = new RegExp(`\\b${action.oldCode}\\b`, 'g');
          newContent = content.replace(regex, action.newCode);
          break;

        case 'extract_function':
          // Replace old code with new code
          const startIdx = action.lineNumber - 1;
          const endIdx = action.endLineNumber || action.lineNumber;
          newContent = [
            ...lines.slice(0, startIdx),
            action.newCode,
            ...lines.slice(endIdx),
          ].join('\n');
          break;

        case 'simplify':
          lines[action.lineNumber - 1] = action.newCode;
          newContent = lines.join('\n');
          break;

        case 'inline':
          const inlineStart = action.lineNumber - 1;
          const inlineEnd = action.endLineNumber || action.lineNumber;
          newContent = [
            ...lines.slice(0, inlineStart),
            ...lines.slice(inlineEnd),
          ].join('\n');
          break;

        default:
          throw new Error(`Unknown refactoring type: ${action.type}`);
      }

      // Write new content
      fs.writeFileSync(action.filePath, newContent, 'utf-8');

      const result: RefactoringResult = {
        action,
        applied: true,
        backupPath,
        timestamp: Date.now(),
      };

      this.results.push(result);
      return result;
    } catch (error) {
      const result: RefactoringResult = {
        action,
        applied: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };

      this.results.push(result);
      return result;
    }
  }

  /**
   * Rollback refactoring
   */
  async rollback(backupPath: string, targetPath: string): Promise<void> {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    const backupContent = fs.readFileSync(backupPath, 'utf-8');
    fs.writeFileSync(targetPath, backupContent, 'utf-8');
  }

  /**
   * Create backup of file
   */
  private async createBackup(filePath: string): Promise<string> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const timestamp = Date.now();
    const backupPath = path.join(this.backupDir, `${fileName}.${timestamp}.bak`);

    fs.writeFileSync(backupPath, content, 'utf-8');
    return backupPath;
  }

  /**
   * Ensure backup directory exists
   */
  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Get indentation of a line
   */
  private getIndentation(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  /**
   * Get results
   */
  getResults(): RefactoringResult[] {
    return this.results;
  }

  /**
   * Get summary
   */
  getSummary(): {
    totalActions: number;
    applied: number;
    failed: number;
    actionsByType: Record<string, number>;
  } {
    let applied = 0;
    let failed = 0;
    const actionsByType: Record<string, number> = {};

    for (const result of this.results) {
      if (result.applied) {
        applied++;
      } else {
        failed++;
      }

      const type = result.action.type;
      actionsByType[type] = (actionsByType[type] || 0) + 1;
    }

    return {
      totalActions: this.results.length,
      applied,
      failed,
      actionsByType,
    };
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }
}
