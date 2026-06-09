/**
 * Dependency Graph
 * Builds and analyzes file dependencies
 */

import * as vscode from 'vscode';

export interface DependencyNode {
  filePath: string;
  dependencies: string[];
  dependents: string[];
  imports: string[];
  exports: string[];
}

export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public async buildGraph(): Promise<void> {
    this.output.appendLine('[DependencyGraph] Building dependency graph');

    // Clear existing graph
    this.nodes.clear();

    // Get all relevant files in workspace
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,js,tsx,jsx,py,java,go,rs,cpp,c,h}',
      '**/{node_modules,dist,build,out,venv,.venv}/**'
    );

    // Build nodes for each file
    for (const file of files) {
      await this.analyzeFile(file.fsPath);
    }

    this.output.appendLine(`[DependencyGraph] Built graph with ${this.nodes.size} nodes`);
  }

  private async analyzeFile(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();
    const language = document.languageId;

    const node: DependencyNode = {
      filePath,
      dependencies: [],
      dependents: [],
      imports: this.extractImports(content, language),
      exports: this.extractExports(content, language)
    };

    // Resolve dependencies
    for (const imp of node.imports) {
      const resolvedPath = await this.resolveImportPath(filePath, imp);
      if (resolvedPath) {
        node.dependencies.push(resolvedPath);
      }
    }

    this.nodes.set(filePath, node);
  }

  private extractImports(content: string, language: string): string[] {
    const imports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (language === 'typescript' || language === 'javascript') {
        const importMatch = line.match(/import.*from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          imports.push(importMatch[1]);
        }
        const requireMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
        if (requireMatch) {
          imports.push(requireMatch[1]);
        }
      } else if (language === 'python') {
        const importMatch = line.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/);
        if (importMatch) {
          imports.push(importMatch[1] || importMatch[2]);
        }
      }
    }

    return imports;
  }

  private extractExports(content: string, language: string): string[] {
    const exports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (language === 'typescript' || language === 'javascript') {
        const exportMatch = line.match(/export\s+(?:const|let|var|function|class)\s+(\w+)/);
        if (exportMatch) {
          exports.push(exportMatch[1]);
        }
        const defaultExportMatch = line.match(/export\s+default\s+(?:class\s+)?(\w+)/);
        if (defaultExportMatch) {
          exports.push(defaultExportMatch[1]);
        }
      } else if (language === 'python') {
        // Python doesn't have explicit exports in the same way
        // Could analyze __all__ if present
      }
    }

    return exports;
  }

  private async resolveImportPath(filePath: string, importPath: string): Promise<string | null> {
    // Resolve relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolved = vscode.Uri.joinPath(vscode.Uri.file(dir), importPath);
      const resolvedPath = resolved.fsPath;
      
      // Try common extensions
      const extensions = ['.ts', '.js', '.tsx', '.jsx', '.py'];
      for (const ext of extensions) {
        const withExt = resolvedPath + ext;
        if (await this.fileExists(withExt)) {
          return withExt;
        }
      }

      // Try index files
      for (const ext of extensions) {
        const indexPath = resolvedPath + '/index' + ext;
        if (await this.fileExists(indexPath)) {
          return indexPath;
        }
      }
    }

    // For now, return null for non-relative imports
    // In a full implementation, this would resolve node_modules, etc.
    return null;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path));
      return true;
    } catch {
      return false;
    }
  }

  public getDependencies(filePath: string): string[] {
    const node = this.nodes.get(filePath);
    return node ? node.dependencies : [];
  }

  public getDependents(filePath: string): string[] {
    const dependents: string[] = [];
    
    for (const [path, node] of this.nodes) {
      if (node.dependencies.includes(filePath)) {
        dependents.push(path);
      }
    }

    return dependents;
  }

  public getCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (filePath: string, path: string[]): void => {
      visited.add(filePath);
      recursionStack.add(filePath);

      const node = this.nodes.get(filePath);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            dfs(dep, [...path, dep]);
          } else if (recursionStack.has(dep)) {
            // Found a cycle
            const cycleStart = path.indexOf(dep);
            if (cycleStart !== -1) {
              cycles.push([...path.slice(cycleStart), dep]);
            }
          }
        }
      }

      recursionStack.delete(filePath);
    };

    for (const filePath of this.nodes.keys()) {
      if (!visited.has(filePath)) {
        dfs(filePath, [filePath]);
      }
    }

    return cycles;
  }

  public getTopologicalOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (filePath: string): void => {
      if (temp.has(filePath)) {
        return; // Cycle detected
      }
      if (visited.has(filePath)) {
        return;
      }

      temp.add(filePath);

      const node = this.nodes.get(filePath);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }

      temp.delete(filePath);
      visited.add(filePath);
      order.push(filePath);
    };

    for (const filePath of this.nodes.keys()) {
      visit(filePath);
    }

    return order;
  }
}
