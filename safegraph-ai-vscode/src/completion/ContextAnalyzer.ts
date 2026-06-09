/**
 * Context Analyzer
 * Analyzes code context for inline completion
 */

import * as vscode from 'vscode';

export interface CodeContext {
  language: string;
  lineBefore: string;
  lineAfter: string;
  currentLine: string;
  prefix: string;
  suffix: string;
  functionScope?: string;
  classScope?: string;
  imports: string[];
  variables: string[];
  functions: string[];
  isInsideFunction: boolean;
  isInsideClass: boolean;
  isInsideComment: boolean;
  isInsideString: boolean;
}

export class ContextAnalyzer {
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public async analyzeContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<CodeContext> {
    const line = document.lineAt(position.line);
    const text = document.getText();
    const offset = document.offsetAt(position);

    const context: CodeContext = {
      language: document.languageId,
      lineBefore: position.line > 0 ? document.lineAt(position.line - 1).text : '',
      lineAfter: position.line < document.lineCount - 1 ? document.lineAt(position.line + 1).text : '',
      currentLine: line.text.substring(0, position.character),
      prefix: text.substring(0, offset),
      suffix: text.substring(offset),
      imports: this.extractImports(document),
      variables: this.extractVariables(document, position),
      functions: this.extractFunctions(document),
      isInsideFunction: this.isInsideFunction(document, position),
      isInsideClass: this.isInsideClass(document, position),
      isInsideComment: this.isInsideComment(document, position),
      isInsideString: this.isInsideString(document, position)
    };

    // Extract function and class scope
    if (context.isInsideFunction) {
      context.functionScope = this.getFunctionScope(document, position);
    }
    if (context.isInsideClass) {
      context.classScope = this.getClassScope(document, position);
    }

    return context;
  }

  private extractImports(document: vscode.TextDocument): string[] {
    const imports: string[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (const line of lines) {
      if (this.language === 'typescript' || this.language === 'javascript') {
        const importMatch = line.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          imports.push(importMatch[1]);
        }
        const requireMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
        if (requireMatch) {
          imports.push(requireMatch[1]);
        }
      } else if (this.language === 'python') {
        const importMatch = line.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/);
        if (importMatch) {
          imports.push(importMatch[1] || importMatch[2]);
        }
      }
    }

    return imports;
  }

  private extractVariables(document: vscode.TextDocument, position: vscode.Position): string[] {
    const variables: string[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i <= position.line; i++) {
      const line = lines[i];
      
      if (this.language === 'typescript' || this.language === 'javascript') {
        const constMatch = line.match(/(?:const|let|var)\s+(\w+)/);
        if (constMatch) {
          variables.push(constMatch[1]);
        }
      } else if (this.language === 'python') {
        const assignMatch = line.match(/^(\w+)\s*=/);
        if (assignMatch) {
          variables.push(assignMatch[1]);
        }
      }
    }

    return variables;
  }

  private extractFunctions(document: vscode.TextDocument): string[] {
    const functions: string[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    for (const line of lines) {
      if (this.language === 'typescript' || this.language === 'javascript') {
        const funcMatch = line.match(/(?:function\s+(\w+)|(\w+)\s*\(|const\s+(\w+)\s*=\s*\()/);
        if (funcMatch) {
          functions.push(funcMatch[1] || funcMatch[2] || funcMatch[3]);
        }
      } else if (this.language === 'python') {
        const funcMatch = line.match(/^def\s+(\w+)/);
        if (funcMatch) {
          functions.push(funcMatch[1]);
        }
      }
    }

    return functions;
  }

  private isInsideFunction(document: vscode.TextDocument, position: vscode.Position): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.substring(0, offset);

    // Count opening and closing braces/parentheses
    const openBraces = (before.match(/\{/g) || []).length;
    const closeBraces = (before.match(/\}/g) || []).length;
    
    return openBraces > closeBraces;
  }

  private isInsideClass(document: vscode.TextDocument, position: vscode.Position): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.substring(0, offset);

    // Check if we're inside a class definition
    const classMatches = before.match(/class\s+\w+/g);
    if (!classMatches) return false;

    const openBraces = (before.match(/\{/g) || []).length;
    const closeBraces = (before.match(/\}/g) || []).length;

    return openBraces > closeBraces && classMatches.length > 0;
  }

  private isInsideComment(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line);
    const text = line.text.substring(0, position.character);

    // Single-line comment
    if (text.trim().startsWith('//') || text.trim().startsWith('#')) {
      return true;
    }

    // Multi-line comment (simplified)
    const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const multiLineStart = before.lastIndexOf('/*');
    const multiLineEnd = before.lastIndexOf('*/');

    return multiLineStart > multiLineEnd;
  }

  private isInsideString(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line);
    const text = line.text.substring(0, position.character);

    // Count quotes before position
    const singleQuotes = (text.match(/'/g) || []).length;
    const doubleQuotes = (text.match(/"/g) || []).length;

    // Odd number means we're inside a string
    return singleQuotes % 2 === 1 || doubleQuotes % 2 === 1;
  }

  private getFunctionScope(document: vscode.TextDocument, position: vscode.Position): string {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.substring(0, offset);

    // Find the last function definition before this position
    const funcPattern = /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*\{)/g;
    const funcMatches = before.match(funcPattern);
    
    if (funcMatches) {
      const matches = before.match(funcPattern) || [];
      const lastMatch = matches[matches.length - 1];
      const nameMatch = lastMatch.match(/(?:function\s+)?(\w+)/);
      return nameMatch ? nameMatch[1] : '';
    }

    return '';
  }

  private getClassScope(document: vscode.TextDocument, position: vscode.Position): string {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.substring(0, offset);

    // Find the last class definition before this position
    const classMatches = before.match(/class\s+(\w+)/g);
    
    if (classMatches) {
      const lastMatch = classMatches[classMatches.length - 1];
      const nameMatch = lastMatch.match(/class\s+(\w+)/);
      return nameMatch ? nameMatch[1] : '';
    }

    return '';
  }

  private get language(): string {
    const editor = vscode.window.activeTextEditor;
    return editor ? editor.document.languageId : '';
  }
}
