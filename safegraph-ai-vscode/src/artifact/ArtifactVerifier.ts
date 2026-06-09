/**
 * Artifact Verifier
 * Verifies agent work via artifacts
 */

import * as vscode from 'vscode';
import { ArtifactStore } from './ArtifactStore';
import { Artifact, ArtifactType } from './ArtifactTypes';

export interface VerificationResult {
  artifactId: string;
  verified: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}

export class ArtifactVerifier {
  private artifactStore: ArtifactStore;
  private output: vscode.OutputChannel;

  constructor(artifactStore: ArtifactStore, output: vscode.OutputChannel) {
    this.artifactStore = artifactStore;
    this.output = output;
  }

  public async verifyArtifact(artifactId: string): Promise<VerificationResult> {
    const artifact = this.artifactStore.getArtifact(artifactId);
    if (!artifact) {
      return {
        artifactId,
        verified: false,
        confidence: 0,
        issues: ['Artifact not found'],
        suggestions: []
      };
    }

    this.output.appendLine(`[ArtifactVerifier] Verifying artifact: ${artifact.title}`);

    switch (artifact.type) {
      case 'task_list':
        return this.verifyTaskList(artifact);
      case 'implementation_plan':
        return this.verifyImplementationPlan(artifact);
      case 'test_report':
        return this.verifyTestReport(artifact);
      case 'code_review':
        return this.verifyCodeReview(artifact);
      case 'diff_summary':
        return this.verifyDiffSummary(artifact);
      case 'execution_log':
        return this.verifyExecutionLog(artifact);
      default:
        return this.verifyGenericArtifact(artifact);
    }
  }

  private verifyTaskList(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    const content = artifact.content as any;
    
    if (!content.tasks || !Array.isArray(content.tasks)) {
      issues.push('Task list must have a tasks array');
      confidence = 0;
    } else if (content.tasks.length === 0) {
      issues.push('Task list is empty');
      confidence = 0.3;
    } else {
      // Validate each task
      content.tasks.forEach((task: any, index: number) => {
        if (!task.description) {
          issues.push(`Task ${index} is missing description`);
          confidence -= 0.1;
        }
        if (!task.status) {
          suggestions.push(`Task ${index} is missing status`);
        }
        if (!task.priority && task.priority !== 0) {
          suggestions.push(`Task ${index} is missing priority`);
        }
      });
    }

    if (!content.summary) {
      suggestions.push('Task list is missing summary');
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.5,
      confidence: Math.max(0, confidence),
      issues,
      suggestions
    };
  }

  private verifyImplementationPlan(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    const content = artifact.content as any;

    if (!content.phases || !Array.isArray(content.phases)) {
      issues.push('Implementation plan must have phases array');
      confidence = 0;
    } else if (content.phases.length === 0) {
      issues.push('Implementation plan has no phases');
      confidence = 0.3;
    } else {
      content.phases.forEach((phase: any, index: number) => {
        if (!phase.name) {
          issues.push(`Phase ${index} is missing name`);
          confidence -= 0.1;
        }
        if (!phase.description) {
          suggestions.push(`Phase ${index} is missing description`);
        }
        if (!phase.tasks || !Array.isArray(phase.tasks)) {
          issues.push(`Phase ${index} is missing tasks array`);
          confidence -= 0.1;
        }
      });
    }

    if (!content.risks || !Array.isArray(content.risks)) {
      suggestions.push('Implementation plan is missing risk assessment');
    }

    if (!content.successCriteria || !Array.isArray(content.successCriteria)) {
      suggestions.push('Implementation plan is missing success criteria');
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.5,
      confidence: Math.max(0, confidence),
      issues,
      suggestions
    };
  }

  private verifyTestReport(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    const content = artifact.content as any;

    if (!content.summary) {
      issues.push('Test report is missing summary');
      confidence = 0.3;
    } else {
      if (content.summary.total === 0) {
        issues.push('No tests were executed');
        confidence = 0.2;
      }
      if (content.summary.failed > 0) {
        issues.push(`${content.summary.failed} test(s) failed`);
        confidence -= 0.3;
      }
      if (content.summary.passed === content.summary.total && content.summary.total > 0) {
        confidence = 1.0; // All tests passed
      }
    }

    if (!content.tests || !Array.isArray(content.tests)) {
      suggestions.push('Test report is missing detailed test results');
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.5,
      confidence: Math.max(0, confidence),
      issues,
      suggestions
    };
  }

  private verifyCodeReview(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    const content = artifact.content as any;

    if (!content.summary) {
      suggestions.push('Code review is missing summary');
    }

    if (!content.overallRating) {
      suggestions.push('Code review is missing overall rating');
    } else {
      if (content.overallRating === 'poor') {
        issues.push('Code review rating is poor');
        confidence = 0.3;
      } else if (content.overallRating === 'fair') {
        suggestions.push('Code review rating is fair - consider improvements');
        confidence = 0.6;
      }
    }

    if (!content.findings || !Array.isArray(content.findings)) {
      suggestions.push('Code review is missing findings');
    } else {
      const criticalIssues = content.findings.filter((f: any) => f.severity === 'critical');
      if (criticalIssues.length > 0) {
        issues.push(`${criticalIssues.length} critical issue(s) found`);
        confidence -= 0.4;
      }
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.5,
      confidence: Math.max(0, confidence),
      issues,
      suggestions
    };
  }

  private verifyDiffSummary(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    const content = artifact.content as any;

    if (!content.summary) {
      suggestions.push('Diff summary is missing summary');
    }

    if (content.filesChanged === 0) {
      issues.push('No files were changed');
      confidence = 0.2;
    }

    if (content.riskAssessment === 'high') {
      issues.push('High risk changes detected');
      suggestions.push('Review changes carefully before applying');
      confidence = 0.5;
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.3,
      confidence: Math.max(0, confidence),
      issues,
      suggestions
    };
  }

  private verifyExecutionLog(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 1.0;

    const content = artifact.content as any;

    if (content.exitCode !== 0) {
      issues.push(`Command failed with exit code ${content.exitCode}`);
      confidence = 0;
    }

    if (content.error) {
      issues.push(`Command error: ${content.error}`);
      confidence = 0;
    }

    if (!content.output) {
      suggestions.push('Command produced no output');
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.5,
      confidence: Math.max(0, confidence),
      issues,
      suggestions
    };
  }

  private verifyGenericArtifact(artifact: Artifact): VerificationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0.7; // Default confidence for generic artifacts

    if (!artifact.content) {
      issues.push('Artifact has no content');
      confidence = 0;
    }

    if (!artifact.description) {
      suggestions.push('Artifact is missing description');
    }

    return {
      artifactId: artifact.id,
      verified: confidence > 0.5,
      confidence,
      issues,
      suggestions
    };
  }

  public async verifyTaskArtifacts(taskId: string): Promise<VerificationResult[]> {
    const artifacts = this.artifactStore.getArtifactsByTask(taskId);
    const results: VerificationResult[] = [];

    for (const artifact of artifacts) {
      const result = await this.verifyArtifact(artifact.id);
      results.push(result);
    }

    return results;
  }

  public async approveArtifact(artifactId: string): Promise<boolean> {
    const artifact = await this.artifactStore.approveArtifact(artifactId);
    return artifact !== null;
  }

  public async rejectArtifact(artifactId: string): Promise<boolean> {
    const artifact = await this.artifactStore.rejectArtifact(artifactId);
    return artifact !== null;
  }
}
