import * as vscode from "vscode";
import { bedrockConverse } from "../bedrock/bedrockClient";
import { getBedrockModelConfig, resolveBedrockApiKey } from "../config/bedrock";
import { maskSensitive } from "../security/mask";

function takeBefore(text: string, offset: number, maxChars: number) {
  return text.slice(Math.max(0, offset - maxChars), offset);
}

function takeAfter(text: string, offset: number, maxChars: number) {
  return text.slice(offset, Math.min(text.length, offset + maxChars));
}

function stripCodeFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)```$/);
  return (match ? match[1] : trimmed).replace(/\n$/, "");
}

const additionDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(46, 160, 67, 0.2)",
  isWholeLine: true,
  overviewRulerColor: "rgba(46, 160, 67, 0.8)",
  overviewRulerLane: vscode.OverviewRulerLane.Right
});

interface InlineSession {
  docUri: vscode.Uri;
  originalText: string;
  originalRange: vscode.Range;
  newRange: vscode.Range;
  resolve: (value: "accept" | "reject") => void;
}

let currentSession: InlineSession | null = null;

export function acceptInlineEdit() {
  if (currentSession) {
    currentSession.resolve("accept");
  }
}

export function rejectInlineEdit() {
  if (currentSession) {
    currentSession.resolve("reject");
  }
}

export async function runInlineEdit(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
  if (currentSession) {
    vscode.window.showWarningMessage("Safegraph AI: Please accept or reject the current inline edit first.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("Safegraph AI: Open a code file before using Inline Edit.");
    return;
  }

  const instruction = await vscode.window.showInputBox({
    title: "Safegraph AI Inline Edit",
    prompt: "Describe the edit to apply to the selected code or cursor position.",
    ignoreFocusOut: true
  });
  if (!instruction?.trim()) return;

  const apiKey = await resolveBedrockApiKey(context, output);
  if (!apiKey) {
    vscode.window.showErrorMessage("Safegraph AI: Missing Bedrock API key.");
    return;
  }

  const { region, modelId } = getBedrockModelConfig();

  const doc = editor.document;
  const selection = editor.selection;
  const fullText = doc.getText();
  const selectionText = selection.isEmpty ? "" : doc.getText(selection);
  const editStart = doc.offsetAt(selection.start);
  const editEnd = doc.offsetAt(selection.end);
  const language = doc.languageId;
  const relativePath = vscode.workspace.asRelativePath(doc.uri, false);

  const prompt = `You are Safegraph AI Inline Edit inside VS Code.
Return ONLY the replacement code for the selected range. No markdown, no explanation, no diff.
If the selection is empty, return only the code to insert at the cursor.
Preserve indentation and local style.

File: ${relativePath}
Language: ${language}
Instruction:
${maskSensitive(instruction)}

Code before edit location:
\`\`\`${language}
${maskSensitive(takeBefore(fullText, editStart, 6000))}
\`\`\`

Selected code to replace:
\`\`\`${language}
${maskSensitive(selectionText)}
\`\`\`

Code after edit location:
\`\`\`${language}
${maskSensitive(takeAfter(fullText, editEnd, 6000))}
\`\`\`

Replacement code only:`;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Safegraph AI: Generating edit...",
      cancellable: false
    },
    async () => {
      const result = await bedrockConverse(prompt, {
        region,
        modelId,
        apiKey,
        system: [
          "You are Safegraph AI Inline Edit inside VS Code.",
          "Return only replacement code for the selected range or cursor insertion.",
          "Do not include markdown fences, explanations, diffs, or surrounding unchanged file content.",
          "Preserve the file's language, indentation, naming style, imports style, and local conventions.",
          "Apply senior engineering judgment: make the smallest complete change, keep code runnable, handle nearby edge cases, and avoid placeholder code.",
          "For HTML/CSS/JS/TS/Python, use idiomatic formatting and syntax for that language.",
          "If the instruction is ambiguous, make the smallest useful edit that satisfies it."
        ].join("\n"),
        maxTokens: 4096,
        temperature: 0.1
      });
      const replacement = stripCodeFence(result.text);
      if (!replacement.trim()) {
        vscode.window.showErrorMessage("Safegraph AI: Inline edit returned empty code.");
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, selection, replacement);
      
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        vscode.window.showErrorMessage("Safegraph AI: Failed to apply inline edit.");
        return;
      }

      // Calculate new range
      const newEndOffset = editStart + replacement.length;
      const newRange = new vscode.Range(doc.positionAt(editStart), doc.positionAt(newEndOffset));
      
      editor.setDecorations(additionDecorationType, [newRange]);
      await vscode.commands.executeCommand("setContext", "safegraph.inlineActive", true);

      // Wait for Accept/Reject
      const decision = await new Promise<"accept" | "reject">((resolve) => {
        currentSession = {
          docUri: doc.uri,
          originalText: selectionText,
          originalRange: selection,
          newRange,
          resolve
        };
      });

      // Cleanup
      editor.setDecorations(additionDecorationType, []);
      await vscode.commands.executeCommand("setContext", "safegraph.inlineActive", false);
      currentSession = null;

      if (decision === "reject") {
        const revertEdit = new vscode.WorkspaceEdit();
        revertEdit.replace(doc.uri, newRange, selectionText);
        await vscode.workspace.applyEdit(revertEdit);
        output.appendLine(`[safegraph-ai] inline edit rejected in ${relativePath}`);
      } else {
        output.appendLine(`[safegraph-ai] inline edit accepted in ${relativePath}`);
      }
    }
  );
}
