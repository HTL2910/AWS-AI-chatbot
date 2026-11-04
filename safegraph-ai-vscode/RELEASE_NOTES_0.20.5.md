# SafeGraph AI v0.20.5

SafeGraph AI v0.20.5 adds an OpenAI-compatible provider beside Amazon Bedrock. Bedrock stays the default, so an existing setup is unchanged until you switch providers.

## Highlights

### OpenAI-compatible provider

- Setup can target 9Router (`http://localhost:20128/v1`), OpenRouter, LiteLLM, OpenAI, or any `/v1/chat/completions` endpoint.
- Presets fill the base URL and a starting model. **Detect 9Router** checks the local port and fills the model list. A key is optional on localhost.
- API keys are stored in VS Code SecretStorage. If `safegraph.openaiApiKey` is set in Settings, the next request moves it into SecretStorage and clears the setting.
- A failed OpenAI-compatible request does not fall back to Bedrock.

### One provider session

- Chat, inline completion, and inline edit share the selected provider.
- The chat header lists common models and accepts a custom model name.
- When the endpoint returns token counts, the composer shows `N in · N out`.

### Bedrock

- `safegraph.provider` defaults to `bedrock`.
- Existing Bedrock API key, access key, and AWS profile setup is unchanged.

## Verification

- TypeScript type checking passed.
- 9 test suites and 75 tests passed.
- Release metadata validation passed at `0.20.5`.

## Install

After the `0.20.5` tag is pushed, the Release VSIX workflow attaches `safegraph-ai-0.20.5.vsix` to the GitHub Release.

```bash
code --install-extension safegraph-ai-0.20.5.vsix --force
```

Verify the installed version:

```bash
code --list-extensions --show-versions | grep safegraph
```

Expected:

```text
safegraph.safegraph-ai@0.20.5
```

## Settings added in this release

| Setting | Default |
|---|---|
| `safegraph.provider` | `bedrock` |
| `safegraph.openaiBaseUrl` | `http://localhost:20128/v1` |
| `safegraph.openaiModel` | `9router/auto` |
| `safegraph.openaiApiKey` | empty, stored in SecretStorage by Setup |
