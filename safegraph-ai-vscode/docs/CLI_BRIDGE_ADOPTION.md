# VS Code CLI Bridge Adoption Notes

Source reviewed:

- <https://github.com/yemreak/vscode-cli-bridge>
- <https://docs.yemreak.com/terminal-cli-otomasyonlari/vscode-extension-ai-debug>

## Summary

`vscode-cli-bridge` exposes a pattern where an external CLI can call into the VS Code extension host, often through an eval-style command. The main value is a very fast feedback loop for extension development:

```text
agent writes code -> vscode-cli eval -> VS Code API runs immediately -> agent reads result -> fixes
```

This is useful for testing VS Code extension behavior without repeatedly packaging, reinstalling, or reloading the extension.

## Does Safegraph AI Need It?

Not as a broad user-facing feature right now.

Safegraph already runs inside VS Code, so it can access VS Code APIs directly through the extension host. Adding a generic external eval bridge would duplicate that access path and introduce a large security surface.

The useful ideas to adopt are:

- visible agent status lanes in VS Code UI;
- fast feedback loops for extension development;
- a narrow, allowlisted bridge for safe operations only;
- no arbitrary eval by default.

## What We Adopted Now

Safegraph AI now exposes a status bar task lane:

- current task state;
- current or failed step;
- files changed count;
- commands run count;
- latest verification status;
- open error summary.

This gives the same practical visibility benefit as the bridge article's status bar lane idea, without exposing arbitrary code execution.

## What Not To Add Yet

Do not add an unrestricted `eval` bridge.

Risks:

- arbitrary VS Code API execution;
- secret exfiltration from extension context or workspace;
- unexpected command execution;
- persistent state mutation outside the normal Safegraph audit path;
- hard-to-review external automation surface.

## Safe Future Design

If a CLI bridge becomes necessary, implement it as a small localhost-only bridge with explicit allowlisted operations:

```text
safegraph-cli status
safegraph-cli open-chat
safegraph-cli task-state
safegraph-cli run-verification <safe command>
safegraph-cli read-file <workspace-relative path>
safegraph-cli search <query>
```

Do not expose:

```text
safegraph-cli eval
safegraph-cli execute-vscode-api
safegraph-cli run-arbitrary-command
```

Recommended controls:

- bind only to `127.0.0.1`;
- require a random per-session token;
- log every bridge request to the Safegraph output channel;
- reuse existing command policy for terminal execution;
- restrict file access to workspace roots;
- return compact output to avoid token and IPC overload.

## Recommendation

Safegraph should keep the bridge pattern as a development and automation idea, not a default product surface. The status bar task lane is the right low-risk adoption now. A restricted CLI bridge can come later if external agents need to inspect Safegraph task state or trigger safe verification without opening the chat UI.
