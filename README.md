# SafeGraph AI

SafeGraph AI is a local AI coding assistant project centered on a Bedrock-powered VS Code coding agent. The main product is the `safegraph-ai-vscode/` extension; older Flask and Streamlit chatbot prototypes are kept for reference and testing.

Current extension version: `0.14.0`

## Current Status

- Main product: `safegraph-ai-vscode/`
- Installed extension id: `safegraph.safegraph-ai`
- Latest VSIX: `safegraph-ai-vscode/safegraph-ai-0.14.0.vsix`
- Bedrock region default: `ap-southeast-1`
- Authentication: VS Code SecretStorage, environment variables, or local `.env`
- Primary workflow: stateful coding agent inside VS Code, not only one-shot code generation

## What SafeGraph AI Does

- Understands workspace context: active file, selected text, tagged files, diagnostics, git state, and repository structure.
- Builds compact repository context with local RAG and symbol-aware chunks.
- Applies model-generated unified diffs directly to the workspace with validation and repair attempts.
- Runs safe build/test/typecheck/lint commands and feeds output back into the agent loop.
- Tracks task state across turns: goal, plan steps, changed files, commands, verification, open errors.
- Uses rolling memory and task-level context cache to reduce repeated token usage.
- Provides local tools for targeted inspection:
  - `safegraph__read_file`
  - `safegraph__search_files`
  - `safegraph__list_files`
  - `safegraph__run_verification`
- Produces evidence reports with changed files, commands run, verification pass/fail, and remaining risk.
- Shows current task status in the VS Code status bar.

## What Is Better In v0.14.0

Compared with a basic AI chat extension, SafeGraph AI now has:

- **Continuity**: follow-up turns continue the active task instead of starting over.
- **Verification discipline**: commands and pass/fail results are recorded.
- **Workspace grounding**: the agent reads/searches files, applies diffs, and verifies in the actual repo.
- **Lower token waste**: context cache, rolling memory, attachment truncation, and selective repository RAG reduce repeated prompt payload.
- **Evidence-first completion**: final output includes changed files, commands, verification, and remaining risk.
- **Vector RAG roadmap**: optional provider scaffold for future turbovec-style semantic retrieval.
- **Visible agent lane**: task progress appears in the VS Code status bar without exposing an unsafe eval bridge.

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

## Install The VS Code Extension

Install the latest packaged build:

```bash
code --install-extension safegraph-ai-vscode/safegraph-ai-0.14.0.vsix --force
```

Verify installation:

```bash
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.14.0
```

## Configure Bedrock Credentials

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

## Cost And Security Notes

SafeGraph AI calls Amazon Bedrock. Usage can create AWS costs depending on model, token volume, and request count.

Recommended:

- Enable AWS billing alerts or Cost and Usage monitoring.
- Use conservative repository RAG limits for large workspaces.
- Review generated diffs before keeping applied changes.
- Keep command auto-run at `safe` or `ask` for sensitive repositories.
- Never place long-lived secrets in prompts, attachments, generated code, or terminal output.

SafeGraph AI does not expose a public ALB or external HTTP endpoint by default. Credentials are stored in VS Code SecretStorage or loaded locally. Local tools are workspace-scoped and terminal execution is filtered through command policy.

## Comparison: Bedrock-Coder

SafeGraph AI is similar to [Bedrock-Coder](https://github.com/iankohhh/Bedrock-Coder) because both are VS Code developer tools using Amazon Bedrock. The direction is different:

| Area | Bedrock-Coder | SafeGraph AI |
|---|---|---|
| Primary workflow | Generate code from a description | Stateful coding agent loop |
| Bedrock access | CloudFormation backend with ALB endpoint | Direct Bedrock Runtime integration from the extension |
| Code output | User copies generated code into files | SafeGraph validates and applies diffs |
| Context | Description plus optional image attachment | Active file, selection, tagged files, diagnostics, git state, repository RAG, task memory |
| Memory | Not highlighted in README | Rolling memory plus persistent task state |
| Verification | Not highlighted in README | Safe build/test/typecheck/lint runner with evidence report |
| Security posture | Public ALB default warning | No public ALB by default; local secrets and command policy |

## Develop The Extension

```bash
cd safegraph-ai-vscode
npm install
npm run typecheck
npm run build
```

Open `safegraph-ai-vscode/` in VS Code and press `F5` to launch an Extension Development Host.

Package a new VSIX:

```bash
cd safegraph-ai-vscode
npm run package
```

## Prototype Apps

The older Flask prototype lives in `chatbot-web/`:

```bash
cd chatbot-web
pip install -r requirements.txt
python app.py
```

Default URL:

```text
http://localhost:5001
```

The Streamlit prototype is under `src/`:

```bash
pip install -r config/requirements.txt
streamlit run src/app.py
```

## Useful Docs

- [VS Code extension README](safegraph-ai-vscode/README.md)
- [Turbovec adoption notes](safegraph-ai-vscode/docs/TURBOVEC_ADOPTION.md)
- [CLI bridge adoption notes](safegraph-ai-vscode/docs/CLI_BRIDGE_ADOPTION.md)
- [Renew API key guide](docs/RENEW_API_KEY.md)
- [AWS credential guide](docs/CREDENTIALS_GUIDE.md)

## License

See [LICENSE](LICENSE).
