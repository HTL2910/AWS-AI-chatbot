/**
 * Complexity Analyzer - Cyclomatic and cognitive complexity detection
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ComplexityMetric {
  filePath: string;
  functionName: string;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  lineCount: number;
  nestingLevel: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface FileComplexity {
  filePath: string;
  averageCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;
  averageCognitiveComplexity: number;
  maxCognitiveComplexity: number;
  functions: ComplexityMetric[];
}

export class ComplexityAnalyzer {
  private workspaceFolder: string;
  private results: FileComplexity[] = [];
  private thresholds = {
    cyclomatic: 10,
    cognitive: 15,
  };

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
  }

  /**
   * Analyze a single file
   */
  async analyzeFile(filePath: string): Promise<FileComplexity> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const functions = this.extractFunctions(content);
    const metrics: ComplexityMetric[] = [];

    for (const func of functions) {
      const metric = this.calculateComplexity(func, filePath);
      metrics.push(metric);
    }

    const fileComplexity: FileComplexity = {
      filePath,
      averageCyclomaticComplexity:
        metrics.length > 0
          ? metrics.reduce((sum, m) => sum + m.cyclomaticComplexity, 0) / metrics.length
          : 0,
      maxCyclomaticComplexity:
        metrics.length > 0 ? Math.max(...metrics.map((m) => m.cyclomaticComplexity)) : 0,
      averageCognitiveComplexity:
        metrics.length > 0
          ? metrics.reduce((sum, m) => sum + m.cognitiveComplexity, 0) / metrics.length
          : 0,
      maxCognitiveComplexity:
        metrics.length > 0 ? Math.max(...metrics.map((m) => m.cognitiveComplexity)) : 0,
      functions: metrics,
    };

    this.results.push(fileComplexity);
    return fileComplexity;
  }

  /**
   * Analyze all files in a directory
   */
  async analyzeDirectory(dirPath: string): Promise<FileComplexity[]> {
    const results: FileComplexity[] = [];
    const files = this.getFilesToAnalyze(dirPath);

    for (const file of files) {
      const result = await this.analyzeFile(file);
      results.push(result);
    }

    return results;
  }

  /**
   * Extract functions from code
   */
  private extractFunctions(
    content: string
  ): Array<{ name: string; body: string; startLine: number; endLine: number }> {
    const functions: Array<{ name: string; body: string; startLine: number; endLine: number }> = [];
    const lines = content.split('\n');

    // Match function declarations
    const funcRegex = /(?:export\s+)?(?:async\s+)?(?:function|const)\s+(\w+)\s*(?:=\s*)?(?:async\s*)?\(/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length;
      const functionName = match[1];

      // Find matching closing brace
      let braceCount = 0;
      let inFunction = false;
      let endLine = startLine;
      let body = '';

      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const char of line) {
          if (char === '{') {
            braceCount++;
            inFunction = true;
          } else if (char === '}') {
            braceCount--;
            if (inFunction && braceCount === 0) {
              endLine = i + 1;
              break;
            }
          }
        }
        if (inFunction) {
          body += line + '\n';
        }
        if (inFunction && braceCount === 0) {
          break;
        }
      }

      functions.push({
        name: functionName,
        body,
        startLine,
        endLine,
      });
    }

    return functions;
  }

  /**
   * Calculate complexity metrics for a function
   */
  private calculateComplexity(
    func: { name: string; body: string; startLine: number; endLine: number },
    filePath: string
  ): ComplexityMetric {
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(func.body);
    const cognitiveComplexity = this.calculateCognitiveComplexity(func.body);
    const lineCount = func.endLine - func.startLine;
    const nestingLevel = this.calculateNestingLevel(func.body);

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (cyclomaticComplexity > 20 || cognitiveComplexity > 30) {
      severity = 'critical';
    } else if (cyclomaticComplexity > 15 || cognitiveComplexity > 20) {
      severity = 'high';
    } else if (cyclomaticComplexity > 10 || cognitiveComplexity > 15) {
      severity = 'medium';
    }

    return {
      filePath,
      functionName: func.name,
      cyclomaticComplexity,
      cognitiveComplexity,
      lineCount,
      nestingLevel,
      severity,
    };
  }

  /**
   * Calculate cyclomatic complexity
   * Counts decision points: if, else, switch, case, for, while, catch, etc.
   */
  private calculateCyclomaticComplexity(code: string): number {
    let complexity = 1; // Base complexity

    // Count decision points
    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\belse\b/g,
      /\bswitch\s*\(/g,
      /\bcase\s+/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bdo\s*\{/g,
      /\bcatch\s*\(/g,
      /\?\s*:/g, // Ternary operator
      /\|\|/g, // Logical OR
      /&&/g, // Logical AND
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * Calculate cognitive complexity
   * Similar to cyclomatic but with additional weight for nesting
   */
  private calculateCognitiveComplexity(code: string): number {
    let complexity = 0;
    const lines = code.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      const nestingLevel = this.getNestingLevelForLine(line);

      // Base increment for control structures
      if (/\bif\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\belse\s+if\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\belse\b/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\bswitch\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\bcase\s+/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\bfor\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\bwhile\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\bcatch\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      } else if (/\?\s*:/.test(trimmed)) {
        complexity += 1 + nestingLevel;
      }
    }

    return complexity;
  }

  /**
   * Calculate nesting level
   */
  private calculateNestingLevel(code: string): number {
    let maxNesting = 0;
    let currentNesting = 0;

    for (const char of code) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        currentNesting--;
      }
    }

    return maxNesting;
  }

  /**
   * Get nesting level for a specific line
   */
  private getNestingLevelForLine(line: string): number {
    let level = 0;
    for (const char of line) {
      if (char === ' ' || char === '\t') {
        continue;
      }
      break;
    }

    // Count leading whitespace as proxy for nesting
    const leadingSpaces = line.match(/^\s*/)?.[0].length || 0;
    return Math.floor(leadingSpaces / 2); // Assume 2-space indentation
  }

  /**
   * Get files to analyze
   */
  private getFilesToAnalyze(dirPath: string): string[] {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
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
   * Get high complexity functions
   */
  getHighComplexityFunctions(threshold: number = this.thresholds.cyclomatic): ComplexityMetric[] {
    const highComplexity: ComplexityMetric[] = [];

    for (const file of this.results) {
      for (const func of file.functions) {
        if (func.cyclomaticComplexity > threshold) {
          highComplexity.push(func);
        }
      }
    }

    return highComplexity.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);
  }

  /**
   * Get summary
   */
  getSummary(): {
    totalFiles: number;
    averageCyclomaticComplexity: number;
    maxCyclomaticComplexity: number;
    averageCognitiveComplexity: number;
    maxCognitiveComplexity: number;
    highComplexityCount: number;
  } {
    let totalCyclomatic = 0;
    let maxCyclomatic = 0;
    let totalCognitive = 0;
    let maxCognitive = 0;
    let highComplexityCount = 0;

    for (const file of this.results) {
      totalCyclomatic += file.averageCyclomaticComplexity;
      maxCyclomatic = Math.max(maxCyclomatic, file.maxCyclomaticComplexity);
      totalCognitive += file.averageCognitiveComplexity;
      maxCognitive = Math.max(maxCognitive, file.maxCognitiveComplexity);

      for (const func of file.functions) {
        if (func.severity === 'high' || func.severity === 'critical') {
          highComplexityCount++;
        }
      }
    }

    const fileCount = this.results.length;

    return {
      totalFiles: fileCount,
      averageCyclomaticComplexity: fileCount > 0 ? totalCyclomatic / fileCount : 0,
      maxCyclomaticComplexity: maxCyclomatic,
      averageCognitiveComplexity: fileCount > 0 ? totalCognitive / fileCount : 0,
      maxCognitiveComplexity: maxCognitive,
      highComplexityCount,
    };
  }

  /**
   * Get results
   */
  getResults(): FileComplexity[] {
    return this.results;
  }

  /**
   * Set thresholds
   */
  setThresholds(cyclomatic: number, cognitive: number): void {
    this.thresholds.cyclomatic = cyclomatic;
    this.thresholds.cognitive = cognitive;
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
  }
}