/**
 * E2E Test Builder - Generate end-to-end tests for UI flows
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCase, TestType } from '../types/TestFramework';

export interface UserFlow {
  name: string;
  description: string;
  steps: FlowStep[];
  expectedOutcome: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface FlowStep {
  action: 'click' | 'type' | 'wait' | 'navigate' | 'assert' | 'scroll' | 'hover' | 'select';
  target?: string; // CSS selector or element identifier
  value?: string; // For type, select actions
  timeout?: number;
  description?: string;
}

export class E2ETestBuilder {
  private testFramework: 'playwright' | 'cypress' | 'puppeteer' = 'playwright';
  private baseUrl: string;
  private userFlows: UserFlow[] = [];

  constructor(baseUrl: string, testFramework: 'playwright' | 'cypress' | 'puppeteer' = 'playwright') {
    this.baseUrl = baseUrl;
    this.testFramework = testFramework;
  }

  /**
   * Add a user flow
   */
  addUserFlow(flow: UserFlow): void {
    this.userFlows.push(flow);
  }

  /**
   * Generate test cases from user flows
   */
  generateTestCases(): TestCase[] {
    const testCases: TestCase[] = [];

    for (const flow of this.userFlows) {
      const testCase = this.generateTestCase(flow);
      testCases.push(testCase);
    }

    return testCases;
  }

  /**
   * Generate a single test case from a user flow
   */
  private generateTestCase(flow: UserFlow): TestCase {
    const testCaseId = `e2e_${flow.name.replace(/\s+/g, '_')}_${Date.now()}`;
    const testCode = this.generateTestCode(flow);

    return {
      id: testCaseId,
      name: `E2E: ${flow.name}`,
      type: TestType.E2E,
      filePath: `e2e/${testCaseId}.spec.ts`,
      sourceFile: 'user_flow',
      testCode,
      expectedBehavior: flow.expectedOutcome,
      assertions: this.extractAssertions(flow),
      priority: flow.priority || 'medium',
    };
  }

  /**
   * Generate test code based on framework
   */
  private generateTestCode(flow: UserFlow): string {
    switch (this.testFramework) {
      case 'playwright':
        return this.generatePlaywrightTest(flow);
      case 'cypress':
        return this.generateCypressTest(flow);
      case 'puppeteer':
        return this.generatePuppeteerTest(flow);
      default:
        return this.generatePlaywrightTest(flow);
    }
  }

  /**
   * Generate Playwright test
   */
  private generatePlaywrightTest(flow: UserFlow): string {
    const stepCode = flow.steps
      .map((step, idx) => this.generatePlaywrightStep(step, idx))
      .join('\n    ');

    return `
import { test, expect } from '@playwright/test';

test('${flow.name}', async ({ page }) => {
  // Navigate to base URL
  await page.goto('${this.baseUrl}');

  ${stepCode}

  // Verify expected outcome
  // TODO: Add assertion for expected outcome
});
    `.trim();
  }

  /**
   * Generate Playwright step
   */
  private generatePlaywrightStep(step: FlowStep, idx: number): string {
    const timeout = step.timeout ? `, { timeout: ${step.timeout} }` : '';

    switch (step.action) {
      case 'click':
        return `// Step ${idx + 1}: ${step.description || 'Click'}
  await page.click('${step.target}'${timeout});`;

      case 'type':
        return `// Step ${idx + 1}: ${step.description || 'Type'}
  await page.fill('${step.target}', '${step.value}'${timeout});`;

      case 'wait':
        return `// Step ${idx + 1}: ${step.description || 'Wait'}
  await page.waitForTimeout(${step.timeout || 1000});`;

      case 'navigate':
        return `// Step ${idx + 1}: ${step.description || 'Navigate'}
  await page.goto('${step.value}'${timeout});`;

      case 'assert':
        return `// Step ${idx + 1}: ${step.description || 'Assert'}
  await expect(page.locator('${step.target}')).toBeVisible(${timeout});`;

      case 'scroll':
        return `// Step ${idx + 1}: ${step.description || 'Scroll'}
  await page.locator('${step.target}').scrollIntoViewIfNeeded();`;

      case 'hover':
        return `// Step ${idx + 1}: ${step.description || 'Hover'}
  await page.hover('${step.target}'${timeout});`;

      case 'select':
        return `// Step ${idx + 1}: ${step.description || 'Select'}
  await page.selectOption('${step.target}', '${step.value}'${timeout});`;

      default:
        return `// Step ${idx + 1}: Unknown action`;
    }
  }

  /**
   * Generate Cypress test
   */
  private generateCypressTest(flow: UserFlow): string {
    const stepCode = flow.steps
      .map((step, idx) => this.generateCypressStep(step, idx))
      .join('\n    ');

    return `
describe('${flow.name}', () => {
  beforeEach(() => {
    cy.visit('${this.baseUrl}');
  });

  it('should complete user flow', () => {
    ${stepCode}

    // Verify expected outcome
    // TODO: Add assertion for expected outcome
  });
});
    `.trim();
  }

  /**
   * Generate Cypress step
   */
  private generateCypressStep(step: FlowStep, idx: number): string {
    const timeout = step.timeout ? `, { timeout: ${step.timeout} }` : '';

    switch (step.action) {
      case 'click':
        return `// Step ${idx + 1}: ${step.description || 'Click'}
    cy.get('${step.target}').click(${timeout});`;

      case 'type':
        return `// Step ${idx + 1}: ${step.description || 'Type'}
    cy.get('${step.target}').type('${step.value}'${timeout});`;

      case 'wait':
        return `// Step ${idx + 1}: ${step.description || 'Wait'}
    cy.wait(${step.timeout || 1000});`;

      case 'navigate':
        return `// Step ${idx + 1}: ${step.description || 'Navigate'}
    cy.visit('${step.value}');`;

      case 'assert':
        return `// Step ${idx + 1}: ${step.description || 'Assert'}
    cy.get('${step.target}').should('be.visible'${timeout});`;

      case 'scroll':
        return `// Step ${idx + 1}: ${step.description || 'Scroll'}
    cy.get('${step.target}').scrollIntoView();`;

      case 'hover':
        return `// Step ${idx + 1}: ${step.description || 'Hover'}
    cy.get('${step.target}').trigger('mouseover'${timeout});`;

      case 'select':
        return `// Step ${idx + 1}: ${step.description || 'Select'}
    cy.get('${step.target}').select('${step.value}'${timeout});`;

      default:
        return `// Step ${idx + 1}: Unknown action`;
    }
  }

  /**
   * Generate Puppeteer test
   */
  private generatePuppeteerTest(flow: UserFlow): string {
    const stepCode = flow.steps
      .map((step, idx) => this.generatePuppeteerStep(step, idx))
      .join('\n    ');

    return `
import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    // Navigate to base URL
    await page.goto('${this.baseUrl}');

    ${stepCode}

    // Verify expected outcome
    // TODO: Add assertion for expected outcome

    console.log('✓ Test passed: ${flow.name}');
  } catch (error) {
    console.error('✗ Test failed:', error);
  } finally {
    await browser.close();
  }
})();
    `.trim();
  }

  /**
   * Generate Puppeteer step
   */
  private generatePuppeteerStep(step: FlowStep, idx: number): string {
    const timeout = step.timeout ? `, { timeout: ${step.timeout} }` : '';

    switch (step.action) {
      case 'click':
        return `// Step ${idx + 1}: ${step.description || 'Click'}
    await page.click('${step.target}'${timeout});`;

      case 'type':
        return `// Step ${idx + 1}: ${step.description || 'Type'}
    await page.type('${step.target}', '${step.value}'${timeout});`;

      case 'wait':
        return `// Step ${idx + 1}: ${step.description || 'Wait'}
    await page.waitForTimeout(${step.timeout || 1000});`;

      case 'navigate':
        return `// Step ${idx + 1}: ${step.description || 'Navigate'}
    await page.goto('${step.value}'${timeout});`;

      case 'assert':
        return `// Step ${idx + 1}: ${step.description || 'Assert'}
    const element = await page.$('${step.target}');
    if (!element) throw new Error('Element not found: ${step.target}');`;

      case 'scroll':
        return `// Step ${idx + 1}: ${step.description || 'Scroll'}
    await page.evaluate(() => {
      const el = document.querySelector('${step.target}');
      if (el) el.scrollIntoView();
    });`;

      case 'hover':
        return `// Step ${idx + 1}: ${step.description || 'Hover'}
    await page.hover('${step.target}'${timeout});`;

      case 'select':
        return `// Step ${idx + 1}: ${step.description || 'Select'}
    await page.select('${step.target}', '${step.value}'${timeout});`;

      default:
        return `// Step ${idx + 1}: Unknown action`;
    }
  }

  /**
   * Extract assertions from flow
   */
  private extractAssertions(flow: UserFlow): string[] {
    const assertions: string[] = [];

    for (const step of flow.steps) {
      if (step.action === 'assert') {
        assertions.push(`Element ${step.target} should be visible`);
      }
    }

    assertions.push(`Flow should complete with: ${flow.expectedOutcome}`);

    return assertions;
  }

  /**
   * Write test files to disk
   */
  writeTestFiles(outputDir: string): void {
    const testCases = this.generateTestCases();

    for (const testCase of testCases) {
      const filePath = path.join(outputDir, testCase.filePath);
      const dir = path.dirname(filePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, testCase.testCode, 'utf-8');
      console.log(`✓ Generated: ${filePath}`);
    }
  }

  /**
   * Get user flows
   */
  getUserFlows(): UserFlow[] {
    return this.userFlows;
  }

  /**
   * Clear user flows
   */
  clearUserFlows(): void {
    this.userFlows = [];
  }
}
