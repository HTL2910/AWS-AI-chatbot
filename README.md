# SafeGraph AI

**A Bedrock-powered VS Code coding agent that understands your repository, applies real code changes, runs verification, remembers task state, and reports evidence.**

SafeGraph AI turns VS Code into a local-first AI coding workspace for developers who want more than a chatbot. It is designed for multi-step engineering work: understand the repo, plan the task, edit files, run safe checks, fix failures, and summarize what actually changed.

Current extension version: `0.17.0`

Model: tuned for **Claude Haiku 4.5** on Amazon Bedrock (fast, low-cost, near-frontier coding).

## Why SafeGraph AI

Most AI coding assistants can answer questions. SafeGraph AI is built to **work inside the project**:

- It reads and searches workspace files.
- It builds compact repository context instead of dumping huge prompts.
- It applies validated diffs directly to the workspace.
- It runs safe verification commands.
- It remembers the task across follow-up turns.
- It gives an evidence report so you know what changed and what risk remains.

The goal is practical: **faster project understanding, fewer wasted tokens, better code changes, and a tighter edit-test-fix loop.**

## AI Capability Overview

| Capability | What SafeGraph AI Does | Current Level |
|---|---|---|
| Repository understanding | Uses active file, selection, tagged files, diagnostics, git state, file list, local RAG, and symbol-aware chunks | Strong |
| Task continuity | Tracks goal, plan steps, changed files, commands, verification, and open errors across turns | Strong |
| Token optimization | Uses rolling memory, context cache, selective RAG, attachment truncation, and compact web/docs bundles | Strong |
| Code editing | Generates unified diffs, validates them via `safegraph__apply_unified_diff`, applies to workspace with auto-repair, and supports keep/discard review | Strong |
| Inline completion | Claude Haiku 4.5 ghost-text completion with fill-in-the-middle context, debounce, and cancellation | Strong |
| Verification loop | Runs safe build/test/typecheck/lint commands and feeds output back into the agent | Strong |
| Tool use | Local tools: `read_file`, `search_files`, `list_files`, `apply_unified_diff`, `run_safe_command`, `run_verification` | Strong |
| Diff review UI | Live applied changes, per-file review sections, copy diff, expand/collapse, keep/discard controls | Improving |
| Evidence reporting | Final task output includes files changed, commands run, pass/fail status, and remaining risk | Strong |
| Security posture | SecretStorage, local `.env`, workspace-scoped tools, command policy, no public ALB by default | Strong |
| Semantic vector RAG | Provider scaffold exists for future turbovec-style retrieval | Planned |
| Browser automation | Not included yet | Planned |
| True multi-agent workers | Lightweight deterministic notes today; separate model workers not included yet | Planned |

## Recent Updates

### Direct File Editing Tool

**New local tool: `safegraph__apply_unified_diff`**

- Agent now applies focused unified diffs directly to workspace files after reading sufficient context.
- The tool validates diffs through a safe pipeline:
  - **Preflight check**: validates diff syntax and file paths before applying.
  - **Auto-repair**: automatically repairs stale hunks when possible (e.g., if file changed since diff was generated).
  - **Snapshot**: creates a backup of each file before modification.
  - **Change set**: generates a per-file review UI so you can keep or discard each change.
- After applying a diff, Safegraph AI records changed files in task state and recommends appropriate verification commands.
- **Tool loop budget now separates inspection from mutation**: the budget counts only `read_file`, `search_files`, and `list_files` calls. Calls to `apply_unified_diff` and `run_verification` do not consume the inspection budget, allowing a full read → edit → verify cycle without hitting limits.
- This enables the agent to work in tight loops: gather context, apply a focused fix, run a test, and iterate if needed.

### Tool Loop Control

**Stricter inspection budget to prevent tool call loops**

- Safegraph AI now enforces a strict budget on inspection tool calls (`read_file`, `search_files`, `list_files`).
- After a small number of inspection calls (typically 3–4 batches), the agent automatically enters **synthesis mode**.
- In synthesis mode, further tool calls are disabled and the agent must summarize findings from evidence already collected.
- If the model does not respond, Safegraph AI returns a fallback summary instead of leaving the UI stuck on tool tabs.
- **Benefit**: prevents repetitive file reads and forces the agent to make decisions with available evidence, reducing wasted tokens and improving response time.

### Persistent Tool Evidence Memory

**Tool evidence is now recorded and reused across turns**

- Safegraph AI records compact tool evidence for each active task.
- Evidence includes:
  - Tên công cụ
  - Đầu vào công cụ, ví dụ: đường dẫn tệp hoặc truy vấn tìm kiếm
  - Tóm tắt kết quả ngắn gọn
  - Đoạn trích bằng chứng nhỏ gọn
  - Dấu thời gian
- Previous evidence is inserted into follow-up prompts for the same task, helping the agent remember what it has already checked.
- This reduces repeated file reads and helps follow-up prompts continue from the previous investigation.

### Task History Improvements

**Tool evidence now integrated into task history**

- Added support for `tool` action entries in the task history system.
- Tool evidence is now logged via `HistoryManager` alongside existing diff, command, file create, and file delete actions.
- Added scope checks for logging tool evidence to task history.

### Better Agent Continuation

**Same-task detection now considers recent tool evidence**

- Same-task detection now also considers recent tool evidence, not just the initial goal, changed files, and errors.
- This makes short follow-up messages like "ok", "continue", or related follow-ups more likely to continue the task context correctly.

### User Experience Improvements

- Chat giờ đây hiển thị thông báo trạng thái tổng hợp khi Safegraph AI đã đọc đủ ngữ cảnh và chuẩn bị câu trả lời cuối cùng.
- Thay vì tiếp tục kiểm tra tệp một cách im lặng, agent giờ đây giải thích hoặc tóm tắt dựa trên ngữ cảnh đã thu thập.

## What It Can Do Today

- **Debug failing code**: inspect logs, find likely files, patch code, run verification, repair failures.
- **Implement features**: use repository context, update files, and verify the result.
- **Review code changes**: summarize files changed, risk, tests, and remaining issues.
- **Refactor safely**: keep edits scoped, preserve existing architecture, and run checks.
- **Understand a project faster**: combine active context, local RAG, task memory, and targeted search.
- **Reduce prompt waste**: avoid repeatedly sending the same repository context during a task.

## Key Features

### Stateful Coding Agent

SafeGraph AI keeps an active task state:

- goal
- request type
- plan steps
- current status
- files changed
- commands executed
- verification results
- open errors

This lets follow-up prompts like "fix tiếp", "run again", or "ok làm tiếp" continue the same task instead of starting over.

### Inline AI Completion (Ghost Text)

SafeGraph AI provides Cursor-style inline completion powered by Claude Haiku 4.5:

- fill-in-the-middle suggestions using code before and after the cursor
- single-line or multi-line completions (`safegraph.completion.multiline`)
- automatic (debounced) or manual trigger modes
- skips comments and strings, and cancels in-flight requests as you keep typing
- reuses the same Bedrock key/model resolution as chat and inline edit

Toggle it with `Safegraph AI: Toggle Inline Completion`, or request a suggestion on demand with `Safegraph AI: Trigger Inline Completion`.

### Repository-Aware Context

SafeGraph AI uses local repository context and symbol-aware chunks to ground responses in the actual codebase. It also includes a context cache per task so repeated loops do not rebuild and resend the same context unnecessarily.

### Local Agent Tools

The agent can use local, workspace-scoped tools:

```text
safegraph__read_file
safegraph__search_files
safegraph__list_files
safegraph__apply_unified_diff
safegraph__run_verification
```

These tools help the model inspect targeted evidence instead of guessing from broad context.

### Live Diff Application And Review

SafeGraph AI can apply diffs live, then show a review surface:

- file-level change list
- created/updated/deleted status
- added/removed line counts
- expandable per-file diff
- copy full diff
- keep changes
- discard changes

### Verification And Evidence

SafeGraph AI records commands and verification results. A completed task includes an evidence report:

- files changed
- commands run
- verification pass/fail
- remaining risk

## Install

Install the latest VSIX:

```bash
code --install-extension safegraph-ai-vscode/safegraph-ai-0.17.0.vsix --force
```

Verify:

```bash
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.17.0
```

## Configure Bedrock

Set the Bedrock API key from VS Code:

```text
Safegraph AI: Set Bedrock API Key
```

Or provide a local `.env`:

```env
AWS_BEARER_TOKEN_BEDROCK="bedrock-api-key-..."
ARN="arn:aws:bedrock:ap-southeast-1:ACCOUNT_ID:application-inference-profile/PROFILE_ID"
```

Do not commit real `.env` files or real API keys.

## Important Settings

| Setting | Purpose |
|---|---|
| `safegraph.region` | AWS Bedrock region |
| `safegraph.modelId` | Bedrock model id or inference profile ARN |
| `safegraph.autoRun` | Controls command auto-run: `off`, `safe`, `ask` |
| `safegraph.repositoryRag.enabled` | Enables local repository RAG |
| `safegraph.repositoryRag.maxFiles` | Max files indexed for repository RAG |
| `safegraph.repositoryRag.maxChunks` | Max chunks included in prompt |
| `safegraph.repositoryRag.maxChars` | Max RAG context characters |
| `safegraph.vectorRag.enabled` | Future semantic vector RAG toggle |
| `safegraph.vectorRag.provider` | Future provider such as `turbovec-sidecar` |
| `safegraph.agent.maxFixLoops` | Max autonomous repair loops |
| `safegraph.completion.enabled` | Enable Claude Haiku 4.5 inline (ghost text) completion |
| `safegraph.completion.triggerMode` | `automatic` or `manual` inline completion |
| `safegraph.completion.modelId` | Optional override model for completion (defaults to `safegraph.modelId`) |
| `safegraph.completion.maxTokens` | Max tokens per inline completion request |
| `safegraph.completion.debounceMs` | Debounce before automatic completion |
| `safegraph.completion.multiline` | Allow multi-line inline completions |

## Repository Layout

```text
.
├── safegraph-ai-vscode/       # Main VS Code extension source and packaged VSIX builds
├── chatbot-web/               # Flask web chatbot prototype using Bedrock API keys
├── src/                       # Streamlit app and credential setup scripts
├── docs/                      # Setup, credential, and usage notes
├── config/                    # Python requirements and env examples
├── examples/                  # Bedrock usage examples
└── README.md                  # This file
```

## SEO Keywords

SafeGraph AI is relevant for:

- AI coding agent
- VS Code AI extension
- Amazon Bedrock coding assistant
- Bedrock Claude VS Code extension
- local repository RAG
- AI code review
- AI pair programmer
- autonomous coding agent
- AI developer tooling
- token-efficient coding assistant
- repository-aware AI assistant
- VS Code agent workflow

## Comparison: SafeGraph AI vs Bedrock-Coder

SafeGraph AI is similar to [Bedrock-Coder](https://github.com/iankohhh/Bedrock-Coder) because both use Amazon Bedrock for developer workflows. The difference is product depth.

| Area | Bedrock-Coder | SafeGraph AI |
|---|---|---|
| Primary workflow | Generate code from a description | Stateful coding agent loop |
| Bedrock access | CloudFormation backend with ALB endpoint | Direct Bedrock Runtime integration from extension |
| Code output | User copies generated code into files | SafeGraph validates and applies diffs |
| Context | Description plus optional image attachment | Active file, selection, tagged files, diagnostics, git state, repository RAG, task memory |
| Memory | Not highlighted in README | Rolling memory plus persistent task state |
| Verification | Not highlighted in README | Safe build/test/typecheck/lint runner with evidence report |
| Security posture | Public ALB default warning | No public ALB by default; local secrets and command policy |

## Cost And Security

SafeGraph AI calls Amazon Bedrock. Usage can create AWS costs depending on model, token volume, and request count.

Recommended:

- Enable AWS billing alerts or Cost and Usage monitoring.
- Use conservative repository RAG limits for large workspaces.
- Review generated diffs before keeping applied changes.
- Keep command auto-run at `safe` or `ask` for sensitive repositories.
- Never place long-lived secrets in prompts, attachments, generated code, or terminal output.

SafeGraph AI does not expose a public ALB or external HTTP endpoint by default. Credentials are stored in VS Code SecretStorage or loaded locally. Local tools are workspace-scoped and terminal execution is filtered through command policy.

## Current Limits

SafeGraph AI is not claiming to match the largest commercial agent IDEs yet.

Current limits:

- Model quality depends on the configured Bedrock model.
- Browser automation is not included yet.
- Vector RAG is scaffolded but not fully implemented.
- Subagent notes are deterministic today, not separate model workers.
- The extension is not bundled yet, so the VSIX is still large.

## Roadmap

- Optional turbovec-style semantic vector RAG sidecar.
- Stronger image/diagram input workflow.
- Browser/app testing support.
- More advanced IDE-grade diff review.
- True multi-agent workers for reviewer, test-fixer, and context-scout.
- Extension bundling to reduce VSIX size.

## Develop

```bash
cd safegraph-ai-vscode
npm install
npm run typecheck
npm run build
```

Package a new VSIX:

```bash
cd safegraph-ai-vscode
npm run package
```

## Useful Docs

- [VS Code extension README](safegraph-ai-vscode/README.md)
- [Turbovec adoption notes](safegraph-ai-vscode/docs/TURBOVEC_ADOPTION.md)
- [CLI bridge adoption notes](safegraph-ai-vscode/docs/CLI_BRIDGE_ADOPTION.md)
- [Renew API key guide](docs/RENEW_API_KEY.md)
- [AWS credential guide](docs/CREDENTIALS_GUIDE.md)

## License

See [LICENSE](LICENSE).
