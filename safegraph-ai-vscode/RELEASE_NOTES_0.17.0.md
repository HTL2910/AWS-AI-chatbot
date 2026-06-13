# SafeGraph AI v0.17.0 Release Notes

**Release date:** 2026-06-14  
**Package:** `safegraph-ai-0.17.0.vsix`  
**Status:** Packaged and installable

## Overview

SafeGraph AI v0.17.0 improves the extension from a read-heavy coding assistant into a stronger local-first coding agent. This release wires inline completion, adds direct file editing through a safe local tool, improves tool-loop control, persists tool evidence across turns, and makes applied changes easier to review.

## Highlights

### Inline AI Completion

- Registered the VS Code inline completion provider so ghost-text suggestions actually run.
- Added fill-in-the-middle prompting using code before and after the cursor.
- Added manual and automatic completion modes.
- Added commands:
  - `Safegraph AI: Toggle Inline Completion`
  - `Safegraph AI: Trigger Inline Completion`
- Added completion settings:
  - `safegraph.completion.enabled`
  - `safegraph.completion.triggerMode`
  - `safegraph.completion.modelId`
  - `safegraph.completion.maxTokens`
  - `safegraph.completion.debounceMs`
  - `safegraph.completion.multiline`

### Direct File Editing Tool

- Added `safegraph__apply_unified_diff`, a local tool that lets the agent edit workspace files directly after reading enough context.
- Unified diff application now goes through the existing safe apply pipeline:
  - preflight validation
  - stale hunk auto-repair when possible
  - file snapshots before modification
  - workspace apply
  - keep/discard change set review
- Tool-loop budgeting separates inspection from mutation, so the agent can complete a full read -> edit -> verify cycle without consuming inspection budget on apply/verification steps.

### Tool Loop Control

- Added a stricter inspection budget to prevent repeated `read_file`, `search_files`, and `list_files` calls without producing an answer.
- After the inspection budget is reached, SafeGraph AI enters final synthesis mode.
- Final synthesis disables further tool calls and forces the agent to summarize from collected evidence.
- If the model still fails to answer, the extension returns a fallback summary instead of leaving the UI stuck on tool cards.

### Persistent Tool Evidence Memory

- Added compact per-task tool evidence memory.
- Stored evidence includes:
  - tool name
  - tool input, such as path or search query
  - short result summary
  - compact evidence excerpt
  - timestamp
- Previous tool evidence is injected into future prompts for the same task, reducing repeated file reads.
- Same-task detection now also considers recent tool evidence.

### Task History Improvements

- Added `tool` action support in the history system.
- Tool evidence is logged through `HistoryManager` alongside existing `diff`, `command`, `file_create`, and `file_delete` actions.
- Added regression coverage for tool evidence history logging.

### Applied Change Summaries

- Applied change sets now include clearer summaries:
  - number of changed files
  - total added/removed lines
  - per-file create/update/delete status
  - per-file `+n / -n` counts
- Tool result output now includes a concise change report so the agent can explain what was modified.

### Webview Drag/Drop Fixes

- Removed noisy `Drop empty...` debug messages from chat.
- Empty drag/drop payloads such as `"."`, `"./"`, and `file://.` are ignored.
- Added parsing for VS Code webview MIME types:
  - `application/vnd.code.uri-list`
  - `resourceurls`
  - `codeeditors`

## Verification

The release was verified with:

```sh
npm run typecheck
npm run test:ci
npm run package
```

Expected package:

```text
safegraph-ai-vscode/safegraph-ai-0.17.0.vsix
```

## Install

```sh
code --install-extension safegraph-ai-vscode/safegraph-ai-0.17.0.vsix --force
```

Reload VS Code after installing so the new webview and extension host code are active.

## Known Limits

- Runtime coverage is still low; most tests currently cover history utilities and text parsing rather than the full VS Code extension activation path.
- The VSIX is not bundled and includes many files. Future releases should add bundling and `.vscodeignore` cleanup.
- Semantic vector RAG remains scaffolded/planned rather than enabled by default.
