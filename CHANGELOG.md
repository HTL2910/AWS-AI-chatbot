# Changelog

## [0.17.0] - 2026-06-10

### Added
- **Inline AI Completion (ghost text)** — registered a VS Code `InlineCompletionItemProvider`
  (previously implemented but never wired up), giving Cursor-style suggestions.
- Fill-in-the-middle prompting that uses code before **and** after the cursor.
- New commands: `Safegraph AI: Toggle Inline Completion`, `Safegraph AI: Trigger Inline Completion`.
- New settings: `safegraph.completion.modelId`, `safegraph.completion.maxTokens`,
  `safegraph.completion.debounceMs`, `safegraph.completion.multiline`.
- Shared `src/config/bedrock.ts` with `resolveBedrockApiKey`, `getBedrockModelConfig`,
  and `getCompletionConfig` so chat, inline edit, and completion resolve the key/model the same way.
- `stopSequences` and `topP` support in the Bedrock client.
- **Direct file editing tool** — added `safegraph__apply_unified_diff` so the agent can apply focused unified diffs directly through local tool use.
- Safe diff apply pipeline with preflight validation, stale hunk auto-repair, file snapshots, and keep/discard change sets.
- Persistent tool evidence memory for active tasks, including tool name, input, compact result summary, evidence excerpt, and timestamp.
- `tool` action entries in task history, allowing tool evidence to be logged alongside diff, command, file create, and file delete actions.
- Rich applied-change summaries with file count, added/removed line counts, and per-file create/update/delete details.

### Changed
- **Tuned for Claude Haiku 4.5**: low-temperature, token-capped completion requests with
  stop sequences and a concise, directive system prompt.
- Completion now resolves the Bedrock API key from SecretStorage/`.env` (previously read a
  non-existent `safegraph.bedrockApiKey` setting and never produced suggestions).
- Inline edit reuses the shared key/model helpers instead of duplicating the logic.
- Bumped Bedrock client `User-Agent` to `safegraph-ai-vscode/0.17.0`.
- Tool loop budget now counts only inspection tools (`read_file`, `search_files`, `list_files`, `run_safe_command`), not mutation or verification tools.
- Follow-up task detection now considers recent tool evidence, improving continuity for short prompts such as "ok", "tiếp", and "fix it".
- README now documents recent agent-loop, tool-memory, and direct-editing capabilities.

### Fixed
- Inline completion never ran because the provider was never registered and could not
  obtain an API key.
- Prevented repeated file inspection loops by forcing final synthesis after the inspection budget is reached.
- Added fallback summaries when the model fails to produce a final answer after tool use.
- Fixed noisy `Drop empty...` debug errors in the webview when VS Code sends an empty or `"."` drag/drop payload.
- Improved drag/drop URI parsing for VS Code webview MIME types such as `application/vnd.code.uri-list`, `resourceurls`, and `codeeditors`.

## [0.11.3] - 2025-05-31

### Changed
- **Code Cleanup** - Removed obsolete `safegraph-ai-vscode/` folder with old extension files
- **Documentation Cleanup** - Removed outdated markdown files (CHECKLIST.md, CLEANUP_GUIDE.md, PROJECT_INFO.md, RELEASE_NOTES_0.11.0.md)
- **Docs Reorganization** - Cleaned up `docs/` folder, removed redundant documentation (PHASE_2_IMPLEMENTATION.md, FINAL_SUMMARY.md, AUTONOMOUS_DELIVERY_ARCHITECTURE.md, etc.)
- **Project Structure** - Streamlined project structure for better maintainability

### Fixed
- Removed duplicate and stale documentation files
- Cleaned up git history tracking

### Phase
- Phase 4: Code Cleanup & Refactor (v0.11.3)

## [0.11.2] - 2025-05-30

### Changed
- Minor bug fixes and stability improvements
- Updated dependencies

## [0.11.1] - 2025-05-29

### Changed
- Internal refactoring and code optimization
- Improved error handling in deployment modules

### Fixed
- Fixed edge cases in canary monitoring
- Improved health check reliability

## [0.11.3] - 2025-05-31

### Changed
- **Code Cleanup** - Removed obsolete `safegraph-ai-vscode/` folder with old extension files
- **Documentation Cleanup** - Removed outdated markdown files (CHECKLIST.md, CLEANUP_GUIDE.md, PROJECT_INFO.md, RELEASE_NOTES_0.11.0.md)
- **Docs Reorganization** - Cleaned up `docs/` folder, removed redundant documentation (PHASE_2_IMPLEMENTATION.md, FINAL_SUMMARY.md, AUTONOMOUS_DELIVERY_ARCHITECTURE.md, etc.)
- **Project Structure** - Streamlined project structure for better maintainability

### Fixed
- Removed duplicate and stale documentation files
- Cleaned up git history tracking

### Phase
- Phase 4: Code Cleanup & Refactor (v0.11.3)

## [0.11.2] - 2025-05-30

### Changed
- Minor bug fixes and stability improvements
- Updated dependencies

## [0.11.1] - 2025-05-29

### Changed
- Internal refactoring and code optimization
- Improved error handling in deployment modules

### Fixed
- Fixed edge cases in canary monitoring
- Improved health check reliability

## [0.11.0] - 2025-05-30

### Added
- **Staging Environment Manager** - Automated staging deployment with validation
- **Production Deployment** - Safe production deployment with approval gates
- **Canary Monitoring** - Monitor canary deployments for anomalies
- **Health Checker** - Continuous health monitoring of deployed services
- **Smoke Test Runner** - Automated smoke tests post-deployment
- **Rollback Manager** - Automated rollback on failure detection
- **Approval Manager** - Deployment approval workflow
- **Deployment Notifier** - Real-time deployment notifications
- **Metrics Collector** - Collect deployment metrics (latency, error rate, throughput)
- **Alert Manager** - Alert system for deployment anomalies
- **Dashboard Generator** - Real-time deployment dashboard

### Features
- Staging deployment orchestration
- Production deployment with approval gates
- Canary deployment support
- Blue-green deployment strategy
- Automated rollback mechanism
- Real-time health checks
- Metrics collection and monitoring
- Alert management
- Deployment dashboard

### Phase
- Phase 4: Staging & Production Deployment (v0.11.0)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-05-29

### Added
- **Phase 2: Automated Testing & Quality Gates**
- TestGenerator: Autonomous unit/integration test generation
- TestRunner: Test execution with coverage reporting
- SecurityScanner: SAST, dependency check, CVE scanning
- PerformanceProfiler: Benchmark and memory leak detection
- E2ETestBuilder: End-to-end test generation
- TestReporter: Comprehensive test reporting
- LintEngine: ESLint, Prettier, TypeScript strict mode
- ComplexityAnalyzer: Cyclomatic complexity detection
- DocumentationChecker: JSDoc and README completeness validation
- QualityGate: Aggregate quality checks
- CodeSmellDetector: Code duplication and dead code detection
- RefactoringEngine: Automated refactoring patterns
- RefactoringValidator: Refactoring safety validation

### Changed
- Enhanced build pipeline with quality gates
- Improved test coverage requirements
- Stricter code quality standards

### Fixed
- Version alignment across Python and TypeScript projects

## [0.8.3] - 2024-01-XX

### Added
- **Phase 1: Foundation Complete**
- Tool API typed system
- Task Planner engine
- Mode system (Code, Web Research, Docs, Debug, UI Design, Review)
- Strong context resolver
- Apply engine with transaction/rollback
- Approval/audit log
- Test harness
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-05-29

### Added
- **Phase 2: Automated Testing & Quality Gates**
- TestGenerator: Autonomous unit/integration test generation
- TestRunner: Test execution with coverage reporting
- SecurityScanner: SAST, dependency check, CVE scanning
- PerformanceProfiler: Benchmark and memory leak detection
- E2ETestBuilder: End-to-end test generation
- TestReporter: Comprehensive test reporting
- LintEngine: ESLint, Prettier, TypeScript strict mode
- ComplexityAnalyzer: Cyclomatic complexity detection
- DocumentationChecker: JSDoc and README completeness validation
- QualityGate: Aggregate quality checks
- CodeSmellDetector: Code duplication and dead code detection
- RefactoringEngine: Automated refactoring patterns
- RefactoringValidator: Refactoring safety validation

### Changed
- Enhanced build pipeline with quality gates
- Improved test coverage requirements
- Stricter code quality standards

### Fixed
- Version alignment across Python and TypeScript projects

## [0.8.3] - 2024-01-XX

### Added
- **Phase 1: Foundation Complete**
- Tool API typed system
- Task Planner engine
- Mode system (Code, Web Research, Docs, Debug, UI Design, Review)
- Strong context resolver
- Apply engine with transaction/rollback
- Approval/audit log
- Test harness
# Changelog

Tất cả các thay đổi đáng chú ý của dự án này sẽ được ghi lại trong file này.

Format dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
và dự án này tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-14

### Added
- ✨ Ứng dụng Chatbot Streamlit hoàn chỉnh
- 💬 Chat interface giống ChatGPT
- 🤖 Hỗ trợ Claude 3.5 Sonnet, Opus, Haiku
- 📝 Lưu lịch sử chat trong session
- 💾 Export chat history dưới dạng JSON
- 🔐 Cấu hình AWS credentials an toàn
- 🌍 Hỗ trợ nhiều AWS regions
- 📚 8 file hướng dẫn chi tiết bằng tiếng Việt
- 🔧 Setup script tương tác
- 📊 7 ví dụ sử dụng API
- 🛡️ Best practices bảo mật
- 📋 Cấu trúc project chuyên nghiệp

### Documentation
- 📖 START_HERE.md - Bắt đầu nhanh
- 📖 HOW_TO_USE.md - Cách sử dụng
- 📖 HUONG_DAN_AWS.md - Hướng dẫn AWS
- 📖 CREDENTIALS_GUIDE.md - Hướng dẫn credentials
- 📖 PROJECT_SUMMARY.md - Tóm tắt dự án
- 📖 README.md - Tài liệu chính
- 📖 CONTRIBUTING.md - Hướng dẫn đóng góp

### Configuration
- ⚙️ requirements.txt - Dependencies
- ⚙️ .env.example - Ví dụ cấu hình
- ⚙️ .gitignore - Git ignore
- ⚙️ pyproject.toml - Project configuration
- ⚙️ LICENSE - MIT License

### CI/CD
- 🔄 GitHub Actions workflow cho linting

---

## Quy Tắc Versioning

Dự án này tuân theo Semantic Versioning:
- **MAJOR**: Thay đổi không tương thích
- **MINOR**: Tính năng mới, tương thích ngược
- **PATCH**: Bug fixes, tương thích ngược

---

## Cách Báo Cáo Thay Đổi

Khi tạo Pull Request, vui lòng:
1. Cập nhật CHANGELOG.md
2. Sử dụng format trên
3. Thêm vào section [Unreleased]

---

## Unreleased

### Planned Features
- [ ] Support for more Claude models
- [ ] Database integration for persistent chat history
- [ ] User authentication
- [ ] Multi-user support
- [ ] Advanced analytics
- [ ] Custom model fine-tuning

---

**Last Updated:** May 14, 2026
