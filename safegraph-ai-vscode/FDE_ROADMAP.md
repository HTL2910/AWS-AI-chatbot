# SafeGraph AI VS Code Extension - FDE Roadmap v0.8.2

## Mục tiêu: Full Development Environment (FDE) trong VS Code

Biến SafeGraph AI thành một **autonomous development environment** với:
- ✅ Tool API typed (thay vì text-based)
- ✅ Task Planner bắt buộc (plan, actions, verification, final summary)
- ✅ Mode system (Code, Web Research, Docs, Debug, UI Design, Review)
- ✅ Strong context resolver (target folder, active repo, tagged folder, web docs)
- ✅ Apply engine với transaction/rollback
- ✅ Approval/audit log
- ✅ Test harness cho edge cases

---

## Phase 1: Foundation (v0.8.2 - Current)

### 1.1 Tool API Typed System
**Mục đích:** Thay thế text-based chat bằng structured tool calls

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/types/ToolAPI.ts` | 0 (NEW) | 150 | Định nghĩa Tool interface, ToolCall, ToolResult |
| `src/tools/ToolRegistry.ts` | 0 (NEW) | 200 | Registry pattern cho tools, validation |
| `src/tools/CodeAnalyzer.ts` | 0 (NEW) | 250 | Tool: analyze code, suggest refactor |
| `src/tools/FileManager.ts` | 0 (NEW) | 180 | Tool: create, edit, delete files |
| `src/tools/TerminalExecutor.ts` | 0 (NEW) | 200 | Tool: run commands, capture output |
| `src/tools/WebResearch.ts` | 0 (NEW) | 220 | Tool: fetch URLs, parse docs |
| `src/chat/ChatViewProvider.ts` | 450 | 550 | Integrate Tool API, handle ToolCall |
| `src/extension.ts` | 120 | 150 | Register tools, initialize ToolRegistry |

**Subtotal Phase 1.1:** 8 files, ~1,550 dòng mới

### 1.2 Task Planner Engine
**Mục đích:** Bắt buộc plan → actions → verification → summary structure

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/types/TaskPlanner.ts` | 0 (NEW) | 120 | TaskPlan, ActionStep, VerificationStep interfaces |
| `src/planner/TaskPlanner.ts` | 0 (NEW) | 300 | Parse user request → structured plan |
| `src/planner/ActionExecutor.ts` | 0 (NEW) | 250 | Execute actions sequentially, track state |
| `src/planner/VerificationEngine.ts` | 0 (NEW) | 200 | Run verification steps, validate results |
| `src/chat/ChatViewProvider.ts` | 550 | 650 | Integrate TaskPlanner, display plan/actions/verification |

**Subtotal Phase 1.2:** 5 files, ~1,070 dòng mới

### 1.3 Mode System
**Mục đích:** Context-aware modes (Code, Web Research, Docs, Debug, UI Design, Review)

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/types/Mode.ts` | 0 (NEW) | 80 | Mode enum, ModeConfig interface |
| `src/modes/ModeManager.ts` | 0 (NEW) | 200 | Detect mode from context, switch modes |
| `src/modes/CodeMode.ts` | 0 (NEW) | 180 | Code analysis, refactor, testing tools |
| `src/modes/WebResearchMode.ts` | 0 (NEW) | 200 | Web fetch, parse, synthesize docs |
| `src/modes/DocsMode.ts` | 0 (NEW) | 150 | Generate README, API docs, guides |
| `src/modes/DebugMode.ts` | 0 (NEW) | 180 | Error analysis, breakpoint, trace |
| `src/modes/UIDesignMode.ts` | 0 (NEW) | 200 | UI mockup, component generation |
| `src/modes/ReviewMode.ts` | 0 (NEW) | 150 | Code review, security audit, performance |
| `src/chat/ChatViewProvider.ts` | 650 | 750 | Integrate ModeManager, display mode indicator |

**Subtotal Phase 1.3:** 9 files, ~1,340 dòng mới

### 1.4 Strong Context Resolver
**Mục đích:** Detect target folder, active repo, tagged folder, web docs bundle

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/types/Context.ts` | 0 (NEW) | 100 | ContextInfo, TargetFolder, RepoInfo interfaces |
| `src/context/ContextResolver.ts` | 0 (NEW) | 350 | Detect workspace, target folder, git repo, tags |
| `src/context/WebDocsBundler.ts` | 0 (NEW) | 280 | Fetch seed URL + related pages, cache |
| `src/context/FileIndexer.ts` | 0 (NEW) | 200 | Index project files, build semantic tree |
| `src/chat/ChatViewProvider.ts` | 750 | 850 | Display context info, allow folder tagging |

**Subtotal Phase 1.4:** 5 files, ~930 dòng mới

### 1.5 Apply Engine with Transaction/Rollback
**Mục đích:** Safe file operations với undo capability

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/types/Transaction.ts` | 0 (NEW) | 100 | Transaction, Operation, Rollback interfaces |
| `src/apply/TransactionEngine.ts` | 0 (NEW) | 300 | Begin, commit, rollback transactions |
| `src/apply/DiffApplier.ts` | 0 (NEW) | 250 | Parse unified diff, apply with validation |
| `src/apply/FileBackup.ts` | 0 (NEW) | 150 | Backup files before changes, restore on rollback |
| `src/apply/ApplyUI.ts` | 0 (NEW) | 200 | Show diff preview, approve/reject, rollback UI |
| `src/chat/ChatViewProvider.ts` | 850 | 950 | Integrate ApplyUI, show transaction status |

**Subtotal Phase 1.5:** 6 files, ~1,000 dòng mới

### 1.6 Approval/Audit Log
**Mục đích:** Track every action, approval, and result

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/types/AuditLog.ts` | 0 (NEW) | 80 | AuditEntry, ActionLog interfaces |
| `src/audit/AuditLogger.ts` | 0 (NEW) | 200 | Log actions, approvals, results to file |
| `src/audit/AuditViewer.ts` | 0 (NEW) | 180 | Display audit log in sidebar panel |
| `src/extension.ts` | 150 | 180 | Initialize AuditLogger, register audit commands |

**Subtotal Phase 1.6:** 4 files, ~460 dòng mới

### 1.7 Test Harness
**Mục đích:** Validate edge cases (non-git repo, new files, folder tags, web docs, screenshots)

**Files thay đổi:**
| File | Dòng hiện tại | Dòng mới | Thay đổi |
|------|---------------|---------|---------|
| `src/__tests__/ContextResolver.test.ts` | 0 (NEW) | 200 | Test non-git repo, folder tagging, web docs |
| `src/__tests__/ApplyEngine.test.ts` | 0 (NEW) | 250 | Test diff apply, rollback, transaction |
| `src/__tests__/TaskPlanner.test.ts` | 0 (NEW) | 180 | Test plan generation, action execution |
| `src/__tests__/ModeDetection.test.ts` | 0 (NEW) | 150 | Test mode detection from context |
| `src/__tests__/ToolRegistry.test.ts` | 0 (NEW) | 120 | Test tool registration, validation |

**Subtotal Phase 1.7:** 5 files, ~900 dòng mới

---

## Summary: v0.8.2 Changes

**Total Files Changed:** 42 files
- **New files:** 37
- **Modified files:** 5 (ChatViewProvider.ts, extension.ts, package.json, README.md, CHANGELOG.md)

**Total Lines Added:** ~7,250 dòng

**Key Metrics:**
- Tool API: 1,550 dòng
- Task Planner: 1,070 dòng
- Mode System: 1,340 dòng
- Context Resolver: 930 dòng
- Apply Engine: 1,000 dòng
- Audit Log: 460 dòng
- Tests: 900 dòng

**Installation:** After changes, run:

