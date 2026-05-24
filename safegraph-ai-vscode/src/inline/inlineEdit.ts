import * as vscode from "vscode";
import { bedrockConverse } from "../bedrock/bedrockClient";
import { loadBedrockApiKeyFromDotEnv } from "../config/env";
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

async function loadApiKey(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
  let apiKey = (await context.secrets.get("safegraph.bedrockApiKey")) || "";
  if (!apiKey) {
    const envKey = await loadBedrockApiKeyFromDotEnv([context.extensionUri.fsPath]);
    if (envKey) {
      apiKey = envKey;
      await context.secrets.store("safegraph.bedrockApiKey", apiKey);
      output.appendLine("[safegraph-ai] loaded Bedrock API key from .env into SecretStorage");
    }
  }
  return apiKey;
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

  const apiKey = await loadApiKey(context, output);
  if (!apiKey) {
    vscode.window.showErrorMessage("Safegraph AI: Missing Bedrock API key.");
    return;
  }

  const cfg = vscode.workspace.getConfiguration("safegraph");
  const region = String(cfg.get("region") || "ap-southeast-1");
  const modelId = String(
    cfg.get("modelId") ||
      "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623"
  );

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
