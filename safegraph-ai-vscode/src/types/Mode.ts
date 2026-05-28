/**
 * Mode System Type Definitions
 * Context-aware modes for different development tasks
 */

export enum ModeType {
  CODE = 'code',
  WEB_RESEARCH = 'web_research',
  DOCS = 'docs',
  DEBUG = 'debug',
  UI_DESIGN = 'ui_design',
  REVIEW = 'review',
}

export interface ModeConfig {
  type: ModeType;
  name: string;
  description: string;
  icon: string;
  color: string;
  tools: string[]; // tool IDs available in this mode
  defaultTimeout: number;
  requiresApproval: boolean;
  contextDetectors: string[]; // functions to detect this mode
}

export interface ModeContext {
  activeFile?: string;
  selectedText?: string;
  fileLanguage?: string;
  projectType?: string;
  recentCommands?: string[];
  userIntent?: string;
}

export interface ModeDetectionResult {
  detectedMode: ModeType;
  confidence: number; // 0-1
  reasons: string[];
  alternativeModes?: { mode: ModeType; confidence: number }[];
}

export interface ModeManager {
  getCurrentMode(): ModeType;
  setMode(mode: ModeType): void;
  detectMode(context: ModeContext): ModeDetectionResult;
  getConfig(mode: ModeType): ModeConfig;
  getAllModes(): ModeConfig[];
  isAvailableTool(toolId: string, mode: ModeType): boolean;
}

export interface CodeModeHandler {
  analyzeCode(filePath: string): Promise<any>;
  suggestRefactoring(filePath: string): Promise<string[]>;
  runTests(testPath?: string): Promise<any>;
  formatCode(filePath: string): Promise<void>;
}

export interface WebResearchModeHandler {
  fetchDocumentation(url: string): Promise<string>;
  parseMarkdown(content: string): Promise<any>;
  synthesizeDocumentation(pages: string[]): Promise<string>;
  cacheResults(key: string, data: any): void;
}

export interface DocsModeHandler {
  generateReadme(projectPath: string): Promise<string>;
  generateApiDocs(sourceFile: string): Promise<string>;
  generateGuide(topic: string): Promise<string>;
  updateDocumentation(docPath: string, content: string): Promise<void>;
}

export interface DebugModeHandler {
  analyzeError(errorMessage: string): Promise<any>;
  suggestFix(errorAnalysis: any): Promise<string>;
  runDebugger(filePath: string): Promise<any>;
  traceExecution(command: string): Promise<any>;
}

export interface UIDesignModeHandler {
  generateMockup(description: string): Promise<string>;
  createComponent(componentSpec: any): Promise<string>;
  suggestLayout(requirements: string[]): Promise<string>;
}

export interface ReviewModeHandler {
  performCodeReview(filePath: string): Promise<any>;
  securityAudit(filePath: string): Promise<any>;
  performanceAnalysis(filePath: string): Promise<any>;
}
