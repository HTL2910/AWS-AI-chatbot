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

async function getGitInfo() {
  try {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return "";
    const root = folders[0].uri.fsPath;
    const { execSync } = await import("child_process");
    
    const status = execSync("git status --short", { cwd: root, encoding: "utf8" }).trim();
    if (!status) return "Git: No uncommitted changes";
    
    const diff = execSync("git diff --stat", { cwd: root, encoding: "utf8" }).trim();
    return `Git status:\n${status}\n\nChanges by file:\n${diff}`;
  } catch {
    return "";
  }
}

async function getDiagnostics() {
  try {
    const diags = vscode.languages.getDiagnostics();
    const errors: string[] = [];
    const warnings: string[] = [];
    
    for (const [uri, list] of diags) {
      for (const d of list.slice(0, 10)) {
        const severity = d.severity === vscode.DiagnosticSeverity.Error ? "ERROR" : "WARN";
        const msg = `${severity}: ${uri.fsPath}: ${d.message}`;
        if (severity === "ERROR") errors.push(msg);
        else warnings.push(msg);
      }
    }
    
    const summary: string[] = [];
    if (errors.length) summary.push(`Errors (${errors.length}):\n${errors.slice(0, 5).join("\n")}`);
    if (warnings.length) summary.push(`Warnings (${warnings.length}):\n${warnings.slice(0, 5).join("\n")}`);
    
    return summary.length ? summary.join("\n\n") : "";
  } catch {
    return "";
  }
}

function detectFramework(files: vscode.Uri[]): string[] {
  const hints: string[] = [];
  const fileNames = new Set(files.map((f) => f.fsPath.split("/").pop() || ""));
  
  if (fileNames.has("package.json")) hints.push("Node.js/NPM");
  if (fileNames.has("requirements.txt") || fileNames.has("setup.py")) hints.push("Python");
  if (fileNames.has("go.mod")) hints.push("Go");
  if (fileNames.has("Cargo.toml")) hints.push("Rust");
  if (fileNames.has("pom.xml") || fileNames.has("build.gradle")) hints.push("Java");
  if (fileNames.has(".csproj")) hints.push("C#/.NET");
  
  const hasReact = files.some((f) => f.fsPath.includes("react"));
  const hasVue = files.some((f) => f.fsPath.includes("vue"));
  const hasAngular = files.some((f) => f.fsPath.includes("angular"));
  
  if (hasReact) hints.push("React");
  if (hasVue) hints.push("Vue");
  if (hasAngular) hints.push("Angular");
  
  return hints;
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
    const lang = doc.languageId;
    parts.push(`Active file: ${doc.uri.fsPath} (${lang})`);
    parts.push(`File length: ${doc.lineCount} lines`);

    const sel = editor.selection;
    const selected = !sel.isEmpty ? doc.getText(sel) : "";
    if (selected) {
      parts.push("Selected text:");
      parts.push(selected.slice(0, 3000));
    } else {
      parts.push("Active file tail (last 100 lines):");
      parts.push(takeLastLines(doc.getText(), 100));
    }
  } else {
    parts.push("Active file: (none)");
  }

  try {
    const files = await vscode.workspace.findFiles(
      "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml,html,css}",
      "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__}/**",
      maxFiles
    );
    const hints = detectFramework(files);
    if (hints.length) parts.push(`Framework: ${hints.join(", ")}`);
    
    parts.push(`Project files (${Math.min(maxFiles, files.length)} of ${files.length} visible):`);
    parts.push(files.map((u) => u.fsPath).join("\n"));
  } catch {
    // ignore
  }

  const gitInfo = await getGitInfo();
  if (gitInfo) parts.push(gitInfo);

  const diags = await getDiagnostics();
  if (diags) parts.push(diags);

  if (includeFiles.length > 0) {
    parts.push("Tagged files (@):");
    for (const fp of includeFiles) {
      try {
        const uri = vscode.Uri.file(fp);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString("utf8");
        parts.push(`--- ${fp} ---`);
        parts.push(takeLastLines(text, 150));
      } catch {
        parts.push(`--- ${fp} (unreadable) ---`);
      }
    }
  }

  let ctx = parts.join("\n\n");
  if (ctx.length > maxChars) ctx = ctx.slice(0, maxChars) + "\n\n[...truncated...]";
  return ctx;
}
