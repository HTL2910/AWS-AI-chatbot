# SafeGraph AI

**A VS Code coding agent.** Ask it to write code, fix bugs, review changes or write a project report — it reads your repository, applies real diffs, runs safe checks and tells you what changed. The default model is **Claude Haiku 4.5** on Amazon Bedrock. Release **0.20.5** can also call 9Router, OpenRouter, LiteLLM, OpenAI, or any other OpenAI-compatible `/v1/chat/completions` endpoint.

Current extension version: `0.20.5` · Default model: **Claude Haiku 4.5** on Amazon Bedrock

---

## Quick Start

```mermaid
flowchart LR
    A["Download<br/>safegraph-ai-0.20.5.vsix<br/>from GitHub Releases"] --> B["Install in VS Code<br/>Extensions → ··· →<br/>Install from VSIX"]
    B --> C["Setup screen opens<br/>Bedrock or<br/>OpenAI-compatible"]
    C --> D{"Save &amp; test<br/>connection"}
    D -- "green" --> E["Open the chat<br/>and ask"]
    D -- "red: shows AWS error" --> C
```

1. Download `safegraph-ai-0.20.5.vsix` from [Releases](https://github.com/HTL2910/AWS-AI-chatbot/releases).
2. Install it from the Extensions view (`···` → **Install from VSIX...**) or:

   ```bash
   code --install-extension safegraph-ai-0.20.5.vsix --force
   ```

3. The **Safegraph AI Setup** screen opens on first run (or run `Safegraph AI: Setup`). Leave the provider on **Bedrock** and enter AWS credentials, or switch to **OpenAI-compatible** and point it at 9Router, OpenRouter, LiteLLM, or OpenAI. Click **Save & test connection**.
4. Click the Safegraph AI icon in the Activity Bar and start asking. The model dropdown in the chat header changes the model without opening Settings.

Check the installed version with `code --list-extensions --show-versions | grep safegraph` → `safegraph.safegraph-ai@0.20.5`.

### What's new in 0.20.5

- **OpenAI-compatible provider**, next to Bedrock. Setup presets cover 9Router (`http://localhost:20128/v1`), OpenRouter, LiteLLM, and OpenAI. API keys are stored in VS Code SecretStorage.
- **One provider session** for chat, inline completion, and inline edit. Bedrock stays the default. A failed OpenAI-compatible request does not fall back to Bedrock.
- **Detect 9Router** fills the base URL and model list from a local 9Router. A key is optional on localhost.
- Token usage appears in the composer when the endpoint returns it.

---

## What You Can Ask

```mermaid
flowchart TD
    Q["Your request in chat"] --> T{"Request type"}
    T -- "build / change something" --> C["Code<br/>read files → apply diff → run check"]
    T -- "Fix button / 'fix …'" --> F["Fix<br/>read errors → patch root cause → re-verify"]
    T -- "Review button / 'review …'" --> R["Review (read-only)<br/>git diff → findings by severity"]
    T -- "Report button / 'report …'" --> P["Report<br/>collect evidence → SAFEGRAPH_REPORT.md"]
    C --> K["Change set in chat:<br/>keep or discard per file"]
    F --> K
    R --> O["Offer to fix findings"]
    P --> S["Summary in chat + report file"]
```

| Mode | Example | Edits files? |
|---|---|---|
| **Code** | "Add a /health endpoint that returns the build version" | Yes, as reviewable diffs |
| **Fix** | "Fix the failing tests" | Yes, then re-runs verification |
| **Review** | "Review my current changes" | No |
| **Report** | "Write a project report" | Only `SAFEGRAPH_REPORT.md` |

Also available: **inline edit** (select code, `Ctrl/Cmd+K`), **ghost-text completion** while typing, and follow-ups like "continue" that stay on the same task.

---

## How It Works

```mermaid
flowchart LR
    subgraph VSCode["VS Code"]
        UI["Chat view"]
        SP["Setup screen"]
        IE["Inline edit &amp;<br/>completion"]
    end

    subgraph Ext["Extension (runs locally)"]
        AG["Agent loop<br/>task memory, context, workflows"]
        TL["Workspace tools<br/>read · search · list files<br/>apply diff · run safe command"]
        CR["Credential resolver"]
        SS[("VS Code<br/>SecretStorage")]
    end

    BR["Amazon Bedrock<br/>Claude model"]

    UI --> AG
    IE --> CR
    SP --> SS
    AG <--> TL
    AG --> CR
    CR --> SS
    CR -- "Converse API (HTTPS)" --> BR
```

There is no SafeGraph server. With the default provider the extension calls Amazon Bedrock Runtime directly and every request is billed to your AWS account. Set `safegraph.provider` to `openai-compatible` to call 9Router, OpenRouter, LiteLLM, or any other `/v1/chat/completions` endpoint instead. That path does not fall back to Bedrock.

One task runs as a loop until the model has enough evidence to finish:

```mermaid
sequenceDiagram
    actor You
    participant Agent as SafeGraph agent
    participant WS as Workspace
    participant Claude as Claude on Bedrock

    You->>Agent: request
    Agent->>Agent: pick workflow, load task memory and repo context
    loop until done (max 8 rounds)
        Agent->>Claude: prompt + context + tool results
        Claude-->>Agent: answer or tool calls
        Agent->>WS: read / search files, apply diff, run allowlisted command
        WS-->>Agent: file contents, diff result, command output
    end
    Agent-->>You: answer + change set + evidence (files, commands, pass/fail, risk)
```

---

## Authentication

Pick one method in the Setup screen. Secrets are stored in VS Code SecretStorage on your machine, never in settings files.

```mermaid
flowchart TD
    M{"safegraph.authMode"}
    M -- "bearer-token" --> K["Bedrock API key"]
    M -- "access-keys" --> A["AWS Access Key ID +<br/>Secret Access Key<br/>(+ session token)"]
    M -- "aws-credentials" --> P["AWS profile / SSO /<br/>environment variables"]
    M -- "auto (default)" --> H{"API key stored?"}
    H -- yes --> K
    H -- no --> J{"Access keys stored?"}
    J -- yes --> A
    J -- no --> P
```

| Method | Where to get it | Best for |
|---|---|---|
| Bedrock API key | Bedrock console → **API keys** | Quick personal setup |
| AWS access key | IAM user → **Security credentials** | Teams without SSO |
| Profile / SSO | `aws configure sso` then `aws sso login --profile <name>` | Enterprise accounts |

The IAM principal needs `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, and access to the model must be enabled in the Bedrock console for your region. AWS docs: [model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html), [API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-generate.html), [CLI SSO](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).

---

## Troubleshooting

| Message | Fix |
|---|---|
| AWS credentials are not configured | The provider is still Bedrock and no credentials are stored. Run `Safegraph AI: Setup` |
| Cannot reach `http://localhost:20128` | 9Router is not running, or the base URL is wrong. Start it, then use **Detect 9Router** |
| API key rejected | The OpenAI-compatible key does not match that base URL. Paste a new key in Setup |
| `The security token included in the request is invalid` | Wrong access key/secret, or temporary keys missing the session token |
| `AccessDeniedException` | Grant the Bedrock permissions above and enable model access |
| Model not available in region | Change region, or use an inference profile ID (`global.`, `us.`, `apac.`) |
| Expired SSO session | `aws sso login --profile <name>` |
| Anything else | `Safegraph AI: Open Log` |

---

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `safegraph.provider` | `bedrock` | `bedrock` or `openai-compatible` |
| `safegraph.openaiBaseUrl` | `http://localhost:20128/v1` | OpenAI-compatible base URL (9Router default) |
| `safegraph.openaiModel` | `9router/auto` | Model name for the OpenAI-compatible provider |
| `safegraph.openaiApiKey` | empty | Moved into SecretStorage by Setup. Do not commit a real key |
| `safegraph.authMode` | `auto` | Bedrock only: `auto`, `bearer-token`, `access-keys`, `aws-credentials` |
| `safegraph.region` | `ap-southeast-1` | Bedrock region |
| `safegraph.modelId` | Claude Haiku 4.5 (global) | Bedrock model ID or inference profile ARN |
| `safegraph.awsProfile` | empty | Profile for `aws-credentials` |
| `safegraph.autoRun` | `safe` | Agent mode: `safe` runs allowlisted build/test commands, `ask` asks every time, `off` never runs |
| `safegraph.completion.*` | | Ghost-text completion on/off, trigger, model |
| `safegraph.repositoryRag.*` | | Size limits for repository context |

---

## Cost, Security, Limits

- Bedrock usage is billed by AWS. Set up billing alerts. An OpenAI-compatible endpoint is billed by that service. A local 9Router stays on your machine.
- A failed OpenAI-compatible request does not fall back to Bedrock.
- Commands the agent proposes run only if allowlisted or approved; review change sets before keeping them.
- Model quality depends on the model you pick.
- Not included yet: browser automation, semantic vector search, separate multi-agent workers.

---

## Develop &amp; Release

```mermaid
flowchart LR
    D["Edit code in<br/>safegraph-ai-vscode/"] --> V["npm run typecheck<br/>npm run test:ci"]
    V --> P["npm run package<br/>→ .vsix (esbuild bundle)"]
    P --> B["node scripts/release.js X.Y.Z<br/>bump version + changelog"]
    B --> M["Merge to main"]
    M --> T["Push tag X.Y.Z"]
    T --> W["Release VSIX workflow<br/>tests, builds, attaches .vsix"]
    W --> R["GitHub Release"]
```

```bash
cd safegraph-ai-vscode
npm ci
npm run typecheck
npm run test:ci
npm run package        # writes safegraph-ai-<version>.vsix
```

Press `F5` with `safegraph-ai-vscode/` open in VS Code to start an Extension Development Host.

### Repository layout

```text
.
├── safegraph-ai-vscode/   # The VS Code extension (maintained product)
│   ├── src/               # Extension source: chat, setup, bedrock, tools
│   └── media/             # Chat UI script and styles
├── scripts/release.js     # Version bump / consistency check
├── .github/workflows/     # CI, lint, Release VSIX
├── docs/                  # Credential and usage notes
├── examples/              # Python Bedrock examples
└── legacy/                # Old Flask/Streamlit prototypes (unsupported)
```

More: [extension README](safegraph-ai-vscode/README.md) · [0.20.5 release notes](safegraph-ai-vscode/RELEASE_NOTES_0.20.5.md) · [CHANGELOG](CHANGELOG.md) · [credential guide](docs/CREDENTIALS_GUIDE.md) · [renew API key](docs/RENEW_API_KEY.md)

## License

See [LICENSE](LICENSE).
