import * as vscode from 'vscode';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

/**
 * SmokeTestRunner: Run smoke tests on staging environment
 * Validates basic functionality before production deployment
 */
export class SmokeTestRunner {
  private outputChannel: vscode.OutputChannel;
  private client: AxiosInstance;
  private baseURL: string;
  private timeout: number;

  constructor(outputChannel: vscode.OutputChannel, baseURL: string, timeout: number = 30000) {
    this.outputChannel = outputChannel;
    this.baseURL = baseURL;
    this.timeout = timeout;
    this.client = axios.create({
      baseURL,
      timeout,
      validateStatus: () => true, // Don't throw on any status
    });
  }

  /**
   * Run all smoke tests
   */
  async runAll(): Promise<SmokeTestResult> {
    this.outputChannel.appendLine(`\n🔥 [SmokeTestRunner] Starting smoke tests...`);
    this.outputChannel.appendLine(`   Base URL: ${this.baseURL}`);

    const results: TestResult[] = [];
    const startTime = Date.now();

    try {
      // 1. Health check
      results.push(await this.testHealthCheck());

      // 2. API endpoints
      results.push(await this.testAPIEndpoints());

      // 3. Database connectivity
      results.push(await this.testDatabaseConnectivity());

      // 4. Authentication
      results.push(await this.testAuthentication());

      // 5. Core functionality
      results.push(await this.testCoreFunctionality());

      // 6. Performance baseline
      results.push(await this.testPerformanceBaseline());

      const duration = Date.now() - startTime;
      const passed = results.filter(r => r.passed).length;
      const failed = results.filter(r => !r.passed).length;

      this.outputChannel.appendLine(`\n📊 Smoke Test Summary:`);
      this.outputChannel.appendLine(`   ✅ Passed: ${passed}/${results.length}`);
      this.outputChannel.appendLine(`   ❌ Failed: ${failed}/${results.length}`);
      this.outputChannel.appendLine(`   ⏱️  Duration: ${duration}ms`);

      return {
        passed: failed === 0,
        totalTests: results.length,
        passedTests: passed,
        failedTests: failed,
        duration,
        results,
      };
    } catch (error) {
      this.outputChannel.appendLine(`❌ Smoke tests failed: ${error}`);
      throw error;
    }
  }

  /**
   * Test health check endpoint
   */
  private async testHealthCheck(): Promise<TestResult> {
    this.outputChannel.appendLine(`\n   🏥 Testing health check...`);

    try {
      const response = await this.client.get('/health');
      const passed = response.status === 200;

      if (passed) {
        this.outputChannel.appendLine(`      ✅ Health check passed (${response.status})`);
      } else {
        this.outputChannel.appendLine(`      ❌ Health check failed (${response.status})`);
      }

      return {
        name: 'Health Check',
        passed,
        statusCode: response.status,
        duration: 0,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Health check error: ${error}`);
      return {
        name: 'Health Check',
        passed: false,
        error: String(error),
        duration: 0,
      };
    }
  }

  /**
   * Test API endpoints
   */
  private async testAPIEndpoints(): Promise<TestResult> {
    this.outputChannel.appendLine(`\n   🔌 Testing API endpoints...`);

    const endpoints = [
      { method: 'GET', path: '/api/version', expectedStatus: 200 },
      { method: 'GET', path: '/api/config', expectedStatus: 200 },
      { method: 'POST', path: '/api/chat', expectedStatus: 400 }, // Should fail without message
    ];

    let allPassed = true;

    for (const endpoint of endpoints) {
      try {
        const response = endpoint.method === 'GET'
          ? await this.client.get(endpoint.path)
          : await this.client.post(endpoint.path, {});

        const passed = response.status === endpoint.expectedStatus;
        allPassed = allPassed && passed;

        const status = passed ? '✅' : '❌';
        this.outputChannel.appendLine(`      ${status} ${endpoint.method} ${endpoint.path} (${response.status})`);
      } catch (error) {
        allPassed = false;
        this.outputChannel.appendLine(`      ❌ ${endpoint.method} ${endpoint.path} error: ${error}`);
      }
    }

    return {
      name: 'API Endpoints',
      passed: allPassed,
      duration: 0,
    };
  }

  /**
   * Test database connectivity
   */
  private async testDatabaseConnectivity(): Promise<TestResult> {
    this.outputChannel.appendLine(`\n   🗄️  Testing database connectivity...`);

    try {
      const response = await this.client.get('/api/db-status');
      const passed = response.status === 200 && response.data?.connected === true;

      if (passed) {
        this.outputChannel.appendLine(`      ✅ Database connected`);
      } else {
        this.outputChannel.appendLine(`      ❌ Database not connected`);
      }

      return {
        name: 'Database Connectivity',
        passed,
        statusCode: response.status,
        duration: 0,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Database test error: ${error}`);
      return {
        name: 'Database Connectivity',
        passed: false,
        error: String(error),
        duration: 0,
      };
    }
  }

  /**
   * Test authentication
   */
  private async testAuthentication(): Promise<TestResult> {
    this.outputChannel.appendLine(`\n   🔐 Testing authentication...`);

    try {
      // Test without token (should fail)
      const response1 = await this.client.get('/api/protected');
      const noTokenFails = response1.status === 401 || response1.status === 403;

      // Test with invalid token (should fail)
      const response2 = await this.client.get('/api/protected', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const invalidTokenFails = response2.status === 401 || response2.status === 403;

      const passed = noTokenFails && invalidTokenFails;

      if (passed) {
        this.outputChannel.appendLine(`      ✅ Authentication working correctly`);
      } else {
        this.outputChannel.appendLine(`      ❌ Authentication not working as expected`);
      }

      return {
        name: 'Authentication',
        passed,
        duration: 0,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Authentication test error: ${error}`);
      return {
        name: 'Authentication',
        passed: false,
        error: String(error),
        duration: 0,
      };
    }
  }

  /**
   * Test core functionality
   */
  private async testCoreFunctionality(): Promise<TestResult> {
    this.outputChannel.appendLine(`\n   ⚙️  Testing core functionality...`);

    try {
      // Test chat endpoint with valid message
      const response = await this.client.post('/chat', {
        message: 'Hello, test message',
      });

      const passed = response.status === 200 && response.data?.message;

      if (passed) {
        this.outputChannel.appendLine(`      ✅ Core functionality working`);
      } else {
        this.outputChannel.appendLine(`      ❌ Core functionality failed`);
      }

      return {
        name: 'Core Functionality',
        passed,
        statusCode: response.status,
        duration: 0,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Core functionality test error: ${error}`);
      return {
        name: 'Core Functionality',
        passed: false,
        error: String(error),
        duration: 0,
      };
    }
  }

  /**
   * Test performance baseline
   */
  private async testPerformanceBaseline(): Promise<TestResult> {
    this.outputChannel.appendLine(`\n   ⚡ Testing performance baseline...`);

    try {
      const startTime = Date.now();
      const response = await this.client.get('/health');
      const duration = Date.now() - startTime;

      const maxDuration = 5000; // 5 seconds
      const passed = duration < maxDuration && response.status === 200;

      if (passed) {
        this.outputChannel.appendLine(`      ✅ Performance baseline OK (${duration}ms)`);
      } else {
        this.outputChannel.appendLine(`      ❌ Performance baseline failed (${duration}ms > ${maxDuration}ms)`);
      }

      return {
        name: 'Performance Baseline',
        passed,
        duration,
      };
    } catch (error) {
      this.outputChannel.appendLine(`      ❌ Performance test error: ${error}`);
      return {
        name: 'Performance Baseline',
        passed: false,
        error: String(error),
        duration: 0,
      };
    }
  }
}

export interface TestResult {
  name: string;
  passed: boolean;
  statusCode?: number;
  error?: string;
  duration: number;
}

export interface SmokeTestResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: TestResult[];
}
