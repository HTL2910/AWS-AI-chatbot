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
      taggedFiles?: string[];
      attachments?: { name: string; text: string }[];
    }
  | { type: "ready" }
  | { type: "setApiKey" }
  | { type: "moveRight" }
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

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "safegraph.chatView";

  private view?: vscode.WebviewView;
  private currentAbort?: AbortController;
  private autoRunDoneFor = new Set<string>();
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

    webviewView.webview.html = getChatWebviewHtml(webviewView.webview, this.context.extensionUri);

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
      if (msg.type === "applyDiff") {
        try {
          await applyUnifiedDiffToWorkspaceSmart(msg.diff, this.output);
          vscode.window.showInformationMessage("Safegraph AI: Applied changes.");
        } catch (e) {
          this.output.appendLine(`[safegraph-ai] applyDiff failed: ${String(e)}`);
          vscode.window.showErrorMessage(`Safegraph AI: Apply failed: ${String(e)}`);
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
            const envKey = await loadBedrockApiKeyFromDotEnv();
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
            maxChars: 8000,
            maxFiles: 80,
            includeFiles: msg.taggedFiles || []
          });
          const maskedCtx = maskSensitive(ctx);
          const maskedQuestion = maskSensitive(msg.text);
          const tagged = (msg.taggedFiles || []).map((p) => maskSensitive(p));
          const atts = (msg.attachments || [])
            .slice(0, 8)
            .map((a) => ({
              name: maskSensitive(String(a.name || "file")),
              text: maskSensitive(String(a.text || "")).slice(0, 50_000)
            }))
            .filter((a) => a.text.trim().length > 0);

          const prompt =
            "You are Safegraph AI inside VS Code. Answer concisely, propose code edits with clear steps.\n\n" +
            "If you want to run terminal commands, put ONLY the exact commands (one per line) inside a fenced code block labeled sh (```sh ... ```). " +
            "Do not prefix commands with '+', '-', bullets, or commentary.\n\n" +
            "If you propose file edits, include a unified diff inside a fenced code block labeled diff (```diff ... ```), " +
            "with file paths relative to the workspace root. For new files use --- /dev/null and +++ b/<path>. For deletes use +++ /dev/null.\n\n" +
            "Context:\n" +
            maskedCtx +
            (tagged.length ? "\n\nTagged files (@):\n" + tagged.join("\n") : "") +
            (atts.length
              ? "\n\nAttachments (uploaded):\n" +
                atts
                  .map((a) => `--- ${a.name} ---\n${a.text}`)
                  .join("\n\n")
              : "") +
            "\n\nUser question:\n" +
            maskedQuestion;

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

          // Cursor-like behavior: propose terminal commands in UI (no terminal panel pop).
          if (!this.autoRunDoneFor.has(msg.id)) {
            this.autoRunDoneFor.add(msg.id);
            const cfg2 = vscode.workspace.getConfiguration("safegraph");
            const mode = String(cfg2.get("autoRun") || "safe") as any;
            const proposed = this.cmdRunner.proposeFromAssistantText(acc, mode);
            if (proposed.length) {
              webviewView.webview.postMessage({ type: "commandProposed", items: proposed, ts: Date.now() });
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
