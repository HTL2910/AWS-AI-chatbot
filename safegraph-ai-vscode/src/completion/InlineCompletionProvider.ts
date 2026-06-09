/**
 * Inline Completion Provider
 * VS Code completion provider for AI-powered inline suggestions
 */

import * as vscode from 'vscode';
import { ContextAnalyzer } from './ContextAnalyzer';
import { SuggestionEngine } from './SuggestionEngine';
import { bedrockConverse, BedrockConverseOptions } from '../bedrock/bedrockClient';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private contextAnalyzer: ContextAnalyzer;
  private suggestionEngine: SuggestionEngine;
  private output: vscode.OutputChannel;
  private enabled: boolean;

  constructor(output: vscode.OutputChannel) {
    this.output = output;
    this.contextAnalyzer = new ContextAnalyzer(output);
    this.suggestionEngine = new SuggestionEngine(output);
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

    const config = vscode.workspace.getConfiguration('safegraph');
    const completionEnabled = config.get('completion.enabled', true);
    
    if (!completionEnabled) {
      return undefined;
    }

    try {
      // Analyze the current context
      const analysis = await this.contextAnalyzer.analyzeContext(document, position);
      
      // Generate suggestions based on context
      const suggestions = await this.suggestionEngine.generateSuggestions(analysis);
      
      if (suggestions.length === 0) {
        return undefined;
      }

      // Convert to VS Code inline completion items
      const items = suggestions.map((suggestion: any) => ({
        insertText: suggestion.text,
        range: new vscode.Range(position, position),
        command: {
          command: 'safegraph.acceptCompletion',
          title: 'Accept'
        }
      }));

      return new vscode.InlineCompletionList(items);
    } catch (error) {
      this.output.appendLine(`[InlineCompletionProvider] Error: ${error}`);
      return undefined;
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.output.appendLine(`[InlineCompletionProvider] ${enabled ? 'Enabled' : 'Disabled'}`);
  }
}
