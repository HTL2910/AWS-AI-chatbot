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
exports.buildContext = buildContext;
const vscode = __importStar(require("vscode"));
function takeLastLines(text, maxLines) {
    const lines = text.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}
async function buildContext(options = {}) {
    const maxChars = options.maxChars ?? 8000;
    const maxFiles = options.maxFiles ?? 80;
    const includeFiles = options.includeFiles ?? [];
    const parts = [];
    const folders = vscode.workspace.workspaceFolders ?? [];
    parts.push(`Workspace folders: ${folders.map((f) => f.uri.fsPath).join(" | ") || "(none)"}`);
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const doc = editor.document;
        parts.push(`Active file: ${doc.uri.fsPath}`);
        const sel = editor.selection;
        const selected = !sel.isEmpty ? doc.getText(sel) : "";
        if (selected) {
            parts.push("Selected text:");
            parts.push(selected.slice(0, 3000));
        }
        else {
            parts.push("Active file tail (last 120 lines):");
            parts.push(takeLastLines(doc.getText(), 120));
        }
    }
    else {
        parts.push("Active file: (none)");
    }
    try {
        const files = await vscode.workspace.findFiles("**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,h,md,json,yaml,yml,toml}", "**/{node_modules,.git,dist,build,out,venv,.venv}/**", maxFiles);
        parts.push(`Project files (top ${Math.min(maxFiles, files.length)}):`);
        parts.push(files.map((u) => u.fsPath).join("\n"));
    }
    catch {
        // ignore
    }
    if (includeFiles.length > 0) {
        parts.push("Tagged files (@):");
        for (const fp of includeFiles) {
            try {
                const uri = vscode.Uri.file(fp);
                const bytes = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(bytes).toString("utf8");
                parts.push(`--- ${fp} ---`);
                parts.push(takeLastLines(text, 200));
            }
            catch {
                parts.push(`--- ${fp} (unreadable) ---`);
            }
        }
    }
    let ctx = parts.join("\n\n");
    if (ctx.length > maxChars)
        ctx = ctx.slice(0, maxChars) + "\n\n[...truncated...]";
    return ctx;
}
