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
exports.getChatWebviewHtml = getChatWebviewHtml;
const vscode = __importStar(require("vscode"));
function nonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}
function getChatWebviewHtml(webview, extensionUri) {
    const n = nonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "styles.css"));
    const csp = [
        "default-src 'none';",
        `style-src ${webview.cspSource};`,
        `script-src 'nonce-${n}';`,
        `img-src ${webview.cspSource} https: data:;`
    ].join(" ");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Safegraph AI</title>
  </head>
  <body>
    <div class="root">
      <div class="topbar">
        <div class="title">Safegraph AI</div>
        <div class="actions">
          <button id="stop" class="setkey" type="button" title="Stop generating">Stop</button>
          <button id="dockRight" class="setkey" type="button" title="Move to right sidebar">Dock Right</button>
          <button id="setKey" class="setkey" type="button" title="Set Bedrock API Key">Set Key</button>
        </div>
      </div>
      <div id="messages" class="messages" aria-label="Chat messages"></div>
      <form id="composer" class="composer">
        <div id="mention" class="mention" hidden></div>
        <input id="input" class="input" type="text" placeholder="Type a message..." />
        <button id="send" class="send" type="submit">Send</button>
      </form>
    </div>
    <script nonce="${n}" src="${scriptUri}"></script>
  </body>
</html>`;
}
