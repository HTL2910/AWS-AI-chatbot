/**
 * Suggestion Engine
 * Generates Claude Haiku 4.5 powered inline code suggestions.
 */

import * as vscode from 'vscode';
import { CodeContext } from './ContextAnalyzer';
import { bedrockConverse } from '../bedrock/bedrockClient';
import { getCompletionConfig, resolveBedrockApiKey } from '../config/bedrock';
import {
  buildCompletionPrompt,
  buildCompletionSystemPrompt,
  cleanCompletion,
  COMPLETION_STOP_SEQUENCES
} from './completionPrompt';

export interface Suggestion {
  text: string;
  confidence: number;
  type: 'completion' | 'snippet' | 'refactor';
}

export class SuggestionEngine {
  private output: vscode.OutputChannel;
  private context: vscode.ExtensionContext;
  private cache: Map<string, { suggestions: Suggestion[]; timestamp: number }> = new Map();
  private cacheTimeout: number = 60000; // 1 minute

  constructor(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    this.context = context;
    this.output = output;
  }

  public async generateSuggestions(
    context: CodeContext,
    token?: vscode.CancellationToken
  ): Promise<Suggestion[]> {
    // Don't suggest inside comments or strings.
    if (context.isInsideComment || context.isInsideString) {
      return [];
    }

    const cacheKey = this.generateCacheKey(context);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.suggestions;
    }

    const suggestions: Suggestion[] = [];

    // Fast local snippet heuristics (no network round-trip).
    const snippet = this.generateSnippet(context);
    if (snippet) {
      suggestions.push(snippet);
    }

    const completion = await this.generateCompletion(context, token);
    if (completion) {
      suggestions.unshift(completion);
    }

    this.cache.set(cacheKey, { suggestions, timestamp: Date.now() });
    return suggestions;
  }

  private async generateCompletion(
    context: CodeContext,
    token?: vscode.CancellationToken
  ): Promise<Suggestion | null> {
    const cfg = getCompletionConfig();
    const apiKey = await resolveBedrockApiKey(this.context, this.output);
    if (!apiKey) {
      this.output.appendLine('[SuggestionEngine] No Bedrock API key available; skipping completion.');
      return null;
    }

    const abort = new AbortController();
    if (token) {
      token.onCancellationRequested(() => abort.abort());
    }

    try {
      const prompt = buildCompletionPrompt(
        {
          language: context.language,
          prefix: context.prefix,
          suffix: context.suffix,
          currentLine: context.currentLine,
          imports: context.imports
        },
        { multiline: cfg.multiline }
      );

      const response = await bedrockConverse(prompt, {
        region: cfg.region,
        modelId: cfg.modelId,
        apiKey,
        system: buildCompletionSystemPrompt(),
        maxTokens: cfg.maxTokens,
        temperature: 0.1,
        topP: 0.9,
        stopSequences: COMPLETION_STOP_SEQUENCES,
        signal: abort.signal,
        retries: 0
      });

      const completionText = cleanCompletion(response.text, context.currentLine, cfg.multiline);
      if (completionText) {
        return { text: completionText, confidence: 0.8, type: 'completion' };
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        this.output.appendLine(`[SuggestionEngine] Completion error: ${error}`);
      }
    }

    return null;
  }

  private generateSnippet(context: CodeContext): Suggestion | null {
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
        return { text: pattern.snippet, confidence: 0.5, type: 'snippet' };
      }
    }

    return null;
  }

  private generateCacheKey(context: CodeContext): string {
    const prefixTail = context.prefix.slice(-200);
    return `${context.language}:${prefixTail}`;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
