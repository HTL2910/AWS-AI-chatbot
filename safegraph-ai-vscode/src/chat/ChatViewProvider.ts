import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import { getChatWebviewHtml } from "./webviewHtml";
import { bedrockConverse, bedrockConverseStream } from "../bedrock/bedrockClient";
import { buildContext } from "../context/contextBuilder";
import { maskSensitive } from "../security/mask";
import { loadBedrockApiKeyFromDotEnv, loadBedrockApiKeyInfos, maskApiKey } from "../config/env";
import { applyUnifiedDiffToWorkspaceSmart, parseUnifiedDiff, preflightUnifiedDiffAgainstWorkspace } from "../apply/unifiedDiff";
import { McpClientManager } from "../mcp/McpClient";
import { CommandRunner, CommandRunResult, CommandUpdateMessage } from "../terminal/commandRunner";
import { AutoRunMode } from "../terminal/commandPolicy";
import { extractDiffBlocks, formatApplyError, shellQuote, stripDiffBlocksForLiveApply } from "./diffText";
import {
  extractPageTitle,
  extractRelatedLinks,
  extractUrls,
  htmlToReadableText,
  inferredDocsSiblingLinks,
  sameDocsSection,
  uniqueLinks
} from "./docsText";

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
  | { type: "discardChangeSet"; id: string }
  | { type: "keepChangeSet"; id: string }
  | { type: "stop" }
  | { type: "suggestFiles"; query: string }
  | { type: "runCommand"; id: string; cmd: string }
  | { type: "cancelCommand"; id: string };

type ExtensionToWebviewMessage =
  | { type: "assistantMessage"; id: string; text: string; ts: number; done?: boolean }
  | { type: "error"; message: string; ts: number }
  | { type: "autoAppliedChangeSet"; id: string; diff: string; summary: string; ts: number }
  | { type: "changeSetUpdate"; id: string; status: "kept" | "discarded" | "error"; message?: string; ts: number }
  | { type: "contextItem"; kind: "file"; path: string; label: string; ts: number }
  | { type: "contextItem"; kind: "attachment"; name: string; text: string; ts: number }
  | { type: "fileSuggestions"; items: { path: string; label: string }[]; ts: number }
  | CommandUpdateMessage;

type FileSnapshot = {
  path: string;
  existed: boolean;
  content?: Uint8Array;
};

type AppliedChangeSet = {
  id: string;
  diff: string;
  snapshots: FileSnapshot[];
  createdAt: number;
};

function buildSafegraphSystemPrompt(targetRoot: string) {
  return `You are Safegraph AI, a pragmatic senior software engineer embedded in VS Code.

Your first job is to understand the user's real intent from their latest message, active file, selected text, tagged files, diagnostics, git state, and recent conversation. The latest user request wins over older chat history.

Expert coding contract:
- Before coding, infer the project stack from manifests, imports, file names, existing components, scripts, and diagnostics. Match the repo's current architecture instead of introducing a new one.
- Keep edits focused. Do not rewrite unrelated files, rename public APIs, or change formatting broadly unless the request requires it.
- Produce complete, runnable code. No pseudocode, missing imports, TODO-only implementations, placeholder handlers, fake data where real project data is available, or half-finished branches.
- Preserve language conventions: semantic HTML, accessible labels, responsive CSS, typed TypeScript, idiomatic Python, correct async/error handling, and framework-native patterns.
- Handle edge cases that matter: empty states, loading/error states, invalid input, null/undefined, failed network/API calls, path ambiguity, and repeated user actions.
- Prefer simple maintainable code over clever abstractions. Add an abstraction only when it reduces real duplication or complexity in the current codebase.
- Security and privacy are non-negotiable: never hardcode secrets, never log credentials, validate untrusted input, avoid unsafe shell commands, and call out risky actions.
- For code style, preserve existing naming, indentation, module boundaries, lint style, and dependency choices. If no formatter is obvious, use conventional formatting for the language.
- For tests/verification, choose the smallest command that proves the change. If tests cannot be run, state the exact reason and provide the safest next verification step.
- After changing code, expect the host to run an automatic verification command. If that command fails, repair the failure before claiming completion.
- For dependency changes, justify why the dependency is needed and prefer existing dependencies already in the repo.

Frontend/UI rules:
- Build the actual usable interface, not a landing-page explanation, unless explicitly asked for marketing content.
- Use existing design system/components first. Keep layouts responsive, accessible, and free of overlapping text.
- Use realistic labels/data and include hover/focus/disabled/loading/error/empty states when relevant.
- For early mockup/prototype requests, favor a fast inspectable prototype over production completeness: create or update a single runnable HTML/CSS/JS/React screen with realistic sample data, visible states, and enough interaction to judge the concept.
- If the user provides only a product idea or description, infer the missing details and build a sample-data mockup. Do not ask for exact copy, real backend data, brand assets, or final requirements unless the request would be unsafe or destructive.
- Avoid generic one-color themes, decorative filler, and visible instructional text that explains the UI instead of making it intuitive.
- When creating or editing mock data, JSON, config, or files fetched by frontend code, validate the exact file with a real parser before declaring done. JSON must have exactly one top-level value, no comments, no trailing text, no trailing commas, and valid UTF-8.
- When frontend code fetches static assets or data, verify the paths match the server/public directory layout. Handle missing data with a visible error state and avoid unhandled promise rejections.
- For browser-facing changes, include a check that would catch console errors and failed network requests when practical: app build, dev server smoke test, Playwright/browser check, or a focused curl/node parser check.
- Treat favicon/static 404s as real polish bugs when the user reports them: add the asset, update the link, or remove the broken reference.
- For generated HTML/CSS UI, edit the actual project files and return a unified diff. Do not paste a whole standalone page into chat unless explicitly asked. Keep CSS inside a real stylesheet, a valid <style> element in <head>, or framework-native style modules; never leave raw CSS declarations as body text.

Backend/API rules:
- Keep request/response contracts explicit, validate inputs, return useful errors, and avoid swallowing exceptions.
- Preserve backward compatibility unless the user explicitly asks for a breaking change.
- Do not fake successful integration. If an external service is required, wire the real call path or clearly state the missing credential/environment requirement.

Chat behavior:
- If the user asks to fix/build/update/code, act directly. Do not stop at advice when a diff or command can solve the task.
- Ask at most one question only when the missing detail is high-risk, security-sensitive, destructive, costly, or changes product direction. Otherwise make a conservative assumption and continue.
- If the user writes Vietnamese, answer in clear Vietnamese.

Skill playbooks:
- Diagnose: for bugs, failures, regressions, errors, or "it does not work". Build a feedback loop first, reproduce the user's exact symptom, form ranked falsifiable hypotheses, instrument narrowly, fix, add or update a regression check when there is a correct seam, rerun the original repro, then clean up temporary probes.
- TDD: for new behavior or bug fixes where tests are available. Work in vertical slices: one behavior test through a public interface, make it fail, implement just enough, make it pass, repeat. Test behavior, not private implementation details. Refactor only after green.
- Grill with docs: for unclear product/design/domain requests. Explore the code and docs first. Use CONTEXT.md and docs/adr when present. Ask one precise question at a time only when code/docs cannot answer it. Resolve vocabulary into canonical domain terms and call out contradictions between user language, docs, and code.
- Architecture review: for refactor/architecture/testability requests. Look for shallow modules, missing seams, poor locality, excessive caller knowledge, hard-to-test flows, and pass-through abstractions. Prefer deep modules: small stable interfaces hiding useful implementation. Use the deletion test before proposing a module change.
- Prototype: for uncertain UI/product/logic design. Build a small runnable throwaway or inspectable implementation that exercises the real workflow and exposes tradeoffs quickly.

Autonomous task protocol:
- You can provide unified diffs in \`\`\`diff blocks and safe terminal commands in \`\`\`sh blocks. The host may apply/run them and return results.
- Always start with a short Plan when changes or commands are needed.
- Always explain Actions briefly before a diff/command.
- After execution results, verify what passed or failed and repair if needed.
- End with [DONE] only when the user's goal is handled and verification is complete or the remaining risk is clearly stated. Never use [DONE] immediately after a code diff unless you also included or received a passing verification result.
- End with [CONTINUE] only when you need execution results before proceeding.

Patch rules:
- Diff paths must be relative to target root: ${targetRoot || "(none)"}.
- For new files use "--- /dev/null" and "+++ b/<path>".
- For deleted files use "--- a/<path>" and "+++ /dev/null".
- Never output a bare diff without a short summary.
- Keep changes tightly scoped to the user's request.`;
}

function inferRequestType(text: string) {
  const normalized = text.toLowerCase();
  if (/(diagnose|debug|reproduce|perf|performance|regression|fix|bug|error|traceback|lỗi|sửa|không chạy|failed|exception|diagnostic)/i.test(normalized)) {
    return "bugfix/debug";
  }
  if (/(unexpected non-whitespace|favicon|404|console error|browser console|load resource)/i.test(normalized)) {
    return "frontend-data/static-asset-debug";
  }
  if (/(tdd|test.?first|red.?green|regression test|integration test|unit test|kiểm thử|test)/i.test(normalized)) {
    return "tdd/test-first";
  }
  if (/(architecture|kiến trúc|refactor|deep module|seam|adapter|coupling|testability|maintainability|codebase|module)/i.test(normalized)) {
    return "architecture/refactor";
  }
  if (/(clarify|grill|spec|prd|domain|glossary|adr|context\.md|requirement|yêu cầu|ngữ cảnh)/i.test(normalized)) {
    return "domain-clarification";
  }
  if (/(prototype|throwaway|spike|mockup|mockups|sample data|demo data|variation|explore design|wireframe|mvp screen|giao diện mẫu|dữ liệu mẫu)/i.test(normalized)) {
    return "prototype";
  }
  if (/(build|package|release|version|cài|install|vsix|deploy|update)/i.test(normalized)) {
    return "build/release/update";
  }
  if (/(ui|html|css|frontend|mockup|website|dashboard|giao diện|design)/i.test(normalized)) {
    return "frontend/ui";
  }
  if (/(review|audit|kiểm tra|refactor|cleanup|format)/i.test(normalized)) {
    return "review/refactor";
  }
  return "general coding task";
}

function workflowForRequestType(requestType: string) {
  switch (requestType) {
    case "frontend-data/static-asset-debug":
      return [
        "Selected workflow: Frontend data/static asset diagnose.",
        "- Reproduce the exact browser console or network error.",
        "- Locate the fetched JSON/mock/config/static path and inspect the response body, not just the source file.",
        "- Validate every edited JSON/mock data file with a real parser such as node JSON.parse, python json.tool, jq, or the project's schema validator.",
        "- Check that the server returns one valid JSON document with the expected Content-Type/status and no appended text/HTML.",
        "- For 404 assets such as favicon.ico, either add the asset at the requested path, update the link, or remove the broken reference.",
        "- Do not declare [DONE] until the JSON parser check and the static asset path check pass or the remaining failure is explicitly identified."
      ].join("\n");
    case "bugfix/debug":
      return [
        "Selected workflow: Diagnose.",
        "- First create or identify a fast feedback loop: test, script, CLI repro, HTTP request, browser check, or focused build command.",
        "- Confirm the failure matches the user's symptom before fixing.",
        "- State 2-4 likely hypotheses only when useful, then test the highest-signal one.",
        "- Prefer a regression test/check at the seam that exercises the real failure path.",
        "- Do not declare done until the original repro or closest available loop passes."
      ].join("\n");
    case "tdd/test-first":
      return [
        "Selected workflow: TDD vertical slices.",
        "- Identify the public interface and user-visible behavior.",
        "- Add one focused failing test or check for one behavior.",
        "- Implement the smallest complete change to pass it.",
        "- Repeat only if another behavior is essential to the user's request.",
        "- Refactor after green, not while failing."
      ].join("\n");
    case "domain-clarification":
      return [
        "Selected workflow: Grill with docs.",
        "- Read existing code/docs/CONTEXT.md/ADRs before asking.",
        "- Ask one precise question only when the repo cannot answer it.",
        "- Resolve vague or conflicting terms into a canonical domain vocabulary.",
        "- If a term becomes stable and CONTEXT.md exists or should exist, propose updating it.",
        "- Offer an ADR only for hard-to-reverse, surprising tradeoffs."
      ].join("\n");
    case "architecture/refactor":
      return [
        "Selected workflow: Architecture review/deepening.",
        "- Find friction in locality, leverage, testability, seams, caller knowledge, and shallow pass-through modules.",
        "- Use the deletion test before suggesting new abstractions.",
        "- Prefer deep modules with small stable interfaces and useful implementation behind them.",
        "- Respect existing ADRs and domain language.",
        "- Propose focused refactors with clear verification, not broad rewrites."
      ].join("\n");
    case "prototype":
    case "frontend/ui":
      return [
        "Selected workflow: Prototype-first mockup implementation.",
        "- Treat the user's description as enough to proceed. Infer the target user, workflow, and sample data conservatively.",
        "- Build an inspectable, runnable mockup now; do not stop at explanation, requirements, or questions.",
        "- If a tagged file exists, update that file. If the workspace has an obvious app entry, use it. If not, create a clearly named mockup file such as mockups/<feature>.html or mockup.html.",
        "- For early mockups, completeness means: realistic sample data, visible primary workflow, responsive layout, meaningful empty/loading/error states, and enough interaction to inspect the idea.",
        "- Prefer one cohesive screen or flow over production architecture. Avoid real backend integration unless it already exists.",
        "- Verification can be lightweight: HTML syntax sanity, JSON parse for sample data, npm build if applicable, or a note that the file opens directly in a browser."
      ].join("\n");
    default:
      return [
        "Selected workflow: General engineering.",
        "- Understand stack and context, make the smallest complete change, verify with the nearest reliable command.",
        "- Escalate to Diagnose, TDD, Grill with docs, Architecture review, or Prototype if the evidence points there."
      ].join("\n");
  }
}

function buildTaskPrompt(args: {
  targetRoot: string;
  requestType: string;
  context: string;
  webResearch: string;
  conversation: string;
  tagged: string[];
  attachments: { name: string; text: string }[];
  question: string;
}) {
  const attachments = args.attachments.length
    ? "\nATTACHMENTS:\n" + args.attachments.map((a) => `[${a.name}]\n${a.text}`).join("\n\n")
    : "";
  const tagged = args.tagged.length ? "\nTAGGED FILES OR FOLDERS:\n" + args.tagged.join("\n") : "";
  const web = args.webResearch ? "\nWEB RESEARCH BUNDLE:\n" + args.webResearch : "";
  const conversation = args.conversation ? "\nRECENT CONVERSATION, OLDEST TO NEWEST:\n" + args.conversation : "";
  const workflow = workflowForRequestType(args.requestType);
  const prototypeTarget =
    args.requestType === "prototype" || args.requestType === "frontend/ui"
      ? "\nPROTOTYPE TARGET\n- If no tagged file or obvious app entry should be edited, create or update `mockups/mockup.html` as a standalone runnable mockup with embedded sample data, CSS, and JavaScript.\n- Keep the filename stable unless the user named a specific file. Do not scatter an early mockup across many files unless the existing app structure requires it.\n"
      : "";

  return `TASK BRIEF
Request type: ${args.requestType}
Target root: ${args.targetRoot || "(none)"}

WORKFLOW PLAYBOOK
${workflow}

LATEST USER REQUEST
${args.question}

HOW TO INTERPRET THIS REQUEST
- Solve the latest request, not a generic adjacent task.
- Use CONTEXT as evidence. Prefer active selection, tagged files, diagnostics, and git changes over broad repository guesses.
- If the user complains that output/code quality is poor, improve the underlying implementation/prompt/formatting rather than merely apologizing.
- If the request is short or informal, infer the intended engineering outcome from context and proceed.
- Apply the expert coding contract from the system instructions. For coding tasks, explicitly think through: stack, touched files, implementation shape, edge cases, and verification.
- Prefer editing existing files over generating detached snippets. If the repo has a runnable app, make the requested behavior work in that app.
- For mockup/prototype requests, prioritize creating a visual result with sample data immediately. A good answer changes files first, then explains briefly. Do not answer with only advice.
- If no active app structure is obvious, create a standalone mockup that can be opened directly in the browser, using embedded sample data and assets/styles in the file or nearby files.
- For HTML/CSS/JS/TS/Python outputs, use correct language formatting and complete syntax. Do not mix explanation into code blocks.
- If code changes are needed, provide one clean unified diff that can apply to the current workspace.
- If verification is available, include safe commands after the diff.
${prototypeTarget}

CONTEXT
${args.context}${web}${conversation}${tagged}${attachments}`;
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
  private appliedChangeSets = new Map<string, AppliedChangeSet>();

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
      if (msg.type === "keepChangeSet") {
        this.appliedChangeSets.delete(msg.id);
        webviewView.webview.postMessage({
          type: "changeSetUpdate",
          id: msg.id,
          status: "kept",
          message: "Changes kept.",
          ts: Date.now()
        } satisfies ExtensionToWebviewMessage);
        return;
      }
      if (msg.type === "discardChangeSet") {
        try {
          await this.discardChangeSet(msg.id, this.currentTargetRoot);
          webviewView.webview.postMessage({
            type: "changeSetUpdate",
            id: msg.id,
            status: "discarded",
            message: "Changes restored to the previous state.",
            ts: Date.now()
          } satisfies ExtensionToWebviewMessage);
        } catch (error) {
          const message = `Safegraph AI: Discard failed: ${String(error instanceof Error ? error.message : error)}`;
          this.output.appendLine(message);
          webviewView.webview.postMessage({
            type: "changeSetUpdate",
            id: msg.id,
            status: "error",
            message,
            ts: Date.now()
          } satisfies ExtensionToWebviewMessage);
          vscode.window.showErrorMessage(message);
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
- Mandatory task protocol:
  1. Plan: before any diff or command, state a short concrete plan with target files/folders and verification approach.
  2. Actions: every response that changes files or proposes commands must state what action is being taken and why.
  3. Verification: after execution results, explain what passed/failed and either repair the issue or give the next verification step.
  4. Final Summary: the final [DONE] response must include files changed, commands run, verification result, and any remaining risk.
- Never output only a diff block or only a shell command. Include the relevant Plan/Actions/Verification/Final Summary text around it.
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
18. If the user asks for a mockup, design, website, dashboard, app screen, or UI improvement, create an implementable mockup in code. Prefer editing/creating real project files such as HTML/CSS/JS/React components. If the repo has no app structure, create a minimal runnable mockup. Do not mix rendered page text and CSS; CSS must live in a stylesheet, a valid <style> block, or the framework's styling mechanism.
19. For frontend design, use existing project conventions first. Build the actual usable screen, not a marketing explanation. Avoid generic one-color themes, oversized decorative cards, and visible text explaining how to use the UI.
20. Make UI complete enough to inspect: realistic labels/data, responsive layout, clear primary actions, hover/focus states, error/empty/loading states where relevant.
21. Before giving final text, make the code complete enough to run. Include verification commands after the diff when useful.
22. Do not return a bare diff. Always explain what changed, which files are affected, and what the user should verify.
23. Use these exact short section labels when appropriate: Plan, Actions, Verification, Final Summary.
24. Do not dump long explanations when a simple action is enough.

CONTEXT:
${maskedCtx}
${maskedWebResearch ? "\nWEB RESEARCH BUNDLE:\n" + maskedWebResearch : ""}
${conversation ? "\nRecent conversation:\n" + conversation : ""}
${tagged.length ? "\nTagged files (@):\n" + tagged.join("\n") : ""}
${atts.length ? "\nAttachments:\n" + atts.map((a) => `[${a.name}] ${a.text}`).join("\n\n") : ""}

User query:
${maskedQuestion}`;

          const systemPrompt = buildSafegraphSystemPrompt(maskSensitive(targetRoot?.fsPath || ""));
          const taskPrompt = buildTaskPrompt({
            targetRoot: maskSensitive(targetRoot?.fsPath || ""),
            requestType: inferRequestType(maskedQuestion),
            context: maskedCtx,
            webResearch: maskedWebResearch,
            conversation,
            tagged,
            attachments: atts,
            question: maskedQuestion
          });

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
            { role: "user", text: taskPrompt }
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
            const streamedAppliedDiffBlocks = new Set<string>();
            const streamedAppliedDiffs: string[] = [];
            let streamLoopFeedback = "";
            let streamExecutionFailed = false;
            let streamedUiText = "";

            let isToolLoop = false;
            for (;;) {
              const responseOptions = {
                region,
                modelId,
                apiKey,
                system: systemPrompt,
                signal: this.currentAbort?.signal,
                maxTokens: 8192,
                temperature: 0.2,
                toolConfig
              };
              const streamBaseAcc = totalAcc + (totalAcc ? "\n\n---\n\n" : "");
              const r = await bedrockConverseStream(nextMessages, responseOptions, {
                onText: async (_delta, fullText) => {
                  if (this.currentAbort?.signal.aborted) throw new Error("aborted");

                  const completeDiffs = extractDiffBlocks(fullText);
                  for (const diffBlock of completeDiffs) {
                    const diffKey = diffBlock.trim();
                    if (!diffKey || streamedAppliedDiffBlocks.has(diffKey)) continue;
                    streamedAppliedDiffBlocks.add(diffKey);
                    try {
                      const changeSetId = `${msg.id}-${step}-stream-${Date.now()}-${streamedAppliedDiffBlocks.size}`;
                      const appliedDiff = await this.applyDiffWithRepair(
                        diffBlock,
                        "Streaming autonomous chat code changes",
                        targetRoot,
                        changeSetId
                      );
                      if (appliedDiff.trim()) {
                        streamedAppliedDiffs.push(appliedDiff);
                        webviewView.webview.postMessage({
                          type: "autoAppliedChangeSet",
                          id: changeSetId,
                          diff: appliedDiff,
                          summary: this.summarizeAppliedDiff(appliedDiff),
                          ts: Date.now()
                        } satisfies ExtensionToWebviewMessage);
                        streamLoopFeedback += "Diff applied live while the model was still responding.\n";
                      }
                    } catch (error) {
                      streamExecutionFailed = true;
                      streamLoopFeedback += `Failed to live-apply streamed diff: ${String(error)}\n`;
                    }
                  }

                  const nextUi = stripDiffBlocksForLiveApply(fullText)
                    .replace(/\[CONTINUE\]/g, "")
                    .replace(/\[DONE\]/g, "")
                    .trim();
                  if (nextUi && nextUi !== streamedUiText) {
                    streamedUiText = nextUi;
                    webviewView.webview.postMessage({
                      type: "assistantMessage",
                      id: msg.id,
                      text: streamBaseAcc + streamedUiText,
                      ts: Date.now(),
                      done: false
                    });
                  }
                }
              }).catch(async (error) => {
                this.output.appendLine(`[safegraph-ai] ConverseStream failed, falling back to Converse: ${String(error)}`);
                return bedrockConverse(nextMessages, responseOptions);
              });
              let rawContent = r.raw?.output?.message?.content || [];
              let stopReason = String(r.stopReason || "");
              combined = (combined + (combined ? "\n" : "") + r.text).trim();
              chunkLoops += 1;
              if (this.currentAbort?.signal.aborted) throw new Error("aborted");
              if (!String(r.text || "").trim() && stopReason !== "tool_use") {
                throw new Error("Bedrock returned an empty assistant response.");
              }
              
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
            
            const diffBlocks = extractDiffBlocks(combined);
            // Clean up the text for the UI by removing protocol tags and auto-applied patch blocks.
            let uiText = (diffBlocks.length > 0 ? stripDiffBlocksForLiveApply(combined) : combined)
              .replace(/\[CONTINUE\]/g, "")
              .replace(/\[DONE\]/g, "")
              .trim();
            const baseAcc = totalAcc + (totalAcc && uiText ? "\n\n---\n\n" : "");
            
            messages.push({ role: "assistant", text: combined });
            if (uiText) {
              totalAcc = baseAcc + uiText;
            }

            if (!streamedUiText) {
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
            }

            let loopFeedback = "";
            let executionFailed = streamExecutionFailed;
            if (streamLoopFeedback) {
              loopFeedback += streamLoopFeedback;
            }

            const remainingDiffBlocks = diffBlocks.filter((block) => !streamedAppliedDiffBlocks.has(block.trim()));
            const appliedDiffsForVerification = [...streamedAppliedDiffs];

            if (remainingDiffBlocks.length > 0) {
              try {
                const changeSetId = `${msg.id}-${step}-${Date.now()}`;
                const appliedDiff = await this.applyDiffWithRepair(
                  remainingDiffBlocks.join("\n\n"),
                  "Autonomous chat code changes",
                  targetRoot,
                  changeSetId
                );
                if (appliedDiff.trim()) {
                  appliedDiffsForVerification.push(appliedDiff);
                  webviewView.webview.postMessage({
                    type: "autoAppliedChangeSet",
                    id: changeSetId,
                    diff: appliedDiff,
                    summary: this.summarizeAppliedDiff(appliedDiff),
                    ts: Date.now()
                  } satisfies ExtensionToWebviewMessage);
                }
                loopFeedback += appliedDiff.trim()
                  ? "Diff applied successfully and is visible in the workspace. User can keep it or discard all to restore the previous file state.\n"
                  : "Diff was already present or empty; no workspace changes were applied.\n";
              } catch (e) {
                loopFeedback += "Failed to apply diff: " + String(e) + "\n";
                executionFailed = true;
              }
            }

            const proposed = this.cmdRunner.proposeFromAssistantText(combined, mode);
            const verificationCommands =
              appliedDiffsForVerification.length > 0
                ? this.inferVerificationCommands(cwd, appliedDiffsForVerification.join("\n\n"), proposed.map((item) => item.cmd))
                : [];
            for (const cmd of verificationCommands) {
              proposed.push({
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                cmd,
                decision: "allow",
                reason: "automatic post-change verification"
              });
            }
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
                if (result.status !== "success" || result.exitCode !== 0) {
                  executionFailed = true;
                }
              }
            }

            if (combined.includes("[DONE]") && !executionFailed) {
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
              messages.push({ role: "user", text: `Execution results:\n\`\`\`\n${loopFeedback.trim()}\n\`\`\`\nRespond using the mandatory task protocol:\n- Verification: state what passed/failed from these results.\n- Actions: if repair or follow-up work is needed, provide the next diff/commands and why.\n- Final Summary: only if complete, include files changed, commands run, verification result, and remaining risk, then end with [DONE].\nOtherwise end with [CONTINUE].` });
            } else {
              messages.push({ role: "user", text: "Please continue using the mandatory task protocol. Include Actions or Verification as appropriate. Use [CONTINUE] or a complete Final Summary followed by [DONE]." });
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
            "User-Agent": "safegraph-ai-vscode/0.12.1",
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

  private inferVerificationCommands(cwd: string, diff: string, existingCommands: string[]) {
    const existing = new Set(existingCommands.map((cmd) => cmd.trim()));
    const commands: string[] = [];
    const add = (cmd: string) => {
      if (!cmd || existing.has(cmd) || commands.includes(cmd)) return;
      commands.push(cmd);
    };

    const changedFiles = this.extractChangedFilesFromDiff(diff);
    const packageJsonPath = path.join(cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        const scripts = pkg?.scripts || {};
        if (scripts.build) {
          add("npm run build");
        } else if (scripts["build:ext"]) {
          add("npm run build:ext");
        } else if (fs.existsSync(path.join(cwd, "tsconfig.json"))) {
          add("npx tsc -p . --noEmit");
        }

        if (scripts.test && changedFiles.some((file) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file))) {
          add("npm test");
        }
      } catch (error) {
        this.output.appendLine(`[safegraph-ai] failed to infer npm verification: ${String(error)}`);
      }
    }

    for (const file of changedFiles.filter((item) => item.endsWith(".json")).slice(0, 8)) {
      if (fs.existsSync(path.join(cwd, file))) {
        const jsPath = file.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const escapedLabel = file.replace(/'/g, "\\'");
        add(`node -e "JSON.parse(require('fs').readFileSync('${jsPath}', 'utf8')); console.log('json ok: ${escapedLabel}')"`);
      }
    }

    const pythonFiles = changedFiles.filter((file) => file.endsWith(".py")).slice(0, 12);
    if (pythonFiles.length > 0) {
      add(`python -m py_compile ${pythonFiles.map(shellQuote).join(" ")}`);
    }

    return commands.slice(0, 4);
  }

  private extractChangedFilesFromDiff(diff: string) {
    try {
      return parseUnifiedDiff(diff)
        .map((patch) => patch.filePath || patch.newPath || patch.oldPath)
        .filter((file): file is string => !!file && file !== "/dev/null");
    } catch {
      const files: string[] = [];
      for (const match of String(diff || "").matchAll(/^\+\+\+\s+(?!\/dev\/null)(?:b\/)?([^\t\r\n]+)/gm)) {
        if (match[1]) files.push(match[1].trim());
      }
      return files;
    }
  }

  private summarizeAppliedDiff(diff: string) {
    const patches = parseUnifiedDiff(diff);
    if (patches.length === 0) return "No file changes.";
    const counts = patches.reduce(
      (acc, patch) => {
        acc[patch.kind] += 1;
        return acc;
      },
      { create: 0, update: 0, delete: 0 }
    );
    const parts = [
      counts.create ? `${counts.create} created` : "",
      counts.update ? `${counts.update} updated` : "",
      counts.delete ? `${counts.delete} deleted` : ""
    ].filter(Boolean);
    return `${patches.length} file${patches.length === 1 ? "" : "s"} applied${parts.length ? ` (${parts.join(", ")})` : ""}.`;
  }

  private async snapshotFilesForDiff(diff: string, targetRoot?: vscode.Uri): Promise<FileSnapshot[]> {
    const root = targetRoot || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error("No workspace root is available for snapshot.");

    const snapshots: FileSnapshot[] = [];
    const seen = new Set<string>();
    for (const patch of parseUnifiedDiff(diff)) {
      const filePath = patch.filePath || patch.newPath || patch.oldPath;
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);
      const uri = vscode.Uri.joinPath(root, filePath);
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        snapshots.push({ path: filePath, existed: true, content });
      } catch {
        snapshots.push({ path: filePath, existed: false });
      }
    }
    return snapshots;
  }

  private async discardChangeSet(id: string, targetRoot?: vscode.Uri) {
    const changeSet = this.appliedChangeSets.get(id);
    if (!changeSet) throw new Error("change set is no longer available");
    const root = targetRoot || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error("No workspace root is available for restore.");

    for (const snapshot of changeSet.snapshots) {
      const uri = vscode.Uri.joinPath(root, snapshot.path);
      if (snapshot.existed) {
        await this.ensureParentDirectory(uri);
        await vscode.workspace.fs.writeFile(uri, snapshot.content || new Uint8Array());
      } else {
        try {
          await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
        } catch {
          // The file may already be gone; restore is still complete for this path.
        }
      }
    }

    this.appliedChangeSets.delete(id);
  }

  private async ensureParentDirectory(uri: vscode.Uri) {
    const parent = vscode.Uri.file(path.dirname(uri.fsPath));
    try {
      await vscode.workspace.fs.createDirectory(parent);
    } catch {
      // createDirectory is recursive in VS Code; ignore races.
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

  private async applyDiffWithRepair(diff: string, reason: string, targetRoot?: vscode.Uri, changeSetId?: string) {
    const prepared = await this.prepareDiffForApply(diff, reason, targetRoot);
    if (!prepared.trim()) return "";
    try {
      const snapshots = changeSetId ? await this.snapshotFilesForDiff(prepared, targetRoot) : [];
      await applyUnifiedDiffToWorkspaceSmart(prepared, this.output, { rootUri: targetRoot });
      if (changeSetId) {
        this.appliedChangeSets.set(changeSetId, {
          id: changeSetId,
          diff: prepared,
          snapshots,
          createdAt: Date.now()
        });
      }
      return prepared;
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
        return "";
      }
      await preflightUnifiedDiffAgainstWorkspace(repaired, { rootUri: targetRoot });
      try {
        const snapshots = changeSetId ? await this.snapshotFilesForDiff(repaired, targetRoot) : [];
        await applyUnifiedDiffToWorkspaceSmart(repaired, this.output, { rootUri: targetRoot });
        if (changeSetId) {
          this.appliedChangeSets.set(changeSetId, {
            id: changeSetId,
            diff: repaired,
            snapshots,
            createdAt: Date.now()
          });
        }
        return repaired;
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
          return "";
        }
        await preflightUnifiedDiffAgainstWorkspace(secondRepair, { rootUri: targetRoot });
        const snapshots = changeSetId ? await this.snapshotFilesForDiff(secondRepair, targetRoot) : [];
        await applyUnifiedDiffToWorkspaceSmart(secondRepair, this.output, { rootUri: targetRoot });
        if (changeSetId) {
          this.appliedChangeSets.set(changeSetId, {
            id: changeSetId,
            diff: secondRepair,
            snapshots,
            createdAt: Date.now()
          });
        }
        return secondRepair;
      }
    }
  }
}
