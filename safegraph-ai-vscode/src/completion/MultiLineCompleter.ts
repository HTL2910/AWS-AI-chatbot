/**
 * Multi-Line Completer
 * Handles multi-line code completion with Claude Haiku 4.5.
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

export interface MultiLineSuggestion {
  lines: string[];
  cursorOffset: number;
  confidence: number;
}

export class MultiLineCompleter {
  private output: vscode.OutputChannel;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    this.context = context;
    this.output = output;
  }

  public async generateMultiLineCompletion(
    context: CodeContext,
    maxLines: number = 5,
    token?: vscode.CancellationToken
  ): Promise<MultiLineSuggestion | null> {
    const cfg = getCompletionConfig();
    const apiKey = await resolveBedrockApiKey(this.context, this.output);
    if (!apiKey) {
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
        { multiline: true }
      );

      const response = await bedrockConverse(prompt, {
        region: cfg.region,
        modelId: cfg.modelId,
        apiKey,
        system: buildCompletionSystemPrompt(),
        maxTokens: cfg.maxTokens,
        temperature: 0.15,
        topP: 0.9,
        stopSequences: COMPLETION_STOP_SEQUENCES,
        signal: abort.signal,
        retries: 0
      });

      const suggestion = this.parseMultiLineResponse(response.text, context.currentLine, maxLines);
      if (suggestion && suggestion.lines.length > 0) {
        return suggestion;
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        this.output.appendLine(`[MultiLineCompleter] Error: ${error}`);
      }
    }

    return null;
  }

  private parseMultiLineResponse(
    text: string,
    currentLine: string,
    maxLines: number
  ): MultiLineSuggestion | null {
    const cleaned = cleanCompletion(text, currentLine, true);
    if (!cleaned) {
      return null;
    }

    const lines = cleaned.split('\n').slice(0, Math.max(1, maxLines));
    if (lines.length === 0) {
      return null;
    }

    const joined = lines.join('\n');
    return {
      lines,
      cursorOffset: joined.length,
      confidence: 0.75
    };
  }
}
