import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { BuildArtifact } from './ArtifactBuilder';

export interface ValidationRule {
  name: string;
  type: 'size' | 'type' | 'content' | 'signature' | 'custom';
  condition: (artifact: BuildArtifact) => boolean;
  errorMessage: string;
}

export interface ValidationResult {
  artifact: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  timestamp: string;
}

/**
 * Validates artifacts before release
 * Checks: file size, type, content integrity, signatures, etc.
 */
export class ArtifactValidator {
  private rules: ValidationRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Initialize default validation rules
   */
  private initializeDefaultRules(): void {
    // Rule: File must exist
    this.addRule({
      name: 'file-exists',
      type: 'content',
      condition: (artifact) => fs.existsSync(artifact.path),
      errorMessage: 'Artifact file does not exist',
    });

    // Rule: File size must be > 0
    this.addRule({
      name: 'file-not-empty',
      type: 'size',
      condition: (artifact) => artifact.size > 0,
      errorMessage: 'Artifact file is empty',
    });

    // Rule: File size must be < 500MB
    this.addRule({
      name: 'file-size-limit',
      type: 'size',
      condition: (artifact) => artifact.size < 500 * 1024 * 1024,
      errorMessage: 'Artifact file exceeds 500MB limit',
    });

    // Rule: Hash must be present
    this.addRule({
      name: 'hash-present',
      type: 'content',
      condition: (artifact) => !!artifact.hash && artifact.hash.length > 0,
      errorMessage: 'Artifact hash is missing',
    });
  }

  /**
   * Add custom validation rule
   */
  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Validate VSIX file structure
   */
  private validateVsix(artifact: BuildArtifact): string[] {
    const errors: string[] = [];

    try {
      // VSIX is a ZIP file, check if it can be unzipped
      const result = execSync(`unzip -t "${artifact.path}" 2>&1`, {
        encoding: 'utf-8',
      });

      if (!result.includes('All files OK')) {
        errors.push('VSIX file is corrupted or invalid');
      }

      // Check for required files
      const requiredFiles = ['extension.json', 'package.json'];
      for (const file of requiredFiles) {
        if (!result.includes(file)) {
          errors.push(`VSIX missing required file: ${file}`);
        }
      }
    } catch (error) {
      errors.push(`Failed to validate VSIX: ${String(error)}`);
    }

    return errors;
  }

  /**
   * Validate tarball structure
   */
  private validateTarball(artifact: BuildArtifact): string[] {
    const errors: string[] = [];

    try {
      const result = execSync(`tar -tzf "${artifact.path}" 2>&1 | head -20`, {
        encoding: 'utf-8',
      });

      if (!result || result.length === 0) {
        errors.push('Tarball appears to be empty or corrupted');
      }
    } catch (error) {
      errors.push(`Failed to validate tarball: ${String(error)}`);
    }

    return errors;
  }

  /**
   * Validate ZIP file
   */
  private validateZip(artifact: BuildArtifact): string[] {
    const errors: string[] = [];

    try {
      const result = execSync(`unzip -t "${artifact.path}" 2>&1`, {
        encoding: 'utf-8',
      });

      if (!result.includes('All files OK')) {
        errors.push('ZIP file is corrupted or invalid');
      }
    } catch (error) {
      errors.push(`Failed to validate ZIP: ${String(error)}`);
    }

    return errors;
  }

  /**
   * Validate signature file exists
   */
  private validateSignature(artifact: BuildArtifact): string[] {
    const errors: string[] = [];
    const sigPath = `${artifact.path}.sig`;
    const checksumPath = `${artifact.path}.sha256`;

    if (!fs.existsSync(sigPath) && !fs.existsSync(checksumPath)) {
      errors.push('No signature or checksum file found');
    }

    return errors;
  }

  /**
   * Validate single artifact
   */
  validateArtifact(artifact: BuildArtifact): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Run all rules
    for (const rule of this.rules) {
      if (!rule.condition(artifact)) {
        errors.push(rule.errorMessage);
      }
    }

    // Type-specific validation
    if (artifact.type === 'vsix') {
      errors.push(...this.validateVsix(artifact));
    } else if (artifact.type === 'tarball') {
      errors.push(...this.validateTarball(artifact));
    } else if (artifact.type === 'zip') {
      errors.push(...this.validateZip(artifact));
    }

    // Signature validation
    errors.push(...this.validateSignature(artifact));

    return {
      artifact: artifact.name,
      valid: errors.length === 0,
      errors,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate multiple artifacts
   */
  validateArtifacts(artifacts: BuildArtifact[]): ValidationResult[] {
    return artifacts.map((artifact) => this.validateArtifact(artifact));
  }
}
