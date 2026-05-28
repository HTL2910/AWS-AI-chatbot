/**
 * Security Scanner - SAST, dependency scanning, CVE detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { SecurityIssue } from '../types/TestFramework';

export class SecurityScanner {
  private workspaceFolder: string;
  private issues: SecurityIssue[] = [];
  private cveDatabase: Map<string, any> = new Map();

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
    this.loadCVEDatabase();
  }

  /**
   * Scan a file for security issues (SAST)
   */
  async scan(filePath: string): Promise<SecurityIssue[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const fileIssues: SecurityIssue[] = [];

    // Run various security checks
    fileIssues.push(...this.checkForSQLInjection(content, filePath));
    fileIssues.push(...this.checkForXSS(content, filePath));
    fileIssues.push(...this.checkForHardcodedSecrets(content, filePath));
    fileIssues.push(...this.checkForInsecureDeserialization(content, filePath));
    fileIssues.push(...this.checkForPathTraversal(content, filePath));
    fileIssues.push(...this.checkForInsecureCrypto(content, filePath));
    fileIssues.push(...this.checkForCommandInjection(content, filePath));
    fileIssues.push(...this.checkForWeakAuthentication(content, filePath));

    this.issues.push(...fileIssues);
    return fileIssues;
  }

  /**
   * Scan dependencies for known vulnerabilities
   */
  async scanDependencies(): Promise<SecurityIssue[]> {
    const depIssues: SecurityIssue[] = [];

    try {
      // Check package.json
      const packageJsonPath = path.join(this.workspaceFolder, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        for (const [pkg, version] of Object.entries(allDeps)) {
          const vulns = await this.checkPackageVulnerabilities(pkg as string, version as string);
          depIssues.push(...vulns);
        }
      }

      // Run npm audit if available
      depIssues.push(...this.runNpmAudit());
    } catch (error) {
      console.error('Error scanning dependencies:', error);
    }

    this.issues.push(...depIssues);
    return depIssues;
  }

  /**
   * Scan for CVEs
   */
  async scanForCVEs(): Promise<SecurityIssue[]> {
    const cveIssues: SecurityIssue[] = [];

    try {
      // Check for known CVEs in dependencies
      const packageJsonPath = path.join(this.workspaceFolder, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        for (const [pkg, version] of Object.entries(allDeps)) {
          const cves = this.getCVEsForPackage(pkg as string, version as string);
          cveIssues.push(...cves);
        }
      }
    } catch (error) {
      console.error('Error scanning for CVEs:', error);
    }

    this.issues.push(...cveIssues);
    return cveIssues;
  }

  /**
   * Check for SQL injection vulnerabilities
   */
  private checkForSQLInjection(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /query\s*\(\s*[`'"]\s*SELECT\s+.*?\$\{/gi,
      /execute\s*\(\s*[`'"]\s*SELECT\s+.*?\$\{/gi,
      /db\.query\s*\(\s*[`'"]\s*SELECT\s+.*?\+/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `sql_injection_${Date.now()}`,
          type: 'vulnerability',
          severity: 'high',
          title: 'Potential SQL Injection',
          description: 'SQL query constructed with user input without parameterization',
          filePath,
          lineNumber,
          remediation: 'Use parameterized queries or prepared statements',
        });
      }
    }

    return issues;
  }

  /**
   * Check for XSS vulnerabilities
   */
  private checkForXSS(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /innerHTML\s*=\s*(?!.*sanitize|.*escape)/gi,
      /dangerouslySetInnerHTML/gi,
      /eval\s*\(/gi,
      /Function\s*\(\s*[`'"]/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `xss_${Date.now()}`,
          type: 'vulnerability',
          severity: 'high',
          title: 'Potential XSS Vulnerability',
          description: 'User input may be rendered without proper escaping',
          filePath,
          lineNumber,
          remediation: 'Use textContent instead of innerHTML, or sanitize HTML input',
        });
      }
    }

    return issues;
  }

  /**
   * Check for hardcoded secrets
   */
  private checkForHardcodedSecrets(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /(?:password|passwd|pwd)\s*[:=]\s*[`'"](.*?)[`'"]/gi,
      /(?:api[_-]?key|apikey)\s*[:=]\s*[`'"](.*?)[`'"]/gi,
      /(?:secret|token)\s*[:=]\s*[`'"](.*?)[`'"]/gi,
      /(?:private[_-]?key|privatekey)\s*[:=]\s*[`'"](.*?)[`'"]/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `hardcoded_secret_${Date.now()}`,
          type: 'vulnerability',
          severity: 'critical',
          title: 'Hardcoded Secret',
          description: 'Sensitive credential found in source code',
          filePath,
          lineNumber,
          remediation: 'Move secrets to environment variables or secure vault',
        });
      }
    }

    return issues;
  }

  /**
   * Check for insecure deserialization
   */
  private checkForInsecureDeserialization(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /JSON\.parse\s*\(\s*userInput/gi,
      /pickle\.loads\s*\(/gi,
      /yaml\.load\s*\(/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `insecure_deser_${Date.now()}`,
          type: 'vulnerability',
          severity: 'high',
          title: 'Insecure Deserialization',
          description: 'Untrusted data deserialized without validation',
          filePath,
          lineNumber,
          remediation: 'Validate and sanitize input before deserialization',
        });
      }
    }

    return issues;
  }

  /**
   * Check for path traversal vulnerabilities
   */
  private checkForPathTraversal(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /fs\.readFile\s*\(\s*userInput/gi,
      /fs\.writeFile\s*\(\s*userInput/gi,
      /path\.join\s*\(\s*[`'"]/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `path_traversal_${Date.now()}`,
          type: 'vulnerability',
          severity: 'high',
          title: 'Path Traversal Vulnerability',
          description: 'File path constructed from user input without validation',
          filePath,
          lineNumber,
          remediation: 'Validate and sanitize file paths, use allowlist',
        });
      }
    }

    return issues;
  }

  /**
   * Check for insecure cryptography
   */
  private checkForInsecureCrypto(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /crypto\.createCipher\s*\(/gi, // Deprecated
      /md5\s*\(/gi,
      /sha1\s*\(/gi,
      /Math\.random\s*\(\)/gi, // For security purposes
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `insecure_crypto_${Date.now()}`,
          type: 'weakness',
          severity: 'medium',
          title: 'Insecure Cryptography',
          description: 'Weak or deprecated cryptographic algorithm used',
          filePath,
          lineNumber,
          remediation: 'Use modern cryptographic algorithms (AES-256, SHA-256)',
        });
      }
    }

    return issues;
  }

  /**
   * Check for command injection
   */
  private checkForCommandInjection(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /exec\s*\(\s*[`'"]\s*.*?\$\{/gi,
      /spawn\s*\(\s*userInput/gi,
      /shell\s*:\s*true/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `cmd_injection_${Date.now()}`,
          type: 'vulnerability',
          severity: 'critical',
          title: 'Command Injection',
          description: 'User input used in shell command execution',
          filePath,
          lineNumber,
          remediation: 'Use array arguments instead of shell strings, validate input',
        });
      }
    }

    return issues;
  }

  /**
   * Check for weak authentication
   */
  private checkForWeakAuthentication(content: string, filePath: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const patterns = [
      /password\s*===\s*[`'"]/gi,
      /token\s*===\s*[`'"]/gi,
      /basicAuth\s*=\s*false/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `weak_auth_${Date.now()}`,
          type: 'weakness',
          severity: 'high',
          title: 'Weak Authentication',
          description: 'Hardcoded or weak authentication mechanism',
          filePath,
          lineNumber,
          remediation: 'Use secure authentication libraries, hash passwords',
        });
      }
    }

    return issues;
  }

  /**
   * Check package for known vulnerabilities
   */
  private async checkPackageVulnerabilities(pkg: string, version: string): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];

    // This would normally call a vulnerability database API
    // For now, we'll check against a local database
    const vulns = this.cveDatabase.get(pkg);
    if (vulns) {
      for (const vuln of vulns) {
        if (this.isVersionVulnerable(version, vuln.affectedVersions)) {
          issues.push({
            id: vuln.cveId,
            type: 'vulnerability',
            severity: vuln.severity,
            title: vuln.title,
            description: vuln.description,
            filePath: 'package.json',
            cveId: vuln.cveId,
            remediation: `Update ${pkg} to version ${vuln.patchedVersion} or later`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Get CVEs for a package
   */
  private getCVEsForPackage(pkg: string, version: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const vulns = this.cveDatabase.get(pkg);

    if (vulns) {
      for (const vuln of vulns) {
        if (this.isVersionVulnerable(version, vuln.affectedVersions)) {
          issues.push({
            id: vuln.cveId,
            type: 'vulnerability',
            severity: vuln.severity,
            title: vuln.title,
            description: vuln.description,
            filePath: 'package.json',
            cveId: vuln.cveId,
            remediation: `Update ${pkg} to version ${vuln.patchedVersion} or later`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check if version is vulnerable
   */
  private isVersionVulnerable(version: string, affectedVersions: string[]): boolean {
    // Simple version comparison (would need more sophisticated logic in production)
    const cleanVersion = version.replace(/^[~^]/, '');
    return affectedVersions.some((v) => v === cleanVersion || v === '*');
  }

  /**
   * Run npm audit
   */
  private runNpmAudit(): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    try {
      const output = execSync('npm audit --json', {
        cwd: this.workspaceFolder,
        encoding: 'utf-8',
      });

      const auditResult = JSON.parse(output);
      if (auditResult.vulnerabilities) {
        for (const [pkg, vuln] of Object.entries(auditResult.vulnerabilities)) {
          issues.push({
            id: `npm_audit_${pkg}`,
            type: 'vulnerability',
            severity: (vuln as any).severity || 'medium',
            title: `Vulnerability in ${pkg}`,
            description: (vuln as any).via?.[0]?.title || 'Unknown vulnerability',
            filePath: 'package.json',
            remediation: `Run npm audit fix or update ${pkg}`,
          });
        }
      }
    } catch (error) {
      // npm audit may not be available or may fail
    }

    return issues;
  }

  /**
   * Load CVE database
   */
  private loadCVEDatabase(): void {
    // In production, this would load from a real CVE database
    // For now, we'll use a minimal example
    this.cveDatabase.set('lodash', [
      {
        cveId: 'CVE-2021-23337',
        title: 'Lodash prototype pollution',
        description: 'Prototype pollution vulnerability in lodash',
        severity: 'high',
        affectedVersions: ['<4.17.21'],
        patchedVersion: '4.17.21',
      },
    ]);
  }

  /**
   * Get all issues
   */
  getAllIssues(): SecurityIssue[] {
    return this.issues;
  }

  /**
   * Get issues by severity
   */
  getIssuesBySeverity(severity: string): SecurityIssue[] {
    return this.issues.filter((i) => i.severity === severity);
  }

  /**
   * Clear issues
   */
  clearIssues(): void {
    this.issues = [];
  }
}
