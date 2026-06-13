/**
 * Pure helpers for building Claude Haiku 4.5 fill-in-the-middle (FIM) completion
 * prompts and cleaning the model output. Kept free of vscode imports so they can
 * be unit tested directly.
 */

export interface CompletionPromptContext {
  language: string;
  /** Code immediately before the cursor (already truncated to a budget). */
  prefix: string;
  /** Code immediately after the cursor (already truncated to a budget). */
  suffix: string;
  /** Text of the current line up to the cursor. */
  currentLine: string;
  imports?: string[];
  relativePath?: string;
}

export interface BuildPromptOptions {
  /** Max source characters to keep on each side of the cursor. */
  maxSideChars?: number;
  multiline?: boolean;
}

/**
 * Stop sequences keep Haiku 4.5 from drifting into prose or a second suggestion.
 * Bedrock allows at most 4 stop sequences.
 */
export const COMPLETION_STOP_SEQUENCES = ["<|END|>", "```", "\n\n\n"];

/**
 * Concise, directive system prompt. Haiku 4.5 follows explicit constraints well,
 * so we keep instructions short and unambiguous and forbid prose.
 */
export function buildCompletionSystemPrompt(): string {
  return [
    "You are Safegraph AI, a code autocomplete engine running inside VS Code.",
    "Continue the code at the <CURSOR> marker so it fits naturally between the code before and after it.",
    "Output ONLY the raw code that should be inserted at the cursor.",
    "Do not repeat code that already appears before the cursor.",
    "Do not add explanations, comments about the change, markdown fences, or a trailing newline.",
    "Match the existing indentation, naming, quote style, and language conventions.",
    "If no useful completion exists, output nothing.",
    "Finish your output with <|END|>."
  ].join("\n");
}

function clampTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function clampHead(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

/** Build the user message for a FIM completion request. */
export function buildCompletionPrompt(
  context: CompletionPromptContext,
  options: BuildPromptOptions = {}
): string {
  const maxSide = options.maxSideChars ?? 4000;
  const prefix = clampTail(context.prefix, maxSide);
  const suffix = clampHead(context.suffix, maxSide);

  const header: string[] = [`Language: ${context.language || "plaintext"}`];
  if (context.relativePath) header.push(`File: ${context.relativePath}`);
  if (context.imports && context.imports.length > 0) {
    header.push(`Imports: ${context.imports.slice(0, 20).join(", ")}`);
  }
  header.push(
    options.multiline === false
      ? "Complete only the current line."
      : "Complete the current statement or block (a few lines max)."
  );

  return [
    header.join("\n"),
    "",
    "Code:",
    `${prefix}<CURSOR>${suffix}`,
    "",
    "Insert at <CURSOR>:"
  ].join("\n");
}

/**
 * Clean raw model output into insertable text:
 * - strip markdown code fences and the <|END|> sentinel
 * - drop a leading echo of the text the user already typed on the current line
 * - optionally collapse to a single line
 */
export function cleanCompletion(
  raw: string,
  currentLine: string = "",
  multiline: boolean = true
): string {
  if (!raw) return "";
  let out = raw;

  // Remove the end sentinel and anything after it.
  const endIdx = out.indexOf("<|END|>");
  if (endIdx !== -1) out = out.slice(0, endIdx);

  // Strip surrounding markdown code fences.
  out = out.replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/, "").replace(/\n?```\s*$/, "");

  // If the model echoed the already-typed prefix, drop it.
  const typed = currentLine.trimStart();
  if (typed && out.startsWith(typed)) {
    out = out.slice(typed.length);
  }

  // Remove a leading newline so the suggestion starts at the cursor.
  out = out.replace(/^\n+/, "");

  if (!multiline) {
    out = out.split("\n")[0];
  }

  // Trim trailing whitespace but keep meaningful leading indentation.
  out = out.replace(/\s+$/, "");

  return out;
}
