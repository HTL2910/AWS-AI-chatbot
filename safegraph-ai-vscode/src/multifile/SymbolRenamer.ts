/**
 * Symbol Renamer
 * Renames symbols across multiple files
 */

import * as vscode from 'vscode';

export class SymbolRenamer {
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public async renameSymbol(
    symbolName: string,
    newName: string,
    scope?: string
  ): Promise<boolean> {
    this.output.appendLine(`[SymbolRenamer] Renaming '${symbolName}' to '${newName}'`);

    // Find all occurrences of the symbol
    const occurrences = await this.findSymbolOccurrences(symbolName, scope);

    if (occurrences.length === 0) {
      this.output.appendLine(`[SymbolRenamer] No occurrences found for '${symbolName}'`);
      return false;
    }

    this.output.appendLine(`[SymbolRenamer] Found ${occurrences.length} occurrences`);

    // Apply rename to all occurrences
    const editBuilder = new vscode.WorkspaceEdit();

    for (const occurrence of occurrences) {
      const uri = vscode.Uri.file(occurrence.filePath);
      const range = new vscode.Range(
        occurrence.line,
        occurrence.start,
        occurrence.line,
        occurrence.end
      );
      editBuilder.replace(uri, range, newName);
    }

    // Apply the edit
    const success = await vscode.workspace.applyEdit(editBuilder);

    if (success) {
      this.output.appendLine(`[SymbolRenamer] Successfully renamed ${occurrences.length} occurrences`);
    } else {
      this.output.appendLine(`[SymbolRenamer] Failed to apply rename`);
    }

    return success;
  }

  private async findSymbolOccurrences(
    symbolName: string,
    scope?: string
  ): Promise<SymbolOccurrence[]> {
    const occurrences: SymbolOccurrence[] = [];

    // Search for the symbol in all workspace files
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,js,tsx,jsx,py,java,go,rs,cpp,c,h}',
      '**/{node_modules,dist,build,out,venv,.venv}/**'
    );

    for (const file of files) {
      const fileOccurrences = await this.findSymbolInFile(file.fsPath, symbolName, scope);
      occurrences.push(...fileOccurrences);
    }

    return occurrences;
  }

  private async findSymbolInFile(
    filePath: string,
    symbolName: string,
    scope?: string
  ): Promise<SymbolOccurrence[]> {
    const occurrences: SymbolOccurrence[] = [];

    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();
      const lines = content.split('\n');

      // Build regex pattern for the symbol
      const pattern = new RegExp(`\\b${symbolName}\\b`, 'g');

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let match;

        while ((match = pattern.exec(line)) !== null) {
          // Check if this occurrence is within the specified scope
          if (scope && !this.isInScope(document, lineIndex, scope)) {
            continue;
          }

          occurrences.push({
            filePath,
            line: lineIndex,
            start: match.index,
            end: match.index + symbolName.length
          });
        }
      }
    } catch (error) {
      this.output.appendLine(`[SymbolRenamer] Error searching ${filePath}: ${error}`);
    }

    return occurrences;
  }

  private isInScope(document: vscode.TextDocument, lineIndex: number, scope: string): boolean {
    // Check if the line is within the specified scope (function, class, etc.)
    // This is a simplified implementation
    const text = document.getText();
    const lines = text.split('\n');

    // Find the scope definition
    for (let i = 0; i <= lineIndex; i++) {
      const line = lines[i];
      if (line.includes(scope)) {
        // Found the scope, check if we're still within it
        // This is a simplified check
        return true;
      }
    }

    return false;
  }

  public async renameInFile(
    filePath: string,
    symbolName: string,
    newName: string
  ): Promise<boolean> {
    this.output.appendLine(`[SymbolRenamer] Renaming '${symbolName}' in ${filePath}`);

    const occurrences = await this.findSymbolInFile(filePath, symbolName);

    if (occurrences.length === 0) {
      return false;
    }

    const editBuilder = new vscode.WorkspaceEdit();
    const uri = vscode.Uri.file(filePath);

    for (const occurrence of occurrences) {
      const range = new vscode.Range(
        occurrence.line,
        occurrence.start,
        occurrence.line,
        occurrence.end
      );
      editBuilder.replace(uri, range, newName);
    }

    return await vscode.workspace.applyEdit(editBuilder);
  }
}

interface SymbolOccurrence {
  filePath: string;
  line: number;
  start: number;
  end: number;
}
