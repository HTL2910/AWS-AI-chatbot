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
exports.loadBedrockApiKeyFromDotEnv = loadBedrockApiKeyFromDotEnv;
const vscode = __importStar(require("vscode"));
function clean(value) {
    return value.trim().replace(/^['"]|['"]$/g, "").trim();
}
async function loadBedrockApiKeyFromDotEnv() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0)
        return null;
    // MVP: read .env at the first workspace folder root.
    const envUri = vscode.Uri.joinPath(folders[0].uri, ".env");
    try {
        const bytes = await vscode.workspace.fs.readFile(envUri);
        const text = Buffer.from(bytes).toString("utf8");
        const lines = text.split(/\r?\n/);
        const map = new Map();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#"))
                continue;
            const idx = trimmed.indexOf("=");
            if (idx <= 0)
                continue;
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1);
            map.set(key, clean(val));
        }
        const apiKey = map.get("AWS_BEARER_TOKEN_BEDROCK") || map.get("API_KEY") || "";
        if (!apiKey)
            return null;
        return apiKey;
    }
    catch {
        return null;
    }
}
