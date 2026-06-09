/**
 * Multi-Line Completer
 * Handles multi-line code completion
 */

import * as vscode from 'vscode';
import { CodeContext } from './ContextAnalyzer';
import { bedrockConverse, BedrockConverseOptions } from '../bedrock/bedrockClient';

export interface MultiLineSuggestion {
  lines: string[];
  cursorOffset: number;
  confidence: number;
}

export class MultiLineCompleter {
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
  }

  public async generateMultiLineCompletion(
    context: CodeContext,
    maxLines: number = 5
  ): Promise<MultiLineSuggestion | null> {
    const config = vscode.workspace.getConfiguration('safegraph');
    const apiKey = await this.getApiKey();
    
    if (!apiKey) {
      return null;
    }

    try {
      const prompt = this.buildMultiLinePrompt(context, maxLines);
      
      const options: BedrockConverseOptions = {
        region: config.get('region', 'us-east-1') as string,
        modelId: config.get('modelId', 'anthropic.claude-3-sonnet-20240229-v1:0') as string,
        apiKey,
        maxTokens: 512,
        temperature: 0.4
      };

      const response = await bedrockConverse(prompt, options);
      
      const suggestion = this.parseMultiLineResponse(response.text);
      
      if (suggestion && suggestion.lines.length > 0) {
        return suggestion;
      }
    } catch (error) {
      this.output.appendLine(`[MultiLineCompleter] Error: ${error}`);
    }

    return null;
  }

  private buildMultiLinePrompt(context: CodeContext, maxLines: number): string {
    let prompt = `Complete the following ${context.language} code with up to ${maxLines} lines. Provide only the completion, no explanation.\n\n`;

    // Add surrounding context
    if (context.lineBefore) {
      prompt += `Previous line: ${context.lineBefore}\n`;
    }

    prompt += `Current line: ${context.currentLine}\n`;

    if (context.lineAfter) {
      prompt += `Next line: ${context.lineAfter}\n`;
    }

    // Add scope information
    if (context.functionScope) {
      prompt += `Function: ${context.functionScope}\n`;
    }

    if (context.classScope) {
      prompt += `Class: ${context.classScope}\n`;
    }

    prompt += `\nComplete the code starting from the current line:`;

    return prompt;
  }

  private parseMultiLineResponse(text: string): MultiLineSuggestion | null {
    // Remove markdown code blocks
    let cleaned = text.replace(/```[\w]*\n?/g, '').trim();
    
    // Split into lines
    const lines = cleaned.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
      return null;
    }

    return {
      lines,
      cursorOffset: lines.join('\n').length,
      confidence: 0.75
    };
  }

  private async getApiKey(): Promise<string> {
    const config = vscode.workspace.getConfiguration('safegraph');
    return config.get('bedrockApiKey', '') as string;
  }
}
