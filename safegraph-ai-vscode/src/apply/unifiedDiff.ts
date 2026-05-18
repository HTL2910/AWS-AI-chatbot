import * as vscode from "vscode";

type HunkLine = { kind: "context" | "add" | "del"; text: string };
type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: HunkLine[] };
type FilePatch = { filePath: string; hunks: Hunk[] };

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
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const patches: FilePatch[] = [];

  let i = 0;
  while (i < lines.length) {
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
        const ch = hl.slice(0, 1);
        const txt = hl.slice(1);
        if (ch === " ") hunkLines.push({ kind: "context", text: txt });
        else if (ch === "+") hunkLines.push({ kind: "add", text: txt });
        else if (ch === "-") hunkLines.push({ kind: "del", text: txt });
        else throw new Error(`Invalid diff line: ${hl}`);
        i++;
      }
      hunks.push({ ...hh, lines: hunkLines });
    }

    patches.push({ filePath, hunks });
  }

  if (patches.length === 0) throw new Error("No file patches found in diff.");
  return patches;
}

function applyHunksToLines(original: string[], hunks: Hunk[]): string[] {
  const out = original.slice();
  // We apply hunks in order; unified diffs are ordered top-down.
  let lineOffset = 0;

  for (const h of hunks) {
    // oldStart is 1-based
    let idx = (h.oldStart - 1) + lineOffset;
    if (idx < 0 || idx > out.length) throw new Error("Hunk out of range.");

    // Verify and apply
    for (const hl of h.lines) {
      if (hl.kind === "context") {
        if (out[idx] !== hl.text) {
          throw new Error("Context mismatch while applying diff.");
        }
        idx++;
      } else if (hl.kind === "del") {
        if (out[idx] !== hl.text) {
          throw new Error("Delete line mismatch while applying diff.");
        }
        out.splice(idx, 1);
        lineOffset -= 1;
      } else if (hl.kind === "add") {
        out.splice(idx, 0, hl.text);
        idx++;
        lineOffset += 1;
      }
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
    let existed = true;
    let text = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString("utf8");
    } catch (e: any) {
      // If the file doesn't exist, allow creating it only when the diff contains additions only.
      existed = false;
      text = "";
    }

    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text ? text.replace(/\r\n/g, "\n").split("\n") : [];

    let newText = "";
    if (!existed) {
      const hasNonAdd = fp.hunks.some((h) => h.lines.some((l) => l.kind !== "add"));
      if (hasNonAdd) {
        throw new Error(
          `Target file not found: ${fp.filePath}. Diff must be a pure create (add-only) or use proper /dev/null headers.`
        );
      }
      const createdLines: string[] = [];
      for (const h of fp.hunks) {
        for (const l of h.lines) {
          createdLines.push(l.text);
        }
      }
      newText = createdLines.join("\n").replace(/\n/g, eol);
      edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
      edit.insert(uri, new vscode.Position(0, 0), newText);
    } else {
      const newLines = applyHunksToLines(lines, fp.hunks);
      newText = newLines.join("\n").replace(/\n/g, eol);

      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(lines.length, 0)
      );
      edit.replace(uri, fullRange, newText);
    }
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) throw new Error("VS Code rejected the workspace edit.");
}
