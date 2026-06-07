# SafeGraph AI

**A Bedrock-powered VS Code coding agent that understands your repository, applies real code changes, runs verification, remembers task state, and reports evidence.**

SafeGraph AI turns VS Code into a local-first AI coding workspace for developers who want more than a chatbot. It is designed for multi-step engineering work: understand the repo, plan the task, edit files, run safe checks, fix failures, and summarize what actually changed.

Current extension version: `0.15.0`

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
| Code editing | Generates unified diffs, validates them, applies them to the workspace, and supports keep/discard review | Strong |
| Verification loop | Runs safe build/test/typecheck/lint commands and feeds output back into the agent | Strong |
| Tool use | Local tools: `read_file`, `search_files`, `list_files`, `run_verification` | Strong |
| Diff review UI | Live applied changes, per-file review sections, copy diff, expand/collapse, keep/discard controls | Improving |
| Evidence reporting | Final task output includes files changed, commands run, pass/fail status, and remaining risk | Strong |
| Security posture | SecretStorage, local `.env`, workspace-scoped tools, command policy, no public ALB by default | Strong |
| Semantic vector RAG | Provider scaffold exists for future turbovec-style retrieval | Planned |
| Browser automation | Not included yet | Planned |
| True multi-agent workers | Lightweight deterministic notes today; separate model workers not included yet | Planned |

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

### Repository-Aware Context

SafeGraph AI uses local repository context and symbol-aware chunks to ground responses in the actual codebase. It also includes a context cache per task so repeated loops do not rebuild and resend the same context unnecessarily.

### Local Agent Tools

The agent can use local, workspace-scoped tools:

```text
safegraph__read_file
safegraph__search_files
safegraph__list_files
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
code --install-extension safegraph-ai-vscode/safegraph-ai-0.15.0.vsix --force
```

Verify:

```bash
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.15.0
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
