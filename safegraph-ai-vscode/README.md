# Safegraph AI

Safegraph AI is a VS Code coding agent extension built for Bedrock-backed autonomous development workflows. It combines sidebar chat, repository context, live diff application, terminal verification, task memory, and evidence reporting inside the editor.

Current release: `v0.13.0`

## What It Does

- Understands the active workspace, active file, selected text, tagged files, diagnostics, git state, and recent task history.
- Applies model-generated unified diffs directly to the workspace with preflight validation and automatic repair attempts.
- Runs safe build/test/typecheck/lint commands and feeds the result back into the agent loop.
- Keeps persistent task state so follow-up turns continue the same work instead of starting from scratch.
- Builds compact repository context with local RAG and symbol-aware chunks when the task needs codebase context.
- Supports local tools for targeted inspection:
  - `safegraph__read_file`
  - `safegraph__search_files`
  - `safegraph__list_files`
  - `safegraph__run_verification`
- Produces an evidence report when a task completes, including changed files, commands run, verification status, and remaining risk.
- Shows the current Safegraph task state in the VS Code status bar for quick visibility.

## Current AI Capabilities

Safegraph AI v0.13.0 is no longer just a chat panel. It now behaves more like a task-oriented coding agent:

- **Task planner state**: tracks goal, plan steps, files changed, commands executed, verification pass/fail, and open errors.
- **Rolling memory**: compresses previous turns into stable memory so the model can remember decisions without resending large chat history.
- **Context cache per task**: avoids rebuilding and resending the same large context during repeated fix/verify loops.
- **Command feedback loop**: approved terminal commands automatically return their output to the agent for the next reasoning step.
- **Lightweight subagent notes**: deterministic `context-scout`, `reviewer`, and `test-fixer` notes help the main agent focus on relevant files, risks, and failing verification.
- **Token-aware context loading**: repository RAG, web research, active file snapshots, and attachments are size-limited and only expanded when needed.

## What Is Better Now

Compared with a basic AI chat extension, Safegraph AI v0.13.0 is stronger in these areas:

- **Continuity**: it remembers the active task and does not treat every follow-up as a new question.
- **Verification discipline**: it records commands and pass/fail results instead of only suggesting tests.
- **Workspace grounding**: it can read, search, list files, inspect context, apply diffs, and verify results in the actual project.
- **Lower token waste**: it caches task context, compacts memory, truncates large attachments, and avoids full repository RAG unless the request needs it.
- **Evidence-first completion**: final output is backed by changed files, executed commands, verification status, and remaining risk.
- **Vector RAG path**: the project now has an optional provider scaffold for future turbovec-style semantic retrieval, aimed at faster repo understanding with fewer prompt tokens.
- **Visible agent lane**: active task state, verification, and open errors are surfaced in the VS Code status bar without exposing an unsafe eval bridge.

The practical advantage is that Safegraph AI can now handle multi-step code changes with a tighter edit-test-fix loop, while keeping the prompt smaller and more relevant.

## Honest Limits

Safegraph AI is improving toward agent-first IDE behavior, but it is not yet equivalent to large commercial agent platforms in every dimension.

Current limits:

- Model quality depends on the configured Bedrock model.
- Tooling is workspace-focused; there is no full browser automation sandbox.
- Local tools are intentionally conservative and output-limited.
- Subagent notes are lightweight deterministic summaries, not separate model workers.
- The extension is not bundled yet, so the VSIX is large.
- Semantic vector RAG is scaffolded but disabled by default; a turbovec sidecar/provider is planned rather than bundled as a native dependency today.

## Installation

Install the packaged VSIX:

```sh
code --install-extension safegraph-ai-0.13.0.vsix --force
```

Verify installation:

```sh
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.13.0
```

## Configuration

Set the Bedrock API key from the command palette:

```text
Safegraph AI: Set Bedrock API Key
```

Or provide a workspace `.env` key:

```text
AWS_BEARER_TOKEN_BEDROCK=...
```

Important settings:

- `safegraph.region`
- `safegraph.modelId`
- `safegraph.autoRun`
- `safegraph.repositoryRag.enabled`
- `safegraph.repositoryRag.maxFiles`
- `safegraph.repositoryRag.maxChunks`
- `safegraph.repositoryRag.maxChars`
- `safegraph.agent.maxFixLoops`

## Using The Chat

- Open the Safegraph AI sidebar from the Activity Bar.
- Attach files or active selections for precise context.
- Use `@Repository` when you explicitly want broad codebase context.
- Toggle Agent mode for autonomous apply/run/repair workflows.
- Review live-applied change sets and choose whether to keep or discard them.

## Dock To Right

VS Code does not let extensions force a view to always appear on the right automatically. You can move it once and VS Code will remember the layout:

- Click `Dock Right` in the chat header, then pick `Secondary Side Bar` in the Move View UI.
- Or right-click the Safegraph AI icon in the Activity Bar and choose `Move View to Secondary Side Bar`.

## Development

```sh
npm i
npm run typecheck
npm run build
npm run package
```

Launch an Extension Development Host:

1. Open `safegraph-ai-vscode` in VS Code.
2. Press `F5`.

## v0.13.0 Highlights

- Persistent task planner state.
- Rolling long-lived memory.
- Context cache per task.
- Local tool layer for file/search/list/verification.
- Lightweight subagent notes.
- Automatic evidence reports.
- Reduced token usage across repository context, attachments, web research, and conversation history.
