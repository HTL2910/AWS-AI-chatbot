import * as path from "path";
import * as vscode from "vscode";

function clean(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "").trim();
}

export type BedrockApiKeyInfo = {
  value: string;
  source: string;
  keyName: string;
};

export function maskApiKey(value: string) {
  const cleanValue = clean(value);
  if (cleanValue.length <= 12) return "***";
  return `${cleanValue.slice(0, 8)}...${cleanValue.slice(-4)}`;
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
      const key = trimmed.slice(0, idx).trim().replace(/^export\s+/i, "");
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
  "API_KEY",
  "BEDROCK_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_BEDROCK_API_KEY"
];

function isUsableApiKey(value: string) {
  const v = clean(value);
  const lower = v.toLowerCase();
  if (!v) return false;
  if (lower.includes("your_api") || lower.includes("your_bearer") || lower.includes("your_key")) return false;
  if (lower.includes("placeholder") || lower.includes("example")) return false;
  return v.startsWith("ABSK") || v.startsWith("bedrock-api-key-");
}

function getApiKeyFromMap(map: Map<string, string> | null): { value: string; keyName: string } | null {
  if (!map) return null;
  for (const key of envKeyNames) {
    const apiKey = map.get(key);
    if (apiKey && isUsableApiKey(apiKey)) return { value: apiKey, keyName: key };
  }
  return null;
}

function getApiKeysFromMap(map: Map<string, string> | null): { value: string; keyName: string }[] {
  if (!map) return [];
  const results: { value: string; keyName: string }[] = [];
  for (const key of envKeyNames) {
    const apiKey = map.get(key);
    if (apiKey && isUsableApiKey(apiKey)) results.push({ value: apiKey, keyName: key });
  }
  return results;
}

function getApiKeyFromShellEnv(): { value: string; keyName: string } | null {
  for (const key of envKeyNames) {
    const value = process.env[key];
    if (value && isUsableApiKey(value)) return { value: clean(value), keyName: key };
  }
  return null;
}

function getApiKeysFromShellEnv(): { value: string; keyName: string }[] {
  const results: { value: string; keyName: string }[] = [];
  for (const key of envKeyNames) {
    const value = process.env[key];
    if (value && isUsableApiKey(value)) results.push({ value: clean(value), keyName: key });
  }
  return results;
}

function uniqueKeyInfos(infos: BedrockApiKeyInfo[]) {
  const seen = new Set<string>();
  const results: BedrockApiKeyInfo[] = [];
  for (const info of infos) {
    const id = `${info.keyName}\0${info.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push(info);
  }
  return results;
}

function addEnvCandidate(envUris: vscode.Uri[], triedUris: Set<string>, uri: vscode.Uri) {
  if (!triedUris.has(uri.toString())) {
    envUris.push(uri);
    triedUris.add(uri.toString());
  }
}

async function collectEnvUris(extraDirs: string[] = []) {
  const folders = vscode.workspace.workspaceFolders;
  const triedUris = new Set<string>();
  const envUris: vscode.Uri[] = [];

  if (folders && folders.length > 0) {
    for (const folder of folders) {
      addEnvCandidate(envUris, triedUris, vscode.Uri.joinPath(folder.uri, ".env"));
    }

    addParentEnvCandidates(folders[0].uri.fsPath, envUris, triedUris);
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document?.uri?.fsPath) {
    addParentEnvCandidates(path.dirname(activeEditor.document.uri.fsPath), envUris, triedUris);
  }

  addParentEnvCandidates(process.cwd(), envUris, triedUris);

  for (const dir of extraDirs) {
    addEnvCandidate(envUris, triedUris, vscode.Uri.file(path.join(dir, ".env")));
  }

  if (folders && folders.length > 0) {
    const found = await vscode.workspace.findFiles("**/.env", "**/{node_modules,.git,dist,build,out,venv,.venv}/**", 50);
    for (const uri of found) {
      addEnvCandidate(envUris, triedUris, uri);
    }
  }

  return envUris;
}

export async function loadBedrockApiKeyInfos(extraDirs: string[] = []): Promise<BedrockApiKeyInfo[]> {
  const infos: BedrockApiKeyInfo[] = [];
  for (const shellApiKey of getApiKeysFromShellEnv()) {
    infos.push({
      value: shellApiKey.value,
      keyName: shellApiKey.keyName,
      source: "process environment"
    });
  }

  for (const envUri of await collectEnvUris(extraDirs)) {
    const map = await parseEnvFile(envUri);
    for (const apiKey of getApiKeysFromMap(map)) {
      infos.push({
        value: apiKey.value,
        keyName: apiKey.keyName,
        source: envUri.fsPath
      });
    }
  }

  return uniqueKeyInfos(infos);
}

export async function loadBedrockApiKeyInfo(extraDirs: string[] = []): Promise<BedrockApiKeyInfo | null> {
  return (await loadBedrockApiKeyInfos(extraDirs))[0] || null;
}

export async function loadBedrockApiKeyFromDotEnv(extraDirs: string[] = []): Promise<string | null> {
  const info = await loadBedrockApiKeyInfo(extraDirs);
  return info?.value || null;
}
