import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { buildRepositoryContext } from "./repositoryIndex";

export type ContextBuildOptions = {
  maxChars?: number;
  maxFiles?: number;
  includeFiles?: string[];
  query?: string;
  storageUri?: vscode.Uri;
  includeRepository?: boolean;
  targetRoot?: vscode.Uri;
};

function pushSection(parts: string[], title: string, body: string, maxChars?: number) {
  const text = maxChars && body.length > maxChars ? body.slice(0, maxChars) + "\n[...truncated...]" : body;
  parts.push(`${title}:\n${text}`);
}

function takeLastLines(text: string, maxLines: number) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function resolveWorkspaceFilePath(filePath: string, targetRoot?: vscode.Uri) {
  if (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return vscode.Uri.file(filePath);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const candidate = vscode.Uri.joinPath(folder.uri, filePath);
    if (fs.existsSync(candidate.fsPath)) {
      return candidate;
    }
  }

  if (targetRoot) {
    return vscode.Uri.joinPath(targetRoot, filePath);
  }

  return folders[0] ? vscode.Uri.joinPath(folders[0].uri, filePath) : vscode.Uri.file(filePath);
}

async function getGitInfo(targetRoot?: vscode.Uri) {
  try {
    const root = targetRoot?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return "";
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

async function readRootFile(root: vscode.Uri | undefined, name: string, maxChars: number) {
  if (!root) return "";
  try {
    const uri = vscode.Uri.joinPath(root, name);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    return text.length > maxChars ? text.slice(0, maxChars) + "\n[...truncated...]" : text;
  } catch {
    return "";
  }
}

async function getProjectManifestSnapshot(targetRoot?: vscode.Uri) {
  const root = targetRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return "";

  const manifestNames = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "README.md"
  ];
  const parts: string[] = [];

  for (const name of manifestNames) {
    const text = await readRootFile(root, name, name === "README.md" ? 3000 : 5000);
    if (text.trim()) {
      parts.push(`--- ${name} ---\n${text}`);
    }
  }

  return parts.length ? parts.join("\n\n") : "";
}

function getOpenEditorSnapshot() {
  const docs = vscode.workspace.textDocuments
    .filter((doc) => !doc.isUntitled && doc.uri.scheme === "file")
    .filter((doc) => !/(^|\/)(node_modules|\.git|dist|build|out|venv|\.venv)(\/|$)/.test(doc.uri.fsPath))
    .slice(0, 12);

  if (!docs.length) return "";

  return docs
    .map((doc) => {
      const rel = vscode.workspace.asRelativePath(doc.uri, false);
      const dirty = doc.isDirty ? "dirty" : "saved";
      return `- ${rel} (${doc.languageId}, ${doc.lineCount} lines, ${dirty})`;
    })
    .join("\n");
}

export async function buildContext(options: ContextBuildOptions = {}) {
  const maxChars = options.maxChars ?? 8000;
  const maxFiles = options.maxFiles ?? 80;
  const includeFiles = options.includeFiles ?? [];
  const query = options.query ?? "";
  const targetRoot = options.targetRoot;

  const priorityParts: string[] = [];
  const backgroundParts: string[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  priorityParts.push(`Workspace folders: ${folders.map((f) => f.uri.fsPath).join(" | ") || "(none)"}`);
  priorityParts.push(`Target root for this task: ${targetRoot?.fsPath || folders[0]?.uri.fsPath || "(none)"}`);

  const openEditors = getOpenEditorSnapshot();
  if (openEditors) {
    pushSection(priorityParts, "Open editor files", openEditors, 3000);
  }

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
      pushSection(priorityParts, "Active file tail (last 100 lines)", takeLastLines(doc.getText(), 100), 7000);
    }
  } else {
    priorityParts.push("Active file: (none)");
  }

  if (includeFiles.length > 0) {
    priorityParts.push("Tagged files (@):");
    for (const fp of includeFiles) {
      try {
        const uri = resolveWorkspaceFilePath(fp, targetRoot);
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          const pattern = new vscode.RelativePattern(uri, "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml,html,css,txt}");
          const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__}/**", 80);
          priorityParts.push(`--- ${fp} (${uri.fsPath}, tagged directory) ---`);
          priorityParts.push(files.map((u) => path.relative(uri.fsPath, u.fsPath).replace(/\\/g, "/")).join("\n") || "(empty directory)");
          continue;
        }

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
    const includePattern = targetRoot
      ? new vscode.RelativePattern(targetRoot, "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml,html,css}")
      : "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml,html,css}";
    const files = await vscode.workspace.findFiles(
      includePattern,
      "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__}/**",
      maxFiles
    );
    const hints = detectFramework(files);
    if (hints.length) backgroundParts.push(`Framework: ${hints.join(", ")}`);
    
    backgroundParts.push(`Project files (${Math.min(maxFiles, files.length)} of ${files.length} visible):`);
    backgroundParts.push(files.map((u) => (targetRoot ? path.relative(targetRoot.fsPath, u.fsPath).replace(/\\/g, "/") : u.fsPath)).join("\n"));
  } catch {
    // ignore
  }

  const gitInfo = await getGitInfo(targetRoot);
  if (gitInfo) backgroundParts.push(gitInfo);

  const diags = await getDiagnostics();
  if (diags) backgroundParts.push(diags);

  const manifests = await getProjectManifestSnapshot(targetRoot);
  if (manifests) backgroundParts.push(`Project manifest snapshot:\n${manifests}`);

  const cfg = vscode.workspace.getConfiguration("safegraph");
  const repositoryEnabled = Boolean(cfg.get("repositoryRag.enabled", true));
  const shouldIncludeRepository =
    repositoryEnabled && query.trim().length > 0 && options.includeRepository !== false;
  if (shouldIncludeRepository) {
    try {
      const repositoryContext = await buildRepositoryContext({
        query,
        storageUri: options.storageUri,
        rootUri: targetRoot,
        maxFiles: Number(cfg.get("repositoryRag.maxFiles", 800)),
        maxChunks: Math.max(1, Math.min(8, Number(cfg.get("repositoryRag.maxChunks", 6)))),
        maxChars: Math.max(3000, Math.min(12000, Number(cfg.get("repositoryRag.maxChars", 10000))))
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
