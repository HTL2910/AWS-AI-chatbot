import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

type HunkLine = { kind: "context" | "add" | "del"; text: string };
type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: HunkLine[] };
type FilePatch = {
  filePath: string;
  oldPath: string;
  newPath: string;
  kind: "update" | "create" | "delete";
  hunks: Hunk[];
};

function sanitizeDiffText(diffText: string) {
  // Cursor-like tolerance: models sometimes include commentary lines inside ```diff``` blocks.
  // We keep only lines that look like unified diff metadata or hunk body.
  const out: string[] = [];
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  let inHunk = false;
  for (const line of lines) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    ) {
      inHunk = false;
      out.push(line);
      continue;
    }
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@ ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ") ||
      line.startsWith("\\ No newline at end of file") ||
      line.trim() === ""
    ) {
      if (line.startsWith("@@ ")) inHunk = true;
      if (line.startsWith("--- ") || line.startsWith("+++ ")) inHunk = false;
      out.push(line);
      continue;
    }
    // If we're inside a hunk, coerce stray lines into context so git doesn't see a corrupt patch.
    // This makes the patch parseable; apply may still fail if the content doesn't match.
    if (inHunk) {
      out.push(" " + line);
      continue;
    }
    // Otherwise drop (e.g. "# Analysis", markdown bullets)
  }
  // Fix common model bug: blank lines inside hunks without a prefix break git apply.
  // Convert empty lines that are within a hunk to context " ".
  const fixed: string[] = [];
  inHunk = false;
  for (const l of out) {
    if (l.startsWith("@@ ")) inHunk = true;
    if (l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("diff --git ")) inHunk = false;
    if (inHunk && l === "") fixed.push(" ");
    else fixed.push(l);
  }

  // Final normalize: inside a hunk, every line must start with ' ', '+', '-', or '\'.
  // If not, coerce to context to avoid "corrupt patch" errors.
  const normalized: string[] = [];
  inHunk = false;
  for (const l of fixed) {
    if (l.startsWith("@@ ")) {
      inHunk = true;
      normalized.push(l);
      continue;
    }
    if (l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("diff --git ")) {
      inHunk = false;
      normalized.push(l);
      continue;
    }
    if (inHunk && l !== "" && !/^[ +\\-]/.test(l)) {
      normalized.push(" " + l);
      continue;
    }
    normalized.push(l);
  }
  return normalized.join("\n");
}

function normalizePath(p: string) {
  // Accept "a/foo", "b/foo", and raw paths.
  const cleaned = p.replace(/^[ab]\//, "").trim();
  if (cleaned === "/dev/null" || cleaned === "dev/null") return "";
  return cleaned;
}

function parseFilePathFromHeader(line: string) {
  // --- a/foo\t... or +++ b/foo\t...
  const rest = line.slice(4).trim();
  const tabIdx = rest.indexOf("\t");
  return normalizePath((tabIdx >= 0 ? rest.slice(0, tabIdx) : rest).trim());
}

function parseHunkHeader(line: string) {
  // @@ -oldStart,oldLines +newStart,newLines @@
  const m = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
  if (!m) return null;
  return {
    oldStart: Number(m[1]),
    oldLines: Number(m[2] ?? "1"),
    newStart: Number(m[3]),
    newLines: Number(m[4] ?? "1")
  };
}

export function parseUnifiedDiff(diffText: string): FilePatch[] {
  const cleaned = sanitizeDiffText(diffText);
  const lines = cleaned.replace(/\r\n/g, "\n").split("\n");
  const patches: FilePatch[] = [];

  let i = 0;
  while (i < lines.length) {
    // Skip optional git diff metadata lines
    if (
      lines[i].startsWith("diff --git ") ||
      lines[i].startsWith("index ") ||
      lines[i].startsWith("new file mode ") ||
      lines[i].startsWith("deleted file mode ") ||
      lines[i].startsWith("similarity index ") ||
      lines[i].startsWith("rename from ") ||
      lines[i].startsWith("rename to ")
    ) {
      i++;
      continue;
    }
    if (!lines[i].startsWith("--- ")) {
      i++;
      continue;
    }
    const oldPath = parseFilePathFromHeader(lines[i]);
    i++;
    if (i >= lines.length || !lines[i].startsWith("+++ ")) break;
    const newPath = parseFilePathFromHeader(lines[i]);
    const filePath = newPath || oldPath;
    if (!filePath) throw new Error("Diff refers to /dev/null without a target path.");
    const kind: FilePatch["kind"] =
      !oldPath && newPath ? "create" : oldPath && !newPath ? "delete" : "update";
    i++;

    const hunks: Hunk[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("--- ")) break;
      if (!line.startsWith("@@ ")) {
        i++;
        continue;
      }
      const hh = parseHunkHeader(line);
      if (!hh) throw new Error(`Invalid hunk header: ${line}`);
      i++;
      const hunkLines: HunkLine[] = [];
      while (i < lines.length) {
        const hl = lines[i];
        if (hl.startsWith("@@ ") || hl.startsWith("--- ")) break;
        if (hl.startsWith("\\ No newline at end of file")) {
          i++;
          continue;
        }
        if (hl.trim() === "") {
          // Empty lines inside hunks are represented as " " (context) in strict diffs,
          // but some generators emit blank. Treat as context blank.
          hunkLines.push({ kind: "context", text: "" });
          i++;
          continue;
        }
        const ch = hl.slice(0, 1);
        const txt = hl.slice(1);
        if (ch === " ") hunkLines.push({ kind: "context", text: txt });
        else if (ch === "+") hunkLines.push({ kind: "add", text: txt });
        else if (ch === "-") hunkLines.push({ kind: "del", text: txt });
        else {
          // Tolerate stray lines; sanitized diffs should have removed most of these.
          i++;
          continue;
        }
        i++;
      }
      hunks.push({ ...hh, lines: hunkLines });
    }

    patches.push({ filePath, oldPath, newPath, kind, hunks });
  }

  if (patches.length === 0) throw new Error("No file patches found in diff.");
  return patches;
}

function applyHunksToLines(original: string[], hunks: Hunk[]): string[] {
  const out = original.slice();
  // We apply hunks in order; unified diffs are ordered top-down.
  let lineOffset = 0;

  function findHunkStartIndex(h: Hunk): number | null {
    // Build an "old-file" signature from context+del lines (adds don't exist in old file).
    const sig = h.lines.filter((l) => l.kind !== "add").map((l) => l.text);
    if (sig.length === 0) return null;

    // Search for the first signature line, then verify sequential match.
    const first = sig[0];
    for (let start = 0; start <= out.length - 1; start++) {
      if (out[start] !== first) continue;
      let ok = true;
      for (let j = 0; j < sig.length; j++) {
        if (start + j >= out.length || out[start + j] !== sig[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return start;
    }
    return null;
  }

  function applyOneHunk(h: Hunk, idx0: number) {
    let idx = idx0;
    for (const hl of h.lines) {
      if (hl.kind === "context") {
        if (out[idx] !== hl.text) throw new Error("Context mismatch while applying diff.");
        idx++;
      } else if (hl.kind === "del") {
        if (out[idx] !== hl.text) throw new Error("Delete line mismatch while applying diff.");
        out.splice(idx, 1);
        lineOffset -= 1;
      } else if (hl.kind === "add") {
        out.splice(idx, 0, hl.text);
        idx++;
        lineOffset += 1;
      }
    }
  }

  for (const h of hunks) {
    // oldStart is 1-based
    let idx = (h.oldStart - 1) + lineOffset;
    if (idx < 0 || idx > out.length) {
      const fuzzy = findHunkStartIndex(h);
      if (fuzzy == null) throw new Error("Hunk out of range.");
      idx = fuzzy;
    }

    try {
      applyOneHunk(h, idx);
    } catch {
      // Fallback: try fuzzy locate if strict position fails due to drift.
      const fuzzy = findHunkStartIndex(h);
      if (fuzzy == null) throw new Error("Context mismatch while applying diff.");
      applyOneHunk(h, fuzzy);
    }
  }
  return out;
}

export async function applyUnifiedDiffToWorkspace(diffText: string) {
  const patches = parseUnifiedDiff(diffText);
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) throw new Error("No workspace folder open.");

  const root = folders[0].uri;
  const edit = new vscode.WorkspaceEdit();

  for (const fp of patches) {
    const uri = vscode.Uri.joinPath(root, fp.filePath);
    if (fp.kind === "delete") {
      // Unified diff delete: --- a/path, +++ /dev/null
      edit.deleteFile(uri, { ignoreIfNotExists: false, recursive: false });
      continue;
    }

    let existed = true;
    let text = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString("utf8");
    } catch {
      existed = false;
      text = "";
    }

    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text ? text.replace(/\r\n/g, "\n").split("\n") : [];

    if (fp.kind === "create") {
      // Unified diff create: --- /dev/null, +++ b/path
      // We treat the original file as empty; only additions should exist.
      const hasBad = fp.hunks.some((h) => h.lines.some((l) => l.kind !== "add"));
      if (hasBad) {
        throw new Error(`Create diff for ${fp.filePath} must contain add-only lines.`);
      }
      const created: string[] = [];
      for (const h of fp.hunks) for (const l of h.lines) created.push(l.text);
      const newText = created.join("\n").replace(/\n/g, eol);
      if (!existed) {
        edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
        edit.insert(uri, new vscode.Position(0, 0), newText);
      } else {
        // If file exists, fall back to replace whole file.
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(lines.length, 0)
        );
        edit.replace(uri, fullRange, newText);
      }
      continue;
    }

    // update
    const newLines = applyHunksToLines(lines, fp.hunks);
    const newText = newLines.join("\n").replace(/\n/g, eol);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lines.length, 0));
    edit.replace(uri, fullRange, newText);
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) throw new Error("VS Code rejected the workspace edit.");
}

async function runGitApply3Way(rootFsPath: string, diffText: string) {
  const tmpDir = os.tmpdir();
  const patchPath = path.join(tmpDir, `safegraph-ai-${Date.now()}.patch`);
  const cleaned = sanitizeDiffText(diffText);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(patchPath), Buffer.from(cleaned, "utf8"));

  const run = (args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const p = spawn("git", args, { cwd: rootFsPath, shell: false, windowsHide: true });
      const chunks: Buffer[] = [];
      p.stdout.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      p.stderr.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      p.on("close", (code) => resolve({ code, out: Buffer.concat(chunks).toString("utf8") }));
      p.on("error", () => resolve({ code: -1, out: "git not available" }));
    });

  // Ensure repo
  const isRepo = await run(["rev-parse", "--is-inside-work-tree"]);
  if (isRepo.code !== 0) throw new Error("git fallback unavailable: not a git repo");

  // Dry-run check first
  const check = await run(["apply", "--3way", "--check", patchPath]);
  if (check.code !== 0) {
    throw new Error(`git apply --3way --check failed: ${check.out.trim()}`);
  }
  const apply = await run(["apply", "--3way", patchPath]);
  if (apply.code !== 0) {
    throw new Error(`git apply --3way failed: ${apply.out.trim()}`);
  }
}

export async function applyUnifiedDiffToWorkspaceSmart(diffText: string, output?: vscode.OutputChannel) {
  try {
    await applyUnifiedDiffToWorkspace(diffText);
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Only fallback for common patch drift issues.
    if (!/Hunk out of range|Context mismatch|Delete line mismatch/i.test(msg)) {
      throw e;
    }
    const folders = vscode.workspace.workspaceFolders;
    const rootFsPath = folders?.[0]?.uri.fsPath;
    if (!rootFsPath) throw e;
    output?.appendLine(`[safegraph-ai] apply fuzzy failed (${msg}); trying git apply --3way fallback`);
    await runGitApply3Way(rootFsPath, diffText);
    output?.appendLine("[safegraph-ai] git apply --3way succeeded");
  }
}
