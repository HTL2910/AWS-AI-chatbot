import * as vscode from "vscode";

function nonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

export function getChatWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri) {
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
