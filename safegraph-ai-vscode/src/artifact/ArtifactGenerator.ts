/**
 * Artifact Generator
 * Generates various types of artifacts for verification
 */

import * as vscode from 'vscode';
import { ArtifactStore } from './ArtifactStore';
import { Artifact, ArtifactType, TaskListArtifact, ImplementationPlanArtifact, TestReportArtifact, CodeReviewArtifact, DiffSummaryArtifact, ExecutionLogArtifact } from './ArtifactTypes';
import { bedrockConverse, BedrockConverseOptions } from '../bedrock/bedrockClient';

export class ArtifactGenerator {
  private artifactStore: ArtifactStore;
  private output: vscode.OutputChannel;

  constructor(artifactStore: ArtifactStore, output: vscode.OutputChannel) {
    this.artifactStore = artifactStore;
    this.output = output;
  }

  public async generateTaskList(
    taskId: string,
    agentId: string,
    description: string,
    context: string,
    apiKey: string,
    region: string = 'us-east-1',
    modelId: string = 'anthropic.claude-3-sonnet-20240229-v1:0'
  ): Promise<Artifact> {
    this.output.appendLine('[ArtifactGenerator] Generating task list artifact');

    const prompt = `Generate a detailed task list for the following task:
    
Task: ${description}

Context:
${context}

Format the response as a JSON object with the following structure:
{
  "tasks": [
    {
      "id": "task_1",
      "description": "Task description",
      "status": "pending",
      "priority": 1,
      "estimatedDuration": 300,
      "dependencies": []
    }
  ],
  "summary": "Brief summary of the task list",
  "totalEstimatedDuration": 3600
}`;

    try {
      const options: BedrockConverseOptions = {
        region,
        modelId,
        apiKey,
        maxTokens: 4096,
        temperature: 0.7
      };

      const response = await bedrockConverse(prompt, options);

      const content: TaskListArtifact = JSON.parse(response.text);
      
      return await this.artifactStore.createArtifact(
        'task_list',
        taskId,
        agentId,
        'Task List',
        `Task breakdown for: ${description}`,
        content,
        {
          format: 'json',
          language: 'en'
        }
      );
    } catch (error) {
      this.output.appendLine(`[ArtifactGenerator] Failed to generate task list: ${error}`);
      throw error;
    }
  }

  public async generateImplementationPlan(
    taskId: string,
    agentId: string,
    description: string,
    context: string,
    apiKey: string,
    region: string = 'us-east-1',
    modelId: string = 'anthropic.claude-3-sonnet-20240229-v1:0'
  ): Promise<Artifact> {
    this.output.appendLine('[ArtifactGenerator] Generating implementation plan artifact');

    const prompt = `Generate a detailed implementation plan for the following task:

Task: ${description}

Context:
${context}

Format the response as a JSON object with the following structure:
{
  "phases": [
    {
      "id": "phase_1",
      "name": "Phase name",
      "description": "Phase description",
      "tasks": ["task_id_1", "task_id_2"],
      "dependencies": []
    }
  ],
  "risks": [
    {
      "description": "Risk description",
      "severity": "low|medium|high",
      "mitigation": "Mitigation strategy"
    }
  ],
  "assumptions": ["Assumption 1", "Assumption 2"],
  "successCriteria": ["Criteria 1", "Criteria 2"]
}`;

    try {
      const options: BedrockConverseOptions = {
        region,
        modelId,
        apiKey,
        maxTokens: 4096,
        temperature: 0.7
      };

      const response = await bedrockConverse(prompt, options);

      const content: ImplementationPlanArtifact = JSON.parse(response.text);
      
      return await this.artifactStore.createArtifact(
        'implementation_plan',
        taskId,
        agentId,
        'Implementation Plan',
        `Implementation plan for: ${description}`,
        content,
        {
          format: 'json',
          language: 'en'
        }
      );
    } catch (error) {
      this.output.appendLine(`[ArtifactGenerator] Failed to generate implementation plan: ${error}`);
      throw error;
    }
  }

  public async generateTestReport(
    taskId: string,
    agentId: string,
    testResults: any[]
  ): Promise<Artifact> {
    this.output.appendLine('[ArtifactGenerator] Generating test report artifact');

    const content: TestReportArtifact = {
      summary: {
        total: testResults.length,
        passed: testResults.filter(r => r.status === 'passed').length,
        failed: testResults.filter(r => r.status === 'failed').length,
        skipped: testResults.filter(r => r.status === 'skipped').length,
        duration: testResults.reduce((sum, r) => sum + (r.duration || 0), 0)
      },
      tests: testResults.map(r => ({
        name: r.name,
        status: r.status,
        duration: r.duration || 0,
        error: r.error
      }))
    };

    return await this.artifactStore.createArtifact(
      'test_report',
      taskId,
      agentId,
      'Test Report',
      `Test execution report`,
      content,
      {
        format: 'json',
        language: 'en'
      }
    );
  }

  public async generateCodeReview(
    taskId: string,
    agentId: string,
    codeChanges: any[],
    context: string,
    apiKey: string,
    region: string = 'us-east-1',
    modelId: string = 'anthropic.claude-3-sonnet-20240229-v1:0'
  ): Promise<Artifact> {
    this.output.appendLine('[ArtifactGenerator] Generating code review artifact');

    const prompt = `Review the following code changes and provide feedback:

Code Changes:
${JSON.stringify(codeChanges, null, 2)}

Context:
${context}

Format the response as a JSON object with the following structure:
{
  "summary": "Overall review summary",
  "overallRating": "excellent|good|fair|poor",
  "findings": [
    {
      "type": "security|performance|style|bug|suggestion",
      "severity": "critical|high|medium|low",
      "file": "file path",
      "line": 123,
      "description": "Issue description",
      "suggestion": "Suggested fix"
    }
  ],
  "metrics": {
    "complexity": 5,
    "maintainability": 8,
    "testCoverage": 75,
    "duplication": 10
  }
}`;

    try {
      const options: BedrockConverseOptions = {
        region,
        modelId,
        apiKey,
        maxTokens: 4096,
        temperature: 0.7
      };

      const response = await bedrockConverse(prompt, options);

      const content: CodeReviewArtifact = JSON.parse(response.text);
      
      return await this.artifactStore.createArtifact(
        'code_review',
        taskId,
        agentId,
        'Code Review',
        `Review of code changes`,
        content,
        {
          format: 'json',
          language: 'en'
        }
      );
    } catch (error) {
      this.output.appendLine(`[ArtifactGenerator] Failed to generate code review: ${error}`);
      throw error;
    }
  }

  public async generateDiffSummary(
    taskId: string,
    agentId: string,
    diff: string,
    filesChanged: string[]
  ): Promise<Artifact> {
    this.output.appendLine('[ArtifactGenerator] Generating diff summary artifact');

    // Parse diff to calculate statistics
    const lines = diff.split('\n');
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
      if (line.startsWith('-') && !line.startsWith('---')) linesRemoved++;
    }

    const content: DiffSummaryArtifact = {
      summary: `Changed ${filesChanged.length} files: +${linesAdded} -${linesRemoved} lines`,
      filesChanged: filesChanged.length,
      linesAdded,
      linesRemoved,
      changes: filesChanged.map(file => ({
        file,
        type: 'modified',
        additions: Math.floor(linesAdded / filesChanged.length),
        deletions: Math.floor(linesRemoved / filesChanged.length)
      })),
      riskAssessment: linesAdded + linesRemoved > 1000 ? 'high' : linesAdded + linesRemoved > 500 ? 'medium' : 'low'
    };

    return await this.artifactStore.createArtifact(
      'diff_summary',
      taskId,
      agentId,
      'Diff Summary',
      `Summary of code changes`,
      content,
      {
        format: 'json',
        language: 'en'
      }
    );
  }

  public async generateExecutionLog(
    taskId: string,
    agentId: string,
    command: string,
    exitCode: number,
    output: string,
    error?: string,
    duration?: number,
    workingDirectory?: string
  ): Promise<Artifact> {
    this.output.appendLine('[ArtifactGenerator] Generating execution log artifact');

    const content: ExecutionLogArtifact = {
      command,
      exitCode,
      output,
      error,
      duration: duration || 0,
      timestamp: Date.now(),
      workingDirectory: workingDirectory || process.cwd()
    };

    return await this.artifactStore.createArtifact(
      'execution_log',
      taskId,
      agentId,
      'Execution Log',
      `Log of command execution: ${command}`,
      content,
      {
        format: 'json',
        language: 'en'
      }
    );
  }

  public async generateArtifactFromContent(
    type: ArtifactType,
    taskId: string,
    agentId: string,
    title: string,
    description: string,
    content: any
  ): Promise<Artifact> {
    this.output.appendLine(`[ArtifactGenerator] Generating ${type} artifact from content`);

    return await this.artifactStore.createArtifact(
      type,
      taskId,
      agentId,
      title,
      description,
      content,
      {
        format: 'json',
        language: 'en'
      }
    );
  }
}
