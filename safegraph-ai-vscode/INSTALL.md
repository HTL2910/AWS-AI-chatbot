INSTALLATION GUIDE — Safegraph AI VS Code Extension

This guide shows how to install the packaged extension (`safegraph-ai-0.0.1.vsix`) on another machine or copy the extension folder for local use, plus how to provide the Bedrock API key the extension needs.

1) Prerequisites
- VS Code installed on target machine (version compatible with `engines.vscode` in `package.json`).
- Node.js and `vsce` only needed if you want to repackage or publish; not required for installation.

2) Install from the `.vsix` file (recommended for distribution)
- Copy `safegraph-ai-0.0.1.vsix` to the target machine.
- Install via CLI:

```bash
code --install-extension safegraph-ai-0.0.1.vsix
```

- Or install via VS Code UI: Command Palette → `Extensions: Install from VSIX...` → choose the `.vsix` file.

3) Install by copying the extension folder (developer/test use)
- Copy the entire `safegraph-ai-vscode` folder to the target machine.
- In VS Code on the target machine, open that folder and press `F5` to run the Extension Development Host, or install the folder as an unpacked extension using the VS Code UI (less common).

4) Provide the Bedrock API key (required)
The extension will look for a Bedrock API key in this order:
- Environment variables in the running process (`AWS_BEARER_TOKEN_BEDROCK`, `API_KEY`, `BEDROCK_API_KEY`, `AWS_BEDROCK_API_KEY`).
- Workspace `.env` files (searched in workspace roots, nested `.env`, parent folders, and `process.cwd()`).
- VS Code SecretStorage via the extension command `Safegraph AI: Set Bedrock API Key`.

Recommended options:
- Add a workspace `.env` file in the workspace root (where you open VS Code) with one of the supported keys, for example:

```env
API_KEY="bedrock-api-key-..."
```

- Or in VS Code: Command Palette → `Safegraph AI: Set Bedrock API Key` and paste your key (saved to SecretStorage on that machine).

Important: the key must be one of the accepted names; custom names will not be recognized.

5) Verifying the extension works
- Reload the VS Code window (Developer: Reload Window).
- Open the Safegraph AI view in the Activity Bar.
- If the key is missing, the chat will show an error: "Missing Bedrock API key...". Use the `Set Key` command or place a `.env` in the workspace root.

6) Packaging and publishing (optional)
- To create the `.vsix` locally (already done in this repo):

```bash
# from safegraph-ai-vscode/
npm run build
npx vsce package
```

- To publish on the VS Code Marketplace you need a publisher and a Personal Access Token. See the official docs: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

7) Troubleshooting
- If installation succeeds but extension still complains about missing key:
  - Confirm you opened the correct workspace root where `.env` resides.
  - Try the `Safegraph AI: Set Bedrock API Key` command.
  - Check the extension output channel: View → Output → choose "Safegraph AI".
- If the extension does not activate after installation, run `Developer: Reload Window` and check `Help → Toggle Developer Tools` for errors.

8) Notes for secure deployment
- Do NOT commit `.env` with real keys into public repos.
- Prefer using the `Set Bedrock API Key` command on each machine to store the key in VS Code SecretStorage.

File locations in this repo:
- Packaged `.vsix`: `safegraph-ai-vscode/safegraph-ai-0.0.1.vsix`
- Extension source: `safegraph-ai-vscode/` (contains `out/`, `src/`, `package.json`)

If you want, I can also generate a small shell script to copy the `.vsix` to a remote machine and install it automatically. Want that?