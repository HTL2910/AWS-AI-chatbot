/**
 * Test Framework Type Definitions
 * Automated testing, quality gates, and refactoring
 */

export enum TestType {
  UNIT = 'unit',
  INTEGRATION = 'integration',
  E2E = 'e2e',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
}

export interface TestCase {
  id: string;
  name: string;
  type: TestType;
  filePath: string;
  sourceFile: string; // file being tested
  testCode: string;
  expectedBehavior: string;
  assertions: string[];
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
}

export interface TestResult {
  caseId: string;
  caseName: string;
  type: TestType;
  passed: boolean;
  duration: number; // milliseconds
  error?: {
    message: string;
    stack?: string;
  };
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  timestamp: number;
}

export interface TestSuite {
  id: string;
  name: string;
  filePath: string;
  cases: TestCase[];
  results?: TestResult[];
  totalDuration?: number;
  passRate?: number; // 0-100
}

export interface SecurityIssue {
  id: string;
  type: 'vulnerability' | 'weakness' | 'code_smell';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  filePath: string;
  lineNumber?: number;
  cveId?: string;
  remediation?: string;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string; // 'ms', 'MB', 'ops/sec', etc
  baseline?: number;
  threshold?: number;
  passed: boolean;
}

export interface QualityMetrics {
  testCoverage: number; // 0-100
  testCount: number;
  passRate: number; // 0-100
  lintErrors: number;
  lintWarnings: number;
  complexityScore: number; // 0-100 (lower is better)
  securityIssues: SecurityIssue[];
  performanceMetrics: PerformanceMetric[];
  documentationCoverage: number; // 0-100
  timestamp: number;
}

export interface QualityGate {
  name: string;
  metric: keyof QualityMetrics;
  operator: '>' | '<' | '==' | '>=' | '<=';
  threshold: number;
  enabled: boolean;
  critical: boolean; // if true, fail entire build
}

export interface QualityGateResult {
  passed: boolean;
  failedGates: QualityGate[];
  metrics: QualityMetrics;
  timestamp: number;
}

export interface CodeSmell {
  id: string;
  type: 'duplication' | 'dead_code' | 'long_method' | 'god_object' | 'complex_conditional';
  severity: 'low' | 'medium' | 'high';
  filePath: string;
  lineRange: [number, number];
  description: string;
  affectedCode: string;
  suggestion?: string;
}

export interface RefactoringAction {
  id: string;
  type: 'extract_method' | 'extract_class' | 'remove_duplication' | 'simplify_conditional' | 'rename';
  sourceFile: string;
  targetFile?: string;
  description: string;
  codeSmell: CodeSmell;
  proposedChange: string; // diff format
  impact: {
    complexity: number; // reduction in cyclomatic complexity
    duplication: number; // reduction in duplication %
    readability: number; // improvement score 0-100
  };
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
}

export interface RefactoringResult {
  actionId: string;
  applied: boolean;
  error?: string;
  testsPassed: boolean;
  metricsImprovement: {
    complexityBefore: number;
    complexityAfter: number;
    coverageBefore: number;
    coverageAfter: number;
  };
}

export interface TestGenerator {
  generateFromFile(filePath: string, language: string): Promise<TestCase[]>;
  generateFromFunction(code: string, functionName: string): Promise<TestCase>;
  generateE2ETests(userFlows: string[]): Promise<TestCase[]>;
}

export interface TestRunner {
  run(suite: TestSuite): Promise<TestResult[]>;
  runSingle(testCase: TestCase): Promise<TestResult>;
  runAll(suites: TestSuite[]): Promise<TestResult[]>;
  getCoverage(): Promise<{ [file: string]: number }>;
}

export interface SecurityScanner {
  scan(filePath: string): Promise<SecurityIssue[]>;
  scanDependencies(): Promise<SecurityIssue[]>;
  scanForCVEs(): Promise<SecurityIssue[]>;
}

export interface QualityGateEngine {
  evaluate(metrics: QualityMetrics, gates: QualityGate[]): QualityGateResult;
  getDefaultGates(): QualityGate[];
}

export interface CodeSmellDetector {
  detect(filePath: string): Promise<CodeSmell[]>;
  detectDuplication(files: string[]): Promise<CodeSmell[]>;
  detectDeadCode(filePath: string): Promise<CodeSmell[]>;
}

export interface RefactoringEngine {
  suggestRefactorings(smells: CodeSmell[]): Promise<RefactoringAction[]>;
  applyRefactoring(action: RefactoringAction): Promise<RefactoringResult>;
  validateRefactoring(action: RefactoringAction): Promise<boolean>;
}
