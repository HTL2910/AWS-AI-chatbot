import * as vscode from "vscode";
import { getChatWebviewHtml } from "./webviewHtml";
import { bedrockConverse } from "../bedrock/bedrockClient";
import { buildContext } from "../context/contextBuilder";
import { maskSensitive } from "../security/mask";
import { loadBedrockApiKeyFromDotEnv, loadBedrockApiKeyInfos, maskApiKey } from "../config/env";
import { applyUnifiedDiffToWorkspaceSmart, parseUnifiedDiff, preflightUnifiedDiffAgainstWorkspace } from "../apply/unifiedDiff";
import { CommandRunner, CommandRunResult, CommandUpdateMessage } from "../terminal/commandRunner";

type WebviewToExtensionMessage =
  | {
      type: "userMessage";
      id: string;
      text: string;
      ts: number;
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
  | { type: "contextItem"; kind: "file"; path: string; label: string; ts: number }
  | { type: "contextItem"; kind: "attachment"; name: string; text: string; ts: number }
  | { type: "fileSuggestions"; items: { path: string; label: string }[]; ts: number }
  | CommandUpdateMessage;

function formatApplyError(e: unknown) {
  const raw = String(e instanceof Error ? e.message : e);
  const normalized = raw.replace(/^Error:\s*/i, "").trim();

  if (/corrupt patch/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Reason: the diff was not a valid unified patch. This can happen when multiple file diffs are split incorrectly, or when model text is mixed into the patch.",
      "Fix: use Apply All on the combined diff, or ask Safegraph AI to regenerate the patch as a clean ```diff block."
    ].join("\n");
  }

  if (/Context mismatch|Delete line mismatch|Hunk out of range|patch does not apply|does not match/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Reason: the target file changed or the patch context no longer matches your workspace.",
      "Fix: ask Safegraph AI to regenerate the diff from the current file contents."
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

    webviewView.webview.html = getChatWebviewHtml(webviewView.webview, this.context.extensionUri, version);

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
        await this.pickFilesOrFolders(webviewView.webview);
        return;
      }
      if (msg.type === "addActiveFile") {
        this.addActiveFile(webviewView.webview);
        return;
      }
      if (msg.type === "addSelection") {
        this.addSelection(webviewView.webview);
        return;
      }
      if (msg.type === "droppedUris") {
        await this.addDroppedUris(webviewView.webview, msg.uris || []);
        return;
      }
      if (msg.type === "applyDiff") {
        try {
          await this.applyDiffWithRepair(msg.diff, "Manual Apply All");
          vscode.window.showInformationMessage("Safegraph AI: Applied validated changes.");
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
          const specialItems =
            query.length > 0 && ("repository".includes(query) || "repo".includes(query))
              ? [{ path: "@Repository", label: "Repository" }]
              : [];
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
            items: [...specialItems, ...filtered],
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
          const modelId = String(
            cfg.get("modelId") ||
              "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623"
          );

          const ctx = await buildContext({
            maxChars: 24000,
            maxFiles: 80,
            includeFiles: (msg.taggedFiles || []).filter((p) => p !== "@Repository"),
            query: msg.text,
            storageUri: this.context.globalStorageUri,
            includeRepository: true
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
            `You are Safegraph AI, an autonomous senior software engineer inside VS Code with 20 years of production experience. You provide expert help with:
- Code analysis, refactoring, and best practices
- Bug fixing and debugging
- Feature implementation and architecture design
- Testing, documentation, and code quality
- Terminal commands and build systems
- Product requirement analysis, UX design, UI mockups, and implementation-ready frontend design

RESPONSE GUIDELINES:
1. Reply in the same language as the user. If the user writes Vietnamese, use clear Vietnamese.
2. Act like a pragmatic staff engineer: diagnose root causes, choose a maintainable fix, consider edge cases, and avoid fragile quick hacks unless the user clearly needs a temporary workaround.
3. Own the problem end-to-end. Do not stop at suggestions when a code change can solve it. Create/update files, propose safe verification commands, and make the project runnable.
4. Ask questions only when the decision is high-risk, security-sensitive, destructive, costly, or materially changes product direction. For ordinary missing details, make a conservative assumption and proceed.
5. Write for a normal developer using VS Code, not for a framework expert. Avoid academic headings like "Issue Analysis" unless the user asks for a report.
6. Start with the fix or next action. Then give a short reason only if it helps the user make the right choice.
7. Prefer concrete steps: what file to open, what command to run, what URL to visit, or what button to click.
8. When explaining an error, use this shape: "Lỗi là...", "Cách sửa...", "Vì sao...". Keep each part short.
9. For code changes, ALWAYS provide a complete unified diff in a fenced code block marked 'diff'. Safegraph will validate and apply it automatically.
10. For terminal commands, put ONLY exact commands (one per line) in a fenced code block marked 'sh'. Safegraph will run safe commands automatically and ask only for sensitive commands.
11. Use the file paths relative to workspace root.
12. For new files: use --- /dev/null and +++ b/<path>.
13. For deleted files: use --- a/<path> and +++ /dev/null.
14. Analyze the user's real goal before coding. If details are missing, make conservative product/design assumptions and proceed; ask only when a wrong assumption could cause data loss, security risk, cost, or a materially different product.
15. If the user only pasted an error, traceback, terminal output, failing test, malformed diff, or code snippet without saying what they want, infer the request as: diagnose it, locate the relevant file(s), fix the underlying issue, and validate the fix. Do not ask "what do you want me to do?" for pasted bugs.
16. If the user pasted only code, infer whether it is incomplete, duplicated, malformed, or should replace the active file. Use active file/workspace context to decide. Fix syntax/integration issues instead of echoing the code back.
17. For UI/product tasks, act as a product designer and frontend engineer: infer target users, main workflow, information hierarchy, empty/loading/error states, responsive behavior, accessibility, and visual style before implementation.
18. If the user asks for a mockup, design, website, dashboard, app screen, or UI improvement, create an implementable mockup in code. Prefer editing/creating real project files such as HTML/CSS/JS/React components. If the repo has no app structure, create a minimal runnable mockup.
19. For frontend design, use existing project conventions first. Build the actual usable screen, not a marketing explanation. Avoid generic one-color themes, oversized decorative cards, and visible text explaining how to use the UI.
20. Make UI complete enough to inspect: realistic labels/data, responsive layout, clear primary actions, hover/focus states, error/empty/loading states where relevant.
21. Before giving final text, make the code complete enough to run. Include verification commands after the diff when useful.
22. Do not dump long explanations when a simple action is enough.

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
              signal: this.currentAbort.signal,
              maxTokens: 8192,
              temperature: 0.2
            });
            combined = (combined + (combined ? "\n" : "") + r.text).trim();
            loops += 1;
            if (this.currentAbort.signal.aborted) throw new Error("aborted");
            if (r.stopReason !== "max_tokens") break;
            if (loops >= 3) break;
            nextPrompt =
              prompt +
              "\n\nContinue from where you left off. Do not repeat earlier text. Keep following the original unified-diff and safe-command rules.\n\nPrevious output:\n" +
              combined +
              "\n\nContinue:";
          }

          const diffBlocks = extractDiffBlocks(combined);
          let appliedDiff = false;
          if (diffBlocks.length > 0) {
            await this.applyDiffWithRepair(
              diffBlocks.join("\n\n"),
              "Autonomous chat code changes"
            );
            appliedDiff = true;
            combined += "\n\nAgent: đã validate và apply code vào workspace.";
          }

          if (appliedDiff) {
            const loopResult = await this.runAgentVerificationLoop({
              initialAssistantText: combined,
              userText: msg.text,
              apiKey,
              region,
              modelId,
              webview: webviewView.webview
            });
            if (loopResult) combined += `\n\n${loopResult}`;
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
                  this.output.appendLine(`[safegraph-ai] command requires inline approval: ${item.cmd} (${item.reason})`);
                }
              }
            }
          }
        } catch (e) {
          if (String(e instanceof Error ? e.message : e).toLowerCase().includes("aborted")) {
            this.output.appendLine("[safegraph-ai] request aborted by user");
            return;
          }
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

  private async loadApiKey() {
    let apiKey = (await this.context.secrets.get("safegraph.bedrockApiKey")) || "";
    if (!apiKey) {
      const envKey = await loadBedrockApiKeyFromDotEnv([this.context.extensionUri.fsPath]);
      if (envKey) {
        apiKey = envKey;
        await this.context.secrets.store("safegraph.bedrockApiKey", apiKey);
        this.output.appendLine("[safegraph-ai] loaded Bedrock API key from .env into SecretStorage");
      }
    }
    return apiKey;
  }

  async checkApiKeyStatus() {
    const secretKey = (await this.context.secrets.get("safegraph.bedrockApiKey")) || "";
    const envInfos = await loadBedrockApiKeyInfos([this.context.extensionUri.fsPath]);

    const lines: string[] = [];
    if (secretKey) {
      lines.push(`SecretStorage: ${maskApiKey(secretKey)}`);
    } else {
      lines.push("SecretStorage: empty");
    }

    if (envInfos.length) {
      lines.push("Detected .env/process keys:");
      for (const info of envInfos) {
        lines.push(`- ${info.keyName} from ${info.source}: ${maskApiKey(info.value)}`);
      }
    } else {
      lines.push("Detected .env/process keys: none");
    }

    const effective = secretKey ? "VS Code SecretStorage" : envInfos[0]?.source;
    if (effective) {
      vscode.window.showInformationMessage(`Safegraph AI: Bedrock key found from ${effective}.`);
    } else {
      vscode.window.showWarningMessage("Safegraph AI: No Bedrock API key found.");
    }

    this.output.appendLine("[safegraph-ai] Bedrock API key status");
    this.output.appendLine(lines.join("\n"));
    this.output.show(true);
  }

  openLog() {
    this.output.show(true);
  }

  private workspaceRelativePath(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return uri.fsPath;
    const relative = vscode.workspace.asRelativePath(uri, false);
    return relative || uri.fsPath;
  }

  private labelForUri(uri: vscode.Uri) {
    const parts = this.workspaceRelativePath(uri).split(/[\\/]/).filter(Boolean);
    return parts.slice(-2).join("/") || uri.fsPath.split(/[\\/]/).pop() || uri.fsPath;
  }

  private postFileContext(webview: vscode.Webview, uri: vscode.Uri) {
    webview.postMessage({
      type: "contextItem",
      kind: "file",
      path: this.workspaceRelativePath(uri),
      label: this.labelForUri(uri),
      ts: Date.now()
    } satisfies ExtensionToWebviewMessage);
  }

  private async postAttachmentContext(webview: vscode.Webview, uri: vscode.Uri) {
    const stat = await vscode.workspace.fs.stat(uri);
    const maxBytes = 200 * 1024;
    if (stat.size > maxBytes) {
      vscode.window.showWarningMessage(`Safegraph AI: skipped ${uri.fsPath}; file is larger than 200KB.`);
      return;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    if (text.includes("\u0000")) {
      vscode.window.showWarningMessage(`Safegraph AI: skipped binary file ${uri.fsPath}.`);
      return;
    }
    webview.postMessage({
      type: "contextItem",
      kind: "attachment",
      name: this.labelForUri(uri),
      text,
      ts: Date.now()
    } satisfies ExtensionToWebviewMessage);
  }

  private async addUriContext(webview: vscode.Webview, uri: vscode.Uri) {
    if (uri.scheme !== "file") return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      this.postFileContext(webview, uri);
    } else {
      await this.postAttachmentContext(webview, uri);
    }
  }

  private async pickFilesOrFolders(webview: vscode.Webview) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Attach to Safegraph AI"
    });
    for (const uri of uris || []) {
      await this.addUriContext(webview, uri);
    }
  }

  private addActiveFile(webview: vscode.Webview) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Safegraph AI: no active editor file.");
      return;
    }
    this.postFileContext(webview, editor.document.uri);
  }

  private addSelection(webview: vscode.Webview) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showWarningMessage("Safegraph AI: no selected text.");
      return;
    }
    webview.postMessage({
      type: "contextItem",
      kind: "attachment",
      name: `${this.labelForUri(editor.document.uri)} selection`,
      text: editor.document.getText(editor.selection),
      ts: Date.now()
    } satisfies ExtensionToWebviewMessage);
  }

  private async addDroppedUris(webview: vscode.Webview, rawUris: string[]) {
    let accepted = 0;
    for (const raw of rawUris.slice(0, 40)) {
      try {
        const text = String(raw || "").trim();
        if (!text) continue;
        const uri = text.startsWith("file:") ? vscode.Uri.parse(text) : vscode.Uri.file(text);
        await this.addUriContext(webview, uri);
        accepted += 1;
      } catch (error) {
        this.output.appendLine(`[safegraph-ai] dropped URI ignored: ${String(raw)} (${String(error)})`);
      }
    }
    if (accepted === 0) {
      vscode.window.showWarningMessage("Safegraph AI: drop was received, but no readable file URI was found.");
    }
  }

  private modelConfig() {
    const cfg = vscode.workspace.getConfiguration("safegraph");
    return {
      region: String(cfg.get("region") || "ap-southeast-1"),
      modelId: String(
        cfg.get("modelId") ||
          "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623"
      )
    };
  }

  private async converseComplete(prompt: string, options: { region: string; modelId: string; apiKey: string; maxTokens?: number; temperature?: number }) {
    let combined = "";
    let loops = 0;
    let nextPrompt = prompt;
    for (;;) {
      const r = await bedrockConverse(nextPrompt, {
        region: options.region,
        modelId: options.modelId,
        apiKey: options.apiKey,
        signal: this.currentAbort?.signal,
        maxTokens: options.maxTokens ?? 8192,
        temperature: options.temperature ?? 0.15
      });
      combined = (combined + (combined ? "\n" : "") + r.text).trim();
      loops += 1;
      if (this.currentAbort?.signal.aborted) throw new Error("aborted");
      if (r.stopReason !== "max_tokens" || loops >= 2) break;
      nextPrompt = `${prompt}\n\nContinue from where you left off. Do not repeat earlier text.\n\nPrevious output:\n${combined}\n\nContinue:`;
    }
    return combined;
  }

  private async runAgentVerificationLoop(options: {
    initialAssistantText: string;
    userText: string;
    apiKey: string;
    region: string;
    modelId: string;
    webview: vscode.Webview;
  }) {
    const cfg = vscode.workspace.getConfiguration("safegraph");
    const mode = String(cfg.get("autoRun") || "safe") as any;
    const maxLoops = Math.max(0, Math.min(3, Number(cfg.get("agent.maxFixLoops", 2))));
    if (maxLoops <= 0) return "";

    const folders = vscode.workspace.workspaceFolders;
    const cwd = folders?.[0]?.uri.fsPath || process.cwd();
    let assistantText = options.initialAssistantText;
    const notes: string[] = [];

    for (let loop = 1; loop <= maxLoops; loop += 1) {
      const proposed = this.cmdRunner.proposeFromAssistantText(assistantText, mode);
      const runnable = proposed.filter((item) => item.decision === "allow");
      const askOrDenied = proposed.filter((item) => item.decision !== "allow");
      if (askOrDenied.length > 0) {
        options.webview.postMessage({ type: "commandProposed", items: askOrDenied, ts: Date.now() });
      }
      if (runnable.length === 0) {
        if (loop === 1) notes.push("Agent verify: không có lệnh safe auto-run trong phản hồi.");
        break;
      }

      options.webview.postMessage({ type: "commandProposed", items: runnable, ts: Date.now() });
      const results: CommandRunResult[] = [];
      for (const item of runnable.slice(0, 4)) {
        if (this.currentAbort?.signal.aborted) throw new Error("aborted");
        const result = await this.cmdRunner.runAndWait(item.id, item.cmd, cwd, (m) => options.webview.postMessage(m));
        results.push(result);
        if (result.status !== "success") break;
      }

      const failed = results.find((r) => r.status !== "success");
      if (!failed) {
        notes.push(`Agent verify loop ${loop}: ${results.length} command(s) passed.`);
        break;
      }

      notes.push(`Agent verify loop ${loop}: command failed: ${failed.cmd}`);
      const terminalLog = failed.output.slice(-12000);
      const ctx = await buildContext({
        maxChars: 24000,
        maxFiles: 80,
        query: `${options.userText}\n${failed.cmd}\n${terminalLog}`,
        storageUri: this.context.globalStorageUri,
        includeRepository: true
      });
      const repairPrompt = `You are Safegraph AI continuing an autonomous edit-test-fix loop in VS Code.
The previous code changes were applied, then this verification command failed.
Return ONLY:
1. A clean fenced \`\`\`diff block if a code/config change is needed.
2. Safe verification commands in a fenced \`\`\`sh block.
No long explanation.

Original user request:
${maskSensitive(options.userText)}

Failed command:
${failed.cmd}

Terminal log:
\`\`\`
${maskSensitive(terminalLog)}
\`\`\`

Workspace context:
${maskSensitive(ctx)}`;

      const repair = await this.converseComplete(repairPrompt, {
        region: options.region,
        modelId: options.modelId,
        apiKey: options.apiKey,
        maxTokens: 8192,
        temperature: 0.1
      });
      const diffs = extractDiffBlocks(repair);
      if (diffs.length === 0) {
        notes.push(`Agent verify loop ${loop}: model did not return a repair diff.`);
        assistantText = repair;
        break;
      }

      await this.applyDiffWithRepair(diffs.join("\n\n"), `Agent verification repair loop ${loop}`);
      notes.push(`Agent verify loop ${loop}: applied repair diff.`);
      assistantText = repair;
    }

    return notes.length ? notes.join("\n") : "";
  }

  private async repairDiffWithBedrock(diff: string, errorMessage: string, reason: string) {
    const apiKey = await this.loadApiKey();
    if (!apiKey) throw new Error(`Cannot repair diff automatically: missing Bedrock API key. Original error: ${errorMessage}`);

    const { region, modelId } = this.modelConfig();
    const ctx = await buildContext({
      maxChars: 24000,
      maxFiles: 80
    });
    const currentFiles = await this.currentFilesForDiff(diff);

    const prompt = `You are repairing a unified diff before it is applied in VS Code.
Return ONLY one clean fenced code block marked diff. No explanation outside the diff block.

Rules:
- Use valid unified diff syntax only.
- Every hunk body line must start with exactly one of: space, +, -.
- Regenerate the patch against the CURRENT FILE CONTENTS below, not against stale context from the invalid diff.
- If the original patch intent is already present in the current file, return an empty diff block.
- Do not include stale retry text, duplicate imports, or raw hunk markers as code.
- Do not include terminal commands.
- Preserve the user's intended change, but prefer a smaller safe patch if unsure.
- For Python files, the resulting file must pass py_compile.

Reason: ${reason}
Preflight/apply error:
${errorMessage}

Workspace context:
${maskSensitive(ctx)}

Current target file contents:
${currentFiles || "(No target file contents could be read.)"}

Invalid diff:
\`\`\`diff
${diff}
\`\`\``;

    const repaired = await bedrockConverse(prompt, {
      region,
      modelId,
      apiKey,
      maxTokens: 8192,
      temperature: 0.1,
      signal: this.currentAbort?.signal
    });

    const match = repaired.text.match(/```diff\s*([\s\S]*?)```/i);
    const repairedDiff = (match ? match[1] : repaired.text).trim();
    if (!repairedDiff) throw new Error(`Diff repair returned empty output. Original error: ${errorMessage}`);
    return repairedDiff;
  }

  private async currentFilesForDiff(diff: string) {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) return "";
      const root = folders[0].uri;
      const patches = parseUnifiedDiff(diff);
      const parts: string[] = [];
      for (const patch of patches.slice(0, 6)) {
        if (patch.kind === "create") {
          parts.push(`--- ${patch.filePath} (new file) ---\n(file does not exist yet)`);
          continue;
        }
        const uri = vscode.Uri.joinPath(root, patch.filePath);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(bytes).toString("utf8");
          const body =
            text.length > 50_000
              ? `${text.slice(0, 25_000)}\n\n[...middle truncated...]\n\n${text.slice(-20_000)}`
              : text;
          parts.push(`--- ${patch.filePath} (current) ---\n${maskSensitive(body)}`);
        } catch {
          parts.push(`--- ${patch.filePath} (current) ---\n(unreadable or missing)`);
        }
      }
      return parts.join("\n\n");
    } catch (error) {
      this.output.appendLine(`[safegraph-ai] failed to collect current files for diff repair: ${String(error)}`);
      return "";
    }
  }

  private async prepareDiffForApply(diff: string, reason: string) {
    try {
      await preflightUnifiedDiffAgainstWorkspace(diff);
      return diff;
    } catch (firstError) {
      const firstMessage = String(firstError instanceof Error ? firstError.message : firstError);
      this.output.appendLine(`[safegraph-ai] preflight failed before apply: ${firstMessage}`);

      const repairedDiff = await this.repairDiffWithBedrock(diff, firstMessage, reason);
      try {
        await preflightUnifiedDiffAgainstWorkspace(repairedDiff);
        this.output.appendLine("[safegraph-ai] repaired diff passed preflight");
        return repairedDiff;
      } catch (secondError) {
        const secondMessage = String(secondError instanceof Error ? secondError.message : secondError);
        this.output.appendLine(`[safegraph-ai] repaired diff failed preflight, retrying with current files: ${secondMessage}`);
        const secondRepair = await this.repairDiffWithBedrock(
          repairedDiff,
          `${firstMessage}\nSecond repair failed: ${secondMessage}`,
          `${reason}; repair retry against current file contents`
        );
        await preflightUnifiedDiffAgainstWorkspace(secondRepair);
        this.output.appendLine("[safegraph-ai] second repaired diff passed preflight");
        return secondRepair;
      }
    }
  }

  private async applyDiffWithRepair(diff: string, reason: string) {
    const prepared = await this.prepareDiffForApply(diff, reason);
    try {
      await applyUnifiedDiffToWorkspaceSmart(prepared, this.output);
      return;
    } catch (firstApplyError) {
      const firstApplyMessage = String(firstApplyError instanceof Error ? firstApplyError.message : firstApplyError);
      if (!/Hunk out of range|Context mismatch|Delete line mismatch|patch does not apply|git apply/i.test(firstApplyMessage)) {
        throw firstApplyError;
      }
      this.output.appendLine(`[safegraph-ai] apply failed after preflight, repairing against current files: ${firstApplyMessage}`);
      const repaired = await this.repairDiffWithBedrock(
        prepared,
        firstApplyMessage,
        `${reason}; apply failed after preflight`
      );
      await preflightUnifiedDiffAgainstWorkspace(repaired);
      try {
        await applyUnifiedDiffToWorkspaceSmart(repaired, this.output);
        return;
      } catch (secondApplyError) {
        const secondApplyMessage = String(secondApplyError instanceof Error ? secondApplyError.message : secondApplyError);
        this.output.appendLine(`[safegraph-ai] repaired apply failed, retrying once: ${secondApplyMessage}`);
        const secondRepair = await this.repairDiffWithBedrock(
          repaired,
          `${firstApplyMessage}\nRepaired apply failed: ${secondApplyMessage}`,
          `${reason}; second apply repair against current files`
        );
        await preflightUnifiedDiffAgainstWorkspace(secondRepair);
        await applyUnifiedDiffToWorkspaceSmart(secondRepair, this.output);
      }
    }
  }
}
