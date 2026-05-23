import * as vscode from "vscode";
import { buildRepositoryContext } from "./repositoryIndex";

export type ContextBuildOptions = {
  maxChars?: number;
  maxFiles?: number;
  includeFiles?: string[];
  query?: string;
  storageUri?: vscode.Uri;
  includeRepository?: boolean;
};

function pushSection(parts: string[], title: string, body: string, maxChars?: number) {
  const text = maxChars && body.length > maxChars ? body.slice(0, maxChars) + "\n[...truncated...]" : body;
  parts.push(`${title}:\n${text}`);
}

function takeLastLines(text: string, maxLines: number) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function resolveWorkspaceFilePath(filePath: string) {
  if (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return vscode.Uri.file(filePath);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length > 0) {
    return vscode.Uri.joinPath(folders[0].uri, filePath);
  }

  return vscode.Uri.file(filePath);
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
  const query = options.query ?? "";

  const priorityParts: string[] = [];
  const backgroundParts: string[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  priorityParts.push(`Workspace folders: ${folders.map((f) => f.uri.fsPath).join(" | ") || "(none)"}`);

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const doc = editor.document;
    const lang = doc.languageId;
    priorityParts.push(`Active file: ${doc.uri.fsPath} (${lang})`);
    priorityParts.push(`File length: ${doc.lineCount} lines`);

    const sel = editor.selection;
    const selected = !sel.isEmpty ? doc.getText(sel) : "";
    if (selected) {
      pushSection(priorityParts, "Selected text", selected, 6000);
    } else {
      pushSection(priorityParts, "Active file tail (last 160 lines)", takeLastLines(doc.getText(), 160), 10000);
    }
  } else {
    priorityParts.push("Active file: (none)");
  }

  if (includeFiles.length > 0) {
    priorityParts.push("Tagged files (@):");
    for (const fp of includeFiles) {
      try {
        const uri = resolveWorkspaceFilePath(fp);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString("utf8");
        priorityParts.push(`--- ${fp} (${uri.fsPath}) ---`);
        priorityParts.push(text.length > 20000 ? text.slice(0, 12000) + "\n\n[...middle truncated...]\n\n" + text.slice(-8000) : text);
      } catch {
        priorityParts.push(`--- ${fp} (unreadable) ---`);
      }
    }
  }

  try {
    const files = await vscode.workspace.findFiles(
      "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml,html,css}",
      "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__}/**",
      maxFiles
    );
    const hints = detectFramework(files);
    if (hints.length) backgroundParts.push(`Framework: ${hints.join(", ")}`);
    
    backgroundParts.push(`Project files (${Math.min(maxFiles, files.length)} of ${files.length} visible):`);
    backgroundParts.push(files.map((u) => u.fsPath).join("\n"));
  } catch {
    // ignore
  }

  const gitInfo = await getGitInfo();
  if (gitInfo) backgroundParts.push(gitInfo);

  const diags = await getDiagnostics();
  if (diags) backgroundParts.push(diags);

  const cfg = vscode.workspace.getConfiguration("safegraph");
  const repositoryEnabled = Boolean(cfg.get("repositoryRag.enabled", true));
  const shouldIncludeRepository =
    repositoryEnabled && query.trim().length > 0 && options.includeRepository !== false;
  if (shouldIncludeRepository) {
    try {
      const repositoryContext = await buildRepositoryContext({
        query,
        storageUri: options.storageUri,
        maxFiles: Number(cfg.get("repositoryRag.maxFiles", 800)),
        maxChunks: Number(cfg.get("repositoryRag.maxChunks", 10)),
        maxChars: Number(cfg.get("repositoryRag.maxChars", 18000))
      });
      if (repositoryContext) priorityParts.push(repositoryContext);
    } catch (e) {
      backgroundParts.push(`Repository semantic context (@Repository): unavailable (${String(e)})`);
    }
  }

  const priority = priorityParts.join("\n\n");
  const backgroundBudget = Math.max(0, maxChars - priority.length - 80);
  const background = backgroundParts.join("\n\n");
  let ctx = priority;
  if (backgroundBudget > 0 && background) {
    ctx += "\n\n" + background.slice(0, backgroundBudget);
    if (background.length > backgroundBudget) ctx += "\n\n[...background truncated...]";
  } else if (priority.length > maxChars) {
    ctx = priority.slice(0, Math.floor(maxChars * 0.6)) + "\n\n[...priority middle truncated...]\n\n" + priority.slice(-Math.floor(maxChars * 0.4));
  }
  return ctx;
}
