"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const webviewHtml_1 = require("./webviewHtml");
const bedrockClient_1 = require("../bedrock/bedrockClient");
const contextBuilder_1 = require("../context/contextBuilder");
const mask_1 = require("../security/mask");
const env_1 = require("../config/env");
const runInTerminal_1 = require("../terminal/runInTerminal");
const unifiedDiff_1 = require("../apply/unifiedDiff");
class ChatViewProvider {
    context;
    output;
    static viewType = "safegraph.chatView";
    view;
    currentAbort;
    autoRunDoneFor = new Set();
    constructor(context, output) {
        this.context = context;
        this.output = output;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.output.appendLine(`[safegraph-ai] resolveWebviewView: ${ChatViewProvider.viewType}`);
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        webviewView.webview.html = (0, webviewHtml_1.getChatWebviewHtml)(webviewView.webview, this.context.extensionUri);
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "ready")
                return;
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
                    await (0, unifiedDiff_1.applyUnifiedDiffToWorkspace)(msg.diff);
                    vscode.window.showInformationMessage("Safegraph AI: Applied changes.");
                }
                catch (e) {
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
                    const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,dist,build,out,venv,.venv}/**", 200);
                    const filtered = files
                        .map((u) => u.fsPath)
                        .filter((p) => p.toLowerCase().includes(query))
                        .slice(0, 30)
                        .map((p) => ({ path: p, label: p.split(/[\\/]/).slice(-2).join("/") }));
                    const resp = {
                        type: "fileSuggestions",
                        items: filtered,
                        ts: Date.now()
                    };
                    webviewView.webview.postMessage(resp);
                }
                catch (e) {
                    this.output.appendLine(`[safegraph-ai] suggestFiles failed: ${String(e)}`);
                }
                return;
            }
            if (msg.type === "userMessage") {
                try {
                    this.currentAbort?.abort();
                    this.currentAbort = new AbortController();
                    this.autoRunDoneFor.delete(msg.id);
                    let apiKey = (await this.context.secrets.get("safegraph.bedrockApiKey")) || "";
                    if (!apiKey) {
                        const envKey = await (0, env_1.loadBedrockApiKeyFromDotEnv)();
                        if (envKey) {
                            apiKey = envKey;
                            await this.context.secrets.store("safegraph.bedrockApiKey", apiKey);
                            this.output.appendLine("[safegraph-ai] loaded Bedrock API key from .env into SecretStorage");
                        }
                    }
                    if (!apiKey) {
                        const err = {
                            type: "error",
                            message: "Missing Bedrock API key. Add AWS_BEARER_TOKEN_BEDROCK (or API_KEY) to workspace .env, or click 'Set Key' in the chat header.",
                            ts: Date.now()
                        };
                        webviewView.webview.postMessage(err);
                        return;
                    }
                    const cfg = vscode.workspace.getConfiguration("safegraph");
                    const region = String(cfg.get("region") || "ap-southeast-1");
                    const modelId = String(cfg.get("modelId") ||
                        "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623");
                    const ctx = await (0, contextBuilder_1.buildContext)({
                        maxChars: 8000,
                        maxFiles: 80,
                        includeFiles: msg.taggedFiles || []
                    });
                    const maskedCtx = (0, mask_1.maskSensitive)(ctx);
                    const maskedQuestion = (0, mask_1.maskSensitive)(msg.text);
                    const tagged = (msg.taggedFiles || []).map((p) => (0, mask_1.maskSensitive)(p));
                    const prompt = "You are Safegraph AI inside VS Code. Answer concisely, propose code edits with clear steps.\n\n" +
                        "If you want to run terminal commands, put ONLY the exact commands (one per line) inside a fenced code block labeled sh (```sh ... ```). " +
                        "Do not prefix commands with '+', '-', bullets, or commentary.\n\n" +
                        "If you propose file edits, include a unified diff inside a fenced code block labeled diff (```diff ... ```), " +
                        "with file paths relative to the workspace root.\n\n" +
                        "Context:\n" +
                        maskedCtx +
                        (tagged.length ? "\n\nTagged files (@):\n" + tagged.join("\n") : "") +
                        "\n\nUser question:\n" +
                        maskedQuestion;
                    const thinking = {
                        type: "assistantMessage",
                        id: msg.id,
                        text: "",
                        ts: Date.now(),
                        done: false
                    };
                    webviewView.webview.postMessage(thinking);
                    const text = await (0, bedrockClient_1.bedrockConverseText)(prompt, {
                        region,
                        modelId,
                        apiKey,
                        signal: this.currentAbort.signal
                    });
                    let acc = "";
                    const chunkSize = 80;
                    for (let i = 0; i < text.length; i += chunkSize) {
                        if (this.currentAbort.signal.aborted)
                            throw new Error("aborted");
                        acc += text.slice(i, i + chunkSize);
                        const delta = {
                            type: "assistantMessage",
                            id: msg.id,
                            text: acc,
                            ts: Date.now(),
                            done: false
                        };
                        webviewView.webview.postMessage(delta);
                        await new Promise((r) => setTimeout(r, 25));
                    }
                    const reply = {
                        type: "assistantMessage",
                        id: msg.id,
                        text: acc,
                        ts: Date.now(),
                        done: true
                    };
                    webviewView.webview.postMessage(reply);
                    // Cursor-like behavior: auto-run safe commands from assistant output.
                    if (!this.autoRunDoneFor.has(msg.id)) {
                        this.autoRunDoneFor.add(msg.id);
                        await (0, runInTerminal_1.autoRunCommandsFromText)(acc, this.output);
                    }
                }
                catch (e) {
                    this.output.appendLine(`[safegraph-ai] bedrock error: ${String(e)}`);
                    const err = {
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
exports.ChatViewProvider = ChatViewProvider;
