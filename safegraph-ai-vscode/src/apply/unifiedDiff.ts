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

function looksLikeCodeLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(\/\/|\/\*|\*|#\s)/.test(trimmed)) return false;
  if (
    /\b(const|let|var|function|class|def|return|if|else|elif|for|while|switch|case|import|export|from|async|await|try|catch|throw|new)\b/.test(
      trimmed
    )
  ) {
    return true;
  }
  return /[{}()[\];=<>]|=>|::|->|\.\w+\(|\b[A-Za-z_]\w*\s*=/.test(trimmed);
}

function sanitizeDiffText(diffText: string) {
  // Cursor-like tolerance: models sometimes include commentary lines inside ```diff``` blocks.
  // We keep only valid unified diff metadata and hunk lines.
  const out: string[] = [];
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  let inHunk = false;
  let afterFileHeader = false;

  const isFileHeaderAt = (idx: number) => lines[idx]?.startsWith("--- ") && lines[idx + 1]?.startsWith("+++ ");

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
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

    if (inHunk && !line.startsWith("diff --git ") && !isFileHeaderAt(idx)) {
      if (line === "") {
        out.push(" ");
      } else if (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line.startsWith("\\ No newline at end of file")
      ) {
        out.push(line);
      } else if (looksLikeCodeLine(line)) {
        out.push("+" + line);
      } else {
        out.push(" " + line);
      }
      continue;
    }

    if (isMetadata) {
      inHunk = false;
      if (line.startsWith("--- ")) afterFileHeader = false;
      if (line.startsWith("+++ ")) afterFileHeader = true;
      out.push(line);
      continue;
    }

    if (line.startsWith("@@ ")) {
      inHunk = true;
      out.push(line);
      continue;
    }

    if (afterFileHeader) {
      out.push(line);
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
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (l.startsWith("@@ ")) inHunk = true;
    if (l.startsWith("diff --git ") || (l.startsWith("--- ") && out[i + 1]?.startsWith("+++ "))) inHunk = false;
    if (inHunk && l === "") fixed.push(" ");
    else fixed.push(l);
  }

  // Ensure hunk body lines are valid patch lines.
  const normalized: string[] = [];
  inHunk = false;
  for (let i = 0; i < fixed.length; i++) {
    const l = fixed[i];
    if (l.startsWith("@@ ")) {
      inHunk = true;
      normalized.push(l);
      continue;
    }
    if (l.startsWith("diff --git ") || (l.startsWith("--- ") && fixed[i + 1]?.startsWith("+++ "))) {
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

function normalizeHunkHeaders(diffText: string) {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hh = parseHunkHeader(line);
    if (!hh) {
      out.push(line);
      continue;
    }

    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const startsNextFile = next.startsWith("diff --git ") || (next.startsWith("--- ") && lines[j + 1]?.startsWith("+++ "));
      if (next.startsWith("@@ ") || startsNextFile) break;
      body.push(next);
      j++;
    }

    let oldLines = 0;
    let newLines = 0;
    for (const bodyLine of body) {
      if (bodyLine.startsWith("\\ No newline at end of file")) continue;
      const marker = bodyLine.slice(0, 1);
      if (marker === " ") {
        oldLines++;
        newLines++;
      } else if (marker === "-") {
        oldLines++;
      } else if (marker === "+") {
        newLines++;
      }
    }

    const suffix = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@(.*)$/.exec(line)?.[1] ?? "";
    out.push(`@@ -${hh.oldStart},${oldLines} +${hh.newStart},${newLines} @@${suffix}`);
    out.push(...body);
    i = j - 1;
  }

  return out.join("\n");
}

function parseLooseChunkToHunks(lines: string[], startIndex: number) {
  const hunkLines: HunkLine[] = [];
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    const startsNextFile = line.startsWith("diff --git ") || (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ "));
    if (startsNextFile) break;
    if (line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ")) {
      i++;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      hunkLines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      hunkLines.push({ kind: "del", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      hunkLines.push({ kind: "context", text: line.slice(1) });
    } else if (line.trim() === "") {
      hunkLines.push({ kind: "context", text: "" });
    } else if (looksLikeCodeLine(line)) {
      hunkLines.push({ kind: "add", text: line });
    }
    i++;
  }
  return { hunkLines, nextIndex: i };
}

export function parseUnifiedDiff(diffText: string): FilePatch[] {
  const cleaned = normalizeHunkHeaders(sanitizeDiffText(diffText));
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

    if (hunks.length === 0 && i < lines.length && !lines[i]?.startsWith("@@ ")) {
      const loose = parseLooseChunkToHunks(lines, i);
      if (loose.hunkLines.length > 0) {
        const newLines = loose.hunkLines.filter((l) => l.kind !== "del").length;
        const oldLines = loose.hunkLines.filter((l) => l.kind !== "add").length;
        hunks.push({
          oldStart: 1,
          oldLines,
          newStart: 1,
          newLines,
          lines: loose.hunkLines
        });
        i = loose.nextIndex;
      }
    }
    
    // Process hunks if present
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("diff --git ") || (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ "))) break;
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
        const startsNextFile = hl.startsWith("diff --git ") || (hl.startsWith("--- ") && lines[i + 1]?.startsWith("+++ "));
        if (hl.startsWith("@@ ") || startsNextFile) break;
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
  let appliedOps = 0;

  function sameLine(a: string | undefined, b: string, loose: boolean) {
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
      const distancePenalty = Math.min(4, Math.abs(start - expected) / 200);
      score -= distancePenalty;
      if (score > best.score) best = { start, score, deleteHits };
    }

    const hasDeletes = delSeq.length > 0;
    if (hasDeletes && best.deleteHits === 0) return null;
    const minScore = hasDeletes ? 5 : Math.max(4, oldSeq.length * 1.5);
    return best.score >= minScore ? best.start : null;
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
    let delta = 0;
    let hunkAppliedOps = 0;
    const hasEdits = h.lines.some((l) => l.kind !== "context");
    const oldSeq = h.lines.filter((l) => l.kind !== "add").map((l) => l.text);
    const newSeq = h.lines.filter((l) => l.kind !== "del").map((l) => l.text);

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
        if (nearby >= 0) {
          idx = nearby + 1;
        }
        // If context cannot be found, treat it as model commentary/stale context and skip it.
        continue;
      }

      if (hl.kind === "del") {
        if (sameLine(out[idx], hl.text, true)) {
          out.splice(idx, 1);
          delta -= 1;
          appliedOps += 1;
          hunkAppliedOps += 1;
          continue;
        }
        const nearby = seek(hl.text, idx, 12);
        if (nearby < 0) {
          // Stale deletion line: skip it instead of failing the whole patch.
          continue;
        }
        out.splice(nearby, 1);
        idx = nearby;
        delta -= 1;
        appliedOps += 1;
        hunkAppliedOps += 1;
        continue;
      }

      out.splice(idx, 0, hl.text);
      idx++;
      delta += 1;
      appliedOps += 1;
      hunkAppliedOps += 1;
    }

    lineOffset += delta;

    if (hunkAppliedOps === 0 && hasEdits) {
      const anchor = findApproxHunkStartIndex(h) ?? idx0;
      const removeLen = Math.max(1, oldSeq.length);
      const boundedStart = Math.max(0, Math.min(out.length, anchor));
      const boundedEnd = Math.max(boundedStart, Math.min(out.length, boundedStart + removeLen));
      const replacement = newSeq.length > 0 ? newSeq : oldSeq;
      out.splice(boundedStart, boundedEnd - boundedStart, ...replacement);
      appliedOps += replacement.length > 0 || boundedEnd - boundedStart > 0 ? 1 : 0;
    }
  }

  for (const h of hunks) {
    // oldStart is 1-based
    let idx = (h.oldStart - 1) + lineOffset;
    if (idx < 0 || idx > out.length) {
      const fuzzy = findHunkStartIndex(h);
      if (fuzzy == null) {
        const looseFuzzy = findHunkStartIndex(h, true);
        if (looseFuzzy == null) {
          const approx = findApproxHunkStartIndex(h);
          if (approx == null) {
            const fallback = Math.max(0, Math.min(out.length, h.oldStart - 1 + lineOffset));
            applyOneHunkApprox(h, fallback);
          } else {
            applyOneHunkApprox(h, approx);
          }
          continue;
        } else {
          idx = looseFuzzy;
        }
      } else {
        idx = fuzzy;
      }
    }

    try {
      applyOneHunk(h, idx);
    } catch {
      // Fallback: try fuzzy locate if strict position fails due to drift.
      const fuzzy = findHunkStartIndex(h);
      if (fuzzy != null) {
        try {
          applyOneHunk(h, fuzzy);
          continue;
        } catch {
          // Keep falling through to the repair mode below.
        }
      }

      // Last local fallback: allow whitespace/indent drift in context and delete lines.
      const looseFuzzy = findHunkStartIndex(h, true);
      if (looseFuzzy != null) {
        try {
          applyOneHunk(h, looseFuzzy, true);
          continue;
        } catch {
          // Keep falling through to approximate repair.
        }
      }

      // Repair malformed model diffs: use '-' lines as the source of truth and stale context only as hints.
      const approx = findApproxHunkStartIndex(h);
      if (approx == null) {
        const fallback = Math.max(0, Math.min(out.length, h.oldStart - 1 + lineOffset));
        applyOneHunkApprox(h, fallback);
      } else {
        applyOneHunkApprox(h, approx);
      }
    }
  }
  if (appliedOps === 0) {
    throw new Error("No applicable changes found in diff.");
  }
  return out;
}

function extractTargetChunk(diffText: string, targetPath?: string) {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[] = [];
  let cur: string[] = [];
  let curTarget = "";

  const flush = () => {
    if (cur.length === 0) return;
    chunks.push(cur.join("\n"));
    cur = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      flush();
      cur.push(line);
      const m = /^diff --git a\/([^\s]+)\s+b\/([^\s]+)\s*$/.exec(line);
      curTarget = m?.[2] || m?.[1] || "";
      continue;
    }
    if (line.startsWith("--- ") && cur.length > 0) {
      flush();
    }
    cur.push(line);
  }
  flush();

  if (chunks.length === 0) return "";
  if (!targetPath) return chunks[0];

  const normalizedTarget = targetPath.replace(/^[ab]\//, "");
  return (
    chunks.find((chunk) => {
      const file = String(chunk).match(/^\+\+\+\s+([^\t\r\n]+).*$/m)?.[1]?.replace(/^[ab]\//, "");
      if (file && file === normalizedTarget) return true;
      const file2 = String(chunk).match(/^---\s+([^\t\r\n]+).*$/m)?.[1]?.replace(/^[ab]\//, "");
      return !!file2 && file2 === normalizedTarget;
    }) || chunks[0]
  );
}

function buildFallbackRewriteText(diffText: string, targetPath?: string) {
  const chunk = extractTargetChunk(diffText, targetPath);
  if (!chunk) return "";

  const lines = chunk.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff --git ") || line.startsWith("index ")) {
      continue;
    }
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("+")) {
      out.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      out.push(line.slice(1));
      continue;
    }
    if (line.startsWith("-")) {
      continue;
    }
    if (inHunk || looksLikeCodeLine(line)) {
      out.push(line);
    }
  }

  return out.join("\n").trimEnd();
}

export function applyUnifiedDiffToText(originalText: string, diffText: string, targetPath?: string) {
  const patches = parseUnifiedDiff(diffText);
  const patch = targetPath
    ? patches.find((p) => p.filePath === targetPath || p.oldPath === targetPath || p.newPath === targetPath)
    : patches[0];
  if (!patch) throw new Error(`No patch found for ${targetPath || "first file"}.`);
  if (patch.kind === "delete") return "";

  const eol = originalText.includes("\r\n") ? "\r\n" : "\n";
  const lines = originalText ? originalText.replace(/\r\n/g, "\n").split("\n") : [];

  if (patch.kind === "create") {
    const created: string[] = [];
    for (const h of patch.hunks) {
      for (const l of h.lines) {
        if (l.kind === "add") created.push(l.text);
      }
    }
    return created.join("\n").replace(/\n/g, eol);
  }

  try {
    return applyHunksToLines(lines, patch.hunks).join("\n").replace(/\n/g, eol);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (!/No applicable changes found in diff|Hunk out of range|Context mismatch|Delete line mismatch/i.test(msg)) {
      throw e;
    }
    const fallback = buildFallbackRewriteText(diffText, targetPath);
    if (!fallback) throw e;
    return fallback.replace(/\n/g, eol);
  }
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
    let newText = "";
    try {
      newText = applyHunksToLines(lines, fp.hunks).join("\n").replace(/\n/g, eol);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (!/No applicable changes found in diff|Hunk out of range|Context mismatch|Delete line mismatch/i.test(msg)) {
        throw e;
      }
      const fallback = buildFallbackRewriteText(
        [
          `--- a/${fp.filePath}`,
          `+++ b/${fp.filePath}`,
          ...fp.hunks.flatMap((h) => [
            `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
            ...h.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`)
          ])
        ].join("\n"),
        fp.filePath
      );
      if (!fallback) throw e;
      newText = fallback.replace(/\n/g, eol);
    }
    const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lines.length, 0));
    edit.replace(uri, fullRange, newText);
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) throw new Error("VS Code rejected the workspace edit.");
}

async function runGitApply3Way(rootFsPath: string, diffText: string, output?: vscode.OutputChannel) {
  const tmpDir = os.tmpdir();
  const patchPath = path.join(tmpDir, `safegraph-ai-${Date.now()}.patch`);
  const cleaned = normalizeHunkHeaders(sanitizeDiffText(diffText));
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
  let firstError: any;
  try {
    await applyUnifiedDiffToWorkspace(diffText);
    return;
  } catch (e: any) {
    firstError = e;
    const msg = String(e?.message || e);
    // Only fallback for common patch drift or malformed-model-diff issues.
    if (!/Hunk out of range|Context mismatch|Delete line mismatch|No applicable changes found in diff|No file patches found in diff|corrupt patch|malformed diff/i.test(msg)) {
      throw e;
    }
    const folders = vscode.workspace.workspaceFolders;
    const rootFsPath = folders?.[0]?.uri.fsPath;
    if (!rootFsPath) throw e;
    output?.appendLine(`[safegraph-ai] apply fuzzy failed (${msg}); trying git apply --3way fallback`);
    try {
      await runGitApply3Way(rootFsPath, diffText, output);
      output?.appendLine("[safegraph-ai] git apply --3way succeeded");
    } catch (gitError: any) {
      const gitMsg = String(gitError?.message || gitError);
      if (/corrupt patch/i.test(gitMsg)) {
        throw new Error(
          `AI returned a malformed diff that could not be repaired locally. First local apply error: ${String(
            firstError?.message || firstError
          )}. Git error: ${gitMsg}`
        );
      }
      if (/No applicable changes found in diff/i.test(String(firstError?.message || firstError))) {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri && activeUri.scheme === "file") {
          const targetPath = vscode.workspace.asRelativePath(activeUri, false);
          const fallback = buildFallbackRewriteText(diffText, targetPath);
          if (fallback.trim().length > 0) {
            const bytes = await vscode.workspace.fs.readFile(activeUri);
            const text = Buffer.from(bytes).toString("utf8");
            const eol = text.includes("\r\n") ? "\r\n" : "\n";
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              new vscode.Position(0, 0),
              new vscode.Position(text.replace(/\r\n/g, "\n").split("\n").length, 0)
            );
            edit.replace(activeUri, fullRange, fallback.replace(/\n/g, eol));
            const ok = await vscode.workspace.applyEdit(edit);
            if (ok) {
              output?.appendLine("[safegraph-ai] applied active-file rewrite fallback");
              return;
            }
          }
        }
        throw new Error(
          `AI returned a diff that could not be mapped to any file changes. First local apply error: ${String(
            firstError?.message || firstError
          )}. Git error: ${gitMsg}`
        );
      }
      throw gitError;
    }
  }
}
