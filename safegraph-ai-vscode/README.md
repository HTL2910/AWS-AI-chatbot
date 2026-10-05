# Safegraph AI

A coding agent for VS Code powered by Claude on Amazon Bedrock. Ask it to write code, fix bugs, review changes or produce a project report. It reads your workspace, applies changes as reviewable diffs, runs safe build/test commands and reports what it did.

Current release: `v0.20.0`

## Quick Start

1. **Download** `safegraph-ai-0.20.0.vsix` from the project's GitHub Releases page.
2. **Install** it: in VS Code open the Extensions view → `···` menu → **Install from VSIX...**, or run:

   ```sh
   code --install-extension safegraph-ai-0.20.0.vsix --force
   ```

3. **Connect AWS.** The **Safegraph AI Setup** screen opens automatically the first time (or run `Safegraph AI: Setup` from the Command Palette). Pick one:
   - **Bedrock API key** — generated in the Bedrock console under **API keys**.
   - **AWS access key** — IAM Access Key ID + Secret Access Key (and session token for temporary credentials).
   - **AWS profile / default credential chain** — `~/.aws` profiles, SSO or environment variables.

   Choose the region and model (Claude Haiku 4.5 is pre-filled), then click **Save & test connection**.
4. **Start working.** Open the Safegraph AI icon in the Activity Bar and type a request.

## What You Can Ask

| Task | Example | What happens |
|---|---|---|
| Write code | "Add a /health endpoint that returns the build version" | Reads the relevant files, applies a diff, runs a safe check |
| Fix | "Fix the failing tests" or the **Fix** button | Reads diagnostics/errors, patches the root cause, re-runs verification |
| Review | "Review my current changes" or the **Review** button | Read-only review of `git diff`, findings ordered by severity with file paths |
| Report | "Write a project report" or the **Report** button | Collects evidence (structure, build/test status, recent changes) and writes `SAFEGRAPH_REPORT.md` |

Applied changes show up as a change set in the chat; keep or discard each file. Follow-up messages such as "continue" or "run it again" stay on the same task.

Other features:

- **Inline edit** — select code and press `Ctrl/Cmd+K`.
- **Inline completion** — ghost-text suggestions while typing (`Safegraph AI: Toggle Inline Completion`).
- **Context** — attach files, add the active selection, or type `@Repository` for broad codebase context.

## Commands

| Command | Purpose |
|---|---|
| `Safegraph AI: Setup (AWS Credentials & Model)` | Enter or change credentials, region and model; test the connection |
| `Safegraph AI: Check Bedrock API Key` | Show which credentials, region and model are in use |
| `Safegraph AI: Open Chat` | Open the chat view |
| `Safegraph AI: Inline Edit` | Edit the selection with an instruction |
| `Safegraph AI: Show Task History` | Browse past tasks |
| `Safegraph AI: Open Log` | Open the output log for troubleshooting |

## Settings

| Setting | Default | Description |
|---|---|---|
| `safegraph.authMode` | `auto` | `bearer-token`, `access-keys`, `aws-credentials`, or `auto` (API key → access keys → credential chain) |
| `safegraph.region` | `ap-southeast-1` | Bedrock Runtime region |
| `safegraph.modelId` | Claude Haiku 4.5 (global) | Model ID or inference profile ARN |
| `safegraph.awsProfile` | empty | Profile for `aws-credentials` mode |
| `safegraph.autoRun` | `safe` | In Agent mode: `safe` auto-runs allowlisted build/test commands and asks for the rest, `ask` asks for every command, `off` never runs commands |
| `safegraph.chat.maxTokens` / `safegraph.chat.temperature` | `8192` / `0.2` | Response limits |
| `safegraph.completion.*` | | Inline completion on/off, trigger mode, model override |
| `safegraph.repositoryRag.*` | | Size limits for repository context |

Secrets (API key, access keys) are stored in VS Code SecretStorage, never in settings files.

## Troubleshooting

- **"AWS credentials are not configured"** — run `Safegraph AI: Setup`.
- **`AccessDeniedException`** — the IAM user/role needs `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, and model access must be enabled for the account in the Bedrock console.
- **`The security token included in the request is invalid`** — the access key or secret is wrong, or a temporary key needs its session token.
- **Model not available in region** — pick a region where the model is offered, or use an inference profile ID (`global.`, `us.`, `apac.` prefixes).
- **Expired SSO session** — run `aws sso login --profile <profile>`.
- Anything else: `Safegraph AI: Open Log`.

## Cost And Security

- Every request is billed to your AWS account by Amazon Bedrock. Set up AWS billing alerts.
- The extension talks directly to Bedrock Runtime; there is no Safegraph server in between.
- Commands proposed by the agent run only if they are on the safe allowlist (or you approve them).
- Review applied change sets before keeping them.

## Development

```sh
npm ci
npm run typecheck
npm run test:ci
npm run package   # bundles with esbuild and writes safegraph-ai-<version>.vsix
```

Press `F5` in VS Code with this folder open to launch an Extension Development Host.
