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
          <button id="agentMode" class="topbarBtn agentToggle" type="button" title="Toggle autonomous apply/run behavior">
             <span class="statusDot"></span> Agent On
          </button>
          <button id="setKey" class="topbarBtn" type="button" title="Save Bedrock API key">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
          </button>
          <button id="checkKey" class="topbarBtn" type="button" title="Check where Safegraph reads the Bedrock API key from">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <button id="openLog" class="topbarBtn" type="button" title="Open Safegraph AI output log">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          </button>
          <button id="openHistory" class="topbarBtn" type="button" title="Open task history">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l3 2"></path></svg>
          </button>
          <button id="moveRight" class="topbarBtn" type="button" title="Move Safegraph AI to the right sidebar">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="15" y1="3" x2="15" y2="21"></line></svg>
          </button>
          <button id="newChat" class="topbarBtn" type="button" title="Start a new chat">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          </button>
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
          <button id="attachFile" class="toolBtn" type="button" title="Attach local files">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> Attach
          </button>
          <button id="reviewWorkspace" class="toolBtn" type="button" title="Review the current workspace">Review</button>
          <button id="fixDiagnostics" class="toolBtn" type="button" title="Fix diagnostics and errors">Fix</button>
          <button id="designMockup" class="toolBtn" type="button" title="Analyze requirements, design a mockup, and implement the UI">Design</button>
        </div>
        <input id="fileInput" type="file" multiple hidden />
        <div class="inputWrapper">
          <textarea id="input" class="input" rows="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Ask Safegraph AI..."></textarea>
          <button id="send" class="send" type="submit">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
        <div id="composerMeta" class="composerMeta">Agent on · no context attached</div>
      </form>
    </div>
    <script nonce="${n}" src="${scriptUri}"></script>
  </body>
</html>`;
}
