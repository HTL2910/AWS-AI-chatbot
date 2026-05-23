import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
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
  // We keep only valid unified diff metadata and hunk lines.
  const out: string[] = [];
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  let inHunk = false;

  for (const line of lines) {
    const isMetadata =
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ");

    if (isMetadata) {
      inHunk = false;
      out.push(line);
      continue;
    }

    if (line.startsWith("@@ ")) {
      inHunk = true;
      out.push(line);
      continue;
    }

    if (inHunk) {
      if (line === "") {
        out.push(" ");
      } else if (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line.startsWith("\\ No newline at end of file")
      ) {
        out.push(line);
      } else {
        out.push(" " + line);
      }
      continue;
    }

    if (line.trim() === "") {
      out.push(line);
      continue;
    }

    // Drop stray lines outside of diff metadata and hunks.
  }

  // Normalize blank lines inside hunks so git does not reject them.
  const fixed: string[] = [];
  inHunk = false;
  for (const l of out) {
    if (l.startsWith("@@ ")) inHunk = true;
    if (l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("diff --git ")) inHunk = false;
    if (inHunk && l === "") fixed.push(" ");
    else fixed.push(l);
  }

  // Ensure hunk body lines are valid patch lines.
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
    
    // For new files with no hunks, collect all lines as add lines
    if (kind === "create") {
      const addLines: HunkLine[] = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("--- ") || line.startsWith("diff --git ")) break;
        if (line.startsWith("@@ ")) {
          // If we hit a hunk marker, process normally below
          break;
        }
        if (line.startsWith("+") && !line.startsWith("+++")) {
          addLines.push({ kind: "add", text: line.slice(1) });
          i++;
          continue;
        }
        if (line.startsWith(" ")) {
          addLines.push({ kind: "context", text: line.slice(1) });
          i++;
          continue;
        }
        if (line.startsWith("-") && !line.startsWith("---")) {
          // For new files, deletes don't make sense, but allow context
          i++;
          continue;
        }
        if (line.startsWith("\\ No newline at end of file")) {
          i++;
          continue;
        }
        // Skip other lines
        i++;
      }
      // If we collected add lines and no hunks yet, treat as a single hunk
      if (addLines.length > 0 && !lines[i]?.startsWith("@@ ")) {
        hunks.push({
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: addLines.length,
          lines: addLines
        });
      }
    }
    
    // Process hunks if present
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
          i++;
          continue;
        }
        i++;
      }
      hunks.push({ ...hh, lines: hunkLines });
    }

    if (hunks.length > 0 || kind === "create") {
      patches.push({ filePath, oldPath, newPath, kind, hunks });
    }
  }

  if (patches.length === 0) throw new Error("No file patches found in diff.");
  return patches;
}

function applyHunksToLines(original: string[], hunks: Hunk[]): string[] {
  const out = original.slice();
  // We apply hunks in order; unified diffs are ordered top-down.
  let lineOffset = 0;

  function sameLine(a: string | undefined, b: string, loose = false) {
    if (a == null) return false;
    if (a === b) return true;
    return loose && a.trim() === b.trim();
  }

  function lineSimilarity(a: string | undefined, b: string) {
    if (a == null) return 0;
    const left = a.trim();
    const right = b.trim();
    if (!left && !right) return 1;
    if (left === right) return 1;
    if (!left || !right) return 0;
    if (left.includes(right) || right.includes(left)) {
      return Math.min(left.length, right.length) / Math.max(left.length, right.length);
    }
    const leftTokens = new Set(left.split(/\W+/).filter(Boolean));
    const rightTokens = new Set(right.split(/\W+/).filter(Boolean));
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    let hits = 0;
    for (const token of rightTokens) if (leftTokens.has(token)) hits++;
    return hits / Math.max(leftTokens.size, rightTokens.size);
  }

  function findHunkStartIndex(h: Hunk, loose = false): number | null {
    // Build an "old-file" signature from context+del lines (adds don't exist in old file).
    const sig = h.lines.filter((l) => l.kind !== "add").map((l) => l.text);
    if (sig.length === 0) return null;

    // Search for the first signature line, then verify sequential match.
    const first = sig[0];
    for (let start = 0; start <= out.length - 1; start++) {
      if (!sameLine(out[start], first, loose)) continue;
      let ok = true;
      for (let j = 0; j < sig.length; j++) {
        if (start + j >= out.length || !sameLine(out[start + j], sig[j], loose)) {
          ok = false;
          break;
        }
      }
      if (ok) return start;
    }
    return null;
  }

  function findApproxHunkStartIndex(h: Hunk): number | null {
    const oldSeq = h.lines.filter((l) => l.kind !== "add").map((l) => l.text);
    const delSeq = h.lines.filter((l) => l.kind === "del").map((l) => l.text);
    if (oldSeq.length === 0) return Math.max(0, Math.min(out.length, h.oldStart - 1 + lineOffset));

    let best = { start: -1, score: 0, deleteHits: 0 };
    const expected = Math.max(0, Math.min(out.length, h.oldStart - 1 + lineOffset));
    const maxStart = Math.max(0, out.length - 1);
    for (let start = 0; start <= maxStart; start++) {
      let score = 0;
      let deleteHits = 0;
      for (let j = 0; j < oldSeq.length; j++) {
        const actual = out[start + j];
        const expectedLine = oldSeq[j];
        if (actual === expectedLine) score += 4;
        else if (sameLine(actual, expectedLine, true)) score += 3;
        else score += lineSimilarity(actual, expectedLine);
      }
      for (const d of delSeq) {
        const window = out.slice(start, Math.min(out.length, start + oldSeq.length + 8));
        if (window.some((line) => sameLine(line, d, true) || lineSimilarity(line, d) >= 0.72)) {
          score += 6;
          deleteHits++;
        }
      }
      score -= Math.min(4, Math.abs(start - expected) / 200);
      if (score > best.score) best = { start, score, deleteHits };
    }
    if (delSeq.length > 0 && best.deleteHits === 0) return null;
    return best.score >= Math.max(4, oldSeq.length * 1.5) ? best.start : null;
  }

  function sequenceExists(seq: string[], loose = false) {
    if (seq.length === 0) return false;
    for (let start = 0; start <= out.length - seq.length; start++) {
      let ok = true;
      for (let j = 0; j < seq.length; j++) {
        if (!sameLine(out[start + j], seq[j], loose)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  function hunkAlreadyApplied(h: Hunk) {
    const added = h.lines.filter((l) => l.kind === "add").map((l) => l.text);
    const deleted = h.lines.filter((l) => l.kind === "del").map((l) => l.text);
    if (added.length === 0) return false;
    const additionsPresent = sequenceExists(added) || sequenceExists(added, true);
    if (!additionsPresent) return false;
    if (deleted.length === 0) return true;
    return !deleted.some((line) => out.some((current) => sameLine(current, line) || sameLine(current, line, true)));
  }

  function applyOneHunk(h: Hunk, idx0: number, loose = false) {
    let idx = idx0;
    for (const hl of h.lines) {
      if (hl.kind === "context") {
        if (!sameLine(out[idx], hl.text, loose)) throw new Error("Context mismatch while applying diff.");
        idx++;
      } else if (hl.kind === "del") {
        if (!sameLine(out[idx], hl.text, loose)) throw new Error("Delete line mismatch while applying diff.");
        out.splice(idx, 1);
        lineOffset -= 1;
      } else if (hl.kind === "add") {
        out.splice(idx, 0, hl.text);
        idx++;
        lineOffset += 1;
      }
    }
  }

  function applyOneHunkApprox(h: Hunk, idx0: number) {
    let idx = idx0;
    const seek = (text: string, from: number, limit: number) => {
      const end = Math.min(out.length, from + limit);
      let best = { idx: -1, score: 0 };
      for (let i = from; i < end; i++) {
        if (sameLine(out[i], text, true)) return i;
        const score = lineSimilarity(out[i], text);
        if (score > best.score) best = { idx: i, score };
      }
      return best.score >= 0.72 ? best.idx : -1;
    };

    for (const hl of h.lines) {
      if (hl.kind === "context") {
        if (sameLine(out[idx], hl.text, true)) {
          idx++;
          continue;
        }
        const nearby = seek(hl.text, idx, 8);
        if (nearby >= 0) idx = nearby + 1;
        continue;
      }
      if (hl.kind === "del") {
        if (sameLine(out[idx], hl.text, true)) {
          out.splice(idx, 1);
          lineOffset -= 1;
          continue;
        }
        const nearby = seek(hl.text, idx, 12);
        if (nearby >= 0) {
          out.splice(nearby, 1);
          idx = nearby;
          lineOffset -= 1;
        }
        continue;
      }
      out.splice(idx, 0, hl.text);
      idx++;
      lineOffset += 1;
    }
  }

  for (const h of hunks) {
    // oldStart is 1-based
    let idx = (h.oldStart - 1) + lineOffset;
    if (idx < 0 || idx > out.length) {
      const fuzzy = findHunkStartIndex(h) ?? findHunkStartIndex(h, true) ?? findApproxHunkStartIndex(h);
      if (fuzzy == null) {
        if (hunkAlreadyApplied(h)) continue;
        throw new Error("Hunk out of range.");
      }
      idx = fuzzy;
    }

    try {
      applyOneHunk(h, idx);
    } catch {
      if (hunkAlreadyApplied(h)) continue;
      // Fallback: try fuzzy locate if strict position fails due to drift.
      const fuzzy = findHunkStartIndex(h);
      if (fuzzy != null) {
        try {
          applyOneHunk(h, fuzzy);
          continue;
        } catch {
          // continue to looser repair
        }
      }
      const looseFuzzy = findHunkStartIndex(h, true);
      if (looseFuzzy != null) {
        try {
          applyOneHunk(h, looseFuzzy, true);
          continue;
        } catch {
          // continue to approximate repair
        }
      }
      const approx = findApproxHunkStartIndex(h);
      if (approx == null) {
        if (hunkAlreadyApplied(h)) continue;
        throw new Error("Context mismatch while applying diff.");
      }
      applyOneHunkApprox(h, approx);
    }
  }
  return out;
}

function validateAppliedText(filePath: string, text: string) {
  const artifact = text.replace(/\r\n/g, "\n").split("\n").find((line) =>
    /^@@\s+-\d/.test(line) ||
    /^diff --git\s+/.test(line) ||
    /^---\s+(?:a\/|\/dev\/null)/.test(line) ||
    /^\+\+\+\s+(?:b\/|\/dev\/null)/.test(line)
  );
  if (artifact) {
    throw new Error(
      `Refused to apply ${filePath}: generated file still contains diff artifact "${artifact.slice(0, 120)}".`
    );
  }
}

async function runProcess(args: string[]) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const [cmd, ...rest] = args;
    let done = false;
    const finish = (code: number | null, out: string) => {
      if (done) return;
      done = true;
      resolve({ code, out });
    };
    const p = spawn(cmd, rest, { shell: false, windowsHide: true });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    p.stderr.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    p.on("close", (code) => finish(code, Buffer.concat(chunks).toString("utf8")));
    p.on("error", (e) => finish(-1, String(e)));
  });
}

function existingExecutable(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureSafegraphVenvPython(root: string) {
  const bin = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const venvPython = path.join(root, ".safegraph-venv", bin);
  if (existingExecutable(venvPython)) return venvPython;

  const systemPython = [
    "/usr/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    process.platform === "win32" ? "python" : "python3"
  ].find((candidate) => (candidate.includes(path.sep) ? existingExecutable(candidate) : true));
  if (!systemPython) return "";

  const result = await runProcess([systemPython, "-m", "venv", path.join(root, ".safegraph-venv")]);
  if (result.code === 0 && existingExecutable(venvPython)) return venvPython;
  return "";
}

async function candidatePythonCommands() {
  const candidates: string[] = [];
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    candidates.push(
      path.join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      path.join(root, ".safegraph-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
    );
    const safegraphVenv = await ensureSafegraphVenvPython(root);
    if (safegraphVenv) candidates.push(safegraphVenv);
  }
  candidates.push(
    "/usr/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    process.platform === "win32" ? "python" : "python3",
    "python"
  );
  return candidates;
}

async function validatePythonSyntax(filePath: string, text: string) {
  if (!filePath.toLowerCase().endsWith(".py")) return;
  const tmpPath = path.join(os.tmpdir(), `safegraph-ai-preflight-${Date.now()}-${Math.random().toString(16).slice(2)}.py`);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(tmpPath), Buffer.from(text, "utf8"));
  let result: { code: number | null; out: string } | undefined;
  let sawPython = false;
  for (const python of await candidatePythonCommands()) {
    if (python.includes(path.sep) && !existingExecutable(python)) continue;
    result = await runProcess([python, "-m", "py_compile", tmpPath]);
    if (result.code === -1) continue;
    if (/spawn .* ENOENT/i.test(result.out)) continue;
    sawPython = true;
    if (result.code === 0) break;
  }
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(tmpPath), { useTrash: false });
  } catch {
    // ignore temp cleanup failure
  }
  if (!sawPython) return;
  if (result && result.code !== 0 && result.code !== -1) {
    throw new Error(`Refused to apply ${filePath}: Python syntax check failed: ${result.out.trim()}`);
  }
}

function applySinglePatchToText(originalText: string, diffText: string, targetPath: string) {
  const patches = parseUnifiedDiff(diffText);
  const patch = patches.find((p) => p.filePath === targetPath || p.oldPath === targetPath || p.newPath === targetPath);
  if (!patch) throw new Error(`No patch found for ${targetPath}.`);
  if (patch.kind === "delete") return "";

  const eol = originalText.includes("\r\n") ? "\r\n" : "\n";
  const lines = originalText ? originalText.replace(/\r\n/g, "\n").split("\n") : [];
  if (patch.kind === "create") {
    const created: string[] = [];
    for (const h of patch.hunks) for (const l of h.lines) if (l.kind === "add") created.push(l.text);
    return created.join("\n").replace(/\n/g, eol);
  }

  return applyHunksToLines(lines, patch.hunks).join("\n").replace(/\n/g, eol);
}

export async function preflightUnifiedDiffAgainstWorkspace(diffText: string) {
  const patches = parseUnifiedDiff(diffText);
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) throw new Error("No workspace folder open.");

  const root = folders[0].uri;
  const checked: string[] = [];
  for (const patch of patches) {
    if (patch.kind === "delete") {
      checked.push(patch.filePath);
      continue;
    }

    const uri = vscode.Uri.joinPath(root, patch.filePath);
    let originalText = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      originalText = Buffer.from(bytes).toString("utf8");
    } catch {
      originalText = "";
    }

    const newText = applySinglePatchToText(originalText, diffText, patch.filePath);
    validateAppliedText(patch.filePath, newText);
    await validatePythonSyntax(patch.filePath, newText);
    checked.push(patch.filePath);
  }
  return checked;
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
      validateAppliedText(fp.filePath, newText);
      await validatePythonSyntax(fp.filePath, newText);
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
    validateAppliedText(fp.filePath, newText);
    await validatePythonSyntax(fp.filePath, newText);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lines.length, 0));
    edit.replace(uri, fullRange, newText);
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) throw new Error("VS Code rejected the workspace edit.");
}

async function runGitApply3Way(rootFsPath: string, diffText: string, output?: vscode.OutputChannel) {
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

  const fallbackToDirectApply = (msg: string) =>
    /repository lacks the necessary blob/i.test(msg) || /unable to find (?:object|blob)/i.test(msg);

  // Ensure repo
  const isRepo = await run(["rev-parse", "--is-inside-work-tree"]);
  if (isRepo.code !== 0) throw new Error("git fallback unavailable: not a git repo");

  // Dry-run check first
  const check = await run(["apply", "--3way", "--check", patchPath]);
  if (check.code !== 0) {
    const msg = check.out.trim();
    if (fallbackToDirectApply(msg)) {
      const directCheck = await run(["apply", "--check", patchPath]);
      if (directCheck.code !== 0) {
        throw new Error(
          `git apply --3way --check failed: ${msg}\ngit apply --check failed: ${directCheck.out.trim()}`
        );
      }
      output?.appendLine("[safegraph-ai] git apply --3way unavailable; using direct git apply fallback");
      const directApply = await run(["apply", patchPath]);
      if (directApply.code !== 0) {
        throw new Error(`git apply failed: ${directApply.out.trim()}`);
      }
      output?.appendLine("[safegraph-ai] git apply direct fallback succeeded");
      return;
    }
    throw new Error(`git apply --3way --check failed: ${msg}`);
  }

  const apply = await run(["apply", "--3way", patchPath]);
  if (apply.code !== 0) {
    const msg = apply.out.trim();
    if (fallbackToDirectApply(msg)) {
      output?.appendLine("[safegraph-ai] git apply --3way failed; using direct git apply fallback");
      const directApply = await run(["apply", patchPath]);
      if (directApply.code !== 0) {
        throw new Error(`git apply failed: ${directApply.out.trim()}`);
      }
      output?.appendLine("[safegraph-ai] git apply direct fallback succeeded");
      return;
    }
    throw new Error(`git apply --3way failed: ${msg}`);
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
    await runGitApply3Way(rootFsPath, diffText, output);
    output?.appendLine("[safegraph-ai] git apply --3way succeeded");
  }
}
