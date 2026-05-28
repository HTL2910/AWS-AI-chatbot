/**
 * Test Generator - Automatically generate unit/integration/E2E tests from code
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCase, TestType, TestSuite } from '../types/TestFramework';

export class TestGenerator {
  private language: string;
  private testFramework: 'jest' | 'mocha' | 'vitest' = 'jest';

  constructor(language: string = 'typescript', testFramework: 'jest' | 'mocha' | 'vitest' = 'jest') {
    this.language = language;
    this.testFramework = testFramework;
  }

  /**
   * Generate test cases from a source file
   */
  async generateFromFile(filePath: string): Promise<TestCase[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const testCases: TestCase[] = [];

    // Extract functions/classes/exports
    const functions = this.extractFunctions(content);
    const classes = this.extractClasses(content);
    const exports = this.extractExports(content);

    // Generate tests for each function
    for (const func of functions) {
      const testCase = await this.generateFromFunction(content, func.name, filePath);
      if (testCase) {
        testCases.push(testCase);
      }
    }

    // Generate tests for each class
    for (const cls of classes) {
      const testCases_ = await this.generateFromClass(content, cls.name, filePath);
      testCases.push(...testCases_);
    }

    return testCases;
  }

  /**
   * Generate test case for a single function
   */
  async generateFromFunction(
    code: string,
    functionName: string,
    sourceFile: string
  ): Promise<TestCase | null> {
    const funcMatch = this.findFunction(code, functionName);
    if (!funcMatch) {
      return null;
    }

    const { signature, body, params, returnType } = funcMatch;
    const testCaseId = `test_${functionName}_${Date.now()}`;
    const testFileName = sourceFile.replace(/\.(ts|js)$/, '.test.$1');

    // Generate test scenarios based on parameters
    const scenarios = this.generateTestScenarios(params, returnType);
    const assertions = this.generateAssertions(params, returnType, scenarios);

    const testCode = this.generateTestCode(
      functionName,
      signature,
      params,
      scenarios,
      assertions
    );

    return {
      id: testCaseId,
      name: `Test ${functionName}`,
      type: TestType.UNIT,
      filePath: testFileName,
      sourceFile,
      testCode,
      expectedBehavior: `${functionName} should handle all input scenarios correctly`,
      assertions,
      priority: 'high',
    };
  }

  /**
   * Generate test cases for a class
   */
  private async generateFromClass(
    code: string,
    className: string,
    sourceFile: string
  ): Promise<TestCase[]> {
    const classMatch = this.findClass(code, className);
    if (!classMatch) {
      return [];
    }

    const testCases: TestCase[] = [];
    const { methods, constructor } = classMatch;

    // Test constructor
    if (constructor) {
      const testCase = await this.generateFromFunction(code, `${className}.constructor`, sourceFile);
      if (testCase) {
        testCases.push(testCase);
      }
    }

    // Test each method
    for (const method of methods) {
      const testCase = await this.generateFromFunction(code, `${className}.${method.name}`, sourceFile);
      if (testCase) {
        testCases.push(testCase);
      }
    }

    return testCases;
  }

  /**
   * Generate E2E tests from user flow descriptions
   */
  async generateE2ETests(userFlows: string[]): Promise<TestCase[]> {
    const testCases: TestCase[] = [];

    for (const flow of userFlows) {
      const testCaseId = `e2e_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const steps = this.parseUserFlow(flow);
      const testCode = this.generateE2ETestCode(flow, steps);

      testCases.push({
        id: testCaseId,
        name: `E2E: ${flow.substring(0, 50)}...`,
        type: TestType.E2E,
        filePath: `e2e/${testCaseId}.test.ts`,
        sourceFile: 'user_flow',
        testCode,
        expectedBehavior: flow,
        assertions: steps.map((s) => `Step: ${s}`),
        priority: 'high',
      });
    }

    return testCases;
  }

  /**
   * Extract functions from code
   */
  private extractFunctions(code: string): Array<{ name: string; line: number }> {
    const functions: Array<{ name: string; line: number }> = [];
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|(?:export\s+)?(?:async\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;

    let match;
    while ((match = funcRegex.exec(code)) !== null) {
      const name = match[1] || match[2];
      functions.push({ name, line: code.substring(0, match.index).split('\n').length });
    }

    return functions;
  }

  /**
   * Extract classes from code
   */
  private extractClasses(code: string): Array<{ name: string; line: number }> {
    const classes: Array<{ name: string; line: number }> = [];
    const classRegex = /(?:export\s+)?class\s+(\w+)/g;

    let match;
    while ((match = classRegex.exec(code)) !== null) {
      classes.push({ name: match[1], line: code.substring(0, match.index).split('\n').length });
    }

    return classes;
  }

  /**
   * Extract exports from code
   */
  private extractExports(code: string): string[] {
    const exports: string[] = [];
    const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|interface|type)\s+(\w+)/g;

    let match;
    while ((match = exportRegex.exec(code)) !== null) {
      exports.push(match[1]);
    }

    return exports;
  }

  /**
   * Find function definition and extract metadata
   */
  private findFunction(
    code: string,
    functionName: string
  ): { signature: string; body: string; params: any[]; returnType: string } | null {
    const regex = new RegExp(
      `(?:export\\s+)?(?:async\\s+)?(?:function\\s+${functionName}|const\\s+${functionName}\\s*=\\s*(?:async\\s*)?)(\\([^)]*\\))(?:\\s*:\\s*([^{]+))?\\s*\\{`,
      'i'
    );

    const match = code.match(regex);
    if (!match) {
      return null;
    }

    const signature = match[0];
    const paramsStr = match[1];
    const returnType = match[2] || 'any';

    const params = this.parseParameters(paramsStr);

    return {
      signature,
      body: code.substring(match.index! + match[0].length),
      params,
      returnType: returnType.trim(),
    };
  }

  /**
   * Find class definition and extract metadata
   */
  private findClass(
    code: string,
    className: string
  ): { methods: Array<{ name: string }>; constructor: boolean } | null {
    const classRegex = new RegExp(`(?:export\\s+)?class\\s+${className}\\s*\\{([^}]+)\\}`, 's');
    const match = code.match(classRegex);

    if (!match) {
      return null;
    }

    const classBody = match[1];
    const methods: Array<{ name: string }> = [];
    const methodRegex = /(?:async\s+)?(\w+)\s*\(/g;

    let methodMatch;
    while ((methodMatch = methodRegex.exec(classBody)) !== null) {
      methods.push({ name: methodMatch[1] });
    }

    const hasConstructor = /constructor\s*\(/.test(classBody);

    return { methods, constructor: hasConstructor };
  }

  /**
   * Parse function parameters
   */
  private parseParameters(paramsStr: string): any[] {
    const params: any[] = [];
    const paramRegex = /(\w+)\s*:\s*([^,)]+)/g;

    let match;
    while ((match = paramRegex.exec(paramsStr)) !== null) {
      params.push({
        name: match[1],
        type: match[2].trim(),
      });
    }

    return params;
  }

  /**
   * Generate test scenarios based on parameters
   */
  private generateTestScenarios(params: any[], returnType: string): string[] {
    const scenarios: string[] = [];

    // Happy path
    scenarios.push('happy_path');

    // Edge cases for each parameter
    for (const param of params) {
      if (param.type.includes('string')) {
        scenarios.push(`${param.name}_empty_string`);
        scenarios.push(`${param.name}_null`);
        scenarios.push(`${param.name}_special_chars`);
      } else if (param.type.includes('number')) {
        scenarios.push(`${param.name}_zero`);
        scenarios.push(`${param.name}_negative`);
        scenarios.push(`${param.name}_large_value`);
      } else if (param.type.includes('boolean')) {
        scenarios.push(`${param.name}_true`);
        scenarios.push(`${param.name}_false`);
      } else if (param.type.includes('array')) {
        scenarios.push(`${param.name}_empty_array`);
        scenarios.push(`${param.name}_single_element`);
      }
    }

    return scenarios;
  }

  /**
   * Generate assertions based on function signature
   */
  private generateAssertions(params: any[], returnType: string, scenarios: string[]): string[] {
    const assertions: string[] = [];

    for (const scenario of scenarios) {
      if (returnType.includes('Promise')) {
        assertions.push(`expect(result).resolves.toBeDefined()`);
      } else if (returnType.includes('boolean')) {
        assertions.push(`expect(result).toBe(true)`);
      } else if (returnType.includes('string')) {
        assertions.push(`expect(result).toEqual(expect.any(String))`);
      } else if (returnType.includes('number')) {
        assertions.push(`expect(result).toEqual(expect.any(Number))`);
      } else {
        assertions.push(`expect(result).toBeDefined()`);
      }
    }

    return assertions;
  }

  /**
   * Generate test code in Jest format
   */
  private generateTestCode(
    functionName: string,
    signature: string,
    params: any[],
    scenarios: string[],
    assertions: string[]
  ): string {
    const testCode = `
import { ${functionName} } from './index';

describe('${functionName}', () => {
  ${scenarios
    .map(
      (scenario, idx) => `
  it('should handle ${scenario}', async () => {
    // Arrange
    ${params.map((p) => `const ${p.name} = /* TODO: provide test value */;`).join('\n    ')}

    // Act
    const result = await ${functionName}(${params.map((p) => p.name).join(', ')});

    // Assert
    ${assertions[idx] || 'expect(result).toBeDefined();'}
  });
  `
    )
    .join('\n')}
});
    `.trim();

    return testCode;
  }

  /**
   * Parse user flow description into steps
   */
  private parseUserFlow(flow: string): string[] {
    return flow
      .split(/[,;.]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Generate E2E test code
   */
  private generateE2ETestCode(flow: string, steps: string[]): string {
    const testCode = `
describe('E2E: ${flow}', () => {
  it('should complete user flow', async () => {
    ${steps
      .map(
        (step, idx) => `
    // Step ${idx + 1}: ${step}
    // TODO: Implement step
    `
      )
      .join('\n')}
  });
});
    `.trim();

    return testCode;
  }
}
