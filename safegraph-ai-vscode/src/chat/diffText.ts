export function formatApplyError(e: unknown) {
  const raw = String(e instanceof Error ? e.message : e);
  const normalized = raw.replace(/^Error:\s*/i, "").trim();

  if (/corrupt patch/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Reason: the diff was not a valid unified patch. This can happen when multiple file diffs are split incorrectly, or when model text is mixed into the patch.",
      "Fix: use Apply All on the combined diff, or ask Safegraph AI to regenerate the patch as a clean ```diff block."
    ].join("\n");
  }

  if (/Context mismatch|Delete line mismatch|Hunk out of range|patch does not apply|does not match/i.test(normalized)) {
    return [
      `Safegraph AI: Apply failed: ${normalized}`,
      "Reason: the target file changed or the patch context no longer matches your workspace.",
      "Fix: ask Safegraph AI to regenerate the diff from the current file contents."
    ].join("\n");
  }

  return `Safegraph AI: Apply failed: ${normalized}`;
}

export function extractDiffBlocks(text: string) {
  const diffs: string[] = [];
  const re = /```diff\s*([\s\S]*?)```/gi;
  for (const m of String(text || "").matchAll(re)) {
    const diff = String(m[1] || "").trim();
    if (diff) diffs.push(diff);
  }
  return diffs;
}

export function stripDiffBlocksForLiveApply(text: string) {
  return String(text || "")
    .replace(/```diff\s*[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
