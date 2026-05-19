import * as vscode from "vscode";
import { ChatViewProvider } from "./chat/ChatViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Safegraph AI");
  
  // Read and display version
  try {
    const pkgPath = vscode.Uri.joinPath(context.extensionUri, "package.json");
    const pkgBytes = require("fs").readFileSync(pkgPath.fsPath, "utf8");
    const pkg = JSON.parse(pkgBytes);
    output.appendLine(`[safegraph-ai] Version ${pkg.version}`);
  } catch {
    output.appendLine("[safegraph-ai] Version: unknown");
  }
  
  output.appendLine("[safegraph-ai] Activate");
  context.subscriptions.push(output);

  try {
    const provider = new ChatViewProvider(context, output);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    const openChatCommand = vscode.commands.registerCommand("safegraph.openChat", async () => {
      try {
        await vscode.commands.executeCommand("workbench.view.extension.safegraph");
      } catch (error) {
        output.appendLine(`[safegraph-ai] openChat failed: ${String(error)}`);
      }
    });
    context.subscriptions.push(openChatCommand);

    const setBedrockApiKeyCommand = vscode.commands.registerCommand(
      "safegraph.setBedrockApiKey",
      async () => {
        const key = await vscode.window.showInputBox({
          title: "Safegraph AI",
          prompt: "Enter AWS Bedrock API key (bedrock-api-key-... or ABSK...)",
          password: true,
          ignoreFocusOut: true
        });
        if (!key) return;
        await context.secrets.store("safegraph.bedrockApiKey", key.trim());
        output.appendLine("[safegraph-ai] Bedrock API key stored in SecretStorage");
        vscode.window.showInformationMessage("Safegraph AI: API key saved.");
      }
    );
    context.subscriptions.push(setBedrockApiKeyCommand);

    const moveChatRightCommand = vscode.commands.registerCommand(
      "safegraph.moveChatRight",
      async () => {
        // VS Code doesn't provide an API for forcing a view into the Secondary Side Bar.
        // Best-effort: show the Secondary Side Bar and open the built-in Move View flow.
        try {
          // Ensure our container/view is visible and focused first.
          await vscode.commands.executeCommand("workbench.view.extension.safegraph");
          await vscode.commands.executeCommand("workbench.action.focusSideBar");
          await vscode.commands.executeCommand("workbench.action.focusFirstSideBarView");

          // Show Secondary Side Bar (Auxiliary Bar) if hidden.
          await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
        } catch {
          // ignore
        }
        try {
          await vscode.commands.executeCommand("workbench.action.moveFocusedView");
        } catch (error) {
          output.appendLine(`[safegraph-ai] moveChatRight failed: ${String(error)}`);
        }
        vscode.window.showInformationMessage(
          "To dock Safegraph AI on the right: right-click the Safegraph AI icon in the Activity Bar and choose 'Move View to Secondary Side Bar', or drag it to the right sidebar."
        );
      }
    );
    context.subscriptions.push(moveChatRightCommand);

    output.appendLine(`[safegraph-ai] registered webview provider: ${ChatViewProvider.viewType}`);
    output.appendLine("[safegraph-ai] registered command: safegraph.openChat");
    output.appendLine("[safegraph-ai] registered command: safegraph.setBedrockApiKey");
    output.appendLine("[safegraph-ai] registered command: safegraph.moveChatRight");
  } catch (e) {
    output.appendLine(`[safegraph-ai] activate failed: ${String(e)}`);
    vscode.window.showErrorMessage(`Safegraph AI failed to activate: ${String(e)}`);
  }
}

export function deactivate() {}
