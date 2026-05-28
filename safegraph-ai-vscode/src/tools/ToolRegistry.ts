/**
 * Tool Registry - Central registry for all available tools
 */

import { ToolDefinition, ToolType, ToolCall, ToolRegistry as IToolRegistry } from '../types/ToolAPI';

export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private toolsByType: Map<ToolType, ToolDefinition[]> = new Map();

  constructor() {
    this.initializeDefaultTools();
  }

  private initializeDefaultTools(): void {
    // Code Analyzer Tool
    this.register({
      id: 'code_analyzer_v1',
      type: ToolType.CODE_ANALYZER,
      name: 'Code Analyzer',
      description: 'Analyze code for refactoring, security, performance, and style issues',
      category: 'analysis',
      timeout: 30000,
      parameters: [
        {
          name: 'filePath',
          type: 'string',
          description: 'Path to file to analyze',
          required: true,
        },
        {
          name: 'analysisType',
          type: 'string',
          description: 'Type of analysis to perform',
          required: true,
          enum: ['refactor', 'security', 'performance', 'style', 'all'],
        },
        {
          name: 'language',
          type: 'string',
          description: 'Programming language (auto-detect if not specified)',
          required: false,
        },
      ],
    });

    // File Manager Tool
    this.register({
      id: 'file_manager_v1',
      type: ToolType.FILE_MANAGER,
      name: 'File Manager',
      description: 'Create, read, update, delete, and move files',
      category: 'execution',
      timeout: 10000,
      requiresApproval: true,
      parameters: [
        {
          name: 'operation',
          type: 'string',
          description: 'File operation to perform',
          required: true,
          enum: ['create', 'read', 'update', 'delete', 'move'],
        },
        {
          name: 'filePath',
          type: 'string',
          description: 'Path to file',
          required: true,
        },
        {
          name: 'content',
          type: 'string',
          description: 'File content (for create/update)',
          required: false,
        },
        {
          name: 'newPath',
          type: 'string',
          description: 'New path (for move operation)',
          required: false,
        },
        {
          name: 'createBackup',
          type: 'boolean',
          description: 'Create backup before modifying',
          required: false,
          default: true,
        },
      ],
    });

    // Terminal Executor Tool
    this.register({
      id: 'terminal_executor_v1',
      type: ToolType.TERMINAL_EXECUTOR,
      name: 'Terminal Executor',
      description: 'Execute terminal commands and capture output',
      category: 'execution',
      timeout: 60000,
      requiresApproval: true,
      parameters: [
        {
          name: 'command',
          type: 'string',
          description: 'Command to execute',
          required: true,
        },
        {
          name: 'cwd',
          type: 'string',
          description: 'Working directory',
          required: false,
        },
        {
          name: 'timeout',
          type: 'number',
          description: 'Command timeout in milliseconds',
          required: false,
          default: 30000,
        },
        {
          name: 'captureOutput',
          type: 'boolean',
          description: 'Capture stdout/stderr',
          required: false,
          default: true,
        },
      ],
    });

    // Web Research Tool
    this.register({
      id: 'web_research_v1',
      type: ToolType.WEB_RESEARCH,
      name: 'Web Research',
      description: 'Fetch and parse web documentation',
      category: 'research',
      timeout: 45000,
      parameters: [
        {
          name: 'seedUrl',
          type: 'string',
          description: 'Starting URL to fetch',
          required: true,
        },
        {
          name: 'maxPages',
          type: 'number',
          description: 'Maximum pages to fetch',
          required: false,
          default: 10,
        },
        {
          name: 'followLinks',
          type: 'boolean',
          description: 'Follow related links',
          required: false,
          default: true,
        },
        {
          name: 'parseMarkdown',
          type: 'boolean',
          description: 'Parse as Markdown',
          required: false,
          default: true,
        },
      ],
    });

    // Diff Applier Tool
    this.register({
      id: 'diff_applier_v1',
      type: ToolType.DIFF_APPLIER,
      name: 'Diff Applier',
      description: 'Apply unified diffs to files with transaction support',
      category: 'apply',
      timeout: 15000,
      requiresApproval: true,
      parameters: [
        {
          name: 'diffContent',
          type: 'string',
          description: 'Unified diff content',
          required: true,
        },
        {
          name: 'targetFile',
          type: 'string',
          description: 'Target file path',
          required: true,
        },
        {
          name: 'dryRun',
          type: 'boolean',
          description: 'Preview without applying',
          required: false,
          default: false,
        },
        {
          name: 'createBackup',
          type: 'boolean',
          description: 'Create backup before applying',
          required: false,
          default: true,
        },
      ],
    });
  }

  register(definition: ToolDefinition): void {
    this.tools.set(definition.id, definition);
    if (!this.toolsByType.has(definition.type)) {
      this.toolsByType.set(definition.type, []);
    }
    this.toolsByType.get(definition.type)!.push(definition);
  }

  unregister(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (tool) {
      this.tools.delete(toolId);
      const typeTools = this.toolsByType.get(tool.type);
      if (typeTools) {
        const index = typeTools.findIndex(t => t.id === toolId);
        if (index > -1) {
          typeTools.splice(index, 1);
        }
      }
    }
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getByType(type: ToolType): ToolDefinition[] {
    return this.toolsByType.get(type) || [];
  }

  validate(call: ToolCall): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const tool = this.tools.get(call.toolId);

    if (!tool) {
      errors.push(`Tool not found: ${call.toolId}`);
      return { valid: false, errors };
    }

    // Validate required parameters
    for (const param of tool.parameters) {
      if (param.required && !(call.parameters[param.name] !== undefined)) {
        errors.push(`Missing required parameter: ${param.name}`);
      }
    }

    // Validate parameter types
    for (const [paramName, paramValue] of Object.entries(call.parameters)) {
      const paramDef = tool.parameters.find(p => p.name === paramName);
      if (paramDef && paramValue !== undefined) {
        const actualType = Array.isArray(paramValue) ? 'array' : typeof paramValue;
        if (actualType !== paramDef.type) {
          errors.push(`Invalid type for ${paramName}: expected ${paramDef.type}, got ${actualType}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
