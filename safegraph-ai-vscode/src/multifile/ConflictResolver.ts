/**
 * Conflict Resolver
 * Resolves edit conflicts across files
 */

import * as vscode from 'vscode';
import { MultiFileEdit, TextEdit } from './MultiFileEditor';

export class ConflictResolver {
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public async resolve(edit: MultiFileEdit): Promise<MultiFileEdit> {
    this.output.appendLine(`[ConflictResolver] Resolving conflicts for ${edit.filePath}`);

    const uri = vscode.Uri.file(edit.filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const currentContent = document.getText();

    // Check for conflicts with current file state
    const resolvedEdits: TextEdit[] = [];

    for (const textEdit of edit.edits) {
      const conflict = await this.detectConflict(document, textEdit);
      
      if (conflict) {
        const resolved = await this.resolveConflict(document, textEdit, conflict);
        if (resolved) {
          resolvedEdits.push(resolved);
        }
      } else {
        resolvedEdits.push(textEdit);
      }
    }

    return {
      filePath: edit.filePath,
      edits: resolvedEdits,
      reason: edit.reason
    };
  }

  private async detectConflict(
    document: vscode.TextDocument,
    edit: TextEdit
  ): Promise<Conflict | null> {
    const range = edit.range;
    const currentText = document.getText(range);

    // Check if the current text matches what we expect
    // If not, there's a conflict
    if (currentText !== '' && !edit.newText.includes(currentText)) {
      return {
        type: 'content_mismatch',
        currentText,
        expectedText: edit.newText,
        range
      };
    }

    return null;
  }

  private async resolveConflict(
    document: vscode.TextDocument,
    edit: TextEdit,
    conflict: Conflict
  ): Promise<TextEdit | null> {
    this.output.appendLine(`[ConflictResolver] Resolving conflict: ${conflict.type}`);

    switch (conflict.type) {
      case 'content_mismatch':
        return await this.resolveContentMismatch(document, edit, conflict);
      default:
        return null;
    }
  }

  private async resolveContentMismatch(
    document: vscode.TextDocument,
    edit: TextEdit,
    conflict: Conflict
  ): Promise<TextEdit | null> {
    // Ask user how to resolve the conflict
    const options = ['Use New', 'Keep Current', 'Merge'];
    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: 'How should this conflict be resolved?'
    });

    if (!choice) {
      return null;
    }

    switch (choice) {
      case 'Use New':
        return edit;
      case 'Keep Current':
        return null;
      case 'Merge':
        return this.mergeEdits(document, edit, conflict);
      default:
        return null;
    }
  }

  private mergeEdits(
    document: vscode.TextDocument,
    edit: TextEdit,
    conflict: Conflict
  ): TextEdit {
    // Simple merge strategy: append new content after current
    const mergedText = conflict.currentText + '\n' + edit.newText;
    
    return {
      range: edit.range,
      newText: mergedText
    };
  }

  public async detectConflictsBetweenEdits(
    edits: MultiFileEdit[]
  ): Promise<ConflictInfo[]> {
    const conflicts: ConflictInfo[] = [];

    // Group edits by file
    const editsByFile = new Map<string, MultiFileEdit[]>();
    for (const edit of edits) {
      if (!editsByFile.has(edit.filePath)) {
        editsByFile.set(edit.filePath, []);
      }
      editsByFile.get(edit.filePath)!.push(edit);
    }

    // Check for conflicts within each file
    for (const [filePath, fileEdits] of editsByFile) {
      const fileConflicts = await this.detectFileConflicts(filePath, fileEdits);
      conflicts.push(...fileConflicts);
    }

    return conflicts;
  }

  private async detectFileConflicts(
    filePath: string,
    edits: MultiFileEdit[]
  ): Promise<ConflictInfo[]> {
    const conflicts: ConflictInfo[] = [];

    for (let i = 0; i < edits.length; i++) {
      for (let j = i + 1; j < edits.length; j++) {
        const conflict = this.detectEditOverlap(edits[i], edits[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    return conflicts;
  }

  private detectEditOverlap(edit1: MultiFileEdit, edit2: MultiFileEdit): ConflictInfo | null {
    for (const textEdit1 of edit1.edits) {
      for (const textEdit2 of edit2.edits) {
        if (this.rangesOverlap(textEdit1.range, textEdit2.range)) {
          return {
            type: 'range_overlap',
            filePath: edit1.filePath,
            edit1: textEdit1,
            edit2: textEdit2
          };
        }
      }
    }

    return null;
  }

  private rangesOverlap(range1: vscode.Range, range2: vscode.Range): boolean {
    return range1.intersection(range2) !== undefined;
  }
}

interface Conflict {
  type: string;
  currentText: string;
  expectedText: string;
  range: vscode.Range;
}

interface ConflictInfo {
  type: string;
  filePath: string;
  edit1?: TextEdit;
  edit2?: TextEdit;
}
