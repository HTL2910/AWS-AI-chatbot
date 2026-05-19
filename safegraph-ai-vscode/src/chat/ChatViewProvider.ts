import * as vscode from "vscode";
import { getChatWebviewHtml } from "./webviewHtml";
import { bedrockConverse, isExpiredBearerTokenError } from "../bedrock/bedrockClient";
import { buildContext } from "../context/contextBuilder";
import { maskSensitive } from "../security/mask";
import { BedrockApiKeyInfo, loadBedrockApiKeyInfos, maskApiKey } from "../config/env";
import { applyUnifiedDiffToWorkspaceSmart } from "../apply/unifiedDiff";
import { CommandRunner, CommandUpdateMessage } from "../terminal/commandRunner";

type WebviewToExtensionMessage =
  | {
      type: "userMessage";
      id: string;
      text: string;
      ts: number;
      agentMode?: boolean;
      taggedFiles?: string[];
      attachments?: { name: string; text: string }[];
    }
  | { type: "ready" }
  | { type: "setApiKey" }
  | { type: "checkApiKey" }
  | { type: "openLog" }
  | { type: "moveRight" }
  | { type: "clearChat" }
  | { type: "pickFilesOrFolders" }
  | { type: "addActiveFile" }
  | { type: "addSelection" }
  | { type: "droppedUris"; uris: string[] }
  | { type: "applyDiff"; diff: string }
  | { type: "stop" }
  | { type: "suggestFiles"; query: string }
  | { type: "runCommand"; id: string; cmd: string }
  | { type: "cancelCommand"; id: string };

type ExtensionToWebviewMessage =
  | { type: "assistantMessage"; id: string; text: string; ts: number; done?: boolean }
  | { type: "error"; message: string; ts: number }
  | {
      type: "contextItem";
      kind: "file" | "attachment";
      path?: string;
      label?: string;
      name?: string;
      text?: string;
      ts: number;
    }
  | { type: "fileSuggestions"; items: { path: string; label: string }[]; ts: number }
  | CommandUpdateMessage;

function formatApplyError(e: unknown) {
  const raw = String(e instanceof Error ? e.message : e);
  const normalized = raw.replace(/^Error:\s*/i, "").trim();

  if (/corrupt patch/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Lỗi là patch AI trả về không đúng format unified diff nên VS Code chưa apply được.",
      "Cách sửa: bấm Regenerate hoặc hỏi lại: tạo diff sạch, mỗi hunk chỉ có dòng bắt đầu bằng space, + hoặc -.",
      "Vì sao: nếu trong block diff có chữ giải thích, hoặc số dòng hunk bị lệch quá xa, git sẽ báo corrupt patch."
    ].join("\n");
  }

  if (/malformed diff|could not be repaired locally/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Lỗi là diff AI tạo ra bị lệch context hoặc sai format quá mức auto-apply chưa sửa được.",
      "Cách sửa: bấm Regenerate, hoặc yêu cầu AI tạo lại diff nhỏ hơn theo từng file.",
      "Vì sao: Apply All cần diff có header ---/+++ và hunk @@ hợp lệ để map vào file hiện tại."
    ].join("\n");
  }

  if (/Context mismatch|Delete line mismatch|Hunk out of range|patch does not apply|does not match/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Lỗi là nội dung file hiện tại không còn khớp với diff.",
      "Cách sửa: hỏi lại AI tạo diff mới dựa trên file hiện tại.",
      "Vì sao: file đã đổi sau khi AI tạo patch, nên dòng context không tìm thấy nữa."
    ].join("\n");
  }

  return `Safegraph AI: Apply failed: ${normalized}`;
}

function extractDiffBlocks(text: string) {
  const diffs: string[] = [];
  const re = /```diff\s*([\s\S]*?)```/gi;
  for (const m of String(text || "").matchAll(re)) {
    const diff = String(m[1] || "").trim();
    if (diff) diffs.push(diff);
  }
  return diffs;
}

function hasShellFileWrite(text: string) {
  return /(^|\n)\s*(cat\s+>\s+|tee\s+|touch\s+|echo\s+.+>\s+|printf\s+.+>\s+)/i.test(String(text || ""));
}

function formatApiKeySource(info: BedrockApiKeyInfo) {
  return `${info.keyName} from ${info.source}`;
}

const DROPPED_FOLDER_MAX_FILES = 80;
const DROPPED_FOLDER_MAX_BYTES = 700 * 1024;
const DROPPED_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".yaml",
  ".yml",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rs",
  ".go",
  ".sh",
  ".ps1",
  ".cmd",
  ".toml",
  ".xml",
  ".sql"
]);
const DROPPED_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "venv",
  ".venv",
  "__pycache__",
  ".next",
  ".cache"
]);

function pathBasename(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function pathExt(p: string) {
  const base = pathBasename(p);
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx).toLowerCase() : "";
}

function uriToWorkspaceLabel(uri: vscode.Uri) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath || uri.toString();
}

async function readDroppedPath(uri: vscode.Uri) {
  const stat = await vscode.workspace.fs.stat(uri);
  const label = uriToWorkspaceLabel(uri);

  if (stat.type & vscode.FileType.File) {
    const ext = pathExt(label);
    if (!DROPPED_TEXT_EXTENSIONS.has(ext)) {
      return {
        name: label,
        text: `[binary or unsupported file dropped: ${label}, ${Math.round(stat.size / 1024)}KB]`
      };
    }
    if (stat.size > DROPPED_FOLDER_MAX_BYTES) {
      return {
        name: label,
        text: `[file too large to attach: ${label}, max ${Math.round(DROPPED_FOLDER_MAX_BYTES / 1024)}KB]`
      };
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { name: label, text: Buffer.from(bytes).toString("utf8") };
  }

  if (!(stat.type & vscode.FileType.Directory)) {
    return { name: label, text: `[unsupported dropped item: ${label}]` };
  }

  const files: { uri: vscode.Uri; label: string; size: number }[] = [];
  const walk = async (dir: vscode.Uri) => {
    if (files.length >= DROPPED_FOLDER_MAX_FILES) return;
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      if (files.length >= DROPPED_FOLDER_MAX_FILES) break;
      if (DROPPED_SKIP_DIRS.has(name)) continue;
      const child = vscode.Uri.joinPath(dir, name);
      if (type & vscode.FileType.Directory) {
        await walk(child);
        continue;
      }
      if (!(type & vscode.FileType.File)) continue;
      const childLabel = uriToWorkspaceLabel(child);
      if (!DROPPED_TEXT_EXTENSIONS.has(pathExt(childLabel))) continue;
      try {
        const childStat = await vscode.workspace.fs.stat(child);
        if (childStat.size <= DROPPED_FOLDER_MAX_BYTES) {
          files.push({ uri: child, label: childLabel, size: childStat.size });
        }
      } catch {
        // ignore unreadable files
      }
    }
  };

  await walk(uri);

  let used = 0;
  const parts = [`Dropped folder: ${label}`, `Included files: ${files.length}`];
  for (const file of files) {
    if (used >= DROPPED_FOLDER_MAX_BYTES) break;
    try {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const remaining = Math.max(0, DROPPED_FOLDER_MAX_BYTES - used);
      const text = Buffer.from(bytes).toString("utf8").slice(0, remaining);
      used += text.length;
      parts.push(`\n--- ${file.label} ---\n${text}`);
    } catch {
      parts.push(`\n--- ${file.label} (unreadable) ---`);
    }
  }

  if (files.length >= DROPPED_FOLDER_MAX_FILES) {
    parts.push(`\n[Folder truncated at ${DROPPED_FOLDER_MAX_FILES} files]`);
  }
  if (used >= DROPPED_FOLDER_MAX_BYTES) {
    parts.push(`\n[Folder content truncated at ${Math.round(DROPPED_FOLDER_MAX_BYTES / 1024)}KB]`);
  }

  return { name: label, text: parts.join("\n") };
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "safegraph.chatView";

  private view?: vscode.WebviewView;
  private currentAbort?: AbortController;
  private autoRunDoneFor = new Set<string>();
  private history: { role: "user" | "assistant"; text: string }[] = [];
  private cmdRunner: CommandRunner;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.cmdRunner = new CommandRunner(output);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.output.appendLine(`[safegraph-ai] resolveWebviewView: ${ChatViewProvider.viewType}`);
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    let version = "0.0.1";
    try {
      const fs = require("fs");
      const pkgPath = this.context.extensionUri.fsPath + "/package.json";
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      version = pkg.version || "0.0.1";
    } catch (e) {
      this.output.appendLine(`[safegraph-ai] failed to read version: ${String(e)}`);
    }

    const agentModeDefault = Boolean(vscode.workspace.getConfiguration("safegraph").get("agentModeDefault", true));
    webviewView.webview.html = getChatWebviewHtml(
      webviewView.webview,
      this.context.extensionUri,
      version,
      agentModeDefault
    );

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      if (msg.type === "ready") return;
      if (msg.type === "setApiKey") {
        await vscode.commands.executeCommand("safegraph.setBedrockApiKey");
        return;
      }
      if (msg.type === "checkApiKey") {
        await vscode.commands.executeCommand("safegraph.checkBedrockApiKey");
        return;
      }
      if (msg.type === "openLog") {
        await vscode.commands.executeCommand("safegraph.openLog");
        return;
      }
      if (msg.type === "moveRight") {
        await vscode.commands.executeCommand("safegraph.moveChatRight");
        return;
      }
      if (msg.type === "clearChat") {
        this.history = [];
        this.currentAbort?.abort();
        this.output.appendLine("[safegraph-ai] chat history cleared");
        return;
      }
      if (msg.type === "pickFilesOrFolders") {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: true,
          openLabel: "Attach to Safegraph AI"
        });
        for (const uri of picked || []) {
          try {
            const item = await readDroppedPath(uri);
            webviewView.webview.postMessage({
              type: "contextItem",
              kind: "attachment",
              name: item.name,
              text: item.text,
              ts: Date.now()
            } satisfies ExtensionToWebviewMessage);
            this.output.appendLine(`[safegraph-ai] picked item attached: ${maskSensitive(item.name)}`);
          } catch (e) {
            webviewView.webview.postMessage({
              type: "error",
              message: `Could not attach selected item: ${maskSensitive(uri.fsPath)} (${String(e)})`,
              ts: Date.now()
            } satisfies ExtensionToWebviewMessage);
          }
        }
        return;
      }
      if (msg.type === "addActiveFile") {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== "file") {
          webviewView.webview.postMessage({
            type: "error",
            message: "No active file editor to add.",
            ts: Date.now()
          } satisfies ExtensionToWebviewMessage);
          return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const path = workspaceFolder
          ? vscode.workspace.asRelativePath(editor.document.uri, false)
          : editor.document.uri.fsPath;
        webviewView.webview.postMessage({
          type: "contextItem",
          kind: "file",
          path,
          label: path.split(/[\\/]/).slice(-2).join("/"),
          ts: Date.now()
        } satisfies ExtensionToWebviewMessage);
        return;
      }
      if (msg.type === "addSelection") {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          webviewView.webview.postMessage({
            type: "error",
            message: "No active editor selection to add.",
            ts: Date.now()
          } satisfies ExtensionToWebviewMessage);
          return;
        }

        const selectionText = editor.document.getText(editor.selection).trim();
        if (!selectionText) {
          webviewView.webview.postMessage({
            type: "error",
            message: "Select code in the editor first, then click Selection.",
            ts: Date.now()
          } satisfies ExtensionToWebviewMessage);
          return;
        }

        const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
        const start = editor.selection.start;
        webviewView.webview.postMessage({
          type: "contextItem",
          kind: "attachment",
          name: `${rel}:${start.line + 1}`,
          text: selectionText,
          ts: Date.now()
        } satisfies ExtensionToWebviewMessage);
        return;
      }
      if (msg.type === "droppedUris") {
        const uris = (msg.uris || []).slice(0, 8);
        if (uris.length === 0) return;

        for (const raw of uris) {
          try {
            const uri = raw.startsWith("file:") || raw.startsWith("vscode-remote:")
              ? vscode.Uri.parse(raw)
              : vscode.Uri.file(raw);
            const item = await readDroppedPath(uri);
            webviewView.webview.postMessage({
              type: "contextItem",
              kind: "attachment",
              name: item.name,
              text: item.text,
              ts: Date.now()
            } satisfies ExtensionToWebviewMessage);
            this.output.appendLine(`[safegraph-ai] dropped URI attached: ${maskSensitive(item.name)}`);
          } catch (e) {
            const message = `Could not attach dropped item: ${maskSensitive(raw)} (${String(e)})`;
            this.output.appendLine(`[safegraph-ai] ${message}`);
            webviewView.webview.postMessage({
              type: "error",
              message,
              ts: Date.now()
            } satisfies ExtensionToWebviewMessage);
          }
        }
        return;
      }
      if (msg.type === "applyDiff") {
        try {
          await applyUnifiedDiffToWorkspaceSmart(msg.diff, this.output);
          vscode.window.showInformationMessage("Safegraph AI: Applied changes.");
        } catch (e) {
          const formatted = formatApplyError(e);
          this.output.appendLine(`[safegraph-ai] applyDiff failed: ${formatted}`);
          vscode.window.showErrorMessage(formatted, { modal: true });
        }
        return;
      }
      if (msg.type === "stop") {
        this.currentAbort?.abort();
        this.output.appendLine("[safegraph-ai] stop requested");
        return;
      }
      if (msg.type === "suggestFiles") {
        try {
          const query = (msg.query || "").toLowerCase();
          const files = await vscode.workspace.findFiles(
            "**/*",
            "**/{node_modules,.git,dist,build,out,venv,.venv}/**",
            200
          );
          const filtered = files
            .map((u) => u.fsPath)
            .filter((p) => p.toLowerCase().includes(query))
            .slice(0, 30)
            .map((p) => ({ path: p, label: p.split(/[\\/]/).slice(-2).join("/") }));

          const resp: ExtensionToWebviewMessage = {
            type: "fileSuggestions",
            items: filtered,
            ts: Date.now()
          };
          webviewView.webview.postMessage(resp);
        } catch (e) {
          this.output.appendLine(`[safegraph-ai] suggestFiles failed: ${String(e)}`);
        }
        return;
      }
      if (msg.type === "runCommand") {
        const folders = vscode.workspace.workspaceFolders;
        const cwd = folders?.[0]?.uri.fsPath || process.cwd();
        this.cmdRunner.run(msg.id, msg.cmd, cwd, (m) => webviewView.webview.postMessage(m));
        return;
      }
      if (msg.type === "cancelCommand") {
        this.cmdRunner.cancel(msg.id, (m) => webviewView.webview.postMessage(m));
        return;
      }
      if (msg.type === "userMessage") {
        let apiKeySource = "unknown";
        const postStatus = (text: string) => {
          webviewView.webview.postMessage({
            type: "assistantMessage",
            id: msg.id,
            text,
            ts: Date.now(),
            done: false
          } satisfies ExtensionToWebviewMessage);
        };
        try {
          this.currentAbort?.abort();
          this.currentAbort = new AbortController();
          this.autoRunDoneFor.delete(msg.id);

          postStatus("Checking Bedrock credentials...");
          const apiKeyInfos = await loadBedrockApiKeyInfos([this.context.extensionUri.fsPath]);
          const secretKey = await this.context.secrets.get("safegraph.bedrockApiKey");
          if (secretKey) {
            apiKeyInfos.push({
              value: secretKey,
              keyName: "safegraph.bedrockApiKey",
              source: "VS Code SecretStorage"
            });
          }
          if (apiKeyInfos.length > 0) {
            this.output.appendLine(
              `[safegraph-ai] found ${apiKeyInfos.length} Bedrock API key candidate(s): ${apiKeyInfos
                .map((k) => `${k.keyName} from ${k.source} (${maskApiKey(k.value)})`)
                .join(", ")}`
            );
          }
          if (apiKeyInfos.length === 0) {
            const err: ExtensionToWebviewMessage = {
              type: "error",
              message:
                "Missing Bedrock API key. Add AWS_BEARER_TOKEN_BEDROCK (or API_KEY) to workspace .env, or click 'Set Key' in the chat header.",
              ts: Date.now()
            };
            webviewView.webview.postMessage(err);
            return;
          }

          const cfg = vscode.workspace.getConfiguration("safegraph");
          const region = String(cfg.get("region") || "ap-southeast-1");
          const autoRunMode = String(cfg.get("autoRun") || "safe");
          const modelId = String(
            cfg.get("modelId") ||
              "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623"
          );

          postStatus("Reading workspace context...");
          const ctx = await buildContext({
            maxChars: 8000,
            maxFiles: 80,
            includeFiles: msg.taggedFiles || []
          });
          const maskedCtx = maskSensitive(ctx);
          const maskedQuestion = maskSensitive(msg.text);
          const conversation = this.history
            .slice(-8)
            .map((h) => `${h.role === "user" ? "User" : "Safegraph AI"}: ${maskSensitive(h.text).slice(0, 2000)}`)
            .join("\n\n");
          const tagged = (msg.taggedFiles || []).map((p) => maskSensitive(p));
          const atts = (msg.attachments || [])
            .slice(0, 8)
            .map((a) => ({
              name: maskSensitive(String(a.name || "file")),
              text: maskSensitive(String(a.text || "")).slice(0, 50_000)
            }))
            .filter((a) => a.text.trim().length > 0);

          const prompt =
            `You are Safegraph AI, an intelligent VS Code assistant. You provide expert help with:
- Code analysis, refactoring, and best practices
- Bug fixing and debugging
- Feature implementation and architecture design
- Testing, documentation, and code quality
- Terminal commands and build systems

RESPONSE GUIDELINES:
1. Reply in the same language as the user. If the user writes Vietnamese, use clear Vietnamese.
2. Do not introduce yourself unless asked. For greetings like "hi", answer in one short sentence and ask what they want to do.
3. Write like an IDE assistant: direct, concise, and action-oriented. Avoid long capability lists.
4. Start with the fix or next action. Then give a short reason only if it helps the user make the right choice.
5. Prefer concrete steps: what file to open, what command to run, what URL to visit, or what button to click.
6. When explaining an error, use this shape: "Lỗi là...", "Cách sửa...", "Vì sao...". Keep each part short.
7. For code changes, file creation, folder structure changes, or content edits, ALWAYS provide a complete unified diff in a fenced code block marked 'diff'. Safegraph applies diff blocks automatically in Agent Mode.
8. Diff blocks must contain only valid unified diff lines. Never put explanations inside a diff block. Every hunk body line must start with one of: space, +, -.
9. Do NOT create or edit project files with terminal heredocs or shell text-writing commands such as cat > file <<EOF, echo > file, tee, printf > file, or touch. Use a diff block instead.
10. For terminal commands, include only commands used to install dependencies, run apps, run tests, or inspect the project. Put ONLY exact commands (one per line) in a fenced code block marked 'sh'.
11. Use the file paths relative to workspace root.
12. For new files: use --- /dev/null and +++ b/<path>.
13. For deleted files: use --- a/<path> and +++ /dev/null.
14. Prefer smaller per-file hunks over one huge patch when editing existing files.
15. Do not dump long explanations when a simple action is enough.
16. Current terminal setting: safegraph.autoRun=${autoRunMode}. In "safe" mode, allowlisted commands run automatically and other commands trigger a VS Code confirmation dialog. In "ask" mode, every command asks. In "off" mode, no command runs automatically.
17. For Python virtualenv workflows, prefer commands that do not require persistent shell activation, for example: python3.12 -m venv venv, venv/bin/python -m pip install ..., venv/bin/python app.py, venv/bin/python -m streamlit run app.py.
${msg.agentMode ? `18. AGENT MODE IS ON. Do not only give instructions. If the task requires creating app.py, templates, static files, config files, or any project structure, output the actual unified diff so Safegraph can apply it. After the diff, provide only safe verification/run commands that Safegraph can execute or ask permission for.` : ""}

CONTEXT:
${maskedCtx}
${conversation ? "\nRecent conversation:\n" + conversation : ""}
${tagged.length ? "\nTagged files (@):\n" + tagged.join("\n") : ""}
${atts.length ? "\nAttachments:\n" + atts.map((a) => `[${a.name}] ${a.text}`).join("\n\n") : ""}

User query:
${maskedQuestion}`;

          const thinking: ExtensionToWebviewMessage = {
            type: "assistantMessage",
            id: msg.id,
            text: "Calling Bedrock... (timeout 60s)",
            ts: Date.now(),
            done: false
          };
          webviewView.webview.postMessage(thinking);

          // Auto-continue if Bedrock stops due to max_tokens.
          let combined = "";
          let loops = 0;
          let nextPrompt = prompt;
          for (;;) {
            let r = null as Awaited<ReturnType<typeof bedrockConverse>> | null;
            let lastExpiredSource = "";
            for (const info of apiKeyInfos) {
              apiKeySource = formatApiKeySource(info);
              try {
                postStatus(`Calling Bedrock with ${info.keyName}... (timeout 60s)`);
                this.output.appendLine(
                  `[safegraph-ai] trying Bedrock API key ${maskApiKey(info.value)} from ${apiKeySource}`
                );
                r = await bedrockConverse(nextPrompt, {
                  region,
                  modelId,
                  apiKey: info.value,
                  signal: this.currentAbort.signal,
                  retries: 0
                });
                break;
              } catch (e) {
                if (!isExpiredBearerTokenError(e)) throw e;
                lastExpiredSource = apiKeySource;
                this.output.appendLine(`[safegraph-ai] expired Bedrock API key from ${apiKeySource}; trying next key`);
              }
            }
            if (!r) {
              throw new Error(
                `All Bedrock API key candidates are expired. Last expired key source: ${lastExpiredSource || apiKeySource}`
              );
            }
            combined = (combined + (combined ? "\n" : "") + r.text).trim();
            loops += 1;
            if (this.currentAbort.signal.aborted) throw new Error("aborted");
            if (r.stopReason !== "max_tokens") break;
            if (loops >= 3) break;
            nextPrompt =
              "Continue from where you left off. Do not repeat earlier text.\n\nPrevious output:\n" +
              combined +
              "\n\nContinue:";
          }

          let acc = "";
          const chunkSize = 80;
          for (let i = 0; i < combined.length; i += chunkSize) {
            if (this.currentAbort.signal.aborted) throw new Error("aborted");
            acc += combined.slice(i, i + chunkSize);
            const delta: ExtensionToWebviewMessage = {
              type: "assistantMessage",
              id: msg.id,
              text: acc,
              ts: Date.now(),
              done: false
            };
            webviewView.webview.postMessage(delta);
            await new Promise((r) => setTimeout(r, 25));
          }

          const reply: ExtensionToWebviewMessage = {
            type: "assistantMessage",
            id: msg.id,
            text: acc,
            ts: Date.now(),
            done: true
          };
          webviewView.webview.postMessage(reply);
          this.history.push({ role: "user", text: msg.text });
          this.history.push({ role: "assistant", text: acc });
          if (this.history.length > 16) {
            this.history = this.history.slice(-16);
          }

          if (msg.agentMode) {
            const diffs = extractDiffBlocks(acc);
            if (diffs.length > 0) {
              try {
                await applyUnifiedDiffToWorkspaceSmart(diffs.join("\n\n"), this.output);
                webviewView.webview.postMessage({
                  type: "assistantMessage",
                  id: `${msg.id}-agent-apply`,
                  text: "Agent: đã apply diff vào workspace.",
                  ts: Date.now(),
                  done: true
                } satisfies ExtensionToWebviewMessage);
              } catch (e) {
                const formatted = formatApplyError(e);
                this.output.appendLine(`[safegraph-ai] agent apply failed: ${formatted}`);
                webviewView.webview.postMessage({
                  type: "error",
                  message: formatted,
                  ts: Date.now()
                });
              }
            } else if (hasShellFileWrite(acc)) {
              webviewView.webview.postMessage({
                type: "error",
                message:
                  "Agent cần tạo/sửa file bằng diff để Safegraph tự apply. AI vừa trả về lệnh ghi file bằng terminal, nên extension đã không tự chạy. Hãy gửi lại yêu cầu hoặc bật Agent và yêu cầu tạo unified diff.",
                ts: Date.now()
              });
            }
          }

          // Cursor-like behavior: propose terminal commands in UI (no terminal panel pop).
          if (!this.autoRunDoneFor.has(msg.id)) {
            this.autoRunDoneFor.add(msg.id);
            const cfg2 = vscode.workspace.getConfiguration("safegraph");
            const mode = String(cfg2.get("autoRun") || "safe") as any;
            const proposed = this.cmdRunner.proposeFromAssistantText(acc, mode);
            if (proposed.length) {
              webviewView.webview.postMessage({ type: "commandProposed", items: proposed, ts: Date.now() });
              const folders = vscode.workspace.workspaceFolders;
              const cwd = folders?.[0]?.uri.fsPath || process.cwd();
              for (const item of proposed) {
                if (item.decision === "allow") {
                  this.cmdRunner.run(item.id, item.cmd, cwd, (m) => webviewView.webview.postMessage(m));
                } else if (item.decision === "ask") {
                  const ok = await vscode.window.showWarningMessage(
                    `Safegraph AI muốn chạy command:\n\n${item.cmd}\n\nLý do: ${item.reason}`,
                    { modal: true },
                    "Run"
                  );
                  if (ok === "Run") {
                    this.cmdRunner.run(item.id, item.cmd, cwd, (m) => webviewView.webview.postMessage(m));
                  } else {
                    webviewView.webview.postMessage({
                      type: "commandUpdate",
                      id: item.id,
                      status: "denied",
                      output: "Command skipped by user.",
                      ts: Date.now()
                    } satisfies ExtensionToWebviewMessage);
                  }
                }
              }
            }
          }
        } catch (e) {
          this.output.appendLine(`[safegraph-ai] bedrock error: ${String(e)}`);
          if (/aborted/i.test(String(e))) {
            return;
          }
          let message = String(e);
          if (isExpiredBearerTokenError(e)) {
            await this.context.secrets.delete("safegraph.bedrockApiKey");
            message =
              `Bedrock API key da het han. Extension vua dung key tu: ${apiKeySource}. Tao key moi trong AWS Console, cap nhat AWS_BEARER_TOKEN_BEDROCK/API_KEY trong .env hoac chay 'Safegraph AI: Set Bedrock API Key', roi thu lai.`;
          } else if (/All Bedrock API key candidates are expired/i.test(message)) {
            await this.context.secrets.delete("safegraph.bedrockApiKey");
            message =
              `${message}. Hay xoa key cu trong .env hoac cap nhat tat ca cac bien AWS_BEARER_TOKEN_BEDROCK/API_KEY bang key moi.`;
          }
          const err: ExtensionToWebviewMessage = {
            type: "error",
            message,
            ts: Date.now()
          };
          webviewView.webview.postMessage(err);
        }
      }
    });
  }
}
