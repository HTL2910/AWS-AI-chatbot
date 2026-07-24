# SafeGraph AI v0.19.0

SafeGraph AI v0.19.0 improves Amazon Bedrock authentication, retry safety, release automation, and continuous integration.

## Highlights

### AWS credential-chain authentication

- Added explicit `auto`, `aws-credentials`, and `bearer-token` authentication modes.
- Added optional shared AWS profile support through `safegraph.awsProfile`.
- Supports the standard AWS SDK credential chain, including environment credentials, shared profiles, IAM Identity Center / SSO, temporary STS credentials, ECS task roles, and EC2 instance roles.
- Retains Bedrock API-key authentication for simpler local onboarding.

### Safer Bedrock requests

- Added fail-fast validation for missing region and model configuration.
- Improved retry classification so validation, authorization, expired-token, abort, and other fatal client errors are not retried.
- Retains retries with exponential backoff and jitter for throttling, transient network errors, and server-side failures.
- Uses the extension version dynamically in Bedrock request identification; no release-time User-Agent edit is required.

### Release automation

- Consolidated version management into the root `scripts/release.js`.
- Added `release:set` to synchronize package metadata, lockfile, README files, changelog, and VSIX filename references.
- Added `release:check` to detect inconsistent versions or missing changelog entries.
- Added extension verification and release packaging commands.

### Continuous integration

- Added GitHub Actions verification for extension changes.
- CI runs dependency installation, type checking, tests, production builds, VSIX packaging, and release metadata checks.
- Bedrock SDK calls are mocked in tests; CI does not require AWS credentials.

### Documentation

- Documented AWS credential-chain and Bedrock API-key authentication.
- Added troubleshooting for missing model IDs, unavailable credentials, expired SSO sessions, access denial, region availability, invalid inference-profile ARNs, and missing bearer tokens.
- Added safe `.env.example` defaults without real account IDs or ARNs.
- Semantic vector RAG and true multi-agent workers remain clearly marked as planned.

## Verification

- TypeScript type checking passed.
- 7 test suites and 57 tests passed.
- Webview and extension production builds passed.
- VSIX packaging passed.
- Release metadata validation passed at `0.19.0`.

## Install

```bash
code --install-extension safegraph-ai-0.19.0.vsix --force
```

Verify the installed version:

```bash
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.19.0
```

## Artifact

- File: `safegraph-ai-0.19.0.vsix`
- SHA-256: `a6edfa1cb215eef37e9682f1cffa5428ebcaf17d2376e7f96203b20cd20aedf9`
