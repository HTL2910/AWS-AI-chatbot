import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import { getChatWebviewHtml } from "./webviewHtml";
import { bedrockConverse } from "../bedrock/bedrockClient";
import { buildContext } from "../context/contextBuilder";
import { maskSensitive } from "../security/mask";
import { loadBedrockApiKeyFromDotEnv, loadBedrockApiKeyInfos, maskApiKey } from "../config/env";
import { applyUnifiedDiffToWorkspaceSmart, parseUnifiedDiff, preflightUnifiedDiffAgainstWorkspace } from "../apply/unifiedDiff";
import { McpClientManager } from "../mcp/McpClient";
import { CommandRunner, CommandRunResult, CommandUpdateMessage } from "../terminal/commandRunner";
import { AutoRunMode } from "../terminal/commandPolicy";

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

function extractUrls(text: string) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>"'`)\]]+/gi;
  for (const match of String(text || "").matchAll(re)) {
    const cleaned = match[0].replace(/[.,;:!?]+$/g, "");
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls;
}

function sameDocsSection(seed: URL, candidate: URL) {
  if (seed.origin !== candidate.origin) return false;
  const seedParts = seed.pathname.split("/").filter(Boolean);
  const candidateParts = candidate.pathname.split("/").filter(Boolean);
  const docsIndex = seedParts.indexOf("docs");
  if (docsIndex < 0) return candidate.pathname.startsWith(path.posix.dirname(seed.pathname));
  const prefix = seedParts.slice(0, Math.min(seedParts.length, docsIndex + 3)).join("/");
  return candidateParts.join("/").startsWith(prefix);
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToReadableText(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  return decodeHtmlEntities(
    withoutScripts
      .replace(/<\/(h1|h2|h3|h4|p|li|tr|pre|code|section|article|main)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function extractPageTitle(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return htmlToReadableText(title).replace(/\s+/g, " ").trim();
}

function extractRelatedLinks(html: string, seedUrl: string) {
  const seed = new URL(seedUrl);
  const links: { url: string; label: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const url = new URL(match[1], seed);
      url.hash = "";
      if (!/^https?:$/.test(url.protocol)) continue;
      if (!sameDocsSection(seed, url)) continue;
      const normalized = url.toString().replace(/\/$/, "");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push({ url: normalized, label: htmlToReadableText(match[2]).replace(/\s+/g, " ").slice(0, 120) });
    } catch {
      // Ignore malformed anchors.
    }
  }
  return links;
}

function inferredDocsSiblingLinks(seedUrl: string) {
  const seed = new URL(seedUrl);
  const normalizedPath = seed.pathname.replace(/\/$/, "");
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length < 2) return [];

  const currentSlug = parts[parts.length - 1];
  const baseParts = currentSlug === "overview" ? parts.slice(0, -1) : parts;
  const basePath = "/" + baseParts.join("/");
  const candidates = [
    "overview",
    "navigation",
    "modes-and-skills",
    "security-and-governance",
    "best-practices"
  ];

  return candidates.map((slug) => ({
    url: `${seed.origin}${basePath}/${slug}`,
    label: slug.replace(/-/g, " ")
  }));
}

function uniqueLinks(links: { url: string; label: string }[]) {
  const out: { url: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const normalized = link.url.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ ...link, url: normalized });
  }
  return out;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "safegraph.chatView";

  private view?: vscode.WebviewView;
  private currentAbort?: AbortController;
  private autoRunDoneFor = new Set<string>();
  private history: { role: "user" | "assistant"; text: string }[] = [];
  private cmdRunner: CommandRunner;
  private mcpManager: McpClientManager;
  private currentTargetRoot?: vscode.Uri;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.cmdRunner = new CommandRunner(output);
    this.mcpManager = new McpClientManager(output);
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
          await this.applyDiffWithRepair(msg.diff, "Manual Apply All", this.currentTargetRoot);
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
        const cwd = this.currentTargetRoot?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.cmdRunner.runAndWait(msg.id, msg.cmd, cwd, (m) => webviewView.webview.postMessage(m)).then(result => {
           const feedback = `[Command execution finished]\nCommand: ${msg.cmd}\nExit code: ${result.exitCode}\nOutput:\n${result.output.slice(-12000)}\n\nPlease continue analyzing or processing based on this result.`;
           webviewView.webview.postMessage({ type: "commandFinishedAndFeedback", text: feedback });
        });
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
          const targetRoot = await this.inferTargetRoot(msg.taggedFiles || []);
          this.currentTargetRoot = targetRoot;
          this.output.appendLine(`[safegraph-ai] target root: ${targetRoot?.fsPath || "(none)"}`);
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
            includeRepository: true,
            targetRoot
          });
          const webResearch = await this.buildWebResearchBundle(msg.text);
          const maskedCtx = maskSensitive(ctx);
          const maskedWebResearch = maskSensitive(webResearch);
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

AUTONOMOUS TASK LOOP INSTRUCTIONS:
- You are running in an AUTONOMOUS TASK LOOP. 
- You can write code blocks (\`\`\`diff) or terminal commands (\`\`\`sh). The system will automatically apply the diffs and run the commands, then feed the output back to you in the next message.
- If you need to see the output of a command or the result of a file change before continuing, end your response with [CONTINUE].
- If you have fully achieved the user's goal and there is nothing else to do, end your response with [DONE]. When doing so, provide a clear, concise summary of all the actions you took and the files you modified during this autonomous session.
- DO NOT say [DONE] if tests are failing or you haven't verified the fix.
- The target root for this task is: ${maskSensitive(targetRoot?.fsPath || "(none)")}.
- If the user tagged a folder, treat that folder as the working directory and write new files there unless the user explicitly names another path.
- All diff paths must be relative to the target root, not to an older workspace root.
- Before creating or editing files, verify the current directory with \`pwd\` when path ambiguity exists.
- If the user provides one or more URLs and asks to research, use the WEB RESEARCH BUNDLE first. It contains the seed page plus related same-section documentation pages discovered from links/tabs/sidebar navigation.
- If the WEB RESEARCH BUNDLE contains fetched pages, do not answer with only diagnostic shell commands such as curl/grep. Answer directly from the bundle or create/update the requested document.
- If the WEB RESEARCH BUNDLE is missing, incomplete, or clearly too shallow, fetch additional pages with safe read-only commands such as \`curl -L <url>\` or a small Python urllib command before writing the final report.
- For documentation sites with tabs/sidebar links, synthesize across all fetched related pages. Do not summarize only the seed URL when related pages are available.
- Cite the source URLs used in the generated document.

RESPONSE GUIDELINES:
1. Reply in the same language as the user. If the user writes Vietnamese, use clear Vietnamese.
2. Act like a pragmatic staff engineer: diagnose root causes, choose a maintainable fix, consider edge cases, and avoid fragile quick hacks unless the user clearly needs a temporary workaround.
3. Own the problem end-to-end. Do not stop at suggestions when a code change can solve it. Create/update files, propose safe verification commands, and make the project runnable.
4. Ask questions only when the decision is high-risk, security-sensitive, destructive, costly, or materially changes product direction. For ordinary missing details, make a conservative assumption and proceed.
5. Write for a normal developer using VS Code, not for a framework expert. Avoid academic headings like "Issue Analysis" unless the user asks for a report.
6. Start with the fix or next action. Then give a short reason only if it helps the user make the right choice.
7. Prefer concrete steps: what file to open, what command to run, what URL to visit, or what button to click.
8. When explaining an error, use this shape: "Lỗi là...", "Cách sửa...", "Vì sao...". Keep each part short.
9. For code changes, ALWAYS provide a short user-facing summary first, then a complete unified diff in a fenced code block marked 'diff'. Safegraph will validate and apply it automatically.
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
22. Do not return a bare diff. Always explain what changed, which files are affected, and what the user should verify.
23. Do not dump long explanations when a simple action is enough.

CONTEXT:
${maskedCtx}
${maskedWebResearch ? "\nWEB RESEARCH BUNDLE:\n" + maskedWebResearch : ""}
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

          const maxTaskLoops = 15;
          let isDone = false;
          let totalAcc = "";

          const messages: { role: "user" | "assistant"; text?: string; content?: any[] }[] = [
            { role: "user", text: prompt }
          ];

          const cfg2 = vscode.workspace.getConfiguration("safegraph");
          const mode: AutoRunMode = msg.agentMode ? "safe" : "ask";

          const cwd = targetRoot?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

          let toolConfig: any = undefined;
          const toolsList: any[] = [];

          // Connect default CodeGraph MCP
          try {
            const codegraphServerId = "codegraph";
            await this.mcpManager.connectStdio(codegraphServerId, "npx", ["-y", "@colbymchenry/codegraph", "mcp"], process.env as Record<string, string>);
            const cgTools = await this.mcpManager.listTools(codegraphServerId);
            for (const t of cgTools.tools) {
              toolsList.push({
                toolSpec: {
                  name: `mcp__${codegraphServerId}__${t.name}`,
                  description: t.description || `MCP tool ${t.name}`,
                  inputSchema: { json: t.inputSchema }
                }
              });
            }
          } catch (e) {
            this.output.appendLine("Failed to start default codegraph MCP: " + String(e));
          }
          try {
            const mcpJsonPath = path.join(cwd, ".vscode", "mcp.json");
            if (fs.existsSync(mcpJsonPath)) {
              const mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
              if (mcpConfig) {
                for (const [serverId, serverConfig] of Object.entries<any>(mcpConfig.mcpServers || {})) {
                  try {
                    await this.mcpManager.connectStdio(serverId, serverConfig.command, serverConfig.args, serverConfig.env);
                    const tools = await this.mcpManager.listTools(serverId);
                    for (const t of tools.tools) {
                      toolsList.push({
                        toolSpec: {
                          name: `${serverId}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
                          description: t.description || "No description",
                          inputSchema: {
                            json: t.inputSchema
                          }
                        }
                      });
                    }
                  } catch (e) {
                    this.output.appendLine(`[MCP] Error connecting to ${serverId}: ${e}`);
                  }
                }
                if (toolsList.length > 0) {
                  toolConfig = { tools: toolsList };
                }
              }
            }
          } catch(e) {
            this.output.appendLine(`[MCP] Error loading mcp.json: ${e}`);
          }

          for (let step = 0; step < maxTaskLoops; step++) {
            if (this.currentAbort?.signal.aborted) throw new Error("aborted");

            let combined = "";
            let chunkLoops = 0;
            let nextMessages = [...messages];

            let isToolLoop = false;
            for (;;) {
              
              const r = await bedrockConverse(nextMessages, {
                region,
                modelId,
                apiKey,
                signal: this.currentAbort?.signal,
                maxTokens: 8192,
                temperature: 0.2,
                toolConfig
              });
              let rawContent = r.raw?.output?.message?.content || [];
              let stopReason = String(r.stopReason || "");
              combined = (combined + (combined ? "\n" : "") + r.text).trim();
              chunkLoops += 1;
              if (this.currentAbort?.signal.aborted) throw new Error("aborted");
              
              if (stopReason === "tool_use") {
                const toolUses = rawContent.filter((c: any) => c.toolUse);
                if (toolUses.length > 0) {
                  messages.push({ role: "assistant", content: rawContent });
                  webviewView.webview.postMessage({
                    type: "assistantMessage",
                    id: msg.id + "_tool_" + step,
                    text: `Calling ${toolUses.length} tools...`,
                    ts: Date.now(),
                    done: false
                  });

                  let toolResults = [];
                  for (const tu of toolUses) {
                    const call = tu.toolUse;
                    try {
                      // parse serverId__toolName
                      const nameParts = call.name.split("__");
                      const serverId = nameParts[0];
                      const toolName = nameParts.slice(1).join("__");
                      this.output.appendLine(`[MCP] Calling ${serverId} -> ${toolName}`);
                      
                      const result = await this.mcpManager.callTool(serverId, toolName, call.input);
                      
                      // extract text content from result
                      let resultText = "";
                      if (result && Array.isArray(result.content)) {
                        resultText = result.content.map((c:any) => c.text).join("\n");
                      } else {
                        resultText = JSON.stringify(result);
                      }

                      toolResults.push({
                        toolResult: {
                          toolUseId: call.toolUseId,
                          content: [{ text: resultText.slice(0, 8000) }],
                          status: "success"
                        }
                      });
                    } catch(e) {
                      toolResults.push({
                        toolResult: {
                          toolUseId: call.toolUseId,
                          content: [{ text: String(e) }],
                          status: "error"
                        }
                      });
                    }
                  }
                  messages.push({ role: "user", content: toolResults });
                  isToolLoop = true;
                  break; // break the chunk loop, and we will continue the main loop
                }
              }

              if (stopReason !== "max_tokens" || chunkLoops >= 3) break;

              nextMessages = [
                ...messages,
                { role: "assistant", text: combined },
                { role: "user", text: "Continue from where you left off. Do not repeat earlier text." }
              ];
            }

            if (isToolLoop) continue;
            
            // Clean up the text for the UI by removing [CONTINUE] and [DONE]
            let uiText = combined.replace(/\[CONTINUE\]/g, "").replace(/\[DONE\]/g, "").trim();
            const baseAcc = totalAcc + (totalAcc && uiText ? "\n\n---\n\n" : "");
            
            messages.push({ role: "assistant", text: combined });
            if (uiText) {
              totalAcc = baseAcc + uiText;
            }

            let accChunk = "";
            const chunkSize = 80;
            for (let i = 0; i < uiText.length; i += chunkSize) {
              if (this.currentAbort?.signal.aborted) throw new Error("aborted");
              accChunk += uiText.slice(i, i + chunkSize);
              webviewView.webview.postMessage({
                type: "assistantMessage",
                id: msg.id,
                text: baseAcc + accChunk,
                ts: Date.now(),
                done: false
              });
              await new Promise((r) => setTimeout(r, 10));
            }

            const diffBlocks = extractDiffBlocks(combined);
            let loopFeedback = "";

            if (diffBlocks.length > 0) {
              try {
                await this.applyDiffWithRepair(diffBlocks.join("\n\n"), "Autonomous chat code changes", targetRoot);
                loopFeedback += "Diff applied successfully.\n";
              } catch (e) {
                loopFeedback += "Failed to apply diff: " + String(e) + "\n";
              }
            }

            const proposed = this.cmdRunner.proposeFromAssistantText(combined, mode);
            const runnable = proposed.filter((item) => item.decision === "allow");
            const askOrDenied = proposed.filter((item) => item.decision !== "allow");

            if (askOrDenied.length > 0) {
              webviewView.webview.postMessage({ type: "commandProposed", items: askOrDenied, ts: Date.now() });
            }

            if (runnable.length > 0) {
              webviewView.webview.postMessage({ type: "commandProposed", items: runnable, ts: Date.now() });
              for (const item of runnable) {
                if (this.currentAbort?.signal.aborted) break;
                const result = await this.cmdRunner.runAndWait(item.id, item.cmd, cwd, (m) => webviewView.webview.postMessage(m));
                loopFeedback += `Command: ${item.cmd}\nExit code: ${result.exitCode}\nOutput:\n${result.output.slice(-12000)}\n\n`;
              }
            }

            if (combined.includes("[DONE]")) {
              isDone = true;
              break;
            }

            // If there are no auto-runnable actions (no commands to run, no diffs to apply),
            // we MUST break the loop. Otherwise, we would just be polling the AI with
            // "Please continue" without giving it any new information, causing an infinite loop.
            if (runnable.length === 0 && diffBlocks.length === 0) {
              break;
            }

            if (loopFeedback) {
              messages.push({ role: "user", text: `Execution results:\n\`\`\`\n${loopFeedback.trim()}\n\`\`\`\nWhat is the next step? Use [CONTINUE] or [DONE].` });
            } else {
              messages.push({ role: "user", text: "Please continue your task. Use [CONTINUE] or [DONE]." });
            }
          }

          webviewView.webview.postMessage({
            type: "assistantMessage",
            id: msg.id,
            text: totalAcc,
            ts: Date.now(),
            done: true
          });

          this.history.push({ role: "user", text: msg.text });
          this.history.push({ role: "assistant", text: totalAcc });
          if (this.history.length > 16) {
            this.history = this.history.slice(-16);
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

  private async inferTargetRoot(taggedFiles: string[]) {
    for (const tagged of taggedFiles.filter((p) => p && p !== "@Repository")) {
      const uri = await this.resolveTaggedUri(tagged);
      if (!uri) continue;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) return uri;
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) return folder.uri;
      } catch {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) return folder.uri;
      }
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
      const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
      if (activeFolder) return activeFolder.uri;
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private async resolveTaggedUri(taggedPath: string) {
    if (taggedPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(taggedPath)) {
      return vscode.Uri.file(taggedPath);
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const direct = vscode.Uri.joinPath(folder.uri, taggedPath);
      try {
        await vscode.workspace.fs.stat(direct);
        return direct;
      } catch {
        // Try the next workspace folder.
      }
    }

    return folders[0] ? vscode.Uri.joinPath(folders[0].uri, taggedPath) : vscode.Uri.file(taggedPath);
  }

  private async buildWebResearchBundle(userText: string) {
    const urls = extractUrls(userText).slice(0, 4);
    if (urls.length === 0) return "";

    const parts: string[] = [];
    const visited = new Set<string>();
    const maxPagesPerSeed = 12;
    const maxCharsPerPage = 9000;
    const maxTotalChars = 60_000;

    for (const seed of urls) {
      try {
        const seedHtml = await this.fetchUrlText(seed);
        const seedTitle = extractPageTitle(seedHtml) || seed;
        const related = uniqueLinks([
          ...inferredDocsSiblingLinks(seed),
          ...extractRelatedLinks(seedHtml, seed)
        ])
          .filter((link) => sameDocsSection(new URL(seed), new URL(link.url)))
          .filter((link) => link.url !== seed.replace(/\/$/, ""))
          .slice(0, maxPagesPerSeed - 1);
        const queue = [{ url: seed, label: seedTitle }, ...related];

        parts.push(`Seed URL: ${seed}`);
        parts.push(`Discovered related same-section pages (${related.length}):`);
        parts.push(related.map((link) => `- ${link.label || link.url}: ${link.url}`).join("\n") || "- (none)");

        for (const item of queue) {
          if (visited.has(item.url)) continue;
          visited.add(item.url);
          try {
            const html = item.url === seed ? seedHtml : await this.fetchUrlText(item.url);
            const title = extractPageTitle(html) || item.label || item.url;
            const text = htmlToReadableText(html);
            if (!text) continue;
            const body =
              text.length > maxCharsPerPage
                ? `${text.slice(0, Math.floor(maxCharsPerPage * 0.65))}\n\n[...page truncated...]\n\n${text.slice(-Math.floor(maxCharsPerPage * 0.35))}`
                : text;
            parts.push(`\n--- Web page: ${title} ---\nURL: ${item.url}\n${body}`);
            if (parts.join("\n\n").length >= maxTotalChars) {
              parts.push("\n[...web research bundle truncated by Safegraph AI...]");
              return parts.join("\n\n").slice(0, maxTotalChars);
            }
          } catch (pageError) {
            parts.push(`\n--- Web page fetch failed ---\nURL: ${item.url}\nError: ${String(pageError)}`);
          }
        }
      } catch (seedError) {
        parts.push(`Seed URL fetch failed: ${seed}\nError: ${String(seedError)}`);
      }
    }

    const bundle = parts.join("\n\n");
    if (bundle) this.output.appendLine(`[safegraph-ai] web research bundle: ${visited.size} page(s), ${bundle.length} chars`);
    return bundle.slice(0, maxTotalChars);
  }

  private fetchUrlText(rawUrl: string, redirectCount = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        reject(new Error(`Invalid URL: ${rawUrl}`));
        return;
      }

      const client = url.protocol === "http:" ? http : https;
      const req = client.request(
        url,
        {
          method: "GET",
          headers: {
            "User-Agent": "safegraph-ai-vscode/0.8.0",
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
          },
          timeout: 20_000
        },
        (res) => {
          const statusCode = res.statusCode || 0;
          const location = res.headers.location;
          if (statusCode >= 300 && statusCode < 400 && location && redirectCount < 5) {
            res.resume();
            resolve(this.fetchUrlText(new URL(location, url).toString(), redirectCount + 1));
            return;
          }
          if (statusCode < 200 || statusCode >= 300) {
            res.resume();
            reject(new Error(`HTTP ${statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total <= 2_000_000) chunks.push(buf);
          });
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error("request timeout"));
      });
      req.on("error", reject);
      req.end();
    });
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


  private async repairDiffWithBedrock(diff: string, errorMessage: string, reason: string, targetRoot?: vscode.Uri) {
    const apiKey = await this.loadApiKey();
    if (!apiKey) throw new Error(`Cannot repair diff automatically: missing Bedrock API key. Original error: ${errorMessage}`);

    const { region, modelId } = this.modelConfig();
    const ctx = await buildContext({
      maxChars: 24000,
      maxFiles: 80,
      targetRoot
    });
    const currentFiles = await this.currentFilesForDiff(diff, targetRoot);

    const prompt = `You are repairing a unified diff before it is applied in VS Code.
Return ONLY one clean fenced code block marked diff. No explanation outside the diff block.

Rules:
- Use valid unified diff syntax only.
- Diff file paths must be relative to the target root: ${maskSensitive(targetRoot?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "(none)")}.
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
    return (match ? match[1] : repaired.text).trim();
  }

  private async currentFilesForDiff(diff: string, targetRoot?: vscode.Uri) {
    try {
      const root = targetRoot || vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) return "";
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

  private async prepareDiffForApply(diff: string, reason: string, targetRoot?: vscode.Uri) {
    try {
      await preflightUnifiedDiffAgainstWorkspace(diff, { rootUri: targetRoot });
      return diff;
    } catch (firstError) {
      const firstMessage = String(firstError instanceof Error ? firstError.message : firstError);
      this.output.appendLine(`[safegraph-ai] preflight failed before apply: ${firstMessage}`);

      const repairedDiff = await this.repairDiffWithBedrock(diff, firstMessage, reason, targetRoot);
      if (!repairedDiff.trim()) {
        this.output.appendLine("[safegraph-ai] diff repair returned empty diff; treating as no-op");
        return "";
      }
      try {
        await preflightUnifiedDiffAgainstWorkspace(repairedDiff, { rootUri: targetRoot });
        this.output.appendLine("[safegraph-ai] repaired diff passed preflight");
        return repairedDiff;
      } catch (secondError) {
        const secondMessage = String(secondError instanceof Error ? secondError.message : secondError);
        this.output.appendLine(`[safegraph-ai] repaired diff failed preflight, retrying with current files: ${secondMessage}`);
        const secondRepair = await this.repairDiffWithBedrock(
          repairedDiff,
          `${firstMessage}\nSecond repair failed: ${secondMessage}`,
          `${reason}; repair retry against current file contents`,
          targetRoot
        );
        if (!secondRepair.trim()) {
          this.output.appendLine("[safegraph-ai] second diff repair returned empty diff; treating as no-op");
          return "";
        }
        await preflightUnifiedDiffAgainstWorkspace(secondRepair, { rootUri: targetRoot });
        this.output.appendLine("[safegraph-ai] second repaired diff passed preflight");
        return secondRepair;
      }
    }
  }

  private async applyDiffWithRepair(diff: string, reason: string, targetRoot?: vscode.Uri) {
    const prepared = await this.prepareDiffForApply(diff, reason, targetRoot);
    if (!prepared.trim()) return;
    try {
      await applyUnifiedDiffToWorkspaceSmart(prepared, this.output, { rootUri: targetRoot });
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
        `${reason}; apply failed after preflight`,
        targetRoot
      );
      if (!repaired.trim()) {
        this.output.appendLine("[safegraph-ai] apply repair returned empty diff; treating as no-op");
        return;
      }
      await preflightUnifiedDiffAgainstWorkspace(repaired, { rootUri: targetRoot });
      try {
        await applyUnifiedDiffToWorkspaceSmart(repaired, this.output, { rootUri: targetRoot });
        return;
      } catch (secondApplyError) {
        const secondApplyMessage = String(secondApplyError instanceof Error ? secondApplyError.message : secondApplyError);
        this.output.appendLine(`[safegraph-ai] repaired apply failed, retrying once: ${secondApplyMessage}`);
        const secondRepair = await this.repairDiffWithBedrock(
          repaired,
          `${firstApplyMessage}\nRepaired apply failed: ${secondApplyMessage}`,
          `${reason}; second apply repair against current files`,
          targetRoot
        );
        if (!secondRepair.trim()) {
          this.output.appendLine("[safegraph-ai] second apply repair returned empty diff; treating as no-op");
          return;
        }
        await preflightUnifiedDiffAgainstWorkspace(secondRepair, { rootUri: targetRoot });
        await applyUnifiedDiffToWorkspaceSmart(secondRepair, this.output, { rootUri: targetRoot });
      }
    }
  }
}
