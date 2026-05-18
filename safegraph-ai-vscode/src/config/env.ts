import * as vscode from "vscode";

function clean(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "").trim();
}

export async function loadBedrockApiKeyFromDotEnv(): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;

  // MVP: read .env at the first workspace folder root.
  const envUri = vscode.Uri.joinPath(folders[0].uri, ".env");
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

    const apiKey = map.get("AWS_BEARER_TOKEN_BEDROCK") || map.get("API_KEY") || "";
    if (!apiKey) return null;
    return apiKey;
  } catch {
    return null;
  }
}

