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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ChatViewProvider_1 = require("./chat/ChatViewProvider");
function activate(context) {
    const output = vscode.window.createOutputChannel("Safegraph AI");
    output.appendLine("[safegraph-ai] Start window");
    output.appendLine("[safegraph-ai] activate");
    context.subscriptions.push(output);
    try {
        const provider = new ChatViewProvider_1.ChatViewProvider(context, output);
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider_1.ChatViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        }));
        const openChatCommand = vscode.commands.registerCommand("safegraph.openChat", async () => {
            try {
                await vscode.commands.executeCommand("workbench.view.extension.safegraph");
            }
            catch (error) {
                output.appendLine(`[safegraph-ai] openChat failed: ${String(error)}`);
            }
        });
        context.subscriptions.push(openChatCommand);
        const setBedrockApiKeyCommand = vscode.commands.registerCommand("safegraph.setBedrockApiKey", async () => {
            const key = await vscode.window.showInputBox({
                title: "Safegraph AI",
                prompt: "Enter AWS Bedrock API key (bedrock-api-key-... or ABSK...)",
                password: true,
                ignoreFocusOut: true
            });
            if (!key)
                return;
            await context.secrets.store("safegraph.bedrockApiKey", key.trim());
            output.appendLine("[safegraph-ai] Bedrock API key stored in SecretStorage");
            vscode.window.showInformationMessage("Safegraph AI: API key saved.");
        });
        context.subscriptions.push(setBedrockApiKeyCommand);
        const moveChatRightCommand = vscode.commands.registerCommand("safegraph.moveChatRight", async () => {
            // VS Code doesn't provide an API for forcing a view into the Secondary Side Bar.
            // Best-effort: show the Secondary Side Bar and open the built-in Move View flow.
            try {
                // Ensure our container/view is visible and focused first.
                await vscode.commands.executeCommand("workbench.view.extension.safegraph");
                await vscode.commands.executeCommand("workbench.action.focusSideBar");
                await vscode.commands.executeCommand("workbench.action.focusFirstSideBarView");
                // Show Secondary Side Bar (Auxiliary Bar) if hidden.
                await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
            }
            catch {
                // ignore
            }
            try {
                await vscode.commands.executeCommand("workbench.action.moveFocusedView");
            }
            catch (error) {
                output.appendLine(`[safegraph-ai] moveChatRight failed: ${String(error)}`);
            }
            vscode.window.showInformationMessage("To dock Safegraph AI on the right: right-click the Safegraph AI icon in the Activity Bar and choose 'Move View to Secondary Side Bar', or drag it to the right sidebar.");
        });
        context.subscriptions.push(moveChatRightCommand);
        output.appendLine(`[safegraph-ai] registered webview provider: ${ChatViewProvider_1.ChatViewProvider.viewType}`);
        output.appendLine("[safegraph-ai] registered command: safegraph.openChat");
        output.appendLine("[safegraph-ai] registered command: safegraph.setBedrockApiKey");
        output.appendLine("[safegraph-ai] registered command: safegraph.moveChatRight");
    }
    catch (e) {
        output.appendLine(`[safegraph-ai] activate failed: ${String(e)}`);
        vscode.window.showErrorMessage(`Safegraph AI failed to activate: ${String(e)}`);
    }
}
function deactivate() { }
