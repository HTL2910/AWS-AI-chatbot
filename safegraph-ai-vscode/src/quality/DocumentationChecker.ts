/**
 * Documentation Checker - JSDoc, README, and API documentation completeness
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DocIssue {
  filePath: string;
  type: 'missing_jsdoc' | 'missing_param' | 'missing_return' | 'incomplete_description' | 'missing_example';
  severity: 'low' | 'medium' | 'high';
  functionName?: string;
  lineNumber?: number;
  message: string;
  suggestion?: string;
}

export interface FileDocumentation {
  filePath: string;
  totalPublicItems: number;
  documentedItems: number;
  completeness: number; // 0-100
  issues: DocIssue[];
  hasFileHeader: boolean;
  hasReadme: boolean;
}

export interface ProjectDocumentation {
  totalFiles: number;
  totalPublicItems: number;
  totalDocumentedItems: number;
  overallCompleteness: number; // 0-100
  files: FileDocumentation[];
  criticalGaps: DocIssue[];
}

export class DocumentationChecker {
  private workspaceFolder: string;
  private results: FileDocumentation[] = [];
  private threshold = 90; // 90% documentation required

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
  }

  /**
   * Check documentation for a single file
   */
  async checkFile(filePath: string): Promise<FileDocumentation> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const issues: DocIssue[] = [];

    // Extract public items (exports, public functions, classes)
    const publicItems = this.extractPublicItems(content);
    let documentedCount = 0;

    // Check each public item
    for (const item of publicItems) {
      const itemIssues = this.checkItemDocumentation(content, item, filePath);
      issues.push(...itemIssues);

      if (itemIssues.length === 0) {
        documentedCount++;
      }
    }

    // Check file header
    const hasFileHeader = this.hasFileHeader(content);
    if (!hasFileHeader) {
      issues.push({
        filePath,
        type: 'missing_jsdoc',
        severity: 'medium',
        lineNumber: 1,
        message: 'Missing file header documentation',
        suggestion: 'Add JSDoc comment at top of file describing module purpose',
      });
    }

    // Check for README in directory
    const dirPath = path.dirname(filePath);
    const hasReadme = fs.existsSync(path.join(dirPath, 'README.md'));

    const completeness = publicItems.length > 0 ? (documentedCount / publicItems.length) * 100 : 100;

    const fileDoc: FileDocumentation = {
      filePath,
      totalPublicItems: publicItems.length,
      documentedItems: documentedCount,
      completeness: Math.round(completeness),
      issues,
      hasFileHeader,
      hasReadme,
    };

    this.results.push(fileDoc);
    return fileDoc;
  }

  /**
   * Check documentation for all files in directory
   */
  async checkDirectory(dirPath: string): Promise<ProjectDocumentation> {
    const files = this.getFilesToCheck(dirPath);
    this.results = [];

    for (const file of files) {
      await this.checkFile(file);
    }

    return this.generateProjectReport();
  }

  /**
   * Extract public items (exports, public functions, classes)
   */
  private extractPublicItems(
    content: string
  ): Array<{ name: string; type: 'function' | 'class' | 'interface' | 'type'; lineNumber: number }> {
    const items: Array<{ name: string; type: 'function' | 'class' | 'interface' | 'type'; lineNumber: number }> = [];
    const lines = content.split('\n');

    // Match exported functions
    const exportFuncRegex = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g;
    let match;
    while ((match = exportFuncRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      items.push({
        name: match[1],
        type: 'function',
        lineNumber,
      });
    }

    // Match exported classes
    const exportClassRegex = /export\s+class\s+(\w+)/g;
    while ((match = exportClassRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      items.push({
        name: match[1],
        type: 'class',
        lineNumber,
      });
    }

    // Match exported interfaces
    const exportInterfaceRegex = /export\s+interface\s+(\w+)/g;
    while ((match = exportInterfaceRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      items.push({
        name: match[1],
        type: 'interface',
        lineNumber,
      });
    }

    // Match exported types
    const exportTypeRegex = /export\s+type\s+(\w+)/g;
    while ((match = exportTypeRegex.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      items.push({
        name: match[1],
        type: 'type',
        lineNumber,
      });
    }

    return items;
  }

  /**
   * Check documentation for a specific item
   */
  private checkItemDocumentation(
    content: string,
    item: { name: string; type: string; lineNumber: number },
    filePath: string
  ): DocIssue[] {
    const issues: DocIssue[] = [];
    const lines = content.split('\n');
    const itemLine = lines[item.lineNumber - 1];

    // Check if there's JSDoc comment before the item
    let hasJsDoc = false;
    let jsDocStart = item.lineNumber - 1;

    for (let i = item.lineNumber - 2; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.endsWith('*/')) {
        hasJsDoc = true;
        jsDocStart = i;
        break;
      }
      if (line === '' || line.startsWith('*') || line.startsWith('//')) {
        continue;
      }
      break;
    }

    if (!hasJsDoc) {
      issues.push({
        filePath,
        type: 'missing_jsdoc',
        severity: 'high',
        functionName: item.name,
        lineNumber: item.lineNumber,
        message: `Missing JSDoc for exported ${item.type} '${item.name}'`,
        suggestion: `Add JSDoc comment: /** ${item.name} description */`,
      });
      return issues;
    }

    // Extract JSDoc content
    const jsDocContent = lines.slice(jsDocStart, item.lineNumber - 1).join('\n');

    // Check for description
    if (!jsDocContent.match(/\*\s+[A-Z]/)) {
      issues.push({
        filePath,
        type: 'incomplete_description',
        severity: 'medium',
        functionName: item.name,
        lineNumber: item.lineNumber,
        message: `Incomplete description for ${item.type} '${item.name}'`,
        suggestion: 'Add descriptive text in JSDoc comment',
      });
    }

    // Check for @param if function
    if (item.type === 'function') {
      const paramMatches = itemLine.match(/\(([^)]*)\)/);
      if (paramMatches && paramMatches[1]) {
        const params = paramMatches[1].split(',').map((p) => p.trim().split(':')[0]);
        for (const param of params) {
          if (param && !jsDocContent.includes(`@param ${param}`)) {
            issues.push({
              filePath,
              type: 'missing_param',
              severity: 'high',
              functionName: item.name,
              lineNumber: item.lineNumber,
              message: `Missing @param documentation for parameter '${param}'`,
              suggestion: `Add @param ${param} description`,
            });
          }
        }
      }
    }

    // Check for @returns
    if (item.type === 'function' && !jsDocContent.includes('@returns') && !jsDocContent.includes('@return')) {
      issues.push({
        filePath,
        type: 'missing_return',
        severity: 'medium',
        functionName: item.name,
        lineNumber: item.lineNumber,
        message: `Missing @returns documentation for function '${item.name}'`,
        suggestion: 'Add @returns description',
      });
    }

    return issues;
  }

  /**
   * Check if file has header documentation
   */
  private hasFileHeader(content: string): boolean {
    const lines = content.split('\n');
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (lines[i].includes('/**') || lines[i].includes('/*')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get files to check
   */
  private getFilesToCheck(dirPath: string): string[] {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'test') {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    walk(dirPath);
    return files;
  }

  /**
   * Generate project-wide report
   */
  private generateProjectReport(): ProjectDocumentation {
    let totalPublic = 0;
    let totalDocumented = 0;
    const criticalGaps: DocIssue[] = [];

    for (const file of this.results) {
      totalPublic += file.totalPublicItems;
      totalDocumented += file.documentedItems;

      for (const issue of file.issues) {
        if (issue.severity === 'high') {
          criticalGaps.push(issue);
        }
      }
    }

    const overallCompleteness = totalPublic > 0 ? (totalDocumented / totalPublic) * 100 : 100;

    return {
      totalFiles: this.results.length,
      totalPublicItems: totalPublic,
      totalDocumentedItems: totalDocumented,
      overallCompleteness: Math.round(overallCompleteness),
      files: this.results,
      criticalGaps,
    };
  }

  /**
   * Get results
   */
  getResults(): FileDocumentation[] {
    return this.results;
  }

  /**
   * Set documentation threshold
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }
}
