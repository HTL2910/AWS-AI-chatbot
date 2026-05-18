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
exports.autoRunCommandsFromText = autoRunCommandsFromText;
const vscode = __importStar(require("vscode"));
const commandPolicy_1 = require("./commandPolicy");
let terminal;
function getTerminal() {
    if (terminal)
        return terminal;
    terminal = vscode.window.createTerminal({ name: "Safegraph AI" });
    return terminal;
}
async function autoRunCommandsFromText(text, output) {
    const cfg = vscode.workspace.getConfiguration("safegraph");
    const mode = String(cfg.get("autoRun") || "safe");
    if (mode === "off")
        return;
    // Extract shell-ish fenced blocks and simple "Command:" lines.
    const commands = [];
    const fenceRe = /```(?:sh|bash|powershell|ps1|cmd)\s*([\s\S]*?)```/gi;
    for (const m of text.matchAll(fenceRe)) {
        const block = (m[1] || "").trim();
        for (const line of block.split(/\r?\n/)) {
            const cmd = line.trim();
            if (!cmd)
                continue;
            if (cmd.startsWith("#"))
                continue;
            if (cmd.startsWith("::"))
                continue;
            // Ignore diff-like prefixes that models sometimes include by mistake.
            if (cmd.startsWith("+") || cmd.startsWith("-") || cmd.startsWith("@@"))
                continue;
            commands.push(cmd);
        }
    }
    const lineRe = /^\s*(?:Command|Run|Chay)\s*:\s*(.+)$/gim;
    for (const m of text.matchAll(lineRe)) {
        const cmd = String(m[1] || "").trim();
        if (cmd)
            commands.push(cmd);
    }
    if (commands.length === 0)
        return;
    const term = getTerminal();
    term.show(true);
    for (const cmd of commands) {
        const decision = (0, commandPolicy_1.decideCommand)(cmd, mode);
        if (decision.decision === "deny") {
            output.appendLine(`[auto-run] deny: ${cmd} (${decision.reason})`);
            continue;
        }
        if (decision.decision === "ask") {
            const ok = await vscode.window.showWarningMessage(`Run command?\n${cmd}\nReason: ${decision.reason}`, { modal: true }, "Run");
            if (ok !== "Run") {
                output.appendLine(`[auto-run] skipped by user: ${cmd}`);
                continue;
            }
        }
        output.appendLine(`[auto-run] running: ${cmd}`);
        term.sendText(cmd, true);
    }
}
