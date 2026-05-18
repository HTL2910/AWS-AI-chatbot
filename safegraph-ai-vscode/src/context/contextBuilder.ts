import * as vscode from "vscode";

export type ContextBuildOptions = {
  maxChars?: number;
  maxFiles?: number;
  includeFiles?: string[];
};

function takeLastLines(text: string, maxLines: number) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

export async function buildContext(options: ContextBuildOptions = {}) {
  const maxChars = options.maxChars ?? 8000;
  const maxFiles = options.maxFiles ?? 80;
  const includeFiles = options.includeFiles ?? [];

  const parts: string[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  parts.push(`Workspace folders: ${folders.map((f) => f.uri.fsPath).join(" | ") || "(none)"}`);

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const doc = editor.document;
    parts.push(`Active file: ${doc.uri.fsPath}`);

    const sel = editor.selection;
    const selected = !sel.isEmpty ? doc.getText(sel) : "";
    if (selected) {
      parts.push("Selected text:");
      parts.push(selected.slice(0, 3000));
    } else {
      parts.push("Active file tail (last 120 lines):");
      parts.push(takeLastLines(doc.getText(), 120));
    }
  } else {
    parts.push("Active file: (none)");
  }

  try {
    const files = await vscode.workspace.findFiles(
      "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml}",
      "**/{node_modules,.git,dist,build,out,venv,.venv}/**",
      maxFiles
    );
    parts.push(`Project files (top ${Math.min(maxFiles, files.length)}):`);
    parts.push(files.map((u) => u.fsPath).join("\n"));
  } catch {
    // ignore
  }

  if (includeFiles.length > 0) {
    parts.push("Tagged files (@):");
    for (const fp of includeFiles) {
      try {
        const uri = vscode.Uri.file(fp);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString("utf8");
        parts.push(`--- ${fp} ---`);
        parts.push(takeLastLines(text, 200));
      } catch {
        parts.push(`--- ${fp} (unreadable) ---`);
      }
    }
  }

  let ctx = parts.join("\n\n");
  if (ctx.length > maxChars) ctx = ctx.slice(0, maxChars) + "\n\n[...truncated...]";
  return ctx;
}
