/**
 * Code Smell Detector - Detect duplication, dead code, long methods, etc.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CodeSmell {
  id: string;
  type: 'duplication' | 'dead_code' | 'long_method' | 'large_class' | 'long_parameter_list' | 'feature_envy' | 'data_clump';
  severity: 'low' | 'medium' | 'high' | 'critical';
  filePath: string;
  lineNumber?: number;
  endLineNumber?: number;
  name?: string;
  description: string;
  affectedCode: string;
  suggestion: string;
  duplicateLocations?: Array<{ filePath: string; lineNumber: number }>;
}

export interface FileSmells {
  filePath: string;
  totalSmells: number;
  smells: CodeSmell[];
  duplicateLines: number;
  deadCodeLines: number;
}

export class CodeSmellDetector {
  private workspaceFolder: string;
  private results: FileSmells[] = [];
  private codeHashes: Map<string, Array<{ filePath: string; lineNumber: number }>> = new Map();

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
  }

  /**
   * Analyze a single file for code smells
   */
  async analyzeFile(filePath: string): Promise<FileSmells> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const smells: CodeSmell[] = [];
    let duplicateLines = 0;
    let deadCodeLines = 0;

    // Detect duplications
    const duplications = this.detectDuplication(content, filePath);
    smells.push(...duplications);
    duplicateLines = duplications.reduce((sum, d) => sum + (d.endLineNumber ? d.endLineNumber - (d.lineNumber || 0) : 0), 0);

    // Detect dead code
    const deadCode = this.detectDeadCode(content, filePath);
    smells.push(...deadCode);
    deadCodeLines = deadCode.reduce((sum, d) => sum + (d.endLineNumber ? d.endLineNumber - (d.lineNumber || 0) : 0), 0);

    // Detect long methods
    const longMethods = this.detectLongMethods(content, filePath);
    smells.push(...longMethods);

    // Detect large classes
    const largeClasses = this.detectLargeClasses(content, filePath);
    smells.push(...largeClasses);

    // Detect long parameter lists
    const longParams = this.detectLongParameterLists(content, filePath);
    smells.push(...longParams);

    // Detect feature envy
    const featureEnvy = this.detectFeatureEnvy(content, filePath);
    smells.push(...featureEnvy);

    const fileSmells: FileSmells = {
      filePath,
      totalSmells: smells.length,
      smells,
      duplicateLines,
      deadCodeLines,
    };

    this.results.push(fileSmells);
    return fileSmells;
  }

  /**
   * Analyze all files in directory
   */
  async analyzeDirectory(dirPath: string): Promise<FileSmells[]> {
    const files = this.getFilesToAnalyze(dirPath);
    this.results = [];

    for (const file of files) {
      await this.analyzeFile(file);
    }

    return this.results;
  }

  /**
   * Detect code duplication
   */
  private detectDuplication(content: string, filePath: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');
    const minDuplicateLength = 5; // Minimum lines to consider as duplication

    // Check for duplicate code blocks
    for (let i = 0; i < lines.length - minDuplicateLength; i++) {
      const block = lines.slice(i, i + minDuplicateLength).join('\n');
      const hash = this.hashCode(block);

      if (!this.codeHashes.has(hash)) {
        this.codeHashes.set(hash, []);
      }

      const locations = this.codeHashes.get(hash)!;
      locations.push({ filePath, lineNumber: i + 1 });
    }

    // Find duplicates
    for (const [hash, locations] of this.codeHashes) {
      if (locations.length > 1) {
        const firstLocation = locations[0];
        const duplicateLocations = locations.slice(1);

        smells.push({
          id: `dup_${hash}`,
          type: 'duplication',
          severity: locations.length > 3 ? 'high' : 'medium',
          filePath: firstLocation.filePath,
          lineNumber: firstLocation.lineNumber,
          endLineNumber: firstLocation.lineNumber + minDuplicateLength,
          description: `Code block duplicated ${locations.length} times`,
          affectedCode: lines.slice(firstLocation.lineNumber - 1, firstLocation.lineNumber + minDuplicateLength - 1).join('\n'),
          suggestion: 'Extract duplicated code into a shared function or utility',
          duplicateLocations,
        });
      }
    }

    return smells;
  }

  /**
   * Detect dead code (unused variables, unreachable code)
   */
  private detectDeadCode(content: string, filePath: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    // Detect unreachable code (after return, throw, break)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.includes('return ') || line.includes('throw ') || line === 'break;') {
        // Check if there's code after this line in the same block
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine === '' || nextLine.startsWith('//')) {
            continue;
          }
          if (nextLine === '}' || nextLine === '};') {
            break;
          }

          smells.push({
            id: `dead_${i}_${j}`,
            type: 'dead_code',
            severity: 'high',
            filePath,
            lineNumber: j + 1,
            description: 'Unreachable code detected',
            affectedCode: nextLine,
            suggestion: 'Remove unreachable code or restructure control flow',
          });
          break;
        }
      }
    }

    return smells;
  }

  /**
   * Detect long methods (>30 lines)
   */
  private detectLongMethods(content: string, filePath: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');
    const maxMethodLength = 30;

    const funcRegex = /(?:export\s+)?(?:async\s+)?(?:function|const)\s+(\w+)\s*(?:=\s*)?(?:async\s*)?\(/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length;
      const functionName = match[1];

      // Find matching closing brace
      let braceCount = 0;
      let endLine = startLine;

      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const char of line) {
          if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
        }
        if (braceCount === 0) {
          endLine = i + 1;
          break;
        }
      }

      const methodLength = endLine - startLine;
      if (methodLength > maxMethodLength) {
        smells.push({
          id: `long_method_${startLine}`,
          type: 'long_method',
          severity: methodLength > 50 ? 'high' : 'medium',
          filePath,
          lineNumber: startLine,
          endLineNumber: endLine,
          name: functionName,
          description: `Method '${functionName}' is ${methodLength} lines long (threshold: ${maxMethodLength})`,
          affectedCode: lines.slice(startLine - 1, endLine).join('\n'),
          suggestion: 'Break method into smaller, focused functions',
        });
      }
    }

    return smells;
  }

  /**
   * Detect large classes (>200 lines)
   */
  private detectLargeClasses(content: string, filePath: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');
    const maxClassLength = 200;

    const classRegex = /export\s+class\s+(\w+)/g;
    let match;

    while ((match = classRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length;
      const className = match[1];

      // Find matching closing brace
      let braceCount = 0;
      let endLine = startLine;

      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i];
        for (const char of line) {
          if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
        }
        if (braceCount === 0) {
          endLine = i + 1;
          break;
        }
      }

      const classLength = endLine - startLine;
      if (classLength > maxClassLength) {
        smells.push({
          id: `large_class_${startLine}`,
          type: 'large_class',
          severity: classLength > 400 ? 'high' : 'medium',
          filePath,
          lineNumber: startLine,
          endLineNumber: endLine,
          name: className,
          description: `Class '${className}' is ${classLength} lines long (threshold: ${maxClassLength})`,
          affectedCode: `class ${className} { ... }`,
          suggestion: 'Split class into smaller, single-responsibility classes',
        });
      }
    }

    return smells;
  }

  /**
   * Detect long parameter lists (>4 parameters)
   */
  private detectLongParameterLists(content: string, filePath: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const maxParams = 4;

    const funcRegex = /(?:export\s+)?(?:async\s+)?(?:function|const)\s+(\w+)\s*(?:=\s*)?(?:async\s*)?\(([^)]*)\)/g;
    let match;

    while ((match = funcRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length;
      const functionName = match[1];
      const paramString = match[2];

      const params = paramString.split(',').filter((p) => p.trim());
      if (params.length > maxParams) {
        smells.push({
          id: `long_params_${startLine}`,
          type: 'long_parameter_list',
          severity: 'medium',
          filePath,
          lineNumber: startLine,
          name: functionName,
          description: `Function '${functionName}' has ${params.length} parameters (threshold: ${maxParams})`,
          affectedCode: `${functionName}(${paramString})`,
          suggestion: 'Group related parameters into an object or use builder pattern',
        });
      }
    }

    return smells;
  }

  /**
   * Detect feature envy (accessing other object's properties too much)
   */
  private detectFeatureEnvy(content: string, filePath: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    // Simple heuristic: detect multiple accesses to same object property
    const propertyAccessRegex = /(\w+)\.(\w+)/g;
    const accessCounts: Map<string, number> = new Map();

    for (const line of lines) {
      let match;
      while ((match = propertyAccessRegex.exec(line)) !== null) {
        const key = `${match[1]}.${match[2]}`;
        accessCounts.set(key, (accessCounts.get(key) || 0) + 1);
      }
    }

    // Flag excessive property access
    for (const [key, count] of accessCounts) {
      if (count > 5) {
        smells.push({
          id: `feature_envy_${key}`,
          type: 'feature_envy',
          severity: 'low',
          filePath,
          description: `Excessive access to '${key}' (${count} times)`,
          affectedCode: key,
          suggestion: 'Consider moving logic to the object that owns this property',
        });
      }
    }

    return smells;
  }

  /**
   * Hash code for duplication detection
   */
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
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
   * Get results
   */
  getResults(): FileSmells[] {
    return this.results;
  }

  /**
   * Get summary
   */
  getSummary(): {
    totalFiles: number;
    totalSmells: number;
    duplicateLines: number;
    deadCodeLines: number;
    smellsByType: Record<string, number>;
  } {
    let totalSmells = 0;
    let duplicateLines = 0;
    let deadCodeLines = 0;
    const smellsByType: Record<string, number> = {};

    for (const file of this.results) {
      totalSmells += file.totalSmells;
      duplicateLines += file.duplicateLines;
      deadCodeLines += file.deadCodeLines;

      for (const smell of file.smells) {
        smellsByType[smell.type] = (smellsByType[smell.type] || 0) + 1;
      }
    }

    return {
      totalFiles: this.results.length,
      totalSmells,
      duplicateLines,
      deadCodeLines,
      smellsByType,
    };
  }

  /**
   * Clear results
   */
  clearResults(): void {
    this.results = [];
    this.codeHashes.clear();
  }
}
