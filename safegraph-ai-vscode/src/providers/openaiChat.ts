/**
 * Pure OpenAI Chat Completions adapters. No network, no VS Code.
 * The provider and the unit tests both use this module.
 */

import type { ProviderContentBlock, ProviderConverseResult, ProviderInput, ProviderTurn, ProviderUsage } from "./types";
import { ProviderRequestError } from "./errors";

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new ProviderRequestError("The OpenAI-compatible base URL is empty.");
  }
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
  return `${trimmed}/models`;
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function toOpenAIMessages(input: ProviderInput, system?: string): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [];
  if (system && system.trim()) {
    messages.push({ role: "system", content: system });
  }
  const turns = typeof input === "string" ? [{ role: "user" as const, text: input }] : input;
  for (const turn of turns) {
    messages.push(...turnToMessages(turn));
  }
  return messages;
}

export function toOpenAITools(toolConfig: unknown): OpenAITool[] | undefined {
  const tools = readTools(toolConfig);
  if (!tools || tools.length === 0) return undefined;
  return tools;
}

export function mapFinishReason(finish: string | null | undefined, hasToolCalls: boolean): string {
  if (hasToolCalls || finish === "tool_calls") return "tool_use";
  if (finish === "length") return "max_tokens";
  return "end_turn";
}

export type StreamToolAcc = { id: string; name: string; arguments: string };

export type StreamState = {
  text: string;
  tools: Map<number, StreamToolAcc>;
  finishReason: string;
  usage?: ProviderUsage;
};

export function createStreamState(): StreamState {
  return { text: "", tools: new Map(), finishReason: "" };
}

/** Apply one chat.completion.chunk (or a non-stream completion) onto state. */
export function applyChatChunk(state: StreamState, payload: unknown): { textDelta: string } {
  const root = asRecord(payload);
  if (!root) return { textDelta: "" };
  const usage = readUsage(root.usage);
  if (usage) state.usage = usage;

  const choice = firstChoice(root);
  if (!choice) return { textDelta: "" };
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }

  const delta = asRecord(choice.delta) || asRecord(choice.message);
  if (!delta) return { textDelta: "" };

  let textDelta = "";
  if (typeof delta.content === "string" && delta.content) {
    textDelta = delta.content;
    state.text += delta.content;
  }
  const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
  toolCalls.forEach((call, position) => {
    const rec = asRecord(call);
    if (!rec) return;
    const index = typeof rec.index === "number" ? rec.index : position;
    const current = state.tools.get(index) || { id: "", name: "", arguments: "" };
    if (typeof rec.id === "string" && rec.id) current.id = rec.id;
    const fn = asRecord(rec.function);
    if (fn) {
      if (typeof fn.name === "string" && fn.name) current.name = fn.name;
      if (typeof fn.arguments === "string" && fn.arguments) current.arguments += fn.arguments;
    }
    state.tools.set(index, current);
  });
  return { textDelta };
}

export function streamStateToResult(state: StreamState): ProviderConverseResult {
  const content = contentFromState(state);
  const stopReason = mapFinishReason(state.finishReason, state.tools.size > 0);
  return envelope(state.text, stopReason, content, state.usage);
}

export function completionToResult(payload: unknown): ProviderConverseResult {
  const message = readErrorMessage(payload);
  const root = asRecord(payload);
  const statusError = root && root.error !== undefined;
  if (statusError && message) {
    throw new ProviderRequestError(message);
  }
  const state = createStreamState();
  applyChatChunk(state, payload);
  if (!state.text && state.tools.size === 0 && message && !root?.choices) {
    throw new ProviderRequestError(message);
  }
  return streamStateToResult(state);
}

export function consumeSseBuffer(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: string[] = [];
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (data) events.push(data);
  }
  return { events, rest };
}

export function readErrorMessage(payload: unknown): string {
  if (typeof payload === "string") return payload.trim().slice(0, 400);
  const rec = asRecord(payload);
  if (!rec) return "";
  if (typeof rec.message === "string" && rec.error === undefined) return rec.message.slice(0, 400);
  const err = rec.error;
  if (typeof err === "string") return err.slice(0, 400);
  const errRec = asRecord(err);
  if (errRec && typeof errRec.message === "string") return errRec.message.slice(0, 400);
  return "";
}

export function formatHttpError(status: number, payload: unknown, baseUrl: string, model: string): string {
  const detail = readErrorMessage(payload);
  const suffix = detail ? `: ${detail}` : ".";
  if (status === 401 || status === 403) {
    return `The API key was rejected by ${baseUrl}${suffix} Open Safegraph AI: Setup and check the key.`;
  }
  if (status === 404) {
    return `Model "${model}" was not found at ${baseUrl}${suffix}`;
  }
  if (status === 429) {
    return `The endpoint rate-limited the request${detail ? `: ${detail}` : "."}`;
  }
  return `Request to ${baseUrl} failed with HTTP ${status}${detail ? `: ${detail}` : "."}`;
}

export function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function wantsMaxCompletionTokens(payload: unknown): boolean {
  const detail = readErrorMessage(payload);
  return /max_completion_tokens|unsupported parameter[:\s]+['"]?max_tokens/i.test(detail);
}

export function readModelIds(payload: unknown): string[] {
  const rec = asRecord(payload);
  const data = rec && Array.isArray(rec.data) ? rec.data : Array.isArray(payload) ? payload : [];
  const ids: string[] = [];
  for (const item of data) {
    const row = asRecord(item);
    if (row && typeof row.id === "string" && row.id.trim()) ids.push(row.id.trim());
  }
  return ids;
}

function envelope(
  text: string,
  stopReason: string,
  content: ProviderContentBlock[],
  usage?: ProviderUsage
): ProviderConverseResult {
  return {
    text,
    stopReason,
    usage,
    raw: {
      output: { message: { content } },
      stopReason,
      usage
    }
  };
}

function contentFromState(state: StreamState): ProviderContentBlock[] {
  const content: ProviderContentBlock[] = [];
  if (state.text) content.push({ text: state.text });
  const indexes = Array.from(state.tools.keys()).sort((a, b) => a - b);
  for (const index of indexes) {
    const tool = state.tools.get(index);
    if (!tool) continue;
    content.push({
      toolUse: {
        toolUseId: tool.id || `call_${index}`,
        name: tool.name,
        input: parseToolInput(tool.arguments)
      }
    });
  }
  if (content.length === 0) content.push({ text: "" });
  return content;
}

function parseToolInput(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const rec = asRecord(parsed);
    return rec || {};
  } catch {
    return { _raw: trimmed };
  }
}

function turnToMessages(turn: ProviderTurn): OpenAIChatMessage[] {
  const blocks = turn.content || [];
  if (blocks.length === 0) {
    return [{ role: turn.role, content: turn.text || "" }];
  }

  if (turn.role === "assistant") {
    const text = blocks.filter(isTextBlock).map((block) => block.text).join("");
    const toolUses = blocks.filter(isToolUseBlock);
    if (toolUses.length === 0) {
      return [{ role: "assistant", content: text || turn.text || "" }];
    }
    return [
      {
        role: "assistant",
        content: text || null,
        tool_calls: toolUses.map((block) => ({
          id: block.toolUse.toolUseId,
          type: "function" as const,
          function: {
            name: block.toolUse.name,
            arguments: JSON.stringify(block.toolUse.input ?? {})
          }
        }))
      }
    ];
  }

  const out: OpenAIChatMessage[] = [];
  const text = blocks.filter(isTextBlock).map((block) => block.text).filter((part) => part.trim().length > 0);
  if (text.length > 0) out.push({ role: "user", content: text.join("\n") });
  else if (turn.text) out.push({ role: "user", content: turn.text });
  for (const block of blocks) {
    if (!isToolResultBlock(block)) continue;
    out.push({
      role: "tool",
      tool_call_id: block.toolResult.toolUseId,
      content: block.toolResult.content.map((part) => part.text).join("\n")
    });
  }
  if (out.length === 0) out.push({ role: "user", content: turn.text || "" });
  return out;
}

function readTools(toolConfig: unknown): OpenAITool[] | undefined {
  const rec = asRecord(toolConfig);
  if (!rec || !Array.isArray(rec.tools)) return undefined;
  const tools: OpenAITool[] = [];
  for (const entry of rec.tools) {
    const spec = asRecord(asRecord(entry)?.toolSpec);
    if (!spec || typeof spec.name !== "string" || !spec.name.trim()) continue;
    const schema = asRecord(spec.inputSchema);
    const json = schema ? asRecord(schema.json) : undefined;
    tools.push({
      type: "function",
      function: {
        name: spec.name,
        description: typeof spec.description === "string" ? spec.description : "",
        parameters: json || { type: "object", properties: {} }
      }
    });
  }
  return tools;
}

function readUsage(value: unknown): ProviderUsage | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const input = numberOrUndefined(rec.prompt_tokens ?? rec.inputTokens ?? rec.input_tokens);
  const output = numberOrUndefined(rec.completion_tokens ?? rec.outputTokens ?? rec.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return { inputTokens: input, outputTokens: output };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstChoice(root: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(root.choices) || root.choices.length === 0) return undefined;
  return asRecord(root.choices[0]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isTextBlock(block: ProviderContentBlock): block is { text: string } {
  return "text" in block;
}

function isToolUseBlock(
  block: ProviderContentBlock
): block is Extract<ProviderContentBlock, { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }> {
  return "toolUse" in block;
}

function isToolResultBlock(
  block: ProviderContentBlock
): block is Extract<ProviderContentBlock, { toolResult: { toolUseId: string; content: { text: string }[] } }> {
  return "toolResult" in block;
}
