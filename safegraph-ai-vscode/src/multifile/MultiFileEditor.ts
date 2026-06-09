/**
 * Multi-File Editor
 * Handles editing multiple files coherently
 */

import * as vscode from 'vscode';
import { DependencyGraph } from './DependencyGraph';
import { SymbolRenamer } from './SymbolRenamer';
import { ConflictResolver } from './ConflictResolver';

export interface MultiFileEdit {
  filePath: string;
  edits: TextEdit[];
  reason: string;
}

export interface TextEdit {
  range: vscode.Range;
  newText: string;
}

export class MultiFileEditor {
  private dependencyGraph: DependencyGraph;
  private symbolRenamer: SymbolRenamer;
  private conflictResolver: ConflictResolver;
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
    this.dependencyGraph = new DependencyGraph(output);
    this.symbolRenamer = new SymbolRenamer(output);
    this.conflictResolver = new ConflictResolver(output);
  }

  public async applyMultiFileEdits(edits: MultiFileEdit[]): Promise<boolean> {
    this.output.appendLine(`[MultiFileEditor] Applying ${edits.length} multi-file edits`);

    // Build dependency graph to understand relationships
    await this.dependencyGraph.buildGraph();

    // Sort edits based on dependencies
    const sortedEdits = this.sortEditsByDependencies(edits);

    // Apply edits in order
    for (const edit of sortedEdits) {
      try {
        await this.applySingleFileEdit(edit);
      } catch (error) {
        this.output.appendLine(`[MultiFileEditor] Failed to apply edit to ${edit.filePath}: ${error}`);
        return false;
      }
    }

    this.output.appendLine('[MultiFileEditor] All edits applied successfully');
    return true;
  }

  private async applySingleFileEdit(edit: MultiFileEdit): Promise<void> {
    const uri = vscode.Uri.file(edit.filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(uri);

    const editBuilder = new vscode.WorkspaceEdit();
    
    for (const textEdit of edit.edits) {
      editBuilder.replace(uri, textEdit.range, textEdit.newText);
    }

    await vscode.workspace.applyEdit(editBuilder);
    await document.save();
  }

  private sortEditsByDependencies(edits: MultiFileEdit[]): MultiFileEdit[] {
    // Sort edits based on file dependencies
    // Files that are depended on by others should be edited first
    const sorted = [...edits];
    
    sorted.sort((a, b) => {
      const aDeps = this.dependencyGraph.getDependents(a.filePath);
      const bDeps = this.dependencyGraph.getDependents(b.filePath);
      
      // Files with more dependents should be edited first
      return bDeps.length - aDeps.length;
    });

    return sorted;
  }

  public async renameSymbolAcrossFiles(
    symbolName: string,
    newName: string,
    scope?: string
  ): Promise<boolean> {
    this.output.appendLine(`[MultiFileEditor] Renaming symbol '${symbolName}' to '${newName}'`);

    return await this.symbolRenamer.renameSymbol(symbolName, newName, scope);
  }

  public async batchOperation(
    operation: (filePath: string) => Promise<TextEdit[]>,
    filePattern: string
  ): Promise<boolean> {
    this.output.appendLine(`[MultiFileEditor] Batch operation on pattern: ${filePattern}`);

    const files = await vscode.workspace.findFiles(filePattern, '**/node_modules/**');
    const edits: MultiFileEdit[] = [];

    for (const file of files) {
      try {
        const fileEdits = await operation(file.fsPath);
        if (fileEdits.length > 0) {
          edits.push({
            filePath: file.fsPath,
            edits: fileEdits,
            reason: 'Batch operation'
          });
        }
      } catch (error) {
        this.output.appendLine(`[MultiFileEditor] Batch operation failed on ${file.fsPath}: ${error}`);
      }
    }

    return await this.applyMultiFileEdits(edits);
  }

  public async detectAndResolveConflicts(edits: MultiFileEdit[]): Promise<MultiFileEdit[]> {
    this.output.appendLine('[MultiFileEditor] Detecting and resolving conflicts');

    const resolvedEdits: MultiFileEdit[] = [];

    for (const edit of edits) {
      const resolved = await this.conflictResolver.resolve(edit);
      resolvedEdits.push(resolved);
    }

    return resolvedEdits;
  }

  public async previewMultiFileEdits(edits: MultiFileEdit[]): Promise<void> {
    this.output.appendLine('[MultiFileEditor] Previewing multi-file edits');

    // Create a diff view for each edit
    for (const edit of edits) {
      const uri = vscode.Uri.file(edit.filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      
      // Show diff preview
      await vscode.commands.executeCommand(
        'vscode.diff',
        uri,
        uri.with({ scheme: 'preview' }),
        `Preview: ${edit.filePath}`
      );
    }
  }
}
