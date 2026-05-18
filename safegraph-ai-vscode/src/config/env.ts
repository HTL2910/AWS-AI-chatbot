import * as path from "path";
import * as vscode from "vscode";

function clean(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "").trim();
}

async function parseEnvFile(envUri: vscode.Uri): Promise<Map<string, string> | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(envUri);
    const text = Buffer.from(bytes).toString("utf8");
    const lines = text.split(/\r?\n/);

    const map = new Map<string, string>();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1);
      map.set(key, clean(val));
    }

    return map;
  } catch {
    return null;
  }
}

function addParentEnvCandidates(startPath: string, envUris: vscode.Uri[], triedUris: Set<string>) {
  let currentDir = startPath;
  for (let i = 0; i < 4; i += 1) {
    const parent = path.dirname(currentDir);
    if (!parent || parent === currentDir) break;
    currentDir = parent;
    const uri = vscode.Uri.file(path.join(currentDir, ".env"));
    if (!triedUris.has(uri.toString())) {
      envUris.push(uri);
      triedUris.add(uri.toString());
    }
  }
}

const envKeyNames = [
  "AWS_BEARER_TOKEN_BEDROCK",
  "API_KEY",
  "BEDROCK_API_KEY",
  "AWS_BEDROCK_API_KEY"
];

function getApiKeyFromMap(map: Map<string, string> | null): string | null {
  if (!map) return null;
  for (const key of envKeyNames) {
    const apiKey = map.get(key);
    if (apiKey) return apiKey;
  }
  return null;
}

function getApiKeyFromShellEnv(): string | null {
  for (const key of envKeyNames) {
    const value = process.env[key];
    if (value && value.trim()) return clean(value);
  }
  return null;
}

export async function loadBedrockApiKeyFromDotEnv(extraDirs: string[] = []): Promise<string | null> {
  const shellApiKey = getApiKeyFromShellEnv();
  if (shellApiKey) return shellApiKey;

  const folders = vscode.workspace.workspaceFolders;
  const triedUris = new Set<string>();
  const envUris: vscode.Uri[] = [];

  for (const dir of extraDirs) {
    const uri = vscode.Uri.file(path.join(dir, ".env"));
    if (!triedUris.has(uri.toString())) {
      envUris.push(uri);
      triedUris.add(uri.toString());
    }
  }

  if (folders && folders.length > 0) {
    for (const folder of folders) {
      envUris.push(vscode.Uri.joinPath(folder.uri, ".env"));
    }

    const found = await vscode.workspace.findFiles("**/.env", "**/{node_modules,.git,dist,build,out,venv,.venv}/**", 50);
    for (const uri of found) {
      if (!triedUris.has(uri.toString())) {
        envUris.push(uri);
        triedUris.add(uri.toString());
      }
    }

    addParentEnvCandidates(folders[0].uri.fsPath, envUris, triedUris);
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document?.uri?.fsPath) {
    addParentEnvCandidates(path.dirname(activeEditor.document.uri.fsPath), envUris, triedUris);
  }

  addParentEnvCandidates(process.cwd(), envUris, triedUris);

  for (const envUri of envUris) {
    const map = await parseEnvFile(envUri);
    const apiKey = getApiKeyFromMap(map);
    if (apiKey) return apiKey;
  }

  return null;
}
