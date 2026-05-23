import * as vscode from "vscode";

function nonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

export function getChatWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, version: string = "0.0.1") {
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
    <title>Safegraph AI v${version}</title>
  </head>
  <body data-agent-default="true">
    <div class="root">
      <div class="topbar">
        <div class="title">
          <span>Safegraph AI</span>
          <span class="versionBadge">v${version}</span>
          <span id="statusBadge" class="statusBadge">Ready</span>
        </div>
        <div class="topbarActions">
          <button id="agentMode" class="topbarBtn" type="button" title="Toggle autonomous apply/run behavior">Agent On</button>
          <button id="setKey" class="topbarBtn" type="button" title="Save Bedrock API key">Set Key</button>
          <button id="checkKey" class="topbarBtn" type="button" title="Check where Safegraph reads the Bedrock API key from">Check Key</button>
          <button id="openLog" class="topbarBtn" type="button" title="Open Safegraph AI output log">Log</button>
          <button id="moveRight" class="topbarBtn" type="button" title="Move Safegraph AI to the right sidebar">Dock</button>
          <button id="newChat" class="topbarBtn" type="button" title="Start a new chat">New Chat</button>
        </div>
      </div>
      <div id="messages" class="messages" aria-label="Chat messages">
        <div id="emptyState" class="emptyState">
          <div class="emptyTitle">Ready for this workspace</div>
          <div class="emptyText">Ask for a fix, review current changes, attach files, or run a design pass.</div>
          <div class="emptyActions">
            <button class="emptyAction" type="button" data-prompt="Review the current workspace changes. Focus on bugs, regressions, missing tests, and risky code. Give concise findings first with file paths.">Review changes</button>
            <button class="emptyAction" type="button" data-prompt="Fix the current diagnostics, type errors, and obvious failing code in this workspace. If changes are needed, return a clean unified diff.">Fix diagnostics</button>
          </div>
        </div>
      </div>
      <form id="composer" class="composer">
        <div id="mention" class="mention" hidden></div>
        <div class="contextTools" aria-label="Context tools">
          <button id="attachFile" class="toolBtn" type="button" title="Attach local files">Attach</button>
          <button id="reviewWorkspace" class="toolBtn" type="button" title="Review the current workspace">Review</button>
          <button id="fixDiagnostics" class="toolBtn" type="button" title="Fix diagnostics and errors">Fix</button>
          <button id="designMockup" class="toolBtn" type="button" title="Analyze requirements, design a mockup, and implement the UI">Design</button>
        </div>
        <input id="fileInput" type="file" multiple hidden />
        <textarea id="input" class="input" rows="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Paste an error, stack trace, code, or describe what you want built..."></textarea>
        <button id="send" class="send" type="submit">Send</button>
        <div id="composerMeta" class="composerMeta">Agent on · no context attached</div>
      </form>
    </div>
    <script nonce="${n}" src="${scriptUri}"></script>
  </body>
</html>`;
}
