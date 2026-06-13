/**
 * Inline Completion Provider
 * VS Code provider for Claude Haiku 4.5 powered ghost-text suggestions.
 */

import * as vscode from 'vscode';
import { ContextAnalyzer } from './ContextAnalyzer';
import { SuggestionEngine } from './SuggestionEngine';
import { getCompletionConfig } from '../config/bedrock';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private contextAnalyzer: ContextAnalyzer;
  private suggestionEngine: SuggestionEngine;
  private output: vscode.OutputChannel;
  private enabled: boolean;

  constructor(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    this.output = output;
    this.contextAnalyzer = new ContextAnalyzer(output);
    this.suggestionEngine = new SuggestionEngine(context, output);
    this.enabled = true;
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const cfg = getCompletionConfig();
    if (!cfg.enabled) {
      return undefined;
    }

    // In manual mode only respond to an explicit invoke (e.g. the trigger command).
    if (
      cfg.triggerMode === 'manual' &&
      context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke
    ) {
      return undefined;
    }

    // Debounce automatic requests so we don't fire on every keystroke.
    if (
      cfg.triggerMode === 'automatic' &&
      context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
    ) {
      const settled = await this.debounce(cfg.debounceMs, token);
      if (!settled || token.isCancellationRequested) {
        return undefined;
      }
    }

    try {
      const analysis = await this.contextAnalyzer.analyzeContext(document, position);
      const suggestions = await this.suggestionEngine.generateSuggestions(analysis, token);
      if (token.isCancellationRequested || suggestions.length === 0) {
        return undefined;
      }

      const items = suggestions
        .filter((s) => s.text && s.text.length > 0)
        .map(
          (s) =>
            new vscode.InlineCompletionItem(s.text, new vscode.Range(position, position))
        );

      if (items.length === 0) {
        return undefined;
      }

      return new vscode.InlineCompletionList(items);
    } catch (error) {
      this.output.appendLine(`[InlineCompletionProvider] Error: ${error}`);
      return undefined;
    }
  }

  private debounce(ms: number, token: vscode.CancellationToken): Promise<boolean> {
    if (!ms || ms <= 0) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve(true);
      }, ms);
      const disposable = token.onCancellationRequested(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.output.appendLine(`[InlineCompletionProvider] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }
}
