# SafeGraph AI

SafeGraph AI is a local AI coding assistant project built around an AWS Bedrock-powered VS Code extension. The repository also keeps earlier Bedrock chatbot prototypes for web and Streamlit testing.

## Current Status

- Main product: `safegraph-ai-vscode/`
- Current extension version: `0.8.1`
- Bedrock region default: `ap-southeast-1`
- Authentication: Amazon Bedrock API key from VS Code SecretStorage, environment variables, or local `.env`
- Packaged builds: `.vsix` files are stored under `safegraph-ai-vscode/`

## Repository Layout

```text
.
├── safegraph-ai-vscode/       # VS Code extension source and packaged VSIX builds
├── chatbot-web/               # Flask web chatbot prototype using Bedrock API keys
├── src/                       # Streamlit app and credential setup scripts
├── docs/                      # Setup, credential, and usage notes
├── config/                    # Python requirements and env examples
├── examples/                  # Bedrock usage examples
└── README.md                  # This file
```

## VS Code Extension

The extension provides:

- Sidebar chat view inside VS Code
- Bedrock chat integration
- Local repository context/RAG
- Inline edit command with `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux
- Accept/reject inline edits with `Cmd/Ctrl+Enter` and `Esc`
- Safe command auto-run setting for agent workflows

### Install From VSIX

Use the latest package in `safegraph-ai-vscode/`, for example:

```bash
code --install-extension safegraph-ai-vscode/safegraph-ai-0.8.1.vsix --force
```

Or in VS Code:

```text
Extensions: Install from VSIX...
```

### Develop The Extension

```bash
cd safegraph-ai-vscode
npm install
npm run build
```

Open `safegraph-ai-vscode/` in VS Code and press `F5` to launch an Extension Development Host.

### Package A New VSIX

```bash
cd safegraph-ai-vscode
npm run package
```

## Bedrock API Key Configuration

The extension checks for a Bedrock API key in this order:

1. Environment variables: `AWS_BEARER_TOKEN_BEDROCK`, `API_KEY`, `BEDROCK_API_KEY`, `AWS_BEDROCK_API_KEY`
2. Workspace `.env` files
3. VS Code SecretStorage via `Safegraph AI: Set Bedrock API Key`

Recommended local `.env` format:

```env
API_KEY="bedrock-api-key-..."
ARN="arn:aws:bedrock:ap-southeast-1:ACCOUNT_ID:application-inference-profile/PROFILE_ID"
```

Do not commit real `.env` files or real API keys.

## Web Chatbot Prototype

The Flask prototype lives in `chatbot-web/`.

```bash
cd chatbot-web
pip install -r requirements.txt
python app.py
```

Default URL:

```text
http://localhost:5001
```

It reads credentials from the repo root `.env` and `chatbot-web/.env`.

## Streamlit Prototype

The older Streamlit app is still available under `src/`.

```bash
pip install -r config/requirements.txt
streamlit run src/app.py
```

Credential helper:

```bash
python src/setup_credentials.py
```

## Security Notes

- Real API keys must stay out of Git.
- `.env` files are ignored and should remain local.
- Prefer VS Code SecretStorage for the extension.
- Rotate/revoke any key that was shared, logged, or committed.
- After rewriting history, avoid merging old remote branches back into clean branches.

## Useful Docs

- [SafeGraph VS Code install guide](safegraph-ai-vscode/INSTALL.md)
- [Renew API key guide](docs/RENEW_API_KEY.md)
- [AWS credential guide](docs/CREDENTIALS_GUIDE.md)
- [Project docs index](docs/INDEX.md)

## License

See [LICENSE](LICENSE).
