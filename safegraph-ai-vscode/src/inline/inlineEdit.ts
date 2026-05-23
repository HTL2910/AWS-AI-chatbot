import * as vscode from "vscode";
import { bedrockConverse } from "../bedrock/bedrockClient";
import { loadBedrockApiKeyFromDotEnv } from "../config/env";
import { maskSensitive } from "../security/mask";

const INLINE_PREVIEW_SCHEME = "safegraph-inline-preview";
const inlinePreviewDocs = new Map<string, string>();
let inlinePreviewProviderRegistered = false;

function ensureInlinePreviewProvider(context: vscode.ExtensionContext) {
  if (inlinePreviewProviderRegistered) return;
  inlinePreviewProviderRegistered = true;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(INLINE_PREVIEW_SCHEME, {
      provideTextDocumentContent(uri) {
        return inlinePreviewDocs.get(uri.toString()) || "";
      }
    })
  );
}

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

function uriSafePath(label: string) {
  return label.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/^\/+/, "") || "inline-edit";
}

function makePreviewUri(id: string, side: "original" | "proposed", relativePath: string, language: string, text: string) {
  const uri = vscode.Uri.from({
    scheme: INLINE_PREVIEW_SCHEME,
    path: `/${uriSafePath(relativePath)}.${side}.${language || "txt"}`,
    query: `${id}:${side}`
  });
  inlinePreviewDocs.set(uri.toString(), text);
  return uri;
}

function replacementRangeAfterEdit(doc: vscode.TextDocument, startOffset: number, replacement: string) {
  const start = doc.positionAt(startOffset);
  const end = doc.positionAt(startOffset + replacement.length);
  return new vscode.Range(start, end);
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

export async function runInlineEdit(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
  ensureInlinePreviewProvider(context);

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
      title: "Safegraph AI Inline Edit",
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

      const proposedText = fullText.slice(0, editStart) + replacement + fullText.slice(editEnd);
      const previewId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const originalUri = makePreviewUri(previewId, "original", relativePath, language, fullText);
      const proposedUri = makePreviewUri(previewId, "proposed", relativePath, language, proposedText);
      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        proposedUri,
        `Safegraph Inline Edit: ${relativePath}`,
        { preview: true }
      );

      const choice = await vscode.window.showInformationMessage(
        "Safegraph AI inline edit preview is open.",
        "Accept",
        "Reject"
      );
      if (choice !== "Accept") {
        inlinePreviewDocs.delete(originalUri.toString());
        inlinePreviewDocs.delete(proposedUri.toString());
        return;
      }

      const latestDoc = await vscode.workspace.openTextDocument(doc.uri);
      if (latestDoc.getText() !== fullText) {
        vscode.window.showErrorMessage("Safegraph AI: file changed while preview was open. Inline edit was not applied.");
        inlinePreviewDocs.delete(originalUri.toString());
        inlinePreviewDocs.delete(proposedUri.toString());
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, selection, replacement);
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        vscode.window.showErrorMessage("Safegraph AI: failed to apply inline edit.");
        inlinePreviewDocs.delete(originalUri.toString());
        inlinePreviewDocs.delete(proposedUri.toString());
        return;
      }

      const updatedEditor = await vscode.window.showTextDocument(doc.uri, { preview: false });
      const changedRange = replacementRangeAfterEdit(updatedEditor.document, editStart, replacement);
      updatedEditor.selection = new vscode.Selection(changedRange.start, changedRange.end);
      updatedEditor.revealRange(changedRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

      inlinePreviewDocs.delete(originalUri.toString());
      inlinePreviewDocs.delete(proposedUri.toString());
      output.appendLine(`[safegraph-ai] inline edit applied to ${relativePath}:${selection.start.line + 1}`);
    }
  );
}
