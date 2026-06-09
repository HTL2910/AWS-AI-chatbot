/**
 * Batch Operator
 * Performs batch operations across multiple files
 */

import * as vscode from 'vscode';
import { MultiFileEditor, MultiFileEdit, TextEdit } from './MultiFileEditor';

export interface BatchOperation {
  name: string;
  description: string;
  apply: (filePath: string) => Promise<TextEdit[]>;
}

export class BatchOperator {
  private output: vscode.OutputChannel;
  private operations: Map<string, BatchOperation> = new Map();

  constructor(output: vscode.OutputChannel) {
    this.output = output;
    this.registerDefaultOperations();
  }

  private registerDefaultOperations(): void {
    // Register common batch operations
    this.registerOperation('remove-console-logs', {
      name: 'Remove Console Logs',
      description: 'Remove all console.log statements',
      apply: async (filePath: string) => {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const edits: TextEdit[] = [];
        const lines = document.getText().split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().match(/^console\.(log|warn|error|info|debug)\(/)) {
            edits.push({
              range: new vscode.Range(i, 0, i, line.length),
              newText: ''
            });
          }
        }

        return edits;
      }
    });

    this.registerOperation('add-jsdoc', {
      name: 'Add JSDoc Comments',
      description: 'Add JSDoc comments to functions',
      apply: async (filePath: string) => {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const edits: TextEdit[] = [];
        const lines = document.getText().split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const funcMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
          if (funcMatch) {
            const jsdoc = `/**
 * ${funcMatch[1]}
 * @param {${this.inferParamTypes(funcMatch[2])}} ${this.extractParamNames(funcMatch[2]).join(', ')}
 * @returns {any}
 */\n`;
            edits.push({
              range: new vscode.Range(i, 0, i, 0),
              newText: jsdoc
            });
          }
        }

        return edits;
      }
    });

    this.registerOperation('format-imports', {
      name: 'Format Imports',
      description: 'Sort and organize import statements',
      apply: async (filePath: string) => {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const edits: TextEdit[] = [];
        const lines = document.getText().split('\n');

        const imports: string[] = [];
        let importStart = -1;
        let importEnd = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().startsWith('import ')) {
            if (importStart === -1) importStart = i;
            importEnd = i;
            imports.push(line);
          } else if (importStart !== -1 && !line.trim()) {
            break;
          }
        }

        if (imports.length > 0) {
          // Sort imports
          imports.sort();
          
          // Replace the import block
          const importText = imports.join('\n');
          edits.push({
            range: new vscode.Range(importStart, 0, importEnd, lines[importEnd].length),
            newText: importText
          });
        }

        return edits;
      }
    });
  }

  public registerOperation(id: string, operation: BatchOperation): void {
    this.operations.set(id, operation);
    this.output.appendLine(`[BatchOperator] Registered operation: ${operation.name}`);
  }

  public async executeOperation(
    operationId: string,
    filePattern: string
  ): Promise<boolean> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      this.output.appendLine(`[BatchOperator] Operation not found: ${operationId}`);
      return false;
    }

    this.output.appendLine(`[BatchOperator] Executing: ${operation.name}`);

    const files = await vscode.workspace.findFiles(filePattern, '**/{node_modules,dist,build}/**');
    const edits: MultiFileEdit[] = [];

    for (const file of files) {
      try {
        const fileEdits = await operation.apply(file.fsPath);
        if (fileEdits.length > 0) {
          edits.push({
            filePath: file.fsPath,
            edits: fileEdits,
            reason: operation.description
          });
        }
      } catch (error) {
        this.output.appendLine(`[BatchOperator] Error on ${file.fsPath}: ${error}`);
      }
    }

    if (edits.length === 0) {
      this.output.appendLine('[BatchOperator] No edits to apply');
      return true;
    }

    // Apply all edits
    const multiFileEditor = new MultiFileEditor(this.output);
    return await multiFileEditor.applyMultiFileEdits(edits);
  }

  public listOperations(): BatchOperation[] {
    return Array.from(this.operations.values());
  }

  private inferParamTypes(params: string): string {
    // Simple type inference
    if (!params) return 'void';
    const paramNames = this.extractParamNames(params);
    return paramNames.map(() => 'any').join(', ');
  }

  private extractParamNames(params: string): string[] {
    if (!params) return [];
    return params.split(',').map(p => p.trim().split(':')[0].split('=').map(s => s.trim())[0]);
  }
}
