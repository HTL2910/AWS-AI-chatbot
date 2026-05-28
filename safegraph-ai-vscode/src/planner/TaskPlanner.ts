/**
 * Task Planner - Parse user requests into structured plans
 */

import { TaskPlan, ActionStep, VerificationStep, TaskPlanner as ITaskPlanner } from '../types/TaskPlanner';
import { ToolType } from '../types/ToolAPI';

export class TaskPlanner implements ITaskPlanner {
  private requestPatterns: Map<RegExp, (match: RegExpMatchArray) => Partial<TaskPlan>> = new Map();

  constructor() {
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Pattern: "fix bug in [file]"
    this.requestPatterns.set(
      /fix\s+(?:bug|issue|error)\s+(?:in|at)\s+(.+?)(?:\s+where|$)/i,
      (match) => ({
        title: `Fix bug in ${match[1]}`,
        description: `Analyze and fix bug in ${match[1]}`,
        mode: 'debug',
        riskLevel: 'medium',
      })
    );

    // Pattern: "refactor [file] for [reason]"
    this.requestPatterns.set(
      /refactor\s+(.+?)\s+for\s+(.+?)(?:\s+using|$)/i,
      (match) => ({
        title: `Refactor ${match[1]} for ${match[2]}`,
        description: `Refactor ${match[1]} to improve ${match[2]}`,
        mode: 'code',
        riskLevel: 'medium',
      })
    );

    // Pattern: "create [type] [name]"
    this.requestPatterns.set(
      /create\s+(?:a\s+)?(.+?)\s+(?:called|named|for)\s+(.+?)(?:\s+that|$)/i,
      (match) => ({
        title: `Create ${match[1]} ${match[2]}`,
        description: `Create a new ${match[1]} named ${match[2]}`,
        mode: 'code',
        riskLevel: 'low',
      })
    );

    // Pattern: "research [topic]"
    this.requestPatterns.set(
      /research\s+(?:about\s+)?(.+?)(?:\s+from|$)/i,
      (match) => ({
        title: `Research ${match[1]}`,
        description: `Research and document ${match[1]}`,
        mode: 'web_research',
        riskLevel: 'low',
      })
    );

    // Pattern: "run [command]"
    this.requestPatterns.set(
      /run\s+(?:command\s+)?(.+?)(?:\s+and|$)/i,
      (match) => ({
        title: `Execute: ${match[1]}`,
        description: `Execute command: ${match[1]}`,
        mode: 'debug',
        riskLevel: 'medium',
      })
    );
  }

  async parseRequest(request: string, context?: any): Promise<TaskPlan> {
    const planId = this.generateId();
    let plan: Partial<TaskPlan> = {
      id: planId,
      userRequest: request,
      timestamp: Date.now(),
      requiresApproval: false,
      actions: [],
      verifications: [],
    };

    // Try to match request against patterns
    for (const [pattern, generator] of this.requestPatterns) {
      const match = request.match(pattern);
      if (match) {
        const patternPlan = generator(match);
        plan = { ...plan, ...patternPlan };
        break;
      }
    }

    // If no pattern matched, use generic plan
    if (!plan.title) {
      plan.title = 'Custom Task';
      plan.description = request;
      plan.mode = 'code';
      plan.riskLevel = 'medium';
    }

    // Generate actions based on mode
    plan.actions = this.generateActions(plan as TaskPlan, context);
    plan.verifications = this.generateVerifications(plan as TaskPlan);
    plan.requiresApproval = this.assessRequiresApproval(plan as TaskPlan);
    plan.estimatedDuration = this.estimateDuration(plan as TaskPlan);

    return plan as TaskPlan;
  }

  private generateActions(plan: TaskPlan, context?: any): ActionStep[] {
    const actions: ActionStep[] = [];
    const mode = plan.mode || 'code';

    switch (mode) {
      case 'debug':
        actions.push({
          id: this.generateId(),
          description: 'Analyze error and identify root cause',
          toolId: 'code_analyzer_v1',
          parameters: {
            analysisType: 'all',
            filePath: context?.activeFile || '',
          },
        });
        actions.push({
          id: this.generateId(),
          description: 'Apply fix',
          toolId: 'diff_applier_v1',
          parameters: {
            dryRun: false,
            createBackup: true,
          },
          dependencies: [actions[0]?.id],
        });
        break;

      case 'code':
        actions.push({
          id: this.generateId(),
          description: 'Analyze current code',
          toolId: 'code_analyzer_v1',
          parameters: {
            analysisType: 'refactor',
            filePath: context?.activeFile || '',
          },
        });
        actions.push({
          id: this.generateId(),
          description: 'Generate refactored code',
          toolId: 'file_manager_v1',
          parameters: {
            operation: 'update',
            filePath: context?.activeFile || '',
          },
          dependencies: [actions[0]?.id],
        });
        break;

      case 'web_research':
        actions.push({
          id: this.generateId(),
          description: 'Fetch documentation',
          toolId: 'web_research_v1',
          parameters: {
            seedUrl: context?.seedUrl || '',
            maxPages: 10,
            followLinks: true,
          },
        });
        break;

      default:
        actions.push({
          id: this.generateId(),
          description: 'Execute task',
          toolId: 'terminal_executor_v1',
          parameters: {
            command: plan.userRequest,
          },
        });
    }

    return actions;
  }

  private generateVerifications(plan: TaskPlan): VerificationStep[] {
    const verifications: VerificationStep[] = [];

    // Always verify no errors
    verifications.push({
      id: this.generateId(),
      description: 'Verify no errors in output',
      type: 'output_validation',
      expectedOutput: 'success',
    });

    // Mode-specific verifications
    if (plan.mode === 'code') {
      verifications.push({
        id: this.generateId(),
        description: 'Verify code syntax',
        type: 'command',
        command: 'npm run lint || python -m py_compile',
      });
    }

    if (plan.mode === 'debug') {
      verifications.push({
        id: this.generateId(),
        description: 'Run tests to verify fix',
        type: 'command',
        command: 'npm test || pytest',
      });
    }

    return verifications;
  }

  private assessRequiresApproval(plan: TaskPlan): boolean {
    // High-risk operations require approval
    if (plan.riskLevel === 'high') return true;

    // File modifications require approval
    const hasFileOps = plan.actions.some(a => a.toolId.includes('file_manager'));
    if (hasFileOps) return true;

    // Terminal commands require approval
    const hasTerminalOps = plan.actions.some(a => a.toolId.includes('terminal'));
    if (hasTerminalOps) return true;

    return false;
  }

  validatePlan(plan: TaskPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plan.title) errors.push('Plan must have a title');
    if (!plan.actions || plan.actions.length === 0) errors.push('Plan must have at least one action');
    if (!plan.verifications || plan.verifications.length === 0) errors.push('Plan must have at least one verification');

    // Validate action dependencies
    const actionIds = new Set(plan.actions.map(a => a.id));
    for (const action of plan.actions) {
      if (action.dependencies) {
        for (const depId of action.dependencies) {
          if (!actionIds.has(depId)) {
            errors.push(`Action ${action.id} depends on non-existent action ${depId}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  estimateDuration(plan: TaskPlan): number {
    let duration = 0;

    // Base duration per action
    duration += plan.actions.length * 5000; // 5s per action

    // Add tool-specific durations
    for (const action of plan.actions) {
      if (action.toolId.includes('web_research')) duration += 30000;
      if (action.toolId.includes('terminal')) duration += 15000;
      if (action.toolId.includes('code_analyzer')) duration += 10000;
    }

    // Add verification time
    duration += plan.verifications.length * 3000;

    return duration;
  }

  assessRisk(plan: TaskPlan): 'low' | 'medium' | 'high' {
    let riskScore = 0;

    // File modifications increase risk
    const fileOps = plan.actions.filter(a => a.toolId.includes('file_manager')).length;
    riskScore += fileOps * 30;

    // Terminal commands increase risk
    const terminalOps = plan.actions.filter(a => a.toolId.includes('terminal')).length;
    riskScore += terminalOps * 25;

    // Complex dependencies increase risk
    const complexDeps = plan.actions.filter(a => a.dependencies && a.dependencies.length > 1).length;
    riskScore += complexDeps * 15;

    if (riskScore >= 60) return 'high';
    if (riskScore >= 30) return 'medium';
    return 'low';
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
