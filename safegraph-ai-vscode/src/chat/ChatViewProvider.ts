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
import { getChatConfig } from "../config/bedrock";
import { applyUnifiedDiffToWorkspaceSmart, parseUnifiedDiff, preflightUnifiedDiffAgainstWorkspace } from "../apply/unifiedDiff";
import { McpClientManager } from "../mcp/McpClient";
import { CommandRunner, CommandRunResult, CommandUpdateMessage } from "../terminal/commandRunner";
import { AutoRunMode, decideCommand } from "../terminal/commandPolicy";
import { extractDiffBlocks, formatApplyError, shellQuote, stripDiffBlocksForLiveApply } from "./diffText";
import { HistoryManager } from "../history/HistoryManager";
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
  | { type: "openHistory" }
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
  | { type: "toolStatus"; id: string; tools: { name: string; status: "queued" | "running" | "success" | "error"; detail?: string }[]; ts: number; done?: boolean }
  | { type: "autoAppliedChangeSet"; id: string; diff: string; summary: string; ts: number }
  | { type: "changeSetUpdate"; id: string; status: "kept" | "discarded" | "error"; message?: string; ts: number }
  | { type: "contextItem"; kind: "file"; path: string; label: string; ts: number }
  | { type: "contextItem"; kind: "attachment"; name: string; text: string; ts: number }
  | { type: "fileSuggestions"; items: { path: string; label: string }[]; ts: number }
  | { type: "commandFinishedAndFeedback"; text: string; ts: number }
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

type TaskStepStatus = "pending" | "in_progress" | "completed" | "failed";

type AgentTaskStep = {
  id: string;
  title: string;
  status: TaskStepStatus;
  evidence?: string;
};

type AgentTaskState = {
  id: string;
  goal: string;
  requestType: string;
  targetRoot: string;
  status: "active" | "completed" | "failed";
  startedAt: number;
  updatedAt: number;
  steps: AgentTaskStep[];
  filesChanged: string[];
  commandsExecuted: { cmd: string; exitCode?: number; status: "success" | "error" | "canceled" }[];
  verification: { command: string; passed: boolean; outputTail: string; ts: number }[];
  toolObservations: { tool: string; input: string; summary: string; evidence: string; ts: number }[];
  errors: string[];
  contextCache?: {
    key: string;
    context: string;
    webResearch: string;
    createdAt: number;
    fileVersion: number;
  };
  agentNotes: { role: "context-scout" | "reviewer" | "test-fixer"; note: string; ts: number }[];
};

function buildSafegraphSystemPrompt(targetRoot: string, customAppendix?: string) {
  const base = `You are Safegraph AI, a pragmatic senior software engineer embedded in VS Code.

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
  if (customAppendix) {
    return base + `\n\nUSER-APPENDED SYSTEM INSTRUCTIONS\n${customAppendix}`;
  }
  return base;
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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function shouldUseFullRepositoryContext(text: string, taggedFiles: string[]) {
  if (taggedFiles.includes("@Repository")) return true;
  return /(architecture|kiến trúc|refactor|review|audit|codebase|repository|repo|toàn bộ|whole project|cross.?file|dependency|call graph|symbol|context|ngữ cảnh)/i.test(
    text
  );
}

function shouldUseRepositoryContext(text: string, taggedFiles: string[]) {
  if (shouldUseFullRepositoryContext(text, taggedFiles)) return true;
  return /(fix|bug|error|traceback|failed|exception|diagnostic|build|test|implement|update|change|add|remove|sửa|lỗi|thêm|xoá|xóa|chạy|kiểm tra|token|memory|prompt)/i.test(
    text
  );
}

function buildTaskPrompt(args: {
  targetRoot: string;
  requestType: string;
  context: string;
  taskState: string;
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
${args.taskState ? `\nCURRENT TASK STATE\n${args.taskState}\n` : ""}

LOCAL TOOLING CONTRACT
- Prefer Safegraph local tools for incremental inspection: safegraph__read_file, safegraph__search_files, safegraph__list_files.
- Use safegraph__run_safe_command only for safe read-only inspection commands such as pwd, ls, rg, git status, or npm pkg get scripts.
- Use safegraph__run_verification only for build/test/typecheck/lint verification commands after a change or when diagnosing a failure.
- Use safegraph__apply_unified_diff when the task requires editing files. Provide one focused unified diff with paths relative to the target root.
- Use tools to read/search targeted files instead of asking for pasted content or relying on stale broad context.
- Stop inspecting once you have enough evidence to answer. Do not call list/read/search repeatedly just to improve confidence.
- After three to four tool batches, synthesize a useful answer from the evidence already collected and clearly state any remaining uncertainty.
- Prefer smaller edits backed by tool evidence over long speculative diffs.

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
  private conversationSummary = "";
  private activeTaskState?: AgentTaskState;
  private cmdRunner: CommandRunner;
  private mcpManager: McpClientManager;
  private currentTargetRoot?: vscode.Uri;
  private appliedChangeSets = new Map<string, AppliedChangeSet>();
  private statusItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly historyManager?: HistoryManager
  ) {
    this.cmdRunner = new CommandRunner(output);
    this.mcpManager = new McpClientManager(output);
    this.conversationSummary = String(this.context.globalState.get("safegraph.conversationSummary") || "");
    this.activeTaskState = this.loadPersistedTaskState();
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.statusItem.command = "safegraph.openChat";
    this.statusItem.tooltip = "Safegraph AI task status";
    this.statusItem.text = "$(sparkle) Safegraph: Ready";
    this.statusItem.show();
    this.context.subscriptions.push(this.statusItem);
    if (this.activeTaskState) this.updateTaskStatusBar(this.activeTaskState);
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
      if (msg.type === "openHistory") {
        await vscode.commands.executeCommand("safegraph.showHistory");
        return;
      }
      if (msg.type === "moveRight") {
        await vscode.commands.executeCommand("safegraph.moveChatRight");
        return;
      }
      if (msg.type === "clearChat") {
        this.history = [];
        this.conversationSummary = "";
        this.activeTaskState = undefined;
        await this.context.globalState.update("safegraph.conversationSummary", "");
        await this.context.globalState.update("safegraph.activeTaskState", undefined);
        this.statusItem.text = "$(sparkle) Safegraph: Ready";
        this.statusItem.tooltip = "Safegraph AI task status";
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
        this.cmdRunner.runAndWait(msg.id, msg.cmd, cwd, (m) => webviewView.webview.postMessage(m)).then(async result => {
           await this.recordTaskCommandResult(result);
           const feedback = [
             "[Command execution finished]",
             "This is the result of a command that was proposed earlier and approved manually.",
             "Continue the original task using this execution result. If the command failed, diagnose the root cause and provide the next repair diff or safe verification command.",
             "",
             `Command: ${msg.cmd}`,
             `Exit code: ${result.exitCode ?? "(unknown)"}`,
             "Output:",
             result.output.slice(-12000) || "(no output)"
           ].join("\n");
           webviewView.webview.postMessage({
             type: "commandFinishedAndFeedback",
             text: feedback,
             ts: Date.now()
           } satisfies ExtensionToWebviewMessage);
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
          const taggedFilesForRequest = msg.taggedFiles || [];
          const maskedQuestion = maskSensitive(msg.text);
          const requestType = inferRequestType(maskedQuestion);
          const taskState = this.getOrCreateTaskState(maskedQuestion, requestType, targetRoot?.fsPath || "");
          const includeRepositoryContext = shouldUseRepositoryContext(msg.text, taggedFilesForRequest);
          const fullRepositoryContext = shouldUseFullRepositoryContext(msg.text, taggedFilesForRequest);
          const contextMaxChars = fullRepositoryContext ? 22000 : includeRepositoryContext ? 16000 : 10000;

          const contextBundle = await this.getContextBundleForTask({
            task: taskState,
            userText: msg.text,
            targetRoot,
            taggedFiles: taggedFilesForRequest,
            includeRepositoryContext,
            fullRepositoryContext,
            contextMaxChars
          });
          const maskedCtx = maskSensitive(contextBundle.context);
          const maskedWebResearch = maskSensitive(contextBundle.webResearch);
          await this.runLightweightSubagents(taskState, requestType, contextBundle.context);
          const conversation = this.buildConversationMemory(maskedQuestion);
          const taskStatePrompt = this.formatTaskStateForPrompt(taskState);
          const tagged = (msg.taggedFiles || []).map((p) => maskSensitive(p));
          const atts = (msg.attachments || [])
            .slice(0, 6)
            .map((a) => ({
              name: maskSensitive(String(a.name || "file")),
              text: maskSensitive(this.compactAttachmentForPrompt(String(a.text || "")))
            }))
            .filter((a) => a.text.trim().length > 0);

          const chatCfg = getChatConfig();
          const systemPrompt = buildSafegraphSystemPrompt(maskSensitive(targetRoot?.fsPath || ""), chatCfg.customSystemPrompt || undefined);
          const taskPrompt = buildTaskPrompt({
            targetRoot: maskSensitive(targetRoot?.fsPath || ""),
            requestType,
            context: maskedCtx,
            taskState: taskStatePrompt,
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

          const maxTaskLoops = 8;
          const maxToolInspectionLoops = 2;
          const maxToolCalls = 6;
          let isDone = false;
          let totalAcc = "";

          const messages: { role: "user" | "assistant"; text?: string; content?: any[] }[] = [
            { role: "user", text: taskPrompt }
          ];
          const toolCallCounts = new Map<string, number>();
          let toolInspectionLoops = 0;
          let toolInspectionCallTotal = 0;
          const toolObservationSummaries: string[] = [];
          const toolObservationDetails: string[] = [];
          let forcedSynthesis = false;

          const cfg2 = vscode.workspace.getConfiguration("safegraph");
          const mode: AutoRunMode = msg.agentMode ? "safe" : "ask";

          const cwd = targetRoot?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

          let toolConfig: any = undefined;
          const toolsList: any[] = [];
          toolsList.push(...this.localToolSpecs());

          // Optional external CodeGraph MCP. Local Safegraph tools stay available without it.
          if (cfg2.get<boolean>("mcp.codegraph.enabled", false)) {
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
              this.output.appendLine("Failed to start optional codegraph MCP: " + String(e));
            }
          } else {
            this.output.appendLine("[MCP] Optional codegraph MCP disabled by safegraph.mcp.codegraph.enabled=false");
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
              }
            }
          } catch(e) {
            this.output.appendLine(`[MCP] Error loading mcp.json: ${e}`);
          }
          if (toolsList.length > 0) {
            toolConfig = { tools: toolsList };
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
            const chatCfg = getChatConfig();
            for (;;) {
              const responseOptions = {
                region,
                modelId,
                apiKey,
                system: systemPrompt,
                signal: this.currentAbort?.signal,
                maxTokens: chatCfg.maxTokens,
                temperature: chatCfg.temperature,
                toolConfig
              };
              const streamBaseAcc = totalAcc + (totalAcc ? "\n\n---\n\n" : "");
              const r = toolConfig
                ? await bedrockConverse(nextMessages, responseOptions)
                : await bedrockConverseStream(nextMessages, responseOptions, {
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
                            await this.recordTaskDiffApplied(appliedDiff);
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
                          await this.recordTaskError(`Failed to live-apply diff: ${String(error)}`);
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
                  const toolStatusId = `${msg.id}_tools_${step}`;
                  const toolStatuses = toolUses.map((tu: any) => ({
                    name: String(tu.toolUse?.name || "tool"),
                    status: "queued" as const
                  }));
                  const postToolStatus = (done = false) => {
                    webviewView.webview.postMessage({
                      type: "toolStatus",
                      id: toolStatusId,
                      tools: toolStatuses,
                      ts: Date.now(),
                      done
                    } satisfies ExtensionToWebviewMessage);
                  };
                  postToolStatus(false);

                  let toolResults = [];
                  let batchInspectionCalls = 0;
                  for (let toolIndex = 0; toolIndex < toolUses.length; toolIndex++) {
                    const tu = toolUses[toolIndex];
                    const call = tu.toolUse;
                    try {
                      const signature = this.toolCallSignature(call?.name, call?.input);
                      const seen = (toolCallCounts.get(signature) || 0) + 1;
                      toolCallCounts.set(signature, seen);
                      if (seen > 2) {
                        throw new Error(`Repeated identical tool call blocked after ${seen - 1} runs: ${call?.name}. Use the previous tool result or ask for a different file/query.`);
                      }
                      // parse serverId__toolName
                      const nameParts = call.name.split("__");
                      const serverId = nameParts[0];
                      const toolName = nameParts.slice(1).join("__");
                      this.output.appendLine(`[MCP] Calling ${serverId} -> ${toolName}`);
                      toolStatuses[toolIndex] = { name: call.name, status: "running", detail: "running" };
                      postToolStatus(false);
                      
                      const result =
                        serverId === "safegraph"
                          ? await this.callLocalTool(toolName, call.input, cwd, targetRoot, webviewView.webview)
                          : await this.mcpManager.callTool(serverId, toolName, call.input);
                      
                      // extract text content from result
                      let resultText = "";
                      if (typeof result === "string") {
                        resultText = result;
                      } else if (result && Array.isArray(result.content)) {
                        resultText = result.content.map((c:any) => c.text).join("\n");
                      } else {
                        resultText = JSON.stringify(result);
                      }
                      if (this.isInspectionToolName(call.name)) {
                        toolInspectionCallTotal += 1;
                        batchInspectionCalls += 1;
                      }
                      const resultSummary = this.summarizeToolResult(resultText);
                      toolStatuses[toolIndex] = { name: call.name, status: "success", detail: resultSummary };
                      postToolStatus(false);
                      toolObservationSummaries.push(
                        `${call.name}: ${resultSummary}`.slice(0, 220)
                      );
                      toolObservationDetails.push(
                        [
                          `Tool: ${call.name}`,
                          `Input: ${this.stableStringify(call.input).slice(0, 500)}`,
                          `Result:`,
                          this.compactToolEvidence(resultText)
                        ].join("\n")
                      );
                      await this.recordTaskToolObservation(call.name, call.input, resultSummary, resultText);

                      toolResults.push({
                        toolResult: {
                          toolUseId: call.toolUseId,
                          content: [{ text: resultText.slice(0, 8000) }],
                          status: "success"
                        }
                      });
                    } catch(e) {
                      toolStatuses[toolIndex] = { name: String(call?.name || "tool"), status: "error", detail: String(e).slice(0, 240) };
                      postToolStatus(false);
                      toolResults.push({
                        toolResult: {
                          toolUseId: call.toolUseId,
                          content: [{ text: String(e) }],
                          status: "error"
                        }
                      });
                    }
                  }
                  postToolStatus(true);
                  messages.push({ role: "user", content: toolResults });
                  if (batchInspectionCalls > 0) {
                    toolInspectionLoops += 1;
                  }
                  if (toolInspectionLoops >= maxToolInspectionLoops || toolInspectionCallTotal >= maxToolCalls) {
                    forcedSynthesis = true;
                    toolConfig = undefined;
                    messages.length = 0;
                    messages.push({
                      role: "user",
                      text: [
                        "You are now in final synthesis mode. Tool use is disabled.",
                        "Produce a useful answer to the user's request immediately. Do not ask to inspect more files.",
                        "If the evidence is enough, give the conclusion and concrete next steps. If it is incomplete, state the uncertainty briefly and still provide the best answer.",
                        "",
                        "LATEST USER REQUEST:",
                        maskedQuestion,
                        "",
                        "COLLECTED TOOL EVIDENCE:",
                        toolObservationDetails.slice(-12).join("\n\n---\n\n") || "(no usable evidence captured)",
                        "",
                        "Answer in Vietnamese. End with [DONE]."
                      ].join("\n")
                    });
                    webviewView.webview.postMessage({
                      type: "assistantMessage",
                      id: msg.id,
                      text: "Đã đọc đủ context. Đang tổng hợp câu trả lời, không gọi thêm tool...",
                      ts: Date.now(),
                      done: false
                    } satisfies ExtensionToWebviewMessage);
                  }
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
                  await this.recordTaskDiffApplied(appliedDiff);
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
                await this.recordTaskError(`Failed to apply diff: ${String(e)}`);
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
                await this.recordTaskCommandResult(result);
                if (result.status !== "success" || result.exitCode !== 0) {
                  executionFailed = true;
                }
              }
            }

            if (combined.includes("[DONE]") && !executionFailed) {
              await this.markTaskCompleted(totalAcc || combined);
              const evidenceReport = this.formatEvidenceReport();
              if (evidenceReport && !totalAcc.includes("Evidence Report")) {
                totalAcc = `${totalAcc.trim()}\n\n${evidenceReport}`.trim();
              }
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

          if (!isDone && !String(totalAcc || "").trim()) {
            totalAcc = forcedSynthesis && toolObservationDetails.length
              ? this.formatToolOnlyFallback(maskedQuestion, toolObservationSummaries)
              : "Stopped after reaching the tool loop limit. The agent repeated inspection/tool calls without producing a final answer.";
          } else if (!isDone && toolCallCounts.size > 0 && !forcedSynthesis) {
            totalAcc = `${String(totalAcc || "").trim()}\n\nStopped before completion because the agent reached the tool loop limit. Review the tool status panel above for the last completed tool calls.`.trim();
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
          this.conversationSummary = this.updateConversationSummary(this.conversationSummary, msg.text, totalAcc);
          await this.context.globalState.update("safegraph.conversationSummary", this.conversationSummary);
          if (this.history.length > 10) this.history = this.history.slice(-10);
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

  private buildConversationMemory(latestQuestion: string) {
    const parts: string[] = [];
    const summary = this.conversationSummary.trim();
    if (summary) {
      parts.push(`LONG-LIVED THREAD MEMORY\n${maskSensitive(summary).slice(0, 5000)}`);
    }

    const recent = this.selectRecentHistoryForPrompt(latestQuestion);
    if (recent.length > 0) {
      parts.push(
        "RECENT RELEVANT TURNS, OLDEST TO NEWEST\n" +
          recent
            .map((h) => `${h.role === "user" ? "User" : "Safegraph AI"}: ${maskSensitive(this.compactHistoryText(h.text, h.role)).slice(0, 900)}`)
            .join("\n\n")
      );
    }

    return parts.join("\n\n");
  }

  private localToolSpecs() {
    return [
      {
        toolSpec: {
          name: "safegraph__read_file",
          description: "Read a workspace file by relative path. Use this instead of asking the user to paste file contents.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                path: { type: "string", description: "Workspace-relative file path" },
                maxChars: { type: "number", description: "Maximum characters to return, default 12000" }
              },
              required: ["path"]
            }
          }
        }
      },
      {
        toolSpec: {
          name: "safegraph__search_files",
          description: "Search workspace text files for a literal or regex pattern and return compact matches.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search pattern" },
                glob: { type: "string", description: "Optional workspace glob, default source files" },
                regex: { type: "boolean", description: "Treat query as regex" },
                maxResults: { type: "number", description: "Maximum match lines, default 40" }
              },
              required: ["query"]
            }
          }
        }
      },
      {
        toolSpec: {
          name: "safegraph__list_files",
          description: "List workspace files matching a glob, with compact relative paths.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                glob: { type: "string", description: "Workspace glob, default source files" },
                maxResults: { type: "number", description: "Maximum paths, default 120" }
              }
            }
          }
        }
      },
      {
        toolSpec: {
          name: "safegraph__run_safe_command",
          description: "Run a safe read-only inspection command and return compact output. Use for pwd, ls, rg, git status, npm pkg get scripts, and similar non-mutating diagnostics. Unsafe commands are refused.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                command: { type: "string", description: "Safe read-only command such as pwd, ls, rg pattern, git status --short, or npm pkg get scripts" }
              },
              required: ["command"]
            }
          }
        }
      },
      {
        toolSpec: {
          name: "safegraph__run_verification",
          description: "Run a safe build/test/typecheck/lint command and return compact output. Unsafe commands are refused.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                command: { type: "string", description: "Verification command such as npm run build, npm test, pytest, or tsc" }
              },
              required: ["command"]
            }
          }
        }
      },
      {
        toolSpec: {
          name: "safegraph__apply_unified_diff",
          description: "Apply a focused unified diff to workspace files. Use this to edit files after inspecting enough context. Paths must be relative to the target root. Safegraph preflights the diff, repairs stale hunks when possible, snapshots changed files, and shows a keep/discard change set.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                diff: { type: "string", description: "Unified diff text, optionally fenced as ```diff. File paths must be relative to the target root." },
                summary: { type: "string", description: "Short user-facing summary of the intended change." }
              },
              required: ["diff"]
            }
          }
        }
      }
    ];
  }

  private async callLocalTool(toolName: string, input: any, cwd: string, targetRoot: vscode.Uri | undefined, webview: vscode.Webview) {
    switch (toolName) {
      case "read_file":
        return await this.localReadFile(input, targetRoot);
      case "search_files":
        return await this.localSearchFiles(input, targetRoot);
      case "list_files":
        return await this.localListFiles(input, targetRoot);
      case "run_safe_command":
        return await this.localRunSafeCommand(input, cwd, webview);
      case "run_verification":
        return await this.localRunVerification(input, cwd, webview);
      case "apply_unified_diff":
        return await this.localApplyUnifiedDiff(input, targetRoot, webview);
      default:
        throw new Error(`Unknown Safegraph local tool: ${toolName}`);
    }
  }

  private isInspectionToolName(name: unknown) {
    return /^safegraph__(read_file|search_files|list_files|run_safe_command)$/.test(String(name || ""));
  }

  private localToolRoot(targetRoot?: vscode.Uri) {
    return targetRoot || vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private resolveWorkspaceToolPath(rawPath: string, targetRoot?: vscode.Uri) {
    const root = this.localToolRoot(targetRoot);
    if (!root) throw new Error("No workspace root is available.");
    const rel = String(rawPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.includes("\u0000")) throw new Error("Invalid file path.");
    const uri = vscode.Uri.joinPath(root, rel);
    const normalizedRoot = path.resolve(root.fsPath);
    const normalizedFile = path.resolve(uri.fsPath);
    if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(normalizedRoot + path.sep)) {
      throw new Error("Path escapes the workspace root.");
    }
    return { root, uri, rel };
  }

  private async localReadFile(input: any, targetRoot?: vscode.Uri) {
    const { uri, rel } = this.resolveWorkspaceToolPath(String(input?.path || ""), targetRoot);
    const maxChars = clampNumber(input?.maxChars, 12000, 1000, 30000);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8");
    if (text.includes("\u0000")) throw new Error(`${rel} appears to be binary.`);
    if (text.length <= maxChars) return `--- ${rel} ---\n${text}`;
    return `--- ${rel} (truncated) ---\n${text.slice(0, Math.floor(maxChars * 0.65))}\n\n[...middle truncated...]\n\n${text.slice(-Math.floor(maxChars * 0.25))}`;
  }

  private async localListFiles(input: any, targetRoot?: vscode.Uri) {
    const root = this.localToolRoot(targetRoot);
    if (!root) throw new Error("No workspace root is available.");
    const glob = String(input?.glob || "**/*.{ts,tsx,js,jsx,py,css,html,json,md,yml,yaml,toml}").slice(0, 200);
    const maxResults = clampNumber(input?.maxResults, 120, 1, 500);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, glob),
      "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__,coverage,.next}/**",
      maxResults
    );
    return files.map((uri) => path.relative(root.fsPath, uri.fsPath).replace(/\\/g, "/")).join("\n") || "(no files)";
  }

  private async localSearchFiles(input: any, targetRoot?: vscode.Uri) {
    const root = this.localToolRoot(targetRoot);
    if (!root) throw new Error("No workspace root is available.");
    const query = String(input?.query || "");
    if (!query.trim()) throw new Error("Missing search query.");
    const regex = Boolean(input?.regex);
    const maxResults = clampNumber(input?.maxResults, 40, 1, 120);
    const glob = String(input?.glob || "**/*.{ts,tsx,js,jsx,py,css,html,json,md,yml,yaml,toml}").slice(0, 200);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, glob),
      "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__,coverage,.next}/**",
      400
    );
    const re = regex ? new RegExp(query, "i") : undefined;
    const needle = query.toLowerCase();
    const matches: string[] = [];
    for (const uri of files) {
      if (matches.length >= maxResults) break;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > 300_000) continue;
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        if (text.includes("\u0000")) continue;
        const rel = path.relative(root.fsPath, uri.fsPath).replace(/\\/g, "/");
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          const line = lines[i];
          const found = re ? re.test(line) : line.toLowerCase().includes(needle);
          if (found) matches.push(`${rel}:${i + 1}: ${line.trim().slice(0, 240)}`);
        }
      } catch {
        // Ignore unreadable files.
      }
    }
    return matches.join("\n") || "(no matches)";
  }

  private summarizeToolResult(resultText: string) {
    const text = String(resultText || "").trim();
    if (!text) return "empty result";
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) return `${lines.length} lines`;
    return lines[0].slice(0, 120);
  }

  private compactToolEvidence(resultText: string) {
    const text = maskSensitive(String(resultText || "").trim());
    if (!text) return "(empty result)";
    const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 120);
    const compact = lines.join("\n");
    if (compact.length <= 4000) return compact;
    return `${compact.slice(0, 2400).trimEnd()}\n\n[...tool result compacted...]\n\n${compact.slice(-1200).trimStart()}`;
  }

  private formatToolOnlyFallback(question: string, observations: string[]) {
    const evidence = observations.length
      ? observations.slice(-10).map((item) => `- ${item}`).join("\n")
      : "- Không có bằng chứng tool đủ rõ để tóm tắt.";
    return [
      "Mình đã dừng vòng đọc file để tránh việc agent chỉ inspect mãi mà không trả lời.",
      "",
      "Kết luận tạm thời từ context đã đọc:",
      evidence,
      "",
      `Yêu cầu gốc: ${question}`,
      "",
      "Hướng cải thiện tiếp theo: giảm phạm vi câu hỏi hoặc attach/chỉ định file chính nếu bạn muốn agent sửa một phần cụ thể. Với lỗi hành vi đọc file lặp lại, extension hiện đã ép chuyển sang chế độ tổng hợp sau một lượng tool call ngắn.",
      "",
      "[DONE]"
    ].join("\n");
  }

  private toolCallSignature(name: unknown, input: unknown) {
    return `${String(name || "tool")} ${this.stableStringify(input)}`;
  }

  private stableStringify(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(obj[key])}`).join(",")}}`;
  }

  private isSafeInspectionCommand(command: string) {
    const trimmed = command.trim();
    return /^(pwd|ls|rg|grep|find|cat|head|tail|wc)(\s|$)/i.test(trimmed) ||
      /^git\s+(status|diff|log|show)(\s|$)/i.test(trimmed) ||
      /^npm\s+pkg\s+get(\s|$)/i.test(trimmed) ||
      /^npm\s+run\s*$/i.test(trimmed) ||
      /^(node|npm)\s+-v\s*$/i.test(trimmed) ||
      /^python3?\s+--version\s*$/i.test(trimmed);
  }

  private async runLocalCommandTool(command: string, cwd: string, webview: vscode.Webview) {
    const decision = decideCommand(command, "safe");
    if (decision.decision !== "allow") {
      throw new Error(`Command requires approval or is unsafe: ${decision.reason}`);
    }
    const id = `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await this.cmdRunner.runAndWait(id, command, cwd, (m) => webview.postMessage(m));
    await this.recordTaskCommandResult(result);
    return [
      `Command: ${result.cmd}`,
      `Status: ${result.status}`,
      `Exit code: ${result.exitCode ?? "(unknown)"}`,
      "Output:",
      result.output.slice(-8000) || "(no output)"
    ].join("\n");
  }

  private async localRunSafeCommand(input: any, cwd: string, webview: vscode.Webview) {
    const command = String(input?.command || "").trim();
    if (!command) throw new Error("Missing command.");
    if (!this.isSafeInspectionCommand(command)) {
      throw new Error("Refusing to run a non-inspection command through run_safe_command. Use run_verification for build/test/lint, or propose a command for user approval.");
    }
    return await this.runLocalCommandTool(command, cwd, webview);
  }

  private async localRunVerification(input: any, cwd: string, webview: vscode.Webview) {
    const command = String(input?.command || "").trim();
    if (!command) throw new Error("Missing verification command.");
    if (!/\b(test|build|typecheck|lint|pytest|jest|tsc|py_compile|cargo test|go test)\b/i.test(command)) {
      throw new Error("Refusing to run a non-verification command through run_verification.");
    }
    return await this.runLocalCommandTool(command, cwd, webview);
  }

  private async localApplyUnifiedDiff(input: any, targetRoot: vscode.Uri | undefined, webview: vscode.Webview) {
    const raw = String(input?.diff || "").trim();
    if (!raw) throw new Error("Missing unified diff.");
    const extracted = extractDiffBlocks(raw);
    const diff = extracted.length > 0 ? extracted.join("\n\n") : raw;
    if (!diff.includes("--- ") || !diff.includes("+++ ")) {
      throw new Error("Expected a valid unified diff with --- and +++ file headers.");
    }

    const summary = String(input?.summary || "Tool-applied workspace changes").slice(0, 240);
    const changeSetId = `tool-apply-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const appliedDiff = await this.applyDiffWithRepair(diff, summary, targetRoot, changeSetId);
    if (!appliedDiff.trim()) {
      return "Diff was empty, already applied, or repaired to a no-op. No workspace changes were made.";
    }

    await this.recordTaskDiffApplied(appliedDiff);
    webview.postMessage({
      type: "autoAppliedChangeSet",
      id: changeSetId,
      diff: appliedDiff,
      summary: this.summarizeAppliedDiff(appliedDiff),
      ts: Date.now()
    } satisfies ExtensionToWebviewMessage);

    return [
      "Workspace diff applied successfully.",
      `Change set id: ${changeSetId}`,
      `Intent: ${summary}`,
      `Summary: ${this.summarizeAppliedDiff(appliedDiff)}`,
      this.formatAppliedDiffDetails(appliedDiff),
      "The user can keep or discard the applied change set in the Safegraph UI.",
      "Next step: run safe verification if a relevant build/test/typecheck command is available."
    ].join("\n");
  }

  private loadPersistedTaskState() {
    const raw = this.context.globalState.get("safegraph.activeTaskState");
    if (!raw || typeof raw !== "object") return undefined;
    const task = raw as AgentTaskState;
    if (!task.id || !task.goal || !Array.isArray(task.steps)) return undefined;
    if (!Array.isArray(task.agentNotes)) task.agentNotes = [];
    if (!Array.isArray(task.toolObservations)) task.toolObservations = [];
    return task.status === "active" ? task : undefined;
  }

  private async persistTaskState() {
    if (!this.activeTaskState) {
      await this.context.globalState.update("safegraph.activeTaskState", undefined);
      return;
    }
    this.updateTaskStatusBar(this.activeTaskState);
    await this.context.globalState.update("safegraph.activeTaskState", this.activeTaskState);
  }

  private updateTaskStatusBar(task: AgentTaskState) {
    const current = task.steps.find((step) => step.status === "in_progress");
    const failed = task.steps.find((step) => step.status === "failed");
    const latestVerification = task.verification[task.verification.length - 1];
    const changed = task.filesChanged.length;
    const commands = task.commandsExecuted.length;

    if (task.status === "completed") {
      this.statusItem.text = "$(check) Safegraph: Done";
    } else if (failed || task.errors.length) {
      this.statusItem.text = "$(warning) Safegraph: Needs fix";
    } else if (latestVerification && latestVerification.passed) {
      this.statusItem.text = "$(pass) Safegraph: Verified";
    } else if (current) {
      this.statusItem.text = `$(sparkle) Safegraph: ${current.title.slice(0, 28)}`;
    } else {
      this.statusItem.text = "$(sparkle) Safegraph: Active";
    }

    this.statusItem.tooltip = [
      `Safegraph AI task: ${task.goal.slice(0, 140)}`,
      `Status: ${task.status}`,
      current ? `Current step: ${current.title}` : "",
      failed ? `Failed step: ${failed.title}` : "",
      `Files changed: ${changed}`,
      `Commands run: ${commands}`,
      latestVerification ? `Latest verification: ${latestVerification.command} => ${latestVerification.passed ? "pass" : "fail"}` : "",
      task.errors.length ? `Open error: ${task.errors[task.errors.length - 1].slice(0, 220)}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  private getOrCreateTaskState(question: string, requestType: string, targetRoot: string) {
    const canContinue =
      this.activeTaskState?.status === "active" &&
      (this.isCommandFeedback(question) || this.isLikelySameTask(question, this.activeTaskState));

    if (!canContinue) {
      this.activeTaskState = this.createTaskState(question, requestType, targetRoot);
      this.historyManager?.startTask(question.slice(0, 160), `${requestType} in ${targetRoot || "(no workspace)"}`);
    } else if (this.activeTaskState) {
      this.activeTaskState.updatedAt = Date.now();
      this.activeTaskState.targetRoot = targetRoot || this.activeTaskState.targetRoot;
      const current = this.activeTaskState.steps.find((step) => step.status === "in_progress");
      if (!current) {
        const next = this.activeTaskState.steps.find((step) => step.status === "pending");
        if (next) next.status = "in_progress";
      }
    }

    void this.persistTaskState();
    return this.activeTaskState!;
  }

  private isCommandFeedback(text: string) {
    return /^\[Command execution finished\]/i.test(String(text || "").trim());
  }

  private isLikelySameTask(question: string, task: AgentTaskState) {
    const q = String(question || "").trim();
    if (!q) return true;
    if (/^(tiếp|continue|ok|đúng|làm đi|sửa tiếp|chạy tiếp|try again|fix it)/i.test(q)) return true;
    const current = this.keywordSet(q);
    const previous = this.keywordSet(
      [
        task.goal,
        task.filesChanged.join("\n"),
        task.errors.join("\n"),
        (task.toolObservations || []).slice(-12).map((item) => `${item.tool} ${item.input} ${item.summary}`).join("\n")
      ].join("\n")
    );
    let overlap = 0;
    for (const key of current) {
      if (previous.has(key)) overlap += 1;
    }
    return overlap >= 2;
  }

  private createTaskState(question: string, requestType: string, targetRoot: string): AgentTaskState {
    const now = Date.now();
    const steps = this.initialTaskSteps(requestType).map((title, index) => ({
      id: `step_${index + 1}`,
      title,
      status: index === 0 ? "in_progress" as TaskStepStatus : "pending" as TaskStepStatus
    }));
    return {
      id: `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
      goal: question.slice(0, 500),
      requestType,
      targetRoot,
      status: "active",
      startedAt: now,
      updatedAt: now,
      steps,
      filesChanged: [],
      commandsExecuted: [],
      verification: [],
      toolObservations: [],
      errors: [],
      agentNotes: []
    };
  }

  private async getContextBundleForTask(args: {
    task: AgentTaskState;
    userText: string;
    targetRoot?: vscode.Uri;
    taggedFiles: string[];
    includeRepositoryContext: boolean;
    fullRepositoryContext: boolean;
    contextMaxChars: number;
  }) {
    const includeFiles = args.taggedFiles.filter((p) => p !== "@Repository");
    const key = [
      args.targetRoot?.fsPath || "",
      args.includeRepositoryContext ? "repo" : "no-repo",
      args.fullRepositoryContext ? "full" : "compact",
      args.contextMaxChars,
      includeFiles.join("|"),
      extractUrls(args.userText).join("|"),
      this.isCommandFeedback(args.userText) ? "command-feedback" : Array.from(this.keywordSet(args.userText)).slice(0, 24).join("|")
    ].join("\n");
    const fileVersion = args.task.filesChanged.length;
    const cache = args.task.contextCache;
    const cacheFresh = cache && cache.key === key && cache.fileVersion === fileVersion && Date.now() - cache.createdAt < 10 * 60 * 1000;
    if (cacheFresh) {
      return {
        context: `${cache.context}\n\nContext cache: reused for task ${args.task.id}.`,
        webResearch: cache.webResearch
      };
    }

    const context = await buildContext({
      maxChars: args.contextMaxChars,
      maxFiles: args.fullRepositoryContext ? 80 : 50,
      includeFiles,
      query: args.userText,
      storageUri: this.context.globalStorageUri,
      includeRepository: args.includeRepositoryContext,
      targetRoot: args.targetRoot
    });
    const webResearch = await this.buildWebResearchBundle(args.userText);
    args.task.contextCache = {
      key,
      context,
      webResearch,
      createdAt: Date.now(),
      fileVersion
    };
    await this.persistTaskState();
    return { context, webResearch };
  }

  private async runLightweightSubagents(task: AgentTaskState, requestType: string, context: string) {
    const contextScout = this.contextScoutNote(context);
    if (contextScout) this.addAgentNote(task, "context-scout", contextScout);

    const reviewer = this.reviewerNote(task, context);
    if (reviewer) this.addAgentNote(task, "reviewer", reviewer);

    const testFixer = this.testFixerNote(task, requestType);
    if (testFixer) this.addAgentNote(task, "test-fixer", testFixer);

    await this.persistTaskState();
  }

  private addAgentNote(task: AgentTaskState, role: AgentTaskState["agentNotes"][number]["role"], note: string) {
    const normalized = note.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const key = `${role}:${normalized.toLowerCase().slice(0, 180)}`;
    const existing = new Set(task.agentNotes.map((item) => `${item.role}:${item.note.toLowerCase().replace(/\s+/g, " ").slice(0, 180)}`));
    if (existing.has(key)) return;
    task.agentNotes.push({ role, note: normalized.slice(0, 700), ts: Date.now() });
    if (task.agentNotes.length > 12) task.agentNotes = task.agentNotes.slice(-12);
    task.updatedAt = Date.now();
  }

  private contextScoutNote(context: string) {
    const lines = String(context || "").split(/\r?\n/);
    const active = lines.find((line) => line.startsWith("Active file:")) || "";
    const target = lines.find((line) => line.startsWith("Target root for this task:")) || "";
    const diagnostics = lines.find((line) => /^Errors \(|^Warnings \(/.test(line)) || "";
    const repo = lines.find((line) => line.includes("Repository code-specific context")) || "";
    return [target, active, diagnostics, repo ? "Repository RAG is present; prefer targeted tool reads for missing details." : ""]
      .filter(Boolean)
      .join(" ");
  }

  private reviewerNote(task: AgentTaskState, context: string) {
    const notes: string[] = [];
    if (task.filesChanged.length) notes.push(`Review changed files first: ${task.filesChanged.slice(-8).join(", ")}.`);
    if (/Git status:\n[\s\S]*\b(M|A|D|\?\?)\s+/i.test(context)) notes.push("Workspace has uncommitted changes; avoid unrelated rewrites and preserve user edits.");
    if (task.errors.length) notes.push(`Open error should drive next action: ${task.errors[task.errors.length - 1].slice(0, 260)}.`);
    return notes.join(" ");
  }

  private testFixerNote(task: AgentTaskState, requestType: string) {
    const failed = task.verification.slice().reverse().find((item) => !item.passed);
    if (failed) {
      return `Latest verification failed: ${failed.command}. Use output tail to fix root cause, then rerun the smallest failing command. Tail: ${failed.outputTail.slice(-360)}`;
    }
    if (/(bugfix|tdd|test|debug)/i.test(requestType) && task.verification.length === 0) {
      return "No verification has passed yet; after changes, run the smallest relevant build/test/typecheck command.";
    }
    return "";
  }

  private initialTaskSteps(requestType: string) {
    if (requestType === "bugfix/debug" || requestType === "frontend-data/static-asset-debug") {
      return ["Reproduce or inspect the failure", "Find root cause", "Apply focused fix", "Run verification", "Summarize result and risk"];
    }
    if (requestType === "tdd/test-first") {
      return ["Identify behavior and seam", "Add focused failing test", "Implement minimal fix", "Run tests", "Summarize result and risk"];
    }
    if (requestType === "architecture/refactor" || requestType === "review/refactor") {
      return ["Inspect architecture and changed files", "Identify concrete risks", "Apply focused refactor if needed", "Run verification", "Summarize result and risk"];
    }
    if (requestType === "prototype" || requestType === "frontend/ui") {
      return ["Identify target UI workflow", "Implement inspectable screen/state", "Check responsive/build behavior", "Summarize result and risk"];
    }
    return ["Understand request and context", "Apply focused changes if needed", "Run verification", "Summarize result and risk"];
  }

  private formatTaskStateForPrompt(task: AgentTaskState) {
    const lines: string[] = [
      `Task id: ${task.id}`,
      `Goal: ${maskSensitive(task.goal)}`,
      `Status: ${task.status}`,
      `Request type: ${task.requestType}`,
      `Target root: ${maskSensitive(task.targetRoot || "(none)")}`,
      "Plan:"
    ];
    for (const step of task.steps) {
      lines.push(`- [${step.status}] ${step.title}${step.evidence ? ` (${maskSensitive(step.evidence).slice(0, 220)})` : ""}`);
    }
    if (task.filesChanged.length) lines.push(`Files changed: ${task.filesChanged.slice(-12).join(", ")}`);
    if (task.commandsExecuted.length) {
      lines.push(
        "Commands executed: " +
          task.commandsExecuted
            .slice(-6)
            .map((item) => `${item.cmd} => ${item.status}${item.exitCode === undefined ? "" : ` (${item.exitCode})`}`)
            .join("; ")
      );
    }
    if (task.verification.length) {
      lines.push(
        "Verification: " +
          task.verification
            .slice(-4)
            .map((item) => `${item.command} => ${item.passed ? "pass" : "fail"}`)
          .join("; ")
      );
    }
    if (task.toolObservations?.length) {
      lines.push("Previous tool evidence:");
      for (const item of task.toolObservations.slice(-10)) {
        lines.push(
          `- ${item.tool} ${maskSensitive(item.input).slice(0, 180)} => ${maskSensitive(item.summary).slice(0, 260)}`
        );
        if (item.evidence) {
          lines.push(`  Evidence: ${maskSensitive(item.evidence).slice(0, 500)}`);
        }
      }
    }
    if (task.errors.length) lines.push(`Open errors: ${task.errors.slice(-4).map((e) => maskSensitive(e).slice(0, 260)).join(" | ")}`);
    if (task.agentNotes.length) {
      lines.push(
        "Subagent notes: " +
          task.agentNotes
            .slice(-6)
            .map((item) => `${item.role}: ${maskSensitive(item.note).slice(0, 260)}`)
            .join(" | ")
      );
    }
    lines.push("Use this state to continue the same task. Do not repeat completed work unless new evidence contradicts it.");
    return lines.join("\n");
  }

  private advanceTaskStep(matcher: RegExp | string, status: TaskStepStatus, evidence?: string) {
    const task = this.activeTaskState;
    if (!task) return;
    const step = task.steps.find((item) =>
      typeof matcher === "string" ? item.title.toLowerCase().includes(matcher.toLowerCase()) : matcher.test(item.title)
    );
    if (step) {
      step.status = status;
      if (evidence) step.evidence = evidence;
    }
    if (status === "completed") {
      for (const item of task.steps) {
        if (item === step) break;
        if (item.status === "in_progress") item.status = "completed";
      }
      const next = task.steps.find((item) => item.status === "pending");
      if (next && !task.steps.some((item) => item.status === "in_progress")) next.status = "in_progress";
    }
    task.updatedAt = Date.now();
  }

  private async recordTaskDiffApplied(diff: string) {
    const task = this.activeTaskState;
    if (!task) return;
    for (const file of this.extractChangedFilesFromDiff(diff)) {
      if (!task.filesChanged.includes(file)) task.filesChanged.push(file);
    }
    this.historyManager?.logAction(this.summarizeAppliedDiff(diff), "diff", diff.slice(0, 12000));
    task.contextCache = undefined;
    this.advanceTaskStep(/apply|implement|refactor|screen|changes/i, "completed", this.summarizeAppliedDiff(diff));
    await this.persistTaskState();
  }

  private async recordTaskCommandResult(result: CommandRunResult) {
    const task = this.activeTaskState;
    if (!task) return;
    const status = result.status === "success" && (result.exitCode === undefined || result.exitCode === 0) ? "success" : result.status;
    task.commandsExecuted.push({ cmd: result.cmd, exitCode: result.exitCode, status });
    this.historyManager?.logAction(`Run command: ${result.cmd}`, "command", undefined, result.exitCode, result.output.slice(-12000));
    const looksLikeVerification = /\b(test|build|typecheck|lint|pytest|jest|tsc|py_compile|cargo test|go test)\b/i.test(result.cmd);
    if (looksLikeVerification) {
      const passed = status === "success";
      this.historyManager?.logVerification(passed, `${result.cmd}\nExit code: ${result.exitCode ?? "(unknown)"}\n${result.output.slice(-4000)}`);
      task.verification.push({
        command: result.cmd,
        passed,
        outputTail: result.output.slice(-1200),
        ts: Date.now()
      });
      this.advanceTaskStep(/verify|test|check|responsive|build/i, passed ? "completed" : "failed", `${result.cmd} exit ${result.exitCode ?? "unknown"}`);
      if (passed) task.errors = [];
      else task.errors.push(`${result.cmd} failed: ${result.output.slice(-500)}`);
    }
    task.updatedAt = Date.now();
    await this.persistTaskState();
  }

  private async recordTaskToolObservation(tool: unknown, input: unknown, summary: string, resultText: string) {
    const task = this.activeTaskState;
    if (!task) return;
    if (!Array.isArray(task.toolObservations)) task.toolObservations = [];

    const toolName = String(tool || "tool");
    const inputText = this.compactToolInput(input);
    const evidence = this.compactToolEvidenceForMemory(resultText);
    const key = `${toolName}\n${inputText}`;
    const existingIndex = task.toolObservations.findIndex((item) => `${item.tool}\n${item.input}` === key);
    const observation = {
      tool: toolName,
      input: inputText,
      summary: String(summary || "completed").slice(0, 300),
      evidence,
      ts: Date.now()
    };

    if (existingIndex >= 0) {
      task.toolObservations.splice(existingIndex, 1);
    }
    task.toolObservations.push(observation);
    this.historyManager?.logAction(
      `Tool evidence: ${toolName} ${inputText.slice(0, 120)}`,
      "tool",
      evidence.slice(0, 6000)
    );
    if (task.toolObservations.length > 24) {
      task.toolObservations = task.toolObservations.slice(-24);
    }
    task.updatedAt = Date.now();
    await this.persistTaskState();
  }

  private compactToolInput(input: unknown) {
    const text = this.stableStringify(input);
    if (!text) return "{}";
    return maskSensitive(text).slice(0, 500);
  }

  private compactToolEvidenceForMemory(resultText: string) {
    const text = this.compactToolEvidence(resultText);
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const informative = lines
      .filter((line) => !/^[-=]{3,}$/.test(line.trim()))
      .slice(0, 40)
      .join("\n");
    const compact = informative || text;
    if (compact.length <= 1800) return compact;
    return `${compact.slice(0, 1100).trimEnd()}\n[...evidence compacted...]\n${compact.slice(-500).trimStart()}`;
  }

  private async recordTaskError(error: string) {
    const task = this.activeTaskState;
    if (!task) return;
    task.errors.push(String(error).slice(0, 1000));
    const current = task.steps.find((step) => step.status === "in_progress");
    if (current) {
      current.status = "failed";
      current.evidence = String(error).slice(0, 260);
    }
    task.updatedAt = Date.now();
    await this.persistTaskState();
  }

  private async markTaskCompleted(finalText: string) {
    const task = this.activeTaskState;
    if (!task) return;
    task.status = "completed";
    for (const step of task.steps) {
      if (step.status === "pending" || step.status === "in_progress") step.status = "completed";
    }
    if (finalText.trim()) {
      const summary = this.compactHistoryText(finalText, "assistant").slice(0, 500);
      const finalStep = task.steps[task.steps.length - 1];
      if (finalStep) finalStep.evidence = summary;
      this.historyManager?.completeTask(summary, true);
    }
    task.updatedAt = Date.now();
    await this.persistTaskState();
  }

  private formatEvidenceReport() {
    const task = this.activeTaskState;
    if (!task) return "";
    const verification = task.verification.slice(-6);
    const passed = verification.filter((item) => item.passed).length;
    const failed = verification.filter((item) => !item.passed).length;
    const remainingRisk = task.errors.length
      ? `Open errors remain: ${task.errors.slice(-3).map((e) => maskSensitive(e).slice(0, 220)).join(" | ")}`
      : failed > 0
        ? "A previous verification failed; confirm the latest repair covered it."
        : verification.length === 0
          ? "No verification command was recorded."
          : "No open errors recorded.";

    return [
      "Evidence Report",
      `- Task: ${maskSensitive(task.goal).slice(0, 240)}`,
      `- Files changed: ${task.filesChanged.length ? task.filesChanged.slice(-12).join(", ") : "(none recorded)"}`,
      `- Commands run: ${
        task.commandsExecuted.length
          ? task.commandsExecuted
              .slice(-8)
              .map((item) => `${item.cmd} => ${item.status}${item.exitCode === undefined ? "" : ` (${item.exitCode})`}`)
              .join("; ")
          : "(none recorded)"
      }`,
      `- Verification: ${verification.length ? `${passed} passed, ${failed} failed` : "none recorded"}`,
      `- Remaining risk: ${remainingRisk}`
    ].join("\n");
  }

  private selectRecentHistoryForPrompt(latestQuestion: string) {
    const recent = this.history.slice(-10);
    if (recent.length <= 4) return recent;

    const latestKeywords = this.keywordSet(latestQuestion);
    const scored = recent.map((item, index) => {
      const keywords = this.keywordSet(item.text);
      let overlap = 0;
      for (const key of keywords) {
        if (latestKeywords.has(key)) overlap += 1;
      }
      const recency = index / Math.max(1, recent.length - 1);
      return { item, index, score: overlap * 3 + recency };
    });

    const selected = new Set<number>();
    for (const item of scored.slice(-4)) selected.add(item.index);
    for (const item of scored.sort((a, b) => b.score - a.score).slice(0, 4)) selected.add(item.index);

    return Array.from(selected)
      .sort((a, b) => a - b)
      .map((index) => recent[index]);
  }

  private keywordSet(text: string) {
    const words = String(text || "")
      .toLowerCase()
      .match(/[a-z0-9_./-]{3,}|[\p{L}\p{N}_./-]{3,}/gu) || [];
    const stop = new Set([
      "the", "and", "for", "that", "this", "with", "from", "you", "your", "safegraph",
      "user", "file", "code", "hãy", "giúp", "cho", "của", "với", "này", "mình", "bạn"
    ]);
    return new Set(words.filter((word) => !stop.has(word)).slice(0, 80));
  }

  private compactHistoryText(text: string, role: "user" | "assistant") {
    let compact = stripDiffBlocksForLiveApply(String(text || ""));
    compact = compact.replace(/```[\s\S]*?```/g, (block) => {
      const firstLine = block.split(/\r?\n/)[0] || "code";
      return `[${firstLine.replace(/`/g, "").trim() || "code"} block omitted from memory]`;
    });
    compact = compact
      .replace(/\[DONE\]|\[CONTINUE\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const max = role === "assistant" ? 900 : 700;
    if (compact.length <= max) return compact;
    return `${compact.slice(0, Math.floor(max * 0.65)).trim()}\n[...memory compacted...]\n${compact.slice(-Math.floor(max * 0.25)).trim()}`;
  }

  private compactAttachmentForPrompt(text: string) {
    let compact = String(text || "");
    if (!compact.trim()) return "";

    compact = compact.replace(/\r\n/g, "\n");
    const maxChars = 12_000;
    if (compact.length <= maxChars) return compact;

    const head = compact.slice(0, Math.floor(maxChars * 0.62)).trimEnd();
    const tail = compact.slice(-Math.floor(maxChars * 0.28)).trimStart();
    return `${head}\n\n[...attachment middle truncated by Safegraph AI to reduce token use...]\n\n${tail}`;
  }

  private updateConversationSummary(previous: string, userText: string, assistantText: string) {
    const bullets = this.memoryBulletsFromTurn(userText, assistantText);
    const combined = [previous.trim(), bullets].filter(Boolean).join("\n");
    const lines = combined
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const key = line.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(line.startsWith("- ") ? line : `- ${line}`);
    }

    const kept = deduped.slice(-24);
    let summary = kept.join("\n");
    if (summary.length > 6000) summary = summary.slice(-6000).replace(/^[^\n]*\n?/, "");
    return summary;
  }

  private memoryBulletsFromTurn(userText: string, assistantText: string) {
    const user = maskSensitive(String(userText || "").trim()).replace(/\s+/g, " ");
    const assistant = maskSensitive(this.compactHistoryText(assistantText, "assistant"));
    const bullets: string[] = [];

    if (user) bullets.push(`- User goal: ${user.slice(0, 260)}`);

    const changedFiles = Array.from(
      new Set(
        [...assistant.matchAll(/\b(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|css|html|json|md|yml|yaml|toml)\b/g)]
          .map((match) => match[0])
          .slice(0, 10)
      )
    );
    if (changedFiles.length) bullets.push(`- Files discussed/changed: ${changedFiles.join(", ")}`);

    const commandLines = [...assistant.matchAll(/^Command:\s*(.+)$/gim)].map((match) => match[1].trim()).slice(0, 6);
    if (commandLines.length) bullets.push(`- Commands/verifications: ${commandLines.join("; ")}`);

    const finalSummaryMatch = assistant.match(/Final Summary[:\n]+([\s\S]{0,900})/i);
    if (finalSummaryMatch?.[1]) {
      const summary = finalSummaryMatch[1]
        .replace(/\[DONE\]|\[CONTINUE\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (summary) bullets.push(`- Result: ${summary.slice(0, 420)}`);
    } else {
      const lines = assistant
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /pass|fail|đã|sửa|thêm|changed|updated|created|fixed|verified|build|test/i.test(line))
        .slice(-3);
      if (lines.length) bullets.push(`- Result: ${lines.join(" ").slice(0, 420)}`);
    }

    return bullets.join("\n");
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
    const explicitResearch = /(research|docs|documentation|source|cite|tài liệu|nguồn|tra cứu|tham khảo)/i.test(userText);
    const maxPagesPerSeed = explicitResearch ? 8 : 4;
    const maxCharsPerPage = explicitResearch ? 6500 : 3500;
    const maxTotalChars = explicitResearch ? 32_000 : 14_000;

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
    const chatCfg2 = getChatConfig();
    let combined = "";
    let loops = 0;
    let nextPrompt = prompt;
    for (;;) {
      const r = await bedrockConverse(nextPrompt, {
        region: options.region,
        modelId: options.modelId,
        apiKey: options.apiKey,
        signal: this.currentAbort?.signal,
        maxTokens: options.maxTokens ?? chatCfg2.maxTokens,
        temperature: options.temperature ?? chatCfg2.temperature
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

    const chatCfg3 = getChatConfig();
    const repaired = await bedrockConverse(prompt, {
      region,
      modelId,
      apiKey,
      maxTokens: chatCfg3.maxTokens,
      temperature: chatCfg3.temperature,
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
    const stats = this.appliedDiffStats(diff);
    const patches = stats.files;
    if (patches.length === 0) return "No file changes.";
    const parts = [
      stats.created ? `${stats.created} created` : "",
      stats.updated ? `${stats.updated} updated` : "",
      stats.deleted ? `${stats.deleted} deleted` : ""
    ].filter(Boolean);
    const fileList = patches
      .slice(0, 4)
      .map((item) => `${item.path} (+${item.added}/-${item.removed})`)
      .join(", ");
    const more = patches.length > 4 ? `, +${patches.length - 4} more` : "";
    return `${patches.length} file${patches.length === 1 ? "" : "s"} applied (+${stats.added}/-${stats.removed}${parts.length ? `; ${parts.join(", ")}` : ""}): ${fileList}${more}.`;
  }

  private formatAppliedDiffDetails(diff: string) {
    const stats = this.appliedDiffStats(diff);
    if (stats.files.length === 0) return "Changed files: (none)";
    return [
      `Changed files: ${stats.files.length}`,
      `Lines changed: +${stats.added} / -${stats.removed}`,
      ...stats.files.slice(0, 12).map((item) => {
        const action = item.kind === "create" ? "created" : item.kind === "delete" ? "deleted" : "updated";
        return `- ${item.path}: ${action}, +${item.added} / -${item.removed}`;
      }),
      stats.files.length > 12 ? `- ...${stats.files.length - 12} more file(s)` : ""
    ].filter(Boolean).join("\n");
  }

  private appliedDiffStats(diff: string) {
    const patches = parseUnifiedDiff(diff);
    const files = patches.map((patch) => {
      let added = 0;
      let removed = 0;
      for (const hunk of patch.hunks || []) {
        for (const line of hunk.lines || []) {
          if (line.kind === "add") added += 1;
          if (line.kind === "del") removed += 1;
        }
      }
      return {
        path: patch.filePath || patch.newPath || patch.oldPath,
        kind: patch.kind,
        added,
        removed
      };
    });
    return files.reduce(
      (acc, item) => {
        acc.added += item.added;
        acc.removed += item.removed;
        if (item.kind === "create") acc.created += 1;
        else if (item.kind === "delete") acc.deleted += 1;
        else acc.updated += 1;
        acc.files.push(item);
        return acc;
      },
      {
        added: 0,
        removed: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        files: [] as { path: string; kind: "update" | "create" | "delete"; added: number; removed: number }[]
      }
    );
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
