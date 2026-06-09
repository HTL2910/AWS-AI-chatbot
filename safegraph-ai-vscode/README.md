# Safegraph AI

Safegraph AI is a multi-agent AI development platform built for Bedrock-backed autonomous development workflows. It combines sidebar chat, repository context, live diff application, terminal verification, task memory, artifact verification, and project-wide refactoring inside the editor.

Current release: `v0.16.0`

## What It Does

- **Multi-Agent Orchestration**: Coordinate specialized agents (Planner, Coder, Tester, Reviewer, Debugger, Architect) for complex tasks
- **Artifact-Based Verification**: Generate tangible deliverables (task lists, implementation plans, test reports, code reviews) for verification
- **Asynchronous Task Execution**: Run long-running tasks in the background with progress tracking
- **AI-Powered Inline Completion**: Context-aware code suggestions powered by Bedrock
- **Multi-File Editing**: Project-wide refactoring with dependency analysis and conflict resolution
- **Repository Context**: Understands the active workspace, active file, selected text, tagged files, diagnostics, git state, and recent task history
- **Live Diff Application**: Applies model-generated unified diffs directly to the workspace with preflight validation and automatic repair attempts
- **Safe Command Execution**: Runs safe build/test/typecheck/lint commands and feeds the result back into the agent loop
- **Persistent Task State**: Keeps persistent task state so follow-up turns continue the same work instead of starting from scratch
- **Compact Repository Context**: Builds compact repository context with local RAG and symbol-aware chunks when the task needs codebase context
- **Local Tools**: Supports local tools for targeted inspection:
  - `safegraph__read_file`
  - `safegraph__search_files`
  - `safegraph__list_files`
  - `safegraph__run_verification`
- **Evidence Reports**: Produces an evidence report when a task completes, including changed files, commands run, verification status, and remaining risk
- **Status Bar Integration**: Shows the current Safegraph task state in the VS Code status bar for quick visibility

## New in v0.16.0

### Multi-Agent System
- **Agent Manager**: Orchestrate multiple specialized agents working in parallel
- **Agent Types**: Planner, Coder, Tester, Reviewer, Debugger, Architect
- **Inter-Agent Communication**: Agents can coordinate and share information
- **Persistent Agent State**: Agent states are persisted across sessions

### Artifact Verification
- **Artifact Generation**: Auto-generate task lists, implementation plans, test reports, code reviews
- **Artifact Store**: Persistent storage for all artifacts
- **Artifact Verification**: Verify agent work through tangible deliverables
- **User Feedback**: Add feedback directly on artifacts for agent improvement

### Asynchronous Execution
- **Task Queue**: Background task queue for long-running operations
- **Task Scheduler**: Schedule immediate, delayed, or recurring tasks
- **Progress Tracking**: Real-time progress tracking with status bar updates
- **Notification Manager**: Smart notifications for task completion and events

### Enhanced Coding Experience
- **Inline AI Completion**: Context-aware code suggestions powered by Bedrock
- **Multi-Line Completion**: Generate multi-line code completions
- **Context Analysis**: Deep understanding of code context for better suggestions

### Multi-File Editing
- **Dependency Graph**: Analyze file dependencies for safe refactoring
- **Symbol Renamer**: Rename symbols across multiple files
- **Conflict Resolver**: Detect and resolve edit conflicts
- **Batch Operations**: Apply operations across multiple files at once

## Current AI Capabilities

Safegraph AI v0.16.0 is a full-featured autonomous AI development platform:

- **Multi-Agent Coordination**: Specialized agents work together on complex tasks
- **Artifact-First Verification**: Tangible deliverables for trust and validation
- **Background Task Execution**: Long-running tasks don't block your workflow
- **Intelligent Code Completion**: AI-powered suggestions based on deep context analysis
- **Project-Wide Refactoring**: Safe multi-file editing with dependency awareness
- **Task Planner State**: Tracks goal, plan steps, files changed, commands executed, verification pass/fail, and open errors
- **Rolling Memory**: Compresses previous turns into stable memory so the model can remember decisions without resending large chat history
- **Context Cache Per Task**: Avoids rebuilding and resending the same large context during repeated fix/verify loops
- **Command Feedback Loop**: Approved terminal commands automatically return their output to the agent for the next reasoning step
- **Lightweight Subagent Notes**: Deterministic `context-scout`, `reviewer`, and `test-fixer` notes help the main agent focus on relevant files, risks, and failing verification
- **Token-Aware Context Loading**: Repository RAG, web research, active file snapshots, and attachments are size-limited and only expanded when needed

## What Is Better Now

Compared with a basic AI chat extension, Safegraph AI v0.16.0 is stronger in these areas:

- **Multi-Agent Collaboration**: Multiple specialized agents work together on complex tasks
- **Artifact-Based Trust**: Tangible deliverables (plans, reports, reviews) for verification
- **Background Processing**: Long-running tasks don't block your workflow
- **Intelligent Completion**: Context-aware AI code suggestions
- **Project-Wide Safety**: Dependency-aware multi-file editing with conflict resolution
- **Continuity**: It remembers the active task and does not treat every follow-up as a new question
- **Verification Discipline**: It records commands and pass/fail results instead of only suggesting tests
- **Workspace Grounding**: It can read, search, list files, inspect context, apply diffs, and verify results in the actual project
- **Lower Token Waste**: It caches task context, compacts memory, truncates large attachments, and avoids full repository RAG unless the request needs it
- **Evidence-First Completion**: Final output is backed by changed files, executed commands, verification status, and remaining risk
- **Visible Agent Lane**: Active task state, verification, and open errors are surfaced in the VS Code status bar without exposing an unsafe eval bridge

The practical advantage is that Safegraph AI can now handle complex, multi-step development tasks with multiple agents working in parallel, while keeping you informed through artifacts and progress tracking.

## Honest Limits

Safegraph AI is improving toward agent-first IDE behavior, but it is not yet equivalent to large commercial agent platforms in every dimension.

Current limits:

- Model quality depends on the configured Bedrock model.
- Tooling is workspace-focused; there is no full browser automation sandbox.
- Local tools are intentionally conservative and output-limited.
- Subagent notes are lightweight deterministic summaries, not separate model workers.
- The extension is not bundled yet, so the VSIX is large.
- Semantic vector RAG is scaffolded but disabled by default; a turbovec sidecar/provider is planned rather than bundled as a native dependency today.

## Cost And Security Notes

Safegraph AI calls Amazon Bedrock. Usage can create AWS costs depending on the configured model, token volume, and request count.

Recommended before serious use:

- Enable AWS billing alerts or Cost and Usage monitoring.
- Use the smallest model that is good enough for routine tasks.
- Keep repository RAG limits conservative for large workspaces.
- Review generated diffs before keeping applied changes.
- Keep `safegraph.autoRun` at `safe` or `ask` for sensitive repositories.
- Never place long-lived secrets in prompts, attachments, generated code, or terminal output.

Safegraph AI does not expose a public ALB or external HTTP endpoint by default. Bedrock credentials are stored in VS Code SecretStorage or loaded from local `.env`. Local tools are workspace-scoped and command execution is filtered through Safegraph's command policy.

## Comparison: Bedrock-Coder

Safegraph AI is similar to [Bedrock-Coder](https://github.com/iankohhh/Bedrock-Coder) in that both are VS Code developer tools using Amazon Bedrock. The product direction is different:

| Area | Bedrock-Coder | Safegraph AI |
|---|---|---|
| Primary workflow | Generate code from a description | Stateful coding agent loop |
| Bedrock access | CloudFormation backend with ALB endpoint | Direct Bedrock Runtime integration from the extension |
| Code output | User copies generated code into files | Safegraph validates and applies diffs to the workspace |
| Context | Description plus optional image attachment | Active file, selection, tagged files, diagnostics, git state, repository RAG, task memory |
| Agent memory | Not highlighted in README | Rolling memory plus persistent task state |
| Verification | Not highlighted in README | Safe build/test/typecheck/lint runner with evidence report |
| Security concern | Public ALB default warning in README | No public ALB by default; local secrets and command policy |

What Safegraph learns from Bedrock-Coder:

- Make AWS cost warnings visible.
- Make security posture explicit.
- Consider image/diagram input as a stronger product workflow later.

## Installation

Install the packaged VSIX:

```sh
code --install-extension safegraph-ai-0.16.0.vsix --force
```

Verify installation:

```sh
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.16.0
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
- `safegraph.vectorRag.enabled`
- `safegraph.vectorRag.provider`
- `safegraph.agent.maxFixLoops`
- `safegraph.agent.enabled` (new)
- `safegraph.agent.maxConcurrent` (new)
- `safegraph.artifact.autoGenerate` (new)
- `safegraph.completion.enabled` (new)
- `safegraph.completion.triggerMode` (new)
- `safegraph.multifile.dependencyAnalysis` (new)
- `safegraph.agent.maxFixLoops`

## Using The Chat

- Open the Safegraph AI sidebar from the Activity Bar.
- Attach files or active selections for precise context.
- Use `@Repository` when you explicitly want broad codebase context.
- Toggle Agent mode for autonomous apply/run/repair workflows.
- Review live-applied change sets and choose whether to keep or discard them.
- Use the Agent Manager to coordinate multiple specialized agents.
- View Artifacts to verify agent work through tangible deliverables.

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

## v0.16.0 Highlights

- Multi-agent orchestration system with specialized agent types
- Artifact generation and verification for trust and validation
- Asynchronous task execution with progress tracking
- AI-powered inline code completion with context awareness
- Multi-file editing with dependency analysis and conflict resolution
- Enhanced task coordination and background processing
- New views: Agent Manager and Artifact Viewer
- Improved configuration options for fine-grained control
