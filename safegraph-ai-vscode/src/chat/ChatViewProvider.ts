import * as vscode from "vscode";
import { getChatWebviewHtml } from "./webviewHtml";
import { bedrockConverse } from "../bedrock/bedrockClient";
import { buildContext } from "../context/contextBuilder";
import { maskSensitive } from "../security/mask";
import { loadBedrockApiKeyFromDotEnv } from "../config/env";
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
  | { type: "moveRight" }
  | { type: "clearChat" }
  | { type: "applyDiff"; diff: string }
  | { type: "stop" }
  | { type: "suggestFiles"; query: string }
  | { type: "runCommand"; id: string; cmd: string }
  | { type: "cancelCommand"; id: string };

type ExtensionToWebviewMessage =
  | { type: "assistantMessage"; id: string; text: string; ts: number; done?: boolean }
  | { type: "error"; message: string; ts: number }
  | { type: "fileSuggestions"; items: { path: string; label: string }[]; ts: number }
  | CommandUpdateMessage;

function formatApplyError(e: unknown) {
  const raw = String(e instanceof Error ? e.message : e);
  const normalized = raw.replace(/^Error:\s*/i, "").trim();

  if (/corrupt patch/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Lỗi là patch AI trả về không đúng format unified diff nên VS Code chưa apply được.",
      "Cách sửa: bấm New Chat hoặc hỏi lại AI: tạo lại diff sạch, chỉ có ```diff, không kèm giải thích trong block diff.",
      "Vì sao: nếu trong block diff có chữ giải thích, hoặc số dòng hunk bị lệch, git sẽ báo corrupt patch."
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
        try {
          this.currentAbort?.abort();
          this.currentAbort = new AbortController();
          this.autoRunDoneFor.delete(msg.id);

          let apiKey = (await this.context.secrets.get("safegraph.bedrockApiKey")) || "";
          if (!apiKey) {
            const envKey = await loadBedrockApiKeyFromDotEnv([this.context.extensionUri.fsPath]);
            if (envKey) {
              apiKey = envKey;
              await this.context.secrets.store("safegraph.bedrockApiKey", apiKey);
              this.output.appendLine("[safegraph-ai] loaded Bedrock API key from .env into SecretStorage");
            }
          }
          if (!apiKey) {
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
2. Write for a normal developer using VS Code, not for a framework expert. Avoid academic headings like "Issue Analysis" unless the user asks for a report.
3. Start with the fix or next action. Then give a short reason only if it helps the user make the right choice.
4. Prefer concrete steps: what file to open, what command to run, what URL to visit, or what button to click.
5. When explaining an error, use this shape: "Lỗi là...", "Cách sửa...", "Vì sao...". Keep each part short.
6. For code changes, file creation, folder structure changes, or content edits, ALWAYS provide a complete unified diff in a fenced code block marked 'diff'. Safegraph applies diff blocks automatically in Agent Mode.
7. Do NOT create or edit project files with terminal heredocs or shell text-writing commands such as cat > file <<EOF, echo > file, tee, printf > file, or touch. Use a diff block instead.
8. For terminal commands, include only commands used to install dependencies, run apps, run tests, or inspect the project. Put ONLY exact commands (one per line) in a fenced code block marked 'sh'.
9. Use the file paths relative to workspace root.
10. For new files: use --- /dev/null and +++ b/<path>.
11. For deleted files: use --- a/<path> and +++ /dev/null.
12. Do not dump long explanations when a simple action is enough.
13. Current terminal setting: safegraph.autoRun=${autoRunMode}. In "safe" mode, allowlisted commands run automatically and other commands trigger a VS Code confirmation dialog. In "ask" mode, every command asks. In "off" mode, no command runs automatically.
14. For Python virtualenv workflows, prefer commands that do not require persistent shell activation, for example: python3.12 -m venv venv, venv/bin/python -m pip install ..., venv/bin/python app.py, venv/bin/python -m streamlit run app.py.
${msg.agentMode ? `15. AGENT MODE IS ON. Do not only give instructions. If the task requires creating app.py, templates, static files, config files, or any project structure, output the actual unified diff so Safegraph can apply it. After the diff, provide only safe verification/run commands that Safegraph can execute or ask permission for.` : ""}

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
            text: "",
            ts: Date.now(),
            done: false
          };
          webviewView.webview.postMessage(thinking);

          // Auto-continue if Bedrock stops due to max_tokens.
          let combined = "";
          let loops = 0;
          let nextPrompt = prompt;
          for (;;) {
            const r = await bedrockConverse(nextPrompt, {
              region,
              modelId,
              apiKey,
              signal: this.currentAbort.signal
            });
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
          const err: ExtensionToWebviewMessage = {
            type: "error",
            message: String(e),
            ts: Date.now()
          };
          webviewView.webview.postMessage(err);
        }
      }
    });
  }
}
