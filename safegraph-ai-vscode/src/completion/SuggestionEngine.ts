/**
 * Suggestion Engine
 * Generates AI-powered code suggestions
 */

import * as vscode from 'vscode';
import { CodeContext } from './ContextAnalyzer';
import { bedrockConverse, BedrockConverseOptions } from '../bedrock/bedrockClient';

export interface Suggestion {
  text: string;
  confidence: number;
  type: 'completion' | 'snippet' | 'refactor';
}

export class SuggestionEngine {
  private output: vscode.OutputChannel;
  private cache: Map<string, { suggestions: Suggestion[]; timestamp: number }> = new Map();
  private cacheTimeout: number = 60000; // 1 minute

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public async generateSuggestions(context: CodeContext): Promise<Suggestion[]> {
    const cacheKey = this.generateCacheKey(context);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.suggestions;
    }

    const suggestions: Suggestion[] = [];

    // Generate different types of suggestions based on context
    if (context.isInsideComment || context.isInsideString) {
      // Don't suggest inside comments or strings
      return [];
    }

    // Generate completion suggestions
    const completion = await this.generateCompletion(context);
    if (completion) {
      suggestions.push(completion);
    }

    // Generate snippet suggestions for certain patterns
    const snippet = await this.generateSnippet(context);
    if (snippet) {
      suggestions.push(snippet);
    }

    // Cache the results
    this.cache.set(cacheKey, {
      suggestions,
      timestamp: Date.now()
    });

    return suggestions;
  }

  private async generateCompletion(context: CodeContext): Promise<Suggestion | null> {
    const config = vscode.workspace.getConfiguration('safegraph');
    const apiKey = await vscode.workspace.getConfiguration('safegraph').get('bedrockApiKey') as string;
    
    if (!apiKey) {
      return null;
    }

    try {
      const prompt = this.buildCompletionPrompt(context);
      
      const options: BedrockConverseOptions = {
        region: config.get('region', 'us-east-1') as string,
        modelId: config.get('modelId', 'anthropic.claude-3-sonnet-20240229-v1:0') as string,
        apiKey,
        maxTokens: 256,
        temperature: 0.3
      };

      const response = await bedrockConverse(prompt, options);
      
      const completionText = this.extractCompletion(response.text);
      
      if (completionText) {
        return {
          text: completionText,
          confidence: 0.8,
          type: 'completion'
        };
      }
    } catch (error) {
      this.output.appendLine(`[SuggestionEngine] Completion error: ${error}`);
    }

    return null;
  }

  private async generateSnippet(context: CodeContext): Promise<Suggestion | null> {
    // Check for common patterns that suggest snippets
    const patterns = [
      { regex: /for\s*$/, snippet: ' (let i = 0; i < length; i++) {\n    \n}' },
      { regex: /if\s*$/, snippet: ' (condition) {\n    \n}' },
      { regex: /function\s+\w+\s*$/, snippet: ' () {\n    \n}' },
      { regex: /class\s+\w+\s*$/, snippet: ' {\n    constructor() {\n        \n    }\n}' },
      { regex: /while\s*$/, snippet: ' (condition) {\n    \n}' },
      { regex: /switch\s*$/, snippet: ' (expression) {\n    case value:\n        break;\n    default:\n        break;\n}' }
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(context.currentLine)) {
        return {
          text: pattern.snippet,
          confidence: 0.9,
          type: 'snippet'
        };
      }
    }

    return null;
  }

  private buildCompletionPrompt(context: CodeContext): string {
    let prompt = `Complete the following ${context.language} code. Provide only the completion, no explanation.\n\n`;

    // Add context
    if (context.imports.length > 0) {
      prompt += `Imports: ${context.imports.join(', ')}\n`;
    }

    if (context.variables.length > 0) {
      prompt += `Variables in scope: ${context.variables.join(', ')}\n`;
    }

    if (context.functions.length > 0) {
      prompt += `Functions available: ${context.functions.join(', ')}\n`;
    }

    // Add the code to complete
    prompt += `\nCode:\n${context.prefix}`;

    return prompt;
  }

  private extractCompletion(text: string): string {
    // Extract the completion from the AI response
    // Remove any markdown code blocks
    let completion = text.replace(/```[\w]*\n?/g, '').trim();
    
    // Remove any explanatory text
    completion = completion.split('\n\n')[0];
    
    // Ensure it doesn't start with a newline
    completion = completion.replace(/^\n+/, '');
    
    return completion;
  }

  private generateCacheKey(context: CodeContext): string {
    return `${context.language}_${context.currentLine}_${context.lineBefore}`;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
